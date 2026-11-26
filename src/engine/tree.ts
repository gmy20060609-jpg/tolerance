// The betting tree of one street between two players.
//
// Player 0 is out of position and acts first, player 1 is in position.
// Chips are measured from the start of the street: `pot` is already in the
// middle, `stack` is what each player still has behind.

export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface Action {
  kind: ActionKind;
  /** Chips the acting player has put in on this street once the action is taken. */
  to: number;
}

export interface TreeConfig {
  pot: number;
  stack: number;
  /** Bet sizes offered to each player, as fractions of the pot. */
  bets: [number[], number[]];
  /** Raise sizes offered to each player, as fractions of the pot after calling. */
  raises: [number[], number[]];
  /** How many raises may follow the opening bet. */
  maxRaises: number;
  /** Offer all-in as a bet and as a raise. */
  allIn: boolean;
  /** A bet or raise that would commit at least this share of the remaining stack becomes all-in. */
  allInThreshold: number;
}

export const DECISION = 0;
export const FOLD = 1;
export const SHOWDOWN = 2;

export interface TreeNode {
  id: number;
  type: typeof DECISION | typeof FOLD | typeof SHOWDOWN;
  /** Decision nodes: the player to act. Fold nodes: the player who folded. */
  player: number;
  /** Chips each player has put in on this street. */
  commit: [number, number];
  actions: Action[];
  children: number[];
  parent: number;
  parentAction: number;
  /**
   * Terminal nodes: the chips that change hands, counted so that the two
   * players' results add up to zero. Each player is treated as owning half of
   * the starting pot, so the loser gives up that half plus what they put in on
   * this street.
   */
  stake: number;
}

export interface Tree {
  config: TreeConfig;
  nodes: TreeNode[];
}

const EPS = 1e-9;

export function buildTree(config: TreeConfig): Tree {
  const { pot, stack, bets, raises, maxRaises, allIn, allInThreshold } = config;
  if (!(pot > 0)) throw new Error('The pot must be positive');
  if (!(stack >= 0)) throw new Error('The stack cannot be negative');
  const nodes: TreeNode[] = [];

  const add = (
    type: TreeNode['type'],
    player: number,
    commit: [number, number],
    parent: number,
    parentAction: number,
    stake: number,
  ): TreeNode => {
    const node: TreeNode = { id: nodes.length, type, player, commit, actions: [], children: [], parent, parentAction, stake };
    nodes.push(node);
    return node;
  };

  /** Turns a list of wanted totals into legal, distinct, ascending totals. */
  const sizes = (wanted: number[], already: number, floor: number): number[] => {
    const remaining = stack - already;
    const out: number[] = [];
    for (let to of wanted) {
      if (to < floor) to = floor;
      if (to > stack || to - already >= allInThreshold * remaining - EPS) to = stack;
      out.push(to);
    }
    if (allIn) out.push(stack);
    out.sort((a, b) => a - b);
    return out.filter((to, i) => to > already + EPS && (i === 0 || to - out[i - 1]! > EPS));
  };

  const decision = (
    player: number,
    commit: [number, number],
    raisesMade: number,
    lastRaise: number,
    parent: number,
    parentAction: number,
  ): number => {
    const node = add(DECISION, player, commit, parent, parentAction, 0);
    const me = commit[player]!;
    const them = commit[1 - player]!;
    const push = (action: Action, child: number) => {
      node.actions.push(action);
      node.children.push(child);
    };
    const next = (to: number): [number, number] => (player === 0 ? [to, them] : [them, to]);

    if (them > me + EPS) {
      push({ kind: 'fold', to: me }, add(FOLD, player, commit, node.id, 0, pot / 2 + me).id);
      push({ kind: 'call', to: them }, add(SHOWDOWN, -1, next(them), node.id, 1, pot / 2 + them).id);
      if (them < stack - EPS && raisesMade <= maxRaises) {
        const potAfterCall = pot + 2 * them;
        const wanted = raises[player]!.map((f) => them + f * potAfterCall);
        for (const to of sizes(wanted, me, them + lastRaise)) {
          if (to <= them + EPS) continue;
          const index = node.actions.length;
          const kind: ActionKind = to >= stack - EPS ? 'allin' : 'raise';
          node.actions.push({ kind, to });
          node.children.push(-1);
          node.children[index] = decision(1 - player, next(to), raisesMade + 1, to - them, node.id, index);
        }
      }
    } else {
      if (player === 0) {
        node.actions.push({ kind: 'check', to: me });
        node.children.push(-1);
        node.children[0] = decision(1, commit, 0, 0, node.id, 0);
      } else {
        push({ kind: 'check', to: me }, add(SHOWDOWN, -1, commit, node.id, 0, pot / 2 + me).id);
      }
      if (stack > EPS) {
        const currentPot = pot + me + them;
        const wanted = bets[player]!.map((f) => me + f * currentPot);
        for (const to of sizes(wanted, me, 0)) {
          const index = node.actions.length;
          const kind: ActionKind = to >= stack - EPS ? 'allin' : 'bet';
          node.actions.push({ kind, to });
          node.children.push(-1);
          node.children[index] = decision(1 - player, next(to), 1, to - me, node.id, index);
        }
      }
    }
    return node.id;
  };

  decision(0, [0, 0], 0, 0, -1, -1);
  return { config, nodes };
}

/** A short label for an action, with sizes shown as a share of the pot. */
export function actionLabel(tree: Tree, node: TreeNode, index: number): string {
  const action = node.actions[index]!;
  const { pot } = tree.config;
  const me = node.commit[node.player]!;
  const them = node.commit[1 - node.player]!;
  switch (action.kind) {
    case 'fold':
      return 'Fold';
    case 'check':
      return 'Check';
    case 'call':
      return 'Call';
    case 'allin':
      return 'All-in';
    case 'bet': {
      const share = (action.to - me) / (pot + me + them);
      return `Bet ${Math.round(share * 100)}%`;
    }
    case 'raise': {
      const share = (action.to - them) / (pot + 2 * them);
      return `Raise ${Math.round(share * 100)}%`;
    }
  }
}
