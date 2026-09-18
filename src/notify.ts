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

// GitHub Actions는 시크릿 값을 ***로 마스킹하므로, 값이 깨졌을 때 fetch가 뱉는
// "Failed to parse URL from ***"로는 어느 시크릿이 문제인지 알 수 없다. 키 이름으로 알린다.
function assertWebhookUrl(key: string, url: string): string {
  const trimmed = url.trim();
  if (!trimmed.startsWith("https://hooks.slack.com/")) {
    throw new Error(
      `${key} 값이 Slack Incoming Webhook URL이 아닙니다. ` +
        `https://hooks.slack.com/services/... 형태여야 합니다 (curl 예시나 따옴표가 섞이지 않았는지 확인).`,
    );
  }
  return trimmed;
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
