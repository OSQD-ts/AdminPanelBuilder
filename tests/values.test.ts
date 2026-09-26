import { describe, expect, it, vi } from "vitest";
import { AdminPanelConfigError, ValueError } from "../src/index.js";
import { panelAt } from "./helpers.js";

describe("declaring a value", () => {
  it("hands back a handle that holds the value and converts to it where JavaScript asks for a primitive", () => {
    const { panel } = panelAt();
    const players = panel.viewable(10, "Players online");
    expect(players.value).toBe(10);
    // TypeScript refuses arithmetic on an object; plain JavaScript converts, which is what this checks.
    const loose = players as unknown as number;
    expect(loose + 1).toBe(11);
    expect(loose > 5).toBe(true);
    expect(`${players}`).toBe("10");
    expect(JSON.stringify({ players })).toBe('{"players":10}');
  });

  it("sees a write through .value, set() and update()", () => {
    const { panel } = panelAt();
    const players = panel.viewable(1, "Players");
    players.value += 1;
    players.set(5);
    players.update((current) => current * 2);
    expect(players.value).toBe(10);
    expect(panel.state().values.find((value) => value.id === "players")?.value).toBe(10);
  });

  it("derives the id from the label, and the kind from the value", () => {
    const { panel } = panelAt();
    expect(panel.viewable(1, "Players online").id).toBe("players-online");
    expect(panel.viewable("x", "Zażółć gęślą").id).toBe("zazolc-gesla");
    expect(panel.viewable(true, "flag").kind).toBe("boolean");
    expect(panel.viewable({ a: 1 }, "record").kind).toBe("json");
    expect(panel.modifiable("blitz", { label: "control", options: ["blitz", "rapid"] }).kind).toBe("enum");
  });

  it("names an unlabelled value by order and says why that is fragile", () => {
    const { panel } = panelAt();
    const first = panel.viewable(1);
    const second = panel.viewable(2);
    expect([first.id, second.id]).toEqual(["value-1", "value-2"]);
    expect(first.label).toBe("Value 1");
    const notice = panel.notices().find((entry) => entry.id === "unnamed-values");
    expect(notice?.message).toMatch(/2 values have no label/);
  });

  it("refuses two values with one id rather than letting the second replace the first", () => {
    const { panel } = panelAt();
    panel.viewable(1, "Players");
    expect(() => panel.viewable(2, "Players")).toThrow(/two values have the id "players"/);
  });

  it("refuses an id that could not travel in a path, a store key and an element id", () => {
    const { panel } = panelAt();
    expect(() => panel.viewable(1, { id: "has space" })).toThrow(AdminPanelConfigError);
  });

  it("refuses an option nothing reads, and suggests the one that was meant", () => {
    const { panel } = panelAt();
    expect(() => panel.modifiable(1, { label: "x", maximum: 5 } as never)).toThrow(/"maximum" that nothing reads/);
    expect(() => panel.modifiable(1, { label: "x", presist: true } as never)).toThrow(/did you mean "persist"/);
    expect(() => panel.viewable(1, { label: "x", validate: () => undefined } as never)).toThrow(/"validate" that nothing reads/);
  });
});

describe("the three sources", () => {
  it("reads a function whenever somebody looks, and refuses to set it", () => {
    const { panel } = panelAt();
    const queue = [1, 2, 3];
    const length = panel.viewable(() => queue.length, "Queue length");
    queue.push(4);
    expect(length.value).toBe(4);
    expect(length.live).toBe(true);
    expect(() => length.set(1)).toThrow(/read from a function/);
  });

  it("reads and writes a bound property through its object, so the application sees an operator's change at once", () => {
    const { panel } = panelAt();
    const config = { maxPlayers: 100 };
    const bound = panel.bind(config, "maxPlayers", { editable: true, min: 2, max: 500 });
    config.maxPlayers = 120;
    expect(bound.value).toBe(120);
    const outcome = panel.edit("maxplayers", 300, "ada", { groups: undefined, edit: true, actions: false, restrictions: [] });
    expect(outcome.ok).toBe(true);
    expect(config.maxPlayers).toBe(300);
  });

  it("isolates a throwing getter: the value shows the failure and the rest of the state still arrives", () => {
    const { panel } = panelAt();
    panel.viewable(() => {
      throw new Error("database is down");
    }, "Broken");
    panel.viewable(7, "Fine");
    const state = panel.state();
    expect(state.values.find((value) => value.id === "broken")?.error).toMatch(/database is down/);
    expect(state.values.find((value) => value.id === "fine")?.value).toBe(7);
    expect(panel.notices().some((notice) => notice.id === "getter-broken")).toBe(true);
  });

  it("says what it could not read, and the notice about it, in words a page can translate", async () => {
    const { ENGLISH, LOCALES, format } = await import("../src/i18n/messages.js");
    const GERMAN = LOCALES.de as Record<string, string>;
    const { panel } = panelAt();
    panel.viewable(() => {
      throw new Error("database is down");
    }, "Broken");
    const wire = panel.state().values.find((value) => value.id === "broken") as { error: string; errorKey: string; errorParams: Record<string, string> };
    // The English sentence for every caller that has always read it, and the parts beside it.
    expect(wire.error).toBe("reading Broken failed: database is down");
    expect([wire.errorKey, wire.errorParams]).toEqual(["readFailed", { label: "Broken", reason: "database is down" }]);
    expect(format(ENGLISH[wire.errorKey as "readFailed"], wire.errorParams)).toBe(wire.error);
    // A page in another language says the frame in it; the application's own words stay as they are.
    expect(format(GERMAN[wire.errorKey] as string, wire.errorParams)).toBe("Broken konnte nicht gelesen werden: database is down");
    const notice = panel.notices().find((entry) => entry.id === "getter-broken") as { message: string; key: string; params: Record<string, string> };
    expect([notice.key, notice.params]).toEqual(["noticeGetterThrew", { label: "Broken", reason: "database is down" }]);
    expect(format(ENGLISH[notice.key as "noticeGetterThrew"], notice.params)).toBe(notice.message);
    expect(format(GERMAN[notice.key] as string, notice.params)).toMatch(/^Das Lesen von Broken hat einen Fehler geworfen: database is down\./);
  });

  it("leaves words it did not write itself as they are: an alert's sentence reads the same everywhere", () => {
    const { panel, clock } = panelAt();
    panel.viewable(100, { label: "Heat", status: { warn: 50, bad: 90 }, alert: {} });
    clock.advance(1000);
    panel.tick();
    const notice = panel.notices().find((entry) => entry.id === "alert-heat");
    expect(notice?.message).toMatch(/Heat is bad: 100/);
    expect(notice?.key).toBeUndefined();
  });

  it("refuses a modifiable function, which has nowhere to put a new value", () => {
    const { panel } = panelAt();
    expect(() => panel.modifiable((() => 1) as never, "fn")).toThrow(/was given a function/);
  });
});

describe("constraints", () => {
  it("hold for code as well as for operators", () => {
    const { panel } = panelAt();
    const limit = panel.modifiable(10, { label: "Limit", min: 1, max: 100 });
    expect(() => limit.set(1000)).toThrow(ValueError);
    expect(() => limit.set(1000)).toThrow("Limit must be at most 100");
    expect(limit.value).toBe(10);
  });

  it("do not stop a viewable from showing whatever it is given", () => {
    const { panel } = panelAt();
    const shown = panel.viewable(1, "Shown");
    shown.set("not a number" as never);
    expect(panel.state().values[0]?.value).toBe("not a number");
  });

  it("are refused at declaration when they could never hold", () => {
    const { panel } = panelAt();
    expect(() => panel.modifiable(5, { label: "a", min: 10, max: 1 })).toThrow(/minimum of 10 above its maximum of 1/);
    expect(() => panel.modifiable(5, { label: "b", step: 0 })).toThrow(/step must be a positive number/);
    expect(() => panel.modifiable(500, { label: "c", max: 100 })).toThrow(/starts at 500, which its own declaration refuses/);
    expect(() => panel.modifiable("x", { label: "d", min: 1 })).toThrow(/only constrain numbers/);
    expect(() => panel.modifiable("x", { label: "e", options: [] })).toThrow(/empty list of options/);
    expect(() => panel.modifiable("x", { label: "f", options: ["x", "x"] })).toThrow(/lists the option "x" twice/);
    expect(() => panel.modifiable(1, { label: "g", maxLength: 5 })).toThrow(/only constrain text/);
  });

  it("accept values on a fractional step despite binary fractions", () => {
    const { panel } = panelAt();
    const rate = panel.modifiable(0.1, { label: "Rate", min: 0, max: 1, step: 0.1 });
    rate.set(0.1 + 0.2);
    expect(() => rate.set(0.25)).toThrow(/multiple of 0.1/);
  });

  it("drop the g and y flags from a pattern, which would accept a value on one write and refuse it on the next", () => {
    const { panel } = panelAt();
    const code = panel.modifiable("ab", { label: "Code", pattern: /^[a-z]+$/g });
    code.set("cd");
    code.set("cd");
    code.set("ef");
    expect(code.value).toBe("ef");
  });

  it("run the custom validator after the declared ones, and turn a throwing validator into a refusal", () => {
    const { panel } = panelAt();
    const even = panel.modifiable(2, { label: "Even", validate: (next) => (next % 2 === 0 ? undefined : "Even must be even") });
    expect(() => even.set(3)).toThrow("Even must be even");
    const broken = panel.modifiable(1, {
      label: "Broken validator",
      validate: (next) => {
        if (next > 1) throw new Error("boom");
        return undefined;
      },
    });
    expect(() => broken.set(2)).toThrow(/the validator for Broken validator failed: boom/);
  });
});

describe("change listeners", () => {
  it("hear every change with who made it, and only real changes", () => {
    const { panel } = panelAt();
    const value = panel.modifiable(1, "v");
    const heard: Array<[number, string]> = [];
    value.on((next, change) => heard.push([next, change.by]));
    value.set(1);
    value.set(2);
    panel.edit("v", 3, "ada", { groups: undefined, edit: true, actions: false, restrictions: [] });
    expect(heard).toEqual([
      [2, "code"],
      [3, "ada"],
    ]);
  });

  it("cannot take the write down when they throw", () => {
    const onError = vi.fn();
    const { panel } = panelAt(0, { onError });
    const value = panel.viewable(1, "v");
    value.on(() => {
      throw new Error("listener bug");
    });
    value.set(2);
    expect(value.value).toBe(2);
    expect(onError).toHaveBeenCalled();
  });

  it("run onChange for an operator's edit, and report its failure without undoing the edit", async () => {
    const onError = vi.fn();
    const { panel } = panelAt(0, { onError });
    const scope = { groups: undefined, edit: true, actions: false, restrictions: [] };
    const applied: number[] = [];
    panel.modifiable(1, { label: "ok", onChange: (next) => void applied.push(next) });
    panel.modifiable(1, {
      label: "bad",
      onChange: async () => {
        throw new Error("apply failed");
      },
    });
    panel.edit("ok", 5, "ada", scope);
    panel.edit("bad", 5, "ada", scope);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(applied).toEqual([5]);
    expect(panel.get("bad")?.value).toBe(5);
    expect(panel.notices().some((notice) => notice.id === "on-change-bad")).toBe(true);
    expect(onError).toHaveBeenCalled();
  });
});

describe("sensitive values", () => {
  it("never leave the process, in the state or in the change history", () => {
    const { panel } = panelAt();
    panel.modifiable("hunter2", { label: "Password", sensitive: true });
    const wire = panel.state().values[0];
    expect(wire?.masked).toBe(true);
    expect(JSON.stringify(panel.state())).not.toContain("hunter2");
    panel.edit("password", "correct horse", "ada", { groups: undefined, edit: true, actions: false, restrictions: [] });
    expect(JSON.stringify(panel.changes())).not.toContain("correct horse");
    expect(JSON.stringify(panel.changes())).not.toContain("hunter2");
  });
});
