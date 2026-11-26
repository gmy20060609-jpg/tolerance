// The textbook polarised river game: see src/proof/polar.ts.

import { describe, expect, it } from 'vitest';
import { POLAR_CASES, polarResult, polarSolver } from '../src/proof/polar.ts';

describe.each(POLAR_CASES)('polarised range against a bluff-catcher, bet of $size pot', ({ size, value }) => {
  const solver = polarSolver(size, value);
  solver.iterate(5000);
  const result = polarResult(solver, size, value);

  it('bets every value hand and bluffs in the right ratio', () => {
    expect(result.valueBet.solved).toBeCloseTo(result.valueBet.exact, 3);
    expect(result.bluffRatio.solved).toBeCloseTo(result.bluffRatio.exact, 3);
  });

  it('calls at the minimum defence frequency', () => {
    expect(result.call.solved).toBeCloseTo(result.call.exact, 3);
  });

  it('gives the bettor the closed-form share of the pot', () => {
    expect(result.share.solved).toBeCloseTo(result.share.exact, 4);
  });

  it('cannot be exploited', () => {
    expect(result.exploitability).toBeLessThan(1e-4);
  });
});
