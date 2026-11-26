// Messages between the page and the engine worker.

import type { ComboDetail } from '../engine/view.ts';
import type { PushFoldSolution } from '../engine/pushfold.ts';
import type { TreeConfig, TreeNode } from '../engine/tree.ts';

export interface RiverJob {
  type: 'river';
  id: number;
  board: number[];
  ranges: [Float64Array, Float64Array];
  tree: TreeConfig;
  /** Stop once exploitability is at or below this share of the pot. */
  tolerance: number;
  maxIterations: number;
}

export type Request =
  | RiverJob
  | { type: 'stop'; id: number }
  | { type: 'detail'; id: number; nodeId: number }
  | { type: 'pushfold'; id: number; stack: number }
  | { type: 'sweep'; id: number; from: number; to: number; step: number }
  | { type: 'equity'; id: number; a: Float64Array; b: Float64Array; board: number[]; exact: [number[], number[]] | null }
  | { type: 'proof'; id: number; check: string };

export interface Frame {
  iteration: number;
  /** Exploitability as a share of the pot. */
  exploitability: number;
  /** Solving time so far, without the time spent measuring. */
  ms: number;
  /** Grid views of all decision nodes, packed: see `offsets` in the tree message. */
  data: Uint8Array;
  /** Overall action frequencies of all decision nodes, packed in node order. */
  overall: Float32Array;
}

export type Response =
  | {
      type: 'tree';
      id: number;
      nodes: TreeNode[];
      hands: [number, number];
      /** Per node id: where its grid view starts in a frame's data, or -1. */
      offsets: Int32Array;
      overallOffsets: Int32Array;
    }
  | ({ type: 'frame'; id: number } & Frame)
  | { type: 'done'; id: number; reason: 'tolerance' | 'limit' | 'stopped' }
  | { type: 'detail'; id: number; nodeId: number; combos: ComboDetail[] }
  | { type: 'pushfold'; id: number; solution: PushFoldSolution; ms: number }
  | { type: 'sweep'; id: number; solution: PushFoldSolution; done: boolean }
  | { type: 'equity'; id: number; result: EquityResult }
  | { type: 'proof'; id: number; check: string; update: ProofUpdate }
  | { type: 'error'; id: number; message: string };

export interface EquityResult {
  mode: 'hands' | 'ranges' | 'preflop';
  equity: [number, number];
  /** Hands mode: exact counts. */
  win?: number;
  tie?: number;
  lose?: number;
  /** Boards dealt (hands, ranges) or boards counted in the table (preflop). */
  boards: number;
  byCombo?: [Float64Array, Float64Array];
  ms: number;
}

export interface ProofUpdate {
  /** Rows of label, expected, measured. */
  rows: { label: string; expected: string; measured: string; ok: boolean | null }[];
  progress: number;
  done: boolean;
  note?: string;
}
