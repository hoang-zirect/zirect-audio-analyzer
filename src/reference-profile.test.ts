import { describe, expect, it } from "vitest";
import { buildReferenceProfile, createReferenceTrack, evaluateDemoAgainstProfile, exportReferenceProfile, importReferenceProfile, profileIsReady } from "./reference-profile";
import type { CompositionAnalysis } from "./audio-composition";
import { summarizePianoTranscription } from "./piano-transcription";

const composition = (value: number, duration = 120): CompositionAnalysis => ({
  duration,
  waveform: [0, .5, 1],
  bpm: 50 + value,
  tempoStability: 80,
  rubato: 20,
  tempoCandidates: [{ bpm: 50 + value, score: 90 }],
  tempoAmbiguous: false,
  tonalCenter: "C",
  onsetDensity: 30 + value,
  restPercent: 40 - value,
  longestRest: 3,
  averagePhraseLength: 10,
  introSilence: 1,
  outroSilence: 2,
  repetition: 25,
  melodicMovement: 15,
  harmonicChangeRate: 6,
  activityPercent: 60 + value,
  sections: Array.from({ length: 8 }, (_, index) => ({
    start: index / 8 * duration,
    end: (index + 1) / 8 * duration,
    onsetDensity: 30 + value + index,
    restPercent: 40 - value,
    longestRest: 3,
    phraseLength: 10,
    repetition: 25,
    melodicMovement: 15,
    harmonicChangeRate: 6,
    activity: 60 + value,
  })),
  confidence: { tempo: "High", rubato: "High", tonalCenter: "Medium", onsets: "High", phrasing: "High", repetition: "Medium", melodicMovement: "High", harmonicChange: "Medium", sections: "High" },
});

const transcription = (offset = 0) => summarizePianoTranscription(Array.from({ length: 24 }, (_, index) => ({
  start: index * 4.5,
  duration: .8,
  pitch: 64 + offset + index % 5,
  amplitude: .8,
})), 120);

describe("reference profile", () => {
  it("builds empirical ranges from five or more tracks", () => {
    const tracks = Array.from({ length: 5 }, (_, index) => createReferenceTrack(`Reference ${index + 1}`, composition(index), transcription(index % 2)));
    const profile = buildReferenceProfile("Calm Piano", tracks);
    expect(profileIsReady(profile)).toBe(true);
    expect(profile.metricStats.confirmedBpm?.sampleSize).toBe(5);
    expect(profile.sectionStats).toHaveLength(8);
    expect(profile.sectionStats[0].melodyNotesPerMinute?.sampleSize).toBe(5);
  });

  it("stores derived features but not audio, waveform or raw note sequences", () => {
    const profile = buildReferenceProfile("Private profile", [createReferenceTrack("Track.wav", composition(0), transcription())]);
    const json = exportReferenceProfile(profile);
    expect(json).not.toContain("waveform");
    expect(json).not.toContain("melodyNotes\"");
    expect(json).not.toContain("\"notes\"");
    expect(importReferenceProfile(json).tracks).toHaveLength(1);
  });

  it("ranks outlying demo sections and keeps profile fit separate from quality", () => {
    const tracks = Array.from({ length: 6 }, (_, index) => createReferenceTrack(`Reference ${index + 1}`, composition(index), transcription()));
    const profile = buildReferenceProfile("Calm Piano", tracks);
    const outlier = composition(35);
    outlier.sections[3].onsetDensity = 180;
    const evaluation = evaluateDemoAgainstProfile(outlier, transcription(8), profile);
    expect(evaluation.fitScore).toBeLessThan(100);
    expect(evaluation.findings.length).toBeGreaterThan(0);
    expect(evaluation.findings[0].rank).toBe(1);
    expect(evaluation.findings.some(finding => finding.start !== undefined)).toBe(true);
  });
});
