// The textbook river game with a closed-form answer.
//
// The player in position holds either the best hand or the worst hand. The
// player out of position always holds a hand in between and may only check and
// then call or fold. For a bet of s pots the equilibrium is:
//   - the bettor bets every best hand and bluffs s / (1 + s) worst hands for
//     each of them,
//   - the caller calls 1 / (1 + s) of the time,
//   - the bettor's share of the pot is (value hands) * (1 + 2s) / (1 + s).
// See Chen and Ankenman, "The Mathematics of Poker" (2006), chapter 11.

import { Solver, type HandSet } from '../engine/solver.ts';
import { buildTree } from '../engine/tree.ts';

/** Hands that never share a card with anything, so no deal is ruled out. */
function abstractHands(strengths: number[], weights: number[], firstCard: number): HandSet {
  const n = strengths.length;
  return {
    n,
    card1: Uint8Array.from({ length: n }, (_, i) => firstCard + 2 * i),
    card2: Uint8Array.from({ length: n }, (_, i) => firstCard + 2 * i + 1),
    strength: Int32Array.from(strengths),
    weight: Float64Array.from(weights),
    label: Int32Array.from({ length: n }, (_, i) => i),
  };
}

export const POLAR_CASES = [
  { size: 0.5, value: 0.4 },
  { size: 1, value: 0.5 },
  { size: 2, value: 0.3 },
];

export const POLAR_POT = 10;

/** `value` is the share of the bettor's range that is the best hand. */
export function polarSolver(size: number, value: number): Solver {
  const tree = buildTree({
    pot: POLAR_POT,
    stack: 100,
    bets: [[], [size]],
    raises: [[], []],
    maxRaises: 0,
    allIn: false,
    allInThreshold: 1,
  });
  const caller = abstractHands([1], [1], 0);
  const bettor = abstractHands([0, 2], [1 - value, value], 10);
  return new Solver(tree, [caller, bettor]);
}

/** What the solver found, next to the closed form. */
export function polarResult(solver: Solver, size: number, value: number) {
  const tree = solver.tree;
  const root = tree.nodes[0]!;
  const betNode = tree.nodes[root.children[0]!]!;
  const callNode = tree.nodes[betNode.children[1]!]!;
  const strategy = solver.averageStrategy(betNode.id);
  // Hands are stored weakest first: index 0 is the bluff, index 1 the value hand.
  const bluff = strategy[2 + 0]!;
  const valueBet = strategy[2 + 1]!;
  return {
    valueBet: { solved: valueBet, exact: 1 },
    bluffRatio: { solved: (bluff * (1 - value)) / value, exact: size / (1 + size) },
    call: { solved: solver.averageStrategy(callNode.id)[1]!, exact: 1 / (1 + size) },
    share: { solved: (solver.gameValue(1) + POLAR_POT / 2) / POLAR_POT, exact: (value * (1 + 2 * size)) / (1 + size) },
    exploitability: solver.exploitability() / POLAR_POT,
  };
}
