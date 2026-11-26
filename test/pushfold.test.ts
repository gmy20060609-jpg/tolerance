// Push-or-fold equilibrium, checked against the chart published by
// HoldemResources.net (see src/proof/hune.ts).
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
import { solvePushFold } from '../src/engine/pushfold.ts';
import { compareChart, compareSpans, sweepStacks } from '../src/proof/hune.ts';
import { preflopTable } from './table.ts';

const table = preflopTable();

// Every stack from 1 to 20.5 big blinds in steps of 0.05.
const stacks = sweepStacks();
const solutions = stacks.map((stack) => solvePushFold(table, stack, { target: 1e-7 }));

describe('push-or-fold equilibrium', () => {
  it('solves every stack size to within a ten-millionth of a big blind', () => {
    for (const solution of solutions) expect(solution.exploitability).toBeLessThan(1e-7);
  });

  it.each([
    // Q4o: published as 7.9. Solved: always pushed up to 7.9, then pushed part
    // of the time, as an indifferent hand, up to 8.3.
    { side: 'push' as const, exceptions: ['Q4o'], cells: 166 },
    { side: 'call' as const, exceptions: [], cells: 169 },
  ])('matches the published $side chart', ({ side, exceptions, cells }) => {
    const result = compareChart(side, stacks, solutions);
    expect(result.beyond.map((entry) => entry.hand)).toEqual(exceptions);
    expect(result.outsideSpan).toEqual([]);
    expect(result.always + result.within005 + result.within010 + result.beyond.length).toBe(cells);
  });

  it('finds the three suited hands that are pushed over two separate spans', () => {
    const rows = compareSpans(stacks, solutions);
    expect(rows.length).toBe(9);
    for (const row of rows) expect(row.ok, `${row.hand} ${row.boundary}`).toBe(true);
  });

  it('gives the big blind every hand when a call is free', () => {
    // With one big blind in play the big blind is already all-in.
    const solution = solvePushFold(table, 1);
    expect(solution.callShare).toBeCloseTo(1, 9);
  });
});
