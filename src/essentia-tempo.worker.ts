/// <reference lib="webworker" />

import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
import type { EssentiaTempoEstimate } from "./essentia-tempo";

type TempoRequest = { id: number; samples: Float32Array };
type TempoResponse = { id: number; result?: EssentiaTempoEstimate; error?: string };

const essentia = new Essentia(EssentiaWASM);
const round = (value: number, precision = 1) => Number(value.toFixed(precision));

function vectorValues(vector?: { size(): number; delete(): void }) {
  if (!vector || vector.size() === 0) return [];
  return Array.from(essentia.vectorToArray(vector));
}

function tempoCandidates(values: number[], primary: number) {
  const groups = new Map<number, number>();
  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0) continue;
    const rounded = Math.round(value);
    groups.set(rounded, (groups.get(rounded) ?? 0) + 1);
  }
  const candidates = [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([bpm]) => bpm);
  return [...new Set([Math.round(primary), ...candidates])].filter(Boolean).slice(0, 3);
}

self.onmessage = (event: MessageEvent<TempoRequest>) => {
  const { id, samples } = event.data;
  let signal: { delete(): void } | undefined;
  let output: ReturnType<Essentia["RhythmExtractor2013"]> | undefined;
  try {
    signal = essentia.arrayToVector(samples);
    // RhythmExtractor2013 expects 44.1 kHz. The main thread resamples before
    // handing the phase-safe mono signal to this worker.
    output = essentia.RhythmExtractor2013(signal, 200, "multifeature", 35);
    const bpm = round(Number(output.bpm));
    if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("Essentia không tìm thấy nhịp ổn định.");
    const result: EssentiaTempoEstimate = {
      bpm,
      confidence: Number.isFinite(Number(output.confidence)) ? round(Number(output.confidence), 2) : undefined,
      candidates: tempoCandidates(vectorValues(output.estimates), bpm),
    };
    self.postMessage({ id, result } satisfies TempoResponse);
  } catch (reason) {
    self.postMessage({ id, error: reason instanceof Error ? reason.message : "Essentia không thể phân tích BPM." } satisfies TempoResponse);
  } finally {
    output?.ticks?.delete();
    output?.estimates?.delete();
    output?.bpmIntervals?.delete();
    signal?.delete();
  }
};
