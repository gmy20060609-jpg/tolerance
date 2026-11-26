// Prints the numbers behind every claim in the README, measured on this
// machine: `npm run report`.

import os from 'node:os';
import { CLASS_NAMES } from '../src/engine/cards.ts';
import { solvePushFold } from '../src/engine/pushfold.ts';
import { riverSolver } from '../src/engine/river.ts';
import { kuhnSolver } from '../src/proof/kuhn.ts';
import { CALLER, PUSHER, readChart } from '../src/proof/hune.ts';
import { dryRiver, fullRanges, wetRiver } from '../src/spots.ts';
import { preflopTable } from '../test/table.ts';

const line = (text = '') => console.log(text);
const pad = (value: string | number, width: number) => String(value).padStart(width);

line(`Machine: ${os.cpus()[0]?.model}, Node ${process.version}, one thread`);

// --- Kuhn poker ---------------------------------------------------------------
line();
line('Kuhn poker. Known value for the first player: -1/18 = -0.0555556');
line('  iterations   value         exploitability (antes)');
const kuhn = kuhnSolver();
for (const target of [10, 100, 1000, 10000]) {
  kuhn.iterate(target - kuhn.iteration);
  line(`  ${pad(target, 10)}   ${kuhn.gameValue(0).toFixed(7)}    ${kuhn.exploitability().toExponential(2)}`);
}

// --- Push or fold ---------------------------------------------------------------
line();
line('Heads-up push or fold against the HoldemResources.net chart (no ante)');
const table = preflopTable();
const stacks: number[] = [];
for (let k = 20; k <= 410; k++) stacks.push(k * 0.05);
let started = performance.now();
const solutions = stacks.map((stack) => solvePushFold(table, stack, { target: 1e-7 }));
const sweepSeconds = (performance.now() - started) / 1000;
const worst = Math.max(...solutions.map((s) => s.exploitability));
const iterations = solutions.reduce((sum, s) => sum + s.iterations, 0) / solutions.length;
line(`  ${stacks.length} stack sizes from 1 to 20.5 bb solved in ${sweepSeconds.toFixed(1)} s`);
line(`  ${(1000 * sweepSeconds / stacks.length).toFixed(0)} ms and ${iterations.toFixed(0)} iterations per stack on average`);
line(`  largest exploitability left: ${worst.toExponential(1)} bb per hand`);
for (const [side, chart] of [['push', PUSHER], ['call', CALLER]] as const) {
  const published = readChart(chart);
  let always20 = 0;
  let within005 = 0;
  let within010 = 0;
  const beyond: string[] = [];
  for (let hand = 0; hand < 169; hand++) {
    const want = published[hand]!;
    if (Number.isNaN(want)) continue;
    let half = 0;
    solutions.forEach((s, k) => {
      if (s[side][hand]! >= 0.5) half = stacks[k]!;
    });
    if (want === Infinity) always20++;
    else if (Math.abs(half - want) <= 0.05 + 1e-9) within005++;
    else if (Math.abs(half - want) <= 0.1 + 1e-9) within010++;
    else beyond.push(`${CLASS_NAMES[hand]} (published ${want}, solved ${half.toFixed(2)})`);
  }
  line(
    `  ${side}: ${always20} hands played at every stack in both, ${within005} within 0.05 bb, ` +
      `${within010} more within 0.1 bb, ${beyond.length} further off${beyond.length ? ': ' + beyond.join(', ') : ''}`,
  );
}
for (const stack of [5, 10, 15, 20, 25]) {
  const s = solvePushFold(table, stack, { target: 1e-7 });
  line(
    `  ${pad(stack, 2)} bb: push ${(100 * s.pushShare).toFixed(1)}%, call ${(100 * s.callShare).toFixed(1)}%, ` +
      `small blind ${s.value >= 0 ? '+' : ''}${s.value.toFixed(4)} bb per hand`,
  );
}

// --- River --------------------------------------------------------------------
line();
line('River spots. Exploitability as a share of the pot, time excludes measuring it');
const spots = [
  ['Ks 8h 5d 2c Jd, 5.5 bb pot, 97.5 bb behind, 3 bet sizes, 2 raise sizes', dryRiver],
  ['Qh Ts 7h 4d 2h, 40 bb pot, 80 bb behind, 2 bet sizes, 1 raise size', wetRiver],
  ['Ks 8h 5d 2c Jd, every hand for both players', fullRanges],
] as const;
for (const [name, spot] of spots) {
  const solver = riverSolver(spot);
  const decisions = solver.tree.nodes.filter((n) => n.actions.length > 0).length;
  line(`  ${name}`);
  line(`  ${solver.hands[0].n} against ${solver.hands[1].n} hands, ${solver.tree.nodes.length} nodes, ${decisions} decisions`);
  line('    iterations   exploitability   time');
  let ms = 0;
  for (const target of [10, 20, 50, 100, 200, 500, 1000, 2000]) {
    started = performance.now();
    solver.iterate(target - solver.iteration);
    ms += performance.now() - started;
    const share = (100 * solver.exploitability()) / spot.tree.pot;
    line(`    ${pad(target, 10)}   ${pad(share.toFixed(4), 9)}% pot   ${pad(ms.toFixed(0), 5)} ms`);
  }
}
