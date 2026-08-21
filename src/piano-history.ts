export type SavedPianoVersion = {
  version: string;
  date: string;
  bpm: number;
  activity: number;
  notesPerMinute?: number;
  restPercent: number;
  range?: number;
  arScore?: number;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function pianoHistoryKey(file: Pick<File, "name" | "size" | "lastModified">) {
  return `zirect-piano-history:v2:${encodeURIComponent(file.name)}:${file.size}:${file.lastModified}`;
}

export function legacyPianoHistoryKey(file: Pick<File, "name">) {
  return `zirect-piano-history:${file.name}`;
}

export function parsePianoHistory(raw: string | null): SavedPianoVersion[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SavedPianoVersion => {
      if (typeof entry !== "object" || entry === null) return false;
      const item = entry as Record<string, unknown>;
      return typeof item.version === "string" && typeof item.date === "string" && finite(item.bpm) && finite(item.activity)
        && finite(item.restPercent) && (item.notesPerMinute === undefined || finite(item.notesPerMinute))
        && (item.range === undefined || finite(item.range)) && (item.arScore === undefined || finite(item.arScore));
    }).slice(-3);
  } catch {
    return [];
  }
}

export function loadPianoHistory(file: Pick<File, "name" | "size" | "lastModified">) {
  try {
    const current = parsePianoHistory(localStorage.getItem(pianoHistoryKey(file)));
    if (current.length) return current;
    return parsePianoHistory(localStorage.getItem(legacyPianoHistoryKey(file)));
  } catch {
    return [];
  }
}

export function persistPianoHistory(file: Pick<File, "name" | "size" | "lastModified">, versions: SavedPianoVersion[]) {
  localStorage.setItem(pianoHistoryKey(file), JSON.stringify(versions.slice(-3)));
}
