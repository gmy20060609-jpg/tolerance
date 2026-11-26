// The same spots solved here and by postflop-solver: see src/proof/crosscheck.ts.

import { describe, expect, it } from 'vitest';
import { riverSolver } from '../src/engine/river.ts';
import { turnSolver } from '../src/engine/turn.ts';
import { gridViewAt } from '../src/engine/view.ts';
import { RIVER_REFERENCE, TURN_REFERENCE } from '../src/proof/crosscheck.ts';

describe.each([
  { reference: RIVER_REFERENCE, iterations: 2000 },
  { reference: TURN_REFERENCE, iterations: 200 },
])('against postflop-solver: $reference.name', ({ reference, iterations }) => {
  const spot = { board: reference.board, ranges: reference.ranges, tree: reference.tree };
  const solver = reference.board.length === 4 ? turnSolver(spot) : riverSolver(spot);
  solver.iterate(iterations);
  const pot = reference.tree.pot;

  it('solves to within 0.05% of the pot', () => {
    expect(solver.exploitability() / pot).toBeLessThan(5e-4);
  });

  it('gives the first player the same value, to a hundredth of a per cent of the pot', () => {
    const value = solver.gameValue(0) + pot / 2;
    expect(Math.abs(value - reference.value) / pot).toBeLessThan(1e-4);
  });

  it('takes each action as often, to within one point in a hundred', () => {
    for (const line of reference.lines) {
      let id = 0;
      for (const action of line.path) id = solver.tree.nodes[id]!.children[action]!;
      const view = gridViewAt(solver, id);
      expect(view.overall.length).toBe(line.frequencies.length);
      line.frequencies.forEach((want, a) => expect(Math.abs(view.overall[a]! - want), `${reference.name} ${line.path} action ${a}`).toBeLessThan(0.01));
    }
  });
}, 120_000);
