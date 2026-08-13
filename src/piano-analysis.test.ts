import { describe, expect, it } from "vitest";
import { detectBpmFromOnsets, extractTopMelody, inferChords, melodyContourNotes, parseMidi, scoreMelody, type MidiNote } from "./piano-analysis";

const variable = (value: number) => { const out = [value & 0x7f]; while ((value >>= 7)) out.unshift((value & 0x7f) | 0x80); return out; };
const tempo = (bpm: number) => { const mpqn = Math.round(60_000_000 / bpm); return [0xff, 0x51, 3, (mpqn >>> 16) & 255, (mpqn >>> 8) & 255, mpqn & 255]; };
function midiFixture({ bpm = 120, minor = false, tempoChange }: { bpm?: number; minor?: boolean; tempoChange?: number } = {}) {
  const events = [
    0, ...tempo(bpm),
    0, 0xff, 0x58, 4, 4, 2, 24, 8,
    0, 0xff, 0x59, 2, 0, minor ? 1 : 0,
    0, 0x90, 60, 90, ...variable(480), 0x80, 60, 0,
    ...(tempoChange ? [0, ...tempo(tempoChange)] : []),
    0, 0x90, 64, 90, ...variable(480), 0x80, 64, 0,
    0, 0xff, 0x2f, 0,
  ];
  const size = [(events.length >>> 24) & 255, (events.length >>> 16) & 255, (events.length >>> 8) & 255, events.length & 255];
  return new Uint8Array([77,84,104,100,0,0,0,6,0,0,0,1,1,224, 77,84,114,107,...size,...events]).buffer;
}
const note = (note: number, start: number, duration = .4): MidiNote => ({ note, name: "", start, duration, velocity: 80 });

describe("parseMidi", () => {
  it("uses a 90 BPM event at tick zero instead of the 120 BPM fallback", () => expect(parseMidi(midiFixture({ bpm: 90 })).bpm).toBe(90));
  it("applies tempo changes while converting ticks to seconds", () => expect(parseMidi(midiFixture({ bpm: 90, tempoChange: 120 })).duration).toBeCloseTo(7 / 6, 4));
  it("maps zero fifths in minor mode to A minor", () => expect(parseMidi(midiFixture({ minor: true })).key).toBe("A minor"));
  it("rejects non-MIDI input", () => expect(() => parseMidi(new Uint8Array([1,2,3,4]).buffer)).toThrow(/not a Standard MIDI/));
});

describe("melody voice extraction", () => {
  it("selects the top note at every onset and excludes block-chord bass notes", () => {
    const notes = [note(36, 0), note(48, 0), note(72, 0), note(38, .5), note(50, .5), note(74, .5), note(40, 1), note(52, 1), note(76, 1)];
    expect(extractTopMelody(notes).map(n => n.note)).toEqual([72, 74, 76]);
    expect(scoreMelody(notes, { tonic: 0, mode: "major" }).find(metric => metric.label === "Range")?.explanation).toMatch(/^4 semitones/);
  });
  it("ignores lower accompaniment onsets while a sustained C5 melody is sounding", () => {
    const notes = [note(72, 0, 2), note(52, .5, .3), note(55, 1, .3), note(74, 2, .5)];
    expect(extractTopMelody(notes).map(n => n.note)).toEqual([72, 74]);
  });
  it("uses exactly the same extracted notes for contour and scoring", () => {
    const notes = [note(72, 0, 2), note(52, .5), note(55, 1), note(76, 2)];
    const melody = extractTopMelody(notes);
    expect(melodyContourNotes(notes)).toEqual(melody);
    expect(scoreMelody(notes, { tonic: 0, mode: "major" }).find(metric => metric.label === "Range")?.explanation).toMatch(/^4 semitones/);
  });
});

describe("audio tempo detection", () => {
  it("keeps a genuine 50 BPM pulse at 50 BPM", () => {
    const onsets = Array(121).fill(0); for (let index = 0; index < onsets.length; index += 24) onsets[index] = 1;
    expect(detectBpmFromOnsets(onsets).bpm).toBe(50);
  });
});

describe("chord inference", () => {
  it("leaves silent timeline sections empty instead of inventing C-major chords", () => {
    const notes = [note(48, 0, 1), note(52, 0, 1), note(55, 0, 1), note(50, 3, 1), note(53, 3, 1), note(57, 3, 1)];
    const chords = inferChords(notes, { tonic: 0, mode: "major" });
    expect(chords.some(chord => chord.start >= 1 && chord.end <= 3)).toBe(false);
    expect(chords.every(chord => chord.end <= 1 || chord.start >= 3)).toBe(true);
  });
  it("uses minor-mode scale degrees for Roman numerals", () => {
    const chords = inferChords([note(57, 0, 1), note(60, 0, 1), note(64, 0, 1)], { tonic: 9, mode: "minor" });
    expect(chords[0].name).toBe("Am"); expect(chords[0].roman).toBe("i");
  });
});
