# 6. Inside your application

Mounting on a path, your own sign-in, a second listener.

← [The course](index.md)

---

```ts
import express from "express";
import { defaultPanel, signSession } from "@osqd/admin-panel-builder";

const secret = process.env.PANEL_SECRET!;            // 32 characters or more
const app = express();

// Your existing admin sign-in, after checking the password:
app.post("/login", async (request, response) => {
  response.cookie("apb_session", await signSession(secret, request.user.name), { httpOnly: true, sameSite: "lax", path: "/" });
  response.redirect("/admin/");
});

app.use("/admin", defaultPanel().handler({ basePath: "/admin", auth: { session: { secret } }, controls: { edit: true, actions: true } }));
app.use("/support", defaultPanel().handler({ basePath: "/support", auth: { session: { secret } }, groups: ["Games"] }));
```

**Run it.** Signed in, `/admin/` is the whole panel and records changes under your name. `/support/` shows
only the Games tab and changes nothing: the Limits group is not hidden there, it is never sent.

**Things to notice.** There is no second user list: the panel trusts the name your sign-in signed. Two
listeners over one panel are how roles work here — one per capability — rather than a role table that
could disagree with yours. `controls: { edit: ["Games"] }` would let a listener change one group only.
With an identity provider, `auth: { oidc: { … } }` does the sign-in itself.

**Do not** mount the panel on the public site it controls if that site faces the internet and your own
defences could lock you out of it; see [security](../operations/security.md#where-not-to-mount-it).

Next: [changes you can answer for](07-changes-you-can-answer-for.md).
