# news-digest 작업 히스토리

> 2026-07-10 초기 구축. Claude Code와 함께 진행.

## 1. 기획

**목표**: 사용하는 기술 스택의 새 릴리스와 AI/주식 소식을 자동으로 감지 →
한국어 요약 → Slack으로 받아보기.

**핵심 결정들**:

| 결정 | 선택 | 이유 |
|---|---|---|
| 실행 환경 | GitHub Actions cron | 서버 불필요, public 레포 무료, 릴리스 알림은 실시간성이 중요하지 않음 |
| 저장소 구조 | 모노레포 (테마별 yml 분리) | 파이프라인(폴링→감지→요약→전송)이 모든 테마에 동일. 레포를 나누면 엔진 코드가 3벌 복제됨 |
| Slack 구조 | 워크스페이스 1개 + 채널 분리 | 워크스페이스 전환은 마찰이 커서 결국 안 보게 됨. 채널별 알림 설정으로 중요도 조절 |
| 상태 저장 | state.json을 레포에 커밋 | DB 없이 GitHub 저장소 자체를 상태 저장소로 사용. Actions 봇이 자동 커밋 |
| 정보 소스 | GitHub Releases Atom + RSS | 크롤링 불필요. 거의 모든 대상이 표준 피드 제공 |

**설계 원칙**:
1. 설정은 데이터로(yml/시크릿), 로직은 코드로 — 소스 추가에 코드 수정 불필요
2. 부분 실패를 전체 실패로 만들지 않기 — 소스별 격리, 요약 폴백, 전송 성공 후 상태 기록(at-least-once)
3. 인프라 최소화 — 서버 대신 cron, DB 대신 git, 봇 앱 대신 Incoming Webhook

## 2. 구축 (v1)

- TypeScript + tsx, 의존성 최소화 (fast-xml-parser, yaml)
- `src/feed.ts` — Atom/RSS 겸용 파서. XML 피드의 느슨한 표준 방어
  (단일 항목 → 배열 강제, 속성 있는 노드의 `#text` 추출, alternate 링크 선택)
- `src/main.ts` — 도배 방지 3종: 첫 구독 시 기준점만 등록(알림 없음),
  소스당 실행 1회 최대 3건, 전송 성공 지점까지만 state 기록
- `src/notify.ts` — Slack Block Kit. `channel: <key>` → `SLACK_WEBHOOK_<KEY>`
  시크릿으로 라우팅하는 관례(convention) 기반 채널 분기. Slack 하드리밋
  (header 150자, section 3000자) truncate
- `.github/workflows/check.yml` — cron `23 */3 * * *` (정각 혼잡 회피),
  workflow_dispatch(수동 실행), state.json 변경 시에만 자동 커밋

## 3. 트러블슈팅 기록

| 증상 | 원인 | 해결 |
|---|---|---|
| Actions 실패: `Invalid URL` | `SLACK_WEBHOOK_URL` 시크릿에 웹훅 URL이 아닌 값 입력 (App Configuration Token을 복사했었음) | 앱 → Incoming Webhooks에서 `https://hooks.slack.com/services/...` URL만 복사해 시크릿 교체 |
| 요약 대신 원문 발췌 전송 (1차) | Anthropic API 크레딧 잔액 없음 (`credit balance is too low`) | 요약 엔진을 Gemini 무료 티어로 전환 (아래 4번) |
| 요약 대신 원문 발췌 전송 (2차) | Gemini `gemini-2.5-flash` 모델이 신규 계정에 미제공 (404) | `gemini-flash-latest` 별칭으로 변경 — 항상 최신 Flash를 가리켜 모델 단종에 면역 |
| `git push` 거부 (non-fast-forward) | Actions 봇이 state.json을 원격에 커밋해서 로컬이 뒤처짐 | 로컬 작업 전 `git pull` 습관화. 충돌 시 rebase |
| Node 20 deprecation 경고 | actions/checkout, setup-node v4가 구버전 | v5로 업그레이드 |

**폴백 설계가 실전에서 검증됨**: 크레딧 부족/모델 404 동안에도 알림 자체는
원문 발췌로 계속 전송됐음. "요약은 부가 기능, 알림은 필수 기능" 원칙대로 동작.

## 4. Gemini 전환

- Anthropic API는 사용량 과금(크레딧 충전 필요) → 사용자가 Gemini 무료 티어 선택
- `src/summarize.ts`만 교체 (파이프라인 단계 분리 설계 덕에 다른 파일 무수정)
- Anthropic SDK 제거, Gemini REST API 직접 호출 (`x-goog-api-key` 헤더)
- 시크릿: `ANTHROPIC_API_KEY` → `GEMINI_API_KEY` (aistudio.google.com/apikey 무료 발급)
- 요약 프롬프트: Slack mrkdwn 강제(이중 별표 금지), 릴리스는
  *주요 변경 / Breaking Changes / 신기능* 구조, 할루시네이션 금지, 15줄 이내

## 5. 기술 스택 소스 확장

회사 프로젝트(hicare-rpm, hicare-rpm-tech-admin)의 package.json을 분석해
실제 사용 스택 기준으로 구독 목록 재구성:

- **추가**: Vite, MUI, MUI X, TanStack Query, Zustand, Jotai, React Router,
  React Hook Form, Zod, Biome, Vitest, Playwright, Sentry JS SDK
- **제거**: Next.js (미사용)
- **유지**: TypeScript, React, Node.js + AI 소식 (OpenAI News, DeepMind Blog)
- Anthropic 뉴스는 공식 RSS 부재로 미지원 (HTML 감시 fetcher 추가 시 가능)

## 6. 주식 테마 확장

- **채널 분리**: `#stock_news` + `SLACK_WEBHOOK_STOCKS` 시크릿
  (Incoming Webhook은 URL 1개 = 채널 1개)
- **소스**: Yahoo Finance RSS는 전 종목 404(서비스 종료) → **Google News 검색
  RSS** 채택 (`news.google.com/rss/search?q="종목명" 주가&hl=ko`)
- **종목**: 엔비디아, 알파벳, 유나이티드헬스 / SK하이닉스, KB금융
- **`maxPerRun` 옵션 신설**: 소스별 실행당 알림 수 제한. 주식은 2건
  (뉴스는 릴리스보다 훨씬 잦아서 도배 방지)
- 출처 표기: 메시지 헤더에 종목명, 기사 제목 끝에 언론사명 자동 포함

## 7. 현재 상태 (2026-07-10 기준)

- 구독: 기술 릴리스 17개 + AI 소식 2개 (#tech_news), 주식 5종목 (#stock_news)
- 주기: 3시간마다 자동 (cron), 수동 실행 가능 (Actions → Run workflow)
- 시크릿: `SLACK_WEBHOOK_URL`, `SLACK_WEBHOOK_STOCKS`, `GEMINI_API_KEY`
  (`SLACK_WEBHOOK_AI_NEWS`는 미등록 — ai-news 소스는 기본 웹훅으로 폴백 중)
- 요약: gemini-flash-latest, 실패 시 원문 발췌 폴백

## 8. 백로그 (추후 아이디어)

- [ ] **주식 다이제스트 모드** — 건별 알림 대신 하루 1~2회 종목별 뉴스 묶음 요약.
      주식 뉴스는 개별 기사가 유사해서 다이제스트가 더 적합할 가능성 높음
- [ ] **패치 버전 필터** (`minVersionBump: minor`) — TanStack Query, Vite 등
      패치 릴리스가 잦은 소스가 시끄러울 경우
- [ ] **Anthropic 뉴스** — RSS가 없어 HTML 페이지 감시 방식 fetcher 필요
- [ ] **헬스케어 테마** (`sources/healthcare.yml` + `#healthcare` 채널) —
      HIPAA/HHS 규제 공지 등. 회사 도메인 관련
- [ ] **보안 공지** — GitHub Security Advisories 기반, 사용 패키지 CVE 알림
- [ ] 커뮤니티 다이제스트 — HN/GeekNews 등 하루 1회 트렌드 요약
