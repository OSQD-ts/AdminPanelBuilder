/**
 * Operator changes travelling between the replicas of one application.
 *
 * Behind a load balancer every replica runs its own panel, and without this an edit changes the one
 * replica that happened to answer. With a `PanelSync`, an operator's change is published once and
 * every other replica applies it to its own value — through the same checks — and shows it in its
 * history with the replica it came from. Only operator changes travel: what the code sets is local,
 * and a counter incremented on every replica would be counted once per replica if it travelled.
 *
 * What a message is trusted with: the channel is between your own processes, so it is not
 * authenticated, but every message is parsed defensively, capped in size, and applied through the
 * value's own constraints; a malformed one is dropped and counted. Sensitive values do travel —
 * they have to, for a replaced password to be replaced everywhere — so keep the channel private.
 *
 * Besides changes, the channel carries what operators start and another replica may finish: a
 * proposal waiting for approval and its decision, and a scheduled or timed change. Each replica
 * holds all of them. When one must be acted on once — approving a proposal, firing a schedule —
 * the replica acting first `claim`s it; only the claimant goes on. A channel without `claim` is
 * still correct for one replica and for schedules, which then fire only on the replica that made
 * them, but two operators approving the same proposal at the same moment on two replicas could
 * both succeed: give replicas a `claim`.
 */
import type { ChangeRecord, JsonValue } from "../types.js";

/** A value changed by an operator on another replica. `type` is absent in messages from older versions. */
export interface ChangeMessage {
  type?: "change" | undefined;
  /** The instance that made the change. A replica ignores its own messages. */
  origin: string;
  /** The value's id. */
  target: string;
  value: JsonValue;
  record: ChangeRecord;
}

/** A proposal made, or decided (`removed`), on another replica. */
export interface PendingMessage {
  type: "pending";
  origin: string;
  removed: boolean;
  /** The proposal, candidate included, as JSON; only the id when removed. */
  entry: Record<string, JsonValue>;
}

/** A scheduled or timed change added, or cancelled (`removed`), on another replica. */
export interface ScheduleMessage {
  type: "schedule";
  origin: string;
  removed: boolean;
  id: string;
  entry: Record<string, JsonValue>;
}

/** The layout saved for everybody on another replica; `layout` null when it was reset to the one in code. */
export interface LayoutMessage {
  type: "layout";
  origin: string;
  layout: JsonValue;
  record: ChangeRecord;
}

export type SyncMessage = ChangeMessage | PendingMessage | ScheduleMessage | LayoutMessage;

/** Where messages go and come from. Either method may reject; a failed publish is a notice. */
export interface PanelSync {
  publish(message: SyncMessage): Promise<void>;
  subscribe(listener: (message: SyncMessage) => void): () => void;
  /**
   * Takes `key` for `ttlMs` if nobody holds it: true for the one replica that got it. What replicas
   * use to approve a proposal once, and to fire a schedule once.
   */
  claim?(key: string, ttlMs: number): Promise<boolean>;
}

/** Largest message accepted: one value, and far below anything that could hurt a process. */
export const MAX_SYNC_MESSAGE_BYTES = 64 * 1024;

/** A bus in one process, for tests and for several panels sharing one process. */
export function memorySync(): { connect(): PanelSync } {
  const listeners = new Set<(message: SyncMessage) => void>();
  const claims = new Map<string, number>();
  return {
    connect: () => ({
      claim: async (key, ttlMs) => {
        const now = Date.now();
        const held = claims.get(key);
        if (held !== undefined && held > now) return false;
        claims.set(key, now + ttlMs);
        return true;
      },
      publish: async (message) => {
        const copy = JSON.parse(JSON.stringify(message)) as SyncMessage;
        for (const listener of listeners) queueMicrotask(() => listener(copy));
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
  };
}

/** The publishing half of a Redis client, as ioredis and node-redis shape it. */
export interface RedisPublisherLike {
  publish(channel: string, message: string): Promise<unknown>;
}

/** A second connection in subscriber mode: Redis will not publish on a connection that subscribes. */
export interface RedisSubscriberLike {
  subscribe(channel: string): Promise<unknown> | unknown;
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
}

export interface RedisSyncOptions {
  publisher: RedisPublisherLike;
  subscriber: RedisSubscriberLike;
  /** Exactly-once decisions between replicas: `redisClaim(client)`. Without it, see the note on `claim`. */
  claim?: ((key: string, ttlMs: number) => Promise<boolean>) | undefined;
  /** Default `"apb:changes"`. Give each application its own. */
  channel?: string | undefined;
  /** Called with each message dropped as malformed. */
  onDropped?: ((reason: string) => void) | undefined;
}

export function redisSync(options: RedisSyncOptions): PanelSync {
  const channel = options.channel ?? "apb:changes";
  const listeners = new Set<(message: SyncMessage) => void>();
  let subscribed = false;
  const ensure = (): void => {
    if (subscribed) return;
    subscribed = true;
    void Promise.resolve(options.subscriber.subscribe(channel)).catch(() => {
      subscribed = false;
    });
    options.subscriber.on("message", (from, text) => {
      if (from !== channel) return;
      const message = parseMessage(text);
      if (message === undefined) {
        options.onDropped?.("a malformed or oversized message");
        return;
      }
      for (const listener of listeners) listener(message);
    });
  };
  return {
    ...(options.claim === undefined ? {} : { claim: options.claim }),
    publish: async (message) => {
      await options.publisher.publish(channel, JSON.stringify(message));
    },
    subscribe: (listener) => {
      ensure();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * `SET key 1 PX ttl NX` on a Redis client: ioredis's argument form by default, node-redis's option
 * form with `{ style: "node-redis" }`. Keys are prefixed with `apb:claim:`.
 */
export function redisClaim(client: { set(...args: unknown[]): Promise<unknown> }, options: { style?: "ioredis" | "node-redis" | undefined; prefix?: string | undefined } = {}): (key: string, ttlMs: number) => Promise<boolean> {
  const prefix = options.prefix ?? "apb:claim:";
  return async (key, ttlMs) => {
    const answer = options.style === "node-redis" ? await client.set(prefix + key, "1", { PX: ttlMs, NX: true }) : await client.set(prefix + key, "1", "PX", ttlMs, "NX");
    return answer === "OK";
  };
}

export function parseMessage(text: string): SyncMessage | undefined {
  if (typeof text !== "string" || text.length > MAX_SYNC_MESSAGE_BYTES) return undefined;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!isRecord(parsed) || typeof parsed.origin !== "string") return undefined;
    if (parsed.type === "pending") return typeof parsed.removed === "boolean" && isRecord(parsed.entry) && typeof parsed.entry.id === "string" ? (parsed as unknown as PendingMessage) : undefined;
    if (parsed.type === "layout") return isRecord(parsed.record) && typeof parsed.record.by === "string" ? (parsed as unknown as LayoutMessage) : undefined;
    if (parsed.type === "schedule") return typeof parsed.removed === "boolean" && typeof parsed.id === "string" && isRecord(parsed.entry) ? (parsed as unknown as ScheduleMessage) : undefined;
    if (parsed.type !== undefined && parsed.type !== "change") return undefined;
    const record = parsed.record as Record<string, unknown> | null;
    if (typeof parsed.target !== "string" || record === null || typeof record !== "object") return undefined;
    if (typeof record.by !== "string" || typeof record.kind !== "string" || typeof record.at !== "number") return undefined;
    return parsed as unknown as ChangeMessage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
