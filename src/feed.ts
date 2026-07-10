import { XMLParser } from "fast-xml-parser";
import type { FeedItem, SourceConfig } from "./types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

// 속성이 있는 노드는 파서가 객체({ "#text": ... })로 만들기 때문에 양쪽 다 처리
function text(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)["#text"]);
  }
  return "";
}

export function feedUrl(source: SourceConfig): string {
  if (source.type === "github-release") {
    return `https://github.com/${source.repo}/releases.atom`;
  }
  return source.url!;
}

/** Atom / RSS 2.0 피드를 파싱해 최신순 항목 목록을 반환 */
export async function fetchFeed(url: string): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: { "user-agent": "news-digest (github.com/Southbig/news-digest)" },
  });
  if (!res.ok) throw new Error(`피드 요청 실패 (HTTP ${res.status}): ${url}`);
  const doc = parser.parse(await res.text());

  // Atom (GitHub Releases 등)
  if (doc.feed) {
    return asArray<any>(doc.feed.entry).map((entry) => {
      const links = asArray<any>(entry.link);
      const alt = links.find((l) => l["@_rel"] === "alternate") ?? links[0];
      const href = alt?.["@_href"] ?? "";
      return {
        id: text(entry.id) || href,
        title: text(entry.title),
        link: href,
        published: text(entry.updated) || text(entry.published),
        content: text(entry.content) || text(entry.summary),
      };
    });
  }

  // RSS 2.0 (블로그/뉴스 대부분)
  if (doc.rss) {
    return asArray<any>(doc.rss.channel?.item).map((item) => ({
      id: text(item.guid) || text(item.link),
      title: text(item.title),
      link: text(item.link),
      published: text(item.pubDate),
      content: text(item["content:encoded"]) || text(item.description),
    }));
  }

  throw new Error(`알 수 없는 피드 형식: ${url}`);
}
