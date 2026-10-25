/**
 * What an action answered belongs to whoever ran it, unless it says otherwise; and a row action asks
 * for input the way an action does.
 */
import { describe, expect, it } from "vitest";
import { AdminPanelConfigError } from "../src/index.js";
import { call, panelAt, routerFor } from "./helpers.js";

const ADA = "ada-token-0123456789";
const SAM = "sam-token-0123456789";
const VIEWER = "viewer-token-0123456";
const tokens = { tokens: { ada: ADA, sam: SAM, viewer: { token: VIEWER, grants: { actions: false } } } };
const as = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

function fixture(options: Parameters<typeof panelAt>[1] = {}) {
  const { panel } = panelAt(1_000_000, options);
  panel.action("Reset link", ({ input }) => `https://example.test/reset/${String(input.user)}`, { group: "Users", input: { user: { kind: "string" } } });
  panel.action("Shared note", () => "everybody may read this", { group: "Users", visibility: "everyone" });
  panel.action("Runner note", () => "for those who run things", { group: "Users", visibility: "runners" });
  panel.action("Approved", () => "ran after approval", { group: "Users", approval: true });
  const router = routerFor(panel, { auth: tokens, controls: { actions: true, edit: true } });
  const changes = async (token: string) => (await call(router, "GET", "/api/changes", { headers: as(token) })).json.changes as Array<Record<string, unknown>>;
  const run = (token: string, id: string, body: object = {}) => call(router, "POST", `/api/actions/${id}`, { headers: as(token), body: JSON.stringify(body) });
  return { panel, router, changes, run };
}

describe("an action's result", () => {
  it("is the runner's alone by default: everybody else sees the run, not what it answered or was given", async () => {
    const { changes, run, panel } = fixture();
    expect((await run(ADA, "reset-link", { input: { user: "kim" } })).json.result.message).toBe("https://example.test/reset/kim");
    const mine = (await changes(ADA)).find((change) => change.target === "reset-link");
    expect(mine).toMatchObject({ outcome: "https://example.test/reset/kim", to: { user: "kim" }, by: "ada", visibility: "self" });
    expect(mine?.resultPrivate).toBeUndefined();
    const theirs = (await changes(SAM)).find((change) => change.target === "reset-link");
    expect(theirs).toMatchObject({ by: "ada", label: "Reset link", ok: true, resultPrivate: true, visibility: "self" });
    expect(theirs).not.toHaveProperty("outcome");
    expect(theirs).not.toHaveProperty("to");
    // Code, the change log and its sinks keep everything.
    expect(panel.changes().find((change) => change.target === "reset-link")?.outcome).toBe("https://example.test/reset/kim");
  });

  it("is everybody's with visibility: \"everyone\", and every runner's with \"runners\"", async () => {
    const { changes, run } = fixture();
    await run(ADA, "shared-note");
    await run(ADA, "runner-note");
    const of = async (token: string, target: string) => (await changes(token)).find((change) => change.target === target);
    expect(await of(VIEWER, "shared-note")).toMatchObject({ outcome: "everybody may read this" });
    expect(await of(SAM, "runner-note")).toMatchObject({ outcome: "for those who run things" });
    // An operator who may only look is not somebody who may run it.
    expect(await of(VIEWER, "runner-note")).toMatchObject({ resultPrivate: true, visibility: "runners" });
  });

  it("belongs to the proposer and the approver of an approved run", async () => {
    const { changes, run, router } = fixture();
    const proposed = await run(ADA, "approved", { reason: "because" });
    expect(proposed.status).toBe(202);
    await call(router, "POST", `/api/pending/${encodeURIComponent(proposed.json.pending.id)}/approve`, { headers: as(SAM), body: "{}" });
    const ran = async (token: string) => (await changes(token)).find((change) => change.kind === "action" && change.target === "approved");
    expect(await ran(ADA)).toMatchObject({ outcome: "ran after approval" });
    expect(await ran(SAM)).toMatchObject({ outcome: "ran after approval" });
    expect(await ran(VIEWER)).toMatchObject({ resultPrivate: true });
  });

  it("follows the panel's actionVisibility when an action does not say", async () => {
    const { changes, run } = fixture({ actionVisibility: "everyone" });
    await run(ADA, "reset-link", { input: { user: "kim" } });
    expect((await changes(SAM)).find((change) => change.target === "reset-link")).toMatchObject({ outcome: "https://example.test/reset/kim" });
  });

  it("refuses a visibility that is not one of the three", () => {
    const { panel } = panelAt();
    expect(() => panel.action("X", () => "", { visibility: "admins" as never })).toThrow(/"self", "runners" or "everyone"/);
    expect(() => panelAt(0, { actionVisibility: "nobody" as never })).toThrow(AdminPanelConfigError);
    expect(() => panel.table("T", { columns: ["id"], rows: [], actions: [{ label: "Go", run: () => "", visibility: "all" as never }] })).toThrow(/visibility/);
  });
});

describe("a row action", () => {
  function tableFixture() {
    const { panel } = panelAt();
    const seen: Array<{ row: string; input: unknown; by: string }> = [];
    panel.table("Users", {
      group: "Users",
      columns: ["id", "role"],
      rows: [{ id: "kim", role: "viewer" }],
      actions: [
        { label: "Change role", run: (row, { input, by }) => (seen.push({ row, input, by }), `${row} is now ${String(input.role)}`), input: { role: { kind: "enum", options: ["viewer", "editor", "admin"] }, note: { kind: "string", optional: true, maxLength: 20 } } },
        { label: "Delete", run: (row) => `deleted ${row}`, confirm: "type", destructive: true },
        { label: "Ping", run: (row) => `pinged ${row}` },
      ],
    });
    const router = routerFor(panel, { auth: tokens, controls: { actions: true } });
    const run = (id: string, body: object) => call(router, "POST", `/api/tables/users/actions/${id}`, { headers: as(ADA), body: JSON.stringify(body) });
    return { panel, router, run, seen };
  }

  it("is handed the operator's input, checked as an action's is, beside the row", async () => {
    const { run, seen } = tableFixture();
    const done = await run("change-role", { row: "kim", input: { role: "editor" } });
    expect(done.status).toBe(200);
    expect(done.json.result.message).toBe("kim is now editor");
    expect(seen).toEqual([{ row: "kim", input: { role: "editor" }, by: "ada" }]);
    expect((await run("change-role", { row: "kim", input: { role: "owner" } })).status).toBe(400);
    expect((await run("change-role", { row: "kim", input: {} })).json).toMatchObject({ key: "refuseRequired" });
    expect((await run("change-role", { row: "kim", input: { role: "admin", extra: 1 } })).json).toMatchObject({ key: "refuseInputUnknown" });
    expect((await run("change-role", { row: "kim", input: { role: "admin", note: "x".repeat(21) } })).status).toBe(400);
    expect(seen).toHaveLength(1);
    expect((await run("ping", { row: "kim", input: { anything: 1 } })).json).toMatchObject({ key: "refuseNoInput" });
    expect((await run("ping", { row: "kim" })).json.result.message).toBe("pinged kim");
  });

  it("tells the page what it asks for, and when its label is to be typed", async () => {
    const { router } = tableFixture();
    const schema = (await call(router, "GET", "/api/schema", { headers: as(ADA) })).json.schema;
    const table = schema.groups.flatMap((group: { items: Array<Record<string, unknown>> }) => group.items).find((item: Record<string, unknown>) => item.type === "table");
    const [role, del, ping] = table.actions;
    expect(role.input.map((field: { name: string }) => field.name)).toEqual(["role", "note"]);
    expect(del).toMatchObject({ confirm: true, destructive: true, typeToConfirm: true });
    expect(ping).not.toHaveProperty("input");
    expect(ping).not.toHaveProperty("typeToConfirm");
  });

  it("records its input with the run, kept for whoever ran it", async () => {
    const { panel, run } = tableFixture();
    await run("change-role", { row: "kim", input: { role: "admin" } });
    expect(panel.changes().at(-1)).toMatchObject({ kind: "action", target: "users/change-role", to: { role: "admin" }, visibility: "self", owners: ["ada"] });
  });

  it("refuses input fields and confirm values it cannot honour, at declaration", () => {
    const { panel } = panelAt();
    expect(() => panel.table("T", { columns: ["id"], rows: [], actions: [{ label: "Go", run: () => "", confirm: "twice" as never }] })).toThrow(/true, false or "type"/);
    expect(() => panel.table("U", { columns: ["id"], rows: [], actions: [{ label: "Go", run: () => "", input: { "bad name": { kind: "string" } } }] })).toThrow(/letters, digits and underscores/);
  });
});
