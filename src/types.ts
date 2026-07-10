export interface SourceConfig {
  name: string;
  type: "github-release" | "rss";
  /** github-release: "owner/repo" */
  repo?: string;
  /** rss: 피드 URL */
  url?: string;
  /** Slack 웹훅 라우팅 키 (SLACK_WEBHOOK_<KEY>), 없으면 SLACK_WEBHOOK_URL */
  channel?: string;
  /** 한 번 실행에 보내는 최대 알림 수 (기본 3) — 뉴스처럼 잦은 소스의 도배 방지 */
  maxPerRun?: number;
}

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  published: string;
  content: string;
}
