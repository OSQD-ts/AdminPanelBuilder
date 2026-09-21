/**
 * `apb`: a panel from a script. A client of a running panel's API, not a second implementation
 * of it, so it can never disagree with what the page does. Written on the typed client
 * (`@osqd/admin-panel-builder/client`), which scripts can use directly.
 *
 *   apb get <url> [id]                  every value, or one
 *   apb set <url> <id> <json> [--for 1h] [--at 2026-10-01T09:00:00Z]
 *   apb cancel <url> <scheduled-id>
 *   apb run <url> <action> [--input name=value ...]
 *   apb changes <url>
 *   apb apply <url> <profile>
 *   apb watch <url> [id...]             print values as they change
 *   apb export <url>                    settings as JSON
 *   apb import <url> <file> [--dry-run] settings from JSON, whole or not at all
 *   apb verify-log <file>               check a change log's hash chain
 *   apb config [file]                   the listener configuration as it resolves, credentials redacted
 *   apb completion <bash|zsh|fish>
 *
 * The token comes from `--token` or `PANEL_TOKEN`. stdout is the artifact: the value, the JSON, a
 * table a script can read. stderr is the conversation. `--json` prints the API's own answer. Exit
 * codes: 0 success, 1 the panel refused or failed, 2 bad arguments or an unreachable panel.
 */
import { verifyChain } from "./change-log.js";
import { PanelApiError, panelClient } from "./sdk.js";
import type { ChangeRecord, JsonValue, WireValue } from "./types.js";
import { VERSION } from "./version.js";

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  env: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  /** Reads a file named on the command line. */
  readFile?: ((path: string) => Promise<string>) | undefined;
  /** Stops `watch`. */
  signal?: AbortSignal | undefined;
}

const COMMANDS = ["get", "set", "cancel", "run", "apply", "changes", "watch", "export", "import", "verify-log", "config", "completion"];

const USAGE = `apb ${VERSION} — read and change a running admin panel

Usage:
  apb get <url> [id]                        print every value, or one
  apb set <url> <id> <json> [--for <time>] [--at <when>]
                                            change a value; --for reverts it after 30s, 10m, 2h, 1d;
                                            --at waits until an ISO 8601 time
  apb cancel <url> <scheduled-id>           cancel a scheduled change
  apb run <url> <action> [--input k=v]...   run an action
  apb apply <url> <profile>                 apply a profile
  apb changes <url>                         the recent change history
  apb watch <url> [id]... [--interval <time>] [--count <n>]
                                            print values as they change
  apb export <url>                          every setting you may see, as JSON
  apb import <url> <file> [--dry-run]       apply exported settings, whole or not at all
  apb verify-log <file>                     check a JSON-lines change log's hash chain
  apb config [file]                         the listener configuration as it resolves from the
                                            file (or APB_CONFIG, or ./admin-panel.toml) and the
                                            environment, credentials redacted
  apb completion <bash|zsh|fish>            a shell completion script

Options:
  --token <token>   the panel's token (default: PANEL_TOKEN)
  --json            print the API's answer as JSON
  -h, --help        this text
  -v, --version     the version
`;

class UsageError extends Error {}

export async function main(argv: readonly string[], io: CliIo = defaultIo()): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.err(`apb: ${(error as Error).message}`);
    io.err("Run apb --help for usage.");
    return 2;
  }
  if (parsed.help) {
    io.out(USAGE);
    return 0;
  }
  if (parsed.version) {
    io.out(VERSION);
    return 0;
  }
  const [command, url, ...rest] = parsed.positional;
  const token = parsed.token ?? io.env.PANEL_TOKEN;
  if (command === undefined || !COMMANDS.includes(command)) {
    io.err(`apb: ${command === undefined ? "no command given" : `unknown command "${command}"`}; the commands are ${COMMANDS.join(", ")}`);
    return command === undefined ? 2 : 1;
  }
  const read = io.readFile ?? (async (path: string) => (await import("node:fs/promises")).readFile(path, "utf8"));
  if (command === "completion") return completion(io, url);
  if (command === "config") {
    const { loadConfig, printConfig } = await import("./config/index.js");
    try {
      const text = url === undefined ? undefined : await read(url);
      io.out(printConfig(await loadConfig({ text, env: io.env, ...(url === undefined ? {} : { file: url }) })));
      return 0;
    } catch (error) {
      io.err(`apb: ${(error as Error).message}`);
      return 1;
    }
  }
  if (command === "verify-log") {
    if (url === undefined) {
      io.err("apb: verify-log needs the change log file");
      return 2;
    }
    return verifyLog(io, await read(url).catch((error: unknown) => {
      io.err(`apb: ${url} could not be read: ${(error as Error).message}`);
      return undefined;
    }), parsed.json);
  }
  if (url === undefined || !/^https?:\/\//.test(url)) {
    io.err("apb: the second argument is the panel's URL, starting with http:// or https://");
    return 2;
  }
  const panel = panelClient({ url, token, fetch: io.fetch });
  try {
    switch (command) {
      case "get": {
        const [schema, state] = await Promise.all([panel.schema(), panel.state()]);
        const values = new Map(state.values.map((value) => [value.id, value]));
        const wanted = rest[0];
        if (wanted !== undefined) {
          const value = values.get(wanted);
          if (value === undefined) {
            io.err(`apb: there is no value "${wanted}" on this panel`);
            return 1;
          }
          io.out(parsed.json ? JSON.stringify(value, null, 2) : shown(value, true));
          return 0;
        }
        if (parsed.json) {
          io.out(JSON.stringify({ values: [...values.values()] }, null, 2));
          return 0;
        }
        for (const group of schema.groups) {
          for (const item of group.items) {
            if (item.type !== "value") continue;
            const value = values.get(item.id);
            io.out(`${group.title}\t${item.id}\t${value === undefined ? "" : shown(value, false)}${item.unit === undefined ? "" : ` ${item.unit}`}`);
          }
        }
        return 0;
      }
      case "set": {
        const [id, raw] = rest;
        if (id === undefined || raw === undefined) throw new UsageError("set needs an id and a value");
        const answer = await panel.set(id, bare(raw), { revertAfterMs: parsed.for, at: parsed.at });
        if ("pending" in answer) {
          io.err(`apb: proposed; ${id} changes once another operator approves it`);
          if (parsed.json) io.out(JSON.stringify(answer, null, 2));
          return 0;
        }
        if (parsed.at !== undefined) {
          const entry = answer.value.scheduled?.at(-1);
          io.err(`apb: scheduled for ${parsed.at}${entry === undefined ? "" : `; cancel with apb cancel ${url} ${entry.id}`}`);
          if (parsed.json) io.out(JSON.stringify(answer, null, 2));
          return 0;
        }
        io.out(parsed.json ? JSON.stringify(answer, null, 2) : JSON.stringify(answer.value.value));
        return 0;
      }
      case "cancel": {
        const [id] = rest;
        if (id === undefined) throw new UsageError("cancel needs the scheduled change's id");
        await panel.cancelScheduled(id);
        io.err(`apb: cancelled ${id}`);
        return 0;
      }
      case "run": {
        const [action] = rest;
        if (action === undefined) throw new UsageError("run needs an action id");
        const message = await panel.run(action, parsed.input);
        io.out(parsed.json ? JSON.stringify({ result: { message } }, null, 2) : message);
        return 0;
      }
      case "apply": {
        const [profile] = rest;
        if (profile === undefined) throw new UsageError("apply needs a profile id");
        await panel.applyProfile(profile);
        io.err(`apb: applied ${profile}`);
        return 0;
      }
      case "changes": {
        const changes = await panel.changes();
        if (parsed.json) io.out(JSON.stringify({ changes }, null, 2));
        else for (const change of changes) io.out(changeLine(change));
        return 0;
      }
      case "watch": {
        const only = new Set(rest);
        const last = new Map<string, string>();
        let updates = 0;
        const controller = new AbortController();
        io.signal?.addEventListener("abort", () => controller.abort(), { once: true });
        await panel.watch(
          (state) => {
            for (const value of state.values) {
              if (only.size > 0 && !only.has(value.id)) continue;
              const text = shown(value, true);
              if (last.get(value.id) === text) continue;
              last.set(value.id, text);
              io.out(parsed.json ? JSON.stringify(value) : `${new Date(state.now).toISOString()}\t${value.id}\t${text}`);
            }
            updates += 1;
            if (parsed.count !== undefined && updates >= parsed.count) controller.abort();
          },
          { intervalMs: parsed.interval, signal: controller.signal },
        );
        return 0;
      }
      case "export": {
        io.out(JSON.stringify({ settings: await panel.settings() }, null, 2));
        return 0;
      }
      default: {
        const [file] = rest;
        if (file === undefined) throw new UsageError("import needs the file an export was saved to");
        let settings: Record<string, unknown>;
        try {
          const parsedFile = JSON.parse(await read(file)) as { settings?: unknown };
          settings = (parsedFile.settings ?? parsedFile) as Record<string, unknown>;
          if (settings === null || typeof settings !== "object" || Array.isArray(settings)) throw new Error("it holds no settings object");
        } catch (error) {
          throw new UsageError(`${file} is not an export: ${(error as Error).message}`);
        }
        const { diff, unknown } = await panel.diffSettings(settings);
        for (const line of diff) io.err(`${line.error === undefined ? " " : "!"} ${line.id}: ${JSON.stringify(line.from)} → ${JSON.stringify(line.to)}${line.error === undefined ? "" : `  (${line.error})`}`);
        for (const id of unknown) io.err(`! ${id}: not a setting this panel lets you import`);
        if (diff.length === 0 && unknown.length === 0) io.err("apb: nothing would change");
        if (parsed.json) io.out(JSON.stringify({ diff, unknown }, null, 2));
        if (parsed.dryRun) return unknown.length > 0 || diff.some((line) => line.error !== undefined) ? 1 : 0;
        const changed = await panel.importSettings(settings);
        io.err(`apb: imported ${changed} setting${changed === 1 ? "" : "s"}`);
        return 0;
      }
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`apb: ${error.message}`);
      return 2;
    }
    if (error instanceof PanelApiError) {
      io.err(`apb: ${error.message} (${error.status})`);
      return 1;
    }
    io.err(`apb: the panel could not be reached: ${(error as Error).message}`);
    return 2;
  }
}

/** A value as one line of text. */
function shown(value: WireValue, bareStrings: boolean): string {
  if (value.masked === true) return "(hidden)";
  if (value.error !== undefined) return `(${value.error})`;
  if (value.text !== undefined) return value.text;
  return bareStrings && typeof value.value === "string" ? value.value : JSON.stringify(value.value);
}

function changeLine(change: ChangeRecord): string {
  return `${change.id}\t${new Date(change.at).toISOString()}\t${change.by}\t${change.kind}\t${change.label}\t${change.outcome ?? JSON.stringify(change.to ?? null)}`;
}

/** JSON when it parses, the text itself otherwise: `apb set … motd Hello` rather than `'"Hello"'`. */
function bare(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

async function verifyLog(io: CliIo, text: string | undefined, json: boolean): Promise<number> {
  if (text === undefined) return 2;
  const records: ChangeRecord[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line) as ChangeRecord);
    } catch {
      // A torn last line is a crash mid-write; anywhere else it is damage.
      if (index < lines.length - 1 && lines.slice(index + 1).some((rest) => rest.trim() !== "")) {
        io.err(`apb: line ${index + 1} is not JSON, so the log was damaged there`);
        return 1;
      }
    }
  }
  const result = await verifyChain(records);
  if (json) io.out(JSON.stringify(result));
  if (result.ok) {
    io.err(`apb: the chain holds over ${result.checked} record${result.checked === 1 ? "" : "s"}${result.checked < records.length ? ` (${records.length - result.checked} older records carry no hash)` : ""}`);
    return 0;
  }
  io.err(`apb: record ${result.id} (line ${result.at + 1}) breaks the chain: ${result.reason}`);
  return 1;
}

function completion(io: CliIo, shell: string | undefined): number {
  const words = COMMANDS.join(" ");
  const flags = "--token --json --for --at --input --interval --count --dry-run --help --version";
  switch (shell) {
    case "bash":
      io.out(`_apb() {\n  local current=\${COMP_WORDS[COMP_CWORD]}\n  if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=($(compgen -W "${words}" -- "$current"));\n  else COMPREPLY=($(compgen -W "${flags}" -- "$current")); fi\n}\ncomplete -o default -F _apb apb`);
      return 0;
    case "zsh":
      io.out(`#compdef apb\n_arguments '1:command:(${words})' '*:: :->rest'\ncase $state in rest) _arguments '*:option:(${flags})' '*:file:_files';; esac`);
      return 0;
    case "fish":
      io.out(`complete -c apb -f -n "__fish_use_subcommand" -a "${words}"\n${flags.split(" ").map((flag) => `complete -c apb -l ${flag.slice(2)}`).join("\n")}`);
      return 0;
    default:
      io.err("apb: completion takes bash, zsh or fish");
      return 2;
  }
}

/** Long flags only, `--name value` or `--name=value`; unknown flags and bad values are errors, never guesses. */
function parse(argv: readonly string[]) {
  const out = {
    positional: [] as string[],
    token: undefined as string | undefined,
    json: false,
    help: false,
    version: false,
    dryRun: false,
    for: undefined as number | undefined,
    at: undefined as string | undefined,
    interval: undefined as number | undefined,
    count: undefined as number | undefined,
    input: undefined as Record<string, unknown> | undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i] as string;
    if (!argument.startsWith("-")) {
      out.positional.push(argument);
      continue;
    }
    const [flag, inline] = argument.includes("=") ? (argument.split(/=(.*)/s) as [string, string]) : [argument, undefined];
    const value = (): string => {
      const next = inline ?? argv[++i];
      if (next === undefined) throw new UsageError(`${flag} needs a value`);
      return next;
    };
    switch (flag) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "-v":
      case "--version":
        out.version = true;
        break;
      case "--json":
        out.json = true;
        break;
      case "--token":
        out.token = value();
        break;
      case "--for":
        out.for = duration(value());
        break;
      case "--interval":
        out.interval = duration(value(), "--interval");
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--count": {
        const raw = value();
        if (!/^[1-9]\d{0,6}$/.test(raw)) throw new UsageError(`--count takes a whole number above zero (got ${JSON.stringify(raw)})`);
        out.count = Number(raw);
        break;
      }
      case "--at": {
        const raw = value();
        if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(Date.parse(raw))) throw new UsageError(`--at takes an ISO 8601 time like 2026-10-01T09:00:00Z (got ${JSON.stringify(raw)})`);
        out.at = raw;
        break;
      }
      case "--input": {
        const pair = value();
        const eq = pair.indexOf("=");
        if (eq <= 0) throw new UsageError(`--input takes name=value (got ${JSON.stringify(pair)})`);
        const raw = pair.slice(eq + 1);
        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(raw);
        } catch {
          parsedValue = raw;
        }
        out.input = { ...out.input, [pair.slice(0, eq)]: parsedValue };
        break;
      }
      default:
        throw new UsageError(`unknown option ${flag}`);
    }
  }
  return out;
}

/** `30s`, `10m`, `2h`, `1d`. Anything else is refused rather than read as zero. */
export function duration(text: string, flag = "--for"): number {
  const match = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(text.trim());
  if (match === null) throw new UsageError(`${flag} takes a time like 30s, 10m, 2h or 1d (got ${JSON.stringify(text)})`);
  return Math.round(Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"]);
}

function defaultIo(): CliIo {
  return { out: (line) => process.stdout.write(`${line}\n`), err: (line) => process.stderr.write(`${line}\n`), env: process.env, fetch };
}
