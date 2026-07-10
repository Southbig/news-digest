import Anthropic from "@anthropic-ai/sdk";
import type { FeedItem, SourceConfig } from "./types.js";

const MODEL = process.env.SUMMARY_MODEL ?? "claude-opus-4-8";
const MAX_CONTENT_CHARS = 20_000;

const SYSTEM_PROMPT = `너는 개발자를 위한 기술 소식 요약 봇이다. 릴리스 노트나 기술 뉴스 원문을 받아 Slack 메시지로 보낼 한국어 요약을 작성한다.

규칙:
- Slack mrkdwn 형식으로 작성한다: 굵게는 *별표 하나*, 목록은 "- ", 링크는 <url|텍스트>. 이중 별표(**)나 # 헤더는 사용하지 않는다.
- 릴리스 노트인 경우 다음 순서로 정리한다: *주요 변경*, *Breaking Changes*(있는 경우에만), *신기능*. 각 항목은 목록으로.
- 뉴스/블로그 글인 경우 핵심 내용을 3~5개 목록으로 정리한다.
- 전체 15줄 이내로 간결하게. 원문에 없는 내용을 지어내지 않는다.
- 요약 본문만 출력한다. 인사말이나 "요약:" 같은 머리말은 붙이지 않는다.`;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackSummary(item: FeedItem): string {
  const excerpt = stripHtml(item.content).slice(0, 500);
  return excerpt || "(본문 없음 — 링크에서 확인하세요)";
}

export async function summarize(
  source: SourceConfig,
  item: FeedItem,
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(`[${source.name}] ANTHROPIC_API_KEY가 없어 원문 발췌로 대체합니다`);
    return fallbackSummary(item);
  }

  const body = stripHtml(item.content).slice(0, MAX_CONTENT_CHARS);
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `소스: ${source.name}\n제목: ${item.title}\n\n원문:\n${body || "(본문 없음)"}`,
        },
      ],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock?.text.trim() || fallbackSummary(item);
  } catch (error) {
    console.warn(`[${source.name}] 요약 실패, 원문 발췌로 대체합니다:`, error);
    return fallbackSummary(item);
  }
}
