/**
 * Redis behind the value store and the change log, for replicas that should remember the same
 * choices and keep one history.
 *
 * The client is the one the application already has, typed structurally: ioredis and node-redis v4
 * both fit. Every call has a deadline — a Redis that stops answering must cost the memory of a
 * change, never hold an operator's request — and every method may reject, which the panel turns
 * into a notice.
 */
import type { ChangeLogStore } from "../change-log.js";
import { withDeadline } from "../internal/async.js";
import type { ChangeRecord, JsonValue } from "../types.js";
import type { ValueStore } from "./types.js";

/** The Redis commands these stores use. */
export interface RedisLike {
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  rpush(key: string, value: string): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

export interface RedisStoreOptions {
  /** Default `"apb:values"`. */
  key?: string | undefined;
  /** Default 2 seconds. */
  timeoutMs?: number | undefined;
}

export function redisStore(redis: RedisLike, options: RedisStoreOptions = {}): ValueStore {
  const key = options.key ?? "apb:values";
  const timeout = options.timeoutMs ?? 2000;
  return {
    async load() {
      const raw = await withDeadline(redis.hgetall(key), timeout, "Redis");
      const out: Record<string, JsonValue> = {};
      for (const [id, text] of Object.entries(raw ?? {})) {
        try {
          out[id] = JSON.parse(text) as JsonValue;
        } catch {
          // A damaged field is not a reason to lose the others.
        }
      }
      return out;
    },
    async save(id, value) {
      await withDeadline(redis.hset(key, id, JSON.stringify(value)), timeout, "Redis");
    },
  };
}

export interface RedisChangeLogOptions {
  /** Default `"apb:changes"`. */
  key?: string | undefined;
  /** Records kept; older ones are trimmed. Default 10,000. */
  keep?: number | undefined;
  timeoutMs?: number | undefined;
}

export function redisChangeLog(redis: RedisLike, options: RedisChangeLogOptions = {}): ChangeLogStore {
  const key = options.key ?? "apb:changes";
  const keep = options.keep ?? 10_000;
  const timeout = options.timeoutMs ?? 2000;
  return {
    async load(limit) {
      const lines = await withDeadline(redis.lrange(key, -limit, -1), timeout, "Redis");
      const out: ChangeRecord[] = [];
      for (const line of lines ?? []) {
        try {
          out.push(JSON.parse(line) as ChangeRecord);
        } catch {
          // Skipped, like a torn line in a file.
        }
      }
      return out;
    },
    async append(record) {
      await withDeadline(redis.rpush(key, JSON.stringify(record)), timeout, "Redis");
      await withDeadline(redis.ltrim(key, -keep, -1), timeout, "Redis");
    },
  };
}
