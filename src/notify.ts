import type { FeedItem, SourceConfig } from "./types.js";

// channel: ai-news → SLACK_WEBHOOK_AI_NEWS, 없으면 SLACK_WEBHOOK_URL로 폴백
function webhookFor(source: SourceConfig): string | undefined {
  if (source.channel) {
    const key = `SLACK_WEBHOOK_${source.channel.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    if (process.env[key]) return process.env[key];
  }
  return process.env.SLACK_WEBHOOK_URL;
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

  const webhook = webhookFor(source);
  if (!webhook) throw new Error("SLACK_WEBHOOK_URL이 설정되지 않았습니다");

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
