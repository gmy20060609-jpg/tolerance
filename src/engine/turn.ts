// A turn spot: one round of betting, then one of the 48 river cards, then
// another round. Each river card has its own ordering of the hands, so the
// hands possible with that card are ranked and sorted once, up front.

import { COMBO_COUNT, COMBO_HI, COMBO_LO } from './cards.ts';
import { BoardState } from './evaluator.ts';
import { Solver, type HandSet, type SolverOptions, type Street } from './solver.ts';
import { buildTwoStreetTree, type TreeConfig } from './tree.ts';

export interface TurnSpot {
  /** Four cards. */
  board: number[];
  ranges: [ArrayLike<number>, ArrayLike<number>];
  /** Pot, stacks and sizes on the turn. The river is offered the same sizes. */
  tree: TreeConfig;
}

/** River cards a hand pair can still see: 52, less the board and both hands. */
export const RIVER_CARDS_LEFT = 44;

function turnHands(board: ArrayLike<number>, range: ArrayLike<number>): HandSet {
  const dead = new Uint8Array(52);
  for (let i = 0; i < board.length; i++) dead[board[i]!] = 1;
  const picked: number[] = [];
  for (let i = 0; i < COMBO_COUNT; i++) {
    if (range[i]! > 0 && !dead[COMBO_HI[i]!] && !dead[COMBO_LO[i]!]) picked.push(i);
  }
  return {
    n: picked.length,
    card1: Uint8Array.from(picked, (combo) => COMBO_HI[combo]!),
    card2: Uint8Array.from(picked, (combo) => COMBO_LO[combo]!),
    strength: new Int32Array(picked.length),
    weight: Float64Array.from(picked, (combo) => range[combo]!),
    label: Int32Array.from(picked),
  };
}

/** The hands still possible once `card` comes, weakest first, with where each came from. */
function riverStreet(hands: HandSet, state: BoardState, card: number): { hands: HandSet; from: Int32Array } {
  const kept: number[] = [];
  const strength = new Int32Array(hands.n);
  for (let h = 0; h < hands.n; h++) {
    if (hands.card1[h] === card || hands.card2[h] === card) continue;
    strength[h] = state.with2(hands.card1[h]!, hands.card2[h]!);
    kept.push(h);
  }
  kept.sort((a, b) => strength[a]! - strength[b]! || a - b);
  return {
    from: Int32Array.from(kept),
    hands: {
      n: kept.length,
      card1: Uint8Array.from(kept, (h) => hands.card1[h]!),
      card2: Uint8Array.from(kept, (h) => hands.card2[h]!),
      strength: Int32Array.from(kept, (h) => strength[h]!),
      weight: Float64Array.from(kept, (h) => hands.weight[h]!),
      label: Int32Array.from(kept, (h) => hands.label[h]!),
    },
  };
}

export function turnSolver(spot: TurnSpot, options: SolverOptions = {}): Solver {
  if (spot.board.length !== 4) throw new Error('A turn board has four cards');
  const hands: [HandSet, HandSet] = [turnHands(spot.board, spot.ranges[0]), turnHands(spot.board, spot.ranges[1])];
  const onBoard = new Set(spot.board);
  const cards: number[] = [];
  for (let c = 0; c < 52; c++) if (!onBoard.has(c)) cards.push(c);

  const streets: Street[] = cards.map((card) => {
    const state = new BoardState(spot.board);
    state.add(card);
    const a = riverStreet(hands[0], state, card);
    const b = riverStreet(hands[1], state, card);
    return { hands: [a.hands, b.hands], from: [a.from, b.from] };
  });

  const tree = buildTwoStreetTree(spot.tree, cards, (pot, stack) => ({ ...spot.tree, pot, stack }));
  return new Solver(tree, hands, { ...options, streets, chanceWeight: 1 / RIVER_CARDS_LEFT });
}
