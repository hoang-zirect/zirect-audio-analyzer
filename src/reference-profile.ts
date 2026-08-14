import { resampleCompositionSections, type CompositionAnalysis, type CompositionSection, type TempoCrossCheckStatus } from "./audio-composition";
import type { PianoTranscription, PianoTranscriptionSummary, TranscriptionSection } from "./piano-transcription";

export const REFERENCE_PROFILE_SCHEMA = "zirect-piano-reference/1";
export const REFERENCE_PROFILE_STORAGE_KEY = "zirect-piano-reference-profile";
export const MINIMUM_REFERENCE_TRACKS = 5;
export const MAXIMUM_REFERENCE_TRACKS = 30;

export type StoredCompositionFeatures = {
  duration: number;
  confirmedBpm: number;
  tempoSources?: { zirectBpm: number; essentiaBpm?: number; status: TempoCrossCheckStatus; essentiaError?: string };
  onsetDensity: number;
  restPercent: number;
  longestRest: number;
  averagePhraseLength: number;
  introOutroSilence: number;
  repetition: number;
  melodicMovement: number;
  harmonicChangeRate: number;
  activityPercent: number;
  sections: Array<Omit<CompositionSection, "start" | "end">>;
};

export type StoredTranscriptionFeatures = Omit<PianoTranscriptionSummary, "sections"> & {
  sections: Array<Omit<TranscriptionSection, "start" | "end">>;
};

export type ReferenceTrackProfile = {
  id: string;
  name: string;
  addedAt: string;
  composition: StoredCompositionFeatures;
  transcription?: StoredTranscriptionFeatures;
};

export type MetricStats = {
  median: number;
  q25: number;
  q75: number;
  minimum: number;
  maximum: number;
  sampleSize: number;
};

export type ReferenceMetricKey =
  | "confirmedBpm" | "onsetDensity" | "restPercent" | "longestRest" | "averagePhraseLength"
  | "repetition" | "melodicMovement" | "harmonicChangeRate" | "activityPercent"
  | "melodyNotesPerMinute" | "melodyRestPercent" | "averageInterval" | "largeLeapsPerMinute"
  | "melodyRange" | "lowNotesPerMinute" | "motifRecurrence" | "transcriptionPhraseLength";

export type ReferenceSectionMetricKey = "onsetDensity" | "restPercent" | "activity" | "melodyNotesPerMinute" | "melodyRestPercent" | "largeLeapsPerMinute";

export type ReferenceLibraryProfile = {
  schema: typeof REFERENCE_PROFILE_SCHEMA;
  id: string;
  name: string;
  updatedAt: string;
  tracks: ReferenceTrackProfile[];
  metricStats: Partial<Record<ReferenceMetricKey, MetricStats>>;
  sectionStats: Array<Partial<Record<ReferenceSectionMetricKey, MetricStats>>>;
};

export type ProfileMetricResult = {
  key: ReferenceMetricKey;
  label: string;
  unit: string;
  value: number;
  stats: MetricStats;
  status: "within" | "below" | "above";
  fit: number;
};

export type ProfileFinding = {
  id: string;
  rank: number;
  start?: number;
  end?: number;
  severity: number;
  textVi: string;
  textEn: string;
};

export type ProfileEvaluation = {
  fitScore: number;
  metrics: ProfileMetricResult[];
  findings: ProfileFinding[];
  transcriptionCoverage: number;
};

const round = (value: number, precision = 1) => Number(value.toFixed(precision));
const clamp = (value: number, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, value));
const id = () => globalThis.crypto?.randomUUID?.() ?? `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const METRICS: Record<ReferenceMetricKey, { label: string; unit: string }> = {
  confirmedBpm: { label: "BPM đã xác nhận", unit: "BPM" },
  onsetDensity: { label: "Mật độ tiếng đàn", unit: "/phút" },
  restPercent: { label: "Khoảng nghỉ audio", unit: "%" },
  longestRest: { label: "Khoảng nghỉ dài nhất", unit: "s" },
  averagePhraseLength: { label: "Độ dài câu ước lượng", unit: "s" },
  repetition: { label: "Lặp mẫu nhịp onset", unit: "%" },
  melodicMovement: { label: "Biến động onset/năng lượng", unit: "" },
  harmonicChangeRate: { label: "Biến đổi màu âm", unit: "/phút" },
  activityPercent: { label: "Tỷ lệ hoạt động", unit: "%" },
  melodyNotesPerMinute: { label: "Nốt top-voice ước lượng", unit: "/phút" },
  melodyRestPercent: { label: "Khoảng nghỉ top-voice", unit: "%" },
  averageInterval: { label: "Quãng đi trung bình", unit: "st" },
  largeLeapsPerMinute: { label: "Nhảy lớn >7 bán âm", unit: "/phút" },
  melodyRange: { label: "Âm vực top-voice", unit: "st" },
  lowNotesPerMinute: { label: "Nốt âm khu thấp", unit: "/phút" },
  motifRecurrence: { label: "Mức tái diễn mô-típ", unit: "%" },
  transcriptionPhraseLength: { label: "Độ dài câu top-voice", unit: "s" },
};

const quantile = (sorted: number[], position: number) => {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index), upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

export function calculateMetricStats(values: number[]): MetricStats | undefined {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  return {
    median: round(quantile(sorted, .5)),
    q25: round(quantile(sorted, .25)),
    q75: round(quantile(sorted, .75)),
    minimum: round(sorted[0]),
    maximum: round(sorted.at(-1)!),
    sampleSize: sorted.length,
  };
}

function storedComposition(analysis: CompositionAnalysis, confirmedBpm = analysis.bpm): StoredCompositionFeatures {
  return {
    duration: round(analysis.duration, 3),
    confirmedBpm,
    tempoSources: analysis.tempoCrossCheck ? {
      zirectBpm: analysis.tempoCrossCheck.zirect.bpm,
      essentiaBpm: analysis.tempoCrossCheck.essentia?.bpm,
      status: analysis.tempoCrossCheck.status,
      essentiaError: analysis.tempoCrossCheck.essentiaError,
    } : undefined,
    onsetDensity: analysis.onsetDensity,
    restPercent: analysis.restPercent,
    longestRest: analysis.longestRest,
    averagePhraseLength: analysis.averagePhraseLength,
    introOutroSilence: round(analysis.introSilence + analysis.outroSilence),
    repetition: analysis.repetition,
    melodicMovement: analysis.melodicMovement,
    harmonicChangeRate: analysis.harmonicChangeRate,
    activityPercent: analysis.activityPercent,
    sections: resampleCompositionSections(analysis).map(({ start: _start, end: _end, ...section }) => section),
  };
}

function storedTranscription(transcription: PianoTranscription | PianoTranscriptionSummary): StoredTranscriptionFeatures {
  const { sections, ...summary } = transcription;
  const safeSummary = Object.fromEntries(Object.entries(summary).filter(([key]) => key !== "notes" && key !== "melodyNotes")) as Omit<PianoTranscriptionSummary, "sections">;
  return { ...safeSummary, sections: sections.map(({ start: _start, end: _end, ...section }) => section) };
}

export function createReferenceTrack(name: string, analysis: CompositionAnalysis, transcription?: PianoTranscription | PianoTranscriptionSummary, confirmedBpm = analysis.bpm): ReferenceTrackProfile {
  return {
    id: id(),
    name,
    addedAt: new Date().toISOString(),
    composition: storedComposition(analysis, confirmedBpm),
    transcription: transcription ? storedTranscription(transcription) : undefined,
  };
}

function metricValue(track: ReferenceTrackProfile, key: ReferenceMetricKey): number | undefined {
  if (key === "transcriptionPhraseLength") return track.transcription?.averagePhraseLength;
  if (key in track.composition) return Number(track.composition[key as keyof StoredCompositionFeatures]);
  return track.transcription?.[key as keyof StoredTranscriptionFeatures] as number | undefined;
}

function sectionMetricValue(track: ReferenceTrackProfile, index: number, key: ReferenceSectionMetricKey): number | undefined {
  const composition = track.composition.sections[index];
  if (key === "onsetDensity" || key === "restPercent" || key === "activity") return composition?.[key];
  return track.transcription?.sections[index]?.[key];
}

export function buildReferenceProfile(name: string, tracks: ReferenceTrackProfile[], existingId?: string): ReferenceLibraryProfile {
  const limitedTracks = tracks.slice(0, MAXIMUM_REFERENCE_TRACKS);
  const metricStats: Partial<Record<ReferenceMetricKey, MetricStats>> = {};
  (Object.keys(METRICS) as ReferenceMetricKey[]).forEach(key => {
    const stats = calculateMetricStats(limitedTracks.map(track => metricValue(track, key)).filter((value): value is number => value !== undefined));
    if (stats) metricStats[key] = stats;
  });
  const sectionKeys: ReferenceSectionMetricKey[] = ["onsetDensity", "restPercent", "activity", "melodyNotesPerMinute", "melodyRestPercent", "largeLeapsPerMinute"];
  const sectionStats = Array.from({ length: 8 }, (_, index) => {
    const result: Partial<Record<ReferenceSectionMetricKey, MetricStats>> = {};
    sectionKeys.forEach(key => {
      const stats = calculateMetricStats(limitedTracks.map(track => sectionMetricValue(track, index, key)).filter((value): value is number => value !== undefined));
      if (stats) result[key] = stats;
    });
    return result;
  });
  return { schema: REFERENCE_PROFILE_SCHEMA, id: existingId ?? id(), name: name.trim() || "Zirect Piano Reference", updatedAt: new Date().toISOString(), tracks: limitedTracks, metricStats, sectionStats };
}

export const profileIsReady = (profile?: ReferenceLibraryProfile | null) => (profile?.tracks.length ?? 0) >= MINIMUM_REFERENCE_TRACKS;

export function updateReferenceTrackBpm(profile: ReferenceLibraryProfile, trackId: string, bpm: number) {
  return buildReferenceProfile(profile.name, profile.tracks.map(track => track.id === trackId ? { ...track, composition: { ...track.composition, confirmedBpm: bpm } } : track), profile.id);
}

export function removeReferenceTrack(profile: ReferenceLibraryProfile, trackId: string) {
  return buildReferenceProfile(profile.name, profile.tracks.filter(track => track.id !== trackId), profile.id);
}

export function renameReferenceProfile(profile: ReferenceLibraryProfile, name: string) {
  return buildReferenceProfile(name, profile.tracks, profile.id);
}

function readDemoMetric(composition: CompositionAnalysis, transcription: PianoTranscriptionSummary | undefined, key: ReferenceMetricKey) {
  if (key === "confirmedBpm") return composition.bpm;
  if (key === "transcriptionPhraseLength") return transcription?.averagePhraseLength;
  if (key in composition) return Number(composition[key as keyof CompositionAnalysis]);
  return transcription?.[key as keyof PianoTranscriptionSummary] as number | undefined;
}

function fitAgainst(value: number, stats: MetricStats) {
  if (value >= stats.q25 && value <= stats.q75) return { status: "within" as const, fit: 100, severity: 0 };
  const status = value < stats.q25 ? "below" as const : "above" as const;
  const edge = status === "below" ? stats.q25 : stats.q75;
  const spread = Math.max(stats.q75 - stats.q25, (stats.maximum - stats.minimum) / 2, Math.abs(stats.median) * .15, 1);
  const distance = Math.abs(value - edge) / spread;
  return { status, fit: round(clamp(100 - distance * 45)), severity: round(distance, 2) };
}

const directionVi = (status: "below" | "above") => status === "above" ? "cao hơn" : "thấp hơn";
const directionEn = (status: "below" | "above") => status === "above" ? "above" : "below";

export function evaluateDemoAgainstProfile(composition: CompositionAnalysis, transcription: PianoTranscriptionSummary | undefined, profile: ReferenceLibraryProfile): ProfileEvaluation {
  const metrics: ProfileMetricResult[] = [];
  const findings: ProfileFinding[] = [];
  (Object.keys(METRICS) as ReferenceMetricKey[]).forEach(key => {
    const stats = profile.metricStats[key], value = readDemoMetric(composition, transcription, key);
    if (!stats || value === undefined || stats.sampleSize < Math.min(3, profile.tracks.length)) return;
    const result = fitAgainst(value, stats);
    metrics.push({ key, label: METRICS[key].label, unit: METRICS[key].unit, value: round(value), stats, status: result.status, fit: result.fit });
    if (result.status !== "within") findings.push({
      id: `global-${key}`,
      rank: 0,
      severity: result.severity,
      textVi: `${METRICS[key].label} ${round(value)}${METRICS[key].unit ? ` ${METRICS[key].unit}` : ""}, ${directionVi(result.status)} vùng thường gặp ${stats.q25}–${stats.q75}. Hãy xác nhận cảm giác này bằng tai.`,
      textEn: `${METRICS[key].label} is ${round(value)}${METRICS[key].unit ? ` ${METRICS[key].unit}` : ""}, ${directionEn(result.status)} the usual ${stats.q25}–${stats.q75} range. Confirm this by ear.`,
    });
  });

  const demoSections = resampleCompositionSections(composition);
  const sectionDefinitions: Array<{ key: ReferenceSectionMetricKey; labelVi: string; labelEn: string; values: number[] }> = [
    { key: "onsetDensity", labelVi: "mật độ tiếng đàn", labelEn: "piano-event density", values: demoSections.map(section => section.onsetDensity) },
    { key: "restPercent", labelVi: "khoảng nghỉ audio", labelEn: "audio rest time", values: demoSections.map(section => section.restPercent) },
    { key: "activity", labelVi: "mức hoạt động", labelEn: "activity", values: demoSections.map(section => section.activity) },
    { key: "melodyNotesPerMinute", labelVi: "mật độ top-voice", labelEn: "top-voice density", values: transcription?.sections.map(section => section.melodyNotesPerMinute) ?? [] },
    { key: "melodyRestPercent", labelVi: "khoảng nghỉ top-voice", labelEn: "top-voice rest time", values: transcription?.sections.map(section => section.melodyRestPercent) ?? [] },
    { key: "largeLeapsPerMinute", labelVi: "số quãng nhảy lớn", labelEn: "large-leap rate", values: transcription?.sections.map(section => section.largeLeapsPerMinute) ?? [] },
  ];
  sectionDefinitions.forEach(definition => definition.values.forEach((value, index) => {
    const stats = profile.sectionStats[index]?.[definition.key];
    if (!stats || stats.sampleSize < Math.min(3, profile.tracks.length)) return;
    const result = fitAgainst(value, stats);
    if (result.status === "within" || result.severity < .35) return;
    const start = index / 8 * composition.duration, end = (index + 1) / 8 * composition.duration;
    findings.push({
      id: `section-${index}-${definition.key}`,
      rank: 0,
      start,
      end,
      severity: result.severity + .2,
      textVi: `${formatTime(start)}–${formatTime(end)}: ${definition.labelVi} ${directionVi(result.status)} hồ sơ ${profile.name}. Nghe lại đoạn này để quyết định có cần chỉnh hay không.`,
      textEn: `${formatTime(start)}–${formatTime(end)}: ${definition.labelEn} is ${directionEn(result.status)} the ${profile.name} profile. Listen again before deciding whether to revise it.`,
    });
  }));

  const ranked = findings.sort((a, b) => b.severity - a.severity).map((finding, index) => ({ ...finding, rank: index + 1 }));
  const fitScore = metrics.length ? round(metrics.reduce((sum, metric) => sum + metric.fit, 0) / metrics.length) : 0;
  return {
    fitScore,
    metrics,
    findings: ranked,
    transcriptionCoverage: round(profile.tracks.filter(track => track.transcription).length / Math.max(1, profile.tracks.length) * 100),
  };
}

export function saveReferenceProfile(profile: ReferenceLibraryProfile) {
  localStorage.setItem(REFERENCE_PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

export function loadReferenceProfile(): ReferenceLibraryProfile | undefined {
  try {
    const raw = localStorage.getItem(REFERENCE_PROFILE_STORAGE_KEY);
    return raw ? importReferenceProfile(raw) : undefined;
  } catch { return undefined; }
}

export function importReferenceProfile(raw: string): ReferenceLibraryProfile {
  const parsed = JSON.parse(raw) as Partial<ReferenceLibraryProfile>;
  if (parsed.schema !== REFERENCE_PROFILE_SCHEMA || !Array.isArray(parsed.tracks) || typeof parsed.name !== "string") throw new Error("Tệp không phải Hồ sơ tham chiếu Zirect hợp lệ.");
  const validTracks = parsed.tracks.filter(track => track && typeof track.id === "string" && typeof track.name === "string" && track.composition && Array.isArray(track.composition.sections));
  if (!validTracks.length) throw new Error("Hồ sơ không chứa bài tham chiếu hợp lệ.");
  return buildReferenceProfile(parsed.name, validTracks, parsed.id);
}

export const exportReferenceProfile = (profile: ReferenceLibraryProfile) => JSON.stringify(profile, null, 2);

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
