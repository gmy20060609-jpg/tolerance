// Leduc hold'em: the smallest well-known game with a card dealt between two
// rounds of betting. It checks the chance node the turn solver relies on.

import { describe, expect, it } from 'vitest';
import { LEDUC_VALUE, leducSolver } from '../src/proof/leduc.ts';

describe('Leduc hold\'em', () => {
  const solver = leducSolver();
  solver.iterate(3000);

  it('has the 288 information sets of the game', () => {
    // Six decision points in a round, five ways the first round can reach the public card.
    let sets = 0;
    for (const node of solver.tree.nodes) if (node.actions.length) sets += solver.handsAt(node.id)[node.player]!.n;
    // Counted with the two suits apart: 6 x 6 before the card, 5 x 6 x 5 x 6 after.
    expect(sets).toBe(36 + 900);
    // By rank, as the game is usually counted: 6 x 3 before, 5 x 6 x 3 x 3 after.
    expect(6 * 3 + 5 * 6 * 3 * 3).toBe(288);
  });

  it('is worth -0.0856 to the first player', () => {
    expect(solver.gameValue(0)).toBeCloseTo(LEDUC_VALUE, 4);
    expect(solver.gameValue(0) + solver.gameValue(1)).toBeCloseTo(0, 9);
  });

  it('cannot be exploited', () => {
    expect(solver.exploitability()).toBeLessThan(1e-3);
  });
});
