export type BandKey = "sub" | "bass" | "lowMid" | "mid" | "upperMid" | "air";

export type Impact = "Thấp" | "Trung bình" | "Cao";
export type Confidence = "Thấp" | "Trung bình" | "Cao";
export type EvidenceSource = "Đo lường" | "Suy luận";
export type AnalysisSection = "Stereo & không gian" | "EQ & cân bằng phổ" | "Melody & motif" | "Arrangement & reverb" | "Loudness & dynamics" | "Chất lượng file";

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
  releaseVerdict: "Chưa sẵn sàng phát hành" | "Nên chỉnh trước khi phát hành" | "Có thể phát hành sau khi kiểm tra tai nghe";
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

async function estimateTruePeak(channels: Float32Array[], samplePeak: number) {
  let peak = samplePeak;
  const threshold = samplePeak * 0.62;
  const chunk = 1_500_000;
  for (const data of channels) {
    for (let start = 1; start < data.length - 2; start += chunk) {
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
    }
  }
  return peak;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

async function measureCore(buffer: AudioBuffer, onProgress: (fraction: number) => void) {
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
  }

  const truePeak = await estimateTruePeak(channels, samplePeak);
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

async function analyzeSpectrum(buffer: AudioBuffer, onProgress: (fraction: number) => void) {
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
    codecWarning = `File ${extension.toUpperCase()} khoảng ${Math.round(bitrateKbps)} kbps; không kết luận vùng air trên khoảng ${(comparableHighHz / 1000).toFixed(0)} kHz.`;
  }
  return { extension, bitrateKbps: round(bitrateKbps, 0), comparableHighHz, codecWarning };
}

async function analyzeSingle(file: File, onProgress: (fraction: number, label: string) => void) {
  const context = new AudioContext({ sampleRate: ANALYSIS_RATE });
  try {
    onProgress(0.02, "Đang giải mã file");
    const sourceHeader = await parseSourceHeader(file);
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    onProgress(0.12, "Đang đo LUFS và dynamics");
    const core = await measureCore(buffer, (fraction) => onProgress(0.12 + fraction * 0.48, "Đang đo LUFS, true peak và phase"));
    onProgress(0.61, "Đang đo phổ từng kênh");
    const spectral = await analyzeSpectrum(buffer, (fraction) => onProgress(0.61 + fraction * 0.37, "Đang đo phổ L/R và stereo theo dải"));
    const codec = codecAssessment(file, buffer.duration);
    onProgress(1, "Hoàn tất file");
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
  if (!demoFrames.length || !referenceFrames.length) return "Toàn bài";
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
  if (magnitude >= 3) return "Cao";
  if (magnitude >= 1.7) return "Trung bình";
  return "Thấp";
}

function bandRecommendation(key: BandKey, delta: number) {
  const excessive = delta > 0;
  const magnitude = Math.abs(delta) >= 3 ? "2–3 dB" : "1–2 dB";
  const recommendations: Record<BandKey, { source: string; excess: string; deficit: string }> = {
    sub: {
      source: "sub, drone hoặc phần low của pad",
      excess: `Kiểm tra sub/bass bus trước, thử dynamic EQ giảm ${magnitude} trong 30–80 Hz. Giữ vùng dưới khoảng 80–100 Hz ở mono; không thu hẹp toàn bộ master.`,
      deficit: `Kiểm tra fundamental của bass/drone, thử low-shelf rất nhẹ ${magnitude} trên nguồn phù hợp thay vì nâng toàn master. Giữ sub ổn định ở giữa.`,
    },
    bass: {
      source: "bass, thân pad hoặc reverb low-end",
      excess: `Kiểm tra bass và pad bus, thử dynamic EQ giảm ${magnitude} trong 90–220 Hz hoặc sidechain nhẹ khi piano/pad cùng hoạt động.`,
      deficit: `Thử bổ sung thân cho pad/bass ${magnitude} trong 100–220 Hz trên track hoặc bus; tránh boost nếu mono đã bị tích tụ.`,
    },
    lowMid: {
      source: "thân pad, piano hoặc đuôi reverb",
      excess: `Kiểm tra pad bus và reverb return, thử dynamic EQ giảm ${magnitude} quanh 280–420 Hz. Có thể high-pass reverb nhẹ để tránh tích tụ.`,
      deficit: `Thử tăng rất rộng ${magnitude} quanh 280–450 Hz trên pad/piano bus để có thêm độ ấm; tránh làm master bị bí.`,
    },
    mid: {
      source: "piano, motif hoặc harmonic của pad",
      excess: `Đưa piano/motif lùi nhẹ hoặc giảm EQ rộng ${magnitude} trong 700 Hz–1.8 kHz trên nguồn gây nổi; ưu tiên automation hơn ép master.`,
      deficit: `Thử tăng harmonic hoặc EQ rộng ${magnitude} trong 700 Hz–1.8 kHz trên piano/pad để melody không bị mỏng.`,
    },
    upperMid: {
      source: "attack piano, bell hoặc texture sáng",
      excess: `Dùng dynamic EQ trên piano/texture giảm ${magnitude} trong 2–4 kHz khi note đánh vào; hạ velocity/attack nếu âm vẫn sắc.`,
      deficit: `Nếu melody bị lùi quá sâu, thử tăng rất nhẹ ${magnitude} trong 2–3.5 kHz trên track melody, không cần nâng cả master.`,
    },
    air: {
      source: "texture, ambience, reverb hoặc noise layer",
      excess: `Thử high-shelf giảm ${magnitude} từ 7–10 kHz trên texture/reverb hoặc high-cut reverb để tránh chói khi nghe lâu.`,
      deficit: `Thử mở high-shelf ${magnitude} từ 8–10 kHz trên ambience/reverb, hoặc thêm texture rất nhẹ; không boost vùng codec đã cắt.`,
    },
  };
  const item = recommendations[key];
  return { likelySource: item.source, action: excessive ? item.excess : item.deficit };
}

function buildPairAnalysis(demo: AudioMetrics, reference: AudioMetrics): PairAnalysis {
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
      title: "Cảnh báo đảo cực hoặc lệch phase nghiêm trọng",
      section: "Stereo & không gian",
      impact: "Cao",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: "Toàn bài",
      evidence: `Correlation tổng thể ${demo.stereo.correlation.toFixed(2)} và năng lượng mono giảm ${Math.abs(demo.stereo.monoRetentionDb).toFixed(1)} dB. Đây nhiều khả năng là lỗi file, không phải lựa chọn master.`,
      recommendation: "Kiểm tra polarity từng kênh, xuất lại file stereo sạch và phân tích lại. Không tiếp tục master trên file hiện tại.",
    });
  } else if (demo.stereo.correlation < 0.1 || demo.stereo.monoRetentionDb < -4.5) {
    add({
      title: "Khả năng tương thích mono yếu",
      section: "Stereo & không gian",
      impact: demo.stereo.correlation < 0 ? "Cao" : "Trung bình",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: "Toàn bài",
      evidence: `Correlation ${demo.stereo.correlation.toFixed(2)}; khi gộp mono mất khoảng ${Math.abs(demo.stereo.monoRetentionDb).toFixed(1)} dB năng lượng.`,
      recommendation: "Kiểm tra chorus, stereo delay và reverb return. Giảm Side hoặc chỉnh lệch thời gian trên nguồn gây lỗi; không dùng stereo imager trên toàn master.",
    });
  }

  const subDemo = demo.spectral.bands.sub;
  const subReference = reference.spectral.bands.sub;
  if (subDemo.widthPercent > 32 && subDemo.widthPercent > subReference.widthPercent + 12) {
    add({
      title: "Sub-bass rộng hơn Reference",
      section: "Stereo & không gian",
      impact: subDemo.correlation < 0.45 ? "Cao" : "Trung bình",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: findBandTimestamp(demo, reference, "sub", demoGainDb, referenceGainDb, 1),
      evidence: `Độ rộng 20–80 Hz của Demo ${subDemo.widthPercent.toFixed(0)}%, Reference ${subReference.widthPercent.toFixed(0)}%; correlation dải sub của Demo ${subDemo.correlation.toFixed(2)}.`,
      recommendation: "Giữ phần dưới khoảng 80–100 Hz ở mono trên sub/bass bus. Chỉ thu hẹp low-end, không thu hẹp pad và ambience phía trên.",
    });
  }

  const widthDelta = demo.stereo.widthPercent - reference.stereo.widthPercent;
  if (Math.abs(widthDelta) >= 18) {
    const narrower = widthDelta < 0;
    add({
      title: narrower ? "Không gian stereo hẹp hơn Reference" : "Không gian stereo rộng hơn Reference",
      section: "Stereo & không gian",
      impact: Math.abs(widthDelta) > 35 ? "Cao" : "Trung bình",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: "Toàn bài",
      evidence: `Tỷ lệ Side/Mid quy đổi của Demo ${demo.stereo.widthPercent.toFixed(0)}%, Reference ${reference.stereo.widthPercent.toFixed(0)}%.`,
      recommendation: narrower
        ? "Mở riêng pad, texture, ambience hoặc reverb return ở mid/high. Giữ piano chính và low-end ổn định ở giữa; không mở toàn bộ master."
        : "Giảm width trên texture/reverb gây rộng quá mức, ưu tiên automation hoặc M/S EQ theo dải. Giữ phần center rõ và kiểm tra mono sau mỗi thay đổi.",
    });
  }

  if (Math.abs(demo.stereo.balanceDb) > 1 && Math.abs(demo.stereo.balanceDb) > Math.abs(reference.stereo.balanceDb) + 0.5) {
    add({
      title: "Cân bằng trái/phải chưa ổn định",
      section: "Stereo & không gian",
      impact: Math.abs(demo.stereo.balanceDb) > 2 ? "Cao" : "Trung bình",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: "Toàn bài",
      evidence: `Demo lệch ${Math.abs(demo.stereo.balanceDb).toFixed(1)} dB về ${demo.stereo.balanceDb > 0 ? "trái" : "phải"}; Reference lệch ${Math.abs(reference.stereo.balanceDb).toFixed(1)} dB.`,
      recommendation: "Kiểm tra pan/volume của pad, ambience và reverb return. Chỉnh tại track hoặc bus gây lệch, không cân lại bằng master nếu chỉ một layer là nguyên nhân.",
    });
  }

  for (const comparison of bands) {
    const threshold = comparison.key === "air" && comparableHighHz < 17000 ? 2 : 1.35;
    if (Math.abs(comparison.deltaDb) < threshold) continue;
    const recommendation = bandRecommendation(comparison.key, comparison.deltaDb);
    const direction = comparison.deltaDb > 0 ? "nhiều hơn" : "ít hơn";
    const codecNote = comparison.key === "air" && comparableHighHz < 20000 ? ` Chỉ so sánh đáng tin tới khoảng ${(comparableHighHz / 1000).toFixed(0)} kHz do giới hạn codec.` : "";
    add({
      title: `${comparison.label} ${direction} Reference`,
      section: "EQ & cân bằng phổ",
      impact: impactFromDelta(comparison.deltaDb),
      confidence: comparison.key === "air" && comparableHighHz < 17000 ? "Trung bình" : "Cao",
      source: "Đo lường",
      timestamp: comparison.timestamp,
      evidence: `Sau loudness-match, Demo chênh ${signed(comparison.deltaDb)} dB ở ${comparison.range}; kênh L ${signed(comparison.leftDeltaDb)} dB, kênh R ${signed(comparison.rightDeltaDb)} dB.${codecNote} Thành phần có khả năng liên quan: ${recommendation.likelySource}.`,
      recommendation: recommendation.action,
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
      title: "Có đỉnh phổ hẹp cần kiểm tra bằng tai",
      section: "EQ & cân bằng phổ",
      impact: resonance.prominenceDb > 6 ? "Trung bình" : "Thấp",
      confidence: "Trung bình",
      source: "Đo lường",
      timestamp: "Xuất hiện theo nhiều đoạn",
      evidence: `Phổ trung bình có độ nhô cục bộ khoảng ${resonance.prominenceDb.toFixed(1)} dB quanh ${Math.round(resonance.frequency)} Hz. Phép đo chưa đủ để khẳng định đây là resonance khó chịu.`,
      recommendation: `Solo kiểm tra nguồn quanh ${Math.round(resonance.frequency)} Hz. Nếu nghe ra tiếng ngân cố định, thử dynamic EQ hẹp giảm 1–2 dB trên track gây ra, không notch master ngay lập tức.`,
    });
  }

  const demoOnsets = demo.motion.onsetProxyPerMinute;
  const referenceOnsets = reference.motion.onsetProxyPerMinute;
  const onsetRatio = demoOnsets / Math.max(0.5, referenceOnsets);
  const midLevelDelta = bands.find((band) => band.key === "mid")?.deltaDb ?? 0;
  const upperLevelDelta = bands.find((band) => band.key === "upperMid")?.deltaDb ?? 0;
  if (demo.meta.duration >= 30 && onsetRatio > 1.28 && demoOnsets - referenceOnsets > 1.2) {
    add({
      title: "Chuyển động tiền cảnh có thể dày hơn Reference",
      section: "Melody & motif",
      impact: onsetRatio > 1.65 ? "Cao" : "Trung bình",
      confidence: "Trung bình",
      source: "Suy luận",
      timestamp: demo.motion.suddenEvents[0] ? formatTimestamp(demo.motion.suddenEvents[0].time) : "Toàn bài",
      evidence: `Chỉ số onset vùng 500 Hz–4 kHz của Demo khoảng ${demoOnsets.toFixed(1)}/phút, Reference ${referenceOnsets.toFixed(1)}/phút. Từ mix stereo, số đo này có thể bao gồm piano, texture và transient khác.`,
      recommendation: "Kiểm tra motif/piano: thử bỏ bớt note, kéo dài note, tăng khoảng nghỉ và hạ velocity. Giữ chuyển động đều, tránh note cao hoặc onset xuất hiện đột ngột.",
    });
  } else if (Math.abs(onsetRatio - 1) < 0.3 && midLevelDelta + upperLevelDelta > 3) {
    add({
      title: "Melody có thể nổi do level/độ sáng, không phải do nhiều note",
      section: "Melody & motif",
      impact: "Trung bình",
      confidence: "Trung bình",
      source: "Suy luận",
      timestamp: "Toàn bài",
      evidence: `Mật độ onset gần Reference nhưng tổng chênh mid và upper-mid của Demo là ${signed(midLevelDelta + upperLevelDelta)} dB sau loudness-match.`,
      recommendation: "Giữ số note nếu motif đang hợp lý; thử hạ level piano, giảm 2–4 kHz, làm attack mềm hơn và tăng reverb send để đưa melody lùi vào không gian.",
    });
  }

  const lowMidDelta = bands.find((band) => band.key === "lowMid")?.deltaDb ?? 0;
  if (lowMidDelta > 1.5 && demo.stereo.widthPercent > reference.stereo.widthPercent + 8) {
    add({
      title: "Đuôi reverb hoặc pad có thể tích tụ low-mid",
      section: "Arrangement & reverb",
      impact: lowMidDelta > 3 ? "Cao" : "Trung bình",
      confidence: "Trung bình",
      source: "Suy luận",
      timestamp: bands.find((band) => band.key === "lowMid")?.timestamp ?? "Toàn bài",
      evidence: `Demo vừa rộng hơn vừa dư ${signed(lowMidDelta)} dB ở 250–500 Hz, mẫu thường gặp khi pad/reverb return bị tích tụ.`,
      recommendation: "Kiểm tra reverb return: thử low-cut 150–250 Hz, dynamic EQ nhẹ 280–420 Hz, high-cut mềm 6–10 kHz và giảm decay nếu các câu bị chồng đuôi. Có thể sidechain reverb rất nhẹ theo piano.",
    });
  }

  if (demo.motion.suddenEvents.length > Math.max(2, reference.motion.suddenEvents.length + 1)) {
    const event = demo.motion.suddenEvents[0];
    add({
      title: "Có thay đổi level đột ngột dễ gây giật mình",
      section: "Loudness & dynamics",
      impact: event.jumpDb > 8 ? "Cao" : "Trung bình",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: formatTimestamp(event.time),
      evidence: `Đo được mức tăng ngắn hạn khoảng ${event.jumpDb.toFixed(1)} dB; Demo có ${demo.motion.suddenEvents.length} sự kiện đáng chú ý, Reference có ${reference.motion.suddenEvents.length}.`,
      recommendation: "Kiểm tra note/layer xuất hiện tại timestamp, hạ velocity hoặc volume, làm fade-in dài hơn và dùng automation thay vì limiter để che cú nhảy.",
    });
  }

  if (demo.loudness.truePeakDbtp > -1) {
    add({
      title: "True peak thiếu headroom",
      section: "Loudness & dynamics",
      impact: demo.loudness.truePeakDbtp > -0.2 ? "Cao" : "Trung bình",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: "Toàn bài",
      evidence: `True peak ước tính 4× của Demo là ${demo.loudness.truePeakDbtp.toFixed(1)} dBTP.`,
      recommendation: "Hạ ceiling limiter về khoảng -1.0 đến -1.5 dBTP và kiểm tra lại sau encode. Với nhạc ngủ, ưu tiên headroom và độ mềm hơn độ to tối đa.",
    });
  }

  if (demo.loudness.integratedLufs > -16) {
    add({
      title: "Master đang khá nóng đối với nhạc ngủ",
      section: "Loudness & dynamics",
      impact: demo.loudness.integratedLufs > -13.5 ? "Cao" : "Trung bình",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: "Toàn bài",
      evidence: `Demo đo được ${demo.loudness.integratedLufs.toFixed(1)} LUFS-I. Reference là ${reference.loudness.integratedLufs.toFixed(1)} LUFS-I; mức to không được dùng để đánh giá màu sắc.`,
      recommendation: "Không chạy theo Reference nếu Reference quá nóng. Thử mục tiêu khoảng -18 đến -20 LUFS-I, giữ transient mềm và để nền tảng tự chuẩn hóa.",
    });
  }

  if (demo.loudness.lraLu + 1.5 < reference.loudness.lraLu && demo.loudness.crestFactorDb + 1 < reference.loudness.crestFactorDb) {
    add({
      title: "Dynamics phẳng hơn Reference",
      section: "Loudness & dynamics",
      impact: "Trung bình",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: "Toàn bài",
      evidence: `Demo LRA ${demo.loudness.lraLu.toFixed(1)} LU và crest ${demo.loudness.crestFactorDb.toFixed(1)} dB; Reference lần lượt ${reference.loudness.lraLu.toFixed(1)} LU và ${reference.loudness.crestFactorDb.toFixed(1)} dB.`,
      recommendation: "Giảm gain reduction trên bus/limiter, nới attack/release và dùng volume automation để giữ chuyển động tự nhiên thay vì nén thêm.",
    });
  }

  if (demo.motion.outroCutRisk) {
    add({
      title: "Outro có nguy cơ bị cắt khi vẫn còn nghe rõ",
      section: "Loudness & dynamics",
      impact: demo.motion.outroEndDb > -40 ? "Cao" : "Trung bình",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: `${formatTimestamp(Math.max(0, demo.meta.duration - 5))}–${formatTimestamp(demo.meta.duration)}`,
      evidence: `100 ms cuối vẫn ở khoảng ${demo.motion.outroEndDb.toFixed(1)} dBFS; trung bình 5 giây cuối ${demo.motion.outroTailDb.toFixed(1)} dBFS.`,
      recommendation: "Kéo dài reverb tail và tạo fade-out tự nhiên về im lặng hoàn toàn. Kiểm tra lại sau khi bounce để không còn điểm cắt nghe thấy.",
    });
  }

  if (demo.meta.codecWarning) {
    add({
      title: "Giới hạn chất lượng codec của Demo",
      section: "Chất lượng file",
      impact: "Trung bình",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: "Toàn bài",
      evidence: demo.meta.codecWarning,
      recommendation: "Tải WAV hoặc FLAC từ bản xuất gốc trước khi quyết định vùng air, true peak và chất lượng reverb.",
    });
  }
  if (reference.meta.codecWarning) {
    addReference({
      title: "Reference bị giới hạn bởi codec",
      section: "Chất lượng file",
      impact: "Trung bình",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: "Toàn bài",
      evidence: reference.meta.codecWarning,
      recommendation: "Không ép Demo tối hoặc sáng theo vùng high đã bị codec cắt. Nếu có thể, dùng Reference WAV/FLAC sạch.",
    });
  }
  if (reference.stereo.polarityRisk) {
    addReference({
      title: "Reference có dấu hiệu lỗi polarity",
      section: "Stereo & không gian",
      impact: "Cao",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: "Toàn bài",
      evidence: `Reference correlation ${reference.stereo.correlation.toFixed(2)}, mono retention ${reference.stereo.monoRetentionDb.toFixed(1)} dB.`,
      recommendation: "Không bắt chước độ rộng/phase này. Dùng file Reference đã sửa cực hoặc xuất lại file sạch.",
    });
  }
  if (reference.loudness.integratedLufs > -14 || reference.loudness.truePeakDbtp > -0.3) {
    addReference({
      title: "Reference master nóng; chỉ học màu sắc và không gian",
      section: "Loudness & dynamics",
      impact: "Trung bình",
      confidence: "Cao",
      source: "Đo lường",
      timestamp: "Toàn bài",
      evidence: `Reference ${reference.loudness.integratedLufs.toFixed(1)} LUFS-I, ${reference.loudness.truePeakDbtp.toFixed(1)} dBTP.`,
      recommendation: "Giữ headroom tốt của Demo nếu đang có; không tăng limiter chỉ để đạt độ to của Reference.",
    });
  }

  const sectionOrder: Record<AnalysisSection, number> = {
    "Stereo & không gian": 0,
    "EQ & cân bằng phổ": 1,
    "Melody & motif": 2,
    "Arrangement & reverb": 3,
    "Loudness & dynamics": 4,
    "Chất lượng file": 5,
  };
  const impactOrder: Record<Impact, number> = { Cao: 0, "Trung bình": 1, Thấp: 2 };
  findings.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact] || sectionOrder[a.section] - sectionOrder[b.section]);

  const strengths: string[] = [];
  if (!demo.stereo.polarityRisk && demo.stereo.correlation >= 0.2) strengths.push("Stereo không có dấu hiệu đảo cực nghiêm trọng và vẫn giữ được phần center.");
  if (Math.abs(demo.stereo.balanceDb) <= 1) strengths.push("Cân bằng trái/phải ổn định trên toàn bài.");
  if (demo.loudness.truePeakDbtp <= -1) strengths.push("True peak còn headroom phù hợp, chưa ép limiter quá sát 0 dBTP.");
  if (demo.motion.suddenEvents.length <= 2) strengths.push("Ít thay đổi level đột ngột, phù hợp trải nghiệm Deep Sleep.");
  if (!demo.motion.outroCutRisk) strengths.push("Outro đi về mức rất nhỏ, không có dấu hiệu cắt đuôi rõ ràng.");
  if (!strengths.length) strengths.push("Demo có cấu trúc đủ rõ để tiếp tục tinh chỉnh theo Reference.");

  const highCount = findings.filter((finding) => finding.impact === "Cao").length;
  const mediumCount = findings.filter((finding) => finding.impact === "Trung bình").length;
  const qualityScore = clamp(Math.round(100 - highCount * 15 - mediumCount * 7 - findings.filter((finding) => finding.impact === "Thấp").length * 2), 28, 96);
  const releaseVerdict = demo.stereo.polarityRisk || highCount >= 2
    ? "Chưa sẵn sàng phát hành"
    : highCount >= 1 || mediumCount >= 3
      ? "Nên chỉnh trước khi phát hành"
      : "Có thể phát hành sau khi kiểm tra tai nghe";
  const threeBiggestDifferences = findings.filter((finding) => !finding.positive).slice(0, 3).map((finding) => finding.title);
  const keepElements = strengths.slice(0, 3);
  if (referenceWarnings.length) keepElements.push("Không sao chép các điểm kỹ thuật kém đã được cảnh báo ở Reference.");

  const good = strengths.slice(0, 3);
  const priorityFindings = findings.filter((finding) => finding.impact !== "Thấp").slice(0, 4);
  const priority = priorityFindings.map((finding) => `${finding.timestamp}: ${finding.title}. ${finding.recommendation}`);
  const supplemental = findings.filter((finding) => !priorityFindings.includes(finding)).slice(0, 4).map((finding) => `${finding.timestamp}: ${finding.title}. ${finding.recommendation}`);
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

export async function analyzePair(demoFile: File, referenceFile: File, onProgress: ProgressCallback): Promise<PairAnalysis> {
  onProgress(1, "Đang chuẩn bị engine đo lường");
  const demo = await analyzeSingle(demoFile, (fraction, label) => onProgress(3 + fraction * 45, `Demo: ${label}`));
  await waitForMainThread();
  const reference = await analyzeSingle(referenceFile, (fraction, label) => onProgress(50 + fraction * 45, `Reference: ${label}`));
  onProgress(96, "Đang loudness-match và đối chiếu kết quả");
  await waitForMainThread();
  const result = buildPairAnalysis(demo, reference);
  onProgress(100, "Đã hoàn tất báo cáo");
  return result;
}
