import type { AnswerMode, EvalResult, SessionOptions } from "./giac-session";

export type WorkerRequest =
  | { type: "init"; url: string }
  | { type: "eval"; id: number; giac: string; mode?: AnswerMode }
  | { type: "reset"; id: number }
  | { type: "options"; id: number; options: Partial<SessionOptions> };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "failed"; error: string }
  | { type: "result"; id: number; result: EvalResult };
