import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { SourceConfig } from "./types.js";

const SOURCES_DIR = "sources";

export function loadSources(): SourceConfig[] {
  const files = fs
    .readdirSync(SOURCES_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

  const sources: SourceConfig[] = [];
  for (const file of files) {
    const doc = parse(fs.readFileSync(path.join(SOURCES_DIR, file), "utf8"));
    for (const source of doc?.sources ?? []) {
      if (!source.name || !source.type) {
        throw new Error(`${file}: name 또는 type이 없는 소스가 있습니다`);
      }
      if (source.type === "github-release" && !source.repo) {
        throw new Error(`${file}: "${source.name}" 소스에 repo가 필요합니다`);
      }
      if (source.type === "rss" && !source.url) {
        throw new Error(`${file}: "${source.name}" 소스에 url이 필요합니다`);
      }
      sources.push(source);
    }
  }
  return sources;
}
