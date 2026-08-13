export type MidiNote = { note: number; name: string; start: number; duration: number; velocity: number };
export type ChordEvent = { start: number; end: number; name: string; roman: string };
export type MelodyMetric = { label: string; score: number; explanation: string };
export type PianoReport = {
  bpm: number; timeSignature: string; key: string; duration: number; noteRange: string;
  notes: MidiNote[]; chords: ChordEvent[]; progression: string; metrics: MelodyMetric[]; score: number;
};

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const ROMAN = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
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
  let p = 8 + view.getUint32(4); const rawNotes: Array<{ note: number; start: number; end: number; velocity: number }> = [];
  const tempos: Array<{ tick: number; mpqn: number }> = [{ tick: 0, mpqn: 500000 }];
  let signature = "4/4"; let declaredKey: string | undefined;
  for (let t = 0; t < tracks; t++) {
    if (String.fromCharCode(...d.slice(p, p + 4)) !== "MTrk") throw new Error("The MIDI track data is malformed.");
    const end = p + 8 + view.getUint32(p + 4); const s = { p: p + 8 }; let tick = 0; let status = 0;
    const active = new Map<string, Array<{ tick: number; velocity: number }>>();
    while (s.p < end) {
      tick += readVariable(d, s); let first = d[s.p++];
      if (first < 0x80) s.p--; else status = first;
      if (status === 0xff) {
        const type = d[s.p++]; const length = readVariable(d, s);
        if (type === 0x51 && length === 3) tempos.push({ tick, mpqn: (d[s.p] << 16) | (d[s.p + 1] << 8) | d[s.p + 2] });
        if (type === 0x58 && length >= 2) signature = `${d[s.p]}/${2 ** d[s.p + 1]}`;
        if (type === 0x59 && length >= 2) { const fifths = new Int8Array(d.buffer, d.byteOffset + s.p, 1)[0]; declaredKey = keyFromFifths(fifths, d[s.p + 1] === 1); }
        s.p += length; continue;
      }
      if (status === 0xf0 || status === 0xf7) { s.p += readVariable(d, s); continue; }
      const kind = status & 0xf0; const channel = status & 0x0f; const a = d[s.p++]; const b = kind === 0xc0 || kind === 0xd0 ? 0 : d[s.p++];
      if (kind === 0x90 && b > 0) { const key = `${channel}:${a}`; active.set(key, [...(active.get(key) ?? []), { tick, velocity: b }]); }
      if (kind === 0x80 || (kind === 0x90 && b === 0)) { const key = `${channel}:${a}`; const starts = active.get(key); const on = starts?.shift(); if (on) rawNotes.push({ note: a, start: on.tick, end: Math.max(tick, on.tick + 1), velocity: on.velocity }); }
    }
    p = end;
  }
  tempos.sort((a, b) => a.tick - b.tick);
  const tickToSeconds = (tick: number) => { let seconds = 0; let prev = 0; let tempo = tempos[0].mpqn; for (const e of tempos.slice(1)) { if (e.tick >= tick) break; seconds += (e.tick - prev) * tempo / division / 1e6; prev = e.tick; tempo = e.mpqn; } return seconds + (tick - prev) * tempo / division / 1e6; };
  const notes = rawNotes.map(n => ({ note: n.note, name: noteName(n.note), start: tickToSeconds(n.start), duration: tickToSeconds(n.end) - tickToSeconds(n.start), velocity: n.velocity })).sort((a, b) => a.start - b.start || a.note - b.note);
  if (!notes.length) throw new Error("No playable notes were found in this MIDI file.");
  const tonic = inferTonic(notes); const key = declaredKey ?? `${NAMES[tonic]} major`;
  const chords = inferChords(notes, tonic); const metrics = scoreMelody(notes, tonic, signature);
  return { bpm: Math.round(60e6 / tempos[0].mpqn), timeSignature: signature, key, duration: Math.max(...notes.map(n => n.start + n.duration)), noteRange: `${noteName(Math.min(...notes.map(n => n.note)))}–${noteName(Math.max(...notes.map(n => n.note)))}`, notes, chords, progression: chords.map(c => c.roman).filter((v, i, a) => v !== a[i - 1]).join(" – "), metrics, score: Math.round(metrics.reduce((s, m) => s + m.score, 0) / metrics.length) };
}

function keyFromFifths(fifths: number, minor: boolean) { const majors = ["C♭", "G♭", "D♭", "A♭", "E♭", "B♭", "F", "C", "G", "D", "A", "E", "B", "F♯", "C♯"]; const root = majors[Math.max(0, Math.min(14, fifths + 7))]; return `${root} ${minor ? "minor" : "major"}`; }
function inferTonic(notes: MidiNote[]) { const weights = Array(12).fill(0); notes.forEach(n => weights[n.note % 12] += n.duration * (.4 + n.velocity / 127)); return weights.indexOf(Math.max(...weights)); }
function inferChords(notes: MidiNote[], tonic: number) {
  const duration = Math.max(...notes.map(n => n.start + n.duration)); const step = Math.max(.5, duration / 32); const out: ChordEvent[] = [];
  for (let start = 0; start < duration; start += step) { const pcs = Array(12).fill(0); notes.filter(n => n.start < start + step && n.start + n.duration > start).forEach(n => pcs[n.note % 12] += Math.min(n.start + n.duration, start + step) - Math.max(n.start, start)); let best = { root: 0, minor: false, value: -1 }; for (let root = 0; root < 12; root++) for (const minor of [false, true]) { const value = pcs[root] + pcs[(root + (minor ? 3 : 4)) % 12] * .8 + pcs[(root + 7) % 12] * .7; if (value > best.value) best = { root, minor, value }; } const degree = MAJOR.indexOf((best.root - tonic + 12) % 12); const roman = degree >= 0 ? ROMAN[degree] : `♭/${NAMES[best.root]}`; const name = `${NAMES[best.root]}${best.minor ? "m" : ""}`; if (out.at(-1)?.name === name) out[out.length - 1].end = Math.min(duration, start + step); else out.push({ start, end: Math.min(duration, start + step), name, roman }); }
  return out;
}
export function scoreMelody(notes: MidiNote[], tonic: number, signature = "4/4"): MelodyMetric[] {
  const lead = notes.filter((n, i) => i === 0 || n.start !== notes[i - 1].start || n.note >= notes[i - 1].note); const intervals = lead.slice(1).map((n, i) => n.note - lead[i].note); const uniqueIntervals = new Set(intervals).size; const range = Math.max(...lead.map(n => n.note)) - Math.min(...lead.map(n => n.note)); const scaleFit = lead.filter(n => MAJOR.includes((n.note - tonic + 12) % 12)).length / lead.length; const rests = lead.slice(1).filter((n, i) => n.start - (lead[i].start + lead[i].duration) > .15).length; const repeats = intervals.slice(0, -3).filter((_, i) => intervals.slice(i, i + 3).join() === intervals.slice(i + 3, i + 6).join()).length; const durations = new Set(lead.map(n => Math.round(n.duration * 8))).size;
  return [
    { label: "Motif & repetition", score: clamp(45 + repeats * 15), explanation: `${repeats} recurring three-interval patterns; rewards recognition without judging production.` },
    { label: "Phrasing", score: clamp(50 + Math.min(35, rests * 7)), explanation: `${rests} audible phrase breaths create musical punctuation.` },
    { label: "Contour", score: clamp(50 + Math.min(35, uniqueIntervals * 4) - Math.max(0, uniqueIntervals - 10) * 3), explanation: `${uniqueIntervals} interval shapes balance direction and cohesion.` },
    { label: "Rhythmic variety", score: clamp(45 + durations * 9), explanation: `${durations} distinct note-length values in ${signature}.` },
    { label: "Tonal fit", score: clamp(scaleFit * 100), explanation: `${Math.round(scaleFit * 100)}% of melody notes fit the inferred diatonic collection.` },
    { label: "Range", score: clamp(100 - Math.abs(range - 16) * 4), explanation: `${range} semitones; a singable, expressive target is roughly 12–20.` },
    { label: "Cadence", score: clamp(lead.at(-1) && [0, 4, 7].includes((lead.at(-1)!.note - tonic + 12) % 12) ? 90 : 52), explanation: "Checks whether the closing pitch supports tonal resolution." },
    { label: "Memorability", score: clamp(35 + repeats * 10 + scaleFit * 30 + Math.min(20, rests * 3)), explanation: "Composite of motif return, tonal clarity, and phrase separation." },
  ];
}

export async function analyzeAudioTonality(file: File) {
  const context = new AudioContext(); try { const buffer = await context.decodeAudioData(await file.arrayBuffer()); const data = buffer.getChannelData(0); const sr = buffer.sampleRate; const hop = Math.max(1, Math.floor(sr * .05)); const energy: number[] = []; for (let i = 0; i < data.length; i += hop) { let sum = 0; for (let j = i; j < Math.min(data.length, i + hop); j++) sum += data[j] * data[j]; energy.push(Math.sqrt(sum / hop)); } const onsets = energy.map((e, i) => i && e > energy[i - 1] * 1.35 && e > .01 ? 1 : 0); let bestLag = 20; let best = 0; for (let lag = 6; lag <= 24; lag++) { let score = 0; for (let i = lag; i < onsets.length; i++) score += onsets[i] * onsets[i - lag]; if (score > best) { best = score; bestLag = lag; } } let bpm = 1200 / bestLag; while (bpm < 60) bpm *= 2; while (bpm > 180) bpm /= 2; const chroma = Array(12).fill(0); const stride = Math.max(1, Math.floor(data.length / 120000)); for (let midi = 36; midi <= 84; midi++) { const freq = 440 * 2 ** ((midi - 69) / 12); let re = 0, im = 0; for (let i = 0; i < data.length; i += stride) { const phase = 2 * Math.PI * freq * i / sr; re += data[i] * Math.cos(phase); im -= data[i] * Math.sin(phase); } chroma[midi % 12] += Math.hypot(re, im); } const tonic = chroma.indexOf(Math.max(...chroma)); const confidence = Math.round(100 * chroma[tonic] / Math.max(1, chroma.reduce((a, b) => a + b))); return { bpm: Math.round(bpm), bpmConfidence: clamp(35 + best * 4), key: `${NAMES[tonic]} major`, keyConfidence: clamp(confidence * 4), duration: buffer.duration }; } finally { await context.close(); }
}
