import { describe, expect, it } from "vitest";
import { parsePianoHistory, pianoHistoryKey } from "./piano-history";

describe("piano history", () => {
  it("uses file identity rather than name alone", () => {
    expect(pianoHistoryKey({ name: "demo.mp3", size: 10, lastModified: 1 }))
      .not.toBe(pianoHistoryKey({ name: "demo.mp3", size: 11, lastModified: 2 }));
  });

  it("recovers safely from malformed or unrelated storage", () => {
    expect(parsePianoHistory("{")).toEqual([]);
    expect(parsePianoHistory(JSON.stringify([{ version: "V1" }, null, "bad"]))).toEqual([]);
  });

  it("keeps only valid versions and limits history to three", () => {
    const entries = Array.from({ length: 4 }, (_, index) => ({
      version: `V${index + 1}`,
      date: "14/8/2026",
      bpm: 55,
      activity: 60,
      restPercent: 40,
      arScore: 28,
    }));
    expect(parsePianoHistory(JSON.stringify(entries)).map(entry => entry.version)).toEqual(["V2", "V3", "V4"]);
  });
});
