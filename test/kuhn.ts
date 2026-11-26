// Kuhn poker written as a one-street spot for the range solver.
//
// Three cards, one each. Both players ante one chip, so the pot is 2. Either
// player may bet one chip; a bet can only be called or folded. In the solver's
// terms that is a pot of 2 with one chip behind and a half-pot bet.
//
// A hand here is one card. The solver expects two card ids per hand, so each
// hand also gets a private filler id that no other hand uses.

import { Solver, type HandSet } from '../src/engine/solver.ts';
import { buildTree } from '../src/engine/tree.ts';

function oneCardHands(fillerBase: number): HandSet {
  return {
    n: 3,
    card1: Uint8Array.from([0, 1, 2]),
    card2: Uint8Array.from([fillerBase, fillerBase + 1, fillerBase + 2]),
    strength: Int32Array.from([0, 1, 2]),
    weight: Float64Array.from([1, 1, 1]),
    label: Int32Array.from([0, 1, 2]),
  };
}

export function kuhnSolver(): Solver {
  const tree = buildTree({
    pot: 2,
    stack: 1,
    bets: [[0.5], [0.5]],
    raises: [[], []],
    maxRaises: 0,
    allIn: false,
    allInThreshold: 1,
  });
  return new Solver(tree, [oneCardHands(10), oneCardHands(20)]);
}
