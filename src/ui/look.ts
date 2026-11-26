// How the actions of a decision are drawn, in the grid and everywhere else:
// aggressive actions in red, the largest solid and smaller ones hatched more
// lightly; calls and checks grey; folds left blank.

import type { TreeNode } from '../engine/tree.ts';
import type { SegStyle } from './grid.ts';

export function drawing(node: TreeNode): { order: number[]; styles: SegStyle[]; byAction: SegStyle[] } {
  const aggressive: number[] = [];
  const passive: number[] = [];
  const folds: number[] = [];
  node.actions.forEach((action, i) => {
    if (action.kind === 'fold') folds.push(i);
    else if (action.kind === 'check' || action.kind === 'call') passive.push(i);
    else aggressive.push(i);
  });
  aggressive.sort((a, b) => node.actions[b]!.to - node.actions[a]!.to);
  const scale: SegStyle[][] = [[], ['solid'], ['solid', 'hatch1'], ['solid', 'hatch1', 'hatch0'], ['solid', 'hatch2', 'hatch1', 'hatch0']];
  const reds = scale[Math.min(4, aggressive.length)]!;
  const order = [...aggressive, ...passive, ...folds];
  const styles: SegStyle[] = [
    ...aggressive.map((_, i) => reds[Math.min(i, reds.length - 1)]!),
    ...passive.map(() => 'grey' as SegStyle),
    ...folds.map(() => 'none' as SegStyle),
  ];
  const byAction: SegStyle[] = [];
  order.forEach((action, i) => (byAction[action] = styles[i]!));
  return { order, styles, byAction };
}

export const CSS_FILL: Record<SegStyle, string> = {
  none: 'transparent',
  grey: 'var(--grey)',
  solid: 'var(--red)',
  ink: 'var(--ink)',
  hatch0: 'repeating-linear-gradient(135deg, var(--red) 0 1px, transparent 1px 5px)',
  hatch1: 'repeating-linear-gradient(135deg, var(--red) 0 1px, transparent 1px 2.5px)',
  hatch2: 'repeating-linear-gradient(135deg, var(--red) 0 1px, transparent 1px 3px), repeating-linear-gradient(45deg, var(--red) 0 1px, transparent 1px 3px)',
};
