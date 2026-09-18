import fs from "node:fs";
import path from "node:path";
import type { FeedItem, SourceConfig } from "./types.js";

const ARCHIVE_DIR = "archive";
/** 적재 대상: 발행 N일 이내. 검색 RSS는 관련도 순이라 수년 전 기사가 섞여 들어온다. */
const MAX_AGE_DAYS = 3;
/** 한 소스가 한 번에 적재할 수 있는 최대 건수 — 피드 롤오버 시 파일이 튀는 것을 막는다. */
const MAX_PER_SOURCE = 50;

/** 주간 리포트가 읽는 한 줄 = 기사 하나. 키를 짧게 둬 파일 크기를 줄인다. */
export interface ArchiveRecord {
  id: string;
  src: string;
  ch: string;
  t: string;
  l: string;
  p: string;
  /** published 파싱 실패로 수집 시각을 대신 기록한 경우 */
  pEst?: true;
}

export interface AppendStats {
  added: number;
  duplicate: number;
  tooOld: number;
  dateEstimated: number;
}

/** ISO 주차 키 (2026-W38). 목요일이 속한 해를 기준으로 삼는 ISO-8601 규칙. */
export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function filePath(key: string): string {
  return path.join(ARCHIVE_DIR, `${key}.jsonl`);
}

/** 현재 주 파일의 id 집합 — 중복 적재 방지용. 실행 중 한 번만 읽는다. */
let seenIds: Set<string> | null = null;
let seenKey = "";

function loadSeen(key: string): Set<string> {
  if (seenIds && seenKey === key) return seenIds;
  const ids = new Set<string>();
  const file = filePath(key);
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try {
        ids.add((JSON.parse(line) as ArchiveRecord).id);
      } catch {
        // 손상된 줄은 건너뛴다 — 중복 한 건이 다시 적재될 뿐 치명적이지 않다
      }
    }
  }
  seenIds = ids;
  seenKey = key;
  return ids;
}

/** 피드에서 받은 항목을 이번 주 파일에 누적한다. 발송 여부와 무관하게 전부 적재한다. */
export function appendItems(source: SourceConfig, items: FeedItem[], now = new Date()): AppendStats {
  const key = weekKey(now);
  const seen = loadSeen(key);
  const cutoff = +now - MAX_AGE_DAYS * 86400000;
  const stats: AppendStats = { added: 0, duplicate: 0, tooOld: 0, dateEstimated: 0 };
  const lines: string[] = [];

  for (const item of items) {
    if (stats.added >= MAX_PER_SOURCE) break;
    if (seen.has(item.id)) {
      stats.duplicate++;
      continue;
    }

    const parsed = new Date(item.published);
    const valid = !isNaN(+parsed);
    // 파싱 실패 시 수집 시각으로 대체한다. 버리면 날짜 형식이 바뀐 피드가 조용히 사라진다.
    const published = valid ? parsed : now;
    if (!valid) stats.dateEstimated++;
    if (+published < cutoff) {
      stats.tooOld++;
      continue;
    }

    const record: ArchiveRecord = {
      id: item.id,
      src: source.name,
      ch: source.channel ?? "default",
      t: item.title,
      l: item.link,
      p: published.toISOString(),
      ...(valid ? {} : { pEst: true as const }),
    };
    lines.push(JSON.stringify(record));
    seen.add(item.id);
    stats.added++;
  }

  if (lines.length) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    fs.appendFileSync(filePath(key), lines.join("\n") + "\n");
  }
  return stats;
}

/** 최근 N일치 기사. 주 경계를 걸치므로 이번 주와 지난주 파일을 모두 읽는다. */
export function readRange(days: number, now = new Date()): ArchiveRecord[] {
  const prev = new Date(+now - 7 * 86400000);
  const keys = [...new Set([weekKey(prev), weekKey(now)])];
  const cutoff = +now - days * 86400000;
  const out: ArchiveRecord[] = [];

  for (const key of keys) {
    const file = filePath(key);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const record = JSON.parse(line) as ArchiveRecord;
        if (+new Date(record.p) >= cutoff) out.push(record);
      } catch {
        // 손상된 줄 무시
      }
    }
  }
  return out.sort((a, b) => +new Date(b.p) - +new Date(a.p));
}
