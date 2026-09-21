/**
 * `@osqd/admin-panel-builder`: declare values next to the variables they are, serve them as a
 * panel.
 *
 *   import { viewable, modifiable, defaultPanel } from "@osqd/admin-panel-builder";
 *   const players = viewable(0, { label: "Players online", chart: true });
 *   const maxPlayers = modifiable(100, { label: "Max players", min: 2, max: 1000 });
 *   await defaultPanel().listen({ auth: { token: process.env.PANEL_TOKEN! }, controls: { edit: true } });
 */

// The panel and the declaration functions.
export { AdminPanel, APPROVAL_TTL_MS, canEdit, canRun, createAdminPanel, MAX_CHANGES, MAX_NOTICES, MAX_PENDING, MAX_REVERT_MS, MAX_SCHEDULE_AHEAD_MS, MAX_SCHEDULED, MAX_SERIES, MIN_POLL_INTERVAL_MS, narrowScope, PanelGroup } from "./core.js";
export type { ActionOutcome, AdminPanelEvents, AdminPanelOptions, EditOutcome, Grants, PanelScope } from "./core.js";
export { memorySync, redisSync, MAX_SYNC_MESSAGE_BYTES } from "./panel/sync.js";
export type { PanelSync, RedisPublisherLike, RedisSubscriberLike, RedisSyncOptions, SyncMessage } from "./panel/sync.js";
export { action, bind, chart, configure, counter, defaultPanel, feed, group, modifiable, percentiles, profile, rate, table, viewable } from "./default-panel.js";
export { PanelFeed, MAX_FEED_CAPACITY, MAX_ENTRY_TEXT } from "./blocks/feed.js";
export { PanelTable, MAX_PAGE_SIZE, MAX_SEARCH_LENGTH } from "./blocks/table.js";
export type { Counter, CounterOptions, PercentileOptions, Percentiles, RateOptions } from "./blocks/counter.js";
export { fileChangeLog, memoryChangeLog, verifyChain } from "./change-log.js";
export type { ChangeLogStore } from "./change-log.js";
export { jsonLineSink, MAX_WEBHOOK_RETRIES, notifySink, webhookSink } from "./audit.js";
export type { AuditSink, NotifierLike, WebhookSinkOptions } from "./audit.js";
export { MAX_REVOKED_SESSIONS, MIN_SESSION_SECRET_LENGTH, sessionInfo, signSession } from "./server/session.js";
export type { SessionInfo, SessionSecret, SignSessionOptions } from "./server/session.js";
export { redisThrottleStore } from "./server/auth.js";
export type { RedisThrottleLike, ThrottleStore } from "./server/auth.js";
export { DEFAULT_WRITES_PER_MINUTE } from "./server/router.js";
export type { OidcOptions } from "./server/oidc.js";
export { LOCALES } from "./i18n/messages.js";
export type { MessageKey } from "./i18n/messages.js";
export { PanelValue } from "./values/handle.js";
export { PanelAction, DEFAULT_ACTION_TIMEOUT_MS } from "./actions.js";
export { AdminPanelConfigError, ValueError } from "./errors.js";

// The caps are public so a configuration past one can be refused by the caller's own checks
// rather than discovered as a construction error in production.
export { MAX_HISTORY_POINTS, MIN_SAMPLE_INTERVAL_MS } from "./values/history.js";
export { DEFAULT_MAX_LENGTH, MAX_WIRE_BYTES } from "./values/kinds.js";
export { MIN_TOKEN_LENGTH } from "./server/auth.js";
export { DEFAULT_PORT } from "./adapters/listen.js";

// Themes.
export { appleTheme, BUILT_IN_THEMES, carbonTheme, contrastRatio, defineTheme, fluentTheme, highContrastTheme, materialTheme, osqdTheme } from "./themes/index.js";
export type { Theme, ThemeColors, ThemeDefinition, ThemeShape } from "./themes/index.js";

// Stores for `persist: true`.
export { fileStore, memoryStore, redisChangeLog, redisStore } from "./stores/index.js";
export type { RedisLike, ValueStore } from "./stores/index.js";

// The clock is public so an application can test its own panel the way this library tests
// itself: a chart's history, a timed sample, without sleeping.
export { ManualClock, systemClock } from "./internal/clock.js";
export type { Clock } from "./internal/clock.js";

export { VERSION } from "./version.js";
export { themePlaygroundHtml } from "./render/playground.js";

export type { HtmlOptions } from "./render/html.js";
export { clientScript } from "./render/html.js";
export type { PanelServer } from "./adapters/listen.js";
export type { FetchServeOptions, PanelFetchHandler } from "./adapters/fetch.js";
export type { NodeLikeRequest, NodeLikeResponse, PanelRequestHandler } from "./adapters/node.js";
export type { AuthRequest, ListenOptions, PanelAuth, PanelControls, ServeOptions, StreamOptions } from "./server/types.js";
export type {
  ActionContext,
  ActionOptions,
  ActionSchema,
  Alert,
  AlertOptions,
  ChartLine,
  FeedEntry,
  FeedOptions,
  FeedSchema,
  InputField,
  InputSchema,
  PendingChange,
  ProfileOptions,
  ProfileSchema,
  Span,
  Status,
  StatusRule,
  TableColumn,
  TableOptions,
  TablePage,
  TableQuery,
  TableRowAction,
  TableRowsAnswer,
  TableSchema,
  BindOptions,
  ChangeContext,
  ChangeRecord,
  ChartAxis,
  ChartKind,
  ChartOptions,
  ChartSchema,
  ChartSeriesSchema,
  GroupOptions,
  GroupSchema,
  ItemSchema,
  JsonValue,
  ModifiableOptions,
  Notice,
  PanelSchema,
  PanelState,
  Sample,
  ScheduledChange,
  SettingDiff,
  SharedChartOptions,
  ValueConstraints,
  ValueFormat,
  ValueKind,
  ValueSchema,
  ViewableOptions,
  WireValue,
} from "./types.js";
