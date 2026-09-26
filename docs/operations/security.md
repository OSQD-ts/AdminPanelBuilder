# Security

Authentication, controls, the page's own defences, and where not to mount a panel.

← [Operations](index.md)

---

A panel shows an application's state and, when allowed, changes what the application does next. For
somebody probing your deployment that is a map and a lever. So:

## Refusals at start

Each of these throws `AdminPanelConfigError` when the listener is built:

| Configuration | Why it is refused |
| --- | --- |
| `controls.edit` or `controls.actions` without `auth`, even on loopback | Anyone who reaches it could change the application, and nobody could say afterwards who did |
| `listen()` on a non-loopback address without `auth` | The application's state would be shown to anyone who can reach that address |
| A token under 16 characters; an empty `tokens` map; a basic user with an empty password | Guessable, or looks configured and admits nobody |
| An unknown option (`contorls`, `edits`) | Ignoring it would leave the default in place without a word |
| An empty `groups` list | It would show nothing |

## Seeing and doing are separate

`groups` is what a listener shows; `controls` is what it lets a viewer do. Groups default to all, controls
to none. A withheld group is withheld on the server — absent from the schema, the state, the change
history and the write paths — not hidden on the page, so a viewer with devtools open sees exactly what the
page sees. A switched-off control answers 403 naming the option that grants it, because a panel is an
internal tool and the operator reading the refusal is usually the one who can fix it.

## Authentication

| `auth` | Sent as | The operator is |
| --- | --- | --- |
| `{ session: { secret, cookie?, revoked? } }` | a cookie your own sign-in sets to `await signSession(secret, name, { grants? })`, `HttpOnly` and `Secure` over TLS; signed with HMAC-SHA256, with an expiry and a random id | the name you signed |
| `{ oidc: { issuer, clientId, clientSecret?, baseUrl, secret, allow? } }` | sign-in with an OpenID Connect provider; see below | what `allow(claims)` returns (default: the email) |
| `{ token }` / `{ tokens: { name: token or { token, grants } } }` | `Authorization: Bearer …`, or `?token=` once in a browser, swapped for an HttpOnly, SameSite=Strict cookie | the token's name |
| `{ basic: { username, password } }` or a list | HTTP Basic; the browser asks | the username |
| `{ check(request) }` | whatever your application uses: a session cookie, a header from your proxy | the name `check` returns, or `{ name, grants }` |

Every cookie the panel sets — the token exchanged from `?token=`, the OIDC session and its flow
cookie — is `HttpOnly` and, where the browser reached the panel over TLS, `Secure`, so the browser
never sends it back over plain HTTP. The panel knows it is TLS from the socket (mounted on an HTTPS
server, or served through the Fetch adapter) or from `x-forwarded-proto` where a proxy terminates it;
a panel served over HTTP sets its cookies without `Secure`, or the browser would drop them and nobody
could sign in.

Credentials are compared in constant time. Ten failures a minute from one address earn a 429 with
`retry-after` (`authThrottle`). The address is the socket's; a forwarded header a client can write is
never read. An unauthenticated caller gets the same 401 for every path, so the API cannot be mapped.

Behind a load balancer each replica would count on its own, and an address could spread its guesses
across them. `authThrottle: { store: redisThrottleStore(redis) }` keeps one count per address in Redis
(`INCR` with an expiry). A store that stops answering lets requests through to authentication, which
still has to succeed, and reports the failure to the error channel.

## One operator's grants

A listener's `groups` and `controls` are the most anybody using it may see and do. A sign-in can narrow
that for one operator, never widen it:

```ts
auth: { tokens: { ops: process.env.OPS_TOKEN!, support: { token: process.env.SUPPORT_TOKEN!, grants: { groups: ["Mail"], edit: false } } } }
auth: { check: (request) => ({ name: user(request).email, grants: { edit: user(request).isAdmin } }) }
await signSession(secret, "ada", { grants: { actions: ["Matchmaking"] } })
```

`grants` is `{ groups?, edit?, actions? }`, each a list of group names (`edit` and `actions` may also be
`true` or `false`); absent means "whatever the listener allows". The page says when a sign-in narrowed
what it shows. Grants a check returns that cannot be read admit nobody rather than everybody.

## Ending a session early

Every signed session carries a random id. Two ways to end one before it expires:

- **Revoke it.** `auth: { session: { secret, revoked: (id) => denyList.has(id) } }` is asked on every
  request; `true` refuses the session, and a `revoked` that throws refuses it too. Signing out at
  `<basePath>/auth/logout` adds the id to a list this process keeps until the cookie would have expired
  (at most `MAX_REVOKED_SESSIONS`); replicas that must honour each other's sign-outs use `revoked`.
  `sessionInfo(secret, cookie)` reads the id.
- **Rotate the secret.** `secret` may be a list: the first signs, every one verifies. Add the new secret
  first to introduce it without signing anybody out; drop the old one to sign out everybody it signed.

## Limits on changes

Each operator may make `DEFAULT_WRITES_PER_MINUTE` changes a minute — edits, actions, approvals,
imports — before a 429 with `retry-after`. `writeLimit: { perMinute }` changes it; `false` turns it off.
It is a brake on a script gone wrong, not a defence against an attacker, who is stopped by auth.

### OpenID Connect

```ts
auth: { oidc: {
  issuer: "https://accounts.google.com", clientId, clientSecret,
  baseUrl: "https://ops.example.com/admin", secret: process.env.PANEL_SECRET!,
  allow: (claims) => (claims.email_verified && String(claims.email).endsWith("@example.com") ? String(claims.email) : false),
} }
```

A page without a session goes to the provider (authorization code with PKCE), comes back to
`<basePath>/auth/callback`, and the ID token is checked before `allow` sees it: signature (RS256 or ES256,
against the provider's published keys, refreshed once on an unknown key id), issuer, audience, expiry,
and the nonce set when this sign-in started. A callback nobody started here is refused by its `state`. An
API call without a session gets 401, never a redirect. **Restrict `allow`**: by default anyone the
provider signs in is admitted.

The provider's groups can decide what each operator may do:

```ts
groups: { claim: "groups", grants: { "ops-admins": { edit: true, actions: true }, "support": { groups: ["Mail"], edit: false } } }
```

An operator in several groups gets what any of them allows; one in none is refused at sign-in. `allow`
may return `{ name, grants }` to narrow further. `<basePath>/auth/logout` ends the session here, refuses
its cookie from then on, and, where the provider publishes an `end_session_endpoint`, signs out there
too, or the next visit would sign straight back in.

### Delegated tokens

`{ tokens: { gateway: … }, delegates: ["gateway"] }` lets the `gateway` token act for an operator named
in `x-apb-on-behalf-of`, recorded as "ada via gateway". Any other token's header is ignored. This is what a
[remote panel](../integration/remote.md) uses.

## Per-group controls

`controls: { edit: ["Matchmaking"], actions: ["Matchmaking"] }` lets a listener change and run things in
the named groups only. Every item in the schema says whether this listener may change or run it, the
page offers controls only there, and the router refuses the rest with 403. A profile needs every value it
sets to be editable here. An empty list is refused rather than read as "nothing".

## A health endpoint

`health: true` answers `GET <basePath>/healthz` without authentication, for a load balancer: `ok`, or
`ok, 2 warnings`. Nothing else is said to an anonymous caller, and it is off unless switched on.

## Before credentials

In order: the auth throttle; the `Host` header, which a loopback listener requires to be a loopback name
(the defence against DNS rebinding); and for any write, that it comes from the panel's own page — an
`Origin` or `Sec-Fetch-Site` from another site is refused. A write must also be `application/json`, which
an HTML form cannot send, so a forged form fails whatever cookies the browser attaches to it.

## The page

- A fresh nonce per response and a CSP built from `default-src 'none'`: the page may run its one script,
  apply its one stylesheet and talk to its own origin, and nothing else. `frame-ancestors 'none'`,
  `form-action 'none'`, `base-uri 'none'`.
- `cache-control: no-store`, `x-content-type-options: nosniff`, `x-frame-options: DENY`,
  `referrer-policy: no-referrer` on every response. No CORS headers, ever.
- Every value reaches the document through `textContent`. The client build refuses `innerHTML`,
  `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` and `new Function`, and a test checks the
  bundle again. The bootstrap JSON is escaped for the HTML parser, because a `</script>` inside a string
  value would otherwise end the element.
- `sensitive: true` values never leave the process, in the state or in the change history. A value
  whose id or label looks like a secret (password, token, API key…) but is not declared sensitive
  raises a notice.

## Where not to mount it

Do not mount a panel on the public server of the application it controls when that application faces the
internet and a mitigation could lock you out of it — a bot handler that challenges you is a bot handler
that challenges you on its own panel. Use a listener of its own on loopback or a private network, or a
path behind your existing administrator sign-in, as in [Who sees what](../examples.md#who-sees-what).

## Related

- [HTTP API](../reference/http-api.md) — the status of every refusal.
- [SECURITY.md](../../SECURITY.md) — reporting a vulnerability.
