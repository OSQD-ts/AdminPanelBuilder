import { describe, expect, it } from "vitest";
import { encodeForWire, MAX_WIRE_BYTES, plottable, toJson } from "../src/values/kinds.js";

describe("turning a value into what the page is sent", () => {
  it("represents whatever the application holds, rather than throwing on it", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    let deep: unknown = 1;
    for (let i = 0; i < 40; i += 1) deep = [deep];
    expect(toJson(10n)).toBe("10");
    expect(toJson(() => 1)).toBe("[function]");
    expect(toJson(Symbol("s"))).toBe("Symbol(s)");
    expect(toJson(new Date("invalid"))).toBeNull();
    expect(toJson(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
    expect(toJson(/a+/g)).toBe("/a+/g");
    expect(toJson(new Map([["a", 1]]))).toEqual({ a: 1 });
    expect(toJson(new Set([1, 2]))).toEqual([1, 2]);
    expect(toJson({ toJSON: () => "custom" })).toBe("custom");
    expect(toJson({ a: undefined, b: () => 1, c: 2 })).toEqual({ c: 2 });
    expect(toJson(cyclic)).toEqual({ name: "loop", self: "[circular]" });
    expect(JSON.stringify(toJson(deep))).toContain("[too deep]");
    expect(toJson(Number.NaN)).toBeNull();
  });

  it("says why when the JSON alone would mislead", () => {
    expect(encodeForWire(Number.POSITIVE_INFINITY)).toEqual({ value: null, text: "Infinity" });
    expect(encodeForWire("x".repeat(MAX_WIRE_BYTES + 1)).text).toMatch(/too large to send/);
    expect(encodeForWire({ big: "x".repeat(MAX_WIRE_BYTES) }).text).toMatch(/too large to send/);
    expect(encodeForWire({ small: 1 })).toEqual({ value: { small: 1 } });
  });

  it("plots numbers and booleans and nothing else", () => {
    expect([plottable(3), plottable(true), plottable(false), plottable(Number.NaN), plottable("3")]).toEqual([3, 1, 0, undefined, undefined]);
  });
});
