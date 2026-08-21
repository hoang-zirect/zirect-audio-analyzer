import type { NoteEventTime } from "@spotify/basic-pitch";
import { decodeAudioFile, downmixChannels } from "./audio-composition";

export type TranscribedPianoNote = {
  start: number;
  duration: number;
  pitch: number;
  amplitude: number;
};

export type TranscriptionSection = {
  start: number;
  end: number;
  melodyNotesPerMinute: number;
  melodyRestPercent: number;
  averageInterval: number;
  largeLeapsPerMinute: number;
  lowNotesPerMinute: number;
  activityPercent: number;
};

export type PianoTranscriptionSummary = {
  duration: number;
  totalNotes: number;
  totalNotesPerMinute: number;
  melodyNotesPerMinute: number;
  melodyRestPercent: number;
  averageInterval: number;
  largeLeapsPerMinute: number;
  melodyRange: number;
  lowNotesPerMinute: number;
  motifRecurrence: number;
  averagePhraseLength: number;
  confidencePercent: number;
  sections: TranscriptionSection[];
};

export type PianoTranscription = PianoTranscriptionSummary & {
  notes: TranscribedPianoNote[];
  melodyNotes: TranscribedPianoNote[];
};

type BasicPitchInstance = import("@spotify/basic-pitch").BasicPitch;
let basicPitch: BasicPitchInstance | undefined;

const round = (value: number, precision = 1) => Number(value.toFixed(precision));
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const clamp = (value: number, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, value));

function mergeIntervals(intervals: Array<[number, number]>, start = 0, end = Infinity) {
  const sorted = intervals
    .map(([from, to]) => [Math.max(start, from), Math.min(end, to)] as [number, number])
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval[0] > previous[1] + .03) merged.push([...interval]);
    else previous[1] = Math.max(previous[1], interval[1]);
  }
  return merged;
}

/**
 * Choose the highest note from each near-simultaneous onset group. This is a
 * transparent top-voice heuristic, not a claim that the model identified the
 * producer's intended melody track.
 */
export function extractEstimatedTopVoice(notes: TranscribedPianoNote[], onsetWindow = .1) {
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  const melody: TranscribedPianoNote[] = [];
  for (let index = 0; index < sorted.length;) {
    const groupStart = sorted[index].start;
    const group: TranscribedPianoNote[] = [];
    while (index < sorted.length && sorted[index].start - groupStart <= onsetWindow) group.push(sorted[index++]);
    melody.push(group.reduce((highest, note) => note.pitch > highest.pitch ? note : highest));
  }
  return melody;
}

function motifRecurrence(melody: TranscribedPianoNote[]) {
  if (melody.length < 8) return 0;
  const signatures = Array.from({ length: melody.length - 3 }, (_, index) => {
    const notes = melody.slice(index, index + 4);
    const intervals = notes.slice(1).map((note, offset) => Math.max(-12, Math.min(12, note.pitch - notes[offset].pitch)));
    const rhythms = notes.slice(1).map((note, offset) => Math.round((note.start - notes[offset].start) / .2));
    return `${intervals.join(",")}|${rhythms.join(",")}`;
  });
  const counts = new Map<string, number>();
  signatures.forEach(signature => counts.set(signature, (counts.get(signature) ?? 0) + 1));
  return round(signatures.filter(signature => (counts.get(signature) ?? 0) > 1).length / signatures.length * 100);
}

function sectionSummary(notes: TranscribedPianoNote[], melody: TranscribedPianoNote[], duration: number, index: number, count: number): TranscriptionSection {
  const start = index / count * duration;
  const end = (index + 1) / count * duration;
  const seconds = Math.max(.01, end - start);
  const localNotes = notes.filter(note => note.start < end && note.start + note.duration > start);
  const localMelody = melody.filter(note => note.start >= start && note.start < end);
  const intervals = localMelody.slice(1).map((note, noteIndex) => Math.abs(note.pitch - localMelody[noteIndex].pitch));
  const sounding = mergeIntervals(localMelody.map(note => [note.start, note.start + note.duration]), start, end)
    .reduce((sum, [from, to]) => sum + to - from, 0);
  const allSounding = mergeIntervals(localNotes.map(note => [note.start, note.start + note.duration]), start, end)
    .reduce((sum, [from, to]) => sum + to - from, 0);
  return {
    start,
    end,
    melodyNotesPerMinute: round(localMelody.length / seconds * 60),
    melodyRestPercent: round(clamp((1 - sounding / seconds) * 100)),
    averageInterval: round(mean(intervals)),
    largeLeapsPerMinute: round(intervals.filter(interval => interval > 7).length / seconds * 60),
    lowNotesPerMinute: round(localNotes.filter(note => note.pitch < 60).length / seconds * 60),
    activityPercent: round(clamp(allSounding / seconds * 100)),
  };
}

export function summarizePianoTranscription(notes: TranscribedPianoNote[], suppliedDuration?: number): PianoTranscription {
  const clean = notes
    .filter(note => Number.isFinite(note.start) && Number.isFinite(note.duration) && Number.isFinite(note.pitch) && note.duration > .025)
    .map(note => ({ ...note, start: Math.max(0, note.start), amplitude: clamp(note.amplitude, 0, 1) }))
    .sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  const duration = Math.max(.01, suppliedDuration ?? Math.max(0, ...clean.map(note => note.start + note.duration)));
  const melodyNotes = extractEstimatedTopVoice(clean);
  const intervals = melodyNotes.slice(1).map((note, index) => Math.abs(note.pitch - melodyNotes[index].pitch));
  const sounding = mergeIntervals(melodyNotes.map(note => [note.start, note.start + note.duration]), 0, duration)
    .reduce((sum, [from, to]) => sum + to - from, 0);
  const phraseDurations: number[] = [];
  let phraseStart = melodyNotes[0]?.start;
  for (let index = 1; index < melodyNotes.length; index++) {
    const previousEnd = melodyNotes[index - 1].start + melodyNotes[index - 1].duration;
    if (melodyNotes[index].start - previousEnd >= .65 && phraseStart !== undefined) {
      phraseDurations.push(previousEnd - phraseStart);
      phraseStart = melodyNotes[index].start;
    }
  }
  if (phraseStart !== undefined && melodyNotes.length) phraseDurations.push(melodyNotes.at(-1)!.start + melodyNotes.at(-1)!.duration - phraseStart);
  const meanAmplitude = mean(clean.map(note => note.amplitude));
  const confidencePercent = round(clamp(meanAmplitude * 72 + Math.min(20, clean.length / Math.max(1, duration) * 8) + (clean.length >= 24 ? 8 : 0)));
  return {
    notes: clean,
    melodyNotes,
    duration: round(duration, 3),
    totalNotes: clean.length,
    totalNotesPerMinute: round(clean.length / duration * 60),
    melodyNotesPerMinute: round(melodyNotes.length / duration * 60),
    melodyRestPercent: round(clamp((1 - sounding / duration) * 100)),
    averageInterval: round(mean(intervals)),
    largeLeapsPerMinute: round(intervals.filter(interval => interval > 7).length / duration * 60),
    melodyRange: melodyNotes.length ? Math.max(...melodyNotes.map(note => note.pitch)) - Math.min(...melodyNotes.map(note => note.pitch)) : 0,
    lowNotesPerMinute: round(clean.filter(note => note.pitch < 60).length / duration * 60),
    motifRecurrence: motifRecurrence(melodyNotes),
    averagePhraseLength: round(mean(phraseDurations)),
    confidencePercent,
    sections: Array.from({ length: 8 }, (_, index) => sectionSummary(clean, melodyNotes, duration, index, 8)),
  };
}

async function getBasicPitch() {
  if (!basicPitch) {
    const { BasicPitch } = await import("@spotify/basic-pitch");
    basicPitch = new BasicPitch(`${import.meta.env.BASE_URL}basic-pitch/model.json`);
  }
  return basicPitch;
}

export async function transcribePianoAudio(file: File, onProgress: (progress: number) => void = () => undefined, decodedBuffer?: AudioBuffer): Promise<PianoTranscription> {
  onProgress(0);
  const buffer = decodedBuffer ?? await decodeAudioFile(file);
  // Basic Pitch expects mono 22.05 kHz. OfflineAudioContext performs both
  // channel mixing and band-limited browser-native resampling.
  const sampleRate = 22050;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(buffer.duration * sampleRate)), sampleRate);
  const source = offline.createBufferSource();
  const mono = downmixChannels(Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index)));
  const monoBuffer = offline.createBuffer(1, mono.length, buffer.sampleRate);
  monoBuffer.copyToChannel(new Float32Array(mono), 0);
  source.buffer = monoBuffer;
  source.connect(offline.destination);
  source.start();
  const resampled = await offline.startRendering();
  const model = await getBasicPitch();
  const frames: number[][] = [], onsets: number[][] = [], contours: number[][] = [];
  await model.evaluateModel(resampled.getChannelData(0), (frameBatch, onsetBatch, contourBatch) => {
    frames.push(...frameBatch);
    onsets.push(...onsetBatch);
    contours.push(...contourBatch);
  }, progress => onProgress(clamp(progress * 100)));
  const { addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } = await import("@spotify/basic-pitch");
  const noteEvents: NoteEventTime[] = noteFramesToTime(addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, .3, .28, 5)));
  const notes = noteEvents.map(note => ({
    start: note.startTimeSeconds,
    duration: note.durationSeconds,
    pitch: note.pitchMidi,
    amplitude: note.amplitude,
  }));
  onProgress(100);
  return summarizePianoTranscription(notes, buffer.duration);
}
