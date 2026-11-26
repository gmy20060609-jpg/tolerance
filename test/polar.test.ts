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

import { describe, expect, it } from 'vitest';
import { Solver, type HandSet } from '../src/engine/solver.ts';
import { buildTree } from '../src/engine/tree.ts';

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

describe.each([
  { size: 0.5, value: 0.4 },
  { size: 1, value: 0.5 },
  { size: 2, value: 0.3 },
])('polarised range against a bluff-catcher, bet of $size pot', ({ size, value }) => {
  const pot = 10;
  const tree = buildTree({
    pot,
    stack: 100,
    bets: [[], [size]],
    raises: [[], []],
    maxRaises: 0,
    allIn: false,
    allInThreshold: 1,
  });
  const caller = abstractHands([1], [1], 0);
  const bettor = abstractHands([0, 2], [1 - value, value], 10);
  const solver = new Solver(tree, [caller, bettor]);
  solver.iterate(5000);

  const root = tree.nodes[0]!;
  const betNode = tree.nodes[root.children[0]!]!;
  const callNode = tree.nodes[betNode.children[1]!]!;

  it('bets every value hand and bluffs in the right ratio', () => {
    const strategy = solver.averageStrategy(betNode.id);
    // Hands are stored weakest first: index 0 is the bluff, index 1 the value hand.
    const bluff = strategy[2 + 0]!;
    const valueBet = strategy[2 + 1]!;
    expect(valueBet).toBeCloseTo(1, 3);
    expect((bluff * (1 - value)) / value).toBeCloseTo(size / (1 + size), 3);
  });

  it('calls at the minimum defence frequency', () => {
    expect(solver.averageStrategy(callNode.id)[1]).toBeCloseTo(1 / (1 + size), 3);
  });

  it('gives the bettor the closed-form share of the pot', () => {
    const share = (solver.gameValue(1) + pot / 2) / pot;
    expect(share).toBeCloseTo((value * (1 + 2 * size)) / (1 + size), 4);
  });

  it('cannot be exploited', () => {
    expect(solver.exploitability() / pot).toBeLessThan(1e-4);
  });
});
