/**
 * What a panel says to its replicas and hears from them, over a `PanelSync`: operator changes,
 * proposals and their decisions, scheduled changes and their cancellations; and the claims that let
 * exactly one replica approve a proposal or fire a schedule. See sync.ts for the protocol.
 *
 * The panel owns what these messages change; this module only moves them and decides who acts.
 */
import type { MessageKey } from "../i18n/messages.js";
import type { ChangeRecord, JsonValue } from "../types.js";
import type { PanelValue } from "../values/handle.js";
import { toJson } from "../values/kinds.js";
import type { Approvals, PendingEntry } from "./approvals.js";
import { message } from "./checks.js";
import { ChangeSchedule, type ScheduleEntry } from "./schedule.js";
import type { ChangeMessage, LayoutMessage, PanelSync, SyncMessage } from "./sync.js";

export interface ReplicationHost {
  readonly origin: string;
  readonly approvals: Approvals;
  readonly schedule: ChangeSchedule;
  /** Whether this replica has the value, action or profile a message names. */
  knows(kind: "value" | "action" | "profile", id: string): boolean;
  /** Applies a value's change made elsewhere. */
  applyChange(change: ChangeMessage): void;
  /** Takes the layout saved for everybody on another replica. */
  applyLayout(change: LayoutMessage): void;
  /** Something the page shows changed; `valueId` names a value whose card should redraw. */
  bump(valueId?: string): void;
  fire(entry: ScheduleEntry, late: boolean): void;
  notice(level: "info" | "warning", id: string, key: MessageKey, params?: Record<string, string | number>): void;
  clearNotice(id: string): void;
  onError(error: unknown, source: string): void;
}

export class Replication {
  constructor(
    private readonly sync: PanelSync | undefined,
    private readonly host: ReplicationHost,
  ) {}

  /** Sends an operator's change. A failure is a notice: the change stands here. */
  change(value: PanelValue<unknown>, candidate: unknown, record: ChangeRecord): void {
    this.send({ origin: this.host.origin, target: value.id, value: toJson(candidate), record: { ...record, origin: this.host.origin } }, "noticeSyncChange", { label: value.label });
  }

  /** A proposal was made or decided here: every replica learns of it. */
  proposal(entry: PendingEntry, removed: boolean): void {
    const { revertAfterMs, candidate, ...rest } = entry;
    const shape: Record<string, JsonValue> = removed ? { id: entry.id } : { ...(rest as unknown as Record<string, JsonValue>), candidate: toJson(candidate), ...(revertAfterMs === undefined ? {} : { revertAfterMs }) };
    this.send({ type: "pending", origin: this.host.origin, removed, entry: shape }, "noticeSyncProposal");
  }

  /** A scheduled change was added or cancelled here. */
  scheduled(entry: ScheduleEntry, removed: boolean): void {
    this.send({ type: "schedule", origin: this.host.origin, removed, id: entry.id, entry: removed ? {} : ChangeSchedule.toJson(entry) }, "noticeSyncSchedule");
  }

  /** The layout for everybody was saved or reset here. */
  layout(layout: JsonValue, record: ChangeRecord): void {
    this.send({ type: "layout", origin: this.host.origin, layout, record: { ...record, origin: this.host.origin } }, "noticeSyncLayout");
  }

  /** True for the one replica that gets `key`; true always without replicas, or on a channel that cannot claim. */
  async claimed(key: string, ttlMs: number): Promise<boolean> {
    const claim = this.sync?.claim;
    if (claim === undefined) return true;
    try {
      return await claim.call(this.sync, key, ttlMs);
    } catch (error) {
      // A claim that cannot be made is not a reason to lose the decision; it is a reason to say so.
      this.host.notice("warning", "sync-claim", "noticeSyncClaim", { what: key, reason: message(error) });
      this.host.onError(error, "claiming between replicas");
      return true;
    }
  }

  /**
   * A schedule entry's time has come on this replica. With replicas, exactly one of them fires it:
   * the one that claims it, or, on a channel that cannot claim, the one that made it.
   */
  fireOnce(entry: ScheduleEntry, late: boolean): void {
    if (this.sync === undefined) return this.host.fire(entry, late);
    if (this.sync.claim === undefined) {
      if (entry.origin === undefined || entry.origin === this.host.origin) this.host.fire(entry, late);
      return;
    }
    void this.claimed(`schedule:${entry.id}:${entry.at}`, 60_000).then((won) => {
      if (won) this.host.fire(entry, late);
    });
  }

  /** Something another replica did. */
  receive(incoming: SyncMessage): void {
    const host = this.host;
    if (incoming.origin === host.origin) return;
    if (incoming.type === "pending") {
      if (incoming.removed) host.approvals.take(incoming.entry.id as string);
      else {
        const entry = incoming.entry as unknown as PendingEntry;
        if (!host.knows(entry.kind ?? "value", entry.target) || typeof entry.expiresAt !== "number" || typeof entry.by !== "string") return;
        host.approvals.accept(entry);
      }
      host.bump();
      return;
    }
    if (incoming.type === "schedule") {
      if (incoming.removed) host.schedule.cancel(incoming.id, false);
      else {
        const entry = ChangeSchedule.fromJson(incoming.id, incoming.entry);
        if (entry !== undefined && host.knows(entry.target, entry.targetId)) host.schedule.add(entry, false);
      }
      host.bump(incoming.entry.targetId as string | undefined);
      return;
    }
    if (incoming.type === "layout") {
      host.applyLayout(incoming);
      return;
    }
    host.applyChange(incoming);
  }

  private send(outgoing: SyncMessage, failed: MessageKey, params: Record<string, string | number> = {}): void {
    if (this.sync === undefined) return;
    this.sync.publish(outgoing).then(
      () => this.host.clearNotice("sync-publish"),
      (error: unknown) => {
        this.host.notice("warning", "sync-publish", failed, { ...params, reason: message(error) });
        this.host.onError(error, "publishing to replicas");
      },
    );
  }
}
