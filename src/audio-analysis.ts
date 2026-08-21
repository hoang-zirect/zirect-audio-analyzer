export type BandKey = "sub" | "bass" | "lowMid" | "mid" | "upperMid" | "air";

export type Impact = "Low" | "Medium" | "High";
export type Confidence = "Low" | "Medium" | "High";
export type EvidenceSource = "Measurement" | "Inference";
export type AnalysisSection = "Stereo & Spatial Image" | "EQ & Tonal Balance" | "Melody & Motif" | "Arrangement & Reverb" | "Loudness & Dynamics" | "File Quality";

export const BAND_DEFINITIONS: Array<{ key: BandKey; label: string; range: string; from: number; to: number }> = [
  { key: "sub", label: "Sub-bass", range: "20–80 Hz", from: 20, to: 80 },
  { key: "bass", label: "Bass", range: "80–250 Hz", from: 80, to: 250 },
  { key: "lowMid", label: "Low-mid", range: "250–500 Hz", from: 250, to: 500 },
  { key: "mid", label: "Mid", range: "500 Hz–2 kHz", from: 500, to: 2000 },
  { key: "upperMid", label: "Upper-mid", range: "2–4 kHz", from: 2000, to: 4000 },
  { key: "air", label: "Brilliance / Air", range: "4–20 kHz", from: 4000, to: 20000 },
];

export type BandMeasurement = {
  leftDb: number;
  rightDb: number;
  meanDb: number;
  correlation: number;
  widthPercent: number;
};

export type SpectrumPoint = {
  frequency: number;
  leftDb: number;
  rightDb: number;
};

export type SpectrumFrame = {
  time: number;
  bands: Record<BandKey, number>;
};

export type SuddenEvent = {
  time: number;
  jumpDb: number;
  levelDb: number;
};

export type AudioMetrics = {
  meta: {
    name: string;
    extension: string;
    mime: string;
    sizeBytes: number;
    duration: number;
    channels: number;
    analysisSampleRate: number;
    sourceSampleRate?: number;
    sourceBitDepth?: number;
    bitrateKbps: number;
    codecWarning?: string;
    comparableHighHz: number;
  };
  loudness: {
    integratedLufs: number;
    lraLu: number;
    rmsDbfs: number;
    samplePeakDbfs: number;
    truePeakDbtp: number;
    crestFactorDb: number;
  };
  stereo: {
    correlation: number;
    widthPercent: number;
    balanceDb: number;
    monoRetentionDb: number;
    polarityRisk: boolean;
  };
  spectral: {
    bands: Record<BandKey, BandMeasurement>;
    curve: SpectrumPoint[];
    timeline: SpectrumFrame[];
    resonances: Array<{ frequency: number; prominenceDb: number }>;
  };
  motion: {
    onsetProxyPerMinute: number;
    suddenEvents: SuddenEvent[];
    introFadeDb: number;
    outroEndDb: number;
    outroTailDb: number;
    outroCutRisk: boolean;
  };
};

export type BandComparison = {
  key: BandKey;
  label: string;
  range: string;
  deltaDb: number;
  leftDeltaDb: number;
  rightDeltaDb: number;
  comparableToHz: number;
  timestamp: string;
};

export type Finding = {
  id: string;
  title: string;
  section: AnalysisSection;
  impact: Impact;
  confidence: Confidence;
  source: EvidenceSource;
  timestamp: string;
  evidence: string;
  recommendation: string;
  positive?: boolean;
  feedbackVi?: {
    title: string;
    recommendation: string;
  };
};

export type PairAnalysis = {
  demo: AudioMetrics;
  reference: AudioMetrics;
  loudnessMatch: {
    originalDeltaDb: number;
    targetLufs: number;
    demoGainDb: number;
    referenceGainDb: number;
  };
  bands: BandComparison[];
  findings: Finding[];
  referenceWarnings: Finding[];
  strengths: string[];
  threeBiggestDifferences: string[];
  keepElements: string[];
  releaseVerdict: "Not Ready for Release" | "Revisions Recommended Before Release" | "Ready After Final Listening Check";
  qualityScore: number;
  feedback: {
    good: string[];
    priority: string[];
    supplemental: string[];
    goal: string;
    fullText: string;
  };
};

export type ProgressCallback = (progress: number, label: string) => void;

const EPSILON = 1e-15;
const ANALYSIS_RATE = 48000;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const toDb = (value: number) => 10 * Math.log10(Math.max(value, EPSILON));
const amplitudeToDb = (value: number) => 20 * Math.log10(Math.max(value, 1e-10));
const round = (value: number, places = 1) => Number(value.toFixed(places));
const signed = (value: number, places = 1) => `${value >= 0 ? "+" : ""}${value.toFixed(places)}`;
const waitForMainThread = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Analysis cancelled.", "AbortError");
};

export const formatTimestamp = (seconds: number) => {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = String(safe % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
};

class Biquad {
  private z1 = 0;
  private z2 = 0;

  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  process(input: number) {
    const output = this.b0 * input + this.z1;
    this.z1 = this.b1 * input - this.a1 * output + this.z2;
    this.z2 = this.b2 * input - this.a2 * output;
    return output;
  }
}

class MidBandEnvelope {
  private previousInput = 0;
  private highPassState = 0;
  private lowPassState = 0;
  private readonly highPassAlpha: number;
  private readonly lowPassAlpha: number;

  constructor(sampleRate: number) {
    const dt = 1 / sampleRate;
    const hpRc = 1 / (2 * Math.PI * 500);
    const lpRc = 1 / (2 * Math.PI * 4000);
    this.highPassAlpha = hpRc / (hpRc + dt);
    this.lowPassAlpha = dt / (lpRc + dt);
  }

  process(input: number) {
    this.highPassState = this.highPassAlpha * (this.highPassState + input - this.previousInput);
    this.previousInput = input;
    this.lowPassState += this.lowPassAlpha * (this.highPassState - this.lowPassState);
    return this.lowPassState;
  }
}

function createKWeightingChain() {
  return [
    new Biquad(1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585),
    new Biquad(1, -2, 1, -1.99004745483398, 0.99007225036621),
  ];
}

function kWeightSample(chain: Biquad[], value: number) {
  return chain[1].process(chain[0].process(value));
}

function gatedLoudness(blocks: number[]) {
  const absolute = blocks.filter((energy) => -0.691 + toDb(energy) > -70);
  if (!absolute.length) return -70;
  const absoluteMean = absolute.reduce((sum, value) => sum + value, 0) / absolute.length;
  const relativeGateLufs = -0.691 + toDb(absoluteMean) - 10;
  const gate = Math.max(-70, relativeGateLufs);
  const gated = absolute.filter((energy) => -0.691 + toDb(energy) > gate);
  const mean = gated.reduce((sum, value) => sum + value, 0) / Math.max(1, gated.length);
  return clamp(-0.691 + toDb(mean), -70, 5);
}

function percentile(sorted: number[], proportion: number) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * proportion;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function loudnessRange(shortBlocks: number[]) {
  const absolute = shortBlocks
    .map((energy) => ({ energy, lufs: -0.691 + toDb(energy) }))
    .filter((block) => block.lufs > -70);
  if (absolute.length < 2) return 0;
  const mean = absolute.reduce((sum, block) => sum + block.energy, 0) / absolute.length;
  const gate = Math.max(-70, -0.691 + toDb(mean) - 20);
  const retained = absolute.map((block) => block.lufs).filter((value) => value > gate).sort((a, b) => a - b);
  return Math.max(0, percentile(retained, 0.95) - percentile(retained, 0.1));
}

async function estimateTruePeak(channels: Float32Array[], samplePeak: number, signal?: AbortSignal) {
  let peak = samplePeak;
  const threshold = samplePeak * 0.62;
  const chunk = 1_500_000;
  for (const data of channels) {
    for (let start = 1; start < data.length - 2; start += chunk) {
      throwIfAborted(signal);
      const end = Math.min(data.length - 2, start + chunk);
      for (let index = start; index < end; index += 1) {
        const p1 = data[index];
        const p2 = data[index + 1];
        if (Math.max(Math.abs(p1), Math.abs(p2)) < threshold) continue;
        const p0 = data[index - 1];
        const p3 = data[index + 2];
        for (const t of [0.25, 0.5, 0.75]) {
          const t2 = t * t;
          const t3 = t2 * t;
          const interpolated = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
          peak = Math.max(peak, Math.abs(interpolated));
        }
      }
      await waitForMainThread();
      throwIfAborted(signal);
    }
  }
  return peak;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

async function measureCore(buffer: AudioBuffer, onProgress: (fraction: number) => void, signal?: AbortSignal) {
  const sampleRate = buffer.sampleRate;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const channels = right ? [left, right] : [left];
  const leftK = createKWeightingChain();
  const rightK = right ? createKWeightingChain() : null;
  const midEnvelope = new MidBandEnvelope(sampleRate);

  const momentarySize = Math.round(sampleRate * 0.4);
  const momentaryStep = Math.round(sampleRate * 0.1);
  const shortSize = Math.round(sampleRate * 3);
  const shortStep = Math.round(sampleRate);
  const envelopeSize = Math.round(sampleRate * 0.1);
  const momentaryRing = new Float64Array(momentarySize);
  const shortRing = new Float64Array(shortSize);
  let momentarySum = 0;
  let shortSum = 0;
  const momentaryBlocks: number[] = [];
  const shortBlocks: number[] = [];
  const envelopes: Array<{ time: number; energy: number; midEnergy: number; peak: number }> = [];

  let sumLeft = 0;
  let sumRight = 0;
  let sumCross = 0;
  let sumMid = 0;
  let sumSide = 0;
  let samplePeak = 0;
  let envEnergy = 0;
  let envMidEnergy = 0;
  let envPeak = 0;
  let envCount = 0;
  const chunk = 750_000;

  for (let start = 0; start < left.length; start += chunk) {
    throwIfAborted(signal);
    const end = Math.min(left.length, start + chunk);
    for (let index = start; index < end; index += 1) {
      const l = left[index];
      const r = right ? right[index] : 0;
      samplePeak = Math.max(samplePeak, Math.abs(l), Math.abs(r));
      sumLeft += l * l;
      if (right) {
        sumRight += r * r;
        sumCross += l * r;
        const mid = (l + r) * 0.5;
        const side = (l - r) * 0.5;
        sumMid += mid * mid;
        sumSide += side * side;
      }

      const weightedL = kWeightSample(leftK, l);
      const weightedR = right && rightK ? kWeightSample(rightK, r) : 0;
      const weightedEnergy = weightedL * weightedL + weightedR * weightedR;

      const momentaryIndex = index % momentarySize;
      momentarySum += weightedEnergy - momentaryRing[momentaryIndex];
      momentaryRing[momentaryIndex] = weightedEnergy;
      if (index >= momentarySize - 1 && (index - momentarySize + 1) % momentaryStep === 0) {
        momentaryBlocks.push(momentarySum / momentarySize);
      }

      const shortIndex = index % shortSize;
      shortSum += weightedEnergy - shortRing[shortIndex];
      shortRing[shortIndex] = weightedEnergy;
      if (index >= shortSize - 1 && (index - shortSize + 1) % shortStep === 0) {
        shortBlocks.push(shortSum / shortSize);
      }

      const mono = right ? (l + r) * 0.5 : l;
      const midBand = midEnvelope.process(mono);
      envEnergy += mono * mono;
      envMidEnergy += midBand * midBand;
      envPeak = Math.max(envPeak, Math.abs(mono));
      envCount += 1;
      if (envCount === envelopeSize || index === left.length - 1) {
        envelopes.push({
          time: index / sampleRate,
          energy: envEnergy / envCount,
          midEnergy: envMidEnergy / envCount,
          peak: envPeak,
        });
        envEnergy = 0;
        envMidEnergy = 0;
        envPeak = 0;
        envCount = 0;
      }
    }
    onProgress(end / left.length * 0.72);
    await waitForMainThread();
    throwIfAborted(signal);
  }

  const truePeak = await estimateTruePeak(channels, samplePeak, signal);
  onProgress(0.88);

  const integratedLufs = gatedLoudness(momentaryBlocks);
  const lraLu = loudnessRange(shortBlocks);
  const totalSamples = left.length * channels.length;
  const rawEnergy = (sumLeft + (right ? sumRight : 0)) / Math.max(1, totalSamples);
  const rmsDbfs = toDb(rawEnergy);
  const samplePeakDbfs = amplitudeToDb(samplePeak);
  const truePeakDbtp = amplitudeToDb(truePeak);
  const correlation = right ? clamp(sumCross / Math.sqrt(Math.max(EPSILON, sumLeft * sumRight)), -1, 1) : 1;
  const balanceDb = right ? toDb(sumLeft / Math.max(EPSILON, sumRight)) : 0;
  const averageChannelEnergy = right ? (sumLeft + sumRight) * 0.5 : sumLeft;
  const monoRetentionDb = right ? toDb(sumMid / Math.max(EPSILON, averageChannelEnergy)) : 0;
  const widthPercent = right ? clamp(100 * Math.sqrt(sumSide / Math.max(EPSILON, sumMid)), 0, 300) : 0;

  const envelopeDb = envelopes.map((point) => toDb(point.energy));
  const midDb = envelopes.map((point) => toDb(point.midEnergy));
  const suddenEvents: SuddenEvent[] = [];
  let onsetCount = 0;
  for (let index = 3; index < envelopes.length - 1; index += 1) {
    const previous = median(envelopeDb.slice(Math.max(0, index - 10), index));
    const midPrevious = median(midDb.slice(Math.max(0, index - 8), index));
    const jump = envelopeDb[index] - previous;
    if (jump > 5 && envelopeDb[index] > -45 && envelopeDb[index] >= envelopeDb[index + 1] - 0.5) {
      suddenEvents.push({ time: envelopes[index].time, jumpDb: jump, levelDb: envelopeDb[index] });
    }
    if (midDb[index] - midPrevious > 2.5 && midDb[index] > -58 && midDb[index] >= midDb[index + 1] - 0.4) {
      onsetCount += 1;
    }
  }
  suddenEvents.sort((a, b) => b.jumpDb - a.jumpDb);
  const durationMinutes = Math.max(buffer.duration / 60, 0.1);
  const firstWindow = envelopeDb.slice(0, Math.min(envelopeDb.length, 5));
  const settledWindow = envelopeDb.slice(Math.min(envelopeDb.length, 30), Math.min(envelopeDb.length, 55));
  const introFadeDb = median(settledWindow) - median(firstWindow);
  const tailPoints = Math.min(envelopes.length, 50);
  const tailEnergy = envelopes.slice(-tailPoints).reduce((sum, point) => sum + point.energy, 0) / Math.max(1, tailPoints);
  const outroEndDb = envelopeDb.at(-1) ?? -100;
  const outroTailDb = toDb(tailEnergy);
  const finalPeakDb = amplitudeToDb(envelopes.at(-1)?.peak ?? 0);
  const outroCutRisk = outroEndDb > -48 || (outroEndDb > -58 && finalPeakDb > -42);
  onProgress(1);

  return {
    loudness: {
      integratedLufs: round(integratedLufs),
      lraLu: round(lraLu),
      rmsDbfs: round(rmsDbfs),
      samplePeakDbfs: round(samplePeakDbfs),
      truePeakDbtp: round(truePeakDbtp),
      crestFactorDb: round(truePeakDbtp - rmsDbfs),
    },
    stereo: {
      correlation: round(correlation, 2),
      widthPercent: round(widthPercent),
      balanceDb: round(balanceDb, 2),
      monoRetentionDb: round(monoRetentionDb),
      polarityRisk: Boolean(right && correlation < -0.15 && monoRetentionDb < -5),
    },
    motion: {
      onsetProxyPerMinute: round(onsetCount / durationMinutes),
      suddenEvents: suddenEvents.slice(0, 8).map((event) => ({ ...event, jumpDb: round(event.jumpDb), levelDb: round(event.levelDb) })),
      introFadeDb: round(introFadeDb),
      outroEndDb: round(outroEndDb),
      outroTailDb: round(outroTailDb),
      outroCutRisk,
    },
  };
}

function fft(real: Float64Array, imaginary: Float64Array) {
  const size = real.length;
  let j = 0;
  for (let i = 1; i < size; i += 1) {
    let bit = size >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const wLengthReal = Math.cos(angle);
    const wLengthImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let wReal = 1;
      let wImaginary = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd] * wReal - imaginary[odd] * wImaginary;
        const oddImaginary = real[odd] * wImaginary + imaginary[odd] * wReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = wReal * wLengthReal - wImaginary * wLengthImaginary;
        wImaginary = wReal * wLengthImaginary + wImaginary * wLengthReal;
        wReal = nextReal;
      }
    }
  }
}

async function analyzeSpectrum(buffer: AudioBuffer, onProgress: (fraction: number) => void, signal?: AbortSignal) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const sampleRate = buffer.sampleRate;
  const fftSize = 4096;
  const bins = fftSize / 2 + 1;
  const frameCount = Math.min(220, Math.max(28, Math.floor(buffer.duration / 1.25)));
  const leftPower = new Float64Array(bins);
  const rightPower = new Float64Array(bins);
  const crossPower = new Float64Array(bins);
  const frames: SpectrumFrame[] = [];
  const scale = 1 / (fftSize * fftSize);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    throwIfAborted(signal);
    const maxStart = Math.max(0, left.length - fftSize);
    const start = frameCount === 1 ? 0 : Math.round(maxStart * frameIndex / (frameCount - 1));
    const realL = new Float64Array(fftSize);
    const imaginaryL = new Float64Array(fftSize);
    const realR = new Float64Array(fftSize);
    const imaginaryR = new Float64Array(fftSize);
    for (let index = 0; index < fftSize; index += 1) {
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (fftSize - 1));
      realL[index] = (left[start + index] ?? 0) * window;
      realR[index] = (right[start + index] ?? 0) * window;
    }
    fft(realL, imaginaryL);
    fft(realR, imaginaryR);

    const frameBandPower = Object.fromEntries(BAND_DEFINITIONS.map((band) => [band.key, 0])) as Record<BandKey, number>;
    for (let bin = 1; bin < bins; bin += 1) {
      const frequency = bin * sampleRate / fftSize;
      const powerL = (realL[bin] ** 2 + imaginaryL[bin] ** 2) * scale;
      const powerR = (realR[bin] ** 2 + imaginaryR[bin] ** 2) * scale;
      const cross = (realL[bin] * realR[bin] + imaginaryL[bin] * imaginaryR[bin]) * scale;
      leftPower[bin] += powerL;
      rightPower[bin] += powerR;
      crossPower[bin] += cross;
      const band = BAND_DEFINITIONS.find((candidate) => frequency >= candidate.from && frequency < candidate.to);
      if (band) frameBandPower[band.key] += (powerL + powerR) * 0.5;
    }
    frames.push({
      time: (start + fftSize / 2) / sampleRate,
      bands: Object.fromEntries(BAND_DEFINITIONS.map((band) => [band.key, toDb(frameBandPower[band.key])])) as Record<BandKey, number>,
    });
    if (frameIndex % 8 === 0) {
      onProgress((frameIndex + 1) / frameCount);
      await waitForMainThread();
      throwIfAborted(signal);
    }
  }

  const bands = {} as Record<BandKey, BandMeasurement>;
  for (const band of BAND_DEFINITIONS) {
    let powerL = 0;
    let powerR = 0;
    let cross = 0;
    for (let bin = 1; bin < bins; bin += 1) {
      const frequency = bin * sampleRate / fftSize;
      if (frequency < band.from || frequency >= band.to) continue;
      powerL += leftPower[bin] / frameCount;
      powerR += rightPower[bin] / frameCount;
      cross += crossPower[bin] / frameCount;
    }
    const midPower = Math.max(EPSILON, (powerL + powerR + 2 * cross) * 0.25);
    const sidePower = Math.max(0, (powerL + powerR - 2 * cross) * 0.25);
    bands[band.key] = {
      leftDb: round(toDb(powerL)),
      rightDb: round(toDb(powerR)),
      meanDb: round(toDb((powerL + powerR) * 0.5)),
      correlation: round(clamp(cross / Math.sqrt(Math.max(EPSILON, powerL * powerR)), -1, 1), 2),
      widthPercent: round(clamp(100 * Math.sqrt(sidePower / midPower), 0, 300)),
    };
  }

  const curve: SpectrumPoint[] = [];
  const pointCount = 72;
  for (let index = 0; index < pointCount; index += 1) {
    const frequency = 20 * (20000 / 20) ** (index / (pointCount - 1));
    const lower = index === 0 ? 20 : Math.sqrt(frequency * (20 * (20000 / 20) ** ((index - 1) / (pointCount - 1))));
    const upper = index === pointCount - 1 ? 20000 : Math.sqrt(frequency * (20 * (20000 / 20) ** ((index + 1) / (pointCount - 1))));
    let sumL = 0;
    let sumR = 0;
    let count = 0;
    for (let bin = Math.max(1, Math.floor(lower * fftSize / sampleRate)); bin <= Math.min(bins - 1, Math.ceil(upper * fftSize / sampleRate)); bin += 1) {
      sumL += leftPower[bin] / frameCount;
      sumR += rightPower[bin] / frameCount;
      count += 1;
    }
    curve.push({ frequency: round(frequency, 0), leftDb: round(toDb(sumL / Math.max(1, count))), rightDb: round(toDb(sumR / Math.max(1, count))) });
  }

  const resonances: Array<{ frequency: number; prominenceDb: number }> = [];
  const meanCurve = curve.map((point) => (point.leftDb + point.rightDb) * 0.5);
  for (let index = 2; index < curve.length - 2; index += 1) {
    const local = (meanCurve[index - 2] + meanCurve[index - 1] + meanCurve[index + 1] + meanCurve[index + 2]) * 0.25;
    const prominence = meanCurve[index] - local;
    if (prominence > 3.2) resonances.push({ frequency: curve[index].frequency, prominenceDb: round(prominence) });
  }
  resonances.sort((a, b) => b.prominenceDb - a.prominenceDb);
  onProgress(1);
  return { bands, curve, timeline: frames, resonances: resonances.slice(0, 5) };
}

async function parseSourceHeader(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 96).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const chunk = ascii(offset, 4);
      const length = view.getUint32(offset + 4, true);
      if (chunk === "fmt " && offset + 16 < bytes.length) {
        return { sourceSampleRate: view.getUint32(offset + 12, true), sourceBitDepth: view.getUint16(offset + 22, true) };
      }
      offset += 8 + length + (length % 2);
    }
  }
  if (ascii(0, 4) === "fLaC" && bytes.length >= 26) {
    const sourceSampleRate = (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4);
    const sourceBitDepth = (((bytes[20] & 1) << 4) | (bytes[21] >> 4)) + 1;
    return { sourceSampleRate, sourceBitDepth };
  }
  return {};
}

function codecAssessment(file: File, duration: number) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "unknown";
  const bitrateKbps = file.size * 8 / Math.max(0.1, duration) / 1000;
  const lossy = ["mp3", "m4a", "aac", "ogg", "opus"].includes(extension);
  let comparableHighHz = 20000;
  let codecWarning: string | undefined;
  if (lossy && bitrateKbps < 72) comparableHighHz = 12000;
  else if (lossy && bitrateKbps < 104) comparableHighHz = 15000;
  else if (lossy && bitrateKbps < 145) comparableHighHz = 16500;
  else if (lossy && bitrateKbps < 200) comparableHighHz = 19000;
  if (lossy && bitrateKbps < 104) {
    codecWarning = `${extension.toUpperCase()} file at approximately ${Math.round(bitrateKbps)} kbps; do not draw air-band conclusions above approximately ${(comparableHighHz / 1000).toFixed(0)} kHz.`;
  }
  return { extension, bitrateKbps: round(bitrateKbps, 0), comparableHighHz, codecWarning };
}

async function analyzeSingle(file: File, onProgress: (fraction: number, label: string) => void, signal?: AbortSignal) {
  const context = new AudioContext({ sampleRate: ANALYSIS_RATE });
  try {
    throwIfAborted(signal);
    onProgress(0.02, "Decoding Audio");
    const sourceHeader = await parseSourceHeader(file);
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    throwIfAborted(signal);
    onProgress(0.12, "Measuring Loudness and Dynamics");
    const core = await measureCore(buffer, (fraction) => onProgress(0.12 + fraction * 0.48, "Measuring LUFS, True Peak, and Phase"), signal);
    onProgress(0.61, "Analyzing Per-Channel Spectrum");
    const spectral = await analyzeSpectrum(buffer, (fraction) => onProgress(0.61 + fraction * 0.37, "Measuring L/R Spectrum and Band Stereo"), signal);
    const codec = codecAssessment(file, buffer.duration);
    onProgress(1, "Track Analysis Complete");
    return {
      meta: {
        name: file.name,
        extension: codec.extension,
        mime: file.type || "audio/unknown",
        sizeBytes: file.size,
        duration: buffer.duration,
        channels: buffer.numberOfChannels,
        analysisSampleRate: buffer.sampleRate,
        ...sourceHeader,
        bitrateKbps: codec.bitrateKbps,
        codecWarning: codec.codecWarning,
        comparableHighHz: codec.comparableHighHz,
      },
      ...core,
      spectral,
    } satisfies AudioMetrics;
  } finally {
    await context.close();
  }
}

function findBandTimestamp(demo: AudioMetrics, reference: AudioMetrics, key: BandKey, demoGain: number, referenceGain: number, expectedSign: number) {
  const demoFrames = demo.spectral.timeline;
  const referenceFrames = reference.spectral.timeline;
  if (!demoFrames.length || !referenceFrames.length) return "Full Track";
  let best = { score: -Infinity, time: demo.meta.duration * 0.5 };
  demoFrames.forEach((frame, index) => {
    const progress = demoFrames.length === 1 ? 0 : index / (demoFrames.length - 1);
    const referenceIndex = Math.round(progress * (referenceFrames.length - 1));
    const delta = frame.bands[key] + demoGain - (referenceFrames[referenceIndex].bands[key] + referenceGain);
    const score = expectedSign >= 0 ? delta : -delta;
    if (score > best.score) best = { score, time: frame.time };
  });
  const radius = Math.max(2, demo.meta.duration / Math.max(20, demoFrames.length) * 1.5);
  return `${formatTimestamp(Math.max(0, best.time - radius))}–${formatTimestamp(Math.min(demo.meta.duration, best.time + radius))}`;
}

function impactFromDelta(delta: number): Impact {
  const magnitude = Math.abs(delta);
  if (magnitude >= 3) return "High";
  if (magnitude >= 1.7) return "Medium";
  return "Low";
}

function bandRecommendation(key: BandKey, delta: number) {
  const excessive = delta > 0;
  const magnitude = Math.abs(delta) >= 3 ? "2–3 dB" : "1–2 dB";
  const recommendations: Record<BandKey, { source: string; excess: string; deficit: string; excessVi: string; deficitVi: string }> = {
    sub: {
      source: "the sub, drone, or low pad layer",
      excess: `Check the sub/bass bus first and try ${magnitude} of dynamic EQ reduction at 30–80 Hz. Keep content below approximately 80–100 Hz mono; do not narrow the entire master.`,
      deficit: `Check the bass or drone fundamental and try a very gentle ${magnitude} low shelf on the appropriate source instead of lifting the full master. Keep the sub stable in the center.`,
      excessVi: `Kiểm tra sub/bass bus trước, thử dynamic EQ giảm ${magnitude} trong 30–80 Hz. Giữ vùng dưới khoảng 80–100 Hz ở mono; không thu hẹp toàn bộ master.`,
      deficitVi: `Kiểm tra fundamental của bass/drone, thử low-shelf rất nhẹ ${magnitude} trên nguồn phù hợp thay vì nâng toàn master. Giữ sub ổn định ở giữa.`,
    },
    bass: {
      source: "the bass, pad body, or low-end reverb",
      excess: `Check the bass and pad buses. Try ${magnitude} of dynamic EQ reduction at 90–220 Hz, or light sidechain control when the piano and pad overlap.`,
      deficit: `Try adding ${magnitude} of body at 100–220 Hz on the pad, bass track, or bus. Avoid boosting if the mono signal is already congested.`,
      excessVi: `Kiểm tra bass và pad bus, thử dynamic EQ giảm ${magnitude} trong 90–220 Hz hoặc sidechain nhẹ khi piano/pad cùng hoạt động.`,
      deficitVi: `Thử bổ sung thân cho pad/bass ${magnitude} trong 100–220 Hz trên track hoặc bus; tránh boost nếu mono đã bị tích tụ.`,
    },
    lowMid: {
      source: "the pad body, piano, or reverb tail",
      excess: `Check the pad bus and reverb return. Try ${magnitude} of dynamic EQ reduction around 280–420 Hz, with a gentle reverb high-pass if needed to control buildup.`,
      deficit: `Try a very broad ${magnitude} lift around 280–450 Hz on the pad or piano bus for warmth, while avoiding congestion on the master.`,
      excessVi: `Kiểm tra pad bus và reverb return, thử dynamic EQ giảm ${magnitude} quanh 280–420 Hz. Có thể high-pass reverb nhẹ để tránh tích tụ.`,
      deficitVi: `Thử tăng rất rộng ${magnitude} quanh 280–450 Hz trên pad/piano bus để có thêm độ ấm; tránh làm master bị bí.`,
    },
    mid: {
      source: "the piano, motif, or pad harmonics",
      excess: `Move the piano or motif back slightly, or apply a broad ${magnitude} cut at 700 Hz–1.8 kHz on the prominent source. Prefer automation over master processing.`,
      deficit: `Try adding harmonics or a broad ${magnitude} lift at 700 Hz–1.8 kHz on the piano or pad so the melody does not feel thin.`,
      excessVi: `Đưa piano/motif lùi nhẹ hoặc giảm EQ rộng ${magnitude} trong 700 Hz–1.8 kHz trên nguồn gây nổi; ưu tiên automation hơn ép master.`,
      deficitVi: `Thử tăng harmonic hoặc EQ rộng ${magnitude} trong 700 Hz–1.8 kHz trên piano/pad để melody không bị mỏng.`,
    },
    upperMid: {
      source: "the piano attack, bell, or bright texture",
      excess: `Use dynamic EQ on the piano or texture for ${magnitude} of reduction at 2–4 kHz when notes hit. Lower velocity or soften the attack if it still feels sharp.`,
      deficit: `If the melody sits too far back, try a very gentle ${magnitude} lift at 2–3.5 kHz on the melody track instead of raising the full master.`,
      excessVi: `Dùng dynamic EQ trên piano/texture giảm ${magnitude} trong 2–4 kHz khi note đánh vào; hạ velocity/attack nếu âm vẫn sắc.`,
      deficitVi: `Nếu melody bị lùi quá sâu, thử tăng rất nhẹ ${magnitude} trong 2–3.5 kHz trên track melody, không cần nâng cả master.`,
    },
    air: {
      source: "the texture, ambience, reverb, or noise layer",
      excess: `Try a ${magnitude} high-shelf reduction from 7–10 kHz on the texture or reverb, or high-cut the reverb to reduce long-term listening fatigue.`,
      deficit: `Try opening the ambience or reverb with a ${magnitude} high shelf from 8–10 kHz, or add a very subtle texture. Do not boost above the codec cutoff.`,
      excessVi: `Thử high-shelf giảm ${magnitude} từ 7–10 kHz trên texture/reverb hoặc high-cut reverb để tránh chói khi nghe lâu.`,
      deficitVi: `Thử mở high-shelf ${magnitude} từ 8–10 kHz trên ambience/reverb, hoặc thêm texture rất nhẹ; không boost vùng codec đã cắt.`,
    },
  };
  const item = recommendations[key];
  return {
    likelySource: item.source,
    action: excessive ? item.excess : item.deficit,
    actionVi: excessive ? item.excessVi : item.deficitVi,
  };
}

export function buildPairAnalysis(demo: AudioMetrics, reference: AudioMetrics): PairAnalysis {
  const originalDeltaDb = demo.loudness.integratedLufs - reference.loudness.integratedLufs;
  const targetLufs = Math.min(demo.loudness.integratedLufs, reference.loudness.integratedLufs);
  const demoGainDb = targetLufs - demo.loudness.integratedLufs;
  const referenceGainDb = targetLufs - reference.loudness.integratedLufs;
  const comparableHighHz = Math.min(demo.meta.comparableHighHz, reference.meta.comparableHighHz);

  const bands: BandComparison[] = BAND_DEFINITIONS.map((definition) => {
    const demoBand = demo.spectral.bands[definition.key];
    const referenceBand = reference.spectral.bands[definition.key];
    const deltaDb = demoBand.meanDb + demoGainDb - referenceBand.meanDb - referenceGainDb;
    return {
      key: definition.key,
      label: definition.label,
      range: definition.range,
      deltaDb: round(deltaDb),
      leftDeltaDb: round(demoBand.leftDb + demoGainDb - referenceBand.leftDb - referenceGainDb),
      rightDeltaDb: round(demoBand.rightDb + demoGainDb - referenceBand.rightDb - referenceGainDb),
      comparableToHz: definition.key === "air" ? comparableHighHz : definition.to,
      timestamp: findBandTimestamp(demo, reference, definition.key, demoGainDb, referenceGainDb, Math.sign(deltaDb)),
    };
  });

  const findings: Finding[] = [];
  const referenceWarnings: Finding[] = [];
  let id = 0;
  const add = (finding: Omit<Finding, "id">) => findings.push({ id: `finding-${++id}`, ...finding });
  const addReference = (finding: Omit<Finding, "id">) => referenceWarnings.push({ id: `reference-${++id}`, ...finding });

  if (demo.stereo.polarityRisk) {
    add({
      title: "Severe polarity or phase conflict detected",
      section: "Stereo & Spatial Image",
      impact: "High",
      confidence: "High",
      source: "Measurement",
      timestamp: "Full Track",
      evidence: `Overall correlation is ${demo.stereo.correlation.toFixed(2)}, with approximately ${Math.abs(demo.stereo.monoRetentionDb).toFixed(1)} dB of energy lost in mono. This is likely a file issue rather than a mastering choice.`,
      recommendation: "Check the polarity of each channel, export a clean stereo file, and analyze it again. Do not continue mastering with the current file.",
      feedbackVi: { title: "Cảnh báo đảo cực hoặc lệch phase nghiêm trọng", recommendation: "Kiểm tra polarity từng kênh, xuất lại file stereo sạch và phân tích lại. Không tiếp tục master trên file hiện tại." },
    });
  } else if (demo.stereo.correlation < 0.1 || demo.stereo.monoRetentionDb < -4.5) {
    add({
      title: "Weak mono compatibility",
      section: "Stereo & Spatial Image",
      impact: demo.stereo.correlation < 0 ? "High" : "Medium",
      confidence: "High",
      source: "Measurement",
      timestamp: "Full Track",
      evidence: `Correlation is ${demo.stereo.correlation.toFixed(2)}; the mono fold-down loses approximately ${Math.abs(demo.stereo.monoRetentionDb).toFixed(1)} dB of energy.`,
      recommendation: "Check chorus, stereo delay, and reverb returns. Reduce Side level or timing offsets on the source causing the issue; do not use a stereo imager across the full master.",
      feedbackVi: { title: "Khả năng tương thích mono yếu", recommendation: "Kiểm tra chorus, stereo delay và reverb return. Giảm Side hoặc chỉnh lệch thời gian trên nguồn gây lỗi; không dùng stereo imager trên toàn master." },
    });
  }

  const subDemo = demo.spectral.bands.sub;
  const subReference = reference.spectral.bands.sub;
  if (subDemo.widthPercent > 32 && subDemo.widthPercent > subReference.widthPercent + 12) {
    add({
      title: "Sub-bass is wider than the Reference",
      section: "Stereo & Spatial Image",
      impact: subDemo.correlation < 0.45 ? "High" : "Medium",
      confidence: "High",
      source: "Measurement",
      timestamp: findBandTimestamp(demo, reference, "sub", demoGainDb, referenceGainDb, 1),
      evidence: `Width at 20–80 Hz is ${subDemo.widthPercent.toFixed(0)}% in the Demo and ${subReference.widthPercent.toFixed(0)}% in the Reference; Demo sub-band correlation is ${subDemo.correlation.toFixed(2)}.`,
      recommendation: "Keep content below approximately 80–100 Hz mono on the sub or bass bus. Narrow only the low end, not the pads and ambience above it.",
      feedbackVi: { title: "Sub-bass rộng hơn Reference", recommendation: "Giữ phần dưới khoảng 80–100 Hz ở mono trên sub/bass bus. Chỉ thu hẹp low-end, không thu hẹp pad và ambience phía trên." },
    });
  }

  const widthDelta = demo.stereo.widthPercent - reference.stereo.widthPercent;
  if (Math.abs(widthDelta) >= 18) {
    const narrower = widthDelta < 0;
    add({
      title: narrower ? "Stereo image is narrower than the Reference" : "Stereo image is wider than the Reference",
      section: "Stereo & Spatial Image",
      impact: Math.abs(widthDelta) > 35 ? "High" : "Medium",
      confidence: "High",
      source: "Measurement",
      timestamp: "Full Track",
      evidence: `The derived Side-to-Mid width is ${demo.stereo.widthPercent.toFixed(0)}% in the Demo and ${reference.stereo.widthPercent.toFixed(0)}% in the Reference.`,
      recommendation: narrower
        ? "Widen only the pad, texture, ambience, or reverb returns in the mid and high bands. Keep the main piano and low end stable in the center; do not widen the entire master."
        : "Reduce width on the texture or reverb causing the excess. Prefer automation or band-specific M/S EQ, preserve a clear center, and check mono after each change.",
      feedbackVi: {
        title: narrower ? "Không gian stereo hẹp hơn Reference" : "Không gian stereo rộng hơn Reference",
        recommendation: narrower
          ? "Mở riêng pad, texture, ambience hoặc reverb return ở mid/high. Giữ piano chính và low-end ổn định ở giữa; không mở toàn bộ master."
          : "Giảm width trên texture/reverb gây rộng quá mức, ưu tiên automation hoặc M/S EQ theo dải. Giữ phần center rõ và kiểm tra mono sau mỗi thay đổi.",
      },
    });
  }

  if (Math.abs(demo.stereo.balanceDb) > 1 && Math.abs(demo.stereo.balanceDb) > Math.abs(reference.stereo.balanceDb) + 0.5) {
    add({
      title: "Left/right balance is unstable",
      section: "Stereo & Spatial Image",
      impact: Math.abs(demo.stereo.balanceDb) > 2 ? "High" : "Medium",
      confidence: "High",
      source: "Measurement",
      timestamp: "Full Track",
      evidence: `The Demo leans ${Math.abs(demo.stereo.balanceDb).toFixed(1)} dB to the ${demo.stereo.balanceDb > 0 ? "left" : "right"}; the Reference offset is ${Math.abs(reference.stereo.balanceDb).toFixed(1)} dB.`,
      recommendation: "Check the pan and level of pads, ambience, and reverb returns. Correct the source track or bus rather than rebalancing the master when only one layer is responsible.",
      feedbackVi: { title: "Cân bằng trái/phải chưa ổn định", recommendation: "Kiểm tra pan/volume của pad, ambience và reverb return. Chỉnh tại track hoặc bus gây lệch, không cân lại bằng master nếu chỉ một layer là nguyên nhân." },
    });
  }

  for (const comparison of bands) {
    const threshold = comparison.key === "air" && comparableHighHz < 17000 ? 2 : 1.35;
    if (Math.abs(comparison.deltaDb) < threshold) continue;
    const recommendation = bandRecommendation(comparison.key, comparison.deltaDb);
    const direction = comparison.deltaDb > 0 ? "has more energy than" : "has less energy than";
    const directionVi = comparison.deltaDb > 0 ? "nhiều hơn" : "ít hơn";
    const codecNote = comparison.key === "air" && comparableHighHz < 20000 ? ` The comparison is reliable only up to approximately ${(comparableHighHz / 1000).toFixed(0)} kHz because of codec limits.` : "";
    add({
      title: `${comparison.label} ${direction} Reference`,
      section: "EQ & Tonal Balance",
      impact: impactFromDelta(comparison.deltaDb),
      confidence: comparison.key === "air" && comparableHighHz < 17000 ? "Medium" : "High",
      source: "Measurement",
      timestamp: comparison.timestamp,
      evidence: `After loudness matching, the Demo differs by ${signed(comparison.deltaDb)} dB at ${comparison.range}; left channel ${signed(comparison.leftDeltaDb)} dB, right channel ${signed(comparison.rightDeltaDb)} dB.${codecNote} The likely source is ${recommendation.likelySource}.`,
      recommendation: recommendation.action,
      feedbackVi: { title: `${comparison.label} ${directionVi} Reference`, recommendation: recommendation.actionVi },
    });
  }

  const curveMeanAt = (metrics: AudioMetrics, frequency: number) => {
    const point = metrics.spectral.curve.reduce((closest, candidate) => Math.abs(candidate.frequency - frequency) < Math.abs(closest.frequency - frequency) ? candidate : closest);
    return (point.leftDb + point.rightDb) * 0.5;
  };
  const referenceProminenceAt = (frequency: number) => {
    const candidate = reference.spectral.resonances.reduce<{ frequency: number; prominenceDb: number } | null>((closest, item) => {
      if (Math.abs(item.frequency - frequency) > frequency * 0.12) return closest;
      if (!closest || Math.abs(item.frequency - frequency) < Math.abs(closest.frequency - frequency)) return item;
      return closest;
    }, null);
    return candidate?.prominenceDb ?? 0;
  };
  const resonance = demo.spectral.resonances.find((candidate) => {
    const matchedDelta = curveMeanAt(demo, candidate.frequency) + demoGainDb - curveMeanAt(reference, candidate.frequency) - referenceGainDb;
    return candidate.prominenceDb >= 4 && candidate.frequency < comparableHighHz && matchedDelta > 2.5 && candidate.prominenceDb - referenceProminenceAt(candidate.frequency) > 2;
  });
  if (resonance) {
    add({
      title: "Narrow spectral peak requires a listening check",
      section: "EQ & Tonal Balance",
      impact: resonance.prominenceDb > 6 ? "Medium" : "Low",
      confidence: "Medium",
      source: "Measurement",
      timestamp: "Across Multiple Sections",
      evidence: `The average spectrum shows a local prominence of approximately ${resonance.prominenceDb.toFixed(1)} dB around ${Math.round(resonance.frequency)} Hz. This measurement alone does not confirm an audible resonance.`,
      recommendation: `Solo the likely source around ${Math.round(resonance.frequency)} Hz. If a fixed ringing tone is audible, try 1–2 dB of narrow dynamic EQ reduction on that track; do not notch the master immediately.`,
      feedbackVi: { title: "Có đỉnh phổ hẹp cần kiểm tra bằng tai", recommendation: `Solo kiểm tra nguồn quanh ${Math.round(resonance.frequency)} Hz. Nếu nghe ra tiếng ngân cố định, thử dynamic EQ hẹp giảm 1–2 dB trên track gây ra, không notch master ngay lập tức.` },
    });
  }

  const demoOnsets = demo.motion.onsetProxyPerMinute;
  const referenceOnsets = reference.motion.onsetProxyPerMinute;
  const onsetRatio = demoOnsets / Math.max(0.5, referenceOnsets);
  const midLevelDelta = bands.find((band) => band.key === "mid")?.deltaDb ?? 0;
  const upperLevelDelta = bands.find((band) => band.key === "upperMid")?.deltaDb ?? 0;
  if (demo.meta.duration >= 30 && onsetRatio > 1.28 && demoOnsets - referenceOnsets > 1.2) {
    add({
      title: "Foreground movement may be denser than the Reference",
      section: "Melody & Motif",
      impact: onsetRatio > 1.65 ? "High" : "Medium",
      confidence: "Medium",
      source: "Inference",
      timestamp: demo.motion.suddenEvents[0] ? formatTimestamp(demo.motion.suddenEvents[0].time) : "Full Track",
      evidence: `The 500 Hz–4 kHz onset proxy is approximately ${demoOnsets.toFixed(1)} per minute in the Demo and ${referenceOnsets.toFixed(1)} per minute in the Reference. In a stereo mix, this may include piano, textures, and other transients.`,
      recommendation: "Review the motif or piano. Try fewer or longer notes, more space between phrases, and lower velocity. Keep movement even and avoid sudden high notes or onsets.",
      feedbackVi: { title: "Chuyển động tiền cảnh có thể dày hơn Reference", recommendation: "Kiểm tra motif/piano: thử bỏ bớt note, kéo dài note, tăng khoảng nghỉ và hạ velocity. Giữ chuyển động đều, tránh note cao hoặc onset xuất hiện đột ngột." },
    });
  } else if (Math.abs(onsetRatio - 1) < 0.3 && midLevelDelta + upperLevelDelta > 3) {
    add({
      title: "Melody prominence may come from level or brightness, not note density",
      section: "Melody & Motif",
      impact: "Medium",
      confidence: "Medium",
      source: "Inference",
      timestamp: "Full Track",
      evidence: `Onset density is close to the Reference, but the combined mid and upper-mid difference in the Demo is ${signed(midLevelDelta + upperLevelDelta)} dB after loudness matching.`,
      recommendation: "Keep the note count if the motif works. Try lowering the piano, reducing 2–4 kHz, softening the attack, and increasing reverb send to place the melody deeper in the space.",
      feedbackVi: { title: "Melody có thể nổi do level/độ sáng, không phải do nhiều note", recommendation: "Giữ số note nếu motif đang hợp lý; thử hạ level piano, giảm 2–4 kHz, làm attack mềm hơn và tăng reverb send để đưa melody lùi vào không gian." },
    });
  }

  const lowMidDelta = bands.find((band) => band.key === "lowMid")?.deltaDb ?? 0;
  if (lowMidDelta > 1.5 && demo.stereo.widthPercent > reference.stereo.widthPercent + 8) {
    add({
      title: "Reverb tails or pads may be building up in the low mids",
      section: "Arrangement & Reverb",
      impact: lowMidDelta > 3 ? "High" : "Medium",
      confidence: "Medium",
      source: "Inference",
      timestamp: bands.find((band) => band.key === "lowMid")?.timestamp ?? "Full Track",
      evidence: `The Demo is both wider and ${signed(lowMidDelta)} dB higher at 250–500 Hz, a pattern often associated with pad or reverb-return buildup.`,
      recommendation: "Check the reverb return. Try a 150–250 Hz low cut, gentle dynamic EQ at 280–420 Hz, a soft 6–10 kHz high cut, and shorter decay if phrase tails overlap. Very light piano-triggered reverb sidechain may help.",
      feedbackVi: { title: "Đuôi reverb hoặc pad có thể tích tụ low-mid", recommendation: "Kiểm tra reverb return: thử low-cut 150–250 Hz, dynamic EQ nhẹ 280–420 Hz, high-cut mềm 6–10 kHz và giảm decay nếu các câu bị chồng đuôi. Có thể sidechain reverb rất nhẹ theo piano." },
    });
  }

  if (demo.motion.suddenEvents.length > Math.max(2, reference.motion.suddenEvents.length + 1)) {
    const event = demo.motion.suddenEvents[0];
    add({
      title: "Sudden level change may interrupt a calm listening experience",
      section: "Loudness & Dynamics",
      impact: event.jumpDb > 8 ? "High" : "Medium",
      confidence: "High",
      source: "Measurement",
      timestamp: formatTimestamp(event.time),
      evidence: `A short-term rise of approximately ${event.jumpDb.toFixed(1)} dB was measured. The Demo has ${demo.motion.suddenEvents.length} notable events; the Reference has ${reference.motion.suddenEvents.length}.`,
      recommendation: "Check the note or layer entering at this timestamp. Lower its velocity or level, lengthen the fade-in, and use automation instead of a limiter to mask the jump.",
      feedbackVi: { title: "Có thay đổi level đột ngột dễ gây giật mình", recommendation: "Kiểm tra note/layer xuất hiện tại timestamp, hạ velocity hoặc volume, làm fade-in dài hơn và dùng automation thay vì limiter để che cú nhảy." },
    });
  }

  if (demo.loudness.truePeakDbtp > -1) {
    add({
      title: "True peak headroom is limited",
      section: "Loudness & Dynamics",
      impact: demo.loudness.truePeakDbtp > -0.2 ? "High" : "Medium",
      confidence: "High",
      source: "Measurement",
      timestamp: "Full Track",
      evidence: `The Demo's estimated 4× true peak is ${demo.loudness.truePeakDbtp.toFixed(1)} dBTP.`,
      recommendation: "Lower the limiter ceiling to approximately -1.0 to -1.5 dBTP and check again after encoding. For sleep music, prioritize headroom and softness over maximum loudness.",
      feedbackVi: { title: "True peak thiếu headroom", recommendation: "Hạ ceiling limiter về khoảng -1.0 đến -1.5 dBTP và kiểm tra lại sau encode. Với nhạc ngủ, ưu tiên headroom và độ mềm hơn độ to tối đa." },
    });
  }

  if (demo.loudness.integratedLufs > -16) {
    add({
      title: "The master is relatively loud for sleep music",
      section: "Loudness & Dynamics",
      impact: demo.loudness.integratedLufs > -13.5 ? "High" : "Medium",
      confidence: "High",
      source: "Measurement",
      timestamp: "Full Track",
      evidence: `The Demo measures ${demo.loudness.integratedLufs.toFixed(1)} LUFS-I and the Reference measures ${reference.loudness.integratedLufs.toFixed(1)} LUFS-I. Loudness is not used to judge tonal quality.`,
      recommendation: "Do not chase the Reference if it is excessively loud. Try a target around -18 to -20 LUFS-I, preserve soft transients, and let the platform apply normalization.",
      feedbackVi: { title: "Master đang khá nóng đối với nhạc ngủ", recommendation: "Không chạy theo Reference nếu Reference quá nóng. Thử mục tiêu khoảng -18 đến -20 LUFS-I, giữ transient mềm và để nền tảng tự chuẩn hóa." },
    });
  }

  if (demo.loudness.lraLu + 1.5 < reference.loudness.lraLu && demo.loudness.crestFactorDb + 1 < reference.loudness.crestFactorDb) {
    add({
      title: "Dynamics are flatter than the Reference",
      section: "Loudness & Dynamics",
      impact: "Medium",
      confidence: "High",
      source: "Measurement",
      timestamp: "Full Track",
      evidence: `The Demo has ${demo.loudness.lraLu.toFixed(1)} LU of LRA and a ${demo.loudness.crestFactorDb.toFixed(1)} dB crest factor; the Reference measures ${reference.loudness.lraLu.toFixed(1)} LU and ${reference.loudness.crestFactorDb.toFixed(1)} dB respectively.`,
      recommendation: "Reduce bus or limiter gain reduction, relax attack and release settings, and use volume automation to preserve natural movement instead of adding compression.",
      feedbackVi: { title: "Dynamics phẳng hơn Reference", recommendation: "Giảm gain reduction trên bus/limiter, nới attack/release và dùng volume automation để giữ chuyển động tự nhiên thay vì nén thêm." },
    });
  }

  if (demo.motion.outroCutRisk) {
    add({
      title: "The outro may be cut while still audible",
      section: "Loudness & Dynamics",
      impact: demo.motion.outroEndDb > -40 ? "High" : "Medium",
      confidence: "High",
      source: "Measurement",
      timestamp: `${formatTimestamp(Math.max(0, demo.meta.duration - 5))}–${formatTimestamp(demo.meta.duration)}`,
      evidence: `The final 100 ms remains at approximately ${demo.motion.outroEndDb.toFixed(1)} dBFS; the final five-second average is ${demo.motion.outroTailDb.toFixed(1)} dBFS.`,
      recommendation: "Extend the reverb tail and create a natural fade to complete silence. Check the bounce again to ensure there is no audible cutoff.",
      feedbackVi: { title: "Outro có nguy cơ bị cắt khi vẫn còn nghe rõ", recommendation: "Kéo dài reverb tail và tạo fade-out tự nhiên về im lặng hoàn toàn. Kiểm tra lại sau khi bounce để không còn điểm cắt nghe thấy." },
    });
  }

  if (demo.meta.codecWarning) {
    add({
      title: "Demo codec quality limits the analysis",
      section: "File Quality",
      impact: "Medium",
      confidence: "High",
      source: "Measurement",
      timestamp: "Full Track",
      evidence: demo.meta.codecWarning,
      recommendation: "Use a WAV or FLAC file from the original export before making decisions about the air band, true peak, or reverb quality.",
      feedbackVi: { title: "Giới hạn chất lượng codec của Demo", recommendation: "Tải WAV hoặc FLAC từ bản xuất gốc trước khi quyết định vùng air, true peak và chất lượng reverb." },
    });
  }
  if (reference.meta.codecWarning) {
    addReference({
      title: "Reference analysis is limited by its codec",
      section: "File Quality",
      impact: "Medium",
      confidence: "High",
      source: "Measurement",
      timestamp: "Full Track",
      evidence: reference.meta.codecWarning,
      recommendation: "Do not make the Demo darker or brighter to match high frequencies removed by the codec. Use a clean WAV or FLAC Reference if possible.",
    });
  }
  if (reference.stereo.polarityRisk) {
    addReference({
      title: "The Reference shows signs of a polarity issue",
      section: "Stereo & Spatial Image",
      impact: "High",
      confidence: "High",
      source: "Measurement",
      timestamp: "Full Track",
      evidence: `Reference correlation ${reference.stereo.correlation.toFixed(2)}, mono retention ${reference.stereo.monoRetentionDb.toFixed(1)} dB.`,
      recommendation: "Do not replicate this width or phase behavior. Use a Reference with corrected polarity or a clean new export.",
    });
  }
  if (reference.loudness.integratedLufs > -14 || reference.loudness.truePeakDbtp > -0.3) {
    addReference({
      title: "The Reference is mastered hot; compare tone and space only",
      section: "Loudness & Dynamics",
      impact: "Medium",
      confidence: "High",
      source: "Measurement",
      timestamp: "Full Track",
      evidence: `Reference ${reference.loudness.integratedLufs.toFixed(1)} LUFS-I, ${reference.loudness.truePeakDbtp.toFixed(1)} dBTP.`,
      recommendation: "Preserve the Demo's headroom when it is technically stronger. Do not increase limiting simply to match the Reference loudness.",
    });
  }

  const sectionOrder: Record<AnalysisSection, number> = {
    "Stereo & Spatial Image": 0,
    "EQ & Tonal Balance": 1,
    "Melody & Motif": 2,
    "Arrangement & Reverb": 3,
    "Loudness & Dynamics": 4,
    "File Quality": 5,
  };
  const impactOrder: Record<Impact, number> = { High: 0, Medium: 1, Low: 2 };
  findings.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact] || sectionOrder[a.section] - sectionOrder[b.section]);

  const strengths: string[] = [];
  const strengthsVi: string[] = [];
  const addStrength = (english: string, vietnamese: string) => { strengths.push(english); strengthsVi.push(vietnamese); };
  if (!demo.stereo.polarityRisk && demo.stereo.correlation >= 0.2) addStrength("Stereo shows no severe polarity reversal and retains a stable center.", "Stereo không có dấu hiệu đảo cực nghiêm trọng và vẫn giữ được phần center.");
  if (Math.abs(demo.stereo.balanceDb) <= 1) addStrength("Left/right balance remains stable across the full track.", "Cân bằng trái/phải ổn định trên toàn bài.");
  if (demo.loudness.truePeakDbtp <= -1) addStrength("True peak retains suitable headroom without pushing the limiter too close to 0 dBTP.", "True peak còn headroom phù hợp, chưa ép limiter quá sát 0 dBTP.");
  if (demo.motion.suddenEvents.length <= 2) addStrength("Few sudden level changes support a calm Deep Sleep listening experience.", "Ít thay đổi level đột ngột, phù hợp trải nghiệm Deep Sleep.");
  if (!demo.motion.outroCutRisk) addStrength("The outro reaches a very low level without an obvious tail cutoff.", "Outro đi về mức rất nhỏ, không có dấu hiệu cắt đuôi rõ ràng.");
  if (!strengths.length) addStrength("The Demo has a clear enough structure for focused refinement against the Reference.", "Demo có cấu trúc đủ rõ để tiếp tục tinh chỉnh theo Reference.");

  const highCount = findings.filter((finding) => finding.impact === "High").length;
  const mediumCount = findings.filter((finding) => finding.impact === "Medium").length;
  const qualityScore = clamp(Math.round(100 - highCount * 15 - mediumCount * 7 - findings.filter((finding) => finding.impact === "Low").length * 2), 28, 96);
  const releaseVerdict = demo.stereo.polarityRisk || highCount >= 2
    ? "Not Ready for Release"
    : highCount >= 1 || mediumCount >= 3
      ? "Revisions Recommended Before Release"
      : "Ready After Final Listening Check";
  const threeBiggestDifferences = findings.filter((finding) => !finding.positive).slice(0, 3).map((finding) => finding.title);
  const keepElements = strengths.slice(0, 3);
  if (referenceWarnings.length) keepElements.push("Do not replicate the technical issues flagged in the Reference.");

  const good = strengthsVi.slice(0, 3);
  const feedbackTimestampVi = (timestamp: string) => timestamp === "Full Track" ? "Toàn bài" : timestamp === "Across Multiple Sections" ? "Xuất hiện theo nhiều đoạn" : timestamp;
  const feedbackLineVi = (finding: Finding) => {
    const sourceVi = finding.source === "Measurement" ? "Đo lường" : "Suy luận";
    return `${feedbackTimestampVi(finding.timestamp)} · ${sourceVi}: ${finding.feedbackVi?.title ?? finding.title}. ${finding.feedbackVi?.recommendation ?? finding.recommendation}`;
  };
  const priorityFindings = findings.filter((finding) => finding.impact !== "Low").slice(0, 4);
  const priority = priorityFindings.map(feedbackLineVi);
  const supplemental = findings.filter((finding) => !priorityFindings.includes(finding)).slice(0, 4).map(feedbackLineVi);
  const goal = "Mục tiêu của bản tiếp theo là giữ cảm xúc và bản sắc của Demo, đồng thời đạt độ cân bằng, chiều sâu, độ mềm và độ ổn định tương đương Reference, không sao chép những điểm kỹ thuật chưa tốt của Reference.";
  const fullText = [
    "Điểm đã làm tốt",
    ...good.map((item) => `• ${item}`),
    "",
    "Các chỉnh sửa ưu tiên",
    ...(priority.length ? priority : ["• Hiện chưa có lỗi kỹ thuật lớn; vui lòng kiểm tra lại bằng tai nghe trước khi master cuối."]).map((item) => item.startsWith("•") ? item : `• ${item}`),
    "",
    "Đề xuất bổ sung",
    ...(supplemental.length ? supplemental : ["• Giữ nguyên các phần đang cân bằng và tránh xử lý toàn master nếu vấn đề chỉ nằm ở một layer."]).map((item) => item.startsWith("•") ? item : `• ${item}`),
    "",
    "Mục tiêu của bản chỉnh sửa tiếp theo",
    goal,
  ].join("\n");

  return {
    demo,
    reference,
    loudnessMatch: {
      originalDeltaDb: round(originalDeltaDb),
      targetLufs: round(targetLufs),
      demoGainDb: round(demoGainDb),
      referenceGainDb: round(referenceGainDb),
    },
    bands,
    findings,
    referenceWarnings,
    strengths,
    threeBiggestDifferences,
    keepElements,
    releaseVerdict,
    qualityScore,
    feedback: { good, priority, supplemental, goal, fullText },
  };
}

export async function analyzePair(demoFile: File, referenceFile: File, onProgress: ProgressCallback, signal?: AbortSignal): Promise<PairAnalysis> {
  throwIfAborted(signal);
  onProgress(1, "Preparing the Measurement Engine");
  const demo = await analyzeSingle(demoFile, (fraction, label) => onProgress(3 + fraction * 45, `Demo: ${label}`), signal);
  await waitForMainThread();
  throwIfAborted(signal);
  const reference = await analyzeSingle(referenceFile, (fraction, label) => onProgress(50 + fraction * 45, `Reference: ${label}`), signal);
  onProgress(96, "Applying Loudness Match and Comparing Results");
  await waitForMainThread();
  throwIfAborted(signal);
  const result = buildPairAnalysis(demo, reference);
  onProgress(100, "Analysis Complete");
  return result;
}
