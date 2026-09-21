# HTTP API

The routes a listener answers, and their status codes.

← [Documentation](../index.md)

---

Under the listener's base path, which the router accepts with or without the prefix.

| Method and path | Answers | Notes |
| --- | --- | --- |
| `GET /` | the page | `?token=` is swapped for a cookie with a 303 |
| `GET /panel.css` | the stylesheet | for an embedded fragment |
| `GET /client.js` | the client | for an embedded fragment |
| `GET /client-extras.js` | the chart and table code | loaded only by pages that draw charts or tables |
| `GET /api/openapi.json` | this API as OpenAPI 3.1 | the same auth as everything else |
| `GET /api/settings` | `{ settings }` | every modifiable value this caller sees, by id; sensitive values left out |
| `GET /api/schema` | `{ schema }` | [`PanelSchema`](data-shapes.md#panelschema) |
| `GET /api/state?since=&after=&feed=` | `{ state }` | [`PanelState`](data-shapes.md#panelstate); `since` a version, `after` epoch ms, `feed` a feed sequence |
| `GET /api/stream?since=&after=&feed=` | server-sent events | `event: state` frames of `PanelState`, each with an `id` a reconnecting `EventSource` sends back as `Last-Event-ID` to resume from there; `event: thinned` when frames were skipped; 503 past `maxViewers`, 404 with `stream: false` |
| `GET /api/tables/:id?offset=&limit=&sort=&dir=&q=` | `{ table }` | [`TableRowsAnswer`](data-shapes.md#tables); 502 when the table's source failed |
| `GET /metrics` | Prometheus text | only with `metrics`; see [metrics](../operations/metrics.md) |
| `GET /api/changes` | `{ changes }` | the newest 200 [`ChangeRecord`](data-shapes.md#changerecord)s |
| `GET /api/notices` | `{ notices }` | [`Notice`](data-shapes.md#notice)s |
| `POST /api/values/:id` | `{ value }`, or 202 `{ pending }` | body `{ "value": …, "revertAfterMs"?: …, "at"?: … }`; `at` (epoch ms or ISO 8601) schedules it and the answer lists it in `value.scheduled`; needs `controls.edit` for the value's group |
| `POST /api/schedules/:id/cancel` | `{ value }` | body `{}`; cancels a scheduled change |
| `POST /api/settings/diff` | `{ diff, unknown }` | body `{ "settings": { … } }`; changes nothing |
| `POST /api/settings/apply` | `{ changed }` | body `{ "settings": { … } }`; one change, whole or not at all; needs `controls.edit` |
| `POST /api/actions/:id` | `{ result: { message } }` | body `{ "input"?: { … } }`; needs `controls.actions` |
| `POST /api/tables/:id/actions/:action` | `{ result: { message } }` | body `{ "row": "<id>" }`; needs `controls.actions` |
| `POST /api/profiles/:id` | `{ value }` | body `{}`; needs `controls.edit` for every value it sets |
| `POST /api/pending/:id/approve` · `/reject` | `{ value }` | body `{}`; the proposer cannot approve |
| `POST /api/changes/:id/undo` | `{ value }` or 202 `{ pending }` | body `{}`; 409 when the value has changed since |
| `GET <basePath>/auth/login` · `/auth/callback` · `/auth/logout` | redirects | only with `auth: { oidc }` |

Every JSON body is an object with one named key; every failure is `{ "error": "<sentence>", "code":
"<kind>" }`, where `code` is `invalid`, `unauthenticated`, `not-allowed`, `not-found`, `conflict`,
`rate-limited`, `too-large`, `media-type`, `wrong-host`, `method`, `failed`, `busy` or `internal`. A
value's constraint refusal also carries `key` and `params` (`{ "key": "refuseAtMost", "params": {
"label": "Limit", "max": 100 } }`), which the page uses to say it in its own language; the sentence is
always English. The document at `/api/openapi.json` describes every route, and a test checks it lists
every route the router answers.

## Status codes

| Status | When |
| --- | --- |
| 400 | malformed JSON, a body that is not an object, no `value`, a value the constraints or a `validateAsync` check refuse, a bad `since`/`after`/`at` |
| 401 | not authenticated (with `www-authenticate` for basic auth) |
| 202 | an edit to a value declared with `approval`: a proposal, not a change |
| 403 | a write from another site; a switched-off control, naming the option; a group this listener or this operator's grants may not change; a value that is not modifiable, or whose `disabledWhen` holds; approving your own proposal |
| 404 | an unknown path, value or action — including one in a group this listener withholds |
| 405 | a write to a read-only path, or a read of a write path |
| 409 | an undo of a change something has changed since |
| 413 | a body over 64 KB |
| 415 | a write that is not `application/json` |
| 421 | a `Host` this listener does not answer to |
| 429 | too many failed sign-ins from the address, or too many changes from the operator (`writeLimit`), with `retry-after` |
| 500 | the panel failed; the details go to the application's error channel, not the response |
| 502 | an action threw, rejected or passed its deadline; a table's source failed; the sign-in provider could not be reached |
| 503 | the stream already has its maximum viewers; the page polls |

## Related

- [Data shapes](data-shapes.md) · [Security](../operations/security.md)
