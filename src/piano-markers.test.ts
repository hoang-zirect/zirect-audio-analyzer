import { describe, expect, it } from "vitest";
import { mapPlaybackPosition, parseMarkerTimestamp } from "./piano-markers";

describe("mapPlaybackPosition", () => {
  it("keeps A/B and MIDI timelines aligned by normalized duration", () => {
    expect(mapPlaybackPosition(30, 60, 100)).toBe(50);
    expect(mapPlaybackPosition(50, 100, 60)).toBe(30);
  });
  it("clamps positions and rejects invalid durations", () => {
    expect(mapPlaybackPosition(150, 100, 60)).toBe(60);
    expect(mapPlaybackPosition(-5, 100, 60)).toBe(0);
    expect(mapPlaybackPosition(5, 0, 60)).toBe(0);
  });
});

describe("parseMarkerTimestamp", () => {
  it("uses current playback time when input is blank", () => expect(parseMarkerTimestamp("", 18.5, 120)).toEqual({ time: 18.5 }));
  it("accepts mm:ss and raw seconds", () => {
    expect(parseMarkerTimestamp("1:18", 0, 120)).toEqual({ time: 78 });
    expect(parseMarkerTimestamp("42.5", 0, 120)).toEqual({ time: 42.5 });
  });
  it("rejects malformed timestamps", () => {
    expect(parseMarkerTimestamp("1:78", 0, 120).error).toMatch(/không hợp lệ/);
    expect(parseMarkerTimestamp("abc", 0, 120).error).toMatch(/không hợp lệ/);
  });
  it("rejects timestamps beyond the selected audio duration", () => expect(parseMarkerTimestamp("2:01", 0, 120).error).toMatch(/ngoài thời lượng/));
});
