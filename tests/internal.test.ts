/** The helpers shared with hackerpot and bothandlerjs, tested here as well as in @osqd/internal because this package ships its own copy. */
import { describe, expect, it, vi } from "vitest";
import { withDeadline, withTimeout } from "../src/internal/async.js";
import { ManualClock, systemClock } from "../src/internal/clock.js";
import { Emitter } from "../src/internal/emitter.js";

describe("the clock", () => {
  it("moves only when told, from a number or a date, and never backwards", () => {
    const clock = new ManualClock(new Date(1000));
    clock.advance(500);
    expect(clock.now()).toBe(1500);
    clock.set(new Date(10));
    expect(clock.now()).toBe(10);
    clock.set(20);
    expect(clock.now()).toBe(20);
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(50);
  });
});

describe("the emitter", () => {
  it("isolates a throwing listener and a rejecting one, and can be unsubscribed from", async () => {
    const errors: unknown[] = [];
    const emitter = new Emitter<{ tick: number }>((error) => errors.push(error));
    const heard: number[] = [];
    const listener = (n: number): void => void heard.push(n);
    emitter.on("tick", () => {
      throw new Error("sync");
    });
    emitter.on("tick", async () => {
      throw new Error("async");
    });
    const stop = emitter.on("tick", listener);
    expect(emitter.has("tick")).toBe(true);
    emitter.emit("tick", 1);
    await vi.waitFor(() => expect(errors).toHaveLength(2));
    stop();
    emitter.emit("tick", 2);
    emitter.off("tick", listener);
    expect(heard).toEqual([1]);
    emitter.removeAll();
    expect(emitter.has("tick")).toBe(false);
    emitter.emit("tick", 3);
  });
});

describe("deadlines", () => {
  it("settle with the work when it is quick, and fall back or reject when it is not", async () => {
    expect(await withTimeout(Promise.resolve(1), 100, 0)).toBe(1);
    expect(await withTimeout(Promise.reject(new Error("x")), 100, 0)).toBe(0);
    expect(await withTimeout(new Promise<number>(() => undefined), 5, 9)).toBe(9);
    expect(await withTimeout(Promise.resolve(2), 0, 0)).toBe(2);
    expect(await withDeadline(Promise.resolve(3), 100, "work")).toBe(3);
    expect(await withDeadline(Promise.resolve(4), Number.POSITIVE_INFINITY, "work")).toBe(4);
    await expect(withDeadline(Promise.reject(new Error("broke")), 100, "work")).rejects.toThrow("broke");
    await expect(withDeadline(new Promise(() => undefined), 5, "the lookup")).rejects.toThrow("the lookup did not finish within 5ms");
  });
});
