// Exact equity by enumeration: every way the rest of the board can come is
// dealt once and counted. Nothing is sampled.

import { COMBO_COUNT, COMBO_HI, COMBO_LO } from './cards.ts';
import { BoardState } from './evaluator.ts';

/** Calls `visit` once for every way to complete the board to five cards. */
export function forEachRunout(
  board: ArrayLike<number>,
  dead: ArrayLike<number>,
  visit: (state: BoardState, added: Uint8Array) => void,
): number {
  const need = 5 - board.length;
  if (need < 0) throw new Error('A board has at most five cards');
  const used = new Uint8Array(52);
  for (let i = 0; i < board.length; i++) used[board[i]!] = 1;
  for (let i = 0; i < dead.length; i++) used[dead[i]!] = 1;
  const live: number[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) live.push(c);

  const states = Array.from({ length: need + 1 }, () => new BoardState());
  states[0] = new BoardState(board);
  const added = new Uint8Array(need);
  let count = 0;
  const deal = (depth: number, start: number): void => {
    if (depth === need) {
      visit(states[depth]!, added);
      count++;
      return;
    }
    const last = live.length - (need - depth);
    for (let i = start; i <= last; i++) {
      const state = states[depth + 1]!;
      state.copyFrom(states[depth]!);
      state.add(live[i]!);
      added[depth] = live[i]!;
      deal(depth + 1, i + 1);
    }
  };
  deal(0, 0);
  return count;
}

export interface Matchup {
  win: number;
  tie: number;
  lose: number;
  total: number;
  /** Share of the pot the first hand expects: wins plus half the ties. */
  equity: number;
}

/** One hand against another, on any board of zero to five cards. */
export function handVsHand(a: ArrayLike<number>, b: ArrayLike<number>, board: ArrayLike<number> = []): Matchup {
  const dead = [a[0]!, a[1]!, b[0]!, b[1]!];
  if (new Set([...dead, ...Array.from(board)]).size !== 4 + board.length) throw new Error('A card is used twice');
  let win = 0;
  let tie = 0;
  let lose = 0;
  const a0 = a[0]!;
  const a1 = a[1]!;
  const b0 = b[0]!;
  const b1 = b[1]!;
  const total = forEachRunout(board, dead, (state) => {
    const x = state.with2(a0, a1);
    const y = state.with2(b0, b1);
    if (x > y) win++;
    else if (x < y) lose++;
    else tie++;
  });
  return { win, tie, lose, total, equity: (win + tie / 2) / total };
}

export interface RangeEquity {
  /** Share of the pot each range expects. They add up to one. */
  equity: [number, number];
  /** Per combo (1326 entries each): equity against the other range, NaN where the combo is not in play. */
  byCombo: [Float64Array, Float64Array];
  runouts: number;
}

/**
 * One range against another on a board of three, four or five cards. Each
 * runout is dealt once; on each, every hand is compared with the whole
 * opposing range in one pass over the hands sorted by strength, with the
 * hands that share a card taken back out.
 */
export function rangeVsRange(a: ArrayLike<number>, b: ArrayLike<number>, board: ArrayLike<number>): RangeEquity {
  if (board.length < 3) throw new Error('Range against range needs at least a flop');
  const onBoard = new Uint8Array(52);
  for (let i = 0; i < board.length; i++) onBoard[board[i]!] = 1;

  const ranges = [a, b];
  const combos: Int32Array[] = [];
  for (const range of ranges) {
    const list: number[] = [];
    for (let i = 0; i < COMBO_COUNT; i++) {
      if (range[i]! > 0 && !onBoard[COMBO_HI[i]!] && !onBoard[COMBO_LO[i]!]) list.push(i);
    }
    combos.push(Int32Array.from(list));
  }
  const n = [combos[0]!.length, combos[1]!.length];
  const won = [new Float64Array(n[0]!), new Float64Array(n[1]!)];
  const faced = [new Float64Array(n[0]!), new Float64Array(n[1]!)];
  const strength = [new Float64Array(n[0]!), new Float64Array(n[1]!)];
  const order = [new Int32Array(n[0]!), new Int32Array(n[1]!)];
  const live = [new Int32Array(n[0]!), new Int32Array(n[1]!)];
  const below = new Float64Array(52);
  const upTo = new Float64Array(52);
  const all = new Float64Array(52);
  const weightOf = new Float64Array(COMBO_COUNT);
  const strengthOf = new Float64Array(COMBO_COUNT);

  const runouts = forEachRunout(board, [], (state, added) => {
    const gone = new Uint8Array(52);
    for (let i = 0; i < added.length; i++) gone[added[i]!] = 1;
    const count = [0, 0];
    for (let p = 0; p < 2; p++) {
      const list = combos[p]!;
      const s = strength[p]!;
      const alive = live[p]!;
      let m = 0;
      for (let i = 0; i < list.length; i++) {
        const combo = list[i]!;
        const hi = COMBO_HI[combo]!;
        const lo = COMBO_LO[combo]!;
        if (gone[hi] || gone[lo]) continue;
        s[i] = state.with2(hi, lo);
        alive[m++] = i;
      }
      count[p] = m;
      const sorted = order[p]!.subarray(0, m);
      sorted.set(alive.subarray(0, m));
      sorted.sort((x, y) => s[x]! - s[y]!);
    }

    for (let p = 0; p < 2; p++) {
      const q = 1 - p;
      const mine = combos[p]!;
      const theirs = combos[q]!;
      const ms = strength[p]!;
      const ts = strength[q]!;
      const mo = order[p]!;
      const to = order[q]!;
      const theirRange = ranges[q]!;
      const nm = count[p]!;
      const nt = count[q]!;

      // The opposing range as it stands on this runout.
      all.fill(0);
      let total = 0;
      for (let j = 0; j < nt; j++) {
        const combo = theirs[to[j]!]!;
        const w = theirRange[combo]!;
        total += w;
        all[COMBO_HI[combo]!]! += w;
        all[COMBO_LO[combo]!]! += w;
        weightOf[combo] = w;
        strengthOf[combo] = ts[to[j]!]!;
      }

      below.fill(0);
      upTo.fill(0);
      let sumBelow = 0;
      let sumUpTo = 0;
      let jb = 0;
      let ju = 0;
      for (let i = 0; i < nm; i++) {
        const h = mo[i]!;
        const s = ms[h]!;
        while (jb < nt && ts[to[jb]!]! < s) {
          const combo = theirs[to[jb]!]!;
          const w = theirRange[combo]!;
          sumBelow += w;
          below[COMBO_HI[combo]!]! += w;
          below[COMBO_LO[combo]!]! += w;
          jb++;
        }
        while (ju < nt && ts[to[ju]!]! <= s) {
          const combo = theirs[to[ju]!]!;
          const w = theirRange[combo]!;
          sumUpTo += w;
          upTo[COMBO_HI[combo]!]! += w;
          upTo[COMBO_LO[combo]!]! += w;
          ju++;
        }
        const combo = mine[h]!;
        const hi = COMBO_HI[combo]!;
        const lo = COMBO_LO[combo]!;
        // The same two cards in the other range were taken out twice above.
        const twin = strengthOf[combo] === s ? weightOf[combo]! : 0;
        const wins = sumBelow - below[hi]! - below[lo]!;
        const winsAndTies = sumUpTo - upTo[hi]! - upTo[lo]! + twin;
        won[p]![h]! += wins + (winsAndTies - wins) / 2;
        faced[p]![h]! += total - all[hi]! - all[lo]! + twin;
      }

      for (let j = 0; j < nt; j++) {
        const combo = theirs[to[j]!]!;
        weightOf[combo] = 0;
        strengthOf[combo] = 0;
      }
    }
  });

  const byCombo: [Float64Array, Float64Array] = [
    new Float64Array(COMBO_COUNT).fill(NaN),
    new Float64Array(COMBO_COUNT).fill(NaN),
  ];
  const share: [number, number] = [0, 0];
  for (let p = 0; p < 2; p++) {
    let top = 0;
    let bottom = 0;
    for (let h = 0; h < n[p]!; h++) {
      const combo = combos[p]![h]!;
      const w = ranges[p]![combo]!;
      top += w * won[p]![h]!;
      bottom += w * faced[p]![h]!;
      if (faced[p]![h]! > 0) byCombo[p]![combo] = won[p]![h]! / faced[p]![h]!;
    }
    share[p] = bottom > 0 ? top / bottom : NaN;
  }
  return { equity: share, byCombo, runouts };
}
