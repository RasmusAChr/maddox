import type { AngleMode, AnswerMode, EvalResult, Feature, PlotResult, SessionOptions } from "./giac-session";
import type { WorkerRequest, WorkerResponse } from "./protocol";

type Request = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

export type EngineStatus = "loading" | "ready" | "busy" | "failed";

// Each request resolves with its own kind of result (EvalResult, PlotResult, samples).
type Pending = { resolve: (r: any) => void; background: boolean };

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
  private options: Partial<SessionOptions> = {};

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
          if (!this.isBusy && this.status === "busy") this.setStatus("ready");
          p?.resolve(msg.result);
        }
      };
    });
    this.ready.catch(() => {});
    this.send({ type: "init", url: this.giacUrl });
    // A restarted worker (after cancel) starts with defaults: restore ours.
    if (Object.keys(this.options).length) void this.configure(this.options);
  }

  private send(msg: WorkerRequest) {
    this.worker.postMessage(msg);
  }

  private setStatus(status: EngineStatus) {
    this.status = status;
    this.onStatus(status);
  }

  /** background: graph sampling, which shows no "busy" and which Esc does not cancel. */
  private request<T = EvalResult>(msg: Request, background = false): Promise<T> {
    return this.ready.then(
      () =>
        new Promise<T>((resolve) => {
          const id = this.nextId++;
          this.pending.set(id, { resolve, background });
          if (!background) this.setStatus("busy");
          this.send({ ...msg, id } as WorkerRequest);
        }),
      () => ({ ok: false, error: this.error ?? "The math engine failed to load" }) as T,
    );
  }

  /** `mode` overrides the answer mode for this one input. */
  evaluate(giac: string, mode?: AnswerMode): Promise<EvalResult> {
    return this.request({ type: "eval", giac, mode });
  }

  /** What plot(…) draws; functions are then sampled per view with sample(). */
  plot(giac: string, sliders?: Record<string, string>): Promise<PlotResult> {
    return this.request<PlotResult>({ type: "plot", giac, sliders });
  }

  /** Zeros, extrema, y-intercept and intersections of a curve between a and b (in the background). */
  async features(fn: string, others: string[], a: number, b: number): Promise<Feature[]> {
    const found = await this.request<Feature[] | EvalResult>({ type: "features", fn, others, a, b }, true);
    return Array.isArray(found) ? found : [];
  }

  /** In graphs, an undefined name like ax read as a·x (see GiacSession.splitUnknown). */
  async splitUnknown(giac: string, keep: string[] = []): Promise<string> {
    const out = await this.request<string | EvalResult>({ type: "split", giac, keep }, true);
    return typeof out === "string" ? out : giac;
  }

  /** A definition (or purge) for the graph panel's own names: no answer, no ans. */
  run(giac: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.request<{ ok: true } | { ok: false; error: string }>({ type: "run", giac }, true);
  }

  /** A function's values at n+1 evenly spaced x; empty if the engine restarted meanwhile. */
  async sample(fn: string, a: number, b: number, n: number): Promise<number[]> {
    const values = await this.request<number[] | EvalResult>({ type: "sample", fn, a, b, n }, true);
    return Array.isArray(values) ? values : [];
  }

  async reset(): Promise<void> {
    await this.request({ type: "reset" });
  }

  /** Angle mode, solve style, digits; kept across resets and cancels. */
  async configure(options: Partial<SessionOptions>): Promise<void> {
    this.options = { ...this.options, ...options };
    await this.request({ type: "options", options });
  }

  setAngle(mode: AngleMode): Promise<void> {
    return this.configure({ angle: mode });
  }

  /** Working on something the user asked for (not graph sampling). */
  get isBusy() {
    return [...this.pending.values()].some((p) => !p.background);
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
