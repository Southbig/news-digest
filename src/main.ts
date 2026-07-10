import { loadSources } from "./config.js";
import { loadState, saveState } from "./state.js";
import { feedUrl, fetchFeed } from "./feed.js";
import { summarize } from "./summarize.js";
import { notify } from "./notify.js";

// 한 소스당 한 번에 보내는 최대 알림 수 (피드 롤오버/장기 미실행 시 도배 방지)
const MAX_NEW_PER_SOURCE = 3;

async function main() {
  const sources = loadSources();
  const state = loadState();
  let failed = false;

  for (const source of sources) {
    try {
      const items = await fetchFeed(feedUrl(source));
      if (items.length === 0) {
        console.log(`[${source.name}] 피드에 항목이 없습니다`);
        continue;
      }

      const lastSeen = state[source.name];
      if (!lastSeen) {
        // 첫 구독: 과거 항목을 도배하지 않도록 기준점만 기록
        state[source.name] = items[0].id;
        console.log(`[${source.name}] 구독 시작 — 기준점 등록: ${items[0].title}`);
        continue;
      }

      const idx = items.findIndex((item) => item.id === lastSeen);
      const newItems = (idx === -1 ? items : items.slice(0, idx)).slice(
        0,
        source.maxPerRun ?? MAX_NEW_PER_SOURCE,
      );

      if (newItems.length === 0) {
        console.log(`[${source.name}] 새 소식 없음`);
        continue;
      }

      // 오래된 것부터 순서대로 전송; 전송에 성공한 지점까지만 state에 기록
      for (const item of newItems.reverse()) {
        console.log(`[${source.name}] 새 소식: ${item.title}`);
        const summary = await summarize(source, item);
        await notify(source, item, summary);
        state[source.name] = item.id;
      }
    } catch (error) {
      failed = true;
      console.error(`[${source.name}] 처리 실패:`, error);
    }
  }

  saveState(state);
  if (failed) process.exitCode = 1;
}

await main();
