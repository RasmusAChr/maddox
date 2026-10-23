import type { AngleMode, EvalResult } from "./giac-session";

export type WorkerRequest =
  | { type: "init"; url: string }
  | { type: "eval"; id: number; giac: string }
  | { type: "reset"; id: number }
  | { type: "angle"; id: number; mode: AngleMode };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "failed"; error: string }
  | { type: "result"; id: number; result: EvalResult };
