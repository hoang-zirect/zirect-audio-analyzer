export type TimestampResult = { time?: number; error?: string };

/** Maps a playhead between media timelines by normalized duration and clamps invalid edges. */
export function mapPlaybackPosition(position: number, sourceDuration: number, targetDuration: number) {
  if (!Number.isFinite(position) || !Number.isFinite(sourceDuration) || !Number.isFinite(targetDuration) || sourceDuration <= 0 || targetDuration <= 0) return 0;
  return Math.max(0, Math.min(1, position / sourceDuration)) * targetDuration;
}

/** Parses blank/current, raw seconds, or m:ss marker input and validates it against audio duration. */
export function parseMarkerTimestamp(value: string, currentTime: number, duration: number): TimestampResult {
  const input = value.trim();
  let time = currentTime;
  if (input) {
    if (/^\d+(?:\.\d+)?$/.test(input)) time = Number(input);
    else {
      const match = /^(\d+):([0-5]\d(?:\.\d+)?)$/.exec(input);
      if (!match) return { error: "Timestamp không hợp lệ. Dùng mm:ss hoặc số giây." };
      time = Number(match[1]) * 60 + Number(match[2]);
    }
  }
  if (!Number.isFinite(time) || time < 0) return { error: "Timestamp không hợp lệ." };
  if (!Number.isFinite(duration) || duration <= 0) return { error: "Audio chưa sẵn sàng để đặt timestamp." };
  if (time > duration) return { error: "Timestamp nằm ngoài thời lượng audio." };
  return { time };
}
