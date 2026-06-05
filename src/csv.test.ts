import { describe, expect, it } from "vitest";
import { parseCsv, serializeCsv } from "./csv";

describe("csv", () => {
  it("round-trips simple rows", () => {
    const rows = [
      ["Artist", "Tier", "ImageURL", "ImageSource"],
      ["ABBA", "S", "", ""],
      ["+44", "", "", ""],
    ];
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
  });

  it("quotes and parses commas, embedded quotes, and newlines", () => {
    const rows = [["a,b", 'he said "hi"', "line1\nline2"]];
    const text = serializeCsv(rows);
    expect(text).toContain('"a,b"');
    expect(text).toContain('"he said ""hi"""');
    expect(parseCsv(text)).toEqual(rows);
  });

  it("handles CRLF and a file without a trailing newline", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("does not emit a spurious empty row for a single trailing newline", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
  });
});
