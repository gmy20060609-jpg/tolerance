// Heads-up push-or-fold: the small blind moves all-in or folds, the big blind
// calls or folds. Blinds are 0.5 and 1, no ante, and both players start the
// hand with the same stack.
//
// The game is small enough to solve to machine precision in a fraction of a
// second: each player has one decision for each of the 169 starting hands.
// All-in equities come from the exact preflop table, with the hands that
// cannot be dealt together left out.

import { CLASS_COUNT, COMBO_CLASS, COMBO_COUNT, COMBO_HI, COMBO_LO } from './cards.ts';

const N = CLASS_COUNT;

/** Five-card boards left once two hands are dealt: C(48, 5). */
export const BOARDS_PER_MATCHUP = 1712304;

export interface PreflopTable {
  /** wins[i * 169 + j]: boards on which class i beats class j, over all ways to deal both. */
  wins: Uint32Array;
  /** ties[i * 169 + j]: boards on which they split. */
  ties: Uint32Array;
  /** pairs[i * 169 + j]: ways to deal one hand of class i and one of class j without a shared card. */
  pairs: Float64Array;
  /** equity[i * 169 + j]: share of the pot class i expects all-in against class j. */
  equity: Float64Array;
}

export function readPreflopTable(bytes: ArrayBuffer | Uint8Array): PreflopTable {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (raw.byteLength !== 2 * N * N * 4) throw new Error('Not a preflop table');
  const words = new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const wins = words.subarray(0, N * N);
  const ties = words.subarray(N * N);

  const pairs = new Float64Array(N * N);
  for (let x = 0; x < COMBO_COUNT; x++) {
    const xh = COMBO_HI[x]!;
    const xl = COMBO_LO[x]!;
    const row = COMBO_CLASS[x]! * N;
    for (let y = 0; y < COMBO_COUNT; y++) {
      const yh = COMBO_HI[y]!;
      const yl = COMBO_LO[y]!;
      if (xh === yh || xh === yl || xl === yh || xl === yl) continue;
      pairs[row + COMBO_CLASS[y]!]!++;
    }
  }

  const equity = new Float64Array(N * N);
  for (let k = 0; k < N * N; k++) {
    equity[k] = pairs[k]! > 0 ? (wins[k]! + ties[k]! / 2) / (pairs[k]! * BOARDS_PER_MATCHUP) : 0.5;
  }
  return { wins, ties, pairs, equity };
}

export interface PushFoldSolution {
  /** Effective stack in big blinds. */
  stack: number;
  /** How often the small blind moves all-in with each of the 169 hands. */
  push: Float64Array;
  /** How often the big blind calls an all-in with each hand. */
  call: Float64Array;
  /** Share of all hands the small blind pushes and the big blind calls. */
  pushShare: number;
  callShare: number;
  /** What the small blind wins per hand at equilibrium, in big blinds. */
  value: number;
  /**
   * Mean of what each player could gain per hand with a perfect answer to the
   * other's strategy, in big blinds. Zero exactly at equilibrium.
   */
  exploitability: number;
  iterations: number;
  /**
   * For each hand: big blinds gained by pushing instead of folding, and by
   * calling instead of folding, against the other player's strategy.
   */
  pushEdge: Float64Array;
  callEdge: Float64Array;
}

export interface PushFoldOptions {
  /** Stop once exploitability is below this many big blinds per hand. */
  target?: number;
  maxIterations?: number;
  /** Called every `reportEvery` iterations with the exploitability reached. */
  onProgress?: (iteration: number, exploitability: number) => void;
  reportEvery?: number;
}

const DEALS = COMBO_COUNT * 1225; // ordered pairs of hands that share no card

export function solvePushFold(table: PreflopTable, stack: number, options: PushFoldOptions = {}): PushFoldSolution {
  if (!(stack >= 1)) throw new Error('The stack must be at least one big blind');
  const target = options.target ?? 1e-7;
  const maxIterations = options.maxIterations ?? 20000;
  const reportEvery = options.reportEvery ?? 50;

  // prior[i]: chance the small blind holds class i. Symmetric for the big blind.
  // gain[i * N + j]: chance of the deal times what the small blind gains when a
  // push is called instead of folded to: S * (2 * equity - 1) - 1.
  const prior = new Float64Array(N);
  const gain = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const p = table.pairs[i * N + j]! / DEALS;
      prior[i]! += p;
      gain[i * N + j] = p * (stack * (2 * table.equity[i * N + j]! - 1) - 1);
    }
  }

  // Each hand keeps a regret for both of its actions.
  const pushRegret = new Float64Array(N);
  const foldRegretSb = new Float64Array(N);
  const callRegret = new Float64Array(N);
  const foldRegretBb = new Float64Array(N);
  const push = new Float64Array(N).fill(0.5);
  const call = new Float64Array(N).fill(0.5);
  const pushSum = new Float64Array(N);
  const callSum = new Float64Array(N);
  let weightSum = 0;
  const pushEdge = new Float64Array(N);
  const callEdge = new Float64Array(N);
  const avgPush = new Float64Array(N);
  const avgCall = new Float64Array(N);

  /** Small blind's gain from pushing over folding with each hand, times the hand's prior. */
  const pushEdges = (callStrategy: Float64Array, out: Float64Array) => {
    for (let i = 0; i < N; i++) {
      let sum = 1.5 * prior[i]!; // +1 when the big blind folds, against -0.5 for folding
      const row = i * N;
      for (let j = 0; j < N; j++) sum += callStrategy[j]! * gain[row + j]!;
      out[i] = sum;
    }
  };
  /** Big blind's gain from calling over folding with each hand, times the chance of the deal. */
  const callEdges = (pushStrategy: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let i = 0; i < N; i++) {
      const p = pushStrategy[i]!;
      if (p === 0) continue;
      const row = i * N;
      for (let j = 0; j < N; j++) out[j]! -= p * gain[row + j]!;
    }
  };

  const measure = (): number => {
    const inv = weightSum > 0 ? 1 / weightSum : 0;
    for (let i = 0; i < N; i++) {
      avgPush[i] = weightSum > 0 ? pushSum[i]! * inv : 0.5;
      avgCall[i] = weightSum > 0 ? callSum[i]! * inv : 0.5;
    }
    pushEdges(avgCall, pushEdge);
    callEdges(avgPush, callEdge);
    // Best answers, measured from the same baseline: the small blind always
    // folding (-0.5 a hand) and the big blind folding to every push.
    let sbBest = -0.5;
    let bbBest = 0.5;
    for (let i = 0; i < N; i++) {
      if (pushEdge[i]! > 0) sbBest += pushEdge[i]!;
      bbBest -= 1.5 * prior[i]! * avgPush[i]!;
      if (callEdge[i]! > 0) bbBest += callEdge[i]!;
    }
    return (sbBest + bbBest) / 2;
  };

  let iterations = 0;
  let exploitability = Infinity;
  const edge = new Float64Array(N);
  while (iterations < maxIterations) {
    const t = iterations;
    const ta = Math.pow(t, 1.5);
    const pos = ta / (ta + 1);
    const neg = 0.5;
    const keep = Math.pow(t / (t + 1), 2);

    // Small blind.
    pushEdges(call, edge);
    for (let i = 0; i < N; i++) {
      const value = push[i]! * edge[i]!; // value of the mixed strategy over always folding
      const rp = pushRegret[i]!;
      const rf = foldRegretSb[i]!;
      pushRegret[i] = rp * (rp > 0 ? pos : neg) + edge[i]! - value;
      foldRegretSb[i] = rf * (rf > 0 ? pos : neg) - value;
    }
    // Big blind, against the small blind's updated strategy.
    for (let i = 0; i < N; i++) {
      const a = pushRegret[i]! > 0 ? pushRegret[i]! : 0;
      const b = foldRegretSb[i]! > 0 ? foldRegretSb[i]! : 0;
      push[i] = a + b > 0 ? a / (a + b) : 0.5;
    }
    callEdges(push, edge);
    for (let j = 0; j < N; j++) {
      const value = call[j]! * edge[j]!;
      const rc = callRegret[j]!;
      const rf = foldRegretBb[j]!;
      callRegret[j] = rc * (rc > 0 ? pos : neg) + edge[j]! - value;
      foldRegretBb[j] = rf * (rf > 0 ? pos : neg) - value;
    }
    for (let j = 0; j < N; j++) {
      const a = callRegret[j]! > 0 ? callRegret[j]! : 0;
      const b = foldRegretBb[j]! > 0 ? foldRegretBb[j]! : 0;
      call[j] = a + b > 0 ? a / (a + b) : 0.5;
    }

    weightSum = weightSum * keep + 1;
    for (let i = 0; i < N; i++) {
      pushSum[i] = pushSum[i]! * keep + push[i]!;
      callSum[i] = callSum[i]! * keep + call[i]!;
    }
    iterations++;

    if (iterations % reportEvery === 0 || iterations === maxIterations) {
      exploitability = measure();
      options.onProgress?.(iterations, exploitability);
      if (exploitability <= target) break;
    }
  }
  exploitability = measure();

  // Results per hand, with the priors divided back out.
  let pushShare = 0;
  let callShare = 0;
  let value = -0.5;
  for (let i = 0; i < N; i++) {
    pushShare += prior[i]! * avgPush[i]!;
    callShare += prior[i]! * avgCall[i]!;
    value += avgPush[i]! * pushEdge[i]!;
  }
  const facing = new Float64Array(N); // chance of the deal and a push, per big-blind hand
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) facing[j]! += (table.pairs[i * N + j]! / DEALS) * avgPush[i]!;
  }
  const pushGain = new Float64Array(N);
  const callGain = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    pushGain[i] = pushEdge[i]! / prior[i]!;
    callGain[i] = facing[i]! > 0 ? callEdge[i]! / facing[i]! : 0;
  }

  return {
    stack,
    push: avgPush.slice(),
    call: avgCall.slice(),
    pushShare,
    callShare,
    value,
    exploitability,
    iterations,
    pushEdge: pushGain,
    callEdge: callGain,
  };
}
