import type { EvalResult } from "./giac-session";

export type WorkerRequest =
  | { type: "init"; url: string }
  | { type: "eval"; id: number; giac: string }
  | { type: "reset"; id: number };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "failed"; error: string }
  | { type: "result"; id: number; result: EvalResult };
