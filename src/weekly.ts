// 주간 종합 리포트 — 아카이브에 쌓인 한 주치 헤드라인을 읽어 거시 상황과
// 수혜/피해 산업을 정리해 Slack 으로 보낸다. 매주 금요일 17:00 KST 실행.
//
//   npm run weekly            실제 발송
//   DRY_RUN=1 npm run weekly  콘솔 출력만

import { readRange, type ArchiveRecord } from "./archive.js";
import { loadSources } from "./config.js";
import { feedUrl, fetchFeed } from "./feed.js";
import { generate, hasApiKey } from "./llm.js";

const DAYS = 7;
/** 아카이브 적재량이 이보다 적은 소스는 피드에서 직접 보충한다(초기 주차·한산한 소스). */
const MIN_PER_SOURCE = 5;
/** 소스당 프롬프트에 넣는 최대 헤드라인 수 — 특정 업종이 프롬프트를 독점하지 않게 한다. */
const MAX_PER_SOURCE = 15;
/** 전체 상한. 토큰과 비용을 예측 가능하게 묶어둔다. */
const MAX_TOTAL = 500;
/** Slack section 블록은 3000자 제한. 여유를 둔다. */
const CHUNK_CHARS = 2800;

const CHANNEL_LABEL: Record<string, string> = {
  industries: "산업군",
  commodities: "원자재",
  stocks: "개별 종목",
  "ai-news": "AI",
  default: "기술",
};

const SYSTEM_PROMPT = `너는 한 주간의 뉴스 헤드라인만 보고 시장 상황을 정리하는 애널리스트다.
Slack 메시지로 보낼 한국어 리포트를 작성한다.

형식:
- Slack mrkdwn 으로 쓴다: 굵게는 *별표 하나*, 목록은 "- ". 이중 별표(**)나 # 헤더는 쓰지 않는다.
- 구조는 다음 순서를 지킨다.
  1. *이번 주 한 줄* — 이번 주 시장을 규정한 흐름 한 문장.
  2. *움직인 이슈* — 3~5개. 각 이슈마다 "무슨 일 → 어떤 경로로 → 어느 산업에 영향" 인과 체인을 한두 줄로.
  3. *수혜 산업* / *피해 산업* — 각각 2~4개. 왜 그런지 한 줄씩.
  4. *전망* — 다음 주 이후 시나리오. 반드시 *반대 시나리오* 도 함께 적어 무엇이 틀릴 수 있는지 밝힌다.
  5. *다음 주 체크포인트* — 확인해야 할 지표·일정 3개 내외.

규칙:
- 모든 주장 끝에 근거 헤드라인 번호를 [12] 또는 [3][17] 형태로 붙인다. 번호 없는 주장은 쓰지 않는다.
- 헤드라인에 없는 사실을 지어내지 않는다. 수치는 헤드라인에 있는 것만 인용한다.
- 개별 종목의 매수·매도를 추천하지 않는다. 종목명은 헤드라인에 나온 사실을 전할 때만 언급한다.
- 근거가 얇은 판단은 "헤드라인 N건뿐이라 확신하기 이르다"처럼 한계를 밝힌다.
- 전체 60줄 이내. 장황한 수식 없이 건조하게.`;

interface Numbered extends ArchiveRecord {
  n: number;
}

/** 아카이브 + (얇은 소스는) 피드 보충으로 한 주치 헤드라인을 모은다. */
async function collect(now: Date): Promise<ArchiveRecord[]> {
  const archived = readRange(DAYS, now);
  const byId = new Map(archived.map((r) => [r.id, r]));
  const counts = new Map<string, number>();
  for (const r of archived) counts.set(r.src, (counts.get(r.src) ?? 0) + 1);

  const thin = loadSources().filter(
    (s) => s.type === "rss" && (counts.get(s.name) ?? 0) < MIN_PER_SOURCE,
  );
  if (thin.length) {
    console.log(`아카이브가 얇은 소스 ${thin.length}개 — 피드에서 보충`);
  }

  const cutoff = +now - DAYS * 86400000;
  for (const source of thin) {
    try {
      const items = await fetchFeed(feedUrl(source));
      for (const item of items) {
        if (byId.has(item.id)) continue;
        const published = new Date(item.published);
        if (isNaN(+published) || +published < cutoff) continue;
        byId.set(item.id, {
          id: item.id,
          src: source.name,
          ch: source.channel ?? "default",
          t: item.title,
          l: item.link,
          p: published.toISOString(),
        });
      }
    } catch (error) {
      console.warn(`[${source.name}] 보충 실패:`, error);
    }
  }
  return [...byId.values()].sort((a, b) => +new Date(b.p) - +new Date(a.p));
}

/** 소스당 상한을 적용하고 전체 상한까지 잘라 번호를 매긴다. */
function select(records: ArchiveRecord[]): Numbered[] {
  const perSource = new Map<string, number>();
  const kept: ArchiveRecord[] = [];
  for (const r of records) {
    const used = perSource.get(r.src) ?? 0;
    if (used >= MAX_PER_SOURCE) continue;
    perSource.set(r.src, used + 1);
    kept.push(r);
    if (kept.length >= MAX_TOTAL) break;
  }
  return kept.map((r, i) => ({ ...r, n: i + 1 }));
}

function buildPrompt(items: Numbered[], now: Date): string {
  const groups = new Map<string, Numbered[]>();
  for (const item of items) {
    const key = `${CHANNEL_LABEL[item.ch] ?? item.ch} / ${item.src}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const from = new Date(+now - DAYS * 86400000).toISOString().slice(0, 10);
  const lines = [
    `기간: ${from} ~ ${now.toISOString().slice(0, 10)} (헤드라인 ${items.length}건)`,
    "",
  ];
  for (const [key, group] of [...groups.entries()].sort()) {
    lines.push(`## ${key}`);
    for (const item of group) {
      lines.push(`[${item.n}] ${item.p.slice(5, 10)} ${item.t}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** LLM 이 쓴 [12] 를 실제 기사 링크로 바꾼다 — 링크를 프롬프트에 넣지 않고도 근거가 살아있게 한다. */
function linkCitations(text: string, items: Numbered[]): string {
  const byNumber = new Map(items.map((i) => [i.n, i]));
  return text.replace(/\[(\d+)\]/g, (whole, digits: string) => {
    const item = byNumber.get(Number(digits));
    return item ? `<${item.l}|[${digits}]>` : whole;
  });
}

/** Slack section 블록 한도에 맞춰 줄 단위로 자른다. */
function chunk(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if (buf.length + line.length + 1 > CHUNK_CHARS) {
      out.push(buf);
      buf = "";
    }
    buf += (buf ? "\n" : "") + line;
  }
  if (buf) out.push(buf);
  return out;
}

async function post(title: string, parts: string[]): Promise<void> {
  const raw = process.env.SLACK_WEBHOOK_WEEKLY;
  if (!raw) throw new Error("SLACK_WEBHOOK_WEEKLY 가 설정되지 않았습니다");
  const found = raw.match(
    /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/g,
  );
  if (!found) throw new Error("SLACK_WEBHOOK_WEEKLY 안에서 Slack Incoming Webhook URL을 찾지 못했습니다");
  const webhook = found[found.length - 1];

  for (const [index, part] of parts.entries()) {
    const blocks: unknown[] = [];
    if (index === 0) {
      blocks.push({ type: "header", text: { type: "plain_text", text: title } });
    }
    blocks.push({ type: "section", text: { type: "mrkdwn", text: part } });
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: title, blocks }),
    });
    if (!res.ok) {
      throw new Error(`Slack 전송 실패 (HTTP ${res.status}): ${await res.text()}`);
    }
  }
}

async function main() {
  const now = new Date();
  const records = await collect(now);
  const items = select(records);
  console.log(`수집 ${records.length}건 → 리포트에 사용 ${items.length}건`);
  if (items.length < 20) {
    throw new Error(`헤드라인이 ${items.length}건뿐이라 리포트를 만들지 않는다 (아카이브 축적 대기)`);
  }
  if (!hasApiKey()) throw new Error("GEMINI_API_KEY가 없어 주간 리포트를 만들 수 없습니다");

  const report = linkCitations(await generate(SYSTEM_PROMPT, buildPrompt(items, now), 16384), items);
  const title = `주간 리포트 — ${now.toISOString().slice(0, 10)} (헤드라인 ${items.length}건)`;

  if (process.env.DRY_RUN) {
    console.log(`\n===== [DRY_RUN] ${title} =====\n${report}\n`);
    return;
  }
  await post(title, chunk(report));
  console.log(`발송 완료: ${title}`);
}

await main();
