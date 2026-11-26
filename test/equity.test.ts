// Equity is counted three ways that share as little code as possible:
//   1. one hand against one hand, every board dealt in turn,
//   2. range against range, with all hands ranked once per board,
//   3. the preflop class table, counted over boards up to suit relabelling.
// The tests require the three to agree exactly.

import { describe, expect, it } from 'vitest';
import { COMBO_CLASS, COMBO_COUNT, COMBO_HI, COMBO_LO, classFromName, parseCards } from '../src/engine/cards.ts';
import { handVsHand, rangeVsRange } from '../src/engine/equity.ts';
import { BOARDS_PER_MATCHUP } from '../src/engine/pushfold.ts';
import { parseRange } from '../src/engine/range.ts';
import { preflopTable } from './table.ts';

const combosOf = (name: string): number[] => {
  const cls = classFromName(name);
  const out: number[] = [];
  for (let i = 0; i < COMBO_COUNT; i++) if (COMBO_CLASS[i] === cls) out.push(i);
  return out;
};
const cardsOf = (combo: number): [number, number] => [COMBO_HI[combo]!, COMBO_LO[combo]!];
const shares = (x: number, y: number) => {
  const [a, b] = cardsOf(x);
  const [c, d] = cardsOf(y);
  return a === c || a === d || b === c || b === d;
};

describe('one hand against another', () => {
  it('deals all 1,712,304 boards before the flop', () => {
    const result = handVsHand(parseCards('As Ah'), parseCards('Kd Kc'));
    expect(result.total).toBe(BOARDS_PER_MATCHUP);
    expect(result.win + result.tie + result.lose).toBe(result.total);
  });

  it('mirrors when the hands are swapped', () => {
    const forward = handVsHand(parseCards('Ah Kh'), parseCards('Qs Qd'));
    const back = handVsHand(parseCards('Qs Qd'), parseCards('Ah Kh'));
    expect([forward.win, forward.tie, forward.lose]).toEqual([back.lose, back.tie, back.win]);
  });

  it('counts the outs on the turn by hand', () => {
    // A flush draw with two overcards against top pair: nine hearts, three
    // aces and three kings win, minus none shared. 15 of 44 rivers.
    const result = handVsHand(parseCards('Ah Kh'), parseCards('Qs Jd'), parseCards('Qh 7h 2c 3d'));
    expect(result.total).toBe(44);
    expect(result.win).toBe(15);
    expect(result.tie).toBe(0);
  });
});

describe('the preflop table', () => {
  const table = preflopTable();

  it.each([
    ['AA', 'KK'],
    ['AKs', 'QQ'],
    ['72o', '72o'],
  ])('matches board-by-board counting for %s against %s', (first, second) => {
    const i = classFromName(first);
    const j = classFromName(second);
    let wins = 0;
    let ties = 0;
    let pairs = 0;
    for (const x of combosOf(first)) {
      for (const y of combosOf(second)) {
        if (shares(x, y)) continue;
        const result = handVsHand(cardsOf(x), cardsOf(y));
        wins += result.win;
        ties += result.tie;
        pairs++;
      }
    }
    expect(table.pairs[i * 169 + j]).toBe(pairs);
    expect(table.wins[i * 169 + j]).toBe(wins);
    expect(table.ties[i * 169 + j]).toBe(ties);
  }, 120_000);

  it('accounts for every board of every pair of classes', () => {
    for (let i = 0; i < 169; i++) {
      for (let j = 0; j < 169; j++) {
        const total = table.wins[i * 169 + j]! + table.wins[j * 169 + i]! + table.ties[i * 169 + j]!;
        expect(total).toBe(table.pairs[i * 169 + j]! * BOARDS_PER_MATCHUP);
      }
    }
  });
});

describe('range against range', () => {
  it.each([
    { board: 'Ks 8h 5d', a: 'AKs, 88, 76s, QJs:0.5', b: 'QQ, AKo:0.5, 87s, 55' },
    { board: 'Ks 8h 5d 2c', a: 'AKs, 88, 76s, QJs:0.5', b: 'QQ, AKo:0.5, 87s, 55' },
    { board: 'Ks 8h 5d 2c Jd', a: 'AKs, 88, 76s, QJs:0.5', b: 'QQ, AKo:0.5, 87s, 55, KJs' },
  ])('matches hand-by-hand counting on $board', ({ board, a, b }) => {
    const cards = parseCards(board);
    const first = parseRange(a);
    const second = parseRange(b);
    const fast = rangeVsRange(first, second, cards);

    let won = 0;
    let weight = 0;
    for (let x = 0; x < COMBO_COUNT; x++) {
      if (!first[x] || cardsOf(x).some((c) => cards.includes(c))) continue;
      let wonByHand = 0;
      let weightByHand = 0;
      for (let y = 0; y < COMBO_COUNT; y++) {
        if (!second[y] || shares(x, y) || cardsOf(y).some((c) => cards.includes(c))) continue;
        const result = handVsHand(cardsOf(x), cardsOf(y), cards);
        wonByHand += second[y]! * result.equity;
        weightByHand += second[y]!;
      }
      expect(fast.byCombo[0][x]).toBeCloseTo(wonByHand / weightByHand, 12);
      won += first[x]! * wonByHand;
      weight += first[x]! * weightByHand;
    }
    expect(fast.equity[0]).toBeCloseTo(won / weight, 12);
    expect(fast.equity[0] + fast.equity[1]).toBeCloseTo(1, 12);
  });
});
