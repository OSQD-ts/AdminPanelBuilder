/**
 * A listener's settings from a file and the environment:
 *
 *   import { loadConfig, listenOptions } from "@osqd/admin-panel-builder/config";
 *   const config = await loadConfig();                       // APB_CONFIG, or ./admin-panel.toml if present
 *   await panel.listen(listenOptions(config));
 *
 * Precedence is built-in defaults < file < environment: an image bakes in a file and a
 * deployment adjusts the last mile with `-e`. The environment is read as deployment facts, flat
 * and unprefixed — `PORT`, `HOST`, `BASE_PATH`, `PANEL_TOKEN` — and only the locator, `APB_CONFIG`,
 * carries a prefix. Every override goes through the same checks as the file, and the cross-field
 * checks run again after it, because the environment can change their answer.
 *
 * The result is fully populated: print it (`printConfig`) and it says exactly what the process
 * will do, with credentials shown only as set or not set. The shipped `admin-panel.toml` is every
 * default written out; a test holds it to that.
 *
 * What can change without a restart is planned as data first (`planReload`): each setting either
 * applies, needs a restart (with the reason), or is unchanged, and the caller logs the refusals
 * before applying anything.
 */
import type { ListenOptions } from "../server/types.js";
import { Section } from "./section.js";
import { ConfigError, parseToml } from "./toml.js";

export { ConfigError, MAX_CONFIG_LENGTH, parseToml } from "./toml.js";
export type { TomlTable, TomlValue } from "./toml.js";
export { Section } from "./section.js";

export interface ListenerConfig {
  listen: { port: number; host: string; basePath: string; allowedHosts: string[] };
  auth: { mode: "none" | "token"; token: string };
  controls: { edit: boolean | string[]; actions: boolean | string[] };
  view: { groups: string[] };
  stream: { enabled: boolean; maxViewers: number; framesPerSecond: number };
  metrics: { enabled: boolean; prefix: string };
  health: { enabled: boolean };
  throttle: { enabled: boolean; failures: number; windowMs: number };
  writeLimit: { enabled: boolean; perMinute: number };
}

/** Every built-in default. `admin-panel.toml` writes each of these out. */
export const DEFAULT_CONFIG: Readonly<ListenerConfig> = Object.freeze({
  listen: { port: 9780, host: "127.0.0.1", basePath: "/", allowedHosts: [] },
  auth: { mode: "none", token: "" },
  controls: { edit: false, actions: false },
  view: { groups: [] },
  stream: { enabled: true, maxViewers: 16, framesPerSecond: 4 },
  metrics: { enabled: false, prefix: "admin_panel" },
  health: { enabled: false },
  throttle: { enabled: true, failures: 10, windowMs: 60_000 },
  writeLimit: { enabled: true, perMinute: 60 },
} satisfies ListenerConfig);

/**
 * Reads a parsed file into a full configuration. With `final: false` the checks that combine
 * settings wait for `applyEnvironment`, where the token usually arrives.
 */
export function readConfig(table: ReturnType<typeof parseToml>, options: { final?: boolean } = {}): ListenerConfig {
  const root = Section.root(table);
  const d = DEFAULT_CONFIG;
  const listen = root.section("listen");
  const config: ListenerConfig = {
    listen: { port: listen.port("port", d.listen.port), host: listen.string("host", d.listen.host), basePath: listen.string("base_path", d.listen.basePath), allowedHosts: listen.stringArray("allowed_hosts", d.listen.allowedHosts) },
    auth: { mode: "none", token: "" },
    controls: { edit: false, actions: false },
    view: { groups: [] },
    stream: { ...d.stream },
    metrics: { ...d.metrics },
    health: { ...d.health },
    throttle: { ...d.throttle },
    writeLimit: { ...d.writeLimit },
  };
  listen.done();
  const auth = root.section("auth");
  config.auth = { mode: auth.enum("mode", ["none", "token"] as const, d.auth.mode), token: auth.string("token", d.auth.token) };
  auth.done();
  const controls = root.section("controls");
  config.controls = { edit: controls.grant("edit", d.controls.edit), actions: controls.grant("actions", d.controls.actions) };
  controls.done();
  const view = root.section("view");
  config.view = { groups: view.stringArray("groups", d.view.groups) };
  view.done();
  const stream = root.section("stream");
  config.stream = { enabled: stream.boolean("enabled", d.stream.enabled), maxViewers: stream.integer("max_viewers", d.stream.maxViewers, { min: 1, max: 10_000 }), framesPerSecond: stream.number("frames_per_second", d.stream.framesPerSecond, { min: 0.1, max: 20 }) };
  stream.done();
  const metrics = root.section("metrics");
  config.metrics = { enabled: metrics.boolean("enabled", d.metrics.enabled), prefix: metrics.string("prefix", d.metrics.prefix) };
  metrics.done();
  const health = root.section("health");
  config.health = { enabled: health.boolean("enabled", d.health.enabled) };
  health.done();
  const throttle = root.section("throttle");
  config.throttle = { enabled: throttle.boolean("enabled", d.throttle.enabled), failures: throttle.integer("failures", d.throttle.failures, { min: 1 }), windowMs: throttle.integer("window_ms", d.throttle.windowMs, { min: 1000 }) };
  throttle.done();
  const writes = root.section("write_limit");
  config.writeLimit = { enabled: writes.boolean("enabled", d.writeLimit.enabled), perMinute: writes.integer("per_minute", d.writeLimit.perMinute, { min: 1 }) };
  writes.done();
  root.done();
  if (options.final !== false) check(config);
  return config;
}

/** The environment's last word. Values are trimmed; empty means unset. */
export function applyEnvironment(config: ListenerConfig, env: Readonly<Record<string, string | undefined>>): ListenerConfig {
  const read = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === undefined || value === "" ? undefined : value;
  };
  const next: ListenerConfig = structuredClone(config);
  const port = read("PORT");
  if (port !== undefined) {
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) throw new ConfigError(`PORT is "${port}"; it is 0 to 65535`);
    next.listen.port = Number(port);
  }
  const host = read("HOST");
  if (host !== undefined) next.listen.host = host;
  const base = read("BASE_PATH");
  if (base !== undefined) next.listen.basePath = base;
  const token = read("PANEL_TOKEN");
  if (token !== undefined) {
    next.auth.token = token;
    next.auth.mode = "token";
  }
  // Re-run: the environment can make a valid file invalid (a public HOST with no token).
  check(next);
  return next;
}

/** Truthy spellings accepted from the environment, for settings a deployment turns on and off. */
export function envBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (/^(1|true|yes|on)$/i.test(value.trim())) return true;
  if (/^(0|false|no|off)$/i.test(value.trim())) return false;
  throw new ConfigError(`"${value}" is not a yes or a no; use true or false`);
}

function check(config: ListenerConfig): void {
  if (!config.listen.basePath.startsWith("/")) throw new ConfigError(`listen.base_path is "${config.listen.basePath}"; it starts with "/"`);
  if (config.auth.mode === "token" && config.auth.token.length < 16) {
    throw new ConfigError(config.auth.token === "" ? "auth.mode is \"token\" but no token is set; put it in PANEL_TOKEN rather than the file" : "the panel token is shorter than 16 characters, which can be guessed");
  }
  const controls = config.controls.edit !== false || config.controls.actions !== false;
  if (controls && config.auth.mode === "none") throw new ConfigError("controls grant editing or actions, which needs auth even on loopback: set PANEL_TOKEN");
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(config.listen.host);
  if (!loopback && config.auth.mode === "none") throw new ConfigError(`listen.host is ${config.listen.host}, reachable beyond this machine, without auth: set PANEL_TOKEN or listen on 127.0.0.1`);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(config.metrics.prefix)) throw new ConfigError(`metrics.prefix "${config.metrics.prefix}" is not a Prometheus name`);
}

/**
 * Loads the configuration: `text` if given, else the file at `file`, `APB_CONFIG`, or
 * `./admin-panel.toml` when it exists (and nothing when it does not), then the environment.
 */
export async function loadConfig(options: { text?: string | undefined; file?: string | undefined; env?: Readonly<Record<string, string | undefined>> | undefined } = {}): Promise<ListenerConfig> {
  const env = options.env ?? (typeof process === "undefined" ? {} : process.env);
  let text = options.text;
  let source = "the configuration";
  if (text === undefined) {
    const named = options.file ?? env.APB_CONFIG?.trim();
    const path = named === undefined || named === "" ? "admin-panel.toml" : named;
    const { readFile } = await import("node:fs/promises");
    try {
      text = await readFile(path, "utf8");
      source = path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || named !== undefined) throw new ConfigError(`${path} could not be read: ${(error as Error).message}`);
      text = "";
    }
  }
  return applyEnvironment(readConfig(parseToml(text, source), { final: false }), env);
}

/** The configuration as `panel.listen()` takes it. */
export function listenOptions(config: ListenerConfig): ListenOptions {
  const options: ListenOptions = {
    port: config.listen.port,
    host: config.listen.host,
    basePath: config.listen.basePath,
    controls: { edit: config.controls.edit, actions: config.controls.actions },
    stream: config.stream.enabled ? { maxViewers: config.stream.maxViewers, framesPerSecond: config.stream.framesPerSecond } : false,
    metrics: config.metrics.enabled ? { prefix: config.metrics.prefix } : false,
    health: config.health.enabled,
    authThrottle: config.throttle.enabled ? { failures: config.throttle.failures, windowMs: config.throttle.windowMs } : false,
    writeLimit: config.writeLimit.enabled ? { perMinute: config.writeLimit.perMinute } : false,
  };
  if (config.auth.mode === "token") options.auth = { token: config.auth.token };
  if (config.listen.allowedHosts.length > 0) options.allowedHosts = config.listen.allowedHosts;
  if (config.view.groups.length > 0) options.groups = config.view.groups;
  return options;
}

const SECRET = /token|secret|password|key/i;

/**
 * The configuration as text, credentials redacted by key name so one added later is covered too,
 * and shown as set or not set, so "configured" stays distinguishable from "missing".
 */
export function printConfig(config: ListenerConfig): string {
  const redact = (value: unknown, key: string): unknown => {
    if (SECRET.test(key) && typeof value === "string") return value === "" ? "(not set)" : "(set)";
    if (value !== null && typeof value === "object" && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, redact(inner, name)]));
    return value;
  };
  return JSON.stringify(redact(config, ""), null, 2);
}

/** Settings a running listener cannot take without a restart, and why. */
export const RESTART_REQUIRED: Readonly<Record<string, string>> = Object.freeze({
  "listen.port": "the socket is bound to the old port",
  "listen.host": "the socket is bound to the old address",
  "listen.base_path": "pages already open use the old path for every request",
  "stream.enabled": "open streams would be cut without notice",
  "stream.max_viewers": "the stream hub is sized when the listener starts",
  "stream.frames_per_second": "open streams keep the pace they started with",
});

/** Settings a new handler applies to the next request. */
export const RELOADABLE: readonly string[] = Object.freeze([
  "listen.allowed_hosts",
  "auth.mode",
  "auth.token",
  "controls.edit",
  "controls.actions",
  "view.groups",
  "metrics.enabled",
  "metrics.prefix",
  "health.enabled",
  "throttle.enabled",
  "throttle.failures",
  "throttle.window_ms",
  "write_limit.enabled",
  "write_limit.per_minute",
]);

export interface ReloadPlan {
  /** Who asked: a person, "SIGHUP", "dashboard". */
  by: string;
  applied: string[];
  requiresRestart: Array<{ key: string; reason: string }>;
  unchanged: string[];
}

/** What reloading from `current` to `next` would do, setting by setting, before anything is applied. */
export function planReload(current: ListenerConfig, next: ListenerConfig, by: string): ReloadPlan {
  const plan: ReloadPlan = { by, applied: [], requiresRestart: [], unchanged: [] };
  const flat = (config: ListenerConfig): Map<string, string> => {
    const out = new Map<string, string>();
    const names: Record<string, string> = { basePath: "base_path", allowedHosts: "allowed_hosts", maxViewers: "max_viewers", framesPerSecond: "frames_per_second", windowMs: "window_ms", perMinute: "per_minute", writeLimit: "write_limit" };
    for (const [section, values] of Object.entries(config)) {
      for (const [key, value] of Object.entries(values as Record<string, unknown>)) out.set(`${names[section] ?? section}.${names[key] ?? key}`, stable(value));
    }
    return out;
  };
  const before = flat(current);
  for (const [key, value] of flat(next)) {
    if (before.get(key) === value) plan.unchanged.push(key);
    else if (RESTART_REQUIRED[key] !== undefined) plan.requiresRestart.push({ key, reason: RESTART_REQUIRED[key] as string });
    else plan.applied.push(key);
  }
  return plan;
}

/**
 * Reloads a running listener from new configuration: plans it, logs each setting that needs a
 * restart first, one line each, then applies the rest. Returns the configuration now in force.
 *
 *   process.on("SIGHUP", async () => { config = await reloadListener(server, config, await loadConfig(), "SIGHUP"); });
 */
export function reloadListener(server: { reload(options: ListenOptions, meta: { by: string }): { refused?: string | undefined } }, current: ListenerConfig, next: ListenerConfig, by: string, log: (line: string) => void = (line) => console.warn(line)): ListenerConfig {
  const plan = planReload(current, next, by);
  for (const { key, reason } of plan.requiresRestart) log(`admin panel: ${key} was not reloaded (${reason}); restart to apply it`);
  if (plan.applied.length === 0) return current;
  // What needs a restart stays as it runs now; everything else takes the new value.
  const kept: ListenerConfig = structuredClone(next);
  kept.listen.port = current.listen.port;
  kept.listen.host = current.listen.host;
  kept.listen.basePath = current.listen.basePath;
  kept.stream = { ...current.stream };
  const result = server.reload(listenOptions(kept), { by });
  if (result.refused !== undefined) {
    log(`admin panel: the reload by ${by} was refused, and the old settings stay: ${result.refused}`);
    return current;
  }
  return kept;
}

/** A comparison that sees a pattern's source and flags rather than `{}`. */
function stable(value: unknown): string {
  if (value instanceof RegExp) return `/${value.source}/${value.flags}`;
  return JSON.stringify(value, (_key, inner: unknown) => (inner instanceof RegExp ? `/${inner.source}/${inner.flags}` : inner));
}
