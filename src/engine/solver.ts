// Discounted counterfactual regret minimisation over one betting street.
//
// The solver works on whole ranges at once. A node's value is a vector with
// one entry per hand of the player being updated; the opponent is represented
// by a vector of reach weights, one per opponent hand. Two hands that share a
// card can never be dealt together, which every terminal evaluation accounts
// for.
//
// Reference: Brown and Sandholm, "Solving Imperfect-Information Games via
// Discounted Regret Minimization", AAAI 2019.

import { CHANCE, DECISION, FOLD, type Tree, type TreeNode } from './tree.ts';

/** The hands one player can hold, each with two card ids and a strength. */
export interface HandSet {
  n: number;
  card1: Uint8Array;
  card2: Uint8Array;
  /** Showdown strength: higher wins, equal ties. */
  strength: Int32Array;
  /** How often the hand is in the range, before any action. */
  weight: Float64Array;
  /** A caller-defined id per hand, kept in step when the hands are reordered. */
  label: Int32Array;
}

/**
 * The hands in play once a card has been dealt: the hands of the street
 * before, less those that hold the card, ordered by their new strength.
 */
export interface Street {
  hands: [HandSet, HandSet];
  /** For each hand here, its index among the hands of the first street. */
  from: [Int32Array, Int32Array];
}

export interface SolverOptions {
  /** DCFR exponents. The defaults are the ones recommended in the paper. */
  alpha?: number;
  beta?: number;
  gamma?: number;
  /**
   * For trees with a chance node: the hands on each second street, in the
   * order of the chance node's cards. The first street's hands are then kept
   * in the order given.
   */
  streets?: Street[];
  /** Probability of each card at a chance node, given both players' hands. */
  chanceWeight?: number;
}

/** Card ids must be below this. Real cards use 0..51; toy games may use the rest. */
export const CARD_SLOTS = 64;

function sortByStrength(hands: HandSet): HandSet {
  const order = Array.from({ length: hands.n }, (_, i) => i).sort(
    (a, b) => hands.strength[a]! - hands.strength[b]! || hands.label[a]! - hands.label[b]!,
  );
  return {
    n: hands.n,
    card1: Uint8Array.from(order, (i) => hands.card1[i]!),
    card2: Uint8Array.from(order, (i) => hands.card2[i]!),
    strength: Int32Array.from(order, (i) => hands.strength[i]!),
    weight: Float64Array.from(order, (i) => hands.weight[i]!),
    label: Int32Array.from(order, (i) => hands.label[i]!),
  };
}

export class Solver {
  readonly tree: Tree;
  /** Hands of both players on the first street. With one street they are sorted by ascending strength. */
  readonly hands: [HandSet, HandSet];
  /** Hands by street: index 0 is the first street. */
  private readonly streets: [HandSet, HandSet][];
  private readonly from: ([Int32Array, Int32Array] | null)[];
  private readonly chanceWeight: number;
  /** Reach vectors carried across a chance node, per street and player. */
  private readonly dealt: [Float64Array, Float64Array][];
  /** Completed iterations. One iteration updates both players once. */
  iteration = 0;

  private readonly alpha: number;
  private readonly beta: number;
  private readonly gamma: number;

  private readonly nodes: TreeNode[];
  private readonly regrets: Float64Array[] = [];
  private readonly strategySum: Float64Array[] = [];
  private readonly strategy: Float64Array[] = [];
  private readonly childReach: Float64Array[][] = [];
  private readonly values: [Float64Array[], Float64Array[]] = [[], []];
  /** Per street: for each hand, the index of the same two cards in the other player's hands, or -1. */
  private readonly twins: [Int32Array, Int32Array][];
  private readonly cardSum = new Float64Array(CARD_SLOTS);
  /** Total weight of all deals in which the two hands share no card. */
  readonly dealWeight: number;

  private posDiscount = 0;
  private negDiscount = 0;
  private sumDiscount = 0;

  constructor(tree: Tree, hands: [HandSet, HandSet], options: SolverOptions = {}) {
    this.tree = tree;
    this.nodes = tree.nodes;
    const later = options.streets ?? [];
    this.hands = later.length ? hands : [sortByStrength(hands[0]), sortByStrength(hands[1])];
    this.streets = [this.hands, ...later.map((street) => street.hands)];
    this.from = [null, ...later.map((street) => street.from)];
    this.chanceWeight = options.chanceWeight ?? 1;
    this.alpha = options.alpha ?? 1.5;
    this.beta = options.beta ?? 0;
    this.gamma = options.gamma ?? 2;

    const [a, b] = this.hands;
    if (a.n === 0 || b.n === 0) throw new Error('Both players need at least one hand');
    const key = (h: HandSet, i: number) =>
      Math.min(h.card1[i]!, h.card2[i]!) * CARD_SLOTS + Math.max(h.card1[i]!, h.card2[i]!);
    this.twins = this.streets.map(([x, y]) => {
      const twin: [Int32Array, Int32Array] = [new Int32Array(x.n).fill(-1), new Int32Array(y.n).fill(-1)];
      const seen = new Map<number, number>();
      for (let i = 0; i < y.n; i++) seen.set(key(y, i), i);
      for (let i = 0; i < x.n; i++) {
        const j = seen.get(key(x, i));
        if (j !== undefined) {
          twin[0][i] = j;
          twin[1][j] = i;
        }
      }
      return twin;
    });
    this.dealt = this.streets.map(([x, y]) => [new Float64Array(x.n), new Float64Array(y.n)]);

    for (const node of this.nodes) {
      const street = this.streets[node.street];
      if (!street) throw new Error('The tree deals a card the solver has no hands for');
      this.values[0].push(new Float64Array(street[0].n));
      this.values[1].push(new Float64Array(street[1].n));
      if (node.type === DECISION) {
        const n = street[node.player]!.n;
        const size = node.actions.length * n;
        this.regrets.push(new Float64Array(size));
        this.strategySum.push(new Float64Array(size));
        this.strategy.push(new Float64Array(size));
        this.childReach.push(node.actions.map(() => new Float64Array(n)));
      } else {
        const none = new Float64Array(0);
        this.regrets.push(none);
        this.strategySum.push(none);
        this.strategy.push(none);
        this.childReach.push([]);
      }
    }

    const mass = new Float64Array(a.n);
    this.reachableMass(0, b.weight, mass);
    let total = 0;
    for (let i = 0; i < a.n; i++) total += a.weight[i]! * mass[i]!;
    if (!(total > 0)) throw new Error('The two ranges cannot be dealt together');
    this.dealWeight = total;
  }

  /** The hands a node is played with. */
  handsAt(nodeId: number): [HandSet, HandSet] {
    return this.streets[this.nodes[nodeId]!.street]!;
  }

  // --- Terminal evaluation ---------------------------------------------------

  /** For each hand of `player`, the opponent weight it can actually face. */
  reachableMass(player: number, oppReach: Float64Array, out: Float64Array, street = 0): void {
    const mine = this.streets[street]![player]!;
    const theirs = this.streets[street]![1 - player]!;
    const twin = this.twins[street]![player]!;
    const sums = this.cardSum;
    sums.fill(0);
    let total = 0;
    const t1 = theirs.card1;
    const t2 = theirs.card2;
    for (let k = 0; k < theirs.n; k++) {
      const r = oppReach[k]!;
      total += r;
      sums[t1[k]!]! += r;
      sums[t2[k]!]! += r;
    }
    const m1 = mine.card1;
    const m2 = mine.card2;
    for (let h = 0; h < mine.n; h++) {
      const same = twin[h]!;
      out[h] = total - sums[m1[h]!]! - sums[m2[h]!]! + (same >= 0 ? oppReach[same]! : 0);
    }
  }

  private foldValue(node: TreeNode, player: number, oppReach: Float64Array, out: Float64Array): void {
    this.reachableMass(player, oppReach, out, node.street);
    const sign = node.player === player ? -node.stake : node.stake;
    const n = this.streets[node.street]![player]!.n;
    for (let h = 0; h < n; h++) out[h]! *= sign;
  }

  private showdownValue(node: TreeNode, player: number, oppReach: Float64Array, out: Float64Array): void {
    const mine = this.streets[node.street]![player]!;
    const theirs = this.streets[node.street]![1 - player]!;
    const ms = mine.strength;
    const ts = theirs.strength;
    const m1 = mine.card1;
    const m2 = mine.card2;
    const t1 = theirs.card1;
    const t2 = theirs.card2;
    const sums = this.cardSum;
    const nm = mine.n;
    const nt = theirs.n;

    // Weight of the weaker opponent hands each hand can face.
    sums.fill(0);
    let sum = 0;
    let k = 0;
    for (let h = 0; h < nm; h++) {
      const s = ms[h]!;
      while (k < nt && ts[k]! < s) {
        const r = oppReach[k]!;
        sum += r;
        sums[t1[k]!]! += r;
        sums[t2[k]!]! += r;
        k++;
      }
      out[h] = sum - sums[m1[h]!]! - sums[m2[h]!]!;
    }

    // Minus the weight of the stronger ones.
    sums.fill(0);
    sum = 0;
    k = nt - 1;
    const stake = node.stake;
    for (let h = nm - 1; h >= 0; h--) {
      const s = ms[h]!;
      while (k >= 0 && ts[k]! > s) {
        const r = oppReach[k]!;
        sum += r;
        sums[t1[k]!]! += r;
        sums[t2[k]!]! += r;
        k--;
      }
      out[h] = (out[h]! - (sum - sums[m1[h]!]! - sums[m2[h]!]!)) * stake;
    }
  }

  // --- Strategies ------------------------------------------------------------

  /** Regret matching: play each action in proportion to its positive regret. */
  private currentStrategy(nodeId: number): Float64Array {
    const node = this.nodes[nodeId]!;
    const actions = node.actions.length;
    const n = this.streets[node.street]![node.player]!.n;
    const regrets = this.regrets[nodeId]!;
    const out = this.strategy[nodeId]!;
    const uniform = 1 / actions;
    for (let h = 0; h < n; h++) {
      let total = 0;
      for (let a = 0; a < actions; a++) {
        const r = regrets[a * n + h]!;
        if (r > 0) total += r;
      }
      if (total > 0) {
        const inv = 1 / total;
        for (let a = 0; a < actions; a++) {
          const r = regrets[a * n + h]!;
          out[a * n + h] = r > 0 ? r * inv : 0;
        }
      } else {
        for (let a = 0; a < actions; a++) out[a * n + h] = uniform;
      }
    }
    return out;
  }

  /**
   * The average strategy at a node: `actions * hands` numbers, action by
   * action. This is the strategy that converges to equilibrium.
   */
  averageStrategy(nodeId: number, out?: Float64Array): Float64Array {
    const node = this.nodes[nodeId]!;
    const actions = node.actions.length;
    const n = this.streets[node.street]![node.player]!.n;
    const sums = this.strategySum[nodeId]!;
    const result = out ?? new Float64Array(actions * n);
    const uniform = 1 / actions;
    for (let h = 0; h < n; h++) {
      let total = 0;
      for (let a = 0; a < actions; a++) total += sums[a * n + h]!;
      if (total > 0) {
        const inv = 1 / total;
        for (let a = 0; a < actions; a++) result[a * n + h] = sums[a * n + h]! * inv;
      } else {
        for (let a = 0; a < actions; a++) result[a * n + h] = uniform;
      }
    }
    return result;
  }

  // --- Iteration -------------------------------------------------------------

  /** Runs `count` more iterations. */
  iterate(count: number = 1): void {
    for (let i = 0; i < count; i++) {
      const t = this.iteration;
      const ta = Math.pow(t, this.alpha);
      const tb = Math.pow(t, this.beta);
      this.posDiscount = ta / (ta + 1);
      this.negDiscount = tb / (tb + 1);
      this.sumDiscount = Math.pow(t / (t + 1), this.gamma);
      this.update(0, 0, this.hands[1].weight, this.hands[0].weight);
      this.update(0, 1, this.hands[0].weight, this.hands[1].weight);
      this.iteration = t + 1;
    }
  }

  /**
   * One regret update for `player` in the subtree below `nodeId`. Returns the
   * value of the node for each of the player's hands, weighted by the
   * opponent's reach.
   */
  private update(nodeId: number, player: number, oppReach: Float64Array, ownReach: Float64Array): Float64Array {
    const node = this.nodes[nodeId]!;
    const out = this.values[player]![nodeId]!;
    if (node.type !== DECISION) {
      if (node.type === FOLD) this.foldValue(node, player, oppReach, out);
      else if (node.type === CHANCE) this.deal(node, player, oppReach, ownReach, out, 0);
      else this.showdownValue(node, player, oppReach, out);
      return out;
    }

    const actions = node.actions.length;
    const strategy = this.currentStrategy(nodeId);
    const reach = this.childReach[nodeId]!;
    const children = node.children;
    const hands = this.streets[node.street]!;

    if (node.player !== player) {
      const n = hands[1 - player]!.n;
      const mine = hands[player]!.n;
      out.fill(0);
      for (let a = 0; a < actions; a++) {
        const next = reach[a]!;
        const base = a * n;
        for (let k = 0; k < n; k++) next[k] = oppReach[k]! * strategy[base + k]!;
        const value = this.update(children[a]!, player, next, ownReach);
        for (let h = 0; h < mine; h++) out[h]! += value[h]!;
      }
      return out;
    }

    const n = hands[player]!.n;
    out.fill(0);
    for (let a = 0; a < actions; a++) {
      const next = reach[a]!;
      const base = a * n;
      for (let h = 0; h < n; h++) next[h] = ownReach[h]! * strategy[base + h]!;
      const value = this.update(children[a]!, player, oppReach, next);
      for (let h = 0; h < n; h++) out[h]! += strategy[base + h]! * value[h]!;
    }

    const regrets = this.regrets[nodeId]!;
    const sums = this.strategySum[nodeId]!;
    const pos = this.posDiscount;
    const neg = this.negDiscount;
    const keep = this.sumDiscount;
    for (let a = 0; a < actions; a++) {
      const value = this.values[player]![children[a]!]!;
      const next = reach[a]!;
      const base = a * n;
      for (let h = 0; h < n; h++) {
        const r = regrets[base + h]!;
        regrets[base + h] = r * (r > 0 ? pos : neg) + value[h]! - out[h]!;
        sums[base + h] = sums[base + h]! * keep + next[h]!;
      }
    }
    return out;
  }

  /**
   * A chance node: every card that can come is dealt in turn. Reach vectors
   * are carried over to the hands still possible with that card, the subtree
   * is walked, and the values come back weighted by the card's probability.
   * `mode` 0 runs a regret update, 1 a best response, 2 the average strategies.
   */
  private deal(
    node: TreeNode,
    player: number,
    oppReach: Float64Array,
    ownReach: Float64Array | null,
    out: Float64Array,
    mode: 0 | 1 | 2,
  ): void {
    const weight = this.chanceWeight;
    out.fill(0);
    for (const childId of node.children) {
      const street = this.nodes[childId]!.street;
      const from = this.from[street]!;
      const mineFrom = from[player]!;
      const theirsFrom = from[1 - player]!;
      const theirs = this.dealt[street]![1 - player]!;
      for (let k = 0; k < theirs.length; k++) theirs[k] = oppReach[theirsFrom[k]!]!;
      let value: Float64Array;
      if (mode === 0) {
        const mine = this.dealt[street]![player]!;
        for (let h = 0; h < mine.length; h++) mine[h] = ownReach![mineFrom[h]!]!;
        value = this.update(childId, player, theirs, mine);
      } else {
        value = this.evaluate(childId, player, theirs, mode === 1);
      }
      for (let h = 0; h < mineFrom.length; h++) out[mineFrom[h]!]! += weight * value[h]!;
    }
  }

  // --- Measuring the result --------------------------------------------------

  /**
   * Value of the subtree for each hand of `player` when the opponent plays the
   * average strategy. With `best` set the player answers with the best action
   * for each hand; otherwise the player follows the average strategy too.
   */
  private evaluate(nodeId: number, player: number, oppReach: Float64Array, best: boolean): Float64Array {
    const node = this.nodes[nodeId]!;
    const out = this.values[player]![nodeId]!;
    if (node.type !== DECISION) {
      if (node.type === FOLD) this.foldValue(node, player, oppReach, out);
      else if (node.type === CHANCE) this.deal(node, player, oppReach, null, out, best ? 1 : 2);
      else this.showdownValue(node, player, oppReach, out);
      return out;
    }

    const actions = node.actions.length;
    const children = node.children;
    const average = this.averageStrategy(nodeId, this.strategy[nodeId]!);
    const hands = this.streets[node.street]!;

    if (node.player !== player) {
      const n = hands[1 - player]!.n;
      const mine = hands[player]!.n;
      const reach = this.childReach[nodeId]!;
      out.fill(0);
      for (let a = 0; a < actions; a++) {
        const next = reach[a]!;
        const base = a * n;
        for (let k = 0; k < n; k++) next[k] = oppReach[k]! * average[base + k]!;
        const value = this.evaluate(children[a]!, player, next, best);
        for (let h = 0; h < mine; h++) out[h]! += value[h]!;
      }
      return out;
    }

    const n = hands[player]!.n;
    if (best) {
      for (let a = 0; a < actions; a++) {
        const value = this.evaluate(children[a]!, player, oppReach, best);
        if (a === 0) out.set(value);
        else for (let h = 0; h < n; h++) if (value[h]! > out[h]!) out[h] = value[h]!;
      }
    } else {
      out.fill(0);
      for (let a = 0; a < actions; a++) {
        const value = this.evaluate(children[a]!, player, oppReach, best);
        const base = a * n;
        for (let h = 0; h < n; h++) out[h]! += average[base + h]! * value[h]!;
      }
    }
    return out;
  }

  private expectation(player: number, best: boolean): number {
    const mine = this.hands[player]!;
    const value = this.evaluate(0, player, this.hands[1 - player]!.weight, best);
    let total = 0;
    for (let h = 0; h < mine.n; h++) total += mine.weight[h]! * value[h]!;
    return total / this.dealWeight;
  }

  /**
   * What `player` wins per deal by answering the opponent's average strategy
   * perfectly. Chips, counted so the two players' results add up to zero.
   */
  bestResponseValue(player: number): number {
    return this.expectation(player, true);
  }

  /** What `player` wins per deal when both follow their average strategies. */
  gameValue(player: number): number {
    return this.expectation(player, false);
  }

  /**
   * Exploitability of the average strategies, in chips per deal: the mean of
   * what each player could gain by switching to a perfect answer. It is zero
   * exactly at equilibrium.
   */
  exploitability(): number {
    return (this.bestResponseValue(0) + this.bestResponseValue(1)) / 2;
  }

  /**
   * Chips each hand of `player` expects to end the street with out of the pot
   * when both follow their average strategies, net of what it puts in.
   */
  handValues(player: number): Float64Array {
    const mine = this.hands[player]!;
    const value = this.evaluate(0, player, this.hands[1 - player]!.weight, false).slice();
    const mass = new Float64Array(mine.n);
    this.reachableMass(player, this.hands[1 - player]!.weight, mass);
    const half = this.tree.config.pot / 2;
    for (let h = 0; h < mine.n; h++) value[h] = mass[h]! > 0 ? value[h]! / mass[h]! + half : NaN;
    return value;
  }

  /**
   * Reach of both players at a node under the average strategies: for each
   * hand, its starting weight times the probability its owner takes every
   * action on the way there.
   */
  reachAt(nodeId: number): [Float64Array, Float64Array] {
    const path: number[] = [];
    for (let id = nodeId; id > 0; id = this.nodes[id]!.parent) path.push(id);
    let reach: [Float64Array, Float64Array] = [this.hands[0].weight.slice(), this.hands[1].weight.slice()];
    for (let i = path.length - 1; i >= 0; i--) {
      const child = this.nodes[path[i]!]!;
      const parent = this.nodes[child.parent]!;
      if (parent.type === CHANCE) {
        const from = this.from[child.street]!;
        reach = [Float64Array.from(from[0], (h) => reach[0][h]!), Float64Array.from(from[1], (h) => reach[1][h]!)];
        continue;
      }
      const n = this.streets[parent.street]![parent.player]!.n;
      const average = this.averageStrategy(parent.id);
      const base = child.parentAction * n;
      const r = reach[parent.player]!;
      for (let h = 0; h < n; h++) r[h]! *= average[base + h]!;
    }
    return reach;
  }

  /**
   * Everything about one decision node under the average strategies: both
   * players' reach, the acting player's strategy, and what each action is
   * worth to each hand in chips (the hand's share of the starting pot plus
   * what it wins or loses on this street).
   */
  nodeDetail(nodeId: number): {
    player: number;
    reach: [Float64Array, Float64Array];
    /** For each hand of the acting player, the opponent weight it can face here. */
    facing: Float64Array;
    strategy: Float64Array;
    actionValues: Float64Array;
  } {
    const node = this.nodes[nodeId]!;
    if (node.type !== DECISION) throw new Error('Not a decision node');
    const player = node.player;
    const n = this.streets[node.street]![player]!.n;
    const actions = node.actions.length;
    const reach = this.reachAt(nodeId);
    const oppReach = reach[1 - player]!;
    const facing = new Float64Array(n);
    this.reachableMass(player, oppReach, facing, node.street);
    const strategy = this.averageStrategy(nodeId);
    const actionValues = new Float64Array(actions * n);
    const half = this.tree.config.pot / 2;
    for (let a = 0; a < actions; a++) {
      const value = this.evaluate(node.children[a]!, player, oppReach, false);
      for (let h = 0; h < n; h++) actionValues[a * n + h] = facing[h]! > 0 ? value[h]! / facing[h]! + half : NaN;
    }
    return { player, reach, facing, strategy, actionValues };
  }
}
