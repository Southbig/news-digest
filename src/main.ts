import { loadSources } from "./config.js";
import { loadState, saveState } from "./state.js";
import { feedUrl, fetchFeed } from "./feed.js";
import { summarize } from "./summarize.js";
import { notify } from "./notify.js";
import { appendItems } from "./archive.js";

// 한 소스당 한 번에 보내는 최대 알림 수 (피드 롤오버/장기 미실행 시 도배 방지)
const MAX_NEW_PER_SOURCE = 3;

async function main() {
  const sources = loadSources();
  const state = loadState();
  let failed = false;
  // 이번 실행에서 이미 보낸 항목 id — 같은 기사가 여러 피드의 최신 1위로 동시에 걸릴 때만 쓰인다.
  // 실행 단위로만 유지한다(디스크 저장 없음): 교차 중복은 한 실행 안에서 발생하고,
  // 다음 실행에서는 각 소스의 state 기준점이 이미 그 기사를 지나가 있다.
  const sentIds = new Set<string>();
  // 주간 리포트용 누적 — 발송 여부와 무관하게 수집한 헤드라인을 전부 쌓는다
  const archived = { added: 0, dateEstimated: 0 };

  for (const source of sources) {
    try {
      const items = await fetchFeed(feedUrl(source));
      if (items.length === 0) {
        console.log(`[${source.name}] 피드에 항목이 없습니다`);
        continue;
      }

      const stats = appendItems(source, items);
      archived.added += stats.added;
      archived.dateEstimated += stats.dateEstimated;

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
        // 건너뛸 때도 기준점은 전진시킨다 — 그러지 않으면 이 항목이 영원히 "최신 미처리"로 남아
        // 해당 소스가 조용히 멈춘다.
        if (sentIds.has(item.id)) {
          console.log(`[${source.name}] 중복 건너뜀 (다른 소스가 이미 발송): ${item.title}`);
          state[source.name] = item.id;
          continue;
        }
        console.log(`[${source.name}] 새 소식: ${item.title}`);
        const summary = await summarize(source, item);
        await notify(source, item, summary);
        sentIds.add(item.id);
        state[source.name] = item.id;
      }
    } catch (error) {
      failed = true;
      console.error(`[${source.name}] 처리 실패:`, error);
    }
  }

  saveState(state);
  console.log(`아카이브 적재 ${archived.added}건` +
    (archived.dateEstimated ? ` (발행일 파싱 실패 ${archived.dateEstimated}건 — 수집 시각으로 대체)` : ""));
  if (failed) process.exitCode = 1;
}

await main();
