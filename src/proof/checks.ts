// The checks behind every claim, in a form that can run in a browser tab and
// report as it goes. The test suite asserts the same things with the same code.

import { CLASS_NAMES, COMBO_CLASS, COMBO_COUNT, COMBO_HI, COMBO_LO, classFromName } from '../engine/cards.ts';
import { handVsHand } from '../engine/equity.ts';
import { BoardState, CATEGORY_NAMES, categoryOf } from '../engine/evaluator.ts';
import { solvePushFold, type PreflopTable, type PushFoldSolution } from '../engine/pushfold.ts';
import { riverSolver } from '../engine/river.ts';
import { wetRiver } from '../spots.ts';
import type { ProofUpdate } from '../worker/protocol.ts';
import { compareChart, compareSpans, sweepStacks } from './hune.ts';
import { kuhnSolver } from './kuhn.ts';
import { referenceExploitability } from './pairwise.ts';
import { POLAR_CASES, polarResult, polarSolver } from './polar.ts';

type Emit = (update: ProofUpdate) => void;
type Row = ProofUpdate['rows'][number];

const int = (n: number) => n.toLocaleString('en-US');

/** Published counts of each category among all seven-card hands, weakest category first. */
export const SEVEN_CARD_COUNTS = [23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584];

async function evaluator(emit: Emit, breathe: () => Promise<void>): Promise<void> {
  const counts = new Array<number>(9).fill(0);
  const five = new Uint8Array(5);
  const rows = (done: boolean): Row[] =>
    CATEGORY_NAMES.map((name, i) => ({
      label: name,
      expected: int(SEVEN_CARD_COUNTS[i]!),
      measured: int(counts[i]!),
      ok: done ? counts[i] === SEVEN_CARD_COUNTS[i] : null,
    })).reverse();
  let dealt = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++)
      for (let c = b + 1; c < 52; c++)
        for (let d = c + 1; d < 52; d++)
          for (let e = d + 1; e < 52; e++) {
            five[0] = a; five[1] = b; five[2] = c; five[3] = d; five[4] = e;
            const board = new BoardState(five);
            for (let f = e + 1; f < 52; f++)
              for (let g = f + 1; g < 52; g++) {
                counts[categoryOf(board.with2(f, g))]!++;
                dealt++;
              }
          }
    emit({ rows: rows(false), progress: dealt / 133784560, done: false, note: `${int(dealt)} hands ranked` });
    await breathe();
  }
  emit({ rows: rows(true), progress: 1, done: true, note: `${int(dealt)} hands ranked` });
}

async function kuhn(emit: Emit, breathe: () => Promise<void>): Promise<void> {
  const solver = kuhnSolver();
  const root = solver.tree.nodes[0]!;
  const rows = (done: boolean): Row[] => {
    const afterCheck = solver.averageStrategy(root.children[0]!);
    const facingBet = solver.averageStrategy(root.children[1]!);
    const value = solver.gameValue(0);
    return [
      { label: 'Value to the first player', expected: (-1 / 18).toFixed(7).replace('-', '−'), measured: value.toFixed(7).replace('-', '−'), ok: done ? Math.abs(value + 1 / 18) < 1e-5 : null },
      { label: 'Second player bluffs the jack', expected: (1 / 3).toFixed(4), measured: afterCheck[3]!.toFixed(4), ok: done ? Math.abs(afterCheck[3]! - 1 / 3) < 1e-3 : null },
      { label: 'Second player calls with the queen', expected: (1 / 3).toFixed(4), measured: facingBet[4]!.toFixed(4), ok: done ? Math.abs(facingBet[4]! - 1 / 3) < 1e-3 : null },
      { label: 'Exploitability, antes', expected: 'below 0.0001', measured: solver.exploitability().toFixed(7), ok: done ? solver.exploitability() < 1e-4 : null },
    ];
  };
  for (const target of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    solver.iterate(target - solver.iteration);
    emit({ rows: rows(false), progress: target / 20000, done: false, note: `${int(target)} iterations` });
    await breathe();
  }
  emit({ rows: rows(true), progress: 1, done: true, note: '20,000 iterations' });
}

async function polar(emit: Emit, breathe: () => Promise<void>): Promise<void> {
  const rows: Row[] = [];
  for (const [index, { size, value }] of POLAR_CASES.entries()) {
    const solver = polarSolver(size, value);
    solver.iterate(5000);
    const r = polarResult(solver, size, value);
    const name = `Bet ${size} pot`;
    rows.push(
      { label: `${name}: bluffs per value bet`, expected: r.bluffRatio.exact.toFixed(4), measured: r.bluffRatio.solved.toFixed(4), ok: Math.abs(r.bluffRatio.solved - r.bluffRatio.exact) < 1e-3 },
      { label: `${name}: calling frequency`, expected: r.call.exact.toFixed(4), measured: r.call.solved.toFixed(4), ok: Math.abs(r.call.solved - r.call.exact) < 1e-3 },
      { label: `${name}: bettor's share of the pot`, expected: r.share.exact.toFixed(4), measured: r.share.solved.toFixed(4), ok: Math.abs(r.share.solved - r.share.exact) < 1e-4 },
    );
    emit({ rows: rows.slice(), progress: (index + 1) / POLAR_CASES.length, done: index === POLAR_CASES.length - 1, note: '5,000 iterations each' });
    await breathe();
  }
}

async function pushfold(table: PreflopTable, emit: Emit, breathe: () => Promise<void>): Promise<void> {
  const stacks = sweepStacks();
  const solutions: PushFoldSolution[] = [];
  let worst = 0;
  for (let k = 0; k < stacks.length; k++) {
    const solution = solvePushFold(table, stacks[k]!, { target: 1e-7 });
    solutions.push(solution);
    worst = Math.max(worst, solution.exploitability);
    if (k % 8 === 7) {
      emit({ rows: [], progress: (k + 1) / stacks.length, done: false, note: `${k + 1} of ${stacks.length} stack sizes solved` });
      await breathe();
    }
  }
  const rows: Row[] = [];
  for (const side of ['push', 'call'] as const) {
    const r = compareChart(side, stacks, solutions);
    const cells = r.always + r.within005 + r.within010 + r.beyond.length;
    const who = side === 'push' ? 'Small blind pushes' : 'Big blind calls';
    rows.push({
      label: `${who}: hands within 0.1 bb of the chart`,
      expected: `${cells} compared`,
      measured: `${cells - r.beyond.length} of ${cells}`,
      ok: r.beyond.length <= (side === 'push' ? 1 : 0),
      word: r.beyond.length ? 'one apart' : 'matches',
    });
    for (const b of r.beyond) {
      rows.push({
        label: `${b.hand}, the one apart: published where its mixed span begins`,
        expected: b.published.toFixed(1),
        measured: `mixed, ${b.published.toFixed(1)} to ${b.solved.toFixed(1)}`,
        ok: r.outsideSpan.length === 0,
        word: 'inside',
      });
    }
  }
  for (const row of compareSpans(stacks, solutions)) {
    rows.push({ label: `${row.hand} ${row.boundary}`, expected: row.published.toFixed(1), measured: row.solved.toFixed(2), ok: row.ok });
  }
  rows.push({ label: 'Largest exploitability left, bb per hand', expected: 'below 0.0000001', measured: worst.toExponential(1), ok: worst < 1e-7 });
  emit({ rows, progress: 1, done: true, note: `${stacks.length} stack sizes, 1 to 20.5 bb` });
}

async function river(emit: Emit, breathe: () => Promise<void>): Promise<void> {
  const spot = wetRiver;
  const solver = riverSolver(spot);
  const pct = (x: number) => `${((100 * x) / spot.tree.pot).toFixed(6)}%`;
  for (const target of [10, 50, 200, 1000]) {
    solver.iterate(target - solver.iteration);
    emit({
      rows: [{ label: `After ${int(target)} iterations`, expected: '', measured: pct(solver.exploitability()), ok: null }],
      progress: target / 1200,
      done: false,
      note: `${solver.hands[0].n} against ${solver.hands[1].n} hands`,
    });
    await breathe();
  }
  const fast = solver.exploitability();
  const plain = referenceExploitability(solver);
  emit({
    rows: [
      { label: 'Exploitability after 1,000 iterations', expected: pct(plain), measured: pct(fast), ok: Math.abs(fast - plain) < 1e-9 * spot.tree.pot },
      { label: 'The two players’ results add up to', expected: '0', measured: Math.abs(solver.gameValue(0) + solver.gameValue(1)).toFixed(9), ok: Math.abs(solver.gameValue(0) + solver.gameValue(1)) < 1e-9 },
    ],
    progress: 1,
    done: true,
    note: `${solver.hands[0].n} against ${solver.hands[1].n} hands, 1,000 iterations`,
  });
}

async function equity(table: PreflopTable, emit: Emit, breathe: () => Promise<void>): Promise<void> {
  const i = classFromName('AA');
  const j = classFromName('KK');
  const combos = (cls: number) => {
    const out: number[] = [];
    for (let c = 0; c < COMBO_COUNT; c++) if (COMBO_CLASS[c] === cls) out.push(c);
    return out;
  };
  let wins = 0;
  let ties = 0;
  let pairs = 0;
  const rows = (done: boolean): Row[] => [
    { label: 'Boards won by aces', expected: int(table.wins[i * 169 + j]!), measured: int(wins), ok: done ? wins === table.wins[i * 169 + j] : null },
    { label: 'Boards tied', expected: int(table.ties[i * 169 + j]!), measured: int(ties), ok: done ? ties === table.ties[i * 169 + j] : null },
    { label: 'Ways to deal the two hands', expected: int(table.pairs[i * 169 + j]!), measured: int(pairs), ok: done ? pairs === table.pairs[i * 169 + j] : null },
  ];
  for (const x of combos(i)) {
    for (const y of combos(j)) {
      const r = handVsHand([COMBO_HI[x]!, COMBO_LO[x]!], [COMBO_HI[y]!, COMBO_LO[y]!]);
      wins += r.win;
      ties += r.tie;
      pairs++;
      emit({ rows: rows(false), progress: pairs / 36, done: false, note: `${int(pairs * 1712304)} boards dealt` });
      await breathe();
    }
  }
  emit({ rows: rows(true), progress: 1, done: true, note: `${int(pairs * 1712304)} boards dealt, ${CLASS_NAMES[i]} against ${CLASS_NAMES[j]}` });
}

export async function runCheck(
  check: string,
  table: () => Promise<PreflopTable>,
  emit: Emit,
  breathe: () => Promise<void>,
): Promise<void> {
  switch (check) {
    case 'evaluator':
      return evaluator(emit, breathe);
    case 'kuhn':
      return kuhn(emit, breathe);
    case 'polar':
      return polar(emit, breathe);
    case 'pushfold':
      return pushfold(await table(), emit, breathe);
    case 'river':
      return river(emit, breathe);
    case 'equity':
      return equity(await table(), emit, breathe);
    default:
      throw new Error(`Unknown check "${check}"`);
  }
}
