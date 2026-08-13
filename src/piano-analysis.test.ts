import { describe, expect, it } from "vitest";
import { parseMidi, scoreMelody } from "./piano-analysis";

const variable = (value: number) => { const out = [value & 0x7f]; while ((value >>= 7)) out.unshift((value & 0x7f) | 0x80); return out; };
function midiFixture() {
  const events = [
    0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, // 120 BPM
    0, 0xff, 0x58, 4, 4, 2, 24, 8, // 4/4
    0, 0xff, 0x59, 2, 0, 0, // C major
    0, 0x90, 60, 90, ...variable(480), 0x80, 60, 0,
    0, 0x90, 64, 90, ...variable(480), 0x80, 64, 0,
    0, 0x90, 67, 90, ...variable(480), 0x80, 67, 0,
    0, 0x90, 72, 90, ...variable(480), 0x80, 72, 0,
    0, 0xff, 0x2f, 0,
  ];
  const bytes = [77,84,104,100,0,0,0,6,0,0,0,1,1,224, 77,84,114,107, ...[(events.length>>>24)&255,(events.length>>>16)&255,(events.length>>>8)&255,events.length&255], ...events];
  return new Uint8Array(bytes).buffer;
}

describe("parseMidi", () => {
  it("parses tempo, meter, key, range, notes and harmony", () => {
    const result = parseMidi(midiFixture());
    expect(result.bpm).toBe(120); expect(result.timeSignature).toBe("4/4"); expect(result.key).toBe("C major");
    expect(result.duration).toBeCloseTo(2); expect(result.noteRange).toBe("C4–C5"); expect(result.notes).toHaveLength(4);
    expect(result.chords.length).toBeGreaterThan(0); expect(result.metrics).toHaveLength(8);
  });
  it("rejects non-MIDI input", () => expect(() => parseMidi(new Uint8Array([1,2,3,4]).buffer)).toThrow(/not a Standard MIDI/));
});

describe("scoreMelody", () => { it("keeps all heuristic scores transparent and bounded", () => { const notes = Array.from({length: 10}, (_, i) => ({ note: 60 + [0,2,4,2,0][i%5], name: "", start: i*.5, duration: .4, velocity: 80 })); const metrics = scoreMelody(notes, 0); expect(metrics.map(m => m.label)).toEqual(["Motif & repetition","Phrasing","Contour","Rhythmic variety","Tonal fit","Range","Cadence","Memorability"]); expect(metrics.every(m => m.score >= 0 && m.score <= 100 && m.explanation.length > 10)).toBe(true); }); });
