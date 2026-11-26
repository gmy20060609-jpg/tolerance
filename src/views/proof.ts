// Proof: every check behind the claims, run again in this tab on request.

import { gloss, h, replace } from '../ui/dom.ts';
import type { ProofUpdate, Response } from '../worker/protocol.ts';

interface Check {
  id: string;
  title: string;
  zh: string;
  what: string;
  against: string;
  source?: { text: string; href: string };
  columns: [string, string];
}

const CHECKS: Check[] = [
  {
    id: 'evaluator',
    title: 'Hand ranking',
    zh: '牌力评估',
    what: 'Every seven-card hand there is, 133,784,560 of them, is ranked and counted by category.',
    against: 'The published count of each category.',
    source: { text: 'Poker probability, Wikipedia', href: 'https://en.wikipedia.org/wiki/Poker_probability' },
    columns: ['Published', 'Counted here'],
  },
  {
    id: 'equity',
    title: 'Equity',
    zh: '胜率',
    what: 'Aces against kings before the flop, counted the slow way: all 36 pairings of the two hands, 1,712,304 boards each.',
    against: 'The preflop table, which is counted a different way, over boards up to a relabelling of suits.',
    columns: ['Table', 'Counted here'],
  },
  {
    id: 'kuhn',
    title: 'Kuhn poker',
    zh: 'Kuhn 扑克',
    what: 'A three-card game solved by hand in 1950. The river solver is handed it as a river spot: a pot of two, one chip behind, a half-pot bet.',
    against: 'Its known value, −1/18 for the first player, and the second player’s one equilibrium strategy.',
    source: { text: 'Kuhn poker, Wikipedia', href: 'https://en.wikipedia.org/wiki/Kuhn_poker' },
    columns: ['Known', 'Solved here'],
  },
  {
    id: 'polar',
    title: 'A river with a closed form',
    zh: '有闭式解的河牌',
    what: 'One player holds the best or the worst hand, the other always a hand in between. Bets of half, one and two pots.',
    against: 'The textbook answer: bluff s/(1+s) hands per value bet, call 1/(1+s) of the time.',
    source: { text: 'Chen and Ankenman, The Mathematics of Poker, 2006', href: 'https://www.goodreads.com/book/show/1401520.The_Mathematics_of_Poker' },
    columns: ['Closed form', 'Solved here'],
  },
  {
    id: 'river',
    title: 'Exploitability, measured twice',
    zh: '可剥削度量两遍',
    what: 'A real river spot, 438 hands against 542. The number this site shows is computed in one sorted pass over each range.',
    against: 'The same number computed the plain way, comparing every pair of hands, with no shortcuts shared.',
    columns: ['Every pair of hands', 'Sorted pass'],
  },
  {
    id: 'pushfold',
    title: 'Push or fold',
    zh: '全下或弃牌',
    what: 'The equilibrium at 391 stack sizes from 1 to 20.5 big blinds, and from them the deepest stack at which each hand is played.',
    against: 'The chart published by HoldemResources.net, 338 numbers.',
    source: { text: 'HoldemResources.net, HeadsUp Push/Fold Nash Equilibrium', href: 'https://www.holdemresources.net/hune' },
    columns: ['Published', 'Solved here'],
  },
];

export class ProofView {
  readonly el: HTMLElement;
  private worker: Worker | null = null;
  private running = false;
  private queue: string[] = [];
  private readonly parts = new Map<string, { state: HTMLElement; body: HTMLElement; bar: HTMLElement; note: HTMLElement; started: number }>();
  private readonly runAll = h('button.btn.primary', { onclick: () => this.start(CHECKS.map((c) => c.id)) }, 'Run them all again') as HTMLButtonElement;

  constructor() {
    const list = h(
      'div.checks',
      CHECKS.map((check) => {
        const state = h('span.state', 'Waiting');
        const body = h('tbody');
        const bar = h('i');
        const note = h('p.dim');
        this.parts.set(check.id, { state, body, bar, note, started: 0 });
        return h(
          'article.check',
          h(
            'div.check-head',
            h('h3', gloss(check.title, check.zh)),
            state,
            h('button.link', { onclick: () => this.start([check.id]) }, 'Run'),
          ),
          h(
            'div.check-text',
            h('p', check.what),
            h('p.dim', 'Against: ', check.against, check.source ? [' ', h('a', { href: check.source.href, target: '_blank', rel: 'noopener' }, check.source.text), '.'] : null),
            note,
          ),
          h(
            'div.check-table',
            h('div.progress', bar),
            h(
              'table.combos',
              h('thead', h('tr', h('th', { scope: 'col' }), h('th', { scope: 'col' }, check.columns[0]), h('th', { scope: 'col' }, check.columns[1]), h('th', { scope: 'col' }))),
              body,
            ),
          ),
        );
      }),
    );

    this.el = h(
      'main',
      { id: 'main' },
      h(
        'section.section.first',
        h(
          'header',
          h('h1', { class: 'h2' }, gloss('Checked against what is known', '对照已知结果')),
          h(
            'div',
            h(
              'p',
              'A solver that is wrong still prints a grid. So each part is held against something outside it: a published count, a game solved by hand, a closed form, a published chart, or the same quantity computed a second way. The checks below are the ones in the test suite. They are running now, in your browser.',
              h('span.zh', { lang: 'zh-Hans' }, '错的求解器照样能画出一张矩阵。所以每个部件都对照一个外部事实：公开计数、手算可解的游戏、闭式解、公开图表，或同一个量的第二种算法。下面就是测试套件里的检查，此刻正在你的浏览器里重新跑。'),
            ),
            h('p', { style: { marginTop: '16px' } }, this.runAll, h('span.dim', { style: { marginLeft: '12px' } }, 'About half a minute.')),
          ),
        ),
        list,
      ),
    );
  }

  /** Runs every check the first time the page is opened. */
  opened(): void {
    if (!this.ran) this.start(CHECKS.map((c) => c.id));
  }

  private ran = false;

  private start(ids: string[]): void {
    this.ran = true;
    if (this.running) return;
    this.worker ??= this.spawn();
    this.queue = [...ids];
    this.running = true;
    this.runAll.disabled = true;
    this.next();
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<Response>) => {
      const message = event.data;
      if (message.type === 'proof') this.update(message.check, message.update);
      else if (message.type === 'error') {
        const id = this.queue[0];
        if (id) this.parts.get(id)!.state.textContent = `Failed: ${message.message}`;
        this.queue.shift();
        this.next();
      }
    };
    return worker;
  }

  private next(): void {
    const id = this.queue[0];
    if (!id) {
      this.running = false;
      this.runAll.disabled = false;
      return;
    }
    const part = this.parts.get(id)!;
    part.started = performance.now();
    part.state.textContent = 'Running';
    part.state.dataset.state = 'running';
    this.worker!.postMessage({ type: 'proof', id: 1, check: id });
  }

  private update(id: string, update: ProofUpdate): void {
    const part = this.parts.get(id);
    if (!part) return;
    part.bar.style.transform = `scaleX(${update.progress})`;
    if (update.rows.length) {
      replace(
        part.body,
        update.rows.map((row) =>
          h(
            'tr',
            h('td', row.label),
            h('td', row.expected),
            h('td', row.measured),
            h('td', { class: row.ok === false ? 'error' : '' }, row.word ?? (row.ok === null ? '' : row.ok ? 'matches' : 'differs')),
          ),
        ),
      );
    }
    if (update.note) part.note.textContent = update.note;
    if (update.done) {
      const ok = update.rows.every((row) => row.ok !== false);
      const took = ((performance.now() - part.started) / 1000).toFixed(1);
      part.state.textContent = ok ? `Holds. ${took} s` : `Does not hold. ${took} s`;
      part.state.dataset.state = ok ? 'ok' : 'bad';
      this.queue.shift();
      this.next();
    }
  }
}
