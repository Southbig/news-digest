// Gemini 호출 한 군데. 요약(summarize)과 주간 리포트(weekly)가 공유한다.
// 시스템 프롬프트는 호출자가 넘긴다 — 용도마다 목소리가 다르다.

// "-latest" 별칭은 항상 최신 Flash 모델을 가리킴 — 모델 단종에 영향받지 않음
const MODEL = process.env.SUMMARY_MODEL ?? "gemini-flash-latest";

export function hasApiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** 과부하(503)·레이트리밋(429)·일시 오류(500)는 재시도한다. 주간 리포트는 주 1회라 한 번 실패가 곧 일주일 공백이다. */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generate(
  system: string,
  user: string,
  maxOutputTokens = 8192,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다");

  let lastError = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens },
        }),
      },
    );

    if (res.ok) {
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
    }

    lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
    const delay = RETRY_DELAYS_MS[attempt];
    if (!RETRY_STATUS.has(res.status) || delay === undefined) break;
    console.warn(`Gemini ${res.status} — ${delay / 1000}초 후 재시도 (${attempt + 1}/${RETRY_DELAYS_MS.length})`);
    await sleep(delay);
  }
  throw new Error(`Gemini API 오류 (${lastError})`);
}
