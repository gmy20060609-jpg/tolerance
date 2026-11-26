// Push-or-fold equilibrium, checked against the chart published by
// HoldemResources.net (see test/reference/hune.ts).
//
// The published chart gives one number per hand: the largest stack at which
// the hand is played. The equilibrium itself is not always that simple. Near
// its limit a hand is often exactly indifferent and is played part of the
// time over a span of stack sizes. The comparison therefore uses two rules:
//   1. the largest stack at which a hand is played at least half the time must
//      be within 0.1 big blinds of the published number, with any exception
//      named below;
//   2. every published number, without exception, must lie within 0.1 big
//      blinds of the span between the last stack where the hand is always
//      played and the last stack where it is played at all.

import { describe, expect, it } from 'vitest';
import { CLASS_NAMES } from '../src/engine/cards.ts';
import { solvePushFold } from '../src/engine/pushfold.ts';
import { CALLER, PUSHER, PUSHER_SPANS, readChart } from './reference/hune.ts';
import { preflopTable } from './table.ts';

const table = preflopTable();
const TOLERANCE = 0.1 + 1e-9;

// Every stack from 1 to 20.5 big blinds in steps of 0.05.
const STEP = 0.05;
const stacks: number[] = [];
for (let k = Math.round(1 / STEP); k <= Math.round(20.5 / STEP); k++) stacks.push(k * STEP);
const solutions = stacks.map((stack) => solvePushFold(table, stack, { target: 1e-7 }));

/** The largest stack at which the hand's frequency passes the test. */
function lastStack(hand: number, side: 'push' | 'call', test: (frequency: number) => boolean): number {
  let last = 0;
  solutions.forEach((solution, k) => {
    if (test(solution[side][hand]!)) last = stacks[k]!;
  });
  return last;
}

describe('push-or-fold equilibrium', () => {
  it('solves every stack size to within a ten-millionth of a big blind', () => {
    for (const solution of solutions) expect(solution.exploitability).toBeLessThan(1e-7);
  });

  it.each([
    // Q4o: published as 7.9. Solved: always pushed up to 7.9, then pushed part
    // of the time, as an indifferent hand, up to 8.3.
    { side: 'push' as const, chart: PUSHER, exceptions: ['Q4o'] },
    { side: 'call' as const, chart: CALLER, exceptions: [] },
  ])('matches the published $side chart', ({ side, chart, exceptions }) => {
    const published = readChart(chart);
    const beyondTolerance: string[] = [];
    const outsideSpan: string[] = [];
    for (let hand = 0; hand < 169; hand++) {
      const want = published[hand]!;
      if (Number.isNaN(want)) continue; // the three split hands are checked below
      const half = lastStack(hand, side, (f) => f >= 0.5);
      const always = lastStack(hand, side, (f) => f > 0.999);
      const ever = lastStack(hand, side, (f) => f > 0.001);
      if (want === Infinity) {
        // Published as played at every stack up to 20 big blinds.
        if (ever < 20 - TOLERANCE) outsideSpan.push(CLASS_NAMES[hand]!);
        continue;
      }
      if (Math.abs(half - want) > TOLERANCE) beyondTolerance.push(CLASS_NAMES[hand]!);
      if (want < always - TOLERANCE || want > ever + TOLERANCE) outsideSpan.push(CLASS_NAMES[hand]!);
    }
    expect(beyondTolerance).toEqual(exceptions);
    expect(outsideSpan).toEqual([]);
  });

  it('finds the three suited hands that are pushed over two separate spans', () => {
    for (const [name, want] of Object.entries(PUSHER_SPANS)) {
      const hand = CLASS_NAMES.indexOf(name);
      const played = solutions.map((solution) => solution.push[hand]! >= 0.5);
      const firstGap = played.indexOf(false);
      const lowTop = stacks[firstGap - 1]!;
      const upperBottom = stacks[played.indexOf(true, firstGap)]!;
      const upperTop = stacks[played.lastIndexOf(true)]!;
      expect(Math.abs(lowTop - want.low), `${name} low span`).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(upperBottom - want.from), `${name} upper span, bottom`).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(upperTop - want.to), `${name} upper span, top`).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it('gives the big blind every hand when a call is free', () => {
    // With one big blind in play the big blind is already all-in.
    const solution = solvePushFold(table, 1);
    expect(solution.callShare).toBeCloseTo(1, 9);
  });
});
