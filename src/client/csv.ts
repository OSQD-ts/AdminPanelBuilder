/** CSV for the chart and table exports: DOM-free, so it is unit-tested. */

/**
 * A CSV file of what the chart holds. Cells are quoted, and a cell starting with `=`, `+`, `-` or `@`
 * that is not a number is prefixed with an apostrophe: a key written by somebody else must not
 * become a formula in the spreadsheet it is opened in.
 */
export function toCsv(rows: readonly string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const safe = /^[=+\-@\t\r]/.test(cell) && Number.isNaN(Number(cell)) ? `'${cell}` : cell;
          return `"${safe.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
