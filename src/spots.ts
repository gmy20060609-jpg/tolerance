// River spots: the one the site opens on, two everyday ones, and the three
// the tests and the benchmark use.

import { COMBO_COUNT, COMBO_HI, COMBO_LO, parseCards, suitOf } from './engine/cards.ts';
import { emptyRange, fullRange, parseRange, type Range } from './engine/range.ts';
import type { RiverSpot } from './engine/river.ts';
import type { TreeConfig } from './engine/tree.ts';

/** A big blind's calling range against a button open, roughly a third of all hands. */
export const BB_DEFEND =
  '99-22, AJs-A2s, KQs-K2s, QJs-Q4s, JTs-J6s, T9s-T6s, 98s-96s, 87s-85s, 76s-74s, 65s-64s, 54s-53s, 43s, ' +
  'AJo-A4o, KQo-K8o, QJo-Q9o, JTo-J9o, T9o-T8o, 98o, 87o';

/** A button opening range, a little under half of all hands. */
export const BTN_OPEN =
  'AA-22, AKs-A2s, KQs-K2s, QJs-Q3s, JTs-J5s, T9s-T6s, 98s-96s, 87s-85s, 76s-75s, 65s-64s, 54s, 43s, ' +
  'AKo-A2o, KQo-K7o, QJo-Q8o, JTo-J8o, T9o-T8o, 98o, 87o';

const deepTree: TreeConfig = {
  pot: 5.5,
  stack: 97.5,
  bets: [[0.33, 0.75, 1.5], [0.33, 0.75, 1.5]],
  raises: [[0.6, 1.2], [0.6, 1.2]],
  maxRaises: 3,
  allIn: true,
  allInThreshold: 0.67,
};

/** A single-raised pot that checked down to a dry river, 5.5 big blinds in the middle. */
export const dryRiver: RiverSpot = {
  board: parseCards('Ks 8h 5d 2c Jd'),
  ranges: [parseRange(BB_DEFEND), parseRange(BTN_OPEN)],
  tree: deepTree,
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
  tree: deepTree,
};

// --- The 2003 hand -----------------------------------------------------------
// World Series of Poker Main Event, 2003, heads-up for the title. Chris
// Moneymaker, on the button with K♠7♥, raised to 100,000; Sam Farha called
// with Q♠9♥. Flop 9♠ 2♦ 6♠, check, check. Turn 8♠: Farha bet 300,000 into
// 210,000, Moneymaker raised to 800,000, Farha called. River 3♥: Farha
// checked, Moneymaker moved all-in, Farha folded.
//
// Blinds 20,000/40,000 with a 5,000 ante; stacks 4.6 million and 3.7 million
// at the start of the hand. That leaves 1,810,000 in the pot on the river and
// 2,795,000 behind for Farha, the shorter stack.
// Source: PokerNews, "Analyzing Moneymaker's 'Bluff of the Century' Against
// Farha", 26 August 2019.
//
// Nobody knows the ranges. The ones below are our reading of the line each
// player took, written out so they can be argued with and edited.

const SPADE = 3;
type Suits = 'any' | 'flush' | 'one' | 'none';

function build(parts: [classes: string, suits: Suits, weight: number][]): Range {
  const range = emptyRange();
  for (const [classes, suits, weight] of parts) {
    const picked = parseRange(classes);
    for (let i = 0; i < COMBO_COUNT; i++) {
      if (!picked[i]) continue;
      const spades = (suitOf(COMBO_HI[i]!) === SPADE ? 1 : 0) + (suitOf(COMBO_LO[i]!) === SPADE ? 1 : 0);
      if (suits === 'flush' && spades !== 2) continue;
      if (suits === 'one' && spades !== 1) continue;
      if (suits === 'none' && spades !== 0) continue;
      range[i] = Math.max(range[i]!, weight);
    }
  }
  return range;
}

const ALL_SUITED =
  'AKs-A2s, KQs-K2s, QJs-Q2s, JTs-J2s, T9s-T2s, 98s-92s, 87s-82s, 76s-72s, 65s-62s, 54s-52s, 43s-42s, 32s';

/** Farha: led the turn for more than the pot, then called a raise. */
const farha = build([
  [ALL_SUITED, 'flush', 1],
  ['T7s, T7o, 75s, 75o', 'any', 1],
  ['66, 22', 'any', 1],
  ['98s, 98o, 96s, 96o, 86s, 86o', 'any', 1],
  ['A9s, A9o, K9s, K9o, Q9s, Q9o, J9s, J9o, T9s, T9o, 97s, 97o', 'one', 1],
  ['A9s, A9o, K9s, K9o, Q9s, Q9o, J9s, J9o', 'none', 0.5],
  ['A8s, A8o, K8s, K8o', 'one', 0.5],
  ['AKs, AKo, AQs, AQo, AJs, AJo, ATs, ATo, A7s, A7o, A5s, A5o, KQs, KQo, KJs, KJo, KTs, KTo', 'one', 0.5],
]);

/** Moneymaker: checked the flop behind, then raised the turn. */
const moneymaker = build([
  [ALL_SUITED, 'flush', 0.6],
  ['T7s, T7o, 75s, 75o', 'any', 1],
  ['88', 'any', 1],
  ['99, 66, 22', 'any', 0.5],
  ['98s, 98o, 96s, 96o, 86s, 86o', 'any', 1],
  ['A9s, A9o, K9s, K9o, Q9s, Q9o, J9s, J9o, T9s, T9o', 'one', 0.5],
  ['A7s, A7o, K7s, K7o, Q7s, Q7o, J7s, J7o', 'one', 1],
  ['ATs, ATo, KTs, KTo, QTs, QTo, JTs, JTo', 'one', 1],
  ['AKs, AKo, AQs, AQo, AJs, AJo, KQs, KQo, KJs, KJo, QJs, QJo', 'one', 1],
  ['A5s, A5o, A4s, A4o, A3s, A3o, 54s, 54o', 'one', 0.5],
]);

export const moneymakerFarha: RiverSpot = {
  board: parseCards('9s 2d 6s 8s 3h'),
  ranges: [farha, moneymaker],
  tree: {
    pot: 1_810_000,
    stack: 2_795_000,
    bets: [[0.33, 0.75], [0.33, 0.75]],
    raises: [[1], [1]],
    maxRaises: 2,
    allIn: true,
    allInThreshold: 0.67,
  },
};

// --- Presets shown in the interface --------------------------------------------

export interface Pin {
  /** Actions taken to reach the decision, as indices into each node's action list by kind. */
  path: string[];
  /** The exact two cards held. */
  cards: string;
  /** What the player actually did, as an action kind. */
  did: string;
  who: string;
}

export interface Preset {
  id: string;
  title: string;
  titleZh: string;
  /** One line on where the spot comes from. */
  line: string;
  lineZh: string;
  players: [string, string];
  unit: 'chips' | 'bb';
  spot: RiverSpot;
  pins: Pin[];
}

export const PRESETS: Preset[] = [
  {
    id: 'moneymaker-farha',
    title: 'Moneymaker v Farha, 2003',
    titleZh: '2003 年世界扑克大赛决赛单挑',
    line: 'World Series of Poker Main Event, 2003, heads-up for the title. Farha checks the river; Moneymaker moves all-in with king high; Farha folds top pair.',
    lineZh: '2003 年世界扑克大赛主赛事决赛单挑。河牌 Farha 过牌，Moneymaker 拿 K 高牌全下，Farha 弃掉顶对。',
    players: ['Farha', 'Moneymaker'],
    unit: 'chips',
    spot: moneymakerFarha,
    pins: [
      { path: ['check'], cards: 'Ks7h', did: 'allin', who: 'Moneymaker' },
      { path: ['check', 'allin'], cards: 'Qs9h', did: 'fold', who: 'Farha' },
    ],
  },
  {
    id: 'button-big-blind',
    title: 'Button v big blind, dry river',
    titleZh: '按钮位对大盲，干燥河牌',
    line: 'A single-raised pot checked down to the river, 100 big blinds deep. Three bet sizes and two raise sizes each.',
    lineZh: '单次加注底池一路过牌到河牌，100 个大盲深。双方各三个下注尺寸、两个加注尺寸。',
    players: ['Big blind', 'Button'],
    unit: 'bb',
    spot: dryRiver,
    pins: [],
  },
  {
    id: 'flush-river',
    title: 'Button v big blind, flush river',
    titleZh: '按钮位对大盲，同花河牌',
    line: 'The third heart lands after a bet and a call on flop and turn. 40 big blinds in the pot, 80 behind.',
    lineZh: '翻牌、转牌各一次下注跟注后，河牌发出第三张红桃。底池 40 个大盲，后手 80。',
    players: ['Big blind', 'Button'],
    unit: 'bb',
    spot: wetRiver,
    pins: [],
  },
];
