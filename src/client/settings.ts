/**
 * The viewer's own settings: one button in the header, one dialog.
 *
 * Everything here belongs to the person looking — theme, colours, language, density, what moves —
 * and is kept in their browser (`prefs.ts`), never sent to the panel. A choice applies as it is
 * made; there is nothing to save. The layout's own buttons live here too, because arranging the
 * cards is a way of looking at the panel; saving a layout for everybody is the one thing in this
 * dialog that reaches the server, and it is offered only to those who may.
 */
import type { PanelSchema } from "../types.js";
import { el, uid } from "./dom.js";
import type { Translate } from "./i18n.js";
import { dialog } from "./palette.js";
import type { Prefs } from "./prefs.js";
import type { ViewDeps } from "./view-deps.js";

export interface SettingsHost {
  readonly t: Translate;
  readonly prefs: Prefs;
  readonly deps: ViewDeps;
  schema(): PanelSchema;
  /** Puts the viewer's choices on the page: theme, colours, density, motion. */
  applyPrefs(): void;
  /** Drops this viewer's own layout, back to the panel's. */
  resetLayout?(): void;
}

export interface Settings {
  readonly button: HTMLButtonElement;
  readonly element: HTMLElement;
  open(): void;
}

export function buildSettings(host: SettingsHost): Settings {
  const { t, prefs } = host;
  const box = dialog(t("settings"), t);
  box.element.classList.add("apb-settings-dialog");
  const button = el("button", "apb-settings-button");
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  // Named by its label too, where a narrow header shows the icon alone.
  button.setAttribute("aria-label", t("settings"));
  button.append(el("span", "apb-settings-icon"), el("span", "apb-settings-word", t("settings")));
  button.addEventListener("click", () => open());

  /** Everything is rebuilt on opening, so it always shows what is in effect, whatever changed it. */
  function open(): void {
    const body = box.body;
    while (body.firstChild !== null) body.removeChild(body.firstChild);
    body.append(section(t("settingsLook"), [themeRow(), schemeRow(), languageRow(), switchRow(t("density"), t("densityHint"), () => prefs.density === "compact", (on) => (prefs.density = on ? "compact" : undefined))]));
    body.append(section(t("settingsMotion"), [switchRow(t("flashChanges"), t("flashHint"), () => prefs.flash, (on) => (prefs.flash = on)), switchRow(t("animations"), t("animationsHint"), () => prefs.motion, (on) => (prefs.motion = on)), switchRow(t("showTrends"), undefined, () => prefs.trends, (on) => (prefs.trends = on))]));
    const layout: HTMLElement[] = [];
    if (host.resetLayout !== undefined && prefs.layout !== undefined) {
      const reset = el("button", "apb-tool", t("layoutResetMine"));
      reset.type = "button";
      reset.addEventListener("click", () => {
        host.resetLayout?.();
        reset.remove();
      });
      layout.push(reset);
    }
    if (layout.length > 0) {
      const actions = el("div", "apb-settings-actions");
      actions.append(...layout);
      body.append(section(t("layout"), [actions]));
    }
    const reset = el("button", "apb-tool", t("resetSettings"));
    reset.type = "button";
    reset.addEventListener("click", () => {
      const hadLanguage = prefs.language !== undefined;
      prefs.reset();
      host.applyPrefs();
      // Another language means drawing the page again, dialog and all; otherwise the dialog redraws.
      if (hadLanguage && host.deps.setLanguage !== undefined) host.deps.setLanguage(undefined);
      else open();
    });
    const foot = el("div", "apb-settings-foot");
    foot.append(el("p", "apb-hint", t("settingsLocal")), reset);
    body.append(foot);
    box.open();
  }

  function section(title: string, rows: Array<HTMLElement | undefined>): HTMLElement {
    const part = el("section", "apb-settings-section");
    part.append(el("h3", "apb-settings-heading", title), ...rows.filter((row): row is HTMLElement => row !== undefined));
    return part;
  }

  function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
    const line = el("div", "apb-setting");
    const text = el("div", "apb-setting-text");
    const name = el("label", "apb-setting-label", label);
    name.id = uid("setting");
    if (control instanceof HTMLSelectElement) {
      control.id = uid("setting-control");
      name.htmlFor = control.id;
    } else control.setAttribute("aria-labelledby", name.id);
    text.append(name);
    if (hint !== undefined) {
      const said = el("p", "apb-setting-hint", hint);
      said.id = uid("setting-hint");
      control.setAttribute("aria-describedby", said.id);
      text.append(said);
    }
    line.append(text, control);
    return line;
  }

  function switchRow(label: string, hint: string | undefined, read: () => boolean, write: (on: boolean) => void): HTMLElement {
    const toggle = el("button", "apb-switch");
    toggle.type = "button";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(read()));
    toggle.addEventListener("click", () => {
      write(!read());
      prefs.save();
      toggle.setAttribute("aria-checked", String(read()));
      host.applyPrefs();
    });
    return row(label, toggle, hint);
  }

  function themeRow(): HTMLElement | undefined {
    const theme = host.schema().theme;
    const offered = theme.offered ?? [];
    if (offered.length < 2) return undefined;
    const select = el("select", "apb-select apb-theme-select");
    const panelLabel = offered.find((entry) => entry.name === theme.name)?.label ?? theme.name;
    const first = el("option", null, t("themePanel", { name: panelLabel }));
    first.value = "";
    select.append(first);
    for (const entry of offered) {
      const option = el("option", null, entry.label);
      option.value = entry.name;
      select.append(option);
    }
    select.value = prefs.theme !== undefined && offered.some((entry) => entry.name === prefs.theme) ? prefs.theme : "";
    select.addEventListener("change", () => {
      prefs.theme = select.value === "" ? undefined : select.value;
      prefs.save();
      host.applyPrefs();
    });
    return row(t("theme"), select);
  }

  function schemeRow(): HTMLElement {
    const select = el("select", "apb-select apb-scheme");
    const panel = host.deps.scheme;
    for (const [value, key] of [["", "scheme"], ["auto", "schemeAuto"], ["light", "schemeLight"], ["dark", "schemeDark"]] as const) {
      const option = el("option", null, value === "" ? t("schemePanel", { scheme: t(panel === "auto" ? "schemeAuto" : panel === "light" ? "schemeLight" : "schemeDark") }) : t(key));
      option.value = value;
      select.append(option);
    }
    select.value = prefs.scheme ?? "";
    select.addEventListener("change", () => {
      const value = select.value;
      prefs.scheme = value === "auto" || value === "light" || value === "dark" ? value : undefined;
      prefs.save();
      host.applyPrefs();
    });
    return row(t("scheme"), select);
  }

  /** Offered where the page can fetch another language: not on a snapshot. */
  function languageRow(): HTMLElement | undefined {
    const { setLanguage, languages, language } = host.deps;
    if (setLanguage === undefined || languages.length < 2) return undefined;
    const select = el("select", "apb-select apb-language");
    select.lang = language;
    const names = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames([language], { type: "language" }) : undefined;
    for (const code of languages) {
      const option = el("option", null, names?.of(code) ?? code);
      option.value = code;
      option.lang = code;
      select.append(option);
    }
    select.value = language;
    // The page is drawn again in the new language, and the dialog with it.
    select.addEventListener("change", () => setLanguage(select.value));
    return row(t("language"), select);
  }

  return { button, element: box.element, open };
}
