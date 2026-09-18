// Gemini 호출 한 군데. 요약(summarize)과 주간 리포트(weekly)가 공유한다.
// 시스템 프롬프트는 호출자가 넘긴다 — 용도마다 목소리가 다르다.

// "-latest" 별칭은 항상 최신 Flash 모델을 가리킴 — 모델 단종에 영향받지 않음
const MODEL = process.env.SUMMARY_MODEL ?? "gemini-flash-latest";

export function hasApiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function generate(
  system: string,
  user: string,
  maxOutputTokens = 8192,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다");

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
  if (!res.ok) {
    throw new Error(`Gemini API 오류 (HTTP ${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}
