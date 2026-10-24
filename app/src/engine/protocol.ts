import type { AnswerMode, EvalResult, PlotResult, SessionOptions } from "./giac-session";

export type WorkerRequest =
  | { type: "init"; url: string }
  | { type: "eval"; id: number; giac: string; mode?: AnswerMode }
  | { type: "reset"; id: number }
  | { type: "options"; id: number; options: Partial<SessionOptions> }
  | { type: "plot"; id: number; giac: string }
  | { type: "run"; id: number; giac: string }
  | { type: "sample"; id: number; fn: string; a: number; b: number; n: number };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "failed"; error: string }
  | { type: "result"; id: number; result: EvalResult | PlotResult | number[] | { ok: true } };
