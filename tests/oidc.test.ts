/**
 * OpenID Connect sign-in against a provider played by this test: discovery, keys, a token endpoint
 * issuing ID tokens it signs with a key generated here. Each refusal the module promises is tried.
 */
import { describe, expect, it } from "vitest";
import { base64url } from "../src/server/session.js";
import { call, panelAt, routerFor } from "./helpers.js";

const ISSUER = "https://idp.example";
const SECRET = "an-oidc-cookie-secret-of-32-chars!!";

async function provider(claims: (nonce: string) => Record<string, unknown>) {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as { publicKey: CryptoKey; privateKey: CryptoKey };
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
  let nonce = "";
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url === `${ISSUER}/.well-known/openid-configuration`) return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
    if (url === `${ISSUER}/jwks`) return Response.json({ keys: [jwk] });
    if (url === `${ISSUER}/token`) {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("code") !== "good-code" || (body.get("code_verifier") ?? "").length < 40) return new Response("", { status: 400 });
      const head = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "k1" })));
      const payload = base64url(new TextEncoder().encode(JSON.stringify(claims(nonce))));
      const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${head}.${payload}`)));
      return Response.json({ id_token: `${head}.${payload}.${base64url(signature)}` });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { fetcher, setNonce: (value: string) => (nonce = value) };
}

async function signIn(claims: (nonce: string) => Record<string, unknown>, allow?: (claims: Record<string, unknown>) => string | false) {
  const { panel } = panelAt();
  panel.viewable(1, "a");
  const idp = await provider(claims);
  const router = routerFor(panel, { basePath: "/admin", auth: { oidc: { issuer: ISSUER, clientId: "panel", baseUrl: "https://ops.example/admin", secret: SECRET, fetch: idp.fetcher, ...(allow === undefined ? {} : { allow }) } } }, undefined);
  const page = await call(router, "GET", "/admin/");
  expect(page.status).toBe(302);
  expect(page.headers.location).toBe("/admin/auth/login");
  const login = await call(router, "GET", "/admin/auth/login");
  const authorize = new URL(login.headers.location as string);
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("redirect_uri")).toBe("https://ops.example/admin/auth/callback");
  idp.setNonce(authorize.searchParams.get("nonce") as string);
  const flow = (login.headers["set-cookie"] as string).split(";")[0] as string;
  const callback = await call(router, "GET", `/admin/auth/callback?code=good-code&state=${authorize.searchParams.get("state")}`, { headers: { cookie: flow } });
  return { router, callback, authorize, flow };
}

const now = () => Math.floor(Date.now() / 1000);

describe("signing in with OpenID Connect", () => {
  it("sends a page without a session to the provider, and admits whoever comes back with a valid token", async () => {
    const { router, callback } = await signIn((nonce) => ({ iss: ISSUER, aud: "panel", exp: now() + 300, iat: now(), nonce, email: "ada@example.com" }));
    expect(callback.status).toBe(303);
    const session = (callback.headers["set-cookie"] as string).split(";")[0] as string;
    const schema = await call(router, "GET", "/admin/api/schema", { headers: { cookie: session } });
    expect(schema.status).toBe(200);
  });

  it("marks its cookies Secure when the browser is on TLS, and not when it is not", async () => {
    const { panel } = panelAt();
    panel.viewable(1, "a");
    const idp = await provider((nonce) => ({ iss: ISSUER, aud: "panel", exp: now() + 300, nonce, email: "ada@example.com" }));
    const router = routerFor(panel, { basePath: "/admin", auth: { oidc: { issuer: ISSUER, clientId: "panel", baseUrl: "https://ops.example/admin", secret: SECRET, fetch: idp.fetcher } } }, undefined);
    const plain = await call(router, "GET", "/admin/auth/login");
    expect(plain.headers["set-cookie"]).not.toMatch(/Secure/);
    const behindTls = await call(router, "GET", "/admin/auth/login", { headers: { "x-forwarded-proto": "https" } });
    expect(behindTls.headers["set-cookie"]).toMatch(/; Secure$/);
    const authorize = new URL(behindTls.headers.location as string);
    idp.setNonce(authorize.searchParams.get("nonce") as string);
    const flow = (behindTls.headers["set-cookie"] as string).split(";")[0] as string;
    const callback = await call(router, "GET", `/admin/auth/callback?code=good-code&state=${authorize.searchParams.get("state")}`, { headers: { cookie: flow, "x-forwarded-proto": "https" } });
    expect(callback.headers["set-cookie"]).toMatch(/; Secure$/);
  });

  it("answers an API call without a session with 401, not a redirect", async () => {
    const { router } = await signIn((nonce) => ({ iss: ISSUER, aud: "panel", exp: now() + 300, nonce }));
    expect((await call(router, "GET", "/admin/api/state")).status).toBe(401);
  });

  it("refuses a token for another application, from another issuer, expired, or with the wrong nonce", async () => {
    for (const bad of [
      (nonce: string) => ({ iss: ISSUER, aud: "someone-else", exp: now() + 300, nonce }),
      (nonce: string) => ({ iss: "https://evil.example", aud: "panel", exp: now() + 300, nonce }),
      (nonce: string) => ({ iss: ISSUER, aud: "panel", exp: now() - 600, nonce }),
      () => ({ iss: ISSUER, aud: "panel", exp: now() + 300, nonce: "replayed" }),
    ]) {
      const { callback } = await signIn(bad);
      expect(callback.status).toBe(401);
    }
  });

  it("refuses a callback nobody started here", async () => {
    const { router, authorize } = await signIn((nonce) => ({ iss: ISSUER, aud: "panel", exp: now() + 300, nonce }));
    const forged = await call(router, "GET", `/admin/auth/callback?code=good-code&state=${authorize.searchParams.get("state")}`);
    expect(forged.status).toBe(400);
  });

  it("lets allow() turn a signed-in account away", async () => {
    const { callback } = await signIn((nonce) => ({ iss: ISSUER, aud: "panel", exp: now() + 300, nonce, email: "eve@other.example" }), (claims) => (String(claims.email).endsWith("@example.com") ? String(claims.email) : false));
    expect(callback.status).toBe(403);
  });

  it("refuses a short cookie secret at construction", () => {
    const { panel } = panelAt();
    expect(() => routerFor(panel, { auth: { oidc: { issuer: ISSUER, clientId: "p", baseUrl: "https://x", secret: "short" } } })).toThrow(/at least 32/);
  });
});
