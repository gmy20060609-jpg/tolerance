// What the interface reads from a solve.

import { describe, expect, it } from 'vitest';
import { comboIndex, parseCards } from '../src/engine/cards.ts';
import { riverSolver } from '../src/engine/river.ts';
import { DECISION } from '../src/engine/tree.ts';
import { comboDetails, gridViews } from '../src/engine/view.ts';
import { PRESETS, moneymakerFarha } from '../src/spots.ts';

describe('the 2003 hand', () => {
  const spot = moneymakerFarha;
  const solver = riverSolver(spot);
  solver.iterate(2000);
  const nodes = solver.tree.nodes;
  const root = nodes[0]!;
  const afterCheck = nodes[root.children[0]!]!;

  it('has the pot and stacks reported for it', () => {
    // 2 x (100,000 + 5,000 ante) before the flop, 2 x 800,000 on the turn.
    expect(spot.tree.pot).toBe(2 * 105_000 + 2 * 800_000);
    // The shorter stack, 3.7 million, less what it has put in.
    expect(spot.tree.stack).toBe(3_700_000 - 105_000 - 800_000);
  });

  it('solves to a ten-thousandth of the pot', () => {
    expect(solver.exploitability() / spot.tree.pot).toBeLessThan(1e-4);
  });

  it('keeps both hands that were held in the ranges', () => {
    const held = (cards: string, nodeId: number) => {
      const [a, b] = parseCards(cards) as [number, number];
      return comboDetails(solver, nodeId).find((d) => d.combo === comboIndex(a, b));
    };
    const moneymaker = held('Ks7h', afterCheck.id)!;
    expect(moneymaker).toBeDefined();
    expect(moneymaker.strategy.reduce((sum, f) => sum + f, 0)).toBeCloseTo(1, 9);
    const allIn = afterCheck.actions.findIndex((action) => action.kind === 'allin');
    const facing = nodes[afterCheck.children[allIn]!]!;
    expect(held('Qs9h', facing.id)).toBeDefined();
  });

  it('makes every action a hand mixes worth the same to it', () => {
    // Indifference: if a hand takes two actions, neither can be worth more.
    // Checked at each player's first decision, which every hand reaches; deep
    // in the tree a rarely reached hand can be off by more and cost nothing.
    for (const node of [root, afterCheck]) {
      for (const detail of comboDetails(solver, node.id)) {
        const played = detail.actionValues.filter((_, a) => detail.strategy[a]! > 0.05);
        const spread = Math.max(...played) - Math.min(...played);
        expect(spread / spot.tree.pot).toBeLessThan(2e-3);
      }
    }
  });

  it('folds each grid view to frequencies that add up', () => {
    const views = gridViews(solver);
    for (const node of nodes) {
      const view = views[node.id];
      if (node.type !== DECISION) {
        expect(view).toBeUndefined();
        continue;
      }
      const actions = node.actions.length;
      let overall = 0;
      for (let a = 0; a < actions; a++) overall += view!.overall[a]!;
      expect(overall).toBeCloseTo(1, 5);
      for (let c = 0; c < 169; c++) {
        if (!view!.fill[c]) continue;
        let sum = 0;
        for (let a = 0; a < actions; a++) sum += view!.freq[c * actions + a]!;
        expect(Math.abs(sum - 255)).toBeLessThanOrEqual(actions);
      }
    }
    // At the first decision of each player nothing has been filtered yet.
    expect(Math.max(...views[0]!.fill)).toBe(255);
  });
});

describe('presets', () => {
  it.each(PRESETS)('$title can be dealt and solved', (preset) => {
    const solver = riverSolver(preset.spot);
    solver.iterate(50);
    expect(solver.exploitability()).toBeGreaterThanOrEqual(0);
    expect(new Set(preset.spot.board).size).toBe(5);
  });
});
