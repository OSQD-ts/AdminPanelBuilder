/** The harness applications use for their own panels. */
import { describe, expect, it } from "vitest";
import { EVERYTHING, testPanel } from "../src/testing.js";

describe("testPanel()", () => {
  it("runs requests through the router on a manual clock, and collects isolated errors", async () => {
    const token = "a-token-long-enough-1";
    const { panel, clock, request, as, errors } = testPanel({ serve: { auth: { token }, controls: { edit: true } } });
    const limit = panel.modifiable(10, { label: "Limit", max: 20 });
    panel.viewable(() => {
      throw new Error("broken getter");
    }, "Broken");
    expect((await request("GET", "/api/schema")).status).toBe(401);
    const refused = await request("POST", "/api/values/limit", { value: 50 }, as(token));
    expect(refused).toMatchObject({ status: 400, json: { key: "refuseAtMost" } });
    expect((await request("POST", "/api/values/limit", { value: 15, revertAfterMs: 60_000 }, as(token))).status).toBe(200);
    clock.advance(60_000);
    panel.fireRevert(limit as never);
    expect(limit.value).toBe(10);
    panel.state();
    expect(errors.map((entry) => entry.source)).toEqual(['reading "broken"']);
    expect(panel.edit("limit", 12, "test", EVERYTHING).ok).toBe(true);
  });
});
