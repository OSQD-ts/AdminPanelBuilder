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
import type { ActionSchema, ChartSchema, ItemSchema, PendingChange, ProfileSchema, Sample, ScheduledChange, ValueSchema, WireValue } from "../types.js";
import { buildInputs, confirmingButton } from "./blocks.js";
import { busy, clear, el, flash, uid } from "./dom.js";
import { buildEditor } from "./editors.js";
import { type FormatSpec, formatAgo, formatDuration, formatNumber, formatValue } from "./format.js";
import { explain, said } from "./explain.js";
import { localeSpec, type Translate } from "./i18n.js";
import type { Prefs } from "./prefs.js";
import { extras } from "./registry.js";
import { describeRule, reasonField, scheduledSentence, whenField } from "./when.js";
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
  /** A card was folded away or opened again: the grids are fitted to what the cards hold now. */
  foldedCard(): void;
}

export interface Frame {
  id: string;
  element: HTMLElement;
  body: HTMLElement;
  head: HTMLElement;
  badges: HTMLElement;
  labelId: string;
}

/** The card chrome every kind shares: heading, pin and collapse, and a body the collapse hides. */
export function frame(host: CardHost, id: string, title: string | undefined, description?: string): Frame {
  const { t, prefs, deps } = host;
  const element = el("article", "apb-card");
  element.dataset.card = id;
  const head = el("div", "apb-card-head");
  const labelId = uid("label");
  const body = el("div", "apb-card-body");
  body.id = uid("body");
  if (title !== undefined) {
    const label = el("h2", "apb-label", title);
    label.id = labelId;
    // A card too narrow to show the whole name clips it; hovering still says what it is.
    label.title = title;
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
    // A card folded away is its heading and nothing else: the page takes the room back rather than
    // leaving a box the size of what is no longer shown.
    host.foldedCard();
  });
  tools.append(toggle);
  head.append(tools);
  element.append(head, body);
  if (description !== undefined) body.append(el("p", "apb-description", description));
  return { id, element, body, head, badges, labelId };
}

export function valueCard(host: CardHost, schema: ValueSchema): Card {
  const { t, deps } = host;
  const card = frame(host, `value:${schema.id}`, schema.label, schema.description);
  if (schema.live) card.badges.append(el("span", "apb-badge", t("live_badge")));
  if (schema.editable) card.badges.append(el("span", "apb-badge", schema.writable && deps.api !== undefined ? t("modifiable") : t("readOnlyHere")));
  if (schema.sensitive) card.badges.append(el("span", "apb-badge", t("hidden")));
  const spec = { ...schema, ...localeSpec(t) };
  const value = el(schema.kind === "json" ? "pre" : "div", "apb-value");
  const trend = el("p", "apb-trend");
  trend.hidden = true;
  const status = el("span", "apb-status-word");
  const meta = el("p", "apb-meta");
  const revert = el("p", "apb-hint");
  const scheduled = el("ul", "apb-scheduled");
  scheduled.hidden = true;
  const pending = el("div", "apb-pending");
  // The reading, together: a wide card lays it out in one line above its chart.
  const reading = el("div", "apb-reading");
  // Low, average and high over what is held: shown when the card has the room (data-detail="full").
  const stats = el("dl", "apb-stats");
  stats.hidden = true;
  reading.append(value, trend, status, meta, stats);
  card.body.append(reading, revert, scheduled, pending);
  const alone = schema.chart === undefined ? undefined : (host.items.get(`chart:${schema.chart}`)?.item as ChartSchema | undefined);
  // A record drawn as bars over its keys is shown by the bars and their table; the JSON above
  // them would say the same thing a third time.
  value.hidden = alone?.over === "keys" || alone?.kind === "histogram" || alone?.kind === "heatmap";
  const api = deps.api;
  // The samples a trend is read from: this value's own history, where it is charted over time.
  const history = alone?.over === "time" && schema.kind === "number" ? alone.series.find((entry) => entry.value === schema.id)?.history : undefined;
  let shownTrend = "";
  // What the value said last time, so a change can be flashed; undefined until the first drawing.
  let shownText: string | undefined;

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
      value.textContent = said(t, wire.errorKey, wire.errorParams, wire.error);
      value.classList.add("apb-value-error");
    } else if (wire.masked === true) {
      value.textContent = "••••••••";
      value.setAttribute("aria-label", t("hidden"));
    } else if (wire.text !== undefined) {
      value.textContent = said(t, wire.textKey, wire.textParams, wire.text);
      value.classList.add("apb-value-empty");
    } else {
      value.textContent = formatValue(wire.value, spec);
      // Nothing set, and nothing to draw for it: a line of no height reads as a card half built, so
      // an empty reading says it is empty the way a missing one does.
      if (value.textContent === "") value.textContent = "—";
      if (wire.value === null || wire.value === "") {
        value.classList.add("apb-value-empty");
        value.setAttribute("aria-label", t("noValue"));
      } else value.removeAttribute("aria-label");
    }
    const text = value.textContent ?? "";
    if (shownText !== undefined && text !== shownText && wire.error === undefined) flash(value);
    shownText = text;
    // A reading long enough to be words rather than a figure says so, and is set at a size meant for
    // reading: a sentence drawn as a display number is a wall, however much room the card has.
    if (text.length > 40) value.dataset.long = "sentence";
    else if (text.length > 16) value.dataset.long = "words";
    else delete value.dataset.long;
    if (wire.status !== undefined) {
      card.element.dataset.status = wire.status;
      status.textContent = t(wire.status === "bad" ? "statusBad" : wire.status === "warn" ? "statusWarn" : "statusOk");
    }
    if (wire.revertAt !== undefined) revert.textContent = t("revertsAt", { value: wire.revertTo === undefined ? "…" : formatValue(wire.revertTo, spec), time: new Date(wire.revertAt).toLocaleTimeString(t.locale) });
    if (schema.live) meta.textContent = deps.snapshot ? t("readAtSnapshot") : t("readEveryRefresh");
    else if (wire.version === 0) meta.textContent = t("unchanged");
    else meta.textContent = `${t("changedAgo", { ago: formatAgo(wire.at, now, t.locale) })}${wire.by === undefined ? "" : wire.by === "store" ? `, ${t("restored")}` : ` ${t("changedBy", { by: wire.by })}`}.`;
  };

  const editor =
    schema.writable && api !== undefined
      ? buildEditor(schema, card.labelId, {
          t,
          schedulable: true,
          submit: async (candidate, change) => {
            const answer = await api.edit(schema.id, candidate, change);
            deps.refresh();
            if (answer.pending !== undefined) return t("proposed");
            if (answer.value !== undefined) {
              host.store().values.set(answer.value.id, answer.value);
              show(answer.value, serverTime(host.store()));
              if (change.repeat !== undefined) return describeRule(change.repeat, t);
              if (change.at !== undefined) return t("scheduledNote", { time: new Date(change.at).toLocaleString(t.locale) });
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

  /** The change across the samples held: up or down, by how much, over how long. Nothing for a flat line. */
  const showTrend = (samples: readonly Sample[], now: number): void => {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const difference = first === undefined || last === undefined || samples.length < 2 ? 0 : last[1] - first[1];
    const span = first === undefined ? 0 : now - first[0];
    // Rounded so the text does not tick with every sample: seconds under a minute, minutes after.
    const rounded = span < 60_000 ? Math.round(span / 1000) * 1000 : Math.round(span / 60_000) * 60_000;
    const key = difference === 0 || !Number.isFinite(difference) ? "" : `${difference}|${rounded}`;
    if (key === shownTrend) return;
    shownTrend = key;
    trend.hidden = key === "";
    clear(trend);
    if (key === "") return;
    const up = difference > 0;
    trend.dataset.direction = up ? "up" : "down";
    const arrow = el("span", "apb-trend-arrow", up ? "▲" : "▼");
    arrow.setAttribute("aria-hidden", "true");
    trend.append(arrow, el("span", "apb-sr", `${t(up ? "trendUp" : "trendDown")} `), document.createTextNode(t("trendOver", { amount: formatNumber(Math.abs(difference), spec), span: formatDuration(rounded, t.locale) })));
  };

  let shownStats = "";
  const showStats = (samples: readonly Sample[]): void => {
    const readings = samples.map((sample) => sample[1]).filter((reading) => Number.isFinite(reading));
    const key = readings.length < 2 ? "" : `${Math.min(...readings)}|${Math.max(...readings)}|${readings.reduce((sum, reading) => sum + reading, 0) / readings.length}`;
    if (key === shownStats) return;
    shownStats = key;
    stats.hidden = key === "";
    clear(stats);
    if (key === "") return;
    const [low, high, average] = key.split("|").map(Number) as [number, number, number];
    for (const [name, reading] of [["statLow", low], ["statAverage", average], ["statHigh", high]] as const) {
      const pair = el("div");
      pair.append(el("dt", null, t(name)), el("dd", null, formatNumber(reading, spec)));
      stats.append(pair);
    }
  };

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
      if (history !== undefined) {
        const samples = store.series.get(history) ?? [];
        showTrend(samples, now);
        showStats(samples);
      }
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
        for (const entry of planned) scheduled.append(scheduledRow(host, entry, schema.label, { ...schema, ...localeSpec(t) }, schema.writable, now));
      }
      const recent = wire?.recent ?? [];
      const recentKey = `${recent.length}|${recent.at(-1)?.at ?? 0}|${Math.floor(now / 60_000)}`;
      if (recentKey !== shownRecent) {
        shownRecent = recentKey;
        timeline.hidden = recent.length === 0;
        clear(timelineList);
        for (const entry of [...recent].reverse()) {
          const item = el("li");
          const time = el("time", null, formatAgo(entry.at, now, t.locale));
          time.dateTime = new Date(entry.at).toISOString();
          item.append(el("span", "apb-timeline-value", formatValue(entry.value, spec)), document.createTextNode(" · "), time, ...(entry.by === undefined ? [] : [document.createTextNode(` · ${entry.by}`)]));
          timelineList.append(item);
        }
      }
      if (visible) chart?.draw(store);
    },
  };
}

/** One scheduled change of a value, or of a profile when `spec` is undefined: what, when, how long until, who, why, and a way to cancel it. */
export function scheduledRow(host: CardHost, entry: ScheduledChange, label: string, spec: FormatSpec | undefined, writable: boolean, now: number): HTMLElement {
  const { t, deps } = host;
  const row = el("li", "apb-note");
  row.append(el("span", null, scheduledSentence(entry, spec, now, t)));
  const api = deps.api;
  if (api !== undefined && writable) {
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
    cancel.setAttribute("aria-label", `${t("cancelScheduled")}: ${label}, ${new Date(entry.at).toLocaleString(t.locale)}`);
    row.append(cancel, result);
  }
  return row;
}

/** A proposal waiting for a second operator, with Approve and Reject where this viewer may decide it. */
export function pendingRow(host: CardHost, change: PendingChange, schema: ValueSchema | undefined, decidable = schema?.writable ?? true): HTMLElement {
  const { t, deps } = host;
  const row = el("div", "apb-note");
  const said =
    change.kind === "action"
      ? t("pendingAction", { by: change.by, label: change.label })
      : change.kind === "profile"
        ? t("pendingProfile", { by: change.by, label: change.label })
        : t("pendingApproval", { by: change.by, value: change.to === undefined ? "…" : formatValue(change.to, { ...schema, ...localeSpec(t) }) });
  row.append(el("span", null, change.reason === undefined ? said : `${said} ${t("reasonShown", { reason: change.reason })}`));
  const api = deps.api;
  if (api !== undefined && decidable) {
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

/** A button that runs only once the action's label is typed beside it: for what cannot be taken back. */
function typedButton(schema: ActionSchema, className: string, t: Translate, run: () => Promise<void>): { element: HTMLElement; button: HTMLButtonElement; reset(): void } {
  const wrap = el("div", "apb-type-confirm");
  const id = uid("type");
  const label = el("label", "apb-input-label", t("typeToConfirm", { label: schema.label }));
  label.htmlFor = id;
  const input = el("input", "apb-input");
  input.id = id;
  input.autocomplete = "off";
  input.spellcheck = false;
  const button = el("button", className, schema.label);
  button.type = "button";
  button.disabled = true;
  input.addEventListener("input", () => {
    button.disabled = input.value.trim() !== schema.label;
  });
  button.addEventListener("click", () => {
    if (input.value.trim() !== schema.label) return;
    button.disabled = true;
    void busy(button, run()).finally(() => {
      input.value = "";
    });
  });
  wrap.append(label, input, button);
  return {
    element: wrap,
    button,
    reset: () => {
      input.value = "";
      button.disabled = true;
    },
  };
}

export function actionCard(host: CardHost, schema: ActionSchema): Card {
  const { t, deps } = host;
  const card = frame(host, `action:${schema.id}`, schema.label, schema.description);
  const inputs = buildInputs(schema, t);
  if (inputs !== undefined) card.body.append(inputs.element);
  const result = el("p", "apb-result");
  result.setAttribute("aria-live", "polite");
  const api = deps.api;
  const allowed = schema.runnable && api !== undefined;
  const reason = allowed ? reasonField(schema.label, schema.reasonRequired === true, t) : undefined;
  const className = schema.destructive ? "apb-button apb-button-destructive" : "apb-button";
  const runIt = async (): Promise<void> => {
    if (api === undefined) return;
    const why = reason?.read();
    if (schema.reasonRequired === true && why === undefined) {
      result.dataset.ok = "false";
      result.textContent = t("refuseReasonRequired", { label: schema.label });
      return;
    }
    result.dataset.ok = "pending";
    result.textContent = t("running", { label: schema.label });
    try {
      const said = (await api.run(schema.id, inputs?.read(), why)) ?? t("proposedRun");
      result.dataset.ok = "true";
      result.textContent = said;
      reason?.clear();
      deps.refresh();
    } catch (problem) {
      result.dataset.ok = "false";
      result.textContent = explain(problem, t);
    }
  };
  const typed = schema.typeToConfirm === true && allowed ? typedButton(schema, className, t, runIt) : undefined;
  const button = typed?.button ?? confirmingButton(schema.label, schema.confirm, className, t, runIt);
  if (typed === undefined) button.disabled = !allowed;
  if (!allowed) card.body.append(el("p", "apb-hint", deps.snapshot ? t("snapshotNoActions") : t("actionsOff")));
  const blockedNote = el("p", "apb-hint apb-disabled-reason");
  blockedNote.hidden = true;
  const pending = el("div", "apb-pending");
  card.body.append(...(reason === undefined ? [] : [reason.element]), typed?.element ?? button, blockedNote, result, pending);
  let shown = "";
  let shownPending = "";
  return {
    id: card.id,
    element: card.element,
    update: (store) => {
      const waiting = store.pending.filter((change) => change.kind === "action" && change.target === schema.id);
      const pendingKey = waiting.map((change) => change.id).join(",");
      if (pendingKey !== shownPending) {
        shownPending = pendingKey;
        clear(pending);
        for (const change of waiting) pending.append(pendingRow(host, change, undefined, schema.runnable));
      }
      const condition = store.actionStates[schema.id];
      const key = `${condition?.hidden === true}|${condition?.disabled ?? ""}`;
      if (key === shown) return;
      shown = key;
      card.element.hidden = condition?.hidden === true;
      blockedNote.hidden = condition?.disabled === undefined;
      blockedNote.textContent = condition?.disabled === undefined ? "" : t("actionDisabled", { reason: condition.disabled });
      // A button the listener refuses stays disabled whatever the condition says; a typed one waits for its text.
      if (allowed && typed === undefined) button.disabled = condition?.disabled !== undefined;
      if (typed !== undefined && condition?.disabled !== undefined) typed.reset();
    },
  };
}

/** A profile: what it sets, whether it is in force, and applying it now, for a while, later or by a rule, with its proposals and schedule. */
export function profileCard(host: CardHost, schema: ProfileSchema): Card {
  const { t, deps } = host;
  const card = frame(host, `profile:${schema.id}`, schema.title, schema.description);
  const state = el("span", "apb-badge", t("profileActive"));
  state.hidden = true;
  const list = el("ul", "apb-profile-settings");
  const spec = localeSpec(t);
  for (const setting of schema.settings) list.append(el("li", null, setting.to === undefined ? setting.label : `${setting.label} → ${formatValue(setting.to, spec)}`));
  const result = el("p", "apb-result");
  result.setAttribute("aria-live", "polite");
  const api = deps.api;
  const allowed = schema.writable && api !== undefined;
  const reason = allowed ? reasonField(schema.title, schema.reasonRequired === true, t) : undefined;
  const later = allowed ? whenField(schema.title, t) : undefined;
  const duration = allowed ? durationChoice(schema.title, t) : undefined;
  const button = confirmingButton(t("applyProfile"), schema.confirm, "apb-button", t, async () => {
    if (api === undefined) return;
    const why = reason?.read();
    try {
      if (schema.reasonRequired === true && why === undefined) throw new Error(t("refuseReasonRequired", { label: schema.title }));
      const when = later?.read() ?? {};
      const answer = await api.applyProfile(schema.id, { ...when, reason: why, revertAfterMs: duration?.read() });
      result.dataset.ok = "true";
      result.textContent = answer.pending !== undefined ? t("proposed") : when.repeat !== undefined ? describeRule(when.repeat, t) : when.at !== undefined ? t("scheduledNote", { time: new Date(when.at).toLocaleString(t.locale) }) : "";
      reason?.clear();
      later?.clear();
      deps.refresh();
    } catch (problem) {
      result.dataset.ok = "false";
      result.textContent = explain(problem, t);
    }
  });
  button.disabled = !allowed;
  const scheduled = el("ul", "apb-scheduled");
  const pending = el("div", "apb-pending");
  card.body.append(state, list, ...(duration === undefined ? [] : [duration.element]), button, ...(reason === undefined ? [] : [reason.element]), ...(later === undefined ? [] : [later.element]), result, scheduled, pending);
  let shownScheduled = "";
  let shownPending = "";
  return {
    id: card.id,
    element: card.element,
    update: (store, now) => {
      state.hidden = !store.activeProfiles.has(schema.id);
      const planned = store.profileSchedules[schema.id] ?? [];
      const plannedKey = `${planned.map((entry) => `${entry.id}@${entry.at}`).join(",")}|${Math.floor(now / 60_000)}`;
      if (plannedKey !== shownScheduled) {
        shownScheduled = plannedKey;
        clear(scheduled);
        for (const entry of planned) scheduled.append(scheduledRow(host, entry, schema.title, undefined, schema.writable, now));
      }
      const waiting = store.pending.filter((change) => change.kind === "profile" && change.target === schema.id);
      const pendingKey = waiting.map((change) => change.id).join(",");
      if (pendingKey !== shownPending) {
        shownPending = pendingKey;
        clear(pending);
        for (const change of waiting) pending.append(pendingRow(host, change, undefined, schema.writable));
      }
    },
  };
}

/** "Until changed" or "for" a length, as the value editors offer it. */
function durationChoice(label: string, t: Translate): { element: HTMLSelectElement; read(): number | undefined } {
  const select = el("select", "apb-select apb-duration");
  select.setAttribute("aria-label", `${label}: ${t("forAWhile")}`);
  const forever = el("option", null, t("forever"));
  forever.value = "";
  select.append(forever);
  for (const ms of [300_000, 900_000, 3_600_000, 14_400_000, 86_400_000]) {
    const option = el("option", null, `${t("forAWhile")} ${formatDuration(ms, t.locale)}`);
    option.value = String(ms);
    select.append(option);
  }
  return { element: select, read: () => (select.value === "" ? undefined : Number(select.value)) };
}
