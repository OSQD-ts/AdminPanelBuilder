/**
 * A QR code encoder, written from ISO/IEC 18004: byte mode, versions 1 to `MAX_QR_VERSION`, all
 * four error correction levels, and the mask the standard's penalty rules choose. The page carries
 * no dependency, so it carries its own; and since a code that scans wrong is worse than none, the
 * matrices are checked module by module against an independent encoder's (tests/qr.test.ts).
 *
 * Pure: `media.ts` draws a matrix with createElementNS (never markup strings).
 */
import { MAX_QR_VERSION } from "../values/display.js";

export type QrLevel = "L" | "M" | "Q" | "H";

/** A square of modules, `true` dark; `size` is 17 + 4 × version. */
export interface QrMatrix {
  version: number;
  level: QrLevel;
  mask: number;
  size: number;
  modules: boolean[][];
}

// Per version (index 0 is version 1), from the standard's table 9: error correction codewords in
// each block, and the number of blocks.
const EC_PER_BLOCK: Record<QrLevel, number[]> = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};
const BLOCKS: Record<QrLevel, number[]> = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};
/** The two bits each level writes into the format information. */
const LEVEL_BITS: Record<QrLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** Modules left for data and error correction once every function pattern is drawn. */
function rawModules(version: number): number {
  let count = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    count -= (25 * align - 10) * align - 55;
    if (version >= 7) count -= 36;
  }
  return count;
}

function dataCodewords(version: number, level: QrLevel): number {
  const i = version - 1;
  return Math.floor(rawModules(version) / 8) - (EC_PER_BLOCK[level][i] ?? 0) * (BLOCKS[level][i] ?? 0);
}

/** How many bytes a code of this version and level holds in byte mode. */
export function qrCapacity(version: number, level: QrLevel): number {
  const countBits = version < 10 ? 8 : 16;
  return Math.floor((dataCodewords(version, level) * 8 - 4 - countBits) / 8);
}

// GF(256) with the standard's polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] as number;
}
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : (EXP[(LOG[a] as number) + (LOG[b] as number)] as number));

/** The generator polynomial of degree `n`, highest coefficient (always 1) dropped. */
function generator(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] as number) ^ (poly[j] as number);
      next[j + 1] = (next[j + 1] as number) ^ mul(poly[j] as number, EXP[i] as number);
    }
    poly = next;
  }
  return poly.slice(1);
}

/** The error correction codewords of one block: the remainder of data × x^n divided by the generator. */
function remainder(data: readonly number[], n: number): number[] {
  const gen = generator(n);
  const rem = new Array<number>(n).fill(0);
  for (const byte of data) {
    const factor = byte ^ (rem.shift() as number);
    rem.push(0);
    for (let i = 0; i < n; i++) rem[i] = (rem[i] as number) ^ mul(gen[i] as number, factor);
  }
  return rem;
}

/** The smallest version that holds `bytes` at `level`, or undefined past `MAX_QR_VERSION`. */
export function qrVersionFor(bytes: number, level: QrLevel): number | undefined {
  for (let version = 1; version <= MAX_QR_VERSION; version++) if (qrCapacity(version, level) >= bytes) return version;
  return undefined;
}

/** The codewords of `bytes` at a version and level: data, padded, split into blocks, error corrected and interleaved. */
function codewords(bytes: Uint8Array, version: number, level: QrLevel): number[] {
  const bits: number[] = [];
  const put = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4); // byte mode
  put(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) put(byte, 8);
  const capacityBits = dataCodewords(version, level) * 8;
  put(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  for (let pad = 0xec; data.length < capacityBits / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  const i = version - 1;
  const blockCount = BLOCKS[level][i] as number;
  const ecLength = EC_PER_BLOCK[level][i] as number;
  const total = Math.floor(rawModules(version) / 8);
  const shortBlocks = blockCount - (total % blockCount);
  const shortLength = Math.floor(total / blockCount) - ecLength;
  const blocks: Array<{ data: number[]; ec: number[] }> = [];
  let at = 0;
  for (let b = 0; b < blockCount; b++) {
    const length = shortLength + (b < shortBlocks ? 0 : 1);
    const part = data.slice(at, at + length);
    at += length;
    blocks.push({ data: part, ec: remainder(part, ecLength) });
  }
  const out: number[] = [];
  for (let k = 0; k <= shortLength; k++) for (const block of blocks) if (k < block.data.length) out.push(block.data[k] as number);
  for (let k = 0; k < ecLength; k++) for (const block of blocks) out.push(block.ec[k] as number);
  return out;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}

const MASKS: Array<(row: number, col: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/**
 * Encodes text (as UTF-8) in byte mode. Returns undefined when it does not fit `MAX_QR_VERSION`
 * at the level; the page shows the text alone then. `mask` forces one of the eight masks, for the
 * tests; otherwise the one with the lowest penalty is chosen, as the standard says.
 */
export function encodeQr(text: string, level: QrLevel = "M", options: { version?: number; mask?: number } = {}): QrMatrix | undefined {
  const bytes = new TextEncoder().encode(text);
  const fitting = qrVersionFor(bytes.length, level);
  if (fitting === undefined) return undefined;
  const version = options.version ?? fitting;
  if (version < fitting || version > MAX_QR_VERSION) return undefined;
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (row: number, col: number, dark: boolean): void => {
    (modules[row] as boolean[])[col] = dark;
    (reserved[row] as boolean[])[col] = true;
  };

  // Finders, with their separators.
  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = top + r;
        const col = left + c;
        if (row < 0 || col < 0 || row >= size || col >= size) continue;
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(row, col, ring !== 2 && ring !== 4);
      }
    }
  }
  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Alignment patterns, except where a finder is.
  const positions = alignmentPositions(version);
  for (const row of positions) {
    for (const col of positions) {
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) set(row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
    }
  }
  // Format areas reserved now, written once the mask is known; the dark module.
  const writeFormat = (mask: number): void => {
    const data = (LEVEL_BITS[level] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
    // Bit 0 is the least significant. The first copy runs down column 8 and along row 8 by the
    // top-left finder; the second is split between the other two finders.
    for (let i = 0; i <= 5; i++) set(i, 8, bit(i));
    set(7, 8, bit(6));
    set(8, 8, bit(7));
    set(8, 7, bit(8));
    for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i));
    for (let i = 0; i < 8; i++) set(8, size - 1 - i, bit(i));
    for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bit(i));
    set(size - 8, 8, true);
  };
  writeFormat(0);
  // Version information, from version 7.
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // Data, in the zigzag: two columns at a time from the right, upwards then downwards, skipping the vertical timing column.
  const data = codewords(bytes, version, level);
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - v : v;
        if ((reserved[row] as boolean[])[col]) continue;
        const byte = data[bitIndex >>> 3] ?? 0;
        (modules[row] as boolean[])[col] = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex++;
      }
    }
  }

  const applyMask = (mask: number): void => {
    const test = MASKS[mask] as (r: number, c: number) => boolean;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!(reserved[r] as boolean[])[c] && test(r, c)) (modules[r] as boolean[])[c] = !(modules[r] as boolean[])[c];
  };

  let chosen = options.mask;
  if (chosen === undefined) {
    let best = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(mask);
      writeFormat(mask);
      const score = penalty(modules);
      if (score < best) {
        best = score;
        chosen = mask;
      }
      applyMask(mask); // XOR again: back to unmasked.
    }
  }
  const mask = chosen ?? 0;
  applyMask(mask);
  writeFormat(mask);
  return { version, level, mask, size, modules };
}

/** The standard's four penalty rules; the mask with the lowest total is used. */
export function penalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  const at = (r: number, c: number): boolean => (modules[r] as readonly boolean[])[c] as boolean;
  let score = 0;
  // Rule 1: five or more in a row of one colour, 3 + one per extra. Rule 3: a finder-like
  // 1:1:3:1:1 with four light modules on one side, read as the standard writes it, an 11-module
  // window of 10111010000 or 00001011101 inside the symbol.
  const line = (get: (i: number) => boolean): void => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    let window = 0;
    for (let i = 0; i < size; i++) {
      window = ((window << 1) & 0x7ff) | (get(i) ? 1 : 0);
      if (i >= 10 && (window === 0x5d0 || window === 0x05d)) score += 40;
    }
  };
  for (let r = 0; r < size; r++) line((c) => at(r, c));
  for (let c = 0; c < size; c++) line((r) => at(r, c));
  // Rule 2: every 2 × 2 block of one colour.
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) if (at(r, c) === at(r, c + 1) && at(r, c) === at(r + 1, c) && at(r, c) === at(r + 1, c + 1)) score += 3;
  // Rule 4: ten per five percentage points the dark share is away from half.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (at(r, c)) dark++;
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}
