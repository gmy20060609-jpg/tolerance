// The evaluator is checked against the published counts of every hand
// category among all five-card and all seven-card hands.
// Source: https://en.wikipedia.org/wiki/Poker_probability

import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/engine/cards.ts';
import { BoardState, categoryOf, evaluate } from '../src/engine/evaluator.ts';

const hand = (text: string) => evaluate(parseCards(text));

describe('hand evaluator', () => {
  it('counts every category among the 2,598,960 five-card hands', () => {
    const counts = new Array(9).fill(0);
    const distinct = new Set<number>();
    const cards = new Uint8Array(5);
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++)
            for (let e = d + 1; e < 52; e++) {
              cards[0] = a; cards[1] = b; cards[2] = c; cards[3] = d; cards[4] = e;
              const value = evaluate(cards);
              counts[categoryOf(value)]++;
              distinct.add(value);
            }
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
    // There are 7,462 distinct five-card hand ranks.
    expect(distinct.size).toBe(7462);
  });

  it('counts every category among the 133,784,560 seven-card hands', () => {
    const counts = new Array(9).fill(0);
    const five = new Uint8Array(5);
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++)
            for (let e = d + 1; e < 52; e++) {
              five[0] = a; five[1] = b; five[2] = c; five[3] = d; five[4] = e;
              const board = new BoardState(five);
              for (let f = e + 1; f < 52; f++)
                for (let g = f + 1; g < 52; g++) counts[categoryOf(board.with2(f, g))]++;
            }
    expect(counts).toEqual([23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584]);
  }, 120_000);

  it('orders hands inside a category', () => {
    expect(hand('As Ks Qs Js Ts')).toBeGreaterThan(hand('Ks Qs Js Ts 9s'));
    expect(hand('5s 4s 3s 2s As')).toBeLessThan(hand('6s 5s 4s 3s 2s'));
    expect(hand('5c 4d 3h 2s Ad')).toBeLessThan(hand('6c 5d 4h 3s 2d'));
    expect(hand('Ac Ad Ah As 2c')).toBeLessThan(hand('Ac Ad Ah As 3c'));
    expect(hand('Kc Kd Kh 2s 2c')).toBeGreaterThan(hand('Qc Qd Qh As Ac'));
    expect(hand('Ac Ad Kh Ks 2c')).toBeGreaterThan(hand('Ac Ad Qh Qs Kc'));
    expect(hand('Ac Ad Kh Qs 2c')).toBeGreaterThan(hand('Ac Ad Kh Js Tc'));
    expect(hand('Ac Kd Qh Js 9c')).toBeGreaterThan(hand('Ac Kd Qh Ts 9c'));
    expect(hand('Ac Kd Qh Js 9c')).toBe(hand('Ad Kh Qs Jc 9d'));
  });

  it('picks the best five of seven', () => {
    // Three pairs: the third pair only supplies a kicker.
    expect(hand('Ac Ad Kh Ks Qc Qd 2s')).toBe(hand('Ac Ad Kh Ks Qc'));
    // Two sets make a full house.
    expect(hand('Ac Ad Ah Ks Kc Kd 2s')).toBe(hand('Ac Ad Ah Ks Kc'));
    // A straight beats the set it contains.
    expect(hand('9c 9d 9h Ts Jc Qd Ks')).toBe(hand('9c Ts Jc Qd Ks'));
    // The board plays.
    expect(hand('Ac Kd Qh Js Tc 2d 3s')).toBe(hand('Ad Kh Qs Jc Td 4c 5c'));
  });
});
