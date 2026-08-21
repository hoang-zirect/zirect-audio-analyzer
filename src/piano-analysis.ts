import { decodeAudioFile, downmixChannels } from "./audio-composition";

export type MidiNote = { note: number; name: string; start: number; duration: number; velocity: number; track?: number };
export type ChordEvent = { start: number; end: number; name: string; roman: string };
export type MelodyMetric = { label: string; score: number; explanation: string };
export type Tonality = { tonic: number; mode: "major" | "minor" };
export type PianoReport = {
  bpm: number; timeSignature: string; key: string; duration: number; noteRange: string;
  notes: MidiNote[]; chords: ChordEvent[]; progression: string; metrics: MelodyMetric[]; score: number;
};
export type MidiPerformanceMetrics = { notesPerMinute: number; restPercent: number; averageInterval: number; leapsOver5: number; leapsOver7: number; range: number; chordChangesPerMinute: number; leftNotesPerChord: number; motifRepetitions: number; averagePhraseLength: number; denseSections: Array<{ start: number; notesPerMinute: number }> };

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] } as const;
const ROMAN = { major: ["I", "ii", "iii", "IV", "V", "vi", "vii°"], minor: ["i", "ii°", "III", "iv", "v", "VI", "VII"] } as const;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const noteName = (n: number) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

function readVariable(data: Uint8Array, state: { p: number }) {
  let value = 0; let byte = 0;
  do { byte = data[state.p++]; value = (value << 7) | (byte & 0x7f); } while (byte & 0x80);
  return value;
}

/** Parses Standard MIDI files without uploading them or requiring a third-party API. */
export function parseMidi(buffer: ArrayBuffer): PianoReport {
  const d = new Uint8Array(buffer); const view = new DataView(buffer);
  if (String.fromCharCode(...d.slice(0, 4)) !== "MThd") throw new Error("This is not a Standard MIDI file.");
  const tracks = view.getUint16(10); const division = view.getUint16(12);
  if (division & 0x8000) throw new Error("SMPTE-timed MIDI is not supported.");
  let p = 8 + view.getUint32(4); const rawNotes: Array<{ note: number; start: number; end: number; velocity: number; track: number }> = [];
  const tempos: Array<{ tick: number; mpqn: number; order: number }> = [];
  let tempoOrder = 0; let signature = "4/4"; let declaredTonality: Tonality | undefined;
  for (let t = 0; t < tracks; t++) {
    if (String.fromCharCode(...d.slice(p, p + 4)) !== "MTrk") throw new Error("The MIDI track data is malformed.");
    const end = p + 8 + view.getUint32(p + 4); const s = { p: p + 8 }; let tick = 0; let status = 0;
    const active = new Map<string, Array<{ tick: number; velocity: number }>>();
    while (s.p < end) {
      tick += readVariable(d, s); let first = d[s.p++];
      if (first < 0x80) s.p--; else status = first;
      if (status === 0xff) {
        const type = d[s.p++]; const length = readVariable(d, s);
        if (type === 0x51 && length === 3) tempos.push({ tick, mpqn: (d[s.p] << 16) | (d[s.p + 1] << 8) | d[s.p + 2], order: tempoOrder++ });
        if (type === 0x58 && length >= 2) signature = `${d[s.p]}/${2 ** d[s.p + 1]}`;
        if (type === 0x59 && length >= 2) { const fifths = new Int8Array(d.buffer, d.byteOffset + s.p, 1)[0]; declaredTonality = tonalityFromFifths(fifths, d[s.p + 1] === 1); }
        s.p += length; continue;
      }
      if (status === 0xf0 || status === 0xf7) { s.p += readVariable(d, s); continue; }
      const kind = status & 0xf0; const channel = status & 0x0f; const a = d[s.p++]; const b = kind === 0xc0 || kind === 0xd0 ? 0 : d[s.p++];
      if (kind === 0x90 && b > 0) { const key = `${channel}:${a}`; active.set(key, [...(active.get(key) ?? []), { tick, velocity: b }]); }
      if (kind === 0x80 || (kind === 0x90 && b === 0)) { const key = `${channel}:${a}`; const starts = active.get(key); const on = starts?.shift(); if (on) rawNotes.push({ note: a, start: on.tick, end: Math.max(tick, on.tick + 1), velocity: on.velocity, track: t }); }
    }
    p = end;
  }
  const tempoMap = [{ tick: 0, mpqn: 500000, order: -1 }, ...tempos]
    .sort((a, b) => a.tick - b.tick || a.order - b.order)
    .filter((event, index, all) => index === all.length - 1 || event.tick !== all[index + 1].tick);
  const tickToSeconds = (tick: number) => { let seconds = 0; let prev = 0; let tempo = tempoMap[0].mpqn; for (const e of tempoMap.slice(1)) { if (e.tick >= tick) break; seconds += (e.tick - prev) * tempo / division / 1e6; prev = e.tick; tempo = e.mpqn; } return seconds + (tick - prev) * tempo / division / 1e6; };
  const notes = rawNotes.map(n => ({ note: n.note, name: noteName(n.note), start: tickToSeconds(n.start), duration: tickToSeconds(n.end) - tickToSeconds(n.start), velocity: n.velocity, track: n.track })).sort((a, b) => a.start - b.start || a.note - b.note);
  if (!notes.length) throw new Error("No playable notes were found in this MIDI file.");
  const tonality = declaredTonality ?? { tonic: inferTonic(notes), mode: "major" as const }; const key = `${NAMES[tonality.tonic]} ${tonality.mode}`;
  const chords = inferChords(notes, tonality); const metrics = scoreMelody(notes, tonality, signature);
  return { bpm: Math.round(60e6 / tempoMap[0].mpqn), timeSignature: signature, key, duration: Math.max(...notes.map(n => n.start + n.duration)), noteRange: `${noteName(Math.min(...notes.map(n => n.note)))}–${noteName(Math.max(...notes.map(n => n.note)))}`, notes, chords, progression: chords.map(c => c.roman).filter((v, i, a) => v !== a[i - 1]).join(" – "), metrics, score: Math.round(metrics.reduce((s, m) => s + m.score, 0) / metrics.length) };
}

function tonalityFromFifths(fifths: number, minor: boolean): Tonality { const roots = minor ? [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10] : [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1]; return { tonic: roots[Math.max(0, Math.min(14, fifths + 7))], mode: minor ? "minor" : "major" }; }
function inferTonic(notes: MidiNote[]) { const weights = Array(12).fill(0); notes.forEach(n => weights[n.note % 12] += n.duration * (.4 + n.velocity / 127)); return weights.indexOf(Math.max(...weights)); }
export function inferChords(notes: MidiNote[], tonality: Tonality) {
  const duration = Math.max(...notes.map(n => n.start + n.duration)); const step = Math.max(.5, duration / 32); const out: ChordEvent[] = [];
  for (let start = 0; start < duration; start += step) { const pcs = Array(12).fill(0); const active = notes.filter(n => n.start < start + step && n.start + n.duration > start); if (!active.length) continue; active.forEach(n => pcs[n.note % 12] += Math.min(n.start + n.duration, start + step) - Math.max(n.start, start)); let best = { root: 0, minor: false, value: -1 }; for (let root = 0; root < 12; root++) for (const minor of [false, true]) { const value = pcs[root] + pcs[(root + (minor ? 3 : 4)) % 12] * .8 + pcs[(root + 7) % 12] * .7; if (value > best.value) best = { root, minor, value }; } const degree = (SCALES[tonality.mode] as readonly number[]).indexOf((best.root - tonality.tonic + 12) % 12); const roman = degree >= 0 ? ROMAN[tonality.mode][degree] : NAMES[best.root]; const name = `${NAMES[best.root]}${best.minor ? "m" : ""}`; const previous = out.at(-1); if (previous?.name === name && Math.abs(previous.end - start) < .001) previous.end = Math.min(duration, start + step); else out.push({ start, end: Math.min(duration, start + step), name, roman }); }
  return out;
}
export function extractTopMelody(notes: MidiNote[]) {
  const onsetTolerance = .02;
  const sustainedOverlapTolerance = .03;
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.note - a.note);
  const lead: MidiNote[] = [];
  for (let index = 0; index < sorted.length;) {
    const onset = sorted[index].start;
    const group: MidiNote[] = [];
    while (index < sorted.length && sorted[index].start - onset <= onsetTolerance) group.push(sorted[index++]);
    const candidate = group.reduce((highest, note) => note.note > highest.note ? note : highest);
    const soundingHigherVoice = lead.some(note =>
      note.note > candidate.note && note.start < onset && note.start + note.duration > onset + sustainedOverlapTolerance,
    );
    if (!soundingHigherVoice) lead.push(candidate);
  }
  return lead;
}

export const melodyContourNotes = (notes: MidiNote[]) => extractTopMelody(notes);

export function analyzeMidiPerformance(report: PianoReport, melodyTrack?: number, leftTrack?: number): MidiPerformanceMetrics {
  const melodySource = melodyTrack === undefined ? report.notes : report.notes.filter(note => note.track === melodyTrack);
  const melody = extractTopMelody(melodySource);
  const left = leftTrack === undefined ? [] : report.notes.filter(note => note.track === leftTrack);
  const durationMinutes = Math.max(report.duration / 60, 1 / 60);
  const intervals = melody.slice(1).map((note, index) => Math.abs(note.note - melody[index].note));
  const rests = melody.slice(1).reduce((sum, note, index) => sum + Math.max(0, note.start - melody[index].start - melody[index].duration), 0);
  const phraseLengths: number[] = []; let phraseStart = melody[0]?.start ?? 0;
  melody.slice(1).forEach((note, index) => { if (note.start - melody[index].start - melody[index].duration > .5) { phraseLengths.push(melody[index].start + melody[index].duration - phraseStart); phraseStart = note.start; } });
  if (melody.length) phraseLengths.push(melody.at(-1)!.start + melody.at(-1)!.duration - phraseStart);
  const motifRepetitions = intervals.slice(0, -5).filter((_, index) => intervals.slice(index, index + 3).join() === intervals.slice(index + 3, index + 6).join()).length;
  const window = 10; const denseSections: Array<{ start: number; notesPerMinute: number }> = [];
  for (let start = 0; start < report.duration; start += window) { const rate = melody.filter(note => note.start >= start && note.start < start + window).length * 6; if (rate > 90) denseSections.push({ start, notesPerMinute: rate }); }
  return { notesPerMinute: Math.round(melody.length / durationMinutes), restPercent: Math.round(rests / Math.max(report.duration, .01) * 100), averageInterval: Number((intervals.reduce((sum, value) => sum + value, 0) / Math.max(1, intervals.length)).toFixed(1)), leapsOver5: intervals.filter(value => value > 5).length, leapsOver7: intervals.filter(value => value > 7).length, range: melody.length ? Math.max(...melody.map(note => note.note)) - Math.min(...melody.map(note => note.note)) : 0, chordChangesPerMinute: Number((report.chords.length / durationMinutes).toFixed(1)), leftNotesPerChord: Number((left.length / Math.max(1, report.chords.length)).toFixed(1)), motifRepetitions, averagePhraseLength: Number((phraseLengths.reduce((sum, value) => sum + value, 0) / Math.max(1, phraseLengths.length)).toFixed(1)), denseSections };
}
export function scoreMelody(notes: MidiNote[], tonality: Tonality | number, signature = "4/4"): MelodyMetric[] {
  const resolved = typeof tonality === "number" ? { tonic: tonality, mode: "major" as const } : tonality; const lead = extractTopMelody(notes); const intervals = lead.slice(1).map((n, i) => n.note - lead[i].note); const uniqueIntervals = new Set(intervals).size; const range = Math.max(...lead.map(n => n.note)) - Math.min(...lead.map(n => n.note)); const scaleFit = lead.filter(n => (SCALES[resolved.mode] as readonly number[]).includes((n.note - resolved.tonic + 12) % 12)).length / lead.length; const rests = lead.slice(1).filter((n, i) => n.start - (lead[i].start + lead[i].duration) > .15).length; const repeats = intervals.slice(0, -3).filter((_, i) => intervals.slice(i, i + 3).join() === intervals.slice(i + 3, i + 6).join()).length; const durations = new Set(lead.map(n => Math.round(n.duration * 8))).size;
  return [
    { label: "Motif & repetition", score: clamp(45 + repeats * 15), explanation: `${repeats} recurring three-interval patterns; rewards recognition without judging production.` },
    { label: "Phrasing", score: clamp(50 + Math.min(35, rests * 7)), explanation: `${rests} audible phrase breaths create musical punctuation.` },
    { label: "Contour", score: clamp(50 + Math.min(35, uniqueIntervals * 4) - Math.max(0, uniqueIntervals - 10) * 3), explanation: `${uniqueIntervals} interval shapes balance direction and cohesion.` },
    { label: "Rhythmic variety", score: clamp(45 + durations * 9), explanation: `${durations} distinct note-length values in ${signature}.` },
    { label: "Tonal fit", score: clamp(scaleFit * 100), explanation: `${Math.round(scaleFit * 100)}% of melody notes fit the inferred diatonic collection.` },
    { label: "Range", score: clamp(100 - Math.abs(range - 16) * 4), explanation: `${range} semitones; a singable, expressive target is roughly 12–20.` },
    { label: "Cadence", score: clamp(lead.at(-1) && ([0, 7] as number[]).includes((lead.at(-1)!.note - resolved.tonic + 12) % 12) ? 90 : 52), explanation: "Checks whether the closing pitch supports tonal resolution." },
    { label: "Memorability", score: clamp(35 + repeats * 10 + scaleFit * 30 + Math.min(20, rests * 3)), explanation: "Composite of motif return, tonal clarity, and phrase separation." },
  ];
}

export async function analyzeAudioTonality(file: File, decodedBuffer?: AudioBuffer) {
  const buffer = decodedBuffer ?? await decodeAudioFile(file);
  const data = downmixChannels(Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index)));
  const sr = buffer.sampleRate;
  const hop = Math.max(1, Math.floor(sr * .05));
  const energy: number[] = [];
  for (let i = 0; i < data.length; i += hop) {
    let sum = 0;
    for (let j = i; j < Math.min(data.length, i + hop); j++) sum += data[j] * data[j];
    energy.push(Math.sqrt(sum / Math.max(1, Math.min(hop, data.length - i))));
  }
  const onsets = energy.map((value, index) => index && value > energy[index - 1] * 1.35 && value > .01 ? 1 : 0);
  const { bpm, strength } = detectBpmFromOnsets(onsets);
  const peakEnergy = Math.max(...energy, 1e-6);
  const waveform = Array.from({ length: 180 }, (_, index) => {
    const from = Math.floor(index * energy.length / 180);
    const to = Math.max(from + 1, Math.floor((index + 1) * energy.length / 180));
    return Math.max(...energy.slice(from, to), 0) / peakEnergy;
  });
  const activeFrames = energy.filter(value => value > peakEnergy * .12).length;
  const highActivitySections = waveform
    .map((value, index) => ({ value, time: index / waveform.length * buffer.duration }))
    .filter(point => point.value > .72)
    .filter((point, index, all) => index === 0 || point.time - all[index - 1].time > 5)
    .slice(0, 8);
  const chroma = Array(12).fill(0);
  const stride = Math.max(1, Math.floor(data.length / 120000));
  for (let midi = 36; midi <= 84; midi++) {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    let real = 0, imaginary = 0;
    for (let i = 0; i < data.length; i += stride) {
      const phase = 2 * Math.PI * frequency * i / sr;
      real += data[i] * Math.cos(phase);
      imaginary -= data[i] * Math.sin(phase);
    }
    chroma[midi % 12] += Math.hypot(real, imaginary);
  }
  const tonic = chroma.indexOf(Math.max(...chroma));
  const tonalConfidence = Math.round(100 * chroma[tonic] / Math.max(1, chroma.reduce((sum, value) => sum + value)));
  return {
    bpm,
    bpmConfidence: clamp(35 + strength * 4),
    key: NAMES[tonic],
    keyConfidence: clamp(tonalConfidence * 4),
    duration: buffer.duration,
    waveform,
    activityPercent: Math.round(activeFrames / Math.max(1, energy.length) * 100),
    restPercent: Math.round((1 - activeFrames / Math.max(1, energy.length)) * 100),
    highActivitySections,
  };
}

export function detectBpmFromOnsets(onsets: number[], frameSeconds = .05) {
  const minimumBpm = 30;
  const maximumBpm = 180;
  const minimumLag = Math.max(1, Math.floor(60 / maximumBpm / frameSeconds));
  const maximumLag = Math.max(minimumLag, Math.ceil(60 / minimumBpm / frameSeconds));
  let bestLag = Math.round(60 / 60 / frameSeconds);
  let strength = -1;
  for (let lag = minimumLag; lag <= maximumLag; lag++) {
    let score = 0;
    for (let index = lag; index < onsets.length; index++) score += onsets[index] * onsets[index - lag];
    if (score > strength) { strength = score; bestLag = lag; }
  }
  return { bpm: Math.round(60 / (bestLag * frameSeconds)), strength: Math.max(0, strength) };
}
