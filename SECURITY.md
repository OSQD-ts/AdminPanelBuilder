# Security

## Reporting a vulnerability

Email **platosz.michal@gmail.com** with `[admin-panel-builder]` in the subject. Please do not open a
public issue for anything exploitable. Include a reproduction if you can; you will get an
acknowledgement within a few days.

Supported versions: the latest published release of `@osqd/admin-panel-builder`.

---

## What admin-panel-builder is, in security terms

An **operator surface inside your application**: it shows the application's state and, where a listener
allows it, changes values and runs functions in the application. That makes it a lever, and it is built
as one — controls off by default, authentication required for any control even on loopback, writes
accepted only as same-origin JSON, every change attributed.

It is not an identity system. `auth.check` trusts your application's answer about who is signed in, a
bearer token is only as secret as where you keep it, and basic auth needs TLS in front of it off loopback.
It does not replace authorisation inside your application: a value an operator may change through the
panel is a value you have decided any authenticated operator of that listener may change.

## What it defends against

- A viewer who is not signed in: every path answers the same 401, and failed attempts are throttled per
  socket address.
- A page on another site driving a signed-in browser: cross-site writes and non-JSON writes are refused,
  no CORS headers are sent, and the page cannot be framed.
- DNS rebinding against a loopback listener: a `Host` header that is not a loopback name is refused.
- Values written by attackers (names, subjects, paths): they reach the page as text only, under a nonce
  CSP, in a bundle whose build refuses every HTML sink.
- A configuration that looks safe and is not: an editable listener without auth, a short token, a
  misspelt option, each refused at start.

## What it does not defend against

- A host page that embeds a fragment or `<admin-panel>`: its scripts can read and drive everything the
  panel shows. A shadow root is a styling boundary, not a security boundary.
- Your own `onChange`, `validate` and action functions doing something unsafe with a value that passed its
  declared constraints.
- A panel mounted on a public site that your own mitigations can lock you out of. See
  [docs/operations/security.md](docs/operations/security.md#where-not-to-mount-it).
