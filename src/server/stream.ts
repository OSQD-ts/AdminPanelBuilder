/**
 * Live updates over server-sent events.
 *
 * One stream per open page, each sending a state frame when something changed — at most
 * `framesPerSecond` times a second — and otherwise once a poll interval, so live values still move.
 * A frame is the difference since the last frame sent, computed the way `/api/state?since=` computes
 * it, so a frame skipped never loses anything: the next one carries it.
 *
 * Bounds, each visible: past `maxViewers` a page is answered 503 and polls instead; a viewer whose
 * connection is still sending the last frame is skipped, and told how many frames it missed
 * ("a thinned feed must never look like a quiet one"); a viewer stuck for `LAG_LIMIT_MS` is closed
 * and its page reconnects. A comment every `HEARTBEAT_MS` keeps proxies from closing an idle stream.
 * Every timer is unref'd.
 */
import type { AdminPanel, PanelScope } from "../core.js";
import { AdminPanelConfigError } from "../errors.js";
import type { PanelResponse, StreamOptions } from "./types.js";

const HEARTBEAT_MS = 15_000;
const LAG_LIMIT_MS = 20_000;

export class StreamHub {
  private viewers = 0;
  private readonly maxViewers: number;
  private readonly frameMs: number;

  constructor(
    private readonly panel: AdminPanel,
    options: StreamOptions,
    where: string,
  ) {
    for (const key of Object.keys(options)) if (key !== "maxViewers" && key !== "framesPerSecond") throw new AdminPanelConfigError(`${where}: stream has an option "${key}" that nothing reads`);
    this.maxViewers = options.maxViewers ?? 16;
    const perSecond = options.framesPerSecond ?? 4;
    if (!Number.isInteger(this.maxViewers) || this.maxViewers < 1) throw new AdminPanelConfigError(`${where}: stream.maxViewers must be a whole number above zero`);
    if (!Number.isFinite(perSecond) || perSecond <= 0 || perSecond > 20) throw new AdminPanelConfigError(`${where}: stream.framesPerSecond is 1 to 20`);
    this.frameMs = Math.round(1000 / perSecond);
  }

  get open(): number {
    return this.viewers;
  }

  /** @internal The router calls this for `/api/stream`. */
  openStream(scope: () => PanelScope, since: number | undefined, after: number | undefined, feed: number | undefined, pollMs: number): PanelResponse {
    if (this.viewers >= this.maxViewers) {
      return { status: 503, headers: { "content-type": "application/json; charset=utf-8", "retry-after": "30" }, body: JSON.stringify({ error: `this panel already streams to ${this.maxViewers} viewers; this page polls instead` }) };
    }
    const panel = this.panel;
    const frameMs = this.frameMs;
    return {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "x-accel-buffering": "no" },
      body: "",
      stream: {
        start: (sink) => {
          this.viewers += 1;
          let lastVersion = since;
          let lastAfter = after;
          let lastFeed = feed;
          let lastStructure: number | undefined;
          let lastSent = 0;
          let lastBeat = Date.now();
          let skipped = 0;
          let stuckSince: number | undefined;
          let stopped = false;
          const tick = (): void => {
            if (stopped) return;
            const now = Date.now();
            if (!sink.ready()) {
              stuckSince ??= now;
              skipped += 1;
              if (now - stuckSince > LAG_LIMIT_MS) stop(true);
              return;
            }
            stuckSince = undefined;
            const current = scope();
            const state = panel.state(current, lastVersion, lastAfter, lastFeed);
            const changed = state.version !== lastVersion || state.feedSeq !== lastFeed || state.structure !== lastStructure;
            if (changed || now - lastSent >= pollMs) {
              if (skipped > 0) {
                sink.send(`event: thinned\ndata: ${JSON.stringify({ skipped })}\n\n`);
                skipped = 0;
              }
              // The id lets a reconnecting EventSource resume where it was rather than from the start.
              sink.send(`id: ${state.version}.${state.now}.${state.feedSeq}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`);
              lastVersion = state.version;
              lastAfter = state.now;
              lastFeed = state.feedSeq;
              lastStructure = state.structure;
              lastSent = now;
              lastBeat = now;
            } else if (now - lastBeat >= HEARTBEAT_MS) {
              sink.send(": keep-alive\n\n");
              lastBeat = now;
            }
          };
          const timer = setInterval(tick, frameMs);
          (timer as { unref?: () => void }).unref?.();
          const stop = (closeSink: boolean): void => {
            if (stopped) return;
            stopped = true;
            clearInterval(timer);
            this.viewers -= 1;
            if (closeSink) sink.close();
          };
          sink.send(`retry: 3000\n\n`);
          tick();
          return () => stop(false);
        },
      },
    };
  }
}
