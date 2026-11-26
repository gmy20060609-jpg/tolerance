// Views of a solve for display: strategies folded onto the 13 x 13 grid of
// starting hands, and the per-combo detail of one node.

import { COMBO_CLASS, COMBO_COUNT, COMBO_HI, COMBO_LO } from './cards.ts';
import type { Solver } from './solver.ts';
import { DECISION } from './tree.ts';

/** How many combos of each class the board leaves possible. */
export function availableCombos(board: ArrayLike<number>): Float64Array {
  const dead = new Uint8Array(52);
  for (let i = 0; i < board.length; i++) dead[board[i]!] = 1;
  const out = new Float64Array(169);
  for (let i = 0; i < COMBO_COUNT; i++) {
    if (!dead[COMBO_HI[i]!] && !dead[COMBO_LO[i]!]) out[COMBO_CLASS[i]!]!++;
  }
  return out;
}

export interface GridView {
  /** freq[class * actions + action]: how often the class takes the action, in 1/255ths. */
  freq: Uint8Array;
  /** fill[class]: how much of the class's starting weight reaches the node, in 1/255ths. */
  fill: Uint8Array;
  /** How often each action is taken at the node over the whole range. */
  overall: Float32Array;
}

/**
 * The grid view of every decision node under the current average strategies,
 * indexed by node id (undefined for terminal nodes).
 */
export function gridViews(solver: Solver): (GridView | undefined)[] {
  const nodes = solver.tree.nodes;
  const views: (GridView | undefined)[] = new Array(nodes.length);
  const classOf = solver.hands.map((hands) => Uint8Array.from(hands.label, (combo) => COMBO_CLASS[combo]!));
  // What each class weighs in the starting ranges: the full height of its bar.
  const starting = solver.hands.map((hands, p) => {
    const sum = new Float64Array(169);
    for (let h = 0; h < hands.n; h++) sum[classOf[p]![h]!]! += hands.weight[h]!;
    return sum;
  });
  const mass = [new Float64Array(solver.hands[0].n), new Float64Array(solver.hands[1].n)];
  const classReach = new Float64Array(169);
  const widest = nodes.reduce((most, node) => Math.max(most, node.actions.length), 1);
  const classAction = new Float64Array(169 * widest);

  const walk = (id: number, reach: [Float64Array, Float64Array]): void => {
    const node = nodes[id]!;
    if (node.type !== DECISION) return;
    const p = node.player;
    const n = solver.hands[p]!.n;
    const actions = node.actions.length;
    const strategy = solver.averageStrategy(id);
    const own = reach[p]!;
    const cls = classOf[p]!;
    const facing = mass[p]!;
    solver.reachableMass(p, reach[1 - p]!, facing);

    classReach.fill(0);
    classAction.fill(0, 0, 169 * actions);
    const overall = new Float32Array(actions);
    let total = 0;
    for (let h = 0; h < n; h++) {
      const r = own[h]!;
      if (r === 0) continue;
      const c = cls[h]!;
      classReach[c]! += r;
      const w = r * facing[h]!;
      total += w;
      for (let a = 0; a < actions; a++) {
        const f = strategy[a * n + h]!;
        classAction[c * actions + a]! += r * f;
        overall[a]! += w * f;
      }
    }
    const freq = new Uint8Array(169 * actions);
    const fill = new Uint8Array(169);
    for (let c = 0; c < 169; c++) {
      const r = classReach[c]!;
      if (r <= 0) continue;
      fill[c] = Math.max(1, Math.round((255 * r) / starting[p]![c]!));
      for (let a = 0; a < actions; a++) freq[c * actions + a] = Math.round((255 * classAction[c * actions + a]!) / r);
    }
    if (total > 0) for (let a = 0; a < actions; a++) overall[a]! /= total;
    views[id] = { freq, fill, overall };

    for (let a = 0; a < actions; a++) {
      const child = node.children[a]!;
      if (nodes[child]!.type !== DECISION) continue;
      const next = new Float64Array(n);
      for (let h = 0; h < n; h++) next[h] = own[h]! * strategy[a * n + h]!;
      walk(child, p === 0 ? [next, reach[1]] : [reach[0], next]);
    }
  };
  walk(0, [solver.hands[0].weight, solver.hands[1].weight]);
  return views;
}

export interface ComboDetail {
  combo: number;
  /** Weight with which the combo reaches the node. */
  reach: number;
  strategy: number[];
  /** Chips each action is worth, and the value of the mix actually played. */
  actionValues: number[];
  value: number;
}

/** Per-combo strategy and values at one decision node, strongest hands first. */
export function comboDetails(solver: Solver, nodeId: number): ComboDetail[] {
  const detail = solver.nodeDetail(nodeId);
  const hands = solver.hands[detail.player]!;
  const actions = solver.tree.nodes[nodeId]!.actions.length;
  const own = detail.reach[detail.player]!;
  const out: ComboDetail[] = [];
  for (let h = hands.n - 1; h >= 0; h--) {
    if (!(own[h]! > 0) || !(detail.facing[h]! > 0)) continue;
    const strategy: number[] = [];
    const actionValues: number[] = [];
    let value = 0;
    for (let a = 0; a < actions; a++) {
      strategy.push(detail.strategy[a * hands.n + h]!);
      actionValues.push(detail.actionValues[a * hands.n + h]!);
      value += strategy[a]! * actionValues[a]!;
    }
    out.push({ combo: hands.label[h]!, reach: own[h]!, strategy, actionValues, value });
  }
  return out;
}
