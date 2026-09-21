# Design decisions

The trade-offs the library makes, and what each one costs.

← [Documentation](../index.md)

---

Everything here is a trade rather than a free win. They are recorded together so that a future change can
weigh what it is undoing.

## A handle, not a variable

**The decision.** `viewable(10)` returns a `PanelValue`; the value is read and written through `.value`.

**Why.** A primitive is copied on assignment and a local variable cannot be observed, so there is no way
for `const x = viewable(10)` to make `x` the number 10 and still let the panel see it change. The
alternatives — a proxy over a whole module's state, a build step that rewrites assignments — are heavier
and more surprising than one property.

**The cost.** `.value` everywhere, and in TypeScript arithmetic on the handle is a type error rather than
a conversion. `bind()` exists so that code which already keeps its state in an object does not pay it.

## One router, three front ends

**The decision.** The panel never touches a request. A framework-neutral router returns a status, headers
and a body; the Node handler, the listener and the Fetch handler translate.

**Why.** The security rules are the part that must not differ between front ends. With one router they
are written and tested once, the same request gets the same answer everywhere, and a new framework is
thirty lines.

**The cost.** One more layer, and streaming responses — which the router's shape does not model — are not
available to any front end.

## A stream, with polling underneath

**The decision.** Every listener offers server-sent events carrying the same state deltas `/api/state`
returns; the page uses the stream where it works and polls where it does not.

**Why.** Polling alone costs a request per viewer per second and up to a second of latency; a stream
alone fails behind proxies that buffer, on front ends that cannot hold a response open, and past a
viewer limit. Making a frame exactly a poll's answer means the two can never disagree, and the fallback
is not a second implementation.

**The cost.** An open connection per viewer (bounded by `maxViewers`, dropped while the page is hidden),
a timer per stream, and one more thing to go wrong behind an unusual proxy — which is why a stream that
fails before its first frame is not retried on that page.

## Approvals are per value, and profiles cannot contain them

**The decision.** `approval: true` is declared on a value; a profile including such a value is refused.

**Why.** Two-person control is a property of the setting, not of who happens to be looking. A profile
applies its values in one step, so allowing an approval value in it would be a one-person path around
the rule.

**The cost.** Changing an approval value together with others takes two steps.

## Sign-in is built in, without a library

**The decision.** Sessions and OpenID Connect are implemented here, on Web Crypto, rather than through a
dependency.

**Why.** The package has no runtime dependencies, runs on edge runtimes, and the part of OIDC a panel
needs — authorization code with PKCE, one ID token verified — is small enough to read in one file and
test against a provider played by the test.

**The cost.** Only RS256 and ES256 tokens are accepted, and features beyond sign-in (refresh tokens,
back-channel logout) are not offered. A provider that needs them sits behind `auth.check` instead.

## Presets live in this package

**The decision.** The bothandlerjs and hackerpot sections are shipped here, under `/presets`, typed
structurally, rather than inside those libraries.

**Why.** Neither library should depend on a panel, and neither should be edited to gain one. A preset
that names only the events it reads works with any version that emits them.

**The cost.** A renamed event in either library breaks its preset quietly until this package's tests
catch it — which they do only for the shapes they assert.

## Controls off, and auth required for them even on loopback

**The decision.** Editing and actions are off unless a listener grants them, and granting either without
`auth` refuses to start, whatever the address.

**Why.** A loopback port is reachable by every process on the machine and, through DNS rebinding, by web
pages the operator visits. A panel that changes the application without knowing who is asking cannot say
afterwards who did.

**The cost.** A developer trying the panel locally needs a token to see the edit controls. The examples and
the demo show the one line it takes.

## 403 naming the option, not 404

**The decision.** A switched-off control answers 403 with the option that grants it.

**Why.** A panel is an internal tool, usually read by the person who can change its configuration, and
"editing is switched off; it is granted with `controls: { edit: true }`" saves them the search. The sibling
dashboards answer 404 because theirs are more often internet-reachable.

**The cost.** A caller learns that an editing endpoint exists. Anything past authentication already knows
what the panel is.

## Withheld groups are withheld on the server

**The decision.** A listener's `groups` filters the schema, the state, the change history and the write
paths; a chart against a value in a withheld group is withheld too.

**Why.** Hiding a tab on the page leaves the data in the response, where devtools shows it.

**The cost.** Every schema and state request filters by group, and a chart that mixes groups can vanish
from a listener that shows only some of them.

## Themes are tokens over one stylesheet

**The decision.** A theme is colours and shape; the layout is one stylesheet written against custom
properties.

**Why.** A theme cannot break the layout, a custom theme reaches every screen, and contrast can be measured
because every colour is a named token.

**The cost.** A theme cannot restructure a screen. `css` is the escape hatch, and it is the author's
responsibility.

## Tokens on `.apb-root`, not `:root`

**The decision.** Custom properties are set on the panel's own element (and `:host`), unlike the sibling
dashboards' `:root, :host`.

**Why.** A fragment embedded in somebody's page must not set properties on that page's root.

**The cost.** A host page cannot restyle the panel by setting `--apb-*` on `:root`; it must target
`.apb-root`.

## No command line and no container

**The decision.** Unlike its siblings, this package ships neither.

**Why.** The values a panel shows are the variables of the process it runs in. A panel in a container of
its own would show nothing; a CLI would be a client for another process's API.

**The cost.** Scripting a change means an HTTP call. A small `apb get/set/run` client is on the backlog.

## Related

- [How it works](../concepts/how-it-works.md)
