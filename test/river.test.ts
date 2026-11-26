// River spots on real boards. There is no closed form to compare against, so
// the tests check the one number that certifies a solution on its own:
// exploitability, measured two independent ways.

import { describe, expect, it } from 'vitest';
import { riverSolver } from '../src/engine/river.ts';
import { referenceExploitability } from './reference.ts';
import { dryRiver, wetRiver } from './spots.ts';

describe.each([
  { name: 'dry river, deep stacks', spot: dryRiver },
  { name: 'flush river, bet pot', spot: wetRiver },
])('$name', ({ spot }) => {
  const pot = spot.tree.pot;
  const solver = riverSolver(spot);
  const curve: number[] = [];
  for (const target of [10, 50, 200, 1000]) {
    solver.iterate(target - solver.iteration);
    curve.push(solver.exploitability() / pot);
  }

  it('gets less exploitable as it runs', () => {
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeLessThan(curve[i - 1]!);
  });

  it('is within 0.05% of the pot of equilibrium after 1,000 iterations', () => {
    expect(curve.at(-1)).toBeLessThan(0.0005);
  });

  it('agrees with the plain pairwise measurement of exploitability', () => {
    const fast = solver.exploitability();
    const plain = referenceExploitability(solver);
    expect(Math.abs(fast - plain)).toBeLessThan(1e-9 * pot);
  });

  it('is zero-sum', () => {
    expect(solver.gameValue(0) + solver.gameValue(1)).toBeCloseTo(0, 9);
  });

  it('never lets a best response do worse than the strategy it answers', () => {
    expect(solver.bestResponseValue(0)).toBeGreaterThanOrEqual(solver.gameValue(0) - 1e-9);
    expect(solver.bestResponseValue(1)).toBeGreaterThanOrEqual(solver.gameValue(1) - 1e-9);
  });
});
