// Runs Giac off the UI thread so a long computation never freezes typing,
// and so the app can cancel one by terminating this worker.
import { GiacSession } from "./giac-session";
import type { WorkerRequest, WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope & { Module?: any };

const post = (msg: WorkerResponse) => self.postMessage(msg);

let session: GiacSession | null = null;

async function load(url: string) {
  const printed: string[] = [];
  const ready = new Promise<void>((resolve) => {
    self.Module = {
      print: (s: string) => printed.push(s),
      printErr: () => {},
      onRuntimeInitialized: resolve,
    };
  });
  // giacwasm.js is a classic Emscripten script that expects a global
  // `Module`; module workers cannot importScripts(), so evaluate it in global
  // scope instead (indirect eval).
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the math engine (${res.status})`);
  (0, eval)(await res.text());
  await ready;
  session = new GiacSession(self.Module.cwrap("caseval", "string", ["string"]), () => printed.splice(0));
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "init") {
    try {
      await load(msg.url);
      post({ type: "ready" });
    } catch (err) {
      post({ type: "failed", error: String(err) });
    }
    return;
  }
  if (!session) {
    post({ type: "result", id: msg.id, result: { ok: false, error: "The math engine is not loaded" } });
    return;
  }
  try {
    if (msg.type === "eval") {
      post({ type: "result", id: msg.id, result: session.evaluate(msg.giac, msg.mode) });
    } else if (msg.type === "plot") {
      post({ type: "result", id: msg.id, result: session.plot(msg.giac) });
    } else if (msg.type === "features") {
      post({ type: "result", id: msg.id, result: session.features(msg.fn, msg.others, msg.a, msg.b) });
    } else if (msg.type === "run") {
      post({ type: "result", id: msg.id, result: session.run(msg.giac) });
    } else if (msg.type === "sample") {
      post({ type: "result", id: msg.id, result: session.sample(msg.fn, msg.a, msg.b, msg.n) });
    } else if (msg.type === "options") {
      session.configure(msg.options);
      post({ type: "result", id: msg.id, result: { ok: true, latex: "", approxLatex: null } });
    } else {
      session.reset();
      post({ type: "result", id: msg.id, result: { ok: true, latex: "", approxLatex: null } });
    }
  } catch (err) {
    // Emscripten aborts (e.g. out of memory) surface as exceptions.
    post({ type: "result", id: msg.id, result: { ok: false, error: `Engine error: ${err}` } });
  }
};
