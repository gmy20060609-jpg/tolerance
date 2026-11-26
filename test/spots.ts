// River spots used by the tests and the benchmark.

import { parseCards } from '../src/engine/cards.ts';
import { fullRange, parseRange } from '../src/engine/range.ts';
import type { RiverSpot } from '../src/engine/river.ts';

/** A big blind's calling range against a button open, roughly a third of all hands. */
export const BB_DEFEND =
  '99-22, AJs-A2s, KQs-K2s, QJs-Q4s, JTs-J6s, T9s-T6s, 98s-96s, 87s-85s, 76s-74s, 65s-64s, 54s-53s, 43s, ' +
  'AJo-A4o, KQo-K8o, QJo-Q9o, JTo-J9o, T9o-T8o, 98o, 87o';

/** A button opening range, a little under half of all hands. */
export const BTN_OPEN =
  'AA-22, AKs-A2s, KQs-K2s, QJs-Q3s, JTs-J5s, T9s-T6s, 98s-96s, 87s-85s, 76s-75s, 65s-64s, 54s, 43s, ' +
  'AKo-A2o, KQo-K7o, QJo-Q8o, JTo-J8o, T9o-T8o, 98o, 87o';

/** A single-raised pot that checked down to a dry river, 5.5 big blinds in the middle. */
export const dryRiver: RiverSpot = {
  board: parseCards('Ks 8h 5d 2c Jd'),
  ranges: [parseRange(BB_DEFEND), parseRange(BTN_OPEN)],
  tree: {
    pot: 5.5,
    stack: 97.5,
    bets: [[0.33, 0.75, 1.5], [0.33, 0.75, 1.5]],
    raises: [[0.6, 1.2], [0.6, 1.2]],
    maxRaises: 3,
    allIn: true,
    allInThreshold: 0.67,
  },
};

/** The same ranges after a bet and a call on flop and turn: a larger pot, shallower stacks. */
export const wetRiver: RiverSpot = {
  board: parseCards('Qh Ts 7h 4d 2h'),
  ranges: [parseRange(BB_DEFEND), parseRange(BTN_OPEN)],
  tree: {
    pot: 40,
    stack: 80,
    bets: [[0.33, 0.75], [0.33, 0.75]],
    raises: [[0.75], [0.75]],
    maxRaises: 2,
    allIn: true,
    allInThreshold: 0.67,
  },
};

/** Every possible hand for both players: the largest river spot there is on this tree. */
export const fullRanges: RiverSpot = {
  board: parseCards('Ks 8h 5d 2c Jd'),
  ranges: [fullRange(), fullRange()],
  tree: dryRiver.tree,
};
