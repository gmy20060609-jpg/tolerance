/// <reference lib="webworker" />
// The engine runs here, off the main thread.

import { COMBO_CLASS, COMBO_COUNT } from '../engine/cards.ts';
import { forEachRunout, handVsHand, rangeVsRange } from '../engine/equity.ts';
import { readPreflopTable, solvePushFold, BOARDS_PER_MATCHUP, type PreflopTable } from '../engine/pushfold.ts';
import { riverSolver } from '../engine/river.ts';
import type { Solver } from '../engine/solver.ts';
import { DECISION } from '../engine/tree.ts';
import { comboDetails, gridViews } from '../engine/view.ts';
import { runCheck } from '../proof/checks.ts';
import type { Frame, Request, Response, RiverJob } from './protocol.ts';
import tableUrl from '../engine/data/preflop-equity.bin?url';

const post = (message: Response, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message, transfer);

/** Lets queued messages in before carrying on. */
const breathe = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });

let table: Promise<PreflopTable> | undefined;
const preflopTable = () =>
  (table ??= fetch(tableUrl)
    .then((response) => response.arrayBuffer())
    .then(readPreflopTable));

// --- River ---------------------------------------------------------------------

let current: { id: number; solver: Solver; stopped: boolean } | undefined;

/** Iterations at which a frame is taken: every one at first, then about 5% apart. */
function nextStop(iteration: number): number {
  return iteration < 24 ? iteration + 1 : Math.ceil(iteration * 1.05);
}

async function solveRiver(job: RiverJob): Promise<void> {
  const solver = riverSolver({ board: job.board, ranges: job.ranges, tree: job.tree });
  const run = { id: job.id, solver, stopped: false };
  current = run;
  const nodes = solver.tree.nodes;

  const offsets = new Int32Array(nodes.length).fill(-1);
  const overallOffsets = new Int32Array(nodes.length).fill(-1);
  let size = 0;
  let overallSize = 0;
  for (const node of nodes) {
    if (node.type !== DECISION) continue;
    offsets[node.id] = size;
    overallOffsets[node.id] = overallSize;
    size += 169 * (node.actions.length + 1);
    overallSize += node.actions.length;
  }
  post({ type: 'tree', id: job.id, nodes, hands: [solver.hands[0].n, solver.hands[1].n], offsets, overallOffsets });

  let ms = 0;
  const frame = (): Frame => {
    const views = gridViews(solver);
    const data = new Uint8Array(size);
    const overall = new Float32Array(overallSize);
    for (const node of nodes) {
      const view = views[node.id];
      if (!view) continue;
      data.set(view.freq, offsets[node.id]!);
      data.set(view.fill, offsets[node.id]! + view.freq.length);
      overall.set(view.overall, overallOffsets[node.id]!);
    }
    return { iteration: solver.iteration, exploitability: solver.exploitability() / job.tree.pot, ms, data, overall };
  };
  const send = (f: Frame) => post({ type: 'frame', id: job.id, ...f }, [f.data.buffer, f.overall.buffer]);

  let last = frame();
  send(last);
  let reason: 'tolerance' | 'limit' | 'stopped' = 'limit';
  // Work in slices of about a frame's length. Yielding after every small step
  // lets the processor fall back to its slow cores between them.
  let slice = performance.now();
  while (solver.iteration < job.maxIterations) {
    const target = Math.min(job.maxIterations, nextStop(solver.iteration));
    const started = performance.now();
    solver.iterate(target - solver.iteration);
    ms += performance.now() - started;
    last = frame();
    send(last);
    if (last.exploitability <= job.tolerance) {
      reason = 'tolerance';
      break;
    }
    if (performance.now() - slice > 14) {
      await breathe();
      slice = performance.now();
      if (run.stopped) {
        reason = 'stopped';
        break;
      }
    }
  }
  post({ type: 'done', id: job.id, reason });
}

// --- Equity --------------------------------------------------------------------

async function equity(request: Extract<Request, { type: 'equity' }>): Promise<void> {
  const started = performance.now();
  const { a, b, board, exact } = request;
  if (exact) {
    const r = handVsHand(exact[0], exact[1], board);
    const ms = performance.now() - started;
    // A second pass keeps the result of every board, for the picture.
    const outcomes = new Uint8Array(r.total);
    const [a0, a1] = exact[0] as [number, number];
    const [b0, b1] = exact[1] as [number, number];
    let at = 0;
    forEachRunout(board, [a0, a1, b0, b1], (state) => {
      const x = state.with2(a0, a1);
      const y = state.with2(b0, b1);
      outcomes[at++] = x > y ? 2 : x < y ? 0 : 1;
    });
    const used = new Set([...board, a0, a1, b0, b1]);
    const live: number[] = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) live.push(c);
    post(
      {
        type: 'equity',
        id: request.id,
        result: { mode: 'hands', equity: [r.equity, 1 - r.equity], win: r.win, tie: r.tie, lose: r.lose, boards: r.total, outcomes, live, ms },
      },
      [outcomes.buffer],
    );
    return;
  }
  if (board.length >= 3) {
    const r = rangeVsRange(a, b, board);
    post({
      type: 'equity',
      id: request.id,
      result: { mode: 'ranges', equity: r.equity, boards: r.runouts, byCombo: r.byCombo, ms: performance.now() - started },
    });
    return;
  }
  // Before the flop: sum the exact table over every pair of combos that can be
  // dealt together. Within a class all suit arrangements are weighted alike,
  // which is exact when each class is in the range as a whole.
  const t = await preflopTable();
  const classA = new Float64Array(169);
  const classB = new Float64Array(169);
  const size = new Float64Array(169);
  for (let i = 0; i < COMBO_COUNT; i++) {
    classA[COMBO_CLASS[i]!]! += a[i]!;
    classB[COMBO_CLASS[i]!]! += b[i]!;
    size[COMBO_CLASS[i]!]!++;
  }
  let won = 0;
  let total = 0;
  for (let i = 0; i < 169; i++) {
    if (!classA[i]) continue;
    for (let j = 0; j < 169; j++) {
      if (!classB[j]) continue;
      const weight = (classA[i]! / size[i]!) * (classB[j]! / size[j]!) * t.pairs[i * 169 + j]!;
      won += weight * t.equity[i * 169 + j]!;
      total += weight;
    }
  }
  const share = total > 0 ? won / total : NaN;
  post({
    type: 'equity',
    id: request.id,
    result: { mode: 'preflop', equity: [share, 1 - share], boards: BOARDS_PER_MATCHUP, ms: performance.now() - started },
  });
}

// --- Dispatch ------------------------------------------------------------------

const sweeps = new Set<number>();

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case 'river':
        if (current) current.stopped = true;
        await solveRiver(request);
        break;
      case 'stop':
        if (current && current.id === request.id) current.stopped = true;
        sweeps.delete(request.id);
        break;
      case 'detail':
        if (current && current.id === request.id) {
          post({ type: 'detail', id: request.id, nodeId: request.nodeId, combos: comboDetails(current.solver, request.nodeId) });
        }
        break;
      case 'pushfold': {
        const t = await preflopTable();
        const started = performance.now();
        const solution = solvePushFold(t, request.stack, { target: 1e-7 });
        post({ type: 'pushfold', id: request.id, solution, ms: performance.now() - started });
        break;
      }
      case 'sweep': {
        const t = await preflopTable();
        sweeps.add(request.id);
        const steps = Math.round((request.to - request.from) / request.step);
        for (let k = 0; k <= steps; k++) {
          if (!sweeps.has(request.id)) return;
          const stack = Math.round((request.from + k * request.step) * 1000) / 1000;
          const solution = solvePushFold(t, stack, { target: 1e-7 });
          post({ type: 'sweep', id: request.id, solution, done: k === steps });
          if (k % 4 === 3) await breathe();
        }
        sweeps.delete(request.id);
        break;
      }
      case 'equity':
        await equity(request);
        break;
      case 'proof':
        await runCheck(request.check, preflopTable, (update) => post({ type: 'proof', id: request.id, check: request.check, update }), breathe);
        break;
    }
  } catch (error) {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
};
