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

## Drawn with the @osqd/ui components, themed by the panel

**The decision.** The page's controls are the @osqd/ui kit's components (`oq-btn`, `oq-input`, `oq-tabs`,
`oq-dialog` …), and the panel's themes fill them in: every scheme's tokens also set the kit's `--oq-*`
names, derived from the theme's own (src/themes/kit-bridge.ts). The kit is a devDependency; the rules
the page uses are copied in at build time and committed, like the client bundle.

**Why.** One look across the OSQD tools without giving up what a theme here is: a light and a dark scheme
in one object, `defineTheme` refusing a misspelt token, tokens scoped to `.apb-root`. Taking the kit's
themes instead would have changed the theme API and every custom theme with it, and put tokens on
`:root`, which an embedded panel must not touch. The panel's class names stay beside the kit's, so a
theme's `css` and the tests keep their hooks.

**The cost.** The page's stylesheet grows by the kit's rules (about 21 kB of the 101 kB), and the grid of
cards, arranging, the charts' geometry and how much a card shows at each width remain the panel's own
CSS, which the kit has no equivalent for. A kit release can change the page's look; the screenshot
baselines are where that is seen.

## An action's result belongs to whoever ran it

**The decision.** What an action answered, and the input it was given, are read by the operator who ran it
(for an approved run, the proposer and the approver) unless the action says `"runners"` or `"everyone"`.
Every operator who sees the action's group still sees that it ran, by whom, when, and whether it worked.
The server leaves the rest out of `/api/changes` per operator; the change log, its hash chain, its audit
sinks, `panel.changes()` and the `change` event keep the full record.

**Why.** A result is often the one thing an operator ran the action to get — a reset link, a one-time
code, a customer's details — and the Activity list is read by every administrator. Hiding the run itself
would cost accountability: two administrators need to see that a reset was issued, and an audit trail
with gaps is not one. So the fact is shared and the content is not. The filtering is on the server
because a list sent whole and hidden on the page is a list sent whole. The audit trail keeps everything
because it is read by whoever audits the deployment, not by the other operators on its page; and value
changes stay shared, because a value's new setting is what every operator is looking at already.

**The cost.** A behaviour change for existing panels: results everybody could read become the runner's.
`actionVisibility: "everyone"` puts it back in one line. `"runners"` asks the action's group of each
viewer, so a change in grants changes what an old record shows. A proposal still shows its input to the
operators who may approve it, because they cannot decide without it.

## A write's origin, behind a proxy

**The decision.** A browser write's `Origin` is compared with `allowedOrigins` when the listener names
some; otherwise with what a proxy in `trustedProxies` forwarded in `X-Forwarded-Host` and
`X-Forwarded-Proto`; otherwise with `Host`. The forwarded headers are read only when the connection comes
from one of those addresses, and only their rightmost entry, the one the nearest proxy wrote.

**Why.** A proxy that rewrites `Host` made every write from the real page look cross-site, and the only
way round it was to turn the check off. Believing `X-Forwarded-Host` from anybody would undo the check
instead: it is a header any client can send. The address ranges reuse bothandlerjs's `ip.ts` byte for
byte, so one parser decides what a proxy address is across the OSQD tools.

**The cost.** One more option to know about behind a proxy; the refusal names it, so the first write that
fails says what to set.

## No command line and no container

**The decision.** Unlike its siblings, this package ships neither.

**Why.** The values a panel shows are the variables of the process it runs in. A panel in a container of
its own would show nothing; a CLI would be a client for another process's API.

**The cost.** Scripting a change means an HTTP call. A small `apb get/set/run` client is on the backlog.

## Related

- [How it works](../concepts/how-it-works.md)
