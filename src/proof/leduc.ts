// Leduc hold'em written for the two-street solver.
//
// Six cards: jack, queen and king in two suits. Each player antes one chip
// and is dealt one card. A round of betting follows, then one public card,
// then a second round. Bets are 2 chips in the first round and 4 in the
// second, with at most one bet and one raise a round. A hand that pairs the
// public card wins; otherwise the higher card does.
//
// The first player's value at equilibrium is -0.0856 (Southey et al., "Bayes'
// Bluff: Opponent Modelling in Poker", UAI 2005, introduced the game; the
// value is the one reported throughout the CFR literature).

import { Solver, type HandSet, type Street } from '../engine/solver.ts';
import { buildTwoStreetTree, type TreeConfig } from '../engine/tree.ts';

export const LEDUC_VALUE = -0.0856;

const rankOf = (card: number) => card >> 1;

/** One-card hands. Each also gets a private filler id so the solver has two ids per hand. */
function cardsHeld(cards: number[], filler: number, strengths: number[]): HandSet {
  return {
    n: cards.length,
    card1: Uint8Array.from(cards),
    card2: Uint8Array.from(cards, (card) => filler + card),
    strength: Int32Array.from(strengths),
    weight: Float64Array.from(cards, () => 1),
    label: Int32Array.from(cards),
  };
}

export function leducSolver(): Solver {
  const deck = [0, 1, 2, 3, 4, 5];
  const hands: [HandSet, HandSet] = [cardsHeld(deck, 10, deck.map(() => 0)), cardsHeld(deck, 20, deck.map(() => 0))];

  const streets: Street[] = deck.map((shown) => {
    const left = deck
      .filter((card) => card !== shown)
      .map((card) => ({ card, strength: rankOf(card) === rankOf(shown) ? 10 : rankOf(card) }))
      .sort((a, b) => a.strength - b.strength || a.card - b.card);
    const cards = left.map((x) => x.card);
    const strengths = left.map((x) => x.strength);
    return {
      hands: [cardsHeld(cards, 10, strengths), cardsHeld(cards, 20, strengths)],
      from: [Int32Array.from(cards), Int32Array.from(cards)],
    };
  });

  // Sizes are shares of the pot here, so the fixed bets are written as shares.
  const limit = (pot: number, bet: number): TreeConfig => ({
    pot,
    stack: 1000,
    bets: [[bet / pot], [bet / pot]],
    raises: [[bet / (pot + 2 * bet)], [bet / (pot + 2 * bet)]],
    maxRaises: 1,
    allIn: false,
    allInThreshold: 1,
  });
  const tree = buildTwoStreetTree(limit(2, 2), deck, (pot) => limit(pot, 4));
  // Four cards are left for the public card once both hands are dealt.
  return new Solver(tree, hands, { streets, chanceWeight: 1 / 4 });
}
