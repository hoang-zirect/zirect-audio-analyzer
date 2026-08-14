declare module "essentia.js/dist/essentia.js-core.es.js" {
  export default class Essentia {
    constructor(wasm: unknown, debug?: boolean);
    arrayToVector(input: Float32Array): { delete(): void };
    vectorToArray(input: unknown): Float32Array;
    RhythmExtractor2013(signal: unknown, maxTempo?: number, method?: string, minTempo?: number): {
      bpm: number;
      confidence: number;
      ticks?: { delete(): void };
      estimates?: { size(): number; delete(): void };
      bpmIntervals?: { delete(): void };
    };
  }
}

declare module "essentia.js/dist/essentia-wasm.es.js" {
  export const EssentiaWASM: unknown;
}
