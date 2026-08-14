import { describe, expect, it } from "vitest";
import { extractEstimatedTopVoice, summarizePianoTranscription, type TranscribedPianoNote } from "./piano-transcription";

const note = (start: number, pitch: number, duration = .5, amplitude = .8): TranscribedPianoNote => ({ start, pitch, duration, amplitude });

describe("piano transcription summaries", () => {
  it("extracts the highest note from simultaneous piano onsets", () => {
    const melody = extractEstimatedTopVoice([note(0, 48), note(.02, 72), note(1, 50), note(1.04, 74)]);
    expect(melody.map(item => item.pitch)).toEqual([72, 74]);
  });

  it("reports melody density, rests, range and large leaps transparently", () => {
    const result = summarizePianoTranscription([
      note(0, 48), note(0, 60),
      note(1, 50), note(1, 62),
      note(3, 52), note(3, 74),
      note(5, 53), note(5, 76),
    ], 6);
    expect(result.melodyNotesPerMinute).toBe(40);
    expect(result.melodyRange).toBe(16);
    expect(result.largeLeapsPerMinute).toBe(10);
    expect(result.melodyRestPercent).toBeGreaterThan(60);
    expect(result.sections).toHaveLength(8);
  });

  it("does not produce NaN for silence or an empty transcription", () => {
    const result = summarizePianoTranscription([], 30);
    expect(result.totalNotes).toBe(0);
    expect(result.melodyNotesPerMinute).toBe(0);
    expect(result.melodyRestPercent).toBe(100);
    expect(Object.values(result).some(value => typeof value === "number" && Number.isNaN(value))).toBe(false);
  });
});
