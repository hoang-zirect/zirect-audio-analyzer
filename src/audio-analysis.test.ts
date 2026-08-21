import { describe, expect, it } from "vitest";
import { BAND_DEFINITIONS, buildPairAnalysis, type AudioMetrics, type BandMeasurement } from "./audio-analysis";

function metrics(name: string): AudioMetrics {
  const band = (): BandMeasurement => ({ leftDb: -32, rightDb: -32, meanDb: -32, correlation: .8, widthPercent: 50 });
  const bands = Object.fromEntries(BAND_DEFINITIONS.map(definition => [definition.key, band()])) as AudioMetrics["spectral"]["bands"];
  return {
    meta: { name, extension: "wav", mime: "audio/wav", sizeBytes: 1_000_000, duration: 120, channels: 2, analysisSampleRate: 48_000, sourceSampleRate: 48_000, sourceBitDepth: 24, bitrateKbps: 1_536, comparableHighHz: 20_000 },
    loudness: { integratedLufs: -20, lraLu: 4, rmsDbfs: -24, samplePeakDbfs: -3, truePeakDbtp: -2, crestFactorDb: 12 },
    stereo: { correlation: .8, widthPercent: 50, balanceDb: 0, monoRetentionDb: -1, polarityRisk: false },
    spectral: { bands, curve: [{ frequency: 100, leftDb: -32, rightDb: -32 }, { frequency: 1_000, leftDb: -32, rightDb: -32 }], timeline: [], resonances: [] },
    motion: { onsetProxyPerMinute: 12, suddenEvents: [], introFadeDb: 12, outroEndDb: -80, outroTailDb: -60, outroCutRisk: false },
  };
}

describe("Deep Sleep pair assessment", () => {
  it("keeps identical healthy measurements finite and bounded", () => {
    const result = buildPairAnalysis(metrics("demo.wav"), metrics("reference.wav"));
    expect(result.qualityScore).toBeGreaterThanOrEqual(28);
    expect(result.qualityScore).toBeLessThanOrEqual(96);
    expect(result.loudnessMatch.originalDeltaDb).toBe(0);
    expect(result.bands.every(band => band.deltaDb === 0)).toBe(true);
  });

  it("treats severe demo polarity risk as release-blocking", () => {
    const demo = metrics("demo.wav");
    demo.stereo = { ...demo.stereo, correlation: -.8, monoRetentionDb: -12, polarityRisk: true };
    expect(buildPairAnalysis(demo, metrics("reference.wav")).releaseVerdict).toBe("Not Ready for Release");
  });

  it("flags a broken reference separately so it is not presented as a target", () => {
    const reference = metrics("reference.wav");
    reference.stereo = { ...reference.stereo, correlation: -.8, monoRetentionDb: -12, polarityRisk: true };
    const result = buildPairAnalysis(metrics("demo.wav"), reference);
    expect(result.referenceWarnings.some(finding => finding.title.includes("Reference"))).toBe(true);
    expect(result.keepElements.some(item => item.includes("Do not replicate"))).toBe(true);
  });
});
