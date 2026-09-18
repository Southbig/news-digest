import type { FeedItem, SourceConfig } from "./types.js";

// channel: ai-news → SLACK_WEBHOOK_AI_NEWS, 없으면 SLACK_WEBHOOK_URL로 폴백
function webhookFor(source: SourceConfig): { key: string; url: string } | undefined {
  if (source.channel) {
    const key = `SLACK_WEBHOOK_${source.channel.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    const url = process.env[key];
    if (url) return { key, url };
  }
  const url = process.env.SLACK_WEBHOOK_URL;
  return url ? { key: "SLACK_WEBHOOK_URL", url } : undefined;
}

// services/ 뒤의 세 덩어리까지 명시한다. 느슨하게 잡으면 URL 이 두 번 겹쳐 붙은 값에서
// 앞쪽의 깨진 조각("...services/https")을 URL 로 착각한다.
const WEBHOOK_PATTERN = /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/g;

// 시크릿에 curl 예시나 따옴표가 섞여 들어오는 사고가 잦다. URL만 추출해 쓴다.
// GitHub Actions는 시크릿 값을 ***로 마스킹하므로 값 자체는 절대 로그에 남기지 않고,
// 실패 시 어느 키인지와 값의 "형태"만 알려 원인을 좁힌다.
function assertWebhookUrl(key: string, raw: string): string {
  // 겹쳐 붙은 값에서는 뒤쪽이 온전한 URL 이다
  const found = raw.match(WEBHOOK_PATTERN);
  if (found) return found[found.length - 1];

  const shape = [
    `길이 ${raw.length}`,
    `공백 ${/\s/.test(raw) ? "있음" : "없음"}`,
    `줄바꿈 ${raw.includes("\n") ? "있음" : "없음"}`,
    `따옴표 ${/["'`]/.test(raw) ? "있음" : "없음"}`,
    `시작 ${raw.trimStart().slice(0, 8).replace(/[^\x20-\x7e]/g, "?") || "(빈 값)"}`,
  ].join(" · ");
  throw new Error(
    `${key} 안에서 Slack Incoming Webhook URL을 찾지 못했습니다. ` +
      `https://hooks.slack.com/services/... 형태가 포함돼야 합니다. [값 형태: ${shape}]`,
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export async function notify(
  source: SourceConfig,
  item: FeedItem,
  summary: string,
): Promise<void> {
  const title = truncate(`${source.name} — ${item.title}`, 150);

  if (process.env.DRY_RUN) {
    console.log(`\n===== [DRY_RUN] ${title} =====\n${summary}\n(${item.link})\n`);
    return;
  }

  const target = webhookFor(source);
  if (!target) throw new Error("SLACK_WEBHOOK_URL이 설정되지 않았습니다");
  const webhook = assertWebhookUrl(target.key, target.url);

  const payload = {
    text: title, // 푸시 알림 미리보기용 폴백 텍스트
    blocks: [
      { type: "header", text: { type: "plain_text", text: title } },
      { type: "section", text: { type: "mrkdwn", text: truncate(summary, 3000) } },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `<${item.link}|원문 보기>${item.published ? ` · ${item.published}` : ""}`,
          },
        ],
      },
    ],
  };

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Slack 전송 실패 (HTTP ${res.status}): ${await res.text()}`);
  }
}
