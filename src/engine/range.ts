// Ranges written the way players write them: "QQ+, AKs, A5s-A2s, KQo:0.5".
//
// A range is 1326 weights, one per two-card combo, each between 0 and 1.

import {
  COMBO_CLASS,
  COMBO_COUNT,
  COMBO_HI,
  COMBO_LO,
  RANK_CHARS,
  comboIndex,
  parseCard,
  rankOf,
  suitOf,
} from './cards.ts';

export type Range = Float64Array;

export const emptyRange = (): Range => new Float64Array(COMBO_COUNT);

export const fullRange = (): Range => new Float64Array(COMBO_COUNT).fill(1);

type Suitedness = 's' | 'o' | '';

function addClass(range: Range, hi: number, lo: number, kind: Suitedness, weight: number): void {
  for (let i = 0; i < COMBO_COUNT; i++) {
    const a = COMBO_HI[i]!;
    const b = COMBO_LO[i]!;
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (Math.max(ra, rb) !== hi || Math.min(ra, rb) !== lo) continue;
    if (hi !== lo) {
      const suited = suitOf(a) === suitOf(b);
      if ((kind === 's' && !suited) || (kind === 'o' && suited)) continue;
    }
    range[i] = weight;
  }
}

function parseHand(text: string): { hi: number; lo: number; kind: Suitedness } {
  const a = RANK_CHARS.indexOf(text[0]?.toUpperCase() ?? '');
  const b = RANK_CHARS.indexOf(text[1]?.toUpperCase() ?? '');
  const kind = (text[2]?.toLowerCase() ?? '') as Suitedness;
  if (a < 0 || b < 0 || text.length > 3 || !['s', 'o', ''].includes(kind) || (a === b && kind !== '')) {
    throw new Error(`Not a hand: "${text}"`);
  }
  return { hi: Math.max(a, b), lo: Math.min(a, b), kind };
}

/** Parses a range string. Later entries overwrite earlier ones. */
export function parseRange(text: string): Range {
  const range = emptyRange();
  for (const raw of text.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const [spec, weightText] = entry.split(':') as [string, string | undefined];
    const weight = weightText === undefined ? 1 : Number(weightText);
    if (!(weight >= 0 && weight <= 1)) throw new Error(`Not a weight: "${weightText}"`);

    // Two exact cards, such as AhKh.
    if (/^[2-9TJQKA][cdhs][2-9TJQKA][cdhs]$/i.test(spec)) {
      const a = parseCard(spec.slice(0, 2));
      const b = parseCard(spec.slice(2, 4));
      if (a === b) throw new Error(`Not a hand: "${spec}"`);
      range[comboIndex(a, b)] = weight;
      continue;
    }

    if (spec.endsWith('+')) {
      const { hi, lo, kind } = parseHand(spec.slice(0, -1));
      if (hi === lo) for (let r = hi; r <= 12; r++) addClass(range, r, r, '', weight);
      else for (let r = lo; r < hi; r++) addClass(range, hi, r, kind, weight);
      continue;
    }

    if (spec.includes('-')) {
      const [left, right] = spec.split('-') as [string, string];
      const a = parseHand(left);
      const b = parseHand(right);
      if (a.kind !== b.kind) throw new Error(`Mixed suitedness in "${spec}"`);
      if (a.hi === a.lo && b.hi === b.lo) {
        for (let r = Math.min(a.hi, b.hi); r <= Math.max(a.hi, b.hi); r++) addClass(range, r, r, '', weight);
      } else if (a.hi === b.hi) {
        for (let r = Math.min(a.lo, b.lo); r <= Math.max(a.lo, b.lo); r++) addClass(range, a.hi, r, a.kind, weight);
      } else if (a.hi - a.lo === b.hi - b.lo) {
        const gap = a.hi - a.lo;
        for (let r = Math.min(a.hi, b.hi); r <= Math.max(a.hi, b.hi); r++) addClass(range, r, r - gap, a.kind, weight);
      } else {
        throw new Error(`Cannot read the span "${spec}"`);
      }
      continue;
    }

    const { hi, lo, kind } = parseHand(spec);
    addClass(range, hi, lo, kind, weight);
  }
  return range;
}

/** Weights averaged over each of the 169 starting-hand classes. */
export function classWeights(range: ArrayLike<number>): Float64Array {
  const sum = new Float64Array(169);
  const count = new Float64Array(169);
  for (let i = 0; i < COMBO_COUNT; i++) {
    sum[COMBO_CLASS[i]!]! += range[i]!;
    count[COMBO_CLASS[i]!]! += 1;
  }
  for (let c = 0; c < 169; c++) sum[c]! /= count[c]!;
  return sum;
}

/** Sets every combo of a class to one weight. */
export function setClass(range: Range, cls: number, weight: number): void {
  for (let i = 0; i < COMBO_COUNT; i++) if (COMBO_CLASS[i] === cls) range[i] = weight;
}

/** Number of combos in the range, counting partial weights, with dead cards removed. */
export function comboCount(range: ArrayLike<number>, dead: ArrayLike<number> = []): number {
  let blocked = 0n;
  for (let i = 0; i < dead.length; i++) blocked |= 1n << BigInt(dead[i]!);
  let total = 0;
  for (let i = 0; i < COMBO_COUNT; i++) {
    if ((blocked >> BigInt(COMBO_HI[i]!)) & 1n || (blocked >> BigInt(COMBO_LO[i]!)) & 1n) continue;
    total += range[i]!;
  }
  return total;
}
