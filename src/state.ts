import fs from "node:fs";

const STATE_FILE = "state.json";

/** 소스 이름 → 마지막으로 처리한 피드 항목 id */
export type State = Record<string, string>;

export function loadState(): State {
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

export function saveState(state: State): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}
