import { describe, expect, it } from "vitest";
import { areaPath, BOX, extentOf, linePath, mergeSamples, niceTicks, scale } from "../src/client/geometry.js";

describe("chart geometry", () => {
  it("pads a flat series so the line is not drawn on the frame", () => {
    expect(extentOf([5, 5, 5])).toEqual({ min: 4.5, max: 5.5 });
    expect(extentOf([0, 0])).toEqual({ min: -1, max: 1 });
    expect(extentOf([])).toEqual({ min: 0, max: 1 });
  });

  it("keeps declared bounds and starts bars and areas at zero", () => {
    expect(extentOf([3, 9], { min: 0, max: 100 })).toEqual({ min: 0, max: 100 });
    expect(extentOf([3, 9], {}, true)).toEqual({ min: 0, max: 9 });
  });

  it("chooses round ticks", () => {
    expect(niceTicks({ min: 0, max: 100 })).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks({ min: 0, max: 1 })).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("maps into the box with y growing upwards", () => {
    expect(scale(50, { min: 0, max: 100 })).toBe(BOX / 2);
    expect(linePath([[0, 0], [BOX, BOX]])).toBe(`M0 ${BOX} L${BOX} 0`);
    expect(linePath([[0, 0], [500, 500]], true)).toBe(`M0 ${BOX} L500 ${BOX} L500 500`);
    expect(areaPath([[0, 100], [BOX, 100]])).toBe(`M0 900 L${BOX} 900 L${BOX} ${BOX} L0 ${BOX} Z`);
  });

  it("merges a re-sent newest bucket by replacing it, and keeps no more than the server does", () => {
    const held: Array<[number, number]> = [[1000, 1], [2000, 2]];
    expect(mergeSamples(held, [[2000, 5], [3000, 6]], 10)).toEqual([[1000, 1], [2000, 5], [3000, 6]]);
    expect(mergeSamples(held, [[3000, 3]], 2)).toEqual([[2000, 2], [3000, 3]]);
  });
});
