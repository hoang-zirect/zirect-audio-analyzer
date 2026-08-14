import { describe, expect, it } from "vitest";
import { parseMarkerTimestamp } from "./piano-markers";

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
