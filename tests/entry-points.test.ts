/**
 * What each published entry exports, pinned twice. Adapted from bothandlerjs.
 *
 * `PROMISED` is what the documentation tells people to import. A name in this list is a
 * promise; removing one is a breaking change, and this is where that gets said out loud rather
 * than discovered by somebody's failing build.
 *
 * `SURFACE` is every runtime export, listed so that adding or removing any of them is a line in
 * a diff. A barrel re-exports wholesale, so names can become public without anybody having
 * decided they should — that is a reason to have noticed, not a reason to keep them for ever.
 */
import { describe, expect, it } from "vitest";
import * as adapters from "../src/adapters/index.js";
import * as cli from "../src/cli.js";
import * as sdk from "../src/sdk.js";
import * as testing from "../src/testing.js";
import * as config from "../src/config/index.js";
import * as root from "../src/index.js";
import * as presets from "../src/presets/index.js";
import * as themes from "../src/themes/index.js";

// Loaded by URL so this project, which has no DOM types, does not type-check browser code;
// tsconfig.browser.json does that.
const element = (await import(new URL("../src/element/index.ts", import.meta.url).href)) as { defineAdminPanelElement(): unknown };

const PROMISED: Record<string, readonly string[]> = {
  ".": [
    "viewable",
    "modifiable",
    "bind",
    "action",
    "group",
    "chart",
    "configure",
    "defaultPanel",
    "createAdminPanel",
    "AdminPanel",
    "PanelValue",
    "materialTheme",
    "appleTheme",
    "osqdTheme",
    "defineTheme",
    "memoryStore",
    "fileStore",
    "ManualClock",
    "AdminPanelConfigError",
    "ValueError",
    "table",
    "feed",
    "profile",
    "counter",
    "rate",
    "percentiles",
    "fluentTheme",
    "carbonTheme",
    "highContrastTheme",
    "fileChangeLog",
    "memoryChangeLog",
    "jsonLineSink",
    "webhookSink",
    "notifySink",
    "signSession",
    "themePlaygroundHtml",
  ],
  "./adapters": ["createPanelHandler", "createFetchHandler", "listenPanel", "koaPanel", "fastifyPanel", "remotePanelHandler"],
  "./themes": ["materialTheme", "appleTheme", "osqdTheme", "fluentTheme", "carbonTheme", "highContrastTheme", "defineTheme", "themeStylesheet"],
  "./presets": ["botHandlerPanel", "hackerpotPanel"],
  "./cli": ["main"],
  "./client": ["panelClient", "PanelApiError"],
  "./testing": ["testPanel", "EVERYTHING"],
  "./config": ["loadConfig", "listenOptions", "printConfig", "planReload"],
  "./element": ["defineAdminPanelElement"],
};

const SURFACE: Record<string, readonly string[]> = {
  ".": [
    "APPROVAL_TTL_MS",
    "AdminPanel",
    "AdminPanelConfigError",
    "BUILT_IN_THEMES",
    "DEFAULT_ACTION_TIMEOUT_MS",
    "DEFAULT_MAX_LENGTH",
    "DEFAULT_PORT",
    "LOCALES",
    "MAX_CHANGES",
    "MAX_ENTRY_TEXT",
    "MAX_FEED_CAPACITY",
    "MAX_HISTORY_POINTS",
    "MAX_NOTICES",
    "MAX_PAGE_SIZE",
    "MAX_PENDING",
    "MAX_REVERT_MS",
    "MAX_SEARCH_LENGTH",
    "MAX_SERIES",
    "MAX_WIRE_BYTES",
    "MIN_POLL_INTERVAL_MS",
    "MIN_SAMPLE_INTERVAL_MS",
    "MIN_SESSION_SECRET_LENGTH",
    "MIN_TOKEN_LENGTH",
    "ManualClock",
    "PanelAction",
    "PanelFeed",
    "PanelGroup",
    "PanelTable",
    "PanelValue",
    "VERSION",
    "ValueError",
    "action",
    "appleTheme",
    "bind",
    "canEdit",
    "canRun",
    "carbonTheme",
    "chart",
    "configure",
    "contrastRatio",
    "counter",
    "createAdminPanel",
    "defaultPanel",
    "defineTheme",
    "feed",
    "fileChangeLog",
    "fileStore",
    "fluentTheme",
    "group",
    "highContrastTheme",
    "jsonLineSink",
    "materialTheme",
    "memoryChangeLog",
    "memoryStore",
    "modifiable",
    "notifySink",
    "osqdTheme",
    "percentiles",
    "profile",
    "rate",
    "signSession",
    "systemClock",
    "table",
    "themePlaygroundHtml",
    "viewable",
    "webhookSink",
    "MAX_SCHEDULE_AHEAD_MS",
    "MAX_SCHEDULED",
    "MAX_SYNC_MESSAGE_BYTES",
    "clientScript",
    "DEFAULT_WRITES_PER_MINUTE",
    "MAX_REVOKED_SESSIONS",
    "MAX_WEBHOOK_RETRIES",
    "redisThrottleStore",
    "sessionInfo",
    "memorySync",
    "narrowScope",
    "redisChangeLog",
    "redisStore",
    "redisSync",
    "verifyChain",
  ],
  "./adapters": ["DEFAULT_PORT",  "MAX_BODY_BYTES",  "MAX_FLEET_PANELS",  "createFleet",  "fleetHandler",  "createFetchHandler",  "createPanelHandler",  "createRouter",  "fastifyPanel",  "koaPanel",  "listenPanel",  "remotePanelHandler",  "renderMetrics"],
  "./themes": ["BUILT_IN_THEMES",  "appleTheme",  "carbonTheme",  "contrastRatio",  "defineTheme",  "fluentTheme",  "highContrastTheme",  "materialTheme",  "osqdTheme",  "resolveTheme",  "themeStylesheet",  "tokenName"],
  "./presets": ["MAX_TRACKED", "botHandlerPanel", "hackerpotPanel"],
  "./cli": ["duration", "main"],
  "./client": ["PanelApiError", "panelClient"],
  "./testing": ["EVERYTHING", "ManualClock", "testPanel"],
  "./config": ["ConfigError", "DEFAULT_CONFIG", "MAX_CONFIG_LENGTH", "RELOADABLE", "RESTART_REQUIRED", "Section", "applyEnvironment", "envBoolean", "listenOptions", "loadConfig", "parseToml", "planReload", "printConfig", "readConfig"],
  "./element": ["ELEMENT_NAME", "defineAdminPanelElement"],
};

const ENTRIES: Record<string, object> = { ".": root, "./adapters": adapters, "./themes": themes, "./presets": presets, "./cli": cli, "./client": sdk, "./testing": testing, "./config": config, "./element": element };

describe.each(Object.keys(ENTRIES))("the %s entry", (entry) => {
  const exported = Object.keys(ENTRIES[entry] as object).sort();

  it("keeps every name the documentation promises", () => {
    expect((PROMISED[entry] ?? []).filter((name) => !exported.includes(name))).toEqual([]);
  });

  it("exports exactly the names listed, so a new one is a decision", () => {
    expect(exported).toEqual([...(SURFACE[entry] ?? [])].sort());
  });
});

describe("the element entry", () => {
  it("loads under Node and defines nothing there, so a server-rendered framework can import it", () => {
    expect(element.defineAdminPanelElement()).toBeUndefined();
  });
});
