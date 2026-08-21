import { readFileSync, readdirSync } from "node:fs";

const workerName = readdirSync("dist/assets").find(name => name.startsWith("essentia-tempo.worker-"));
if (!workerName) throw new Error("Run npm run build before the Essentia runtime smoke test.");

const originalGlobals = Object.fromEntries(
  ["process", "self", "postMessage", "importScripts", "location", "onmessage"].map(key => [key, globalThis[key]]),
);
const messages = [];

try {
  // Execute the production worker bundle in a browser-like worker global. This
  // catches failures that type checks and unit tests cannot see inside WASM.
  globalThis.process = undefined;
  globalThis.self = globalThis;
  globalThis.location = { href: `http://localhost/assets/${workerName}` };
  globalThis.importScripts = () => {};
  globalThis.postMessage = message => messages.push(message);
  new Function(readFileSync(`dist/assets/${workerName}`, "utf8"))();

  if (typeof globalThis.onmessage !== "function") throw new Error("The Essentia worker did not initialize.");

  const sampleRate = 44100;
  const duration = 30;
  const tempo = 55;
  const samples = new Float32Array(sampleRate * duration);
  for (let beat = 0; beat < duration; beat += 60 / tempo) {
    const start = Math.round(beat * sampleRate);
    for (let index = 0; index < 2205 && start + index < samples.length; index++) {
      const envelope = Math.exp(-index / 500);
      samples[start + index] += Math.sin(2 * Math.PI * 220 * index / sampleRate) * envelope;
    }
  }

  globalThis.onmessage({ data: { id: 1, samples } });
  const response = messages.find(message => message?.id === 1);
  if (!response?.result || !Number.isFinite(response.result.bpm)) {
    throw new Error(`Essentia worker failed: ${response?.error ?? "no response"}`);
  }
  if (response.result.algorithm !== "PercivalBpmEstimator") {
    throw new Error(`Unexpected Essentia algorithm: ${response.result.algorithm ?? "missing"}`);
  }
  console.log(`Essentia worker OK: ${response.result.bpm} BPM via ${response.result.algorithm}`);
} finally {
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
}
