# Using the page

The keyboard, a viewer's own colours, and the page's languages.

← [Documentation](../index.md)

---

## Keyboard

On a panel's own page (not an embedded one, which must not take its host page's keys):

| Keys | Does |
| --- | --- |
| `/` | Search the panel |
| `Ctrl K` (`⌘K`) | The list of every group, value and action: type to narrow, arrows to choose, Enter to go there |
| `g` then `1`–`9` | Open the nth group |
| `?` | The list of shortcuts |
| `Esc` | Close a list |

No shortcut fires while you are typing in a field. Tabs follow the ARIA tab pattern: arrows, Home, End.

A chart over time is a focusable group: arrow keys step a cursor through its samples and each step is
read out ("Players online: 412, 14:02:31"); Home and End jump to the first and last, Escape clears it.
The legend, the summary sentence and **Show as a table** say the same numbers other ways.

When a value on the open tab changes status — to Warning, to Bad, back to OK — a polite announcement says
so, at most once every five seconds, naming at most three values, so a screen reader is told without
being flooded.

## Colours

**Colours** in the header lets one viewer choose light, dark or the system's setting over the panel's
own, remembered in their browser like pinned cards.

## Languages

`createAdminPanel({ locale: "pl" })` — English (`en`), Polish (`pl`) and German (`de`) ship, and
`messages` replaces any of the page's words. `locale: "auto"` follows each viewer's browser, and
**Language** in the header lets a viewer choose for themselves, remembered like their colours. Every
word the page writes is in the chosen language — times ("vor 5 Minuten"), durations, numbers and On/Off
through `Intl` — and the page carries only English in its script: another language arrives with the
schema, or from `/api/messages/<code>` when a viewer switches. A value's constraint refusals come from the server with a
key and parameters, so the page says "Grenze darf höchstens 10 sein" rather than the English sentence;
other refusals are named by kind in the page's language with the server's sentence after them. The
panel's own notices and the frame around a reading that failed travel the same way, so they are said
in the viewer's language too. Labels, descriptions and values are yours and are never translated, and
neither is a sentence the panel did not write itself: an alert reads the same on the page, in the
change log and in a webhook.

To add a language, copy `ENGLISH` from `src/i18n/messages.ts`, translate every value, and add it to
`LOCALES`; the type makes a missing key an error, and a test checks every placeholder survives.

## Related

- [How it works](how-it-works.md) · [Themes](../operations/themes.md)
