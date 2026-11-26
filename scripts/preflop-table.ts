// Builds the exact preflop all-in table: for every pair of starting-hand
// classes, how many of the 1,712,304 five-card boards each side wins and how
// many are tied, summed over every way the two classes can be dealt together.
//
// The count runs over boards instead of over matchups. Boards that differ only
// by a relabelling of suits give the same class totals, so one board stands
// for its whole orbit: 134,459 boards instead of 2,598,960. On each board all
// 1,081 possible hands are ranked once and counted against each other.
//
//   node scripts/preflop-table.ts            writes src/engine/data/preflop-equity.bin
//   node scripts/preflop-table.ts --sample   times one board in 200 and writes nothing

import { writeFileSync } from 'node:fs';
import { CLASS_COUNT, COMBO_CLASS, COMBO_COUNT, COMBO_HI, COMBO_LO } from '../src/engine/cards.ts';
import { BoardState } from '../src/engine/evaluator.ts';

const sample = process.argv.includes('--sample');
const started = performance.now();

// --- The 24 suit relabellings ------------------------------------------------
const perms: number[][] = [];
for (let a = 0; a < 4; a++)
  for (let b = 0; b < 4; b++)
    for (let c = 0; c < 4; c++)
      for (let d = 0; d < 4; d++) if (new Set([a, b, c, d]).size === 4) perms.push([a, b, c, d]);
const identity = perms.findIndex((p) => p.join() === '0,1,2,3');
perms.splice(identity, 1);

const mapped = new Uint8Array(5);
const keyOf = (c: ArrayLike<number>) => (((c[0]! * 52 + c[1]!) * 52 + c[2]!) * 52 + c[3]!) * 52 + c[4]!;

/** Orbit size of a sorted board if it is the smallest member of its orbit, otherwise 0. */
function orbit(board: Uint8Array): number {
  const own = keyOf(board);
  let fixed = 1;
  for (const p of perms) {
    for (let i = 0; i < 5; i++) mapped[i] = (board[i]! & ~3) | p[board[i]! & 3]!;
    // Insertion sort of five cards.
    for (let i = 1; i < 5; i++) {
      const v = mapped[i]!;
      let j = i - 1;
      while (j >= 0 && mapped[j]! > v) {
        mapped[j + 1] = mapped[j]!;
        j--;
      }
      mapped[j + 1] = v;
    }
    const key = keyOf(mapped);
    if (key < own) return 0;
    if (key === own) fixed++;
  }
  return 24 / fixed;
}

// --- Counting ----------------------------------------------------------------
const N = CLASS_COUNT;
const wins = new Float64Array(N * N);
const ties = new Float64Array(N * N);

const strength = new Int32Array(COMBO_COUNT);
const keys = new Float64Array(COMBO_COUNT);
const lower = new Float64Array(N); // hands of each class ranked so far
const cardClass = new Uint8Array(52 * 64); // per card: classes of the ranked hands that hold it
const cardFill = new Uint8Array(52);

function count(board: Uint8Array, weight: number): void {
  const state = new BoardState(board);
  const dead = new Uint8Array(52);
  for (let i = 0; i < 5; i++) dead[board[i]!] = 1;

  let n = 0;
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    const hi = COMBO_HI[combo]!;
    const lo = COMBO_LO[combo]!;
    if (dead[hi] || dead[lo]) continue;
    const s = state.with2(hi, lo);
    strength[combo] = s;
    keys[n++] = s * 2048 + combo;
  }
  const sorted = keys.subarray(0, n);
  sorted.sort();

  lower.fill(0);
  cardFill.fill(0);
  let start = 0;
  while (start < n) {
    const s = Math.floor(sorted[start]! / 2048);
    let end = start + 1;
    while (end < n && Math.floor(sorted[end]! / 2048) === s) end++;

    for (let i = start; i < end; i++) {
      const combo = sorted[i]! % 2048;
      const hi = COMBO_HI[combo]!;
      const lo = COMBO_LO[combo]!;
      const row = COMBO_CLASS[combo]! * N;
      // Beats every weaker hand ...
      for (let c = 0; c < N; c++) wins[row + c]! += weight * lower[c]!;
      // ... except the ones holding one of its cards. No weaker hand holds both.
      for (let k = 0, base = hi * 64; k < cardFill[hi]!; k++) wins[row + cardClass[base + k]!]! -= weight;
      for (let k = 0, base = lo * 64; k < cardFill[lo]!; k++) wins[row + cardClass[base + k]!]! -= weight;
      // Ties with the other hands of the same strength.
      for (let j = i + 1; j < end; j++) {
        const other = sorted[j]! % 2048;
        const oh = COMBO_HI[other]!;
        const ol = COMBO_LO[other]!;
        if (oh === hi || oh === lo || ol === hi || ol === lo) continue;
        const otherClass = COMBO_CLASS[other]!;
        ties[row + otherClass]! += weight;
        ties[otherClass * N + row / N]! += weight;
      }
    }
    for (let i = start; i < end; i++) {
      const combo = sorted[i]! % 2048;
      const hi = COMBO_HI[combo]!;
      const lo = COMBO_LO[combo]!;
      const cls = COMBO_CLASS[combo]!;
      lower[cls]!++;
      cardClass[hi * 64 + cardFill[hi]!++] = cls;
      cardClass[lo * 64 + cardFill[lo]!++] = cls;
    }
    start = end;
  }
}

const board = new Uint8Array(5);
let canonical = 0;
let covered = 0;
let counted = 0;
for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b++)
    for (let c = b + 1; c < 52; c++)
      for (let d = c + 1; d < 52; d++)
        for (let e = d + 1; e < 52; e++) {
          board[0] = a; board[1] = b; board[2] = c; board[3] = d; board[4] = e;
          const weight = orbit(board);
          if (!weight) continue;
          canonical++;
          covered += weight;
          if (sample && canonical % 200 !== 0) continue;
          count(board, weight);
          counted++;
        }

const seconds = (performance.now() - started) / 1000;
console.log(`${canonical} boards up to suit relabelling, standing for ${covered} boards`);
console.log(`${counted} boards counted in ${seconds.toFixed(1)} s`);
if (canonical !== 134459 || covered !== 2598960) throw new Error('Board enumeration is wrong');

if (!sample) {
  // Every pair of hands meets on exactly 1,712,304 boards.
  const pairs = new Float64Array(N * N);
  for (let x = 0; x < COMBO_COUNT; x++)
    for (let y = 0; y < COMBO_COUNT; y++) {
      const xh = COMBO_HI[x]!, xl = COMBO_LO[x]!, yh = COMBO_HI[y]!, yl = COMBO_LO[y]!;
      if (xh === yh || xh === yl || xl === yh || xl === yl) continue;
      pairs[COMBO_CLASS[x]! * N + COMBO_CLASS[y]!]!++;
    }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const total = wins[i * N + j]! + wins[j * N + i]! + ties[i * N + j]!;
      if (total !== pairs[i * N + j]! * 1712304) throw new Error(`Totals do not add up for classes ${i}, ${j}`);
    }
  const out = new Uint32Array(2 * N * N);
  out.set(wins, 0);
  out.set(ties, N * N);
  const file = new URL('../src/engine/data/preflop-equity.bin', import.meta.url);
  writeFileSync(file, new Uint8Array(out.buffer));
  console.log(`Totals check out. Wrote ${out.byteLength} bytes to ${file.pathname}`);
}
