/**
 * WCAG contrast between two `#rrggbb` colours: what the theme tests assert and the theme playground
 * shows, from one function so they cannot disagree. Undefined for anything that is not six hex
 * digits, because a guess about `rgba()` over an unknown background would be a number that lies.
 */
export function contrastRatio(foreground: string, background: string): number | undefined {
  const a = luminance(foreground);
  const b = luminance(background);
  if (a === undefined || b === undefined) return undefined;
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

function luminance(colour: string): number | undefined {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (hex === null) return undefined;
  const value = Number.parseInt(hex[1] as string, 16);
  const channel = (shift: number): number => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}
