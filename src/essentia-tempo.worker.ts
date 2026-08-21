/// <reference lib="webworker" />

import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import type { EssentiaTempoEstimate } from "./essentia-tempo";

type TempoRequest = { id: number; samples: Float32Array };
type TempoResponse = { id: number; result?: EssentiaTempoEstimate; error?: string };

const essentia = new Essentia(EssentiaWASM);
const round = (value: number, precision = 1) => Number(value.toFixed(precision));

function tempoCandidates(primary: number) {
  return [...new Set([primary, primary / 2, primary * 2]
    .map(value => round(value))
    .filter(value => value >= 35 && value <= 200))];
}

function errorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  if (typeof reason === "number") return `Essentia gặp lỗi C++ nội bộ (mã ${reason}).`;
  return "Essentia không thể phân tích BPM.";
}

self.onmessage = (event: MessageEvent<TempoRequest>) => {
  const { id, samples } = event.data;
  let signal: { delete(): void } | undefined;
  try {
    signal = essentia.arrayToVector(samples);
    // RhythmExtractor2013/BeatTracker throws an opaque C++ exception in the
    // browser WASM build shipped by essentia.js 0.1.3. Percival is part of the
    // same Essentia WASM backend, supports an explicit sample rate, and runs
    // reliably in a module worker. The main thread provides phase-safe 44.1 kHz.
    const output = essentia.PercivalBpmEstimator(signal, 1024, 2048, 128, 128, 200, 35, 44100);
    const bpm = round(Number(output.bpm));
    if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("Essentia không tìm thấy nhịp ổn định.");
    const result: EssentiaTempoEstimate = {
      bpm,
      candidates: tempoCandidates(bpm),
      algorithm: "PercivalBpmEstimator",
    };
    self.postMessage({ id, result } satisfies TempoResponse);
  } catch (reason) {
    self.postMessage({ id, error: errorMessage(reason) } satisfies TempoResponse);
  } finally {
    signal?.delete();
  }
};
