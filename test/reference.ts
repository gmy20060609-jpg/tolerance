// A second, deliberately plain way to measure exploitability. It walks every
// pair of hands at every terminal node, so it shares none of the sorting and
// card-sum shortcuts the solver uses. The tests require both to agree.

import type { Solver } from '../src/engine/solver.ts';
import { DECISION, FOLD } from '../src/engine/tree.ts';

function conflict(solver: Solver, player: number, h: number, k: number): boolean {
  const mine = solver.hands[player]!;
  const theirs = solver.hands[1 - player]!;
  const a = mine.card1[h]!;
  const b = mine.card2[h]!;
  const c = theirs.card1[k]!;
  const d = theirs.card2[k]!;
  return a === c || a === d || b === c || b === d;
}

function bestValues(solver: Solver, nodeId: number, player: number, oppReach: number[]): number[] {
  const node = solver.tree.nodes[nodeId]!;
  const mine = solver.hands[player]!;
  const theirs = solver.hands[1 - player]!;

  if (node.type !== DECISION) {
    const out = new Array<number>(mine.n).fill(0);
    for (let h = 0; h < mine.n; h++) {
      for (let k = 0; k < theirs.n; k++) {
        if (conflict(solver, player, h, k)) continue;
        let result: number;
        if (node.type === FOLD) result = node.player === player ? -1 : 1;
        else result = Math.sign(mine.strength[h]! - theirs.strength[k]!);
        out[h]! += result * node.stake * oppReach[k]!;
      }
    }
    return out;
  }

  if (node.player === player) {
    const children = node.children.map((child) => bestValues(solver, child, player, oppReach));
    return children[0]!.map((_, h) => Math.max(...children.map((values) => values[h]!)));
  }

  const average = solver.averageStrategy(nodeId);
  const out = new Array<number>(mine.n).fill(0);
  node.children.forEach((child, a) => {
    const reach = oppReach.map((r, k) => r * average[a * theirs.n + k]!);
    bestValues(solver, child, player, reach).forEach((v, h) => (out[h]! += v));
  });
  return out;
}

export function referenceExploitability(solver: Solver): number {
  const [a, b] = solver.hands;
  let deals = 0;
  for (let h = 0; h < a.n; h++)
    for (let k = 0; k < b.n; k++) if (!conflict(solver, 0, h, k)) deals += a.weight[h]! * b.weight[k]!;
  let total = 0;
  for (const player of [0, 1]) {
    const mine = solver.hands[player]!;
    const values = bestValues(solver, 0, player, Array.from(solver.hands[1 - player]!.weight));
    for (let h = 0; h < mine.n; h++) total += mine.weight[h]! * values[h]!;
  }
  return total / (2 * deals);
}
