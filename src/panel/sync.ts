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
 */
import type { ChangeRecord, JsonValue } from "../types.js";

export interface SyncMessage {
  /** The instance that made the change. A replica ignores its own messages. */
  origin: string;
  /** The value's id. */
  target: string;
  value: JsonValue;
  record: ChangeRecord;
}

/** Where messages go and come from. Either method may reject; a failed publish is a notice. */
export interface PanelSync {
  publish(message: SyncMessage): Promise<void>;
  subscribe(listener: (message: SyncMessage) => void): () => void;
}

/** Largest message accepted: one value, and far below anything that could hurt a process. */
export const MAX_SYNC_MESSAGE_BYTES = 64 * 1024;

/** A bus in one process, for tests and for several panels sharing one process. */
export function memorySync(): { connect(): PanelSync } {
  const listeners = new Set<(message: SyncMessage) => void>();
  return {
    connect: () => ({
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

export function parseMessage(text: string): SyncMessage | undefined {
  if (typeof text !== "string" || text.length > MAX_SYNC_MESSAGE_BYTES) return undefined;
  try {
    const parsed = JSON.parse(text) as Partial<SyncMessage>;
    if (typeof parsed.origin !== "string" || typeof parsed.target !== "string" || parsed.record === null || typeof parsed.record !== "object") return undefined;
    if (typeof parsed.record.by !== "string" || typeof parsed.record.kind !== "string" || typeof parsed.record.at !== "number") return undefined;
    return parsed as SyncMessage;
  } catch {
    return undefined;
  }
}
