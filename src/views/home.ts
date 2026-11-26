// The front page: one hand from 2003, solved in the tab as the page opens,
// and drawn to the tolerance the reader picks.

import { CLASS_NAMES, COMBO_CLASS, comboIndex, parseCards } from '../engine/cards.ts';
import { DECISION, type TreeNode } from '../engine/tree.ts';
import type { ComboDetail } from '../engine/view.ts';
import { PRESETS } from '../spots.ts';
import { cards } from '../ui/cards.ts';
import { frameLoop, gloss, h, reducedMotion, replace } from '../ui/dom.ts';
import { frequency, integer, percent, seconds } from '../ui/format.ts';
import { Grid, type GridData } from '../ui/grid.ts';
import { CSS_FILL, drawing } from '../ui/look.ts';
import { LineScreen } from '../ui/screen.ts';
import type { Frame, Request, Response } from '../worker/protocol.ts';

const HAND = PRESETS[0]!;
const TOLERANCES = [0.01, 0.005, 0.003, 0.001, 0.0005, 0.0001];
/** Line pitch of the pictures at each tolerance, in CSS pixels; the last is the finest the screen can hold. */
const PITCHES = [18, 13, 10, 7, 5, 3.2];
const UNSOLVED = 40;
const STEP = 230; // ms between tolerances as the page opens
const PLAYBACK = 42; // frames a second when the grids replay the solve

interface Stop {
  tolerance: number;
  exploitability: number;
  iterations: number;
  ms: number;
  /** Per held hand: the mix of actions, in drawing order. */
  held: { name: string; share: number; fill: string }[][];
}

const zh = (text: string) => h('span.zh', { lang: 'zh-Hans' }, text);

export class HomeView {
  readonly el: HTMLElement;
  private worker: Worker | null = null;
  private nodes: TreeNode[] = [];
  private offsets: Int32Array = new Int32Array(0);
  /** The two decisions of the hand as played: Moneymaker's bet, Farha's answer. */
  private spots: [number, number] = [-1, -1];
  private stops: Stop[] = [];
  private frames: Frame[] = [];
  private job = 0;
  private waiting = 0;
  private details = new Map<number, ComboDetail[]>();
  private last: Frame | null = null;
  private shown = -1;
  private picked = false;
  private timer = 0;

  private readonly hero = new LineScreen('img/farha-2010.jpg', {
    alt: 'Sam Farha at a poker table, leaning on his forearm and looking across it, chips stacked in front of him.',
    focus: [0.5, 0.36],
    eager: true,
  });
  private readonly figureEl = h('div.figure', '–');
  private readonly figureNote = h('p.caption');
  private readonly answerEl = h('div.answer-now');
  private readonly rulerEl = h('div.stops', { role: 'group', 'aria-label': 'Tolerance' });
  private readonly srEl = h('p.sr', { role: 'status' });

  private readonly grids = [new Grid('Moneymaker’s strategy after Farha checks, hand by hand'), new Grid('Farha’s answer to the all-in, hand by hand')];
  private readonly heldEls = [h('div.held'), h('div.held')];
  private readonly replayNote = h('span');
  private playhead = 0;
  private lastTick = 0;
  private played = false;
  private readonly loop = frameLoop((time) => this.tick(time));

  constructor() {
    this.hero.pitch = UNSOLVED;
    TOLERANCES.forEach((t, i) => {
      this.rulerEl.append(
        h('button', { disabled: true, 'aria-pressed': 'false', onclick: () => this.pick(i) }, `${+(t * 100).toFixed(2)}%`),
      );
    });

    this.el = h(
      'main.home',
      { id: 'main' },
      this.buildHero(),
      this.buildHand(),
      this.buildPlace(),
      this.buildTools(),
      this.buildProof(),
      this.buildEnd(),
    );

    // Pictures below the first screen are drawn coarse and tighten as they come into view.
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          seen.unobserve(entry.target);
          const screen = this.reveals.get(entry.target);
          if (screen) this.tighten(screen);
          else this.replay();
        }
      },
      { threshold: 0.35 },
    );
    for (const el of this.reveals.keys()) seen.observe(el);
    seen.observe(this.grids[0]!.el);

    this.solve();
  }

  private readonly reveals = new Map<Element, LineScreen>();

  private picture(src: string, alt: string, focus: [number, number], caption: (string | HTMLElement)[]): HTMLElement {
    const screen = new LineScreen(src, { alt, focus });
    screen.pitch = reducedMotion() ? PITCHES[5]! : 28;
    this.reveals.set(screen.el, screen);
    return h('figure.pic', screen.el, h('figcaption', caption));
  }

  private tighten(screen: LineScreen): void {
    const steps = [20, 14, 10, 7, 5, PITCHES[5]!];
    steps.forEach((pitch, i) => setTimeout(() => (screen.pitch = pitch), reducedMotion() ? 0 : 140 * (i + 1)));
  }

  // --- The page ------------------------------------------------------------------

  private buildHero(): HTMLElement {
    return h(
      'section.hero',
      h(
        'figure.hero-pic',
        this.hero.el,
        h(
          'figcaption',
          'Sam Farha at the World Series of Poker, 2010. Photograph: flipchip, LasVegasVegas.com, CC BY-SA 3.0. Drawn as a line screen: the looser the tolerance, the coarser the line.',
        ),
      ),
      h(
        'div.hero-text',
        h('h1', 'Every answer, with its error.', zh('每个答案，都带着它的误差。')),
        h(
          'div.hero-solve',
          h(
            'p.lede',
            'Las Vegas, 2003. Sam Farha holds top pair, and Chris Moneymaker has just moved all-in. This tab has solved the river they played, to within',
            zh('2003 年，拉斯维加斯。Farha 拿着顶对，Moneymaker 刚刚全下。这个网页已经把这条河牌解到误差不超过'),
          ),
          this.figureEl,
          this.figureNote,
          this.answerEl,
        ),
        h(
          'div.hero-foot',
          h('div.stops-wrap', h('span.stops-label', gloss('Tolerance', '公差')), this.rulerEl),
          h(
            'div.hero-go',
            h('a.btn.primary', { href: '#river' }, 'Open the solver'),
            h('a.link', { href: '#proof' }, 'How it was checked'),
          ),
        ),
        this.srEl,
      ),
    );
  }

  private buildHand(): HTMLElement {
    const board = HAND.spot.board;
    return h(
      'section.chapter.hand',
      h('h2', 'King high, all‑in, for the title.', zh('K 高牌，全下，争的是冠军。')),
      h(
        'div.hand-top',
        this.picture('img/moneymaker-2008.jpg', 'Chris Moneymaker, close up, looking straight at the camera from under the brim of a cap.', [0.55, 0.4], [
          'Chris Moneymaker, Monte Carlo, 2008. Photograph: Equipo Unibet, CC BY 2.0, cropped.',
        ]),
        h(
          'div.hand-story',
          h('div.hand-board', cards(board)),
          h(
            'p.big',
            'The World Series of Poker Main Event is down to two players. Farha checks the river. Moneymaker, an accountant who won his seat online, holds ',
            cards(parseCards('Ks7h')),
            ', which is nothing. He moves all-in: 2,795,000 into a pot of 1,810,000. Farha holds ',
            cards(parseCards('Qs9h')),
            ', top pair, and folds.',
          ),
          h(
            'p.big.zh-block',
            { lang: 'zh-Hans' },
            '世界扑克大赛主赛事只剩两人。河牌 Farha 过牌。Moneymaker 是个会计，参赛资格是网上赢来的，手里的 K7 什么都没中。他全下 2,795,000，底池 1,810,000。Farha 拿着顶对 Q9，弃牌。',
          ),
          h(
            'p.dim',
            'Cards, bets and stacks as reported by ',
            h('a', { href: 'https://www.pokernews.com/strategy/analyzing-moneymaker-bluff-of-the-century-against-farha-35218.htm', target: '_blank', rel: 'noopener' }, 'PokerNews'),
            '. Was the bluff right, and was the fold? That depends on every other hand each of them could have held, so the solver works out all of them at once.',
            zh('牌、下注和筹码以 PokerNews 的报道为准。诈唬对不对、弃牌对不对，取决于双方可能拿到的所有其他手牌，所以求解器是把全部手牌一起算的。'),
          ),
        ),
      ),
      h(
        'div.hand-grids',
        h(
          'div.hand-grid',
          h('h3', 'Moneymaker, after the check', zh('Farha 过牌后')),
          this.grids[0]!.el,
          this.heldEls[0]!,
        ),
        h(
          'div.hand-grid',
          h('h3', 'Farha, against the all-in', zh('面对全下')),
          this.grids[1]!.el,
          this.heldEls[1]!,
        ),
      ),
      h(
        'div.hand-foot',
        h(
          'p.dim',
          'Each square is one of the 169 starting hands. Solid red moves all-in, hatched red bets less, grey checks or calls, blank folds. ',
          this.replayNote,
          zh('每格是 169 种起手牌之一。实心红全下，斜线红是较小的下注，灰色过牌或跟注，空白弃牌。'),
        ),
        h(
          'p.dim',
          'Nobody knows the ranges the two were playing. These answers hold for the ranges assumed, which are written out in the solver; change them and it answers again.',
          zh('两人当时的范围无人知道。答案只在假设的范围下成立，范围写在求解器里，改了就重解。'),
        ),
        h('div.hero-go', h('a.btn.primary', { href: '#river' }, 'Open this hand in the solver'), h('button.link', { onclick: () => this.replay(true) }, 'Replay the solve')),
      ),
    );
  }

  private buildPlace(): HTMLElement {
    return h(
      'section.place',
      h(
        'div.place-text',
        h('h2', 'Binion’s Horseshoe, Fremont Street.', zh('弗里蒙特街，宾尼恩马蹄铁赌场。')),
        h(
          'p.big',
          'The World Series of Poker began here in 1970, and the 2003 final was played here. 839 players entered that year. An amateur won it on television, and the year after, 2,576 entered.',
        ),
        h('p.big.zh-block', { lang: 'zh-Hans' }, '世界扑克大赛 1970 年在这里开始，2003 年的决赛也在这里打。那年 839 人参赛。一个业余选手在电视上赢了冠军，第二年来了 2,576 人。'),
        h('div.place-figures', h('div', h('b', '839'), h('span', '2003')), h('div', h('b', '2,576'), h('span', '2004'))),
        h('p.credit', 'The Horseshoe’s sign in 1986. Photograph: Larry D. Moore, CC BY 4.0.'),
      ),
      h('figure.place-pic', h('img', { src: 'img/binions-1986.jpg', alt: 'The neon front of Binion’s Horseshoe casino at night: HORSESHOE down one side in lights, GAMBLING across the bottom.', loading: 'lazy', decoding: 'async' })),
    );
  }

  private buildTools(): HTMLElement {
    const row = (href: string, name: string, nameZh: string, text: string, textZh: string, figure: string, unit: string) =>
      h(
        'a.tool',
        { href },
        h('span.tool-name', name, zh(nameZh)),
        h('span.tool-text', text, zh(textZh)),
        h('span.tool-figure', h('b', figure), h('span', unit)),
        h('span.tool-go', { 'aria-hidden': 'true' }, '→'),
      );
    return h(
      'section.chapter.tools',
      h('h2', 'An old game, four parts of it solved.', zh('老游戏，其中四块算得出来。')),
      h(
        'div.tools-body',
        this.picture(
          'img/hine-1909.jpg',
          'A group of boys in messenger uniforms crowd round two crates used as a table, absorbed in a card game.',
          [0.5, 0.45],
          ['Western Union messengers at poker, Hartford, Connecticut, 5 March 1909. Photograph: Lewis Hine, U.S. National Archives.'],
        ),
        h(
          'div.tools-list',
          row('#river', 'Any river', '任意河牌', 'Two ranges, a board, the bet sizes you choose.', '两个范围、一个牌面、你定的下注尺寸。', '0.1 s', 'the 2003 hand'),
          row('#river', 'A turn, with every river', '转牌连同每张河牌', 'All 48 rivers solved along with it, one bet size a street.', '48 张河牌一起解，每条街一个下注尺寸。', '4 s', 'to 0.3% of the pot'),
          row('#push-or-fold', 'Push or fold', '全下或弃牌', 'The exact heads-up equilibrium before the flop, at any stack from 1 to 25 big blinds.', '翻前单挑的精确均衡，1 到 25 个大盲。', '34 ms', 'a stack size'),
          row('#equity', 'Equity', '胜率', 'One hand or range against another, by dealing every board once. Nothing is sampled.', '手牌或范围互相对比，把每个牌面都发一遍，不抽样。', '1,712,304', 'boards a matchup'),
        ),
      ),
      h('p.dim.tools-note', 'Timed on an Apple M1, one thread. It does not solve the flop, and it does not handle more than two players.', zh('以上用时在 Apple M1 单线程上测得。不解翻牌，也不支持两人以上。')),
    );
  }

  private buildProof(): HTMLElement {
    const item = (figure: string, text: string, textZh: string) => h('div.proof-item', h('b', figure), h('p', text, zh(textZh)));
    return h(
      'section.chapter.proofs',
      h('h2', 'Held against things outside it.', zh('每一块都拿外面的东西对过。')),
      h(
        'div.proof-list',
        item('133,784,560', 'seven-card hands ranked. The count in each of the nine categories equals the published one.', '全部七张牌组合都排过名，九类牌型的数量与公开数字逐一相等。'),
        item('−1/18', 'the value of Kuhn poker, known since 1950. Given to the solver as a river, it returns −0.0555556.', 'Kuhn 扑克的博弈值，1950 年就已知。当成河牌交给求解器，得到 −0.0555556。'),
        item('334 of 335', 'push-or-fold limits within 0.1 big blinds of the chart published by HoldemResources.', '全下或弃牌的 335 个临界值里，334 个与 HoldemResources 公布的表相差不到 0.1 个大盲。'),
        item('0.0001', 'of the pot: the most its values differ from those of postflop-solver, an independent solver, on the same river and the same turn.', '同一个河牌、同一个转牌，与独立的开源求解器 postflop-solver 相比，价值最多相差底池的万分之一。'),
      ),
      h('div.hero-go', h('a.btn.primary', { href: '#proof' }, 'Run the eight checks in this tab'), h('a.link', { href: 'https://github.com/gmy20060609-jpg/tolerance', target: '_blank', rel: 'noopener' }, 'Read the source')),
    );
  }

  private buildEnd(): HTMLElement {
    const credit = (text: string, href: string, licence: string, licenceHref: string, changes: string) =>
      h('li', h('a', { href, target: '_blank', rel: 'noopener' }, text), ', ', licenceHref ? h('a', { href: licenceHref, target: '_blank', rel: 'noopener' }, licence) : licence, changes);
    return h(
      'section.end',
      h('a.end-go', { href: '#river' }, h('span', 'Open the solver'), h('span', { 'aria-hidden': 'true' }, '→')),
      h(
        'div.credits',
        h('h3', 'Photographs', zh('照片')),
        h(
          'ul',
          credit('Sam Farha, 2010 World Series of Poker, by flipchip / LasVegasVegas.com', 'https://commons.wikimedia.org/wiki/File:Sam_Farha_playing_toward_a_championship.jpg', 'CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0/', '. Converted to black and white; this version under the same licence.'),
          credit('Chris Moneymaker, EPT Grand Final, Monte Carlo, 2008, by Equipo Unibet', 'https://commons.wikimedia.org/wiki/File:Chris_Moneymaker_EPT4.jpg', 'CC BY 2.0', 'https://creativecommons.org/licenses/by/2.0/', '. Cropped and converted to black and white.'),
          credit('Binion’s Horseshoe, 1986, by Larry D. Moore', 'https://commons.wikimedia.org/wiki/File:Binions_horseshoe_1986.jpg', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', '. Resized.'),
          credit('Messengers at poker, Hartford, 1909, by Lewis Hine', 'https://commons.wikimedia.org/wiki/File:8_P.M._Flashlight_photo_of_messengers_absorbed_in_their_usual_game_of_poker_in_the_%22Den_of_the_terrible_nine.%22..._-_NARA_-_523167.jpg', 'public domain', '', ', U.S. National Archives. Cropped.'),
        ),
        h('p.dim', 'The people pictured have no connection with this site. The photographs show them in other years than 2003.', zh('照片中的人与本站无关，照片也不是 2003 年拍的。')),
      ),
    );
  }

  // --- Solving the hand, once at each tolerance ------------------------------------

  private solve(): void {
    this.worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<Response>) => this.receive(event.data);
    this.next();
  }

  private send(request: Request): void {
    this.worker?.postMessage(request);
  }

  private next(): void {
    const index = this.stops.length;
    if (index >= TOLERANCES.length) {
      this.worker?.terminate();
      this.worker = null;
      return;
    }
    this.job = index + 1;
    this.frames = [];
    this.details.clear();
    const { board, ranges, tree } = HAND.spot;
    this.send({ type: 'river', id: this.job, board: [...board], ranges: [Float64Array.from(ranges[0]), Float64Array.from(ranges[1])], tree, tolerance: TOLERANCES[index]!, maxIterations: 6000 });
  }

  private receive(message: Response): void {
    if (message.id !== this.job) return;
    switch (message.type) {
      case 'tree': {
        this.nodes = message.nodes;
        this.offsets = message.offsets;
        const follow = (from: number, kind: string) => {
          const node = this.nodes[from]!;
          return node.children[node.actions.findIndex((action) => action.kind === kind)]!;
        };
        const bet = follow(0, 'check');
        this.spots = [bet, follow(bet, 'allin')];
        break;
      }
      case 'frame':
        this.frames.push(message);
        break;
      case 'done':
        this.last = this.frames[this.frames.length - 1] ?? null;
        this.waiting = 2;
        for (const id of this.spots) this.send({ type: 'detail', id: this.job, nodeId: id });
        break;
      case 'detail': {
        this.details.set(message.nodeId, message.combos);
        if (--this.waiting > 0 || !this.last) break;
        const held = HAND.pins.map((pin, i) => {
          const node = this.nodes[this.spots[i]!]!;
          const [a, b] = parseCards(pin.cards) as [number, number];
          const combo = this.details.get(node.id)?.find((d) => d.combo === comboIndex(a, b));
          const look = drawing(node);
          return look.order.map((action) => ({
            name: this.actionName(node, action),
            share: combo?.strategy[action] ?? 0,
            fill: CSS_FILL[look.byAction[action]!],
          }));
        });
        this.stops.push({
          tolerance: TOLERANCES[this.stops.length]!,
          exploitability: this.last.exploitability,
          iterations: this.last.iteration,
          ms: this.last.ms,
          held,
        });
        const index = this.stops.length - 1;
        (this.rulerEl.children[index] as HTMLButtonElement).disabled = false;
        if (index === TOLERANCES.length - 1) {
          this.finalFrames = this.frames;
          if (this.played || reducedMotion()) this.replay(true);
        }
        this.advance();
        this.next();
        break;
      }
      case 'error':
        this.figureNote.textContent = `Not solved: ${message.message}`;
        break;
    }
  }

  private finalFrames: Frame[] = [];

  private actionName(node: TreeNode, index: number): string {
    const action = node.actions[index]!;
    const me = node.commit[node.player]!;
    const them = node.commit[1 - node.player]!;
    if (action.kind === 'bet') return `Bet ${Math.round(((action.to - me) / (node.streetPot + me + them)) * 100)}%`;
    return { fold: 'Fold', check: 'Check', call: 'Call', allin: 'All-in', raise: 'Raise' }[action.kind as 'fold'];
  }

  // --- The first screen ------------------------------------------------------------

  /** As the page opens, the picture tightens one tolerance at a time, no faster than it can be read. */
  private advance(): void {
    if (this.picked || this.timer) return;
    const target = this.shown + 1;
    if (target >= this.stops.length) return;
    if (reducedMotion()) {
      this.show(this.stops.length - 1);
      return;
    }
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      if (this.picked) return;
      this.show(target);
      this.advance();
    }, this.shown < 0 ? 120 : STEP);
  }

  private pick(index: number): void {
    this.picked = true;
    this.show(index);
  }

  private show(index: number): void {
    const stop = this.stops[index];
    if (!stop) return;
    this.shown = index;
    this.hero.pitch = PITCHES[index]!;
    Array.from(this.rulerEl.children).forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    const text = percent(stop.exploitability);
    replace(this.figureEl, text.slice(0, -1), h('span.unit', '%'));
    replace(
      this.figureNote,
      `of the pot. That is all a perfect opponent could still win from the answer. ${integer(stop.iterations)} iterations, ${seconds(stop.ms)} in this tab.`,
      zh(`个底池：完美的对手最多还能从这个答案里多赢这么多。${integer(stop.iterations)} 次迭代，在这个网页里用了 ${seconds(stop.ms)}。`),
    );
    const farha = stop.held[1]!;
    replace(
      this.answerEl,
      h('span.answer-hand', 'Farha’s ', cards(parseCards(HAND.pins[1]!.cards)), ' against the all-in', zh('Farha 的 Q9 面对全下')),
      h('div.mix', { role: 'img', 'aria-label': 'Mix of actions' }, farha.map((part) => h('i', { style: { width: `${part.share * 100}%`, background: part.fill } }))),
      h('span.answer-mix', farha.map((part) => h('span', h('b', frequency(part.share, 0)), ` ${part.name.toLowerCase()}`))),
    );
    if (index === this.stops.length - 1 || this.picked) {
      this.srEl.textContent = `Solved to ${text} of the pot. Farha's queen nine: ${farha.map((p) => `${p.name} ${frequency(p.share, 0)}`).join(', ')}.`;
    }
  }

  // --- The two grids, replaying the solve --------------------------------------------

  private replay(force = false): void {
    if (this.played && !force) return;
    this.played = true;
    if (!this.finalFrames.length) return;
    this.playhead = reducedMotion() ? this.finalFrames.length - 1 : 0;
    this.lastTick = 0;
    this.drawn = -1;
    this.loop.kick();
  }

  private drawn = -1;

  private tick(time: number): boolean {
    const last = this.finalFrames.length - 1;
    if (last < 0) return false;
    const dt = this.lastTick ? Math.min(100, time - this.lastTick) : 16;
    this.lastTick = time;
    this.playhead = Math.min(last, this.playhead + (dt * PLAYBACK) / 1000);
    const index = Math.floor(this.playhead);
    if (index !== this.drawn) {
      this.drawn = index;
      this.drawGrids(index, index === last);
    }
    return this.playhead < last;
  }

  private drawGrids(index: number, settled: boolean): void {
    const frame = this.finalFrames[index]!;
    this.spots.forEach((nodeId, i) => {
      const node = this.nodes[nodeId]!;
      if (node.type !== DECISION) return;
      const actions = node.actions.length;
      const start = this.offsets[nodeId]!;
      const look = drawing(node);
      const seg = new Float32Array(169 * actions);
      const fill = new Float32Array(169);
      const tone = new Uint8Array(169);
      for (let c = 0; c < 169; c++) {
        const f = frame.data[start + 169 * actions + c]!;
        if (!f) continue;
        fill[c] = f / 255;
        tone[c] = settled ? 2 : 1;
        for (let k = 0; k < actions; k++) seg[c * actions + k] = frame.data[start + c * actions + look.order[k]!]! / 255;
      }
      const data: GridData = { k: actions, seg, fill, styles: look.styles, tone };
      const [a, b] = parseCards(HAND.pins[i]!.cards) as [number, number];
      this.grids[i]!.marks = [COMBO_CLASS[comboIndex(a, b)]!];
      this.grids[i]!.set(data);
    });
    replace(this.replayNote, settled ? `Settled after ${integer(frame.iteration)} iterations, exploitable for ${percent(frame.exploitability)} of the pot.` : `Iteration ${integer(frame.iteration)}, exploitable for ${percent(frame.exploitability)} of the pot.`);
    if (settled) {
      const stop = this.stops[this.stops.length - 1];
      if (!stop) return;
      HAND.pins.forEach((pin, i) => {
        const [a, b] = parseCards(pin.cards) as [number, number];
        replace(
          this.heldEls[i]!,
          h('span.held-hand', cards([a, b]), h('span.dim', ` ${CLASS_NAMES[COMBO_CLASS[comboIndex(a, b)]!]} is marked`)),
          h('div.mix', { role: 'img', 'aria-label': 'Mix of actions' }, stop.held[i]!.map((part) => h('i', { style: { width: `${part.share * 100}%`, background: part.fill } }))),
          h('span.answer-mix', stop.held[i]!.filter((part) => part.share >= 0.005).map((part) => h('span', h('b', frequency(part.share, 0)), ` ${part.name.toLowerCase()}`))),
        );
      });
    }
  }
}
