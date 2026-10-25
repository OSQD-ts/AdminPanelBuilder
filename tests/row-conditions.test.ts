/**
 * Row actions offered on some rows only: `when` hides an action on a row, `enabledWhen` shows it
 * disabled with a reason. Both are worked out on the server for every row it sends and checked
 * again when the action is run, so a page that drew a button for a row that has since changed is
 * refused rather than obeyed.
 */
import { describe, expect, it } from "vitest";
import type { PanelScope, TableQuery } from "../src/index.js";
import { call, jsonWrite, panelAt, routerFor, TOKEN } from "./helpers.js";

const all: PanelScope = { groups: undefined, edit: true, actions: true, restrictions: [] };
const query = (over: Partial<TableQuery> = {}) => ({ offset: 0, limit: 10, direction: "asc" as const, search: "", ...over });

interface Account {
  id: string;
  name: string;
  status: "active" | "suspended" | "closed";
}

function accounts() {
  const { panel } = panelAt();
  const rows: Account[] = [
    { id: "a1", name: "Ada", status: "active" },
    { id: "a2", name: "Bo", status: "suspended" },
    { id: "a3", name: "Cy", status: "closed" },
  ];
  const ran: string[] = [];
  panel.table<Account>("Accounts", {
    columns: ["id", "name", "status"],
    rows: () => rows,
    actions: [
      { label: "Suspend", when: (row) => row.status === "active", run: (id) => void ran.push(`suspend ${id}`) },
      { label: "Reactivate", when: { field: "status", equals: "suspended" }, run: (id) => void ran.push(`reactivate ${id}`) },
      { label: "Delete", enabledWhen: (row) => (row.status === "closed" ? true : "close the account first"), run: (id) => void ran.push(`delete ${id}`) },
    ],
  });
  return { panel, rows, ran };
}

describe("row actions offered on some rows", () => {
  it("send each row the actions it offers, and the ones it shows disabled with why", async () => {
    const { panel } = accounts();
    const page = await panel.tableRows("accounts", query(), all);
    const byId = Object.fromEntries((page?.rows ?? []).map((row) => [row.id, { actions: row.actions, disabled: row.disabled }]));
    expect(byId.a1).toEqual({ actions: ["suspend", "delete"], disabled: { delete: "close the account first" } });
    expect(byId.a2).toEqual({ actions: ["reactivate", "delete"], disabled: { delete: "close the account first" } });
    expect(byId.a3).toEqual({ actions: ["delete"], disabled: undefined });
  });

  it("leave a table whose actions apply to every row exactly as it was: no per-row lists", async () => {
    const { panel } = panelAt();
    panel.table("Plain", { columns: ["id"], rows: [{ id: "x" }], actions: [{ label: "Poke", run: () => "poked" }] });
    const row = (await panel.tableRows("plain", query(), all))?.rows[0];
    expect(row).toEqual({ id: "x", cells: { id: "x" } });
  });

  it("run an action the row offers", async () => {
    const { panel, ran } = accounts();
    expect(await panel.runRowAction("accounts", "suspend", "a1", "ada", all)).toMatchObject({ ok: true });
    expect(ran).toEqual(["suspend a1"]);
  });

  it("refuse an action the row no longer offers: the page's button was drawn for the row as it was", async () => {
    const { panel, rows, ran } = accounts();
    await panel.tableRows("accounts", query(), all);
    // Somebody else suspended Ada after this page was drawn: its Suspend button is stale.
    (rows[0] as Account).status = "suspended";
    const outcome = await panel.runRowAction("accounts", "suspend", "a1", "ada", all);
    expect(outcome).toMatchObject({ ok: false, reason: "conflict", refusal: { key: "refuseRowActionUnavailable" } });
    expect(ran).toEqual([]);
    expect(panel.changes()).toHaveLength(0);
  });

  it("refuse an action shown disabled, saying why, and one asked for a row that is gone", async () => {
    const { panel, rows, ran } = accounts();
    expect(await panel.runRowAction("accounts", "delete", "a1", "ada", all)).toMatchObject({ ok: false, reason: "conflict", refusal: { key: "refuseRowActionDisabledBecause", params: { reason: "close the account first" } } });
    rows.splice(0, 1);
    expect(await panel.runRowAction("accounts", "reactivate", "a1", "ada", all)).toMatchObject({ ok: false, reason: "conflict", refusal: { key: "refuseRowGone" } });
    expect(ran).toEqual([]);
  });

  it("hide an action whose condition throws, and refuse it: a button is never offered on a guess", async () => {
    const { panel } = panelAt();
    panel.table("T", {
      columns: ["id"],
      rows: [{ id: "x" }],
      actions: [{ label: "Go", when: () => { throw new Error("broken"); }, run: () => "went" }],
    });
    expect((await panel.tableRows("t", query(), all))?.rows[0]?.actions).toEqual([]);
    expect(await panel.runRowAction("t", "go", "x", "ada", all)).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("take a declarative match: equals, in, and a reason for enabledWhen", async () => {
    const { panel } = panelAt();
    panel.table("Jobs", {
      columns: ["id", "state"],
      rows: [{ id: "j1", state: "queued" }, { id: "j2", state: "running" }, { id: "j3", state: "done" }],
      actions: [
        { label: "Cancel", when: { field: "state", in: ["queued", "running"] }, run: () => "cancelled" },
        { label: "Retry", enabledWhen: { field: "state", equals: "done", reason: "only a finished job is retried" }, run: () => "retried" },
      ],
    });
    const rows = (await panel.tableRows("jobs", query(), all))?.rows ?? [];
    expect(rows.map((row) => row.actions)).toEqual([["cancel", "retry"], ["cancel", "retry"], ["retry"]]);
    expect(rows[0]?.disabled).toEqual({ retry: "only a finished job is retried" });
    expect(rows[2]?.disabled).toBeUndefined();
  });

  it("are refused when the panel is made, not on every row, when they could not work", () => {
    const { panel } = panelAt();
    const base = { columns: ["id", "status"], rows: [{ id: "a", status: "x" }] };
    expect(() => panel.table("A", { ...base, actions: [{ label: "Go", when: { field: "stauts", equals: "x" }, run: () => "" }] })).toThrow(/"stauts", which is not one of the table's columns/);
    expect(() => panel.table("B", { ...base, actions: [{ label: "Go", when: { field: "status", equals: "x", in: ["x"] } as never, run: () => "" }] })).toThrow(/exactly one of equals or in/);
    expect(() => panel.table("C", { ...base, actions: [{ label: "Go", when: { field: "status", in: [] }, run: () => "" }] })).toThrow(/non-empty list/);
    expect(() => panel.table("D", { ...base, actions: [{ label: "Go", when: { field: "status", equals: "x", unless: 1 } as never, run: () => "" }] })).toThrow(/unless/);
    expect(() => panel.table("E", { ...base, actions: [{ label: "Go", enabledWhen: { field: "status", equals: "x", reason: "y".repeat(300) }, run: () => "" }] })).toThrow(/at most 200 characters/);
  });

  it("need findRow on a fetch table, so running one can look at the row as it is now", async () => {
    const { panel } = panelAt();
    const page = () => ({ rows: [{ id: "f1", open: true }], total: 1 });
    expect(() => panel.table("F", { columns: ["id", "open"], fetch: page, actions: [{ label: "Close", when: { field: "open", equals: true }, run: () => "closed" }] })).toThrow(/needs findRow/);
    let open = true;
    panel.table("G", {
      columns: ["id", "open"],
      fetch: page,
      findRow: (id) => (id === "f1" ? { id: "f1", open } : undefined),
      actions: [{ label: "Close", when: { field: "open", equals: true }, run: () => "closed" }],
    });
    expect(await panel.runRowAction("g", "close", "f1", "ada", all)).toMatchObject({ ok: true, message: "closed" });
    open = false;
    expect(await panel.runRowAction("g", "close", "f1", "ada", all)).toMatchObject({ ok: false, reason: "conflict", refusal: { key: "refuseRowActionUnavailable" } });
    expect(await panel.runRowAction("g", "close", "nope", "ada", all)).toMatchObject({ ok: false, reason: "conflict", refusal: { key: "refuseRowGone" } });
  });

  it("answer a failing findRow as a failure, not as the row being gone", async () => {
    const { panel } = panelAt();
    panel.table("H", {
      columns: ["id"],
      fetch: () => ({ rows: [{ id: "h1" }], total: 1 }),
      findRow: () => {
        throw new Error("database down");
      },
      actions: [{ label: "Go", when: () => true, run: () => "went" }],
    });
    expect(await panel.runRowAction("h", "go", "h1", "ada", all)).toMatchObject({ ok: false, reason: "failed" });
  });
});

describe("row actions offered on some rows, over HTTP", () => {
  it("carry each row's actions in the page, and answer a stale button with 409 and the reason", async () => {
    const { panel, rows } = accounts();
    const router = routerFor(panel, { auth: { token: TOKEN }, controls: { actions: true } });
    const page = await call(router, "GET", "/api/tables/accounts", { headers: jsonWrite });
    expect(page.status).toBe(200);
    expect(page.json.table.rows[0]).toMatchObject({ id: "a1", actions: ["suspend", "delete"], disabled: { delete: "close the account first" } });
    (rows[0] as Account).status = "closed";
    const stale = await call(router, "POST", "/api/tables/accounts/actions/suspend", { headers: jsonWrite, body: JSON.stringify({ row: "a1" }) });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ code: "conflict", key: "refuseRowActionUnavailable" });
  });
});
