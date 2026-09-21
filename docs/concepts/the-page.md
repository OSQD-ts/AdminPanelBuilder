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
`messages` replaces any of the page's words. A value's constraint refusals come from the server with a
key and parameters, so the page says "Grenze darf höchstens 10 sein" rather than the English sentence;
other refusals are named by kind in the page's language with the server's sentence after them. Labels,
descriptions and values are yours and are never translated.

To add a language, copy `ENGLISH` from `src/i18n/messages.ts`, translate every value, and add it to
`LOCALES`; the type makes a missing key an error, and a test checks every placeholder survives.

## Related

- [How it works](how-it-works.md) · [Themes](../operations/themes.md)
