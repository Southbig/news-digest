export interface SourceConfig {
  name: string;
  type: "github-release" | "rss";
  /** github-release: "owner/repo" */
  repo?: string;
  /** rss: 피드 URL */
  url?: string;
  /** Slack 웹훅 라우팅 키 (SLACK_WEBHOOK_<KEY>), 없으면 SLACK_WEBHOOK_URL */
  channel?: string;
}

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  published: string;
  content: string;
}
