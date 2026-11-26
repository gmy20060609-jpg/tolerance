// The river solver: one spot, solved in a worker and shown as it converges.

import {
  CLASS_NAMES,
  COMBO_CLASS,
  COMBO_COUNT,
  COMBO_HI,
  COMBO_LO,
  RANK_CHARS,
  SUIT_CHARS,
  comboIndex,
  makeCard,
  parseCards,
} from '../engine/cards.ts';
import { parseRange, setClass } from '../engine/range.ts';
import { CHANCE, DECISION, type Action, type TreeConfig, type TreeNode } from '../engine/tree.ts';
import type { ComboDetail } from '../engine/view.ts';
import { PRESETS, type Pin, type Preset } from '../spots.ts';
import { card, cards } from '../ui/cards.ts';
import { ConvergenceChart } from '../ui/chart.ts';
import { frameLoop, gloss, h, keepFocus, reducedMotion, replace } from '../ui/dom.ts';
import { amount, frequency, integer, percent, seconds, share } from '../ui/format.ts';
import { Grid, swatch, type GridData, type SegStyle } from '../ui/grid.ts';
import type { Frame, Request, Response } from '../worker/protocol.ts';

const TOLERANCES = [0.01, 0.005, 0.003, 0.001, 0.0005, 0.0001];
const PLAYBACK = 42; // frames shown per second while a solve is replayed
const MAX_ITERATIONS = 6000;
const MAX_ITERATIONS_TURN = 400;

/** One step of a line of play: a kind of action and, if it matters, its size. */
interface Step {
  kind: string;
  to?: number;
}

interface Spot {
  board: number[];
  ranges: [Float64Array, Float64Array];
  tree: TreeConfig;
}

const cloneSpot = (preset: Preset): Spot => ({
  board: [...preset.spot.board],
  ranges: [Float64Array.from(preset.spot.ranges[0]), Float64Array.from(preset.spot.ranges[1])],
  tree: {
    ...preset.spot.tree,
    bets: [[...preset.spot.tree.bets[0]], [...preset.spot.tree.bets[1]]],
    raises: [[...preset.spot.tree.raises[0]], [...preset.spot.tree.raises[1]]],
  },
});

/** How the actions of a node are drawn: order across the bar and fill of each. */
function drawing(node: TreeNode): { order: number[]; styles: SegStyle[]; byAction: SegStyle[] } {
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

const CSS_FILL: Record<SegStyle, string> = {
  none: 'transparent',
  grey: 'var(--grey)',
  solid: 'var(--red)',
  ink: 'var(--ink)',
  hatch0: 'repeating-linear-gradient(135deg, var(--red) 0 1px, transparent 1px 5px)',
  hatch1: 'repeating-linear-gradient(135deg, var(--red) 0 1px, transparent 1px 2.5px)',
  hatch2: 'repeating-linear-gradient(135deg, var(--red) 0 1px, transparent 1px 3px), repeating-linear-gradient(45deg, var(--red) 0 1px, transparent 1px 3px)',
};

export class RiverView {
  readonly el: HTMLElement;
  private readonly worker: Worker;
  private preset: Preset = PRESETS[0]!;
  private spot: Spot = cloneSpot(PRESETS[0]!);
  private players: [string, string] = PRESETS[0]!.players;
  private tolerance = 0.0001;
  private job = 0;

  private nodes: TreeNode[] = [];
  private offsets: Int32Array = new Int32Array(0);
  private overallOffsets: Int32Array = new Int32Array(0);
  private hands: [number, number] = [0, 0];
  private frames: Frame[] = [];
  private status: 'solving' | 'done' | 'failed' = 'solving';
  private reason = '';
  private playhead = 0;
  private lastTick = 0;
  private scrub: number | null = null;
  private shown = -1;
  private nodeId = 0;
  private wantPath: Step[] | null = null;
  private selected = -1;
  private details = new Map<number, ComboDetail[]>();
  /** Pictures of nodes that come after a river card: asked for one at a time, not streamed. */
  private views = new Map<number, { iteration: number; freq: Uint8Array; fill: Uint8Array; overall: Float32Array }>();
  private solveTimer = 0;
  /** The chance node whose river is being chosen, or -1. */
  private dealing = -1;

  private readonly grid = new Grid('Strategy for each of the 169 starting hands. Arrow keys move, Enter selects.');
  private readonly chart = new ConvergenceChart();
  private readonly loop = frameLoop((time) => this.tick(time));

  // Elements that change.
  private readonly pathEl = h('nav.path', { 'aria-label': 'Line of play' });
  private readonly readoutEl = h('div.readout', { 'aria-live': 'off' });
  private readonly legendEl = h('div.legend');
  private readonly dealEl = h('div.deal');
  private readonly titleEl = h('span.zh', { lang: 'zh-Hans' });
  private readonly presetEl = h('select.field.spot-pick', { 'aria-label': 'Spot' }) as HTMLSelectElement;
  private readonly boardEl = h('div.board');
  private readonly storyEl = h('p.story');
  private readonly figureEl = h('div.figure', { 'aria-live': 'off' });
  private readonly labelEl = h('div.label');
  private readonly noteEl = h('span');
  private readonly playedEl = h('div.played');
  private readonly blockEl = h('dl.block');
  private readonly statusEl = h('span.status', { role: 'status' });
  private readonly detailEl = h('div');
  private readonly detailHead = h('h2');
  private readonly srTable = h('div.sr', { 'aria-live': 'polite' });
  private readonly editorEl = h('div.editor');
  private readonly rangeGrids: Grid[] = [];
  private readonly rangeHeads: HTMLElement[] = [];
  private readonly deckEl = h('div.deck', { role: 'group', 'aria-label': 'Board cards' });
  private readonly editorError = h('p.error', { role: 'alert' });
  private readonly inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};

  constructor() {
    this.worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<Response>) => this.receive(event.data);

    for (const preset of PRESETS) this.presetEl.append(h('option', { value: preset.id }, preset.title));
    this.presetEl.append(h('option', { value: 'custom', hidden: true }, 'Your own spot'));
    this.presetEl.addEventListener('change', () => {
      const preset = PRESETS.find((p) => p.id === this.presetEl.value);
      if (preset) this.load(preset);
    });

    this.grid.onhover = () => this.updateReadout();
    this.grid.onpick = (cell) => {
      this.selected = this.selected === cell ? -1 : cell;
      this.grid.selected = this.selected;
      this.grid.draw();
      this.renderDetail();
      this.updateReadout();
    };
    // While the grid has keyboard focus, each hand moved to is read out.
    this.grid.el.addEventListener('focusin', () => this.readoutEl.setAttribute('aria-live', 'polite'));
    this.grid.el.addEventListener('focusout', () => this.readoutEl.setAttribute('aria-live', 'off'));
    this.chart.onscrub = (index) => {
      this.scrub = index;
      this.loop.kick();
    };

    const stage = h(
      'div.stage',
      this.pathEl,
      this.grid.el,
      this.readoutEl,
      this.legendEl,
      this.dealEl,
      this.srTable,
    );

    const side = h(
      'div.side',
      h(
        'div.spot',
        h('div.spot-head', this.presetEl, this.titleEl),
        this.boardEl,
        this.storyEl,
      ),
      h(
        'div.result',
        this.labelEl,
        this.figureEl,
        h(
          'p.caption',
          'of the pot is the most a perfect opponent could still win from this strategy.',
          h('span.zh', { lang: 'zh-Hans' }, '可剥削度：完美的对手最多还能多赢走的底池比例'),
        ),
      ),
      h(
        'div.chart-wrap',
        { style: { display: 'grid', gap: '20px' } },
        this.chart.el,
        h('p.chart-note', this.noteEl),
      ),
      this.playedEl,
      this.blockEl,
      h(
        'div.controls',
        h('button.btn.primary', { onclick: () => this.solve() }, 'Solve again'),
        h('a.btn', { href: '#spot' }, 'Edit the spot'),
        this.statusEl,
      ),
    );

    this.el = h(
      'main',
      { id: 'main' },
      h('h1.sr', 'Tolerance: a heads-up river solver'),
      h('div.river', stage, side),
      h(
        'section.section',
        { id: 'hand' },
        h(
          'header',
          this.detailHead,
          h(
            'p',
            'Every combination of the selected hand that reaches this decision: how often it takes each action, and what each action is worth to it as a share of the pot. Pick a hand in the grid above.',
            h('span.zh', { lang: 'zh-Hans' }, '所选手牌的每个具体组合：各动作的频率，以及每个动作值多少底池。'),
          ),
        ),
        this.detailEl,
      ),
      h(
        'section.section',
        { id: 'spot' },
        h(
          'header',
          h('h2', gloss('The spot', '局面')),
          h(
            'p',
            'Paint either range, pick the board, set the money. Each change is solved again from nothing, down to the tolerance you choose.',
            h('span.zh', { lang: 'zh-Hans' }, '涂改任一方范围、选牌面、设筹码。每次改动都从零重新求解，直到达到你设的公差。'),
          ),
        ),
        this.editorEl,
      ),
    );

    this.buildEditor();
    this.load(PRESETS[0]!);
  }

  /** The hands actually held, while the spot is still the preset's hand. */
  private pins(): Preset['pins'] {
    return this.presetEl.value === 'custom' ? [] : this.preset.pins;
  }

  // --- Solving -------------------------------------------------------------------

  private send(request: Request): void {
    this.worker.postMessage(request);
  }

  private load(preset: Preset): void {
    clearTimeout(this.solveTimer);
    this.preset = preset;
    this.players = preset.players;
    this.spot = cloneSpot(preset);
    this.tolerance = preset.tolerance;
    this.presetEl.value = preset.id;
    this.wantPath = (preset.pins[0]?.path ?? []).map((kind) => ({ kind }));
    this.selected = -1;
    this.grid.selected = -1;
    this.syncEditor();
    this.solve();
  }

  /** Why the spot cannot be solved as it stands, or an empty string. */
  private problem(): string {
    if (this.spot.board.length < 4) return 'Pick at least four board cards: four for a turn, five for a river.';
    const dead = new Set(this.spot.board);
    for (let player = 0; player < 2; player++) {
      let any = false;
      for (let i = 0; i < COMBO_COUNT && !any; i++) {
        any = this.spot.ranges[player]![i]! > 0 && !dead.has(COMBO_HI[i]!) && !dead.has(COMBO_LO[i]!);
      }
      if (!any) return `${this.players[player]} has no hand left. Paint at least one.`;
    }
    return '';
  }

  private solve(): void {
    clearTimeout(this.solveTimer);
    const problem = this.problem();
    this.editorError.textContent = problem;
    if (problem) {
      // Nothing is sent; the last solution stays on screen, marked as out of date.
      this.statusEl.textContent = problem;
      return;
    }
    if (this.wantPath === null) this.wantPath = this.pathSteps(this.nodeId);
    this.job++;
    this.frames = [];
    this.details.clear();
    this.views.clear();
    this.status = 'solving';
    this.playhead = 0;
    this.lastTick = 0;
    this.scrub = null;
    this.shown = -1;
    this.statusEl.textContent = 'Solving';
    replace(this.noteEl, 'Solving.');
    this.renderSpot();
    // A turn carries 48 rivers with it, so it is kept to one bet size and one raise a street.
    const turn = this.spot.board.length === 4;
    const t = this.spot.tree;
    const tree: TreeConfig = turn
      ? { ...t, bets: [t.bets[0].slice(0, 1), t.bets[1].slice(0, 1)], raises: [t.raises[0].slice(0, 1), t.raises[1].slice(0, 1)], maxRaises: Math.min(1, t.maxRaises), allIn: false }
      : t;
    this.send({
      type: 'river',
      id: this.job,
      board: this.spot.board,
      ranges: this.spot.ranges,
      tree,
      tolerance: this.tolerance,
      maxIterations: turn ? MAX_ITERATIONS_TURN : MAX_ITERATIONS,
    });
  }

  private receive(message: Response): void {
    if (message.id !== this.job) return;
    switch (message.type) {
      case 'tree': {
        this.nodes = message.nodes;
        this.offsets = message.offsets;
        this.overallOffsets = message.overallOffsets;
        this.hands = message.hands;
        // Go back to where the view was. If the tree no longer has that line, stop where it ends.
        this.nodeId = Math.max(0, this.findPath(this.wantPath ?? [], false));
        this.wantPath = null;
        this.renderNode();
        this.renderBlock();
        this.renderPlayed();
        break;
      }
      case 'frame':
        this.frames.push(message);
        if (this.offsets[this.nodeId]! < 0 && this.frames.length % 5 === 0) this.send({ type: 'view', id: this.job, nodeId: this.nodeId });
        this.loop.kick();
        break;
      case 'view':
        this.views.set(message.nodeId, message);
        if (message.nodeId === this.nodeId) {
          this.shown = -1;
          this.loop.kick();
        }
        break;
      case 'done':
        this.status = 'done';
        this.reason = message.reason;
        for (const id of new Set([this.nodeId, ...this.pins().map((pin) => this.pinNode(pin))])) {
          if (this.nodes[id]?.type === DECISION) this.send({ type: 'detail', id: this.job, nodeId: id });
        }
        if (this.offsets[this.nodeId]! < 0) this.send({ type: 'view', id: this.job, nodeId: this.nodeId });
        this.shown = -1; // draw the last frame again, now as the finished one
        this.loop.kick();
        break;
      case 'detail':
        this.details.set(message.nodeId, message.combos);
        this.renderPlayed();
        if (message.nodeId === this.nodeId) this.renderDetail();
        break;
      case 'error':
        this.status = 'failed';
        this.loop.stop();
        this.statusEl.textContent = message.message;
        this.editorError.textContent = message.message;
        replace(this.noteEl, `Not solved: ${message.message}`);
        replace(this.figureEl, '–');
        this.labelEl.textContent = 'Not solved';
        this.grid.set({ k: 1, seg: new Float32Array(169), fill: new Float32Array(169), styles: ['none'], tone: new Uint8Array(169) });
        break;
    }
  }

  // --- Moving around the tree ----------------------------------------------------

  /**
   * The node reached by a line of play. Each step names a kind of action and,
   * where a node offers several of that kind, the size closest to the one
   * wanted; a 'deal' step names the card that comes. Returns -1 if the line
   * cannot be followed to the end, or, when `strict` is false, the last
   * decision it reaches.
   */
  private findPath(steps: Step[], strict: boolean): number {
    let id = 0;
    let reached = 0;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const node = this.nodes[id];
      if (!node) return strict ? -1 : 0;
      let next = -1;
      if (node.type === CHANCE) {
        const at = step.kind === 'deal' ? node.cards!.indexOf(step.to ?? -1) : -1;
        if (at >= 0) next = node.children[at]!;
      } else {
        let best = -1;
        node.actions.forEach((action, index) => {
          if (action.kind !== step.kind) return;
          if (best < 0 || (step.to !== undefined && Math.abs(action.to - step.to) < Math.abs(node.actions[best]!.to - step.to))) best = index;
        });
        if (best >= 0) next = node.children[best]!;
      }
      const child = this.nodes[next];
      const passes = child && (child.type === DECISION || (child.type === CHANCE && steps[i + 1]?.kind === 'deal'));
      if (!passes) return strict ? -1 : reached;
      id = next;
      if (child.type === DECISION) reached = id;
    }
    return this.nodes[id]?.type === DECISION ? id : strict ? -1 : reached;
  }

  private pathSteps(nodeId: number): Step[] {
    const steps: Step[] = [];
    for (let id = nodeId; id > 0 && this.nodes[id]; id = this.nodes[id]!.parent) {
      const parent = this.nodes[this.nodes[id]!.parent]!;
      const index = this.nodes[id]!.parentAction;
      if (parent.type === CHANCE) steps.unshift({ kind: 'deal', to: parent.cards![index]! });
      else steps.unshift({ kind: parent.actions[index]!.kind, to: parent.actions[index]!.to });
    }
    return steps;
  }

  /** The chance node a node sits under, with the card dealt there, if any. */
  private dealAbove(nodeId: number): { chance: TreeNode; card: number } | null {
    for (let id = nodeId; id > 0 && this.nodes[id]; id = this.nodes[id]!.parent) {
      const parent = this.nodes[this.nodes[id]!.parent]!;
      if (parent.type === CHANCE) return { chance: parent, card: parent.cards![this.nodes[id]!.parentAction]! };
    }
    return null;
  }

  /** The decision at which a hand was actually held, or -1 if this tree does not contain it. */
  private pinNode(pin: Pin): number {
    return this.nodes.length ? this.findPath(pin.path.map((kind) => ({ kind })), true) : -1;
  }

  private go(nodeId: number): void {
    if (this.nodes[nodeId]?.type !== DECISION) return;
    this.nodeId = nodeId;
    this.selected = -1;
    this.grid.selected = -1;
    if (this.status === 'done' && !this.details.has(nodeId)) this.send({ type: 'detail', id: this.job, nodeId });
    if (this.offsets[nodeId]! < 0 && !this.views.has(nodeId)) this.send({ type: 'view', id: this.job, nodeId });
    this.dealing = -1;
    this.renderNode();
    this.shown = -1;
    this.loop.kick();
    this.renderDetail();
  }

  private actionText(node: TreeNode, index: number): { name: string; size: string } {
    const action = node.actions[index]!;
    const pot = node.streetPot;
    const me = node.commit[node.player]!;
    const them = node.commit[1 - node.player]!;
    const unit = this.preset.unit === 'bb' ? ' bb' : '';
    switch (action.kind) {
      case 'fold':
        return { name: 'Fold', size: '' };
      case 'check':
        return { name: 'Check', size: '' };
      case 'call':
        return { name: 'Call', size: `${amount(them - me)}${unit}` };
      case 'allin':
        return { name: 'All-in', size: `${amount(action.to - me)}${unit}` };
      case 'bet':
        return { name: `Bet ${Math.round(((action.to - me) / (pot + me + them)) * 100)}%`, size: `${amount(action.to - me)}${unit}` };
      case 'raise':
        return { name: `Raise to ${amount(action.to)}`, size: `${Math.round(((action.to - them) / (pot + 2 * them)) * 100)}% of the pot` };
    }
  }

  private verb(action: Action, node: TreeNode): string {
    const { name } = this.actionText(node, node.actions.indexOf(action));
    switch (action.kind) {
      case 'fold':
        return 'folds';
      case 'check':
        return 'checks';
      case 'call':
        return 'calls';
      case 'allin':
        return 'moves all-in';
      case 'bet':
        return `bets ${name.slice(4)}`;
      case 'raise':
        return name.replace('Raise', 'raises');
    }
  }

  private renderNode(): void {
    const node = this.nodes[this.nodeId];
    if (!node) return;
    // The line of play. Each step leads to the decision that followed it.
    const first = this.spot.board.length === 4 ? 'Turn' : 'River';
    const steps: { to: number; text: (string | HTMLElement)[] }[] = [];
    for (let id = this.nodeId; id > 0; id = this.nodes[id]!.parent) {
      const parent = this.nodes[this.nodes[id]!.parent]!;
      const index = this.nodes[id]!.parentAction;
      if (parent.type === CHANCE) steps.unshift({ to: id, text: ['river ', card(parent.cards![index]!)] });
      else if (this.nodes[id]!.type === DECISION) steps.unshift({ to: id, text: [`${this.players[parent.player]} ${this.verb(parent.actions[index]!, parent)}`] });
      else steps.unshift({ to: -1, text: [`${this.players[parent.player]} ${this.verb(parent.actions[index]!, parent)}`] });
    }
    keepFocus(this.pathEl, () => replace(
      this.pathEl,
      steps.length ? h('button', { onclick: () => this.go(0) }, first) : h('span.dim', first),
      steps.map((step) => [
        h('span.sep', { 'aria-hidden': 'true' }, '/'),
        step.to < 0 || step.to === this.nodeId ? h('span.dim', step.text) : h('button', { onclick: () => this.go(step.to) }, step.text),
      ]),
      h('span.sep', { 'aria-hidden': 'true' }, '/'),
      h('span.now', `${this.players[node.player]} to act`),
    ));

    // The actions. One that ends the turn leads on to the choice of a river card.
    const look = drawing(node);
    keepFocus(this.legendEl, () => replace(
      this.legendEl,
      look.order.map((index) => {
        const { name, size } = this.actionText(node, index);
        const child = this.nodes[node.children[index]!]!;
        const deals = child.type === CHANCE && this.nodes[child.children[0]!]!.type === DECISION;
        const goes = child.type === DECISION || deals;
        return h(
          'button',
          {
            'data-go': String(goes),
            'data-action': String(index),
            'aria-expanded': deals ? String(this.dealing === child.id) : undefined,
            title: deals ? 'Deal a river card and see what follows' : goes ? `See how ${this.players[child.player]} answers` : undefined,
            onclick: () => {
              if (deals) {
                this.dealing = this.dealing === child.id ? -1 : child.id;
                this.renderNode();
              } else if (goes) this.go(child.id);
            },
          },
          swatch(look.byAction[index]!),
          h('span.name', name, goes ? ' →' : ''),
          h('span.share', '–'),
          h('span.size', size || ' '),
        );
      }),
    ));
    this.renderDeal();
    this.renderBoard();

    this.grid.marks = this.pins()
      .filter((pin) => this.pinNode(pin) === this.nodeId)
      .map((pin) => {
        const [a, b] = parseCards(pin.cards) as [number, number];
        return COMBO_CLASS[comboIndex(a, b)]!;
      });
  }

  /**
   * The river cards. Shown while one is being chosen after a line that ends
   * the turn, and under any river decision, to change the card in place.
   */
  private renderDeal(): void {
    const above = this.dealAbove(this.nodeId);
    const chance = this.dealing >= 0 ? this.nodes[this.dealing] : above?.chance;
    if (!chance || chance.type !== CHANCE) {
      this.dealEl.hidden = true;
      return;
    }
    this.dealEl.hidden = false;
    const current = this.dealing >= 0 ? -1 : (above?.card ?? -1);
    // Changing the card keeps the line of play: the same actions, on the new river.
    const tail = this.dealing >= 0 ? [] : this.pathSteps(this.nodeId).slice(this.pathSteps(above!.chance.children[above!.chance.cards!.indexOf(above!.card)]!).length);
    const deck = h('div.deck', { role: 'group', 'aria-label': 'River card' });
    for (let suit = 3; suit >= 0; suit--) {
      for (let rank = 12; rank >= 0; rank--) {
        const c = makeCard(rank, suit);
        const at = chance.cards!.indexOf(c);
        deck.append(
          h(
            'button',
            {
              disabled: at < 0,
              'aria-pressed': String(c === current),
              'aria-label': `${RANK_CHARS[rank]}${SUIT_CHARS[suit]}`,
              onclick: () => {
                const root = chance.children[at]!;
                const target = this.findPath([...this.pathSteps(root), ...tail], false);
                this.go(this.nodes[target]?.street === this.nodes[root]!.street ? target : root);
              },
            },
            at < 0 ? '' : card(c),
          ),
        );
      }
    }
    keepFocus(this.dealEl, () => replace(
      this.dealEl,
      h('div.sub', gloss(current >= 0 ? 'The river' : 'Deal the river', '发河牌'), h('span.dim', { style: { fontWeight: '400' } }, 'any of the 48 cards left')),
      deck,
    ));
  }

  private renderBoard(): void {
    const above = this.dealAbove(this.nodeId);
    replace(this.boardEl, cards(this.spot.board), above ? h('span.dealt', card(above.card)) : null);
  }

  /** What is drawn for the current node at a frame: frequencies, bar heights, totals. */
  private slice(index: number): { freq: Uint8Array; fill: Uint8Array; overall: Float32Array; before: Uint8Array; settled: boolean; streamed: boolean } | null {
    const node = this.nodes[this.nodeId];
    const frame = this.frames[index];
    if (!node || !frame) return null;
    const actions = node.actions.length;
    const done = this.status === 'done';
    const start = this.offsets[this.nodeId]!;
    if (start >= 0) {
      const at = this.overallOffsets[this.nodeId]!;
      const before = this.frames[Math.max(0, index - 4)]!;
      return {
        freq: frame.data.subarray(start, start + 169 * actions),
        fill: frame.data.subarray(start + 169 * actions, start + 169 * actions + 169),
        overall: frame.overall.subarray(at, at + actions),
        before: before.data.subarray(start, start + 169 * actions),
        settled: (done && index === this.frames.length - 1) || false,
        streamed: true,
      };
    }
    const view = this.views.get(this.nodeId);
    if (!view) return null;
    return { freq: view.freq, fill: view.fill, overall: view.overall, before: view.freq, settled: done, streamed: false };
  }

  // --- Drawing a frame -----------------------------------------------------------

  private tick(time: number): boolean {
    const last = this.frames.length - 1;
    if (last < 0) return this.status === 'solving';
    if (reducedMotion()) this.playhead = last;
    else if (this.playhead < last) {
      const dt = this.lastTick ? Math.min(100, time - this.lastTick) : 16;
      this.playhead = Math.min(last, this.playhead + (dt * PLAYBACK) / 1000);
    }
    this.lastTick = time;
    const index = this.scrub !== null ? Math.min(last, this.scrub) : Math.floor(this.playhead);
    if (index !== this.shown) {
      this.shown = index;
      this.render(index);
    }
    const playing = this.playhead < last || this.status === 'solving';
    if (!playing) this.lastTick = 0;
    return playing;
  }

  private gridData(index: number): GridData | null {
    const node = this.nodes[this.nodeId];
    const part = this.slice(index);
    if (!node || !part) return null;
    const actions = node.actions.length;
    const look = drawing(node);
    const seg = new Float32Array(169 * actions);
    const fill = new Float32Array(169);
    const tone = new Uint8Array(169);
    for (let c = 0; c < 169; c++) {
      const f = part.fill[c]!;
      if (!f) continue;
      fill[c] = f / 255;
      let moved = 0;
      for (let i = 0; i < actions; i++) {
        const a = look.order[i]!;
        const v = part.freq[c * actions + a]!;
        seg[c * actions + i] = v / 255;
        moved = Math.max(moved, Math.abs(v - part.before[c * actions + a]!));
      }
      tone[c] = part.settled || (part.streamed && index >= 4 && moved <= 3) ? 2 : 1;
    }
    return { k: actions, seg, fill, styles: look.styles, tone };
  }

  private render(index: number): void {
    const frame = this.frames[index]!;
    const data = this.gridData(index);
    this.grid.set(data ?? { k: 1, seg: new Float32Array(169), fill: new Float32Array(169), styles: ['none'], tone: new Uint8Array(169) });
    const lastFrame = this.frames[this.frames.length - 1]!;
    const atEnd = index === this.frames.length - 1;
    const finished = this.status === 'done' && atEnd;

    this.chart.set(
      this.frames.map((f) => ({ iteration: f.iteration, value: f.exploitability })),
      index,
      this.tolerance,
    );

    const text = percent(frame.exploitability);
    replace(this.figureEl, text.slice(0, -1), h('span.unit', '%'));
    this.labelEl.textContent = finished
      ? `After ${integer(frame.iteration)} iterations, exploitable for`
      : `At iteration ${integer(frame.iteration)}, exploitable for`;

    // The legend's figures.
    const part = this.slice(index);
    this.legendEl.querySelectorAll<HTMLElement>('button').forEach((button) => {
      const action = Number(button.dataset.action);
      button.querySelector('.share')!.textContent = part ? frequency(part.overall[action]!) : '–';
    });

    if (this.status === 'done') {
      const how =
        this.reason === 'tolerance'
          ? `Solved to tolerance in ${seconds(lastFrame.ms)}, ${integer(lastFrame.iteration)} iterations.`
          : this.reason === 'stopped'
            ? `Stopped after ${integer(lastFrame.iteration)} iterations, ${seconds(lastFrame.ms)}.`
            : `Stopped at the limit of ${integer(lastFrame.iteration)} iterations, ${seconds(lastFrame.ms)}.`;
      // A fast solve is over before it can be watched, so it is replayed; a slow one was shown as it ran.
      const replayed = lastFrame.ms < 1500;
      replace(
        this.noteEl,
        replayed ? `${how} Replayed here at reading speed: drag across the chart to step through it.` : `${how} Drag across the chart to step back through it.`,
        h(
          'span.zh',
          { lang: 'zh-Hans' },
          replayed ? ` 实际求解 ${seconds(lastFrame.ms)}，此处按可读速度重放；在图上拖动可逐步回看。` : ` 求解用时 ${seconds(lastFrame.ms)}；在图上拖动可逐步回看。`,
        ),
      );
    } else {
      replace(this.noteEl, `Solving. ${seconds(lastFrame.ms)} so far.`);
    }
    this.statusEl.textContent = this.problem() || (finished ? '' : this.scrub !== null ? `Iteration ${integer(frame.iteration)}` : 'Solving');
    this.updateReadout();
    if (finished) this.announce();
  }

  private updateReadout(): void {
    const node = this.nodes[this.nodeId];
    const part = this.shown >= 0 ? this.slice(this.shown) : null;
    const cell = this.grid.hover >= 0 ? this.grid.hover : this.selected;
    if (!node) return;
    if (!part) {
      replace(this.readoutEl, h('span.what', `${this.players[node.player]}, hand by hand`), h('span.dim', 'Reading this river'));
      return;
    }
    const actions = node.actions.length;
    if (cell < 0) {
      let inPlay = 0;
      let settled = 0;
      for (let c = 0; c < 169; c++) {
        if (!part.fill[c]) continue;
        inPlay++;
        let moved = 0;
        for (let a = 0; a < actions; a++) moved = Math.max(moved, Math.abs(part.freq[c * actions + a]! - part.before[c * actions + a]!));
        if (part.settled || (part.streamed && this.shown >= 4 && moved <= 3)) settled++;
      }
      replace(
        this.readoutEl,
        h('span.what', `${this.players[node.player]}, hand by hand`),
        h('span.dim', part.streamed || part.settled ? `${settled} of ${inPlay} hands settled` : 'Still solving: this river updates as it goes'),
      );
      return;
    }
    if (!part.fill[cell]) {
      replace(this.readoutEl, h('span.what', h('b', CLASS_NAMES[cell]!), ' is not in the range here'), h('span'));
      return;
    }
    const look = drawing(node);
    const parts = look.order
      .map((a) => ({ a, f: part.freq[cell * actions + a]! / 255 }))
      .filter((p) => p.f >= 0.005)
      .map((p) => `${this.actionText(node, p.a).name} ${frequency(p.f, 0)}`);
    replace(this.readoutEl, h('span.what', h('b', CLASS_NAMES[cell]!), '  ', parts.join(', ')), h('span.dim', 'Select for every combination'));
  }

  /** A text version of the result for screen readers. */
  private announce(): void {
    const node = this.nodes[this.nodeId];
    const frame = this.frames[this.frames.length - 1];
    const part = this.slice(this.frames.length - 1);
    if (!node || !frame || !part) return;
    const parts = node.actions.map((_, i) => `${this.actionText(node, i).name} ${frequency(part.overall[i]!)}`);
    this.srTable.textContent = `Solved. Exploitable for ${percent(frame.exploitability)} of the pot. ${this.players[node.player]}: ${parts.join(', ')}.`;
  }

  // --- The fixed parts of the side column ------------------------------------------

  private renderSpot(): void {
    const custom = this.presetEl.value === 'custom';
    this.titleEl.textContent = custom ? '你自己的局面' : this.preset.titleZh;
    this.renderBoard();
    replace(
      this.storyEl,
      custom ? 'A spot of your own: the board, the money and the ranges are whatever you set below.' : this.preset.line,
      h('span.zh', { lang: 'zh-Hans' }, custom ? '你自己设的局面。' : this.preset.lineZh),
    );
    this.renderPlayed();
  }

  private renderBlock(): void {
    const unit = this.preset.unit === 'bb' ? ' bb' : '';
    const decisions = this.nodes.filter((node) => node.type === DECISION).length;
    const turn = this.spot.board.length === 4;
    const onTurn = this.nodes.filter((node) => node.type === DECISION && node.street === 0).length;
    const toleranceEl = h('select.field', { 'aria-label': 'Tolerance', style: { width: 'auto', padding: '0 18px 0 0', border: '0' } }) as HTMLSelectElement;
    for (const t of TOLERANCES) toleranceEl.append(h('option', { value: String(t), selected: t === this.tolerance }, `${percent(t, 1)} of the pot`));
    toleranceEl.addEventListener('change', () => {
      this.tolerance = Number(toleranceEl.value);
      this.solve();
    });
    keepFocus(this.blockEl, () => replace(
      this.blockEl,
      h('dt', gloss('Pot', '底池')),
      h('dd', `${amount(this.spot.tree.pot)}${unit}`),
      h('dt', gloss('Behind', '后手')),
      h('dd', `${amount(this.spot.tree.stack)}${unit} each`),
      h('dt', gloss('Ranges', '范围')),
      h('dd', `${this.players[0]} ${this.hands[0]} combinations, ${this.players[1]} ${this.hands[1]}`),
      h('dt', gloss('Tree', '下注树')),
      h(
        'dd',
        turn
          ? `${onTurn} decisions on the turn, ${integer(decisions)} with all 48 rivers; one bet size and one raise a street`
          : `${decisions} decisions, ${this.nodes.length - decisions} endings`,
      ),
      h('dt', gloss('Method', '方法')),
      h('dd', 'Discounted CFR, checked by best response'),
      h('dt', gloss('Tolerance', '公差')),
      h('dd', toleranceEl),
    ));
  }

  private renderPlayed(): void {
    if (!this.pins().length) {
      this.playedEl.hidden = true;
      return;
    }
    this.playedEl.hidden = false;
    const did: Record<string, string> = { allin: 'moved all-in', fold: 'folded', call: 'called', check: 'checked', bet: 'bet', raise: 'raised' };
    keepFocus(this.playedEl, () => replace(
      this.playedEl,
      this.pins().map((pin) => {
        const [a, b] = parseCards(pin.cards) as [number, number];
        const nodeId = this.pinNode(pin);
        const node = this.nodes[nodeId];
        const known = this.details.get(nodeId);
        const combo = known?.find((d) => d.combo === comboIndex(a, b));
        let answer = 'Solving';
        if (this.nodes.length && !node) answer = 'not a line in this tree';
        else if (known && !combo) answer = 'not in the range assumed';
        if (node && combo) {
          answer = drawing(node)
            .order.map((i) => ({ i, f: combo.strategy[i]! }))
            .filter((p) => p.f >= 0.005)
            .sort((x, y) => y.f - x.f)
            .map((p) => `${this.actionText(node, p.i).name.toLowerCase()} ${frequency(p.f, 0)}`)
            .join(', ');
        }
        return h(
          'button',
          {
            onclick: () => {
              if (nodeId >= 0) this.go(nodeId);
              this.selected = COMBO_CLASS[comboIndex(a, b)]!;
              this.grid.selected = this.selected;
              this.grid.draw();
              this.renderDetail();
              this.updateReadout();
            },
          },
          h('span.who', `${pin.who} held `, cards([a, b]), ` and ${did[pin.did] ?? pin.did}. Solved:`),
          h('span.answer', answer),
        );
      }),
      h(
        'p.dim',
        'Nobody knows the ranges the two were playing. These answers hold for the ranges assumed ',
        h('a', { href: '#spot' }, 'below'),
        '; change them and it solves again.',
        h('span.zh', { lang: 'zh-Hans' }, '两人当时的范围无人知道。以上结果只在下方假设的范围下成立，改了就重解。'),
      ),
    ));
  }

  // --- Every combination of the selected hand --------------------------------------

  private renderDetail(): void {
    const node = this.nodes[this.nodeId];
    const cell = this.selected >= 0 ? this.selected : (this.grid.marks[0] ?? -1);
    replace(this.detailHead, gloss(cell >= 0 ? `${CLASS_NAMES[cell]}, combination by combination` : 'Combination by combination', '逐个组合'));
    if (!node) return;
    const combos = this.details.get(this.nodeId);
    if (cell < 0) {
      replace(this.detailEl, h('p.dim', 'No hand selected.'));
      return;
    }
    if (!combos) {
      replace(this.detailEl, h('p.dim', this.status === 'done' ? 'Reading the solution.' : 'Solving.'));
      return;
    }
    const rows = combos.filter((d) => COMBO_CLASS[d.combo] === cell);
    if (!rows.length) {
      replace(this.detailEl, h('p.dim', `${CLASS_NAMES[cell]} does not reach this decision.`));
      return;
    }
    const look = drawing(node);
    const pot = this.spot.tree.pot;
    const table = h(
      'table.combos',
      h(
        'thead',
        h(
          'tr',
          h('th', { scope: 'col' }, 'Hand'),
          h('th', { scope: 'col' }, 'In range'),
          h('th', { scope: 'col', 'aria-label': 'Mix' }),
          look.order.map((i) => h('th', { scope: 'col' }, this.actionText(node, i).name)),
          h('th', { scope: 'col' }, 'Worth'),
        ),
      ),
      h(
        'tbody',
        rows.map((d) => {
          const best = Math.max(...d.actionValues);
          return h(
            'tr',
            h('td', cards([COMBO_HI[d.combo]!, COMBO_LO[d.combo]!])),
            h('td', frequency(d.reach, 0)),
            h(
              'td.bar',
              h(
                'div.mix',
                { role: 'img', 'aria-label': 'Mix of actions' },
                look.order.map((i) => h('i', { style: { width: `${d.strategy[i]! * 100}%`, background: CSS_FILL[look.byAction[i]!] } })),
              ),
            ),
            look.order.map((i) =>
              h(
                'td',
                { class: d.actionValues[i]! >= best - 1e-9 * pot ? 'best' : '' },
                frequency(d.strategy[i]!, 0),
                h('span.faint', `  ${share(d.actionValues[i]! / pot)}`),
              ),
            ),
            h('td', share(d.value / pot)),
          );
        }),
      ),
    );
    replace(
      this.detailEl,
      h('div', { style: { overflowX: 'auto' } }, table),
      h(
        'p.dim',
        { style: { marginTop: '12px', maxWidth: '72ch' } },
        'Beside each frequency is what that action is worth to the hand, as a share of the starting pot. Where a hand mixes, its actions are worth the same, or nearly: the gap is part of what the tolerance measures.',
      ),
    );
  }

  // --- Editing the spot ------------------------------------------------------------

  private buildEditor(): void {
    const rangeColumn = (player: number) => {
      const grid = new Grid(`Range of player ${player + 1}. Arrow keys move, Enter toggles a hand.`);
      let value = 1;
      grid.onpaint = (cell, first) => {
        if (first) value = this.classWeight(player, cell) > 0.5 ? 0 : 1;
        setClass(this.spot.ranges[player]!, cell, value);
        this.edited();
      };
      this.rangeGrids[player] = grid;
      const head = h('h3');
      this.rangeHeads[player] = head;
      const text = h('textarea.field', {
        rows: 2,
        placeholder: 'Or type it: QQ+, AKs, A5s-A2s, KQo:0.5',
        'aria-label': `Range of player ${player + 1} as text`,
        spellcheck: false,
      }) as HTMLTextAreaElement;
      text.addEventListener('change', () => {
        if (!text.value.trim()) return;
        try {
          this.spot.ranges[player] = parseRange(text.value);
          this.editorError.textContent = '';
          this.edited();
        } catch (error) {
          this.editorError.textContent = error instanceof Error ? error.message : String(error);
        }
      });
      return h('div.range', head, grid.el, text);
    };

    for (let suit = 3; suit >= 0; suit--) {
      for (let rank = 12; rank >= 0; rank--) {
        const c = makeCard(rank, suit);
        this.deckEl.append(
          h(
            'button',
            {
              'data-card': String(c),
              'aria-pressed': 'false',
              'aria-label': `${RANK_CHARS[rank]}${SUIT_CHARS[suit]}`,
              onclick: () => {
                const at = this.spot.board.indexOf(c);
                if (at >= 0) this.spot.board.splice(at, 1);
                else if (this.spot.board.length < 5) this.spot.board.push(c);
                else return;
                this.edited();
              },
            },
            card(c),
          ),
        );
      }
    }

    const number = (key: string, label: HTMLElement, attrs: Record<string, unknown> = {}) => {
      const input = h('input.field', { type: 'text', inputmode: 'decimal', autocomplete: 'off', ...attrs }) as HTMLInputElement;
      input.addEventListener('change', () => this.readInputs());
      this.inputs[key] = input;
      return h('label', label, input);
    };
    const raises = h('select.field') as HTMLSelectElement;
    for (const n of [0, 1, 2, 3]) raises.append(h('option', { value: String(n) }, String(n)));
    raises.addEventListener('change', () => this.readInputs());
    this.inputs.maxRaises = raises;
    const allIn = h('select.field') as HTMLSelectElement;
    allIn.append(h('option', { value: '1' }, 'Offered'), h('option', { value: '0' }, 'Not offered'));
    allIn.addEventListener('change', () => this.readInputs());
    this.inputs.allIn = allIn;

    replace(
      this.editorEl,
      rangeColumn(0),
      rangeColumn(1),
      h(
        'div.setup',
        h('div', h('div.sub', gloss('Board', '牌面'), h('span.dim', 'five cards for a river, four for a turn')), this.deckEl),
        h('div.two', number('pot', gloss('Pot', '底池')), number('stack', gloss('Behind, each', '后手'))),
        h(
          'div.two',
          number('bets0', gloss('Bets, first to act, % of pot', '先行动方下注')),
          number('bets1', gloss('Bets, last to act, % of pot', '后行动方下注')),
        ),
        h('div.two', number('raises', gloss('Raises, % of pot', '加注')), h('label', gloss('Raises allowed', '加注次数'), raises)),
        h('div.two', h('label', gloss('All-in', '全下'), allIn), h('div')),
        this.editorError,
      ),
    );
  }

  private classWeight(player: number, cell: number): number {
    const dead = new Set(this.spot.board);
    let sum = 0;
    let count = 0;
    for (let i = 0; i < COMBO_COUNT; i++) {
      if (COMBO_CLASS[i] !== cell || dead.has(COMBO_HI[i]!) || dead.has(COMBO_LO[i]!)) continue;
      sum += this.spot.ranges[player]![i]!;
      count++;
    }
    return count ? sum / count : 0;
  }

  private syncEditor(): void {
    const { tree } = this.spot;
    const list = (values: number[]) => values.map((v) => Math.round(v * 1000) / 10).join(', ');
    (this.inputs.pot as HTMLInputElement).value = String(tree.pot);
    (this.inputs.stack as HTMLInputElement).value = String(tree.stack);
    (this.inputs.bets0 as HTMLInputElement).value = list(tree.bets[0]);
    (this.inputs.bets1 as HTMLInputElement).value = list(tree.bets[1]);
    (this.inputs.raises as HTMLInputElement).value = list(tree.raises[0]);
    this.inputs.maxRaises!.value = String(tree.maxRaises);
    this.inputs.allIn!.value = tree.allIn ? '1' : '0';
    this.drawEditor();
  }

  private drawEditor(): void {
    const dead = new Set(this.spot.board);
    this.deckEl.querySelectorAll<HTMLElement>('button').forEach((button) => {
      button.setAttribute('aria-pressed', String(dead.has(Number(button.dataset.card))));
    });
    for (let player = 0; player < 2; player++) {
      const fill = new Float32Array(169);
      const seg = new Float32Array(169).fill(1);
      const tone = new Uint8Array(169);
      let combos = 0;
      for (let cell = 0; cell < 169; cell++) {
        fill[cell] = this.classWeight(player, cell);
        tone[cell] = fill[cell]! > 0 ? 2 : 0;
      }
      for (let i = 0; i < COMBO_COUNT; i++) {
        if (!dead.has(COMBO_HI[i]!) && !dead.has(COMBO_LO[i]!) && this.spot.ranges[player]![i]! > 0) combos++;
      }
      this.rangeGrids[player]!.set({ k: 1, seg, fill, styles: ['grey'], tone });
      replace(
        this.rangeHeads[player]!,
        h('span', `${this.players[player]}`, h('span.zh', { lang: 'zh-Hans' }, player === 0 ? '先行动' : '后行动')),
        h('span.dim', { style: { fontWeight: '400' } }, `${combos} combinations`),
      );
    }
  }

  private readInputs(): void {
    const value = (key: string) => (this.inputs[key] as HTMLInputElement).value;
    const sizes = (key: string) =>
      value(key)
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((v) => Number(v) / 100);
    const pot = Number(value('pot').replace(/,/g, ''));
    const stack = Number(value('stack').replace(/,/g, ''));
    const all = [...sizes('bets0'), ...sizes('bets1'), ...sizes('raises')];
    if (!(pot > 0) || !(stack >= 0) || all.some((v) => !(v > 0) || v > 100)) {
      this.editorError.textContent = 'The pot must be positive, the stack zero or more, and every size a positive percentage.';
      return;
    }
    if (sizes('bets0').length > 4 || sizes('bets1').length > 4 || sizes('raises').length > 3) {
      this.editorError.textContent = 'At most four bet sizes and three raise sizes a player.';
      return;
    }
    this.editorError.textContent = '';
    this.spot.tree = {
      pot,
      stack,
      bets: [sizes('bets0'), sizes('bets1')],
      raises: [sizes('raises'), sizes('raises')],
      maxRaises: Number(value('maxRaises')),
      allIn: value('allIn') === '1',
      allInThreshold: 0.67,
    };
    this.edited();
  }

  /**
   * Something in the spot changed: redraw the editor and solve again shortly.
   * New ranges or bet sizes are a different reading of the same hand; a
   * different board or different money make it a different hand.
   */
  private edited(): void {
    const preset = this.preset.spot;
    const same =
      this.spot.board.length === preset.board.length &&
      this.spot.board.every((c) => preset.board.includes(c)) &&
      this.spot.tree.pot === preset.tree.pot &&
      this.spot.tree.stack === preset.tree.stack;
    this.presetEl.value = same ? this.preset.id : 'custom';
    this.players = same ? this.preset.players : ['First player', 'Second player'];
    this.drawEditor();
    clearTimeout(this.solveTimer);
    const problem = this.problem();
    this.editorError.textContent = problem;
    if (problem) {
      this.statusEl.textContent = problem;
      return;
    }
    this.solveTimer = window.setTimeout(() => this.solve(), 220);
  }
}
