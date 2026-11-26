// The front page: one hand from 2003, solved in the tab as the page opens.
// Everything on it is drawn to a tolerance. The title block along the bottom
// sets it, scrolling through the solve moves it, and the photographs, the
// grids and the figures all follow.

import './home.css';
import { CLASS_NAMES, COMBO_CLASS, comboIndex, parseCards } from '../engine/cards.ts';
import type { PushFoldSolution } from '../engine/pushfold.ts';
import { parseRange } from '../engine/range.ts';
import type { TreeNode } from '../engine/tree.ts';
import type { ComboDetail } from '../engine/view.ts';
import { PRESETS } from '../spots.ts';
import { cards } from '../ui/cards.ts';
import { ConvergenceChart } from '../ui/chart.ts';
import { gloss, h, reducedMotion, replace } from '../ui/dom.ts';
import { frequency, integer, percent, seconds } from '../ui/format.ts';
import { Grid, swatch } from '../ui/grid.ts';
import { CSS_FILL, drawing } from '../ui/look.ts';
import { LineScreen } from '../ui/screen.ts';
import { pixelRatio } from '../ui/theme.ts';
import type { EquityResult, Frame, ProofUpdate, Request, Response } from '../worker/protocol.ts';

const HAND = PRESETS[0]!;
const TOLERANCES = [0.01, 0.005, 0.003, 0.001, 0.0005, 0.0001];
const FINEST = 3.2; // line pitch of a picture drawn as finely as the screen holds, CSS pixels
const UNSOLVED = 40;
const STEP = 230; // ms between tolerances as the page opens
/** The share of the scroll through the solve given to the solve itself; the rest shows the answer to it. */
const SPLIT = 0.72;
const SHEETS = ['The answer', 'The hand', 'The place', 'The tools', 'The proof', 'The solver'];

const zh = (text: string) => h('span.zh', { lang: 'zh-Hans' }, text);

/** How coarse a picture is drawn when the answer is exploitable for `e` of the pot. */
function pitchOf(e: number): number {
  const t = (Math.log10(Math.max(e, 1e-4)) + 4) / (Math.log10(0.3) + 4);
  return Math.round(Math.min(UNSOLVED, FINEST * Math.pow(UNSOLVED / FINEST, Math.max(0, t))) * 10) / 10;
}

const stopOf = (e: number): number => TOLERANCES.reduce((met, t, i) => (e <= t ? i : met), -1);

interface Mix {
  name: string;
  share: number;
  fill: string;
}

interface Stop {
  exploitability: number;
  iterations: number;
  ms: number;
  /** The mix of actions of each hand actually held. */
  held: Mix[][];
}

const mixBar = (mix: Mix[]) =>
  h('div.mix', { role: 'img', 'aria-label': 'Mix of actions' }, mix.map((part) => h('i', { style: { width: `${part.share * 100}%`, background: part.fill } })));

const mixText = (mix: Mix[]) =>
  h('span.answer-mix', mix.filter((part) => part.share >= 0.005).map((part) => h('span', h('b', frequency(part.share, 0)), ` ${part.name.toLowerCase()}`)));

export class HomeView {
  readonly el: HTMLElement;
  private worker: Worker | null = null;
  private nodes: TreeNode[] = [];
  private offsets: Int32Array = new Int32Array(0);
  private overallOffsets: Int32Array = new Int32Array(0);
  /** The two decisions of the hand as played: Moneymaker's bet, Farha's answer. */
  private spots: [number, number] = [-1, -1];
  private stops: Stop[] = [];
  private frames: Frame[] = [];
  private finalFrames: Frame[] = [];
  private job = 0;
  private waiting = 0;
  private details = new Map<number, ComboDetail[]>();

  /** The tolerance chosen, as an index into the stops; the page opens on the tightest. */
  private choice = -1;
  private picked = false;
  private timer = 0;
  private engaged = false;
  private stageKey = '';

  private readonly screens = new Set<LineScreen>();
  private readonly coarse = new Set<LineScreen>();
  private readonly pictures = new Map<string, LineScreen>();

  // The first screen.
  private readonly hero = this.screen('img/farha-2010.jpg', 'Sam Farha at a poker table, leaning on his forearm and looking across it, chips stacked in front of him.', [0.5, 0.36], true);
  private readonly figureEl = h('div.figure', '–');
  private readonly figureNote = h('p.caption', 'Solving.');
  private readonly answerEl = h('div.answer-now');
  private readonly srEl = h('p.sr', { role: 'status' });

  // The title block.
  private readonly stopsEl = h('div.stops', { role: 'group', 'aria-label': 'Tolerance' });
  private readonly blockError = h('b', '–');
  private readonly blockIterations = h('b', '–');
  private readonly blockTime = h('b', '–');
  private readonly blockSheet = h('b', `1 of ${SHEETS.length}`);
  private readonly blockSheetName = h('span', SHEETS[0]!);

  // The solve, scrubbed by scrolling.
  private readonly track = h('div.solve-track');
  private readonly stagePics = [
    this.screen('img/moneymaker-2008.jpg', 'Chris Moneymaker, close up, looking straight at the camera from under the brim of a cap.', [0.55, 0.4], false, false),
    this.screen('img/farha-2010.jpg', 'Sam Farha at a poker table, looking across it.', [0.47, 0.3], false, false),
  ];
  private readonly stageGrid = new Grid('The strategy for each of the 169 starting hands');
  private readonly stageChart = new ConvergenceChart();
  private readonly stageWho = h('h3');
  private readonly stageFigure = h('div.figure', '–');
  private readonly stageSub = h('p.dim');
  private readonly stageKeyEl = h('div.solve-key');
  private readonly stageHeld = h('div.held');
  private readonly stageRule = h('i');
  private readonly stageCaption = h('figcaption');

  // The tools.
  private readonly pushGrid = new Grid('The hands that move all-in first, at this stack');
  private readonly pushStack = h('input', { type: 'range', min: '1', max: '25', step: '0.5', value: '10', 'aria-label': 'Stack, in big blinds' });
  private readonly pushFigure = h('div.figure', '–');
  private readonly pushNote = h('p.dim');
  private readonly pushed = new Map<number, PushFoldSolution>();
  private pushTouched = false;
  private readonly field = h('canvas', { role: 'img' });
  private readonly fieldBox = h('div.field-box', this.field);
  private readonly equityFigure = h('div.figure', '–');
  private readonly equityNote = h('p.dim');
  private equity: EquityResult | null = null;

  // The proof.
  private readonly ledger = new Map<string, { measured: HTMLElement; state: HTMLElement }>();

  constructor() {
    TOLERANCES.forEach((t, i) => {
      this.stopsEl.append(h('button', { disabled: true, 'aria-pressed': 'false', onclick: () => this.pick(i) }, `${+(t * 100).toFixed(2)}%`));
    });
    for (const canvas of [this.stageGrid, this.pushGrid].map((grid) => grid.el.querySelector('canvas')!)) canvas.tabIndex = -1;
    this.stageChart.onscrub = (index) => {
      if (index !== null) this.scrollToFrame(index, 'auto');
    };

    const sections = [this.buildHero(), this.buildHand(), this.buildPlace(), this.buildTools(), this.buildProof(), this.buildEnd()];
    this.el = h('main.home', { id: 'main' }, sections, this.buildBlock());

    // Which sheet of the page is on screen.
    const watch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = sections.indexOf(entry.target as HTMLElement);
          this.blockSheet.textContent = `${index + 1} of ${SHEETS.length}`;
          this.blockSheetName.textContent = SHEETS[index]!;
        }
      },
      { rootMargin: '-50% 0px -50% 0px' },
    );
    sections.forEach((section) => watch.observe(section));
    // What only starts once it is reached.
    const started = new Set<string>();
    const near = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const name = (entry.target as HTMLElement).dataset.start!;
          near.unobserve(entry.target);
          if (started.has(name)) continue;
          started.add(name);
          if (name === 'tools') this.startTools();
          else if (name === 'proof') this.startProof();
          else this.reveal(name);
        }
      },
      { rootMargin: '0px 0px 10% 0px' },
    );
    this.el.querySelectorAll<HTMLElement>('[data-start]').forEach((el) => near.observe(el));

    let queued = 0;
    const onScroll = () => {
      if (!queued) queued = requestAnimationFrame(() => ((queued = 0), this.scrolled()));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    new ResizeObserver(() => this.drawField()).observe(this.fieldBox);

    this.solve();
  }

  /** Called each time the page is shown again. */
  opened(): void {
    this.stageKey = '';
    this.scrolled();
  }

  private screen(src: string, alt: string, focus: [number, number], eager = false, follow = true): LineScreen {
    const screen = new LineScreen(src, { alt, focus, eager });
    screen.pitch = UNSOLVED;
    if (follow) this.screens.add(screen);
    return screen;
  }

  /** A photograph further down the page: drawn coarse until it is reached, then tightened to the tolerance in force. */
  private picture(name: string, src: string, alt: string, focus: [number, number], caption: string): HTMLElement {
    const screen = this.screen(src, alt, focus);
    screen.pitch = 26;
    this.coarse.add(screen);
    this.pictures.set(name, screen);
    return h('figure.pic', { 'data-start': name }, screen.el, h('figcaption', caption));
  }

  private reveal(name: string): void {
    const screen = this.pictures.get(name);
    if (!screen) return;
    const end = pitchOf(this.level().e);
    const steps = reducedMotion() ? [end] : [18, 13, 9, 6.5, 4.5].filter((pitch) => pitch > end).concat(end);
    steps.forEach((pitch, i) =>
      setTimeout(() => {
        if (i === steps.length - 1) {
          this.coarse.delete(screen);
          screen.pitch = pitchOf(this.level().e);
        } else screen.pitch = pitch;
      }, 130 * (i + 1)),
    );
  }

  // --- The page ------------------------------------------------------------------

  private buildHero(): HTMLElement {
    return h(
      'section.hero',
      h(
        'figure.hero-pic',
        this.hero.el,
        h('figcaption', 'Sam Farha at the World Series of Poker, 2010. Photograph: flipchip, LasVegasVegas.com, CC BY-SA 3.0. Drawn as a line screen: the looser the tolerance, the coarser the line.'),
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
          h('p.dim', 'A looser tolerance gives a different answer. Set it to 1% in the bar below and the call turns into a fold.', zh('公差放松，答案就变。在底栏选 1%，跟注会变成弃牌。')),
          h('div.hero-go', h('a.btn.primary', { href: '#river' }, 'Open the solver'), h('a.link', { href: '#proof' }, 'How it was checked')),
        ),
        this.srEl,
      ),
    );
  }

  /** The title block of the page, as on a drawing: the tolerance, and what it cost. */
  private buildBlock(): HTMLElement {
    const cell = (name: string, label: HTMLElement, ...value: (HTMLElement | string)[]) => h(`div.block-cell.${name}`, h('span.block-label', label), h('span.block-value', value));
    return h(
      'aside.title-block',
      { 'aria-label': 'The tolerance everything on this page is drawn to' },
      h('div.block-cell.tol', h('span.block-label', gloss('Tolerance', '公差')), this.stopsEl),
      cell('err', gloss('Error', '误差'), this.blockError, ' of the pot'),
      cell('its', gloss('Iterations', '迭代'), this.blockIterations),
      cell('time', gloss('Time', '用时'), this.blockTime),
      cell('sheet', gloss('Sheet', '页'), this.blockSheet, ' ', this.blockSheetName),
    );
  }

  private buildHand(): HTMLElement {
    const fact = (label: string, labelZh: string, ...value: (HTMLElement | string)[]) => [h('dt', gloss(label, labelZh)), h('dd', value)];
    this.track.append(
      h(
        'div.solve-stage',
        h('figure.solve-pic', this.stagePics[0]!.el, this.stagePics[1]!.el, this.stageCaption),
        h(
          'div.solve-body',
          h('div.solve-grid', this.stageWho, this.stageGrid.el),
          h(
            'div.solve-info',
            h('div.solve-figure', h('span.dim', gloss('Exploitable for', '可剥削度')), this.stageFigure, this.stageSub),
            this.stageChart.el,
            this.stageKeyEl,
            this.stageHeld,
          ),
        ),
        h('div.solve-rule', { 'aria-hidden': 'true' }, this.stageRule),
      ),
    );
    return h(
      'section.hand',
      h(
        'div.chapter.hand-intro',
        h('h2', 'King high, all‑in, for the title.', zh('K 高牌，全下，争的是冠军。')),
        h(
          'div.hand-top',
          h(
            'div.hand-facts',
            h('div.hand-board', cards(HAND.spot.board)),
            h(
              'dl.facts',
              fact('Pot', '底池', '1,810,000'),
              fact('Moneymaker moves all-in for', 'Moneymaker 全下', '2,795,000'),
              fact('Moneymaker holds', 'Moneymaker 的牌', cards(parseCards('Ks7h')), h('span.dim', ' king high')),
              fact('Farha holds', 'Farha 的牌', cards(parseCards('Qs9h')), h('span.dim', ' top pair')),
              fact('Farha’s answer', 'Farha 的应对', 'folds'),
            ),
          ),
          h(
            'div.hand-story',
            h('p.big', 'The World Series of Poker Main Event is down to two players. Farha checks the river. Moneymaker, an accountant who won his seat online, has nothing, and moves all-in. Farha, with top pair, folds.'),
            h('p.big.zh-block', { lang: 'zh-Hans' }, '世界扑克大赛主赛事只剩两人。河牌 Farha 过牌。Moneymaker 是个会计，参赛资格是网上赢来的，手里什么都没中，他全下。Farha 拿着顶对，弃牌。'),
            h(
              'p.dim',
              'Cards, bets and stacks as reported by ',
              h('a', { href: 'https://www.pokernews.com/strategy/analyzing-moneymaker-bluff-of-the-century-against-farha-35218.htm', target: '_blank', rel: 'noopener' }, 'PokerNews'),
              '. Was the bluff right, and was the fold? That depends on every other hand each of them could have held, so the solver works out all of them at once. Scroll, and it does.',
              zh('牌、下注和筹码以 PokerNews 的报道为准。诈唬对不对、弃牌对不对，取决于双方可能拿到的所有其他手牌，所以求解器把全部手牌一起算。往下滚，它就开始算。'),
            ),
          ),
        ),
      ),
      this.track,
      h(
        'div.chapter.hand-foot',
        h(
          'p.dim',
          'Each square is one of the 169 starting hands. Solid red moves all-in, hatched red bets less, grey checks or calls, blank folds.',
          zh('每格是 169 种起手牌之一。实心红全下，斜线红是较小的下注，灰色过牌或跟注，空白弃牌。'),
        ),
        h(
          'p.dim',
          'Nobody knows the ranges the two were playing. These answers hold for the ranges assumed, which are written out in the solver; change them and it answers again.',
          zh('两人当时的范围无人知道。答案只在假设的范围下成立，范围写在求解器里，改了就重解。'),
        ),
        h('div.hero-go', h('a.btn.primary', { href: '#river' }, 'Open this hand in the solver')),
      ),
    );
  }

  private buildPlace(): HTMLElement {
    return h(
      'section.place',
      h(
        'div.place-text',
        h('h2', 'Binion’s Horseshoe, Fremont Street.', zh('弗里蒙特街，宾尼恩马蹄铁赌场。')),
        h('p.big', 'The World Series of Poker began here in 1970, and the 2003 final was played here. 839 players entered that year. An amateur won it on television, and the year after, 2,576 entered.'),
        h('p.big.zh-block', { lang: 'zh-Hans' }, '世界扑克大赛 1970 年在这里开始，2003 年的决赛也在这里打。那年 839 人参赛。一个业余选手在电视上赢了冠军，第二年来了 2,576 人。'),
        h('div.place-figures', h('div', h('b', '839'), h('span', 'entered in 2003')), h('div', h('b', '2,576'), h('span', 'entered in 2004'))),
        h('p.credit', 'The Horseshoe’s sign in 1986. Photograph: Larry D. Moore, CC BY 4.0.'),
      ),
      h('figure.place-pic', h('img', { src: 'img/binions-1986.jpg', alt: 'The neon front of Binion’s Horseshoe casino at night: HORSESHOE down one side in lights, GAMBLING across the bottom.', loading: 'lazy', decoding: 'async' })),
    );
  }

  private buildTools(): HTMLElement {
    this.pushStack.addEventListener('input', () => {
      this.pushTouched = true;
      this.drawPush(Number(this.pushStack.value));
    });
    const tool = (name: string, nameZh: string, text: string, textZh: string, figure: string, unit: string) =>
      h(
        'a.tool',
        { href: '#river' },
        h('span.tool-name', name, zh(nameZh)),
        h('span.tool-text', text, zh(textZh)),
        h('span.tool-figure', h('b', figure), h('span', unit)),
        h('span.tool-go', { 'aria-hidden': 'true' }, '→'),
      );
    return h(
      'section.chapter.tools',
      h('h2', 'An old game, four parts of it solved.', zh('老游戏，其中四块算得出来。')),
      h(
        'div.tools-top',
        this.picture(
          'hine',
          'img/hine-1909.jpg',
          'A group of boys in messenger uniforms crowd round two crates used as a table, absorbed in a card game.',
          [0.5, 0.45],
          'Western Union messengers at poker, Hartford, Connecticut, 5 March 1909. Photograph: Lewis Hine, U.S. National Archives.',
        ),
        h(
          'div.tools-list',
          h('p.big', 'People played this for a century and a half without knowing the right play. In four corners of the game it can now be computed in a browser tab, with the error stated.'),
          h('p.big.zh-block', { lang: 'zh-Hans' }, '这个游戏人们打了一百五十年，一直不知道正确打法。其中四个角落，现在在浏览器里就能算出来，并且写明误差。'),
          tool('Any river', '任意河牌', 'Two ranges, a board, the bet sizes you choose.', '两个范围、一个牌面、你定的下注尺寸。', '0.1 s', 'the 2003 hand'),
          tool('A turn, with every river', '转牌连同每张河牌', 'All 48 rivers solved along with it, one bet size a street.', '48 张河牌一起解，每条街一个下注尺寸。', '4 s', 'to 0.3% of the pot'),
        ),
      ),
      h(
        'div.panel',
        { 'data-start': 'tools' },
        h(
          'div.panel-text',
          h('h3', 'Push or fold', zh('全下或弃牌')),
          h('p.big', 'Short of chips before the flop, there are two plays left. Which hands move all-in is known exactly, at every stack.'),
          h('p.big.zh-block', { lang: 'zh-Hans' }, '翻前筹码很短时只剩两种打法。哪些牌该全下，在每个筹码深度都有精确答案。'),
          h('div.panel-figure', this.pushFigure, this.pushNote),
          h('label.stack', h('span', gloss('Stack', '筹码'), h('span.dim', '1 to 25 big blinds')), this.pushStack),
          h('div.hero-go', h('a.btn', { href: '#push-or-fold' }, 'Open push or fold')),
        ),
        h('div.panel-visual', this.pushGrid.el),
      ),
      h(
        'div.panel.flip',
        { 'data-start': 'tools' },
        h(
          'div.panel-text',
          h('h3', 'Equity', zh('胜率')),
          h(
            'p.big',
            'Before the flop, ',
            cards(parseCards('Ks7h')),
            ' against ',
            cards(parseCards('Qs9h')),
            ' can meet 1,712,304 boards. Here is every one, a pixel each: ink where king-seven wins, grey where queen-nine wins, red where they split.',
          ),
          h('p.big.zh-block', { lang: 'zh-Hans' }, '翻前 K7 对 Q9，一共可能发出 1,712,304 个牌面。这里每个牌面一个像素：黑色 K7 赢，灰色 Q9 赢，红色平分。'),
          h('div.panel-figure', this.equityFigure, this.equityNote),
          h('div.hero-go', h('a.btn', { href: '#equity' }, 'Open equity')),
        ),
        h('div.panel-visual', this.fieldBox),
      ),
      h(
        'p.dim.tools-note',
        'The times beside the river and the turn are from an Apple M1, one thread; the figures in the two panels are from this tab. It does not solve the flop, and it does not handle more than two players.',
        zh('河牌和转牌旁的用时在 Apple M1 单线程上测得，两个面板里的数字是这个网页当场算的。不解翻牌，也不支持两人以上。'),
      ),
    );
  }

  private buildProof(): HTMLElement {
    const row = (key: string, name: string, nameZh: string, published: string, measured: string) => {
      const measuredEl = h('span.ledger-measured', measured);
      const state = h('span.ledger-state', key ? 'waiting' : 'recorded');
      if (key) this.ledger.set(key, { measured: measuredEl, state });
      return h('div.ledger-row', h('span.ledger-name', name, zh(nameZh)), h('span.ledger-published', published), measuredEl, state);
    };
    return h(
      'section.chapter.proofs',
      h('h2', 'Held against things outside it.', zh('每一块都拿外面的东西对过。')),
      h(
        'div.proof-body',
        this.picture(
          'neumann',
          'img/von-neumann-1944.jpg',
          'John von Neumann in a suit and tie, facing the camera, with the badge number M 50 across his chest.',
          [0.5, 0.42],
          'John von Neumann’s badge photograph, Los Alamos, about 1944, the year he and Oskar Morgenstern put poker and bluffing into Theory of Games and Economic Behavior. Photograph: Los Alamos National Laboratory.',
        ),
        h(
          'div.ledger',
          { 'data-start': 'proof' },
          h('div.ledger-row.ledger-head', h('span', gloss('Check', '检验')), h('span', gloss('Published', '公开值')), h('span', gloss('Measured here', '本页算出')), h('span')),
          row('kuhn', 'Kuhn poker, its value (Kuhn, 1950)', 'Kuhn 扑克的博弈值', '−0.0555556', '–'),
          row('leduc', 'Leduc hold’em, its value', 'Leduc 扑克的博弈值', '−0.0856', '–'),
          row('River', 'A river, against postflop-solver', '同一个河牌，对照 postflop-solver', '45.6383', '–'),
          row('Turn', 'A turn, against postflop-solver', '同一个转牌，对照 postflop-solver', '32.6581', '–'),
          row('', 'Seven-card hands ranked', '七张牌全部排名，九类逐一计数', '133,784,560', '133,784,560'),
          row('', 'Push-or-fold limits within 0.1 bb of the HoldemResources chart', '全下或弃牌临界值，对照 HoldemResources', '335', '334'),
          h(
            'p.dim',
            'The first four are solved in this tab when you reach them. The last two take longer and are recorded from the Proof page, which runs all eight.',
            zh('前四项在你滚到这里时当场求解。后两项较慢，数字取自验证页，那里八项全跑。'),
          ),
          h('div.hero-go', h('a.btn.primary', { href: '#proof' }, 'Run the eight checks in this tab'), h('a.link', { href: 'https://github.com/gmy20060609-jpg/tolerance', target: '_blank', rel: 'noopener' }, 'Read the source')),
        ),
      ),
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
          credit('John von Neumann, badge photograph, about 1944', 'https://commons.wikimedia.org/wiki/File:John_von_Neumann_Los_Alamos_identity_badge_photo.jpg', 'Los Alamos National Laboratory', '', ', free to use with this credit. Cropped.'),
        ),
        h('p.dim', 'The people pictured have no connection with this site. The photographs of the two players are from other years than 2003.', zh('照片中的人与本站无关，两位牌手的照片也不是 2003 年拍的。')),
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
    if (index >= TOLERANCES.length) return;
    this.job = index + 1;
    this.frames = [];
    this.details.clear();
    const { board, ranges, tree } = HAND.spot;
    this.send({ type: 'river', id: this.job, board: [...board], ranges: [Float64Array.from(ranges[0]), Float64Array.from(ranges[1])], tree, tolerance: TOLERANCES[index]!, maxIterations: 6000 });
  }

  private receive(message: Response): void {
    switch (message.type) {
      case 'tree': {
        this.nodes = message.nodes;
        this.offsets = message.offsets;
        this.overallOffsets = message.overallOffsets;
        const follow = (from: number, kind: string) => {
          const node = this.nodes[from]!;
          return node.children[node.actions.findIndex((action) => action.kind === kind)]!;
        };
        const bet = follow(0, 'check');
        this.spots = [bet, follow(bet, 'allin')];
        break;
      }
      case 'frame':
        if (message.id === this.job) this.frames.push(message);
        break;
      case 'done':
        if (message.id !== this.job) break;
        this.waiting = 2;
        for (const id of this.spots) this.send({ type: 'detail', id: this.job, nodeId: id });
        break;
      case 'detail': {
        if (message.id !== this.job) break;
        this.details.set(message.nodeId, message.combos);
        const last = this.frames[this.frames.length - 1];
        if (--this.waiting > 0 || !last) break;
        const held = HAND.pins.map((pin, i) => {
          const node = this.nodes[this.spots[i]!]!;
          const [a, b] = parseCards(pin.cards) as [number, number];
          const combo = this.details.get(node.id)?.find((d) => d.combo === comboIndex(a, b));
          const look = drawing(node);
          return look.order.map((action) => ({ name: this.actionName(node, action), share: combo?.strategy[action] ?? 0, fill: CSS_FILL[look.byAction[action]!] }));
        });
        this.stops.push({ exploitability: last.exploitability, iterations: last.iteration, ms: last.ms, held });
        const index = this.stops.length - 1;
        (this.stopsEl.children[index] as HTMLButtonElement).disabled = false;
        if (index === TOLERANCES.length - 1) {
          this.finalFrames = this.frames;
          this.stageKey = '';
          this.scrolled();
        }
        this.advance();
        this.next();
        break;
      }
      case 'sweep':
        this.pushed.set(message.solution.stack, message.solution);
        if (!this.pushTouched) {
          this.pushStack.value = String(message.done ? 10 : message.solution.stack);
          this.drawPush(Number(this.pushStack.value));
        }
        break;
      case 'equity':
        this.equity = message.result;
        this.drawField();
        break;
      case 'proof':
        this.proved(message.check, message.update);
        break;
      case 'error':
        if (message.id === this.job) this.figureNote.textContent = `Not solved: ${message.message}`;
        break;
    }
  }

  private actionName(node: TreeNode, index: number): string {
    const action = node.actions[index]!;
    const me = node.commit[node.player]!;
    const them = node.commit[1 - node.player]!;
    if (action.kind === 'bet') return `Bet ${Math.round(((action.to - me) / (node.streetPot + me + them)) * 100)}%`;
    return { fold: 'Fold', check: 'Check', call: 'Call', allin: 'All-in', raise: 'Raise' }[action.kind as 'fold'];
  }

  // --- The tolerance in force --------------------------------------------------------

  /** What the page is drawn to right now: the frame under the scroll while the solve is on screen, else the tolerance chosen. */
  private level(): { e: number; iterations: number; ms: number } {
    if (this.engaged && this.finalFrames.length) {
      const frame = this.finalFrames[this.frameAt(this.progress())]!;
      return { e: frame.exploitability, iterations: frame.iteration, ms: frame.ms };
    }
    const stop = this.stops[this.choice];
    return stop ? { e: stop.exploitability, iterations: stop.iterations, ms: stop.ms } : { e: 1, iterations: 0, ms: 0 };
  }

  private apply(): void {
    const level = this.level();
    const solved = level.iterations > 0;
    const pitch = solved ? pitchOf(level.e) : UNSOLVED;
    for (const screen of this.screens) if (!this.coarse.has(screen)) screen.pitch = pitch;
    this.blockError.textContent = solved ? percent(level.e) : '–';
    this.blockIterations.textContent = solved ? integer(level.iterations) : '–';
    this.blockTime.textContent = solved ? seconds(level.ms) : '–';
    const met = solved ? stopOf(level.e) : -1;
    Array.from(this.stopsEl.children).forEach((button, i) => button.setAttribute('aria-pressed', String(i === met)));
  }

  /** As the page opens, the picture tightens one tolerance at a time, no faster than it can be read. */
  private advance(): void {
    if (this.picked || this.timer) return;
    const target = this.choice + 1;
    if (target >= this.stops.length) return;
    if (reducedMotion()) {
      this.choose(this.stops.length - 1);
      return;
    }
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      if (this.picked) return;
      this.choose(target);
      this.advance();
    }, this.choice < 0 ? 120 : STEP);
  }

  private pick(index: number): void {
    this.picked = true;
    if (this.engaged && this.finalFrames.length) {
      // Inside the solve the tolerance is a place in it: go there.
      const at = this.finalFrames.findIndex((frame) => frame.exploitability <= TOLERANCES[index]!);
      this.scrollToFrame(at < 0 ? this.finalFrames.length - 1 : at, reducedMotion() ? 'auto' : 'smooth');
      return;
    }
    this.choose(index);
  }

  private choose(index: number): void {
    const stop = this.stops[index];
    if (!stop) return;
    this.choice = index;
    const text = percent(stop.exploitability);
    replace(this.figureEl, text.slice(0, -1), h('span.unit', '%'));
    replace(
      this.figureNote,
      `of the pot. That is all a perfect opponent could still win from the answer. ${integer(stop.iterations)} iterations, ${seconds(stop.ms)} in this tab.`,
      zh(`个底池：完美的对手最多还能从这个答案里多赢这么多。${integer(stop.iterations)} 次迭代，在这个网页里用了 ${seconds(stop.ms)}。`),
    );
    const farha = stop.held[1]!;
    replace(this.answerEl, h('span.answer-hand', 'Farha’s ', cards(parseCards(HAND.pins[1]!.cards)), ' against the all-in', zh('Farha 的 Q9 面对全下')), mixBar(farha), mixText(farha));
    if (index === TOLERANCES.length - 1 || this.picked) {
      this.srEl.textContent = `Solved to ${text} of the pot. Farha's queen nine: ${farha.map((p) => `${p.name} ${frequency(p.share, 0)}`).join(', ')}.`;
    }
    this.apply();
  }

  // --- The solve, scrubbed by scrolling ------------------------------------------------

  /** Where the solve sits on the page: its top edge when pinned, and how far it can be scrolled. */
  private span(): { top: number; pinned: number; range: number } {
    const rect = this.track.getBoundingClientRect();
    const stage = this.track.firstElementChild as HTMLElement;
    return { top: rect.top, pinned: parseFloat(getComputedStyle(stage).top) || 0, range: rect.height - stage.offsetHeight };
  }

  /** How far the page has been scrolled through the solve, 0 to 1. */
  private progress(): number {
    const { top, pinned, range } = this.span();
    return range > 0 ? Math.min(1, Math.max(0, (pinned - top) / range)) : 0;
  }

  private frameAt(progress: number): number {
    const last = this.finalFrames.length - 1;
    return progress >= SPLIT ? last : Math.round((progress / SPLIT) * last);
  }

  private scrollToFrame(index: number, behavior: ScrollBehavior): void {
    const last = this.finalFrames.length - 1;
    if (last < 1) return;
    const { top, pinned, range } = this.span();
    window.scrollTo({ top: window.scrollY + top - pinned + (index / last) * SPLIT * range * 0.999, behavior });
  }

  private scrolled(): void {
    if (!this.el.isConnected) return;
    const rect = this.track.getBoundingClientRect();
    const progress = this.progress();
    const engaged = rect.top < innerHeight * 0.6 && rect.bottom > innerHeight * 0.4;
    const key = `${engaged}:${progress.toFixed(4)}:${this.finalFrames.length}`;
    if (key === this.stageKey) return;
    this.stageKey = key;
    // Past the end of the solve the page is drawn to its tightest tolerance again.
    const left = this.engaged && !engaged && progress >= 1 && this.stops.length === TOLERANCES.length;
    this.engaged = engaged;
    this.drawStage(progress);
    if (left) this.choose(TOLERANCES.length - 1);
    else this.apply();
  }

  private drawStage(progress: number): void {
    const answer = progress >= SPLIT ? 1 : 0;
    const nodeId = this.spots[answer]!;
    const node = this.nodes[nodeId];
    this.stagePics.forEach((pic, i) => (pic.el.hidden = i !== answer));
    this.stageRule.style.width = `${progress * 100}%`;
    replace(this.stageCaption, answer ? 'Sam Farha, 2010. Photograph: flipchip, LasVegasVegas.com, CC BY-SA 3.0.' : 'Chris Moneymaker, Monte Carlo, 2008. Photograph: Equipo Unibet, CC BY 2.0, cropped.');
    replace(this.stageWho, answer ? ['Farha, against the all-in', zh('Farha 面对全下')] : ['Moneymaker, after Farha checks', zh('Farha 过牌之后')]);
    const frames = this.finalFrames;
    if (!node || !frames.length) return;
    const index = this.frameAt(progress);
    const frame = frames[index]!;
    const settled = index === frames.length - 1;
    for (const pic of this.stagePics) pic.pitch = pitchOf(frame.exploitability);

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
    const [a, b] = parseCards(HAND.pins[answer]!.cards) as [number, number];
    this.stageGrid.marks = [COMBO_CLASS[comboIndex(a, b)]!];
    this.stageGrid.set({ k: actions, seg, fill, styles: look.styles, tone });

    const text = percent(frame.exploitability);
    replace(this.stageFigure, text.slice(0, -1), h('span.unit', '%'));
    const total = integer(frames[frames.length - 1]!.iteration);
    replace(
      this.stageSub,
      settled ? `of the pot, settled after ${total} iterations.` : `of the pot, at iteration ${integer(frame.iteration)} of ${total}. Keep scrolling.`,
      zh(settled ? `个底池，${total} 次迭代后收敛。` : `个底池，第 ${integer(frame.iteration)} 次迭代，共 ${total} 次。继续往下滚。`),
    );
    this.stageChart.set(frames.map((f) => ({ iteration: f.iteration, value: f.exploitability })), index, TOLERANCES[TOLERANCES.length - 1]!);

    const at = this.overallOffsets[nodeId]!;
    replace(this.stageKeyEl, look.order.map((action) => h('div', swatch(look.byAction[action]!), h('span', this.actionName(node, action)), h('b', frequency(frame.overall[at + action]!)))));
    const stop = this.stops[TOLERANCES.length - 1];
    if (settled && stop) {
      const mix = stop.held[answer]!;
      replace(
        this.stageHeld,
        h('span.held-hand', answer ? 'Farha held ' : 'Moneymaker held ', cards([a, b]), h('span.dim', `, marked at ${CLASS_NAMES[COMBO_CLASS[comboIndex(a, b)]!]}`)),
        mixBar(mix),
        mixText(mix),
        h(
          'p.dim',
          answer ? 'He folded. Under these ranges the hand calls a little more often than it folds.' : 'He moved all-in. Under these ranges that is what the hand does most often.',
          zh(answer ? '他弃牌了。在这组范围下，这手牌跟注略多于弃牌。' : '他全下了。在这组范围下，这正是这手牌最常见的打法。'),
        ),
      );
    } else replace(this.stageHeld);
  }

  // --- The tools, computed when they are reached ---------------------------------------

  private startTools(): void {
    this.send({ type: 'sweep', id: 100, from: 1, to: 25, step: 0.5 });
    this.send({ type: 'equity', id: 101, a: parseRange('Ks7h'), b: parseRange('Qs9h'), board: [], exact: [parseCards('Ks7h'), parseCards('Qs9h')] });
  }

  private drawPush(stack: number): void {
    const solution = this.pushed.get(stack);
    if (!solution) return;
    const seg = new Float32Array(169);
    const fill = new Float32Array(169);
    const tone = new Uint8Array(169);
    for (let c = 0; c < 169; c++) {
      const f = solution.push[c]!;
      seg[c] = f;
      fill[c] = f > 0.001 ? 1 : 0;
      tone[c] = f > 0.001 ? 2 : 0;
    }
    this.pushGrid.set({ k: 1, seg, fill, styles: ['solid'], tone });
    replace(this.pushFigure, frequency(solution.pushShare).slice(0, -1), h('span.unit', '%'));
    replace(this.pushNote, `of hands move all-in first with ${stack.toFixed(1)} big blinds. The red squares push.`, zh(`的起手牌在 ${stack.toFixed(1)} 个大盲时先手全下。红格全下。`));
  }

  private drawField(): void {
    const result = this.equity;
    const outcomes = result?.outcomes;
    // At least two boards to a CSS pixel each way, and more on a narrow screen, so the field is never taller than it is wide.
    const box = this.fieldBox.clientWidth;
    const scale = Math.max(2, Math.round(pixelRatio()), Math.ceil(Math.sqrt(outcomes?.length ?? 0) / Math.max(1, box)));
    const width = Math.round(box * scale);
    if (!result || !outcomes || !width || this.field.width === width) return;
    const n = outcomes.length;
    const rows = Math.ceil(n / width);
    this.field.width = width;
    this.field.height = rows;
    this.fieldBox.style.height = `${rows / scale + 2}px`;
    const ctx = this.field.getContext('2d')!;
    const image = ctx.createImageData(width, rows);
    const data = new Uint32Array(image.data.buffer);
    const rgba = [0xffb8bebf, 0xff1b00e3, 0xff101111];
    for (let i = 0; i < width * rows; i++) data[i] = i < n ? rgba[outcomes[i]!]! : 0xfff1f5f6;
    ctx.putImageData(image, 0, 0);
    this.field.setAttribute('aria-label', `Every one of the ${integer(n)} boards, coloured by who wins it`);
    replace(this.equityFigure, frequency(result.equity[0]).slice(0, -1), h('span.unit', '%'));
    replace(
      this.equityNote,
      `is king-seven’s share of the pot before the flop. It wins ${integer(result.win ?? 0)} boards, loses ${integer(result.lose ?? 0)} and splits ${integer(result.tie ?? 0)}. Dealt in ${seconds(result.ms)}.`,
      zh(`是 K7 翻前的胜率：赢 ${integer(result.win ?? 0)} 个牌面，输 ${integer(result.lose ?? 0)} 个，平 ${integer(result.tie ?? 0)} 个。用时 ${seconds(result.ms)}。`),
    );
  }

  // --- The proof, run when it is reached -------------------------------------------------

  private startProof(): void {
    this.send({ type: 'proof', id: 200, check: 'kuhn' });
    this.send({ type: 'proof', id: 201, check: 'leduc' });
    // The turn of the cross-check needs more memory than a phone should be asked for unprompted.
    if (matchMedia('(min-width: 721px)').matches) this.send({ type: 'proof', id: 202, check: 'crosscheck' });
    else {
      for (const [key, value] of [['River', '45.6384'], ['Turn', '32.6581']] as const) {
        const row = this.ledger.get(key)!;
        row.measured.textContent = value;
        row.state.textContent = 'recorded';
      }
    }
  }

  private proved(check: string, update: ProofUpdate): void {
    const set = (key: string, measured: string | undefined, ok: boolean | null | undefined) => {
      const row = this.ledger.get(key);
      if (!row) return;
      if (measured) row.measured.textContent = measured;
      row.state.textContent = ok === true ? 'holds' : ok === false ? 'differs' : (update.note ?? 'solving');
      row.state.dataset.state = ok === true ? 'ok' : ok === false ? 'bad' : 'running';
    };
    if (check === 'crosscheck') {
      for (const key of ['River', 'Turn']) {
        const found = update.rows.find((r) => r.label.startsWith(`${key}: first player's value`));
        if (found) set(key, found.measured, found.ok);
        else if (update.note?.startsWith(key)) set(key, undefined, null);
      }
      return;
    }
    const first = update.rows[0];
    set(check, first?.measured, first?.ok);
  }
}
