// Gemini 호출 한 군데. 요약(summarize)과 주간 리포트(weekly)가 공유한다.
// 시스템 프롬프트는 호출자가 넘긴다 — 용도마다 목소리가 다르다.

// "-latest" 별칭은 항상 최신 모델을 가리킴 — 모델 단종에 영향받지 않음.
// 앞 모델이 과부하(503)로 계속 거절하면 다음 모델로 넘어간다. 붐비는 시간대가 모델마다 다르다.
const MODELS = [process.env.SUMMARY_MODEL ?? "gemini-flash-latest", "gemini-flash-lite-latest"];

export function hasApiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** 과부하(503)·레이트리밋(429)·일시 오류(500)는 재시도한다. */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
/** 기사 요약은 건당 호출이라 짧게, 주간 리포트는 주 1회라 길게 기다린다. */
const RETRY_DELAYS_MS = {
  short: [5_000, 15_000],
  long: [10_000, 30_000, 60_000, 120_000],
} as const;

export interface GenerateOptions {
  maxOutputTokens?: number;
  /** long: 주간 리포트처럼 실패 비용이 큰 호출 (기본 short) */
  patience?: keyof typeof RETRY_DELAYS_MS;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callModel(
  model: string,
  apiKey: string,
  system: string,
  user: string,
  maxOutputTokens: number,
): Promise<{ ok: true; text: string } | { ok: false; status: number; detail: string }> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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
  if (!res.ok) {
    return { ok: false, status: res.status, detail: (await res.text()).slice(0, 300) };
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return {
    ok: true,
    text: (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim(),
  };
}

export async function generate(
  system: string,
  user: string,
  options: GenerateOptions = {},
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다");
  const maxOutputTokens = options.maxOutputTokens ?? 8192;
  const delays = RETRY_DELAYS_MS[options.patience ?? "short"];

  let lastError = "";
  for (const model of MODELS) {
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      const result = await callModel(model, apiKey, system, user, maxOutputTokens);
      if (result.ok) return result.text;

      lastError = `${model} HTTP ${result.status}: ${result.detail}`;
      if (!RETRY_STATUS.has(result.status)) return Promise.reject(new Error(`Gemini API 오류 (${lastError})`));
      const delay = delays[attempt];
      if (delay === undefined) break; // 이 모델은 포기하고 다음 모델로
      console.warn(`Gemini ${result.status} (${model}) — ${delay / 1000}초 후 재시도 (${attempt + 1}/${delays.length})`);
      await sleep(delay);
    }
    if (model !== MODELS[MODELS.length - 1]) console.warn(`${model} 과부하 지속 — 다음 모델로 전환`);
  }
  throw new Error(`Gemini API 오류 (${lastError})`);
}
