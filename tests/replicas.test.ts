/**
 * Replicas, the rest of the way: proposals decided on any replica and applied once, schedules that
 * fire once and outlive the replica that made them, and sign-outs every replica honours.
 */
import { describe, expect, it } from "vitest";
import { createAdminPanel, memorySync, type PanelSync, redisClaim, redisRevocations, signSession } from "../src/index.js";
import { EVERYTHING } from "../src/testing.js";
import { call, routerFor } from "./helpers.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 15));

function replicas(count: number, options: { claim?: boolean } = {}) {
  const bus = memorySync();
  return Array.from({ length: count }, (_, index) => {
    const connected = bus.connect();
    const sync: PanelSync = options.claim === false ? { publish: connected.publish, subscribe: connected.subscribe } : connected;
    const panel = createAdminPanel({ instance: `r${index}`, sync });
    const limit = panel.modifiable(10, { label: "Limit", approval: true });
    const mode = panel.modifiable("normal", "Mode");
    const flag = panel.modifiable(false, "Flag");
    panel.profile("On", [[flag, true]]);
    return { panel, limit, mode, flag };
  });
}

describe("proposals between replicas", () => {
  it("are listed everywhere, approved on another replica, applied once, and gone everywhere", async () => {
    const [a, b, c] = replicas(3) as [ReturnType<typeof replicas>[number], ReturnType<typeof replicas>[number], ReturnType<typeof replicas>[number]];
    const proposed = a.panel.edit("limit", 50, "ada", EVERYTHING, { reason: "tournament" });
    const id = proposed.ok && "pending" in proposed ? proposed.pending.id : "";
    await settle();
    expect(b.panel.pending().map((change) => [change.id, change.reason])).toEqual([[id, "tournament"]]);
    expect(await b.panel.approve(id, "ada", EVERYTHING)).toMatchObject({ ok: false, refusal: { key: "refuseOwnProposal" } });
    const [first, second] = await Promise.all([b.panel.approve(id, "sam", EVERYTHING), c.panel.approve(id, "kim", EVERYTHING)]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    await settle();
    expect([a.limit.value, b.limit.value, c.limit.value]).toEqual([50, 50, 50]);
    expect([a.panel.pending(), b.panel.pending(), c.panel.pending()]).toEqual([[], [], []]);
    for (const replica of [a, b, c]) replica.panel.close();
  });

  it("can be turned down from another replica", async () => {
    const [a, b] = replicas(2) as [ReturnType<typeof replicas>[number], ReturnType<typeof replicas>[number]];
    const proposed = a.panel.edit("limit", 50, "ada", EVERYTHING, { reason: "x" });
    await settle();
    expect((await b.panel.reject(proposed.ok && "pending" in proposed ? proposed.pending.id : "", "sam", EVERYTHING)).ok).toBe(true);
    await settle();
    expect(a.panel.pending()).toEqual([]);
  });
});

describe("schedules between replicas", () => {
  it("fire once, from whichever replica claims them, even after the one that made them is gone", async () => {
    const [a, b, c] = replicas(3) as [ReturnType<typeof replicas>[number], ReturnType<typeof replicas>[number], ReturnType<typeof replicas>[number]];
    const answer = a.panel.edit("mode", "maintenance", "ada", EVERYTHING, { at: Date.now() + 60_000 });
    const id = answer.ok && "value" in answer ? (answer.value.scheduled?.[0]?.id as string) : "";
    await settle();
    expect(b.panel.state(EVERYTHING).values.find((value) => value.id === "mode")?.scheduled?.[0]?.id).toBe(id);
    a.panel.close();
    b.panel.fireScheduledNow(id);
    c.panel.fireScheduledNow(id);
    await settle();
    expect([b.mode.value, c.mode.value]).toEqual(["maintenance", "maintenance"]);
    const fired = [b, c].flatMap((replica) => replica.panel.changes().filter((change) => change.by === "ada (scheduled)" && change.origin !== undefined && replica.panel.origin === change.origin));
    expect(fired).toHaveLength(1);
    b.panel.close();
    c.panel.close();
  });

  it("are cancelled everywhere, and timed changes revert once", async () => {
    const [a, b] = replicas(2) as [ReturnType<typeof replicas>[number], ReturnType<typeof replicas>[number]];
    const answer = a.panel.edit("mode", "quiet", "ada", EVERYTHING, { repeat: { every: "day", at: "02:00", timeZone: "UTC" } });
    const id = answer.ok && "value" in answer ? (answer.value.scheduled?.[0]?.id as string) : "";
    await settle();
    expect(b.panel.cancelScheduled(id, "sam", EVERYTHING).ok).toBe(true);
    await settle();
    expect(a.panel.state(EVERYTHING).values.find((value) => value.id === "mode")?.scheduled).toBeUndefined();
    a.panel.edit("mode", "busy", "ada", EVERYTHING, { revertAfterMs: 60_000 });
    await settle();
    expect(b.mode.value).toBe("busy");
    expect(b.panel.state(EVERYTHING).values.find((value) => value.id === "mode")?.revertAt).toBeDefined();
    b.panel.fireRevert(b.mode as never);
    a.panel.fireRevert(a.mode as never);
    await settle();
    expect([a.mode.value, b.mode.value]).toEqual(["normal", "normal"]);
    const madeHere = (replica: typeof a) => replica.panel.changes().filter((change) => change.kind === "revert" && change.origin === replica.panel.origin);
    expect(madeHere(a).length + madeHere(b).length).toBe(1);
    a.panel.close();
    b.panel.close();
  });

  it("fire only on the replica that made them when the channel cannot claim", async () => {
    const [a, b] = replicas(2, { claim: false }) as [ReturnType<typeof replicas>[number], ReturnType<typeof replicas>[number]];
    const answer = a.panel.edit("mode", "maintenance", "ada", EVERYTHING, { at: Date.now() + 60_000 });
    const id = answer.ok && "value" in answer ? (answer.value.scheduled?.[0]?.id as string) : "";
    await settle();
    b.panel.fireScheduledNow(id);
    await settle();
    expect(b.mode.value).toBe("normal");
    a.panel.fireScheduledNow(id);
    await settle();
    expect([a.mode.value, b.mode.value]).toEqual(["maintenance", "maintenance"]);
    a.panel.close();
    b.panel.close();
  });
});

describe("redisClaim", () => {
  it("takes a key once, in either client's form", async () => {
    const held = new Set<string>();
    const set = async (...args: unknown[]) => {
      const key = args[0] as string;
      if (held.has(key)) return null;
      held.add(key);
      return "OK";
    };
    const claim = redisClaim({ set });
    expect([await claim("a", 1000), await claim("a", 1000)]).toEqual([true, false]);
    const calls: unknown[][] = [];
    const nodeStyle = redisClaim({ set: async (...args: unknown[]) => (calls.push(args), "OK") }, { style: "node-redis" });
    await nodeStyle("b", 500);
    expect(calls[0]).toEqual(["apb:claim:b", "1", { PX: 500, NX: true }]);
  });
});

describe("shared session revocation", () => {
  it("refuses on every replica a session signed out on one", async () => {
    const secret = "a-session-secret-of-thirty-two-chars!";
    const keys = new Map<string, number>();
    let now = 0;
    const redis = {
      set: async (...args: unknown[]) => {
        keys.set(args[0] as string, now + (args[3] as number));
        return "OK";
      },
      exists: async (key: string) => ((keys.get(key) ?? -1) > now ? 1 : 0),
    };
    const revocations = redisRevocations(redis, { now: () => now });
    const one = routerFor(createAdminPanel(), { auth: { session: { secret, revocations } } });
    const two = routerFor(createAdminPanel(), { auth: { session: { secret, revocations } } });
    const cookie = `apb_session=${await signSession(secret, "ada")}`;
    expect((await call(two, "GET", "/api/schema", { headers: { cookie } })).status).toBe(200);
    await call(one, "GET", "/auth/logout", { headers: { cookie } });
    expect((await call(two, "GET", "/api/schema", { headers: { cookie } })).status).toBe(401);
    const broken = routerFor(createAdminPanel(), { auth: { session: { secret, revocations: { add: async () => undefined, has: () => Promise.reject(new Error("down")) } } } });
    expect((await call(broken, "GET", "/api/schema", { headers: { cookie: `apb_session=${await signSession(secret, "sam")}` } })).status).toBe(401);
  });
});
