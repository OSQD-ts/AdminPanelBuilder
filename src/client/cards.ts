/**
 * The cards: the frame every card shares (heading, pin, collapse), a value's card, an action's
 * card, and a proposal waiting for approval.
 *
 * A value's card shows, besides the value: its status, when and by whom it last changed, a timed
 * change's revert, the changes scheduled for it (each cancellable), its recent changes when it is
 * text or a choice (a timeline, where a number gets a chart), and why it cannot be changed right
 * now when a condition says so. Every piece comes from the wire value, so a card is always what
 * the server last said and never a guess.
 */
import type { ActionSchema, ChartSchema, ItemSchema, PendingChange, ScheduledChange, ValueSchema, WireValue } from "../types.js";
import { buildInputs, confirmingButton } from "./blocks.js";
import { clear, el, uid } from "./dom.js";
import { buildEditor } from "./editors.js";
import { formatAgo, formatDuration, formatValue } from "./format.js";
import { explain } from "./explain.js";
import type { Translate } from "./i18n.js";
import type { Prefs } from "./prefs.js";
import { extras } from "./registry.js";
import { type Store, serverTime } from "./store.js";
import type { ViewDeps } from "./view-deps.js";

export interface Card {
  id: string;
  element: HTMLElement;
  /** Cheap updates every time; `visible` says the card's tab is showing, for the expensive ones. */
  update(store: Store, now: number, visible: boolean): void;
}

/** What a card needs from the view that holds it. */
export interface CardHost {
  readonly deps: ViewDeps;
  readonly t: Translate;
  readonly prefs: Prefs;
  readonly items: ReadonlyMap<string, { item: ItemSchema; group: string }>;
  readonly values: ReadonlyMap<string, ValueSchema>;
  store(): Store;
  /** The pinned set changed: rebuild the Pinned tab. */
  pinsChanged(): void;
}

export interface Frame {
  id: string;
  element: HTMLElement;
  body: HTMLElement;
  head: HTMLElement;
  badges: HTMLElement;
  labelId: string;
}

export function spanClass(span: ValueSchema["span"], fallback: 1 | 2 | 3 | "full"): string {
  const value = span ?? fallback;
  return value === 1 ? "" : `apb-span-${value}`;
}

/** The card chrome every kind shares: heading, pin and collapse, and a body the collapse hides. */
export function frame(host: CardHost, id: string, title: string | undefined, span: string, description?: string): Frame {
  const { t, prefs, deps } = host;
  const element = el("article", `apb-card ${span}`.trim());
  element.dataset.card = id;
  const head = el("div", "apb-card-head");
  const labelId = uid("label");
  const body = el("div", "apb-card-body");
  body.id = uid("body");
  if (title !== undefined) {
    const label = el("h2", "apb-label", title);
    label.id = labelId;
    head.append(label);
    element.setAttribute("aria-labelledby", labelId);
  }
  const badges = el("span", "apb-badges");
  head.append(badges);
  const tools = el("span", "apb-card-tools");
  if (!deps.snapshot) {
    const pinned = prefs.pinned.has(id);
    const pin = el("button", "apb-icon", pinned ? "★" : "☆");
    pin.type = "button";
    pin.dataset.pin = id;
    pin.setAttribute("aria-pressed", String(pinned));
    pin.setAttribute("aria-label", `${t("pin")}${title === undefined ? "" : `: ${title}`}`);
    pin.addEventListener("click", () => {
      if (prefs.pinned.has(id)) prefs.pinned.delete(id);
      else prefs.pinned.add(id);
      prefs.save();
      const now = prefs.pinned.has(id);
      for (const button of Array.from(deps.container.querySelectorAll<HTMLButtonElement>("[data-pin]"))) {
        if (button.dataset.pin !== id) continue;
        button.textContent = now ? "★" : "☆";
        button.setAttribute("aria-pressed", String(now));
      }
      host.pinsChanged();
    });
    tools.append(pin);
  }
  const collapsed = prefs.collapsed.has(id);
  const toggle = el("button", "apb-icon", collapsed ? "▸" : "▾");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-controls", body.id);
  toggle.setAttribute("aria-label", `${t("collapse")}${title === undefined ? "" : `: ${title}`}`);
  body.hidden = collapsed;
  toggle.addEventListener("click", () => {
    const hide = !body.hidden;
    body.hidden = hide;
    toggle.textContent = hide ? "▸" : "▾";
    toggle.setAttribute("aria-expanded", String(!hide));
    if (hide) prefs.collapsed.add(id);
    else prefs.collapsed.delete(id);
    prefs.save();
  });
  tools.append(toggle);
  head.append(tools);
  element.append(head, body);
  if (description !== undefined) body.append(el("p", "apb-description", description));
  return { id, element, body, head, badges, labelId };
}

export function valueCard(host: CardHost, schema: ValueSchema): Card {
  const { t, deps } = host;
  const card = frame(host, `value:${schema.id}`, schema.label, spanClass(schema.span, 1), schema.description);
  if (schema.live) card.badges.append(el("span", "apb-badge", t("live_badge")));
  if (schema.editable) card.badges.append(el("span", "apb-badge", schema.writable && deps.api !== undefined ? t("modifiable") : t("readOnlyHere")));
  if (schema.sensitive) card.badges.append(el("span", "apb-badge", t("hidden")));
  const value = el(schema.kind === "json" ? "pre" : "div", "apb-value");
  const status = el("span", "apb-status-word");
  const meta = el("p", "apb-meta");
  const revert = el("p", "apb-hint");
  const scheduled = el("ul", "apb-scheduled");
  scheduled.hidden = true;
  const pending = el("div", "apb-pending");
  card.body.append(value, status, meta, revert, scheduled, pending);
  const alone = schema.chart === undefined ? undefined : (host.items.get(`chart:${schema.chart}`)?.item as ChartSchema | undefined);
  // A record drawn as bars over its keys is shown by the bars and their table; the JSON above
  // them would say the same thing a third time.
  value.hidden = alone?.over === "keys" || alone?.kind === "histogram" || alone?.kind === "heatmap";
  const api = deps.api;

  const show = (wire: WireValue | undefined, now: number): void => {
    value.className = schema.kind === "json" ? "apb-value apb-value-json" : schema.kind === "string" ? "apb-value apb-value-text" : "apb-value";
    status.textContent = "";
    delete card.element.dataset.status;
    revert.textContent = "";
    if (wire === undefined) {
      value.textContent = "—";
      value.classList.add("apb-value-empty");
      meta.textContent = "";
      return;
    }
    card.element.hidden = wire.hidden === true;
    if (wire.error !== undefined) {
      value.textContent = wire.error;
      value.classList.add("apb-value-error");
    } else if (wire.masked === true) {
      value.textContent = "••••••••";
      value.setAttribute("aria-label", t("hidden"));
    } else if (wire.text !== undefined) {
      value.textContent = wire.text;
      value.classList.add("apb-value-empty");
    } else {
      value.textContent = formatValue(wire.value, schema);
      if (wire.value === null) {
        value.classList.add("apb-value-empty");
        value.setAttribute("aria-label", "no value");
      } else value.removeAttribute("aria-label");
    }
    if (wire.status !== undefined) {
      card.element.dataset.status = wire.status;
      status.textContent = t(wire.status === "bad" ? "statusBad" : wire.status === "warn" ? "statusWarn" : "statusOk");
    }
    if (wire.revertAt !== undefined) revert.textContent = t("revertsAt", { value: wire.revertTo === undefined ? "…" : formatValue(wire.revertTo, schema), time: new Date(wire.revertAt).toLocaleTimeString() });
    if (schema.live) meta.textContent = deps.snapshot ? t("readAtSnapshot") : t("readEveryRefresh");
    else if (wire.version === 0) meta.textContent = t("unchanged");
    else meta.textContent = `${t("changedAgo", { ago: formatAgo(wire.at, now) })}${wire.by === undefined ? "" : wire.by === "store" ? `, ${t("restored")}` : ` ${t("changedBy", { by: wire.by })}`}.`;
  };

  const editor =
    schema.writable && api !== undefined
      ? buildEditor(schema, card.labelId, {
          t,
          schedulable: true,
          submit: async (candidate, revertAfterMs, at) => {
            const answer = await api.edit(schema.id, candidate, revertAfterMs, at);
            deps.refresh();
            if (answer.pending !== undefined) return t("proposed");
            if (answer.value !== undefined) {
              host.store().values.set(answer.value.id, answer.value);
              show(answer.value, serverTime(host.store()));
              if (at !== undefined) return t("scheduledNote", { time: new Date(at).toLocaleString() });
            }
            return undefined;
          },
        })
      : undefined;
  if (editor !== undefined) card.body.append(editor.element);
  const timeline = el("details", "apb-timeline");
  timeline.hidden = true;
  const timelineList = el("ol", "apb-timeline-list");
  timeline.append(el("summary", null, t("timeline")), timelineList);
  card.body.append(timeline);
  const buildChart = extras().buildChart;
  const chart = alone === undefined || buildChart === undefined ? undefined : buildChart(alone, host.values, t);
  if (chart !== undefined) card.body.append(chart.element);

  let shownPending = "";
  let shownScheduled = "";
  let shownRecent = "";
  let shownDisabled: string | undefined;
  return {
    id: card.id,
    element: card.element,
    update: (store, now, visible) => {
      const wire = store.values.get(schema.id);
      show(wire, now);
      editor?.update(wire);
      if (editor !== undefined && wire?.disabled !== shownDisabled) {
        shownDisabled = wire?.disabled;
        editor.disable(shownDisabled);
      }
      const waiting = store.pending.filter((change) => change.target === schema.id);
      const key = waiting.map((change) => change.id).join(",");
      if (key !== shownPending) {
        shownPending = key;
        clear(pending);
        for (const change of waiting) pending.append(pendingRow(host, change, schema));
      }
      const planned = wire?.scheduled ?? [];
      const plannedKey = `${planned.map((entry) => entry.id).join(",")}|${Math.floor(now / 60_000)}`;
      if (plannedKey !== shownScheduled) {
        shownScheduled = plannedKey;
        clear(scheduled);
        scheduled.hidden = planned.length === 0;
        for (const entry of planned) scheduled.append(scheduledRow(host, entry, schema, now));
      }
      const recent = wire?.recent ?? [];
      const recentKey = `${recent.length}|${recent.at(-1)?.at ?? 0}|${Math.floor(now / 60_000)}`;
      if (recentKey !== shownRecent) {
        shownRecent = recentKey;
        timeline.hidden = recent.length === 0;
        clear(timelineList);
        for (const entry of [...recent].reverse()) {
          const item = el("li");
          const time = el("time", null, formatAgo(entry.at, now));
          time.dateTime = new Date(entry.at).toISOString();
          item.append(el("span", "apb-timeline-value", formatValue(entry.value, schema)), document.createTextNode(" · "), time, ...(entry.by === undefined ? [] : [document.createTextNode(` · ${entry.by}`)]));
          timelineList.append(item);
        }
      }
      if (visible) chart?.draw(store);
    },
  };
}

/** One scheduled change: what, when, how long until, who, and a way to cancel it. */
function scheduledRow(host: CardHost, entry: ScheduledChange, schema: ValueSchema, now: number): HTMLElement {
  const { t, deps } = host;
  const row = el("li", "apb-note");
  row.append(el("span", null, t("scheduledFor", { value: entry.to === undefined ? "…" : formatValue(entry.to, schema), time: new Date(entry.at).toLocaleString(), in: formatDuration(Math.max(0, entry.at - now)), by: entry.by })));
  const api = deps.api;
  if (api !== undefined && schema.writable) {
    const result = el("span", "apb-result");
    const cancel = confirmingButton(t("cancelScheduled"), false, "apb-tool", t, async () => {
      try {
        await api.cancelScheduled(entry.id);
        deps.refresh();
      } catch (problem) {
        result.dataset.ok = "false";
        result.textContent = explain(problem, t);
      }
    });
    cancel.setAttribute("aria-label", `${t("cancelScheduled")}: ${schema.label}, ${new Date(entry.at).toLocaleString()}`);
    row.append(cancel, result);
  }
  return row;
}

export function pendingRow(host: CardHost, change: PendingChange, schema: ValueSchema | undefined): HTMLElement {
  const { t, deps } = host;
  const row = el("div", "apb-note");
  row.append(el("span", null, t("pendingApproval", { by: change.by, value: change.to === undefined ? "…" : formatValue(change.to, schema) })));
  const api = deps.api;
  if (api !== undefined && (schema?.writable ?? true)) {
    const result = el("span", "apb-result");
    const decide = (verdict: "approve" | "reject"): HTMLButtonElement =>
      confirmingButton(t(verdict), false, verdict === "approve" ? "apb-tool" : "apb-tool apb-tool-destructive", t, async () => {
        try {
          await api.decide(change.id, verdict);
          deps.refresh();
        } catch (problem) {
          result.dataset.ok = "false";
          result.textContent = explain(problem, t);
        }
      });
    row.append(decide("approve"), decide("reject"), result);
  }
  return row;
}

export function actionCard(host: CardHost, schema: ActionSchema): Card {
  const { t, deps } = host;
  const card = frame(host, `action:${schema.id}`, schema.label, spanClass(schema.span, 1), schema.description);
  const inputs = buildInputs(schema);
  if (inputs !== undefined) card.body.append(inputs.element);
  const result = el("p", "apb-result");
  result.setAttribute("aria-live", "polite");
  const api = deps.api;
  const allowed = schema.runnable && api !== undefined;
  const button = confirmingButton(schema.label, schema.confirm, schema.destructive ? "apb-button apb-button-destructive" : "apb-button", t, async () => {
    if (api === undefined) return;
    result.dataset.ok = "true";
    result.textContent = t("running", { label: schema.label });
    try {
      result.textContent = await api.run(schema.id, inputs?.read());
      deps.refresh();
    } catch (problem) {
      result.dataset.ok = "false";
      result.textContent = explain(problem, t);
    }
  });
  button.disabled = !allowed;
  if (!allowed) card.body.append(el("p", "apb-hint", deps.snapshot ? t("snapshotNoActions") : t("actionsOff")));
  const why = el("p", "apb-hint apb-disabled-reason");
  why.hidden = true;
  card.body.append(button, why, result);
  let shown = "";
  return {
    id: card.id,
    element: card.element,
    update: (store) => {
      const condition = store.actionStates[schema.id];
      const key = `${condition?.hidden === true}|${condition?.disabled ?? ""}`;
      if (key === shown) return;
      shown = key;
      card.element.hidden = condition?.hidden === true;
      why.hidden = condition?.disabled === undefined;
      why.textContent = condition?.disabled === undefined ? "" : t("actionDisabled", { reason: condition.disabled });
      // A button the listener refuses stays disabled whatever the condition says.
      if (allowed) button.disabled = condition?.disabled !== undefined;
    },
  };
}
