/**
 * Access control below the listener: grants per operator from each kind of sign-in, sessions that
 * can be ended early, OIDC groups and logout, write limits, a shared sign-in throttle, and the
 * change log's hash chain.
 */
import { describe, expect, it } from "vitest";
import { memoryChangeLog, signSession, verifyChain } from "../src/index.js";
import { narrowScope, READ_ONLY_SCOPE, unionGrants } from "../src/panel/scope.js";
import { redisThrottleStore, type RedisThrottleLike } from "../src/server/auth.js";
import { base64url, sessionInfo } from "../src/server/session.js";
import { call, jsonWrite, panelAt, routerFor, TOKEN } from "./helpers.js";

const SECRET = "a-session-secret-of-thirty-two-chars!";
const OTHER = "another-session-secret-of-32-chars!!";
const write = { "content-type": "application/json" };

function fixture() {
  const { panel, clock } = panelAt();
  panel.modifiable(10, { label: "Limit", group: "Game" });
  panel.modifiable("x", { label: "Note", group: "Mail" });
  panel.action("Flush", () => "done", { group: "Game" });
  return { panel, clock };
}

describe("grants narrow one operator below the listener", () => {
  it("never widen: an intersection with what the listener allows", () => {
    const listener = { groups: new Set(["Game", "Mail"]), edit: new Set(["Game"]), actions: true, restrictions: [] } as const;
    const narrowed = narrowScope(listener, { groups: ["Game", "Finance"], edit: true, actions: ["Mail"] });
    expect([...(narrowed.groups ?? [])]).toEqual(["Game"]);
    expect([...(narrowed.edit as Set<string>)]).toEqual(["Game"]);
    expect([...(narrowed.actions as Set<string>)]).toEqual(["Mail"]);
    expect(narrowScope(READ_ONLY_SCOPE, { edit: true }).edit).toBe(false);
    expect(narrowScope(listener, undefined)).toBe(listener);
  });

  it("combine across provider groups as whatever any of them allows", () => {
    expect(unionGrants([{ groups: ["Game"], edit: ["Game"] }, { groups: ["Mail"], edit: false }])).toEqual({ groups: ["Game", "Mail"], edit: ["Game"] });
    expect(unionGrants([{ edit: true }, { edit: ["Mail"] }])).toEqual({ edit: true });
    // A grant without edit leaves it at whatever the listener allows, the widest there is.
    expect(unionGrants([{ edit: ["Mail"] }, { groups: ["Mail"] }])).toEqual({});
    expect(unionGrants([{ actions: false }, { actions: false }])).toEqual({ actions: false });
  });

  it("come from a token entry, and are refused when they grant nothing readable", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, { auth: { tokens: { ada: TOKEN, sam: { token: "sams-token-is-long-enough", grants: { groups: ["Mail"], edit: ["Mail"] } } } }, controls: { edit: true } });
    const asSam = { authorization: "Bearer sams-token-is-long-enough", ...write };
    const schema = await call(router, "GET", "/api/schema", { headers: asSam });
    expect(schema.json.schema.groups.map((group: { title: string }) => group.title)).toEqual(["Mail"]);
    expect(schema.json.schema.restrictions.at(-1)).toMatchObject({ text: expect.stringMatching(/Your sign-in narrows/), key: "restrictionGrants" });
    expect((await call(router, "POST", "/api/values/limit", { headers: asSam, body: '{"value":2}' })).status).toBe(404);
    expect((await call(router, "POST", "/api/values/note", { headers: asSam, body: '{"value":"y"}' })).status).toBe(200);
    expect((await call(router, "POST", "/api/values/limit", { headers: jsonWrite, body: '{"value":2}' })).status).toBe(200);
    expect(() => routerFor(panel, { auth: { tokens: { sam: { token: TOKEN, grants: { edit: "yes" } as never } } } })).toThrow(/grants.edit is true, false or a list/);
  });

  it("come from auth.check, and a check answering with unreadable grants admits nobody", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, {
      auth: { check: (request) => (request.headers["x-user"] === "ops" ? { name: "ops", grants: { actions: false } } : request.headers["x-user"] === "odd" ? ({ name: "odd", grants: { groups: "Game" } } as never) : false) },
      controls: { edit: true, actions: true },
    });
    expect((await call(router, "POST", "/api/actions/flush", { headers: { "x-user": "ops", ...write }, body: "{}" })).status).toBe(403);
    expect((await call(router, "POST", "/api/values/limit", { headers: { "x-user": "ops", ...write }, body: '{"value":3}' })).status).toBe(200);
    expect((await call(router, "GET", "/api/schema", { headers: { "x-user": "odd" } })).status).toBe(401);
  });

  it("come from a signed session", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, { auth: { session: { secret: SECRET } }, controls: { edit: true } });
    const cookie = `apb_session=${await signSession(SECRET, "ada", { grants: { edit: false } })}`;
    expect((await call(router, "POST", "/api/values/limit", { headers: { cookie, ...write }, body: '{"value":3}' })).status).toBe(403);
    await expect(signSession(SECRET, "ada", { grants: { widen: true } as never })).rejects.toThrow(/grants has "widen"/);
  });
});

describe("sessions end when they are told to", () => {
  it("is refused once signed out, and the old cookie stays refused", async () => {
    const { panel } = fixture();
    const router = routerFor(panel, { auth: { session: { secret: SECRET } } });
    const cookie = `apb_session=${await signSession(SECRET, "ada")}`;
    expect((await call(router, "GET", "/api/schema", { headers: { cookie } })).status).toBe(200);
    const out = await call(router, "GET", "/auth/logout", { headers: { cookie } });
    expect(out.status).toBe(303);
    expect(out.headers["set-cookie"]).toMatch(/Max-Age=0/);
    expect((await call(router, "GET", "/api/schema", { headers: { cookie } })).status).toBe(401);
  });

  it("asks revoked(id) on every request, and a check that throws refuses", async () => {
    const { panel } = fixture();
    const revoked = new Set<string>();
    let broken = false;
    const router = routerFor(panel, {
      auth: {
        session: {
          secret: SECRET,
          revoked: (id) => {
            if (broken) throw new Error("store down");
            return revoked.has(id);
          },
        },
      },
    });
    const sealed = await signSession(SECRET, "ada");
    const cookie = `apb_session=${sealed}`;
    expect((await call(router, "GET", "/api/schema", { headers: { cookie } })).status).toBe(200);
    revoked.add((await sessionInfo(SECRET, sealed))?.id as string);
    expect((await call(router, "GET", "/api/schema", { headers: { cookie } })).status).toBe(401);
    revoked.clear();
    broken = true;
    expect((await call(router, "GET", "/api/schema", { headers: { cookie } })).status).toBe(401);
  });

  it("rotates secrets: the first signs, every one verifies, and dropping one signs its sessions out", async () => {
    const { panel } = fixture();
    const old = `apb_session=${await signSession(OTHER, "ada")}`;
    const rotating = routerFor(panel, { auth: { session: { secret: [SECRET, OTHER] } } });
    expect((await call(rotating, "GET", "/api/schema", { headers: { cookie: old } })).status).toBe(200);
    const fresh = await signSession([SECRET, OTHER], "sam");
    expect(await sessionInfo(SECRET, fresh)).toMatchObject({ name: "sam" });
    const rotated = routerFor(panel, { auth: { session: { secret: [SECRET] } } });
    expect((await call(rotated, "GET", "/api/schema", { headers: { cookie: old } })).status).toBe(401);
    expect(() => routerFor(panel, { auth: { session: { secret: [] } } })).toThrow(/list is empty/);
  });
});

const ISSUER = "https://idp.example";

async function provider(claims: (nonce: string) => Record<string, unknown>, options: { endSession?: boolean } = {}) {
  const keyPair = async (kid: string) => {
    const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as { publicKey: CryptoKey; privateKey: CryptoKey };
    return { kid, pair, jwk: { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid } };
  };
  let current = await keyPair("k1");
  let published = [current.jwk];
  let jwksFetches = 0;
  let nonce = "";
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url === `${ISSUER}/.well-known/openid-configuration`)
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks`, ...(options.endSession ? { end_session_endpoint: `${ISSUER}/logout` } : {}) });
    if (url === `${ISSUER}/jwks`) {
      jwksFetches += 1;
      return Response.json({ keys: published });
    }
    if (url === `${ISSUER}/token`) {
      void init;
      const head = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: current.kid })));
      const payload = base64url(new TextEncoder().encode(JSON.stringify(claims(nonce))));
      const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", current.pair.privateKey, new TextEncoder().encode(`${head}.${payload}`)));
      return Response.json({ id_token: `${head}.${payload}.${base64url(signature)}` });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return {
    fetcher,
    setNonce: (value: string) => (nonce = value),
    rotate: async () => {
      current = await keyPair("k2");
      published = [current.jwk];
    },
    fetches: () => jwksFetches,
  };
}

async function signInWith(router: ReturnType<typeof routerFor>, idp: Awaited<ReturnType<typeof provider>>) {
  const login = await call(router, "GET", "/auth/login");
  const authorize = new URL(login.headers.location as string);
  idp.setNonce(authorize.searchParams.get("nonce") as string);
  const flow = (login.headers["set-cookie"] as string).split(";")[0] as string;
  return call(router, "GET", `/auth/callback?code=good-code&state=${authorize.searchParams.get("state")}`, { headers: { cookie: flow } });
}

const seconds = () => Math.floor(Date.now() / 1000);

describe("OpenID Connect, deeper", () => {
  it("maps the provider's groups to grants, and refuses someone in none of them", async () => {
    const { panel } = fixture();
    let groups: unknown = ["support"];
    const idp = await provider((nonce) => ({ iss: ISSUER, aud: "panel", exp: seconds() + 300, nonce, email: "ada@example.com", roles: groups }));
    const router = routerFor(panel, { auth: { oidc: { issuer: ISSUER, clientId: "panel", baseUrl: "https://ops.example", secret: SECRET, fetch: idp.fetcher, groups: { claim: "roles", grants: { support: { groups: ["Mail"], edit: false }, admins: { edit: true } } } } }, controls: { edit: true } }, undefined);
    const callback = await signInWith(router, idp);
    expect(callback.status).toBe(303);
    const cookie = (callback.headers["set-cookie"] as string).split(";")[0] as string;
    const schema = await call(router, "GET", "/api/schema", { headers: { cookie } });
    expect(schema.json.schema.groups.map((group: { title: string }) => group.title)).toEqual(["Mail"]);
    expect(schema.json.schema.controls.edit).toBe(false);
    groups = ["guests"];
    expect((await signInWith(router, idp)).status).toBe(403);
    expect(() => routerFor(panel, { auth: { oidc: { issuer: ISSUER, clientId: "panel", baseUrl: "https://ops.example", secret: SECRET, groups: { grants: {} } } } }, undefined)).toThrow(/names no provider group/);
  });

  it("signs out at the provider too, where it offers that, and refuses the old cookie", async () => {
    const { panel } = fixture();
    const idp = await provider((nonce) => ({ iss: ISSUER, aud: "panel", exp: seconds() + 300, nonce, email: "ada@example.com" }), { endSession: true });
    const router = routerFor(panel, { auth: { oidc: { issuer: ISSUER, clientId: "panel", baseUrl: "https://ops.example", secret: SECRET, fetch: idp.fetcher } } }, undefined);
    const cookie = ((await signInWith(router, idp)).headers["set-cookie"] as string).split(";")[0] as string;
    const out = await call(router, "GET", "/auth/logout", { headers: { cookie } });
    const target = new URL(out.headers.location as string);
    expect(target.origin + target.pathname).toBe(`${ISSUER}/logout`);
    expect(target.searchParams.get("post_logout_redirect_uri")).toBe("https://ops.example/");
    expect((await call(router, "GET", "/api/schema", { headers: { cookie } })).status).toBe(401);
  });

  it("follows the provider's key rotation with one refresh of its key set", async () => {
    const { panel } = fixture();
    const idp = await provider((nonce) => ({ iss: ISSUER, aud: "panel", exp: seconds() + 300, nonce, email: "ada@example.com" }));
    const router = routerFor(panel, { auth: { oidc: { issuer: ISSUER, clientId: "panel", baseUrl: "https://ops.example", secret: SECRET, fetch: idp.fetcher } } }, undefined);
    expect((await signInWith(router, idp)).status).toBe(303);
    const before = idp.fetches();
    await idp.rotate();
    expect((await signInWith(router, idp)).status).toBe(303);
    expect(idp.fetches()).toBe(before + 1);
  });
});

describe("limits on writes and on guessing", () => {
  it("answers 429 past an operator's writes a minute, counted per operator", async () => {
    const { panel, clock } = fixture();
    const router = routerFor(panel, { auth: { tokens: { ada: TOKEN, sam: "sams-token-is-long-enough" } }, controls: { edit: true }, writeLimit: { perMinute: 2 }, clock });
    const edit = (headers: Record<string, string>) => call(router, "POST", "/api/values/limit", { headers, body: '{"value":4}' });
    expect((await edit(jsonWrite)).status).toBe(200);
    expect((await edit(jsonWrite)).status).toBe(200);
    const limited = await edit(jsonWrite);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect((await edit({ authorization: "Bearer sams-token-is-long-enough", ...write })).status).toBe(200);
    clock.advance(60_000);
    expect((await edit(jsonWrite)).status).toBe(200);
    expect(() => routerFor(panel, { auth: { token: TOKEN }, writeLimit: { perMinute: 0 } })).toThrow(/perMinute/);
  });

  it("shares failed sign-ins between replicas through a throttle store", async () => {
    const data = new Map<string, { value: number; expires: number }>();
    let now = 0;
    const redis: RedisThrottleLike = {
      incr: async (key) => {
        const entry = data.get(key) ?? { value: 0, expires: Number.POSITIVE_INFINITY };
        entry.value += 1;
        data.set(key, entry);
        return entry.value;
      },
      pexpire: async (key, ms) => {
        const entry = data.get(key);
        if (entry !== undefined) entry.expires = now + ms;
      },
      pttl: async (key) => {
        const entry = data.get(key);
        return entry === undefined ? -2 : entry.expires === Number.POSITIVE_INFINITY ? -1 : entry.expires - now;
      },
      get: async (key) => {
        const entry = data.get(key);
        if (entry === undefined || entry.expires <= now) return null;
        return String(entry.value);
      },
      del: async (key) => data.delete(key),
    };
    const store = redisThrottleStore(redis);
    const { panel } = fixture();
    const one = routerFor(panel, { auth: { token: TOKEN }, authThrottle: { failures: 2, store } });
    const two = routerFor(panel, { auth: { token: TOKEN }, authThrottle: { failures: 2, store } });
    const wrong = { headers: { authorization: "Bearer wrong-token-long-enough" }, address: "203.0.113.9" };
    expect((await call(one, "GET", "/api/schema", wrong)).status).toBe(401);
    expect((await call(two, "GET", "/api/schema", wrong)).status).toBe(401);
    const locked = await call(one, "GET", "/api/schema", { ...wrong, headers: { authorization: `Bearer ${TOKEN}` } });
    expect(locked.status).toBe(429);
    now += 61_000;
    expect((await call(two, "GET", "/api/schema", { headers: { authorization: `Bearer ${TOKEN}` }, address: "203.0.113.9" })).status).toBe(200);
  });

  it("lets requests through to authentication when the throttle store is down, and says so", async () => {
    const { panel } = fixture();
    const errors: string[] = [];
    panel.on("error", ({ source }) => errors.push(source));
    const down = { fail: () => Promise.reject(new Error("down")), peek: () => Promise.reject(new Error("down")), clear: () => Promise.reject(new Error("down")) };
    const router = routerFor(panel, { auth: { token: TOKEN }, authThrottle: { store: down } });
    expect((await call(router, "GET", "/api/schema", { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    expect((await call(router, "GET", "/api/schema", { headers: { authorization: "Bearer wrong-token-long-enough" } })).status).toBe(401);
    expect(errors).toContain("the shared sign-in throttle");
  });
});

describe("the change log's hash chain", () => {
  it("chains every record, and says where a stored log was edited, cut or reordered", async () => {
    const log = memoryChangeLog();
    const { panel } = panelAt(1_000_000, { changeLog: log });
    panel.modifiable(1, "a");
    await panel.ready;
    const scope = { groups: undefined, edit: true, actions: true, restrictions: [] };
    for (const value of [2, 3, 4, 5]) panel.edit("a", value, "ada", scope);
    await panel.flushed();
    expect(await verifyChain(log.records)).toEqual({ ok: true, checked: 4 });
    const edited = structuredClone(log.records);
    (edited[1] as { by: string }).by = "mallory";
    expect(await verifyChain(edited)).toMatchObject({ ok: false, id: 2, reason: expect.stringMatching(/edited/) });
    const cut = log.records.filter((_, index) => index !== 1);
    expect(await verifyChain(cut)).toMatchObject({ ok: false, id: 3, reason: expect.stringMatching(/deleted, inserted or reordered/) });
  });

  it("continues the chain across a restart", async () => {
    const log = memoryChangeLog();
    const scope = { groups: undefined, edit: true, actions: true, restrictions: [] };
    const first = panelAt(1_000_000, { changeLog: log }).panel;
    first.modifiable(1, "a");
    first.edit("a", 2, "ada", scope);
    await first.ready;
    await first.flushed();
    const second = panelAt(1_000_000, { changeLog: log }).panel;
    second.modifiable(2, "a");
    // Made before the stored chain has loaded: it must still join the chain, not start a new one.
    second.edit("a", 3, "sam", scope);
    await second.ready;
    await second.flushed();
    expect(await verifyChain(log.records)).toEqual({ ok: true, checked: 2 });
  });
});
