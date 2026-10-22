import type { EvalResult } from "./giac-session";
import type { WorkerRequest, WorkerResponse } from "./protocol";

export type EngineStatus = "loading" | "ready" | "busy" | "failed";

type Pending = { resolve: (r: EvalResult) => void };

/**
 * Client for the Giac worker. Requests run one at a time in order. cancel()
 * kills the worker mid-computation and starts a fresh one, which loses every
 * variable the user defined; listeners hear about it through onRestart.
 */
export class Engine {
  status: EngineStatus = "loading";
  error: string | null = null;
  onStatus: (status: EngineStatus) => void = () => {};
  onRestart: () => void = () => {};

  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private ready!: Promise<void>;

  constructor(private giacUrl: string) {
    this.start();
  }

  private start() {
    this.worker = new Worker(new URL("./giac.worker.ts", import.meta.url), { type: "module" });
    this.setStatus("loading");
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.type === "ready") {
          this.setStatus("ready");
          resolve();
        } else if (msg.type === "failed") {
          this.error = msg.error;
          this.setStatus("failed");
          reject(new Error(msg.error));
        } else {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (this.pending.size === 0) this.setStatus("ready");
          p?.resolve(msg.result);
        }
      };
    });
    this.ready.catch(() => {});
    this.send({ type: "init", url: this.giacUrl });
  }

  private send(msg: WorkerRequest) {
    this.worker.postMessage(msg);
  }

  private setStatus(status: EngineStatus) {
    this.status = status;
    this.onStatus(status);
  }

  private request(msg: { type: "eval"; giac: string } | { type: "reset" }): Promise<EvalResult> {
    return this.ready.then(
      () =>
        new Promise<EvalResult>((resolve) => {
          const id = this.nextId++;
          this.pending.set(id, { resolve });
          this.setStatus("busy");
          this.send({ ...msg, id });
        }),
      () => ({ ok: false, error: this.error ?? "The math engine failed to load" }),
    );
  }

  evaluate(giac: string): Promise<EvalResult> {
    return this.request({ type: "eval", giac });
  }

  async reset(): Promise<void> {
    await this.request({ type: "reset" });
  }

  get isBusy() {
    return this.pending.size > 0;
  }

  cancel() {
    if (!this.isBusy) return;
    this.worker.terminate();
    for (const p of this.pending.values()) p.resolve({ ok: false, error: "Cancelled" });
    this.pending.clear();
    this.start();
    this.onRestart();
  }
}
