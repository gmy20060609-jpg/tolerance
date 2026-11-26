// Turning two ranges and a five-card board into a river spot the solver can run.

import { COMBO_COUNT, COMBO_HI, COMBO_LO } from './cards.ts';
import { BoardState } from './evaluator.ts';
import { Solver, type HandSet, type SolverOptions } from './solver.ts';
import { buildTree, type TreeConfig } from './tree.ts';

/** The hands of a range that are possible on a board, with their strengths. */
export function riverHands(board: ArrayLike<number>, range: ArrayLike<number>): HandSet {
  if (board.length !== 5) throw new Error('A river board has five cards');
  const state = new BoardState(board);
  const dead = new Uint8Array(52);
  for (let i = 0; i < 5; i++) dead[board[i]!] = 1;
  const picked: number[] = [];
  for (let i = 0; i < COMBO_COUNT; i++) {
    if (range[i]! > 0 && !dead[COMBO_HI[i]!] && !dead[COMBO_LO[i]!]) picked.push(i);
  }
  const n = picked.length;
  const hands: HandSet = {
    n,
    card1: new Uint8Array(n),
    card2: new Uint8Array(n),
    strength: new Int32Array(n),
    weight: new Float64Array(n),
    label: new Int32Array(n),
  };
  picked.forEach((combo, h) => {
    hands.card1[h] = COMBO_HI[combo]!;
    hands.card2[h] = COMBO_LO[combo]!;
    hands.strength[h] = state.with2(COMBO_HI[combo]!, COMBO_LO[combo]!);
    hands.weight[h] = range[combo]!;
    hands.label[h] = combo;
  });
  return hands;
}

export interface RiverSpot {
  board: number[];
  /** Ranges of the out-of-position and the in-position player, 1326 weights each. */
  ranges: [ArrayLike<number>, ArrayLike<number>];
  tree: TreeConfig;
}

export function riverSolver(spot: RiverSpot, options?: SolverOptions): Solver {
  return new Solver(
    buildTree(spot.tree),
    [riverHands(spot.board, spot.ranges[0]), riverHands(spot.board, spot.ranges[1])],
    options,
  );
}
