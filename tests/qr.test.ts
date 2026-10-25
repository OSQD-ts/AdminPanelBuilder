import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeQr, penalty, qrCapacity, qrVersionFor } from "../src/client/qr.js";
import { MAX_QR_BYTES, MAX_QR_VERSION } from "../src/values/display.js";

/**
 * The encoder is checked against matrices an independent encoder produced (tests/fixtures/
 * qr-reference.json), module by module, mask choice included: a QR code that is subtly wrong
 * still looks like a QR code, and only a scanner, or a second encoder, notices.
 */
const reference = JSON.parse(readFileSync(new URL("./fixtures/qr-reference.json", import.meta.url), "utf8")) as {
  cases: Array<{ text: string; level: "L" | "M" | "Q" | "H"; version: number; mask: number; rows: string[] }>;
};

const rowsOf = (modules: boolean[][]): string[] => modules.map((row) => row.map((dark) => (dark ? "1" : "0")).join(""));

describe("QR encoder", () => {
  it("reproduces the independent reference module for module, its mask choice included", () => {
    expect(reference.cases.length).toBeGreaterThanOrEqual(8);
    for (const sample of reference.cases) {
      const matrix = encodeQr(sample.text, sample.level, { version: sample.version });
      expect(matrix, sample.text).toBeDefined();
      expect({ text: sample.text, version: matrix?.version, mask: matrix?.mask }).toEqual({ text: sample.text, version: sample.version, mask: sample.mask });
      expect(rowsOf(matrix?.modules ?? []), `${sample.text} ${sample.level}`).toEqual(sample.rows);
    }
  });

  it("holds the byte-mode capacities the standard publishes", () => {
    // ISO/IEC 18004 table 7, byte mode.
    expect([qrCapacity(1, "L"), qrCapacity(1, "M"), qrCapacity(1, "Q"), qrCapacity(1, "H")]).toEqual([17, 14, 11, 7]);
    expect([qrCapacity(5, "Q"), qrCapacity(7, "M"), qrCapacity(9, "L")]).toEqual([60, 122, 230]);
    expect([qrCapacity(10, "L"), qrCapacity(10, "M"), qrCapacity(10, "Q"), qrCapacity(10, "H")]).toEqual([271, 213, 151, 119]);
    expect(MAX_QR_BYTES).toBe(qrCapacity(MAX_QR_VERSION, "L"));
  });

  it("picks the smallest version that fits, and nothing past the largest", () => {
    expect(qrVersionFor(17, "L")).toBe(1);
    expect(qrVersionFor(18, "L")).toBe(2);
    expect(encodeQr("a".repeat(MAX_QR_BYTES), "L")?.version).toBe(MAX_QR_VERSION);
    expect(encodeQr("a".repeat(MAX_QR_BYTES + 1), "L")).toBeUndefined();
    expect(encodeQr("a".repeat(120), "H")).toBeUndefined();
  });

  it("counts UTF-8 bytes, not characters", () => {
    // 14 characters, 28 bytes: past version 1-M's 14.
    expect(encodeQr("ż".repeat(14), "M")?.version).toBe(3);
  });

  it("writes the format information the standard tabulates", () => {
    // Level L, mask 0: 111011111000100, read along row 8 from the left (skipping the timing column).
    const matrix = encodeQr("HELLO", "L", { mask: 0 });
    const row8 = matrix?.modules[8] ?? [];
    const bits = [0, 1, 2, 3, 4, 5, 7, 8].map((c) => (row8[c] ? "1" : "0")).join("");
    expect(bits).toBe("11101111");
  });

  it("writes version information from version 7", () => {
    // Version 7's 18 bits are 000111110010010100 (0x07C94), least significant first in a 3 × 6 block.
    const matrix = encodeQr("y".repeat(100), "M", { version: 7 });
    const size = matrix?.size ?? 0;
    let bits = 0;
    for (let i = 17; i >= 0; i--) bits = (bits << 1) | (matrix?.modules[size - 11 + (i % 3)]?.[Math.floor(i / 3)] ? 1 : 0);
    expect(bits).toBe(0x07c94);
  });

  it("chooses the mask with the lowest penalty", () => {
    const chosen = encodeQr("https://example.com", "M");
    expect(chosen).toBeDefined();
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => penalty(encodeQr("https://example.com", "M", { mask })?.modules ?? []));
    expect(scores[chosen?.mask ?? -1]).toBe(Math.min(...scores));
  });
});
