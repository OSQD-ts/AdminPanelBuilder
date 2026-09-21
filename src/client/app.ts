/**
 * One mounted panel: its store, its view, and what keeps them current.
 *
 * A live stream (server-sent events) where the listener offers one, and polling where it does
 * not, where the stream fails before its first frame, or where a proxy turns it away. The stream
 * carries the same state deltas polling fetches, so the page cannot tell them apart except in how
 * quickly things arrive. The polling cost, recorded in docs/design/decisions.md, is a request per
 * viewer per interval and up to one interval of latency.
 *
 * Either way the loop backs off when the panel cannot be reached, pauses while the page is hidden,
 * and on a change of structure (a value declared, a group moved) fetches the schema again and
 * redraws rather than splicing, so the page never shows a hole it does not know about.
 */
import type { PanelSchema, PanelState } from "../types.js";
import { Api, ApiError } from "./api.js";
import type { Root } from "./dom.js";
import { type Translate, translator } from "./i18n.js";
import { extras, loadExtras, needsExtras } from "./registry.js";
import { View, type ViewDeps } from "./render.js";
import { capacities, createStore, mergeState, type Store } from "./store.js";

export interface MountOptions {
  root: Root;
  container: HTMLElement;
  /** The handler's base path. Absent: a snapshot that never polls. */
  api?: string | undefined;
  bootstrap?: { schema: PanelSchema; state: PanelState } | undefined;
  standalone: boolean;
  /** One group only, by title or id. */
  group?: string | undefined;
  /** Only the groups: no heading, status line or activity. */
  compact?: boolean | undefined;
}

export interface MountedPanel {
  destroy(): void;
}

/** Longest wait between attempts while the panel cannot be reached. */
const MAX_BACKOFF_MS = 30_000;

export function mount(options: MountOptions): MountedPanel {
  const api = options.api === undefined ? undefined : new Api(options.api);
  let store: Store | undefined;
  let view: View | undefined;
  let t: Translate = translator({ locale: "en" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let source: EventSource | undefined;
  let streamWorks = false;
  let streamRefused = false;
  let destroyed = false;
  let failures = 0;

  let deps: ViewDeps | undefined;

  /** The chart and table code, fetched from the handler before the first schema that needs it is drawn. */
  const prepare = async (schema: PanelSchema): Promise<void> => {
    if (options.api !== undefined && needsExtras(schema) && extras().buildChart === undefined) await loadExtras(options.api.replace(/\/+$/, ""));
  };

  const show = (full: PanelSchema, state: PanelState): void => {
    const container = options.container;
    const only = options.group;
    const schema = only === undefined ? full : { ...full, groups: full.groups.filter((group) => group.id === only || group.title === only) };
    if (options.compact === true) container.classList.add("apb-compact");
    container.lang = schema.locale;
    t = translator(schema);
    store = createStore(schema, state);
    deps ??= {
      root: options.root,
      container,
      standalone: options.standalone,
      snapshot: api === undefined,
      api,
      compact: options.compact === true,
      scheme: schema.theme.scheme,
      t: Object.assign((key: Parameters<Translate>[0], values?: Parameters<Translate>[1]) => t(key, values), {
        get locale() {
          return t.locale;
        },
      }),
      refresh: () => schedule(0),
      loadActivity:
        api === undefined
          ? undefined
          : async () => {
              const [changes, notices] = await Promise.all([api.changes(), api.notices()]);
              if (store !== undefined) {
                store.changes = changes;
                store.notices = notices;
              }
            },
    };
    const current = deps;
    current.scheme = schema.theme.scheme;
    view ??= new View(current, store);
    view.build(store);
    view.update();
    if (api === undefined) view.setStatus(t("snapshot", { time: new Date(state.now).toLocaleString() }), "snapshot");
  };

  /** Applies one state delta, from a poll or a stream frame. Returns false when the structure changed and a reload is needed. */
  const apply = (state: PanelState): boolean => {
    if (store === undefined) return false;
    if (state.structure !== store.schema.structure) return false;
    mergeState(store, state, false);
    view?.update();
    return true;
  };

  const reload = async (): Promise<void> => {
    if (api === undefined) return;
    const [schema, state] = await Promise.all([api.schema(), api.state()]);
    await prepare(schema);
    show(schema, state);
  };

  const schedule = (delay: number): void => {
    if (destroyed || api === undefined) return;
    if (streamWorks && delay > 0) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void poll(), delay);
  };

  const poll = async (): Promise<void> => {
    if (destroyed || api === undefined) return;
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      if (store === undefined) await reload();
      else {
        const state = await api.state(store.version, store.serverNow, store.feedSeq);
        if (!apply(state)) await reload();
      }
      failures = 0;
      if (!streamWorks) view?.setStatus(t("live"), "live");
      openStream();
      if (!streamWorks) schedule(store?.schema.pollMs ?? 1000);
    } catch (error) {
      failures += 1;
      if (error instanceof ApiError && error.status === 401) {
        view?.setStatus(t("signedOut"), "signed-out");
        return;
      }
      const wait = Math.min(MAX_BACKOFF_MS, (store?.schema.pollMs ?? 1000) * 2 ** Math.min(failures, 5));
      view?.setStatus(t("reconnecting", { seconds: Math.round(wait / 1000) }), "trouble");
      if (view === undefined) options.container.textContent = error instanceof Error ? error.message : "The panel could not be loaded.";
      schedule(wait);
    }
  };

  /** Opens the stream once the page has a store. A stream that fails before its first frame is not tried again on this page. */
  const openStream = (): void => {
    if (api === undefined || store === undefined || source !== undefined || streamRefused || store.schema.stream !== true || typeof EventSource === "undefined") return;
    const opened = new EventSource(api.streamUrl(store.version, store.serverNow, store.feedSeq), { withCredentials: true });
    source = opened;
    opened.addEventListener("state", (event) => {
      let state: PanelState;
      try {
        state = JSON.parse((event as MessageEvent<string>).data) as PanelState;
      } catch {
        return;
      }
      if (!streamWorks) {
        streamWorks = true;
        if (timer !== undefined) clearTimeout(timer);
      }
      failures = 0;
      view?.setStatus(t("streaming"), "live");
      if (!apply(state)) {
        // A new structure: close, redraw from scratch, and open again from the new position.
        close();
        void reload().then(openStream, () => schedule(0));
      }
    });
    opened.addEventListener("thinned", (event) => {
      try {
        const { skipped } = JSON.parse((event as MessageEvent<string>).data) as { skipped: number };
        view?.setStatus(t("thinned", { count: skipped }), "live");
      } catch {
        // Nothing to show.
      }
    });
    opened.addEventListener("error", () => {
      if (!streamWorks) streamRefused = true;
      close();
      schedule(0);
    });
  };

  const close = (): void => {
    source?.close();
    source = undefined;
    streamWorks = false;
  };

  const onVisibility = (): void => {
    if (document.hidden) {
      // A hidden page holds no stream open: it would cost the server a viewer slot for nobody.
      close();
      return;
    }
    schedule(0);
  };

  if (options.bootstrap !== undefined) {
    const { schema, state } = options.bootstrap;
    const start = (): void => {
      show(schema, state);
      if (store !== undefined) (store as Store).capacity = capacities(schema);
      if (api !== undefined) {
        view?.setStatus(t("live"), "live");
        openStream();
        schedule(schema.pollMs);
      }
    };
    if (extras().buildChart === undefined && needsExtras(schema) && options.api !== undefined) {
      options.container.textContent = t("loading");
      prepare(schema).then(start, (problem: unknown) => {
        options.container.textContent = problem instanceof Error ? problem.message : String(problem);
      });
    } else start();
  } else if (api !== undefined) {
    options.container.textContent = t("loading");
    schedule(0);
  }
  if (api !== undefined) document.addEventListener("visibilitychange", onVisibility);

  return {
    destroy() {
      destroyed = true;
      view?.destroy();
      if (timer !== undefined) clearTimeout(timer);
      close();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
