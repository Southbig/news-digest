# news-digest

기술 스택 릴리스와 AI 소식을 감지해서 Gemini로 요약한 뒤 Slack으로 보내주는 알림 봇.
GitHub Actions cron으로 3시간마다 자동 실행됩니다. 별도 서버 없음.

## 동작 방식

```
GitHub Actions (cron)
  → sources/*.yml의 피드 폴링 (GitHub Releases Atom, 블로그 RSS)
  → state.json과 비교해 새 항목 감지
  → Gemini API로 한국어 요약 (버전, 주요 변경, Breaking Changes, 신기능)
  → Slack Incoming Webhook으로 전송
  → 갱신된 state.json을 커밋
```

## 설정 방법

### 1. Slack Incoming Webhook 만들기

1. https://api.slack.com/apps → **Create New App** → From scratch
2. **Incoming Webhooks** 활성화 → **Add New Webhook to Workspace** → 채널 선택
3. 발급된 `https://hooks.slack.com/services/...` URL 복사

채널을 나누고 싶으면 채널마다 웹훅을 하나씩 만들면 됩니다.

### 2. GitHub 레포 Secrets 등록

레포 → Settings → Secrets and variables → Actions → **New repository secret**

| Secret | 필수 | 설명 |
|---|---|---|
| `SLACK_WEBHOOK_URL` | ✅ | 기본 웹훅 (모든 소스의 폴백) |
| `GEMINI_API_KEY` | 권장 | Gemini 요약용 (https://aistudio.google.com/apikey 무료 발급). 없으면 원문 발췌만 전송됨 |
| `SLACK_WEBHOOK_AI_NEWS` | 선택 | `channel: ai-news` 소스 전용 웹훅 |

### 3. 첫 실행

레포 → Actions → **Check for updates** → **Run workflow**로 수동 실행.
첫 실행은 각 소스의 현재 최신 항목을 기준점으로 기록만 하고 알림은 보내지 않습니다.
이후 실행부터 새로 올라온 소식만 알림이 옵니다.

## 소스 추가/삭제

`sources/tech.yml`에 항목을 추가하면 끝입니다. 코드 수정 불필요.

```yaml
sources:
  # GitHub Releases 감시
  - name: Vite
    type: github-release
    repo: vitejs/vite

  # 블로그/뉴스 RSS·Atom 감시
  - name: V8 Blog
    type: rss
    url: https://v8.dev/blog.atom
    channel: ai-news   # (선택) SLACK_WEBHOOK_AI_NEWS로 라우팅
```

테마를 나누고 싶으면 `sources/stocks.yml`, `sources/healthcare.yml`처럼 파일을
추가하면 됩니다 — `sources/` 아래의 모든 `.yml`을 읽습니다.

`channel` 키를 새로 만들면 대응하는 시크릿(`SLACK_WEBHOOK_<대문자_키>`)을 등록하고,
`.github/workflows/check.yml`의 `env:`에도 한 줄 추가해야 합니다.

## 로컬 테스트

```bash
npm install
cp .env.example .env   # 값 채우기 (없어도 DRY_RUN은 동작)
DRY_RUN=1 npx tsx src/main.ts
```

`DRY_RUN=1`이면 Slack에 보내지 않고 콘솔에 출력합니다.

## 구조

```
├── sources/tech.yml        # 구독 소스 목록 (설정)
├── state.json              # 소스별 마지막 처리 항목 (Actions가 자동 커밋)
├── src/
│   ├── main.ts             # 오케스트레이션
│   ├── feed.ts             # Atom/RSS 파싱
│   ├── summarize.ts        # Gemini 요약
│   ├── notify.ts           # Slack 전송
│   ├── config.ts           # sources/*.yml 로드
│   └── state.ts            # state.json 읽기/쓰기
└── .github/workflows/check.yml
```
