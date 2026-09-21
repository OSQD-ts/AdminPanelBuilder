# The command line

`apb`: read and change a running panel from a script.

← [Serving overview](index.md)

---

```bash
export PANEL_TOKEN=…
apb get http://127.0.0.1:9780                    # every value: group, id, value
apb get http://127.0.0.1:9780 max-rating-gap     # one value, bare, for a script
apb set http://127.0.0.1:9780 maintenance-mode true --for 30m
apb run http://127.0.0.1:9780 ban-player --input player=sam --input days=7
apb apply http://127.0.0.1:9780 tournament-mode
apb changes http://127.0.0.1:9780 --json
apb set http://127.0.0.1:9780 motd "Back at ten" --at 2026-10-01T22:00:00Z   # scheduled; prints how to cancel
apb cancel http://127.0.0.1:9780 s1a2b3
apb watch http://127.0.0.1:9780 queue-length --interval 5s   # a line whenever it changes
apb export http://127.0.0.1:9780 > settings.json
apb import http://staging:9780 settings.json --dry-run      # what would change; exit 1 if any would be refused
apb import http://staging:9780 settings.json
apb verify-log data/panel-changes.jsonl                      # the change log's hash chain
apb config admin-panel.toml                                  # the listener config as it resolves, token redacted
source <(apb completion bash)
```

- **A client of the panel's API**, not a second implementation of it: it is refused exactly what the
  page would be refused, with the same sentence.
- **stdout is the artifact, stderr the conversation.** `apb get … id > value.txt` writes the value and
  nothing else; notes and refusals go to stderr.
- **`--json` is the API's own answer**, pretty-printed.
- **A value that is not JSON is text**: `apb set … motd Back soon` sets the string. `--for` takes `30s`,
  `10m`, `2h` or `1d`, and anything else is refused rather than read as zero.
- **Exit codes**: 0 success; 1 the panel refused or failed, or an unknown command; 2 bad arguments or an
  unreachable panel. The token comes from `--token` or `PANEL_TOKEN`.

`watch` polls from where the last answer left off and prints a value only when it changed; `--count
<n>` stops after n updates. `import` always shows the difference first, on stderr, and applies it as
one change, whole or not at all. `completion` prints a script for bash, zsh or fish.

The commands are written on the typed client, `@osqd/admin-panel-builder/client`, which a script can
use directly:

```ts
import { panelClient } from "@osqd/admin-panel-builder/client";
const panel = panelClient({ url: "https://ops.example/admin", token: process.env.PANEL_TOKEN });
await panel.set("maintenance-mode", true, { revertAfterMs: 20 * 60_000 });
```

A deploy script can set maintenance mode for the length of a migration with `apb set … --for 20m`, and
the panel reverts it even if the script dies halfway.

## Related

- [HTTP API](../reference/http-api.md)
