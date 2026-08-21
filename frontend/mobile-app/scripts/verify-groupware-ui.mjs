import fs from "node:fs";

const source = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const required = [
  "홈",
  "메일",
  "결재",
  "메신저",
  "일정",
  "주소록",
  "AI 채팅",
  "ScreenKey",
  "연결 서버",
  "LLM Provider",
  "개인 LLM API 키",
  "CEREBRAS",
  "GROQ",
  "MISTRAL",
  "OPENAI",
  "UPSTAGE",
  "GEMINI",
  "OPENROUTER",
  "ANTHROPIC",
  "OLLAMA",
];

const missing = required.filter((value) => !source.includes(value));
if (missing.length > 0) {
  throw new Error(`Missing mobile groupware UI contract: ${missing.join(", ")}`);
}

console.log("mobile groupware UI contract: PASS");
