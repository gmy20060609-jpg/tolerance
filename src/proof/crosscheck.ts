// Two spots solved by an independent open-source solver, postflop-solver
// (github.com/b-inary/postflop-solver, commit 9d1509f, in Rust), on
// 26 November 2026, each down to 0.002% of the pot. Only its results are
// recorded here; none of its code is used.
//
// Both solvers were given the same ranges, board, pot, stacks and bet sizes,
// with every rule that could make the trees differ switched off: no bet
// merging, no forced all-in, all-in offered only where listed.

import { parseCards } from '../engine/cards.ts';
import { parseRange } from '../engine/range.ts';
import type { TreeConfig } from '../engine/tree.ts';
import { BB_DEFEND, BTN_OPEN } from '../spots.ts';

export interface Reference {
  name: string;
  board: number[];
  ranges: [Float64Array, Float64Array];
  tree: TreeConfig;
  /** What the first player expects to end with out of the starting pot. */
  value: number;
  /** Action frequencies over the whole range, by line of play (actions by index). */
  lines: { path: number[]; frequencies: number[] }[];
}

const ranges = (): [Float64Array, Float64Array] => [parseRange(BB_DEFEND), parseRange(BTN_OPEN)];

/** River: bets of half pot, pot and all-in; raises of half pot and all-in. */
export const RIVER_REFERENCE: Reference = {
  name: 'river',
  board: parseCards('Qh Ts 7h 4d 2h'),
  ranges: ranges(),
  tree: { pot: 100, stack: 300, bets: [[0.5, 1], [0.5, 1]], raises: [[0.5], [0.5]], maxRaises: 10, allIn: true, allInThreshold: 1 },
  value: 45.63834,
  lines: [
    { path: [], frequencies: [0.7807, 0.2119, 0.0, 0.0074] },
    { path: [0], frequencies: [0.5473, 0.1948, 0.2464, 0.0115] },
    { path: [1], frequencies: [0.3629, 0.4714, 0.0, 0.1657] },
    { path: [2], frequencies: [0.5398, 0.3566, 0.0109, 0.0928] },
    { path: [0, 1], frequencies: [0.4175, 0.4343, 0.0, 0.1481] },
  ],
};

/** Turn and every river after it: one bet of three-quarters of the pot on each street, no raises. */
export const TURN_REFERENCE: Reference = {
  name: 'turn',
  board: parseCards('Ks 8h 5d 2c'),
  ranges: ranges(),
  tree: { pot: 80, stack: 1000, bets: [[0.75], [0.75]], raises: [[], []], maxRaises: 0, allIn: false, allInThreshold: 1 },
  value: 32.6581,
  lines: [
    { path: [], frequencies: [0.8463, 0.1537] },
    { path: [0], frequencies: [0.5099, 0.4901] },
    { path: [1], frequencies: [0.3775, 0.6225] },
    { path: [0, 1], frequencies: [0.5294, 0.4706] },
  ],
};
