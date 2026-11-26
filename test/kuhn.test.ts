// Kuhn poker has a known solution (Kuhn, 1950): the first player loses 1/18 of
// an ante per hand, and the second player's equilibrium strategy is unique.

import { describe, expect, it } from 'vitest';
import { kuhnSolver } from '../src/proof/kuhn.ts';

describe('Kuhn poker', () => {
  const solver = kuhnSolver();
  solver.iterate(20_000);
  const nodes = solver.tree.nodes;
  const root = nodes[0]!;

  it('has the six-node betting tree of the game', () => {
    expect(root.actions.map((a) => a.kind)).toEqual(['check', 'allin']);
    const afterCheck = nodes[root.children[0]!]!;
    expect(afterCheck.actions.map((a) => a.kind)).toEqual(['check', 'allin']);
    const facingBet = nodes[root.children[1]!]!;
    expect(facingBet.actions.map((a) => a.kind)).toEqual(['fold', 'call']);
  });

  it('is worth -1/18 to the first player', () => {
    expect(solver.gameValue(0)).toBeCloseTo(-1 / 18, 5);
    expect(solver.gameValue(1)).toBeCloseTo(1 / 18, 5);
  });

  it('cannot be exploited', () => {
    expect(solver.exploitability()).toBeLessThan(1e-4);
  });

  it('finds the second player\'s unique strategy', () => {
    // After a check: bet the jack one time in three, never the queen, always the king.
    const afterCheck = solver.averageStrategy(root.children[0]!);
    expect(afterCheck[3 + 0]).toBeCloseTo(1 / 3, 3);
    expect(afterCheck[3 + 1]).toBeCloseTo(0, 3);
    expect(afterCheck[3 + 2]).toBeCloseTo(1, 3);
    // Facing a bet: fold the jack, call the queen one time in three, call the king.
    const facingBet = solver.averageStrategy(root.children[1]!);
    expect(facingBet[3 + 0]).toBeCloseTo(0, 3);
    expect(facingBet[3 + 1]).toBeCloseTo(1 / 3, 3);
    expect(facingBet[3 + 2]).toBeCloseTo(1, 3);
  });

  it('finds a member of the first player\'s family of strategies', () => {
    // Bet the jack with probability a in [0, 1/3], the king with 3a, never the queen.
    const first = solver.averageStrategy(0);
    const a = first[3 + 0]!;
    expect(a).toBeGreaterThanOrEqual(-1e-9);
    expect(a).toBeLessThanOrEqual(1 / 3 + 1e-3);
    expect(first[3 + 1]).toBeCloseTo(0, 3);
    expect(first[3 + 2]).toBeCloseTo(3 * a, 2);
  });
});
