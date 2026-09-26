/**
 * Changes with reasons: a reason on every kind of change, two-person approval for actions and
 * profiles, undoing a profile or an import, profiles scheduled once or by a rule, and repeating
 * changes that survive a restart without running once per missed night.
 */
import { describe, expect, it } from "vitest";
import { createAdminPanel, ManualClock, memoryStore } from "../src/index.js";
import { EVERYTHING, testPanel } from "../src/testing.js";

const TOKEN = "a-token-long-enough-1";
const OTHER = "another-token-long-enough";

describe("a reason on every change", () => {
  it("is recorded on edits, runs, profiles, imports, undos and refusals", async () => {
    const { panel } = testPanel();
    const flag = panel.modifiable(false, "Flag");
    panel.modifiable(1, "Level");
    panel.profile("On", [[flag, true]]);
    let heard: string | undefined;
    panel.action("Flush", ({ reason }) => {
      heard = reason;
      return "flushed";
    });
    panel.edit("level", 2, "ada", EVERYTHING, { reason: "  load spike  " });
    expect(panel.changes().at(-1)).toMatchObject({ reason: "load spike" });
    await panel.run("flush", "ada", EVERYTHING, {}, { reason: "stale cache" });
    expect([panel.changes().at(-1)?.reason, heard]).toEqual(["stale cache", "stale cache"]);
    panel.applyProfile("on", "ada", EVERYTHING, { reason: "evening" });
    expect(panel.changes().at(-1)).toMatchObject({ kind: "profile", reason: "evening" });
    panel.importSettings({ level: 5 }, "ada", EVERYTHING, { reason: "copy from staging" });
    expect(panel.changes().at(-1)).toMatchObject({ kind: "import", reason: "copy from staging" });
    expect(panel.edit("level", 3, "ada", EVERYTHING, { reason: "x".repeat(501) })).toMatchObject({ ok: false, refusal: { key: "refuseReasonLong" } });
  });

  it("is required where declared, and always for approval", async () => {
    const { panel } = testPanel();
    panel.modifiable(1, { label: "Level", reason: "required" });
    panel.action("Wipe", () => "wiped", { reason: "required" });
    const flag = panel.modifiable(false, "Flag");
    panel.profile("On", [[flag, true]], { reason: "required" });
    expect(panel.edit("level", 2, "ada", EVERYTHING)).toMatchObject({ ok: false, refusal: { key: "refuseReasonRequired", params: { label: "Level" } } });
    expect(panel.edit("level", 2, "ada", EVERYTHING, { reason: "   " })).toMatchObject({ ok: false });
    expect(await panel.run("wipe", "ada", EVERYTHING)).toMatchObject({ ok: false, refusal: { key: "refuseReasonRequired" } });
    expect(panel.applyProfile("on", "ada", EVERYTHING)).toMatchObject({ ok: false, refusal: { key: "refuseReasonRequired" } });
    const schema = panel.schema(EVERYTHING).groups[0]?.items ?? [];
    expect(schema.filter((item) => "reasonRequired" in item && item.reasonRequired === true).map((item) => item.id).sort()).toEqual(["level", "on", "wipe"]);
    expect(() => panel.modifiable(1, { label: "Odd", reason: "sometimes" as never })).toThrow(/"required" or "optional"/);
  });
});

describe("two-person approval for actions and profiles", () => {
  it("proposes a run with its input, and runs it with that input once someone else approves", async () => {
    const { panel, request, as } = testPanel({ serve: { auth: { tokens: { ada: TOKEN, sam: OTHER } }, controls: { edit: true, actions: true } } });
    const ran: Array<{ by: string; days: unknown; reason: unknown }> = [];
    panel.action("Ban player", ({ by, input, reason }) => {
      ran.push({ by, days: input.days, reason });
      return "banned";
    }, { approval: true, input: { days: { kind: "number", min: 1 } } });
    const proposed = await request("POST", "/api/actions/ban-player", { input: { days: 7 }, reason: "cheating" }, as(TOKEN));
    expect(proposed.status).toBe(202);
    const pending = (proposed.json as { pending: { id: string; kind: string; to: unknown } }).pending;
    expect(pending).toMatchObject({ kind: "action", to: { days: 7 } });
    expect(ran).toEqual([]);
    expect((await request("POST", `/api/pending/${pending.id}/approve`, {}, as(TOKEN))).status).toBe(403);
    const approved = await request("POST", `/api/pending/${pending.id}/approve`, {}, as(OTHER));
    expect(approved).toMatchObject({ status: 200, json: { result: { message: "banned" } } });
    expect(ran).toEqual([{ by: "ada, approved by sam", days: 7, reason: "cheating" }]);
    expect((await request("POST", "/api/actions/ban-player", { input: { days: 7 } }, as(TOKEN))).json).toMatchObject({ key: "refuseReasonRequired" });
  });

  it("counts the operator, not the route they came by, as the one who may not approve", async () => {
    const { panel } = testPanel();
    panel.modifiable(1, { label: "Limit", approval: true });
    const proposed = panel.edit("limit", 2, "ada", EVERYTHING, { reason: "a test" });
    const id = proposed.ok && "pending" in proposed ? proposed.pending.id : "";
    // A delegate records "ada via gateway"; it is still ada, and ada may not approve ada's proposal.
    expect(await panel.approve(id, "ada via gateway", EVERYTHING)).toMatchObject({ ok: false, refusal: { key: "refuseOwnProposal" } });
    expect(await panel.approve(id, "sam via gateway", EVERYTHING)).toMatchObject({ ok: true });
  });

  it("proposes a profile, applies it whole on approval, or turns it down with a reason", async () => {
    const { panel } = testPanel();
    const a = panel.modifiable(1, "A");
    const b = panel.modifiable(1, "B");
    panel.profile("Both", [[a, 2], [b, 2]], { approval: true });
    const first = panel.applyProfile("both", "ada", EVERYTHING, { reason: "maintenance" });
    const id = first.ok && "pending" in first ? first.pending.id : "";
    expect(panel.pending()[0]).toMatchObject({ kind: "profile", target: "both", reason: "maintenance" });
    expect(await panel.approve(id, "sam", EVERYTHING)).toMatchObject({ ok: true });
    expect([a.value, b.value]).toEqual([2, 2]);
    const again = panel.applyProfile("both", "ada", EVERYTHING, { reason: "again" });
    const second = again.ok && "pending" in again ? again.pending.id : "";
    expect((await panel.reject(second, "sam", EVERYTHING, { reason: "not tonight" })).ok).toBe(true);
    expect(panel.changes().at(-1)).toMatchObject({ ok: false, reason: "not tonight" });
    expect(panel.applyProfile("both", "ada", EVERYTHING, { reason: "x", repeat: { every: "day", at: "02:00", timeZone: "UTC" } })).toMatchObject({ ok: false, refusal: { key: "refuseRepeatApproval" } });
  });
});

describe("undoing a profile or an import", () => {
  it("writes back every value it changed, as one change, and refuses when any has changed since", () => {
    const { panel } = testPanel();
    const a = panel.modifiable(1, "A");
    const b = panel.modifiable(1, "B");
    panel.profile("Both", [[a, 2], [b, 3]]);
    panel.applyProfile("both", "ada", EVERYTHING);
    const applied = panel.changes().at(-1);
    expect(applied?.revertible).toBe(true);
    expect(panel.undo(applied?.id as number, "sam", EVERYTHING, { reason: "wrong night" }).ok).toBe(true);
    expect([a.value, b.value]).toEqual([1, 1]);
    expect(panel.changes().at(-1)).toMatchObject({ kind: "revert", label: "Undid: Both", by: "sam", reason: "wrong night", from: { a: 2, b: 3 }, to: { a: 1, b: 1 } });
    panel.importSettings({ a: 5, b: 6 }, "ada", EVERYTHING);
    const imported = panel.changes().at(-1)?.id as number;
    b.value = 9;
    expect(panel.undo(imported, "sam", EVERYTHING)).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("is not offered for a profile that sets a sensitive value, whose old value was never recorded", () => {
    const { panel } = testPanel();
    const key = panel.modifiable("a", { label: "Key", sensitive: true });
    panel.profile("Rotate", [[key, "b"]]);
    panel.applyProfile("rotate", "ada", EVERYTHING);
    expect(panel.changes().at(-1)?.revertible).toBe(false);
  });
});

describe("profiles scheduled once, for a while, or by a rule", () => {
  it("applies a profile at its time and reverts it after its length", () => {
    const { panel, clock } = testPanel();
    const mode = panel.modifiable("normal", "Mode");
    panel.profile("Maintenance", [[mode, "maintenance"]]);
    const at = clock.now() + 60_000;
    expect(panel.applyProfile("maintenance", "ada", EVERYTHING, { at, revertAfterMs: 3_600_000, reason: "upgrade" }).ok).toBe(true);
    const entry = panel.state(EVERYTHING).profileSchedules?.maintenance?.[0];
    expect(entry).toMatchObject({ at, by: "ada", reason: "upgrade", revertAfterMs: 3_600_000 });
    panel.fireScheduledNow(entry?.id as string);
    expect(mode.value).toBe("maintenance");
    expect(panel.changes().at(-1)).toMatchObject({ kind: "profile", by: "ada (scheduled)", reason: "upgrade" });
    const revert = (panel as unknown as { schedule: { revertFor(target: string, id: string): { id: string } | undefined } }).schedule.revertFor("profile", "maintenance");
    panel.fireScheduledNow(revert?.id as string);
    expect(mode.value).toBe("normal");
    expect(panel.changes().at(-1)).toMatchObject({ kind: "revert", label: "Maintenance (timed change ended)" });
    expect(panel.cancelScheduled("nope", "ada", EVERYTHING).ok).toBe(false);
  });

  it("repeats a value's change by its rule, and can be cancelled as a whole", () => {
    const { panel, clock } = testPanel({ start: Date.parse("2026-09-21T12:00:00Z") });
    const mode = panel.modifiable("normal", "Mode");
    const answer = panel.edit("mode", "quiet", "ada", EVERYTHING, { repeat: { every: "day", at: "02:00", timeZone: "UTC" }, revertAfterMs: 3_600_000 });
    const entry = answer.ok && "value" in answer ? answer.value.scheduled?.[0] : undefined;
    expect(entry).toMatchObject({ at: Date.parse("2026-09-22T02:00:00Z"), repeat: { every: "day", at: "02:00" }, revertAfterMs: 3_600_000 });
    clock.set(Date.parse("2026-09-22T02:00:00Z"));
    panel.fireScheduledNow(entry?.id as string);
    expect(mode.value).toBe("quiet");
    expect(panel.changes().at(-1)).toMatchObject({ by: "ada (repeating)" });
    const next = panel.state(EVERYTHING).values.find((value) => value.id === "mode")?.scheduled?.[0];
    expect(next?.at).toBe(Date.parse("2026-09-23T02:00:00Z"));
    expect(panel.state(EVERYTHING).values.find((value) => value.id === "mode")?.revertAt).toBe(Date.parse("2026-09-22T03:00:00Z"));
    expect(panel.cancelScheduled(next?.id as string, "sam", EVERYTHING).ok).toBe(true);
    expect(panel.state(EVERYTHING).values.find((value) => value.id === "mode")?.scheduled).toBeUndefined();
    expect(panel.edit("mode", "x", "ada", EVERYTHING, { repeat: { every: "day", at: "25:00", timeZone: "UTC" } })).toMatchObject({ ok: false, refusal: { key: "refuseRepeat" } });
    expect(panel.edit("mode", "x", "ada", EVERYTHING, { repeat: { every: "day", at: "02:00", timeZone: "Mars/Olympus" } })).toMatchObject({ ok: false });
    expect(panel.edit("mode", "x", "ada", EVERYTHING, { at: clock.now() + 1000, repeat: { every: "day", at: "02:00", timeZone: "UTC" } })).toMatchObject({ ok: false, refusal: { key: "refuseRepeatAndAt" } });
  });

  it("survives a restart, running once for the nights it missed and then on its rule", async () => {
    const store = memoryStore();
    const clock = new ManualClock(Date.parse("2026-09-21T12:00:00Z"));
    const first = createAdminPanel({ clock, store });
    first.modifiable("normal", { label: "Mode", persist: true });
    await first.ready;
    first.edit("mode", "quiet", "ada", EVERYTHING, { repeat: { every: "day", at: "02:00", timeZone: "UTC" } });
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    clock.set(Date.parse("2026-09-25T12:00:00Z"));
    const second = createAdminPanel({ clock, store });
    const mode = second.modifiable("normal", { label: "Mode", persist: true });
    await second.ready;
    expect(mode.value).toBe("quiet");
    expect(second.changes().filter((change) => change.by === "ada (repeating)")).toHaveLength(1);
    expect(second.state(EVERYTHING).values[0]?.scheduled?.[0]?.at).toBe(Date.parse("2026-09-26T02:00:00Z"));
    second.close();
  });
});

describe("type-to-confirm", () => {
  it("is declared per action and told to the page", () => {
    const { panel } = testPanel();
    panel.action("Drop database", () => "gone", { confirm: "type" });
    const item = panel.schema(EVERYTHING).groups[0]?.items[0];
    expect(item).toMatchObject({ type: "action", confirm: true, typeToConfirm: true });
    expect(() => panel.action("Odd", () => "", { confirm: "twice" as never })).toThrow(/true, false or "type"/);
  });
});
