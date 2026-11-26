// Exact equity: one hand or range against another, every board dealt once.

import { COMBO_CLASS, COMBO_COUNT, parseCards } from '../engine/cards.ts';
import { parseRange } from '../engine/range.ts';
import { gloss, h, replace } from '../ui/dom.ts';
import { frequency, integer, seconds } from '../ui/format.ts';
import { cards } from '../ui/cards.ts';
import { Grid } from '../ui/grid.ts';
import type { EquityResult, Request, Response } from '../worker/protocol.ts';

const EXAMPLES: { name: string; a: string; b: string; board: string }[] = [
  { name: 'Aces against kings, before the flop', a: 'AsAh', b: 'KdKc', board: '' },
  { name: 'Ace-king suited against queens', a: 'AhKh', b: 'QsQd', board: '' },
  { name: 'A flush draw against top pair, on the turn', a: 'AhKh', b: 'QsJd', board: 'Qh 7h 2c 3d' },
  { name: 'Two ranges on a flop', a: 'QQ+, AKs, AKo', b: 'JJ-77, AQs-ATs, KQs, QJs, JTs', board: 'Ts 7h 2c' },
  { name: 'Two ranges before the flop', a: 'TT+, AQs+, AKo', b: '22+, A2s+, KTs+, QTs+, JTs, ATo+, KQo', board: '' },
];

const HAND = /^([2-9tjqka][cdhs]){2}$/i;

export class EquityView {
  readonly el: HTMLElement;
  private readonly worker: Worker;
  private request = 0;
  private readonly inputs = {
    a: h('input.field', { type: 'text', spellcheck: false, autocomplete: 'off', 'aria-label': 'First hand or range' }) as HTMLInputElement,
    b: h('input.field', { type: 'text', spellcheck: false, autocomplete: 'off', 'aria-label': 'Second hand or range' }) as HTMLInputElement,
    board: h('input.field', { type: 'text', spellcheck: false, autocomplete: 'off', placeholder: 'none', 'aria-label': 'Board' }) as HTMLInputElement,
  };
  private readonly figures = [h('div.figure'), h('div.figure')];
  private readonly names = [h('div.eq-name'), h('div.eq-name')];
  private readonly splitEl = h('div.split', { role: 'img' });
  private readonly blockEl = h('dl.block');
  private readonly errorEl = h('p.error', { role: 'alert' });
  private readonly gridsEl = h('div.eq-grids');
  private readonly grids = [new Grid('Equity of each hand in the first range'), new Grid('Equity of each hand in the second range')];
  private ranges: [Float64Array, Float64Array] | null = null;

  constructor() {
    this.worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<Response>) => {
      const message = event.data;
      if (message.id !== this.request) return;
      if (message.type === 'equity') this.render(message.result);
      else if (message.type === 'error') this.errorEl.textContent = message.message;
    };
    for (const input of Object.values(this.inputs)) input.addEventListener('change', () => this.run());

    const examples = h(
      'ul.examples',
      EXAMPLES.map((example) =>
        h(
          'li',
          h(
            'button.link',
            {
              onclick: () => {
                this.inputs.a.value = example.a;
                this.inputs.b.value = example.b;
                this.inputs.board.value = example.board;
                this.run();
              },
            },
            example.name,
          ),
        ),
      ),
    );

    this.el = h(
      'main',
      { id: 'main' },
      h('h1.sr', 'Exact equity'),
      h(
        'div.eq',
        h(
          'div.eq-in',
          h('label', gloss('First hand or range', '第一方'), this.inputs.a),
          h('label', gloss('Second hand or range', '第二方'), this.inputs.b),
          h('label', gloss('Board', '牌面'), this.inputs.board),
          h('button.btn.primary', { onclick: () => this.run() }, 'Count'),
          this.errorEl,
          h('div', h('div.sub', gloss('Try', '例子')), examples),
          h(
            'p.dim',
            'A hand is two cards, such as AhKh. A range is written QQ+, AKs, A5s-A2s, KQo:0.5. Every way the rest of the board can come is dealt once and counted; nothing is sampled.',
            h('span.zh', { lang: 'zh-Hans' }, '手牌写两张牌，范围按常用写法。剩余公共牌的每种发法都发一遍并计数，不做抽样。'),
          ),
        ),
        h(
          'div.eq-out',
          h('div.eq-pair', h('div', this.names[0]!, this.figures[0]!), h('div', this.names[1]!, this.figures[1]!)),
          this.splitEl,
          this.blockEl,
          this.gridsEl,
        ),
      ),
    );
    const first = EXAMPLES[0]!;
    this.inputs.a.value = first.a;
    this.inputs.b.value = first.b;
    this.run();
  }

  private run(): void {
    this.errorEl.textContent = '';
    try {
      const a = this.inputs.a.value.replace(/\s/g, '');
      const b = this.inputs.b.value.replace(/\s/g, '');
      const board = parseCards(this.inputs.board.value);
      if (![0, 3, 4, 5].includes(board.length)) throw new Error('A board has no cards, or three, four or five.');
      const exactA = HAND.test(a) ? parseCards(a) : null;
      const exactB = HAND.test(b) ? parseCards(b) : null;
      const rangeOf = (text: string, exact: number[] | null) => (exact ? parseRange(text.slice(0, 2) + text.slice(2)) : parseRange(this.spread(text)));
      const ra = rangeOf(a, exactA);
      const rb = rangeOf(b, exactB);
      const request: Request = {
        type: 'equity',
        id: ++this.request,
        a: ra,
        b: rb,
        board,
        exact: exactA && exactB ? [exactA, exactB] : null,
      };
      if (!request.exact && board.length === 0) {
        for (const range of [ra, rb]) {
          const byClass = new Map<number, number>();
          for (let i = 0; i < COMBO_COUNT; i++) {
            const seen = byClass.get(COMBO_CLASS[i]!);
            if (seen !== undefined && seen !== range[i]) throw new Error('Before the flop, ranges are compared hand class by hand class: write AKs, not single combinations.');
            byClass.set(COMBO_CLASS[i]!, range[i]!);
          }
        }
      }
      if (!ra.some((w) => w > 0) || !rb.some((w) => w > 0)) throw new Error('Both sides need at least one hand.');
      this.ranges = request.exact ? null : [ra, rb];
      this.names[0]!.replaceChildren(exactA ? cards(exactA) : document.createTextNode(this.inputs.a.value));
      this.names[1]!.replaceChildren(exactB ? cards(exactB) : document.createTextNode(this.inputs.b.value));
      this.worker.postMessage(request);
    } catch (error) {
      this.errorEl.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  /** Puts the commas back that stripping the spaces may have left alone. */
  private spread(text: string): string {
    return text.replace(/,/g, ', ');
  }

  private render(result: EquityResult): void {
    result.equity.forEach((share, i) => {
      const text = (share * 100).toFixed(2);
      replace(this.figures[i]!, text, h('span.unit', '%'));
    });
    const tie = result.mode === 'hands' ? (result.tie ?? 0) / result.boards : 0;
    const winA = result.mode === 'hands' ? (result.win ?? 0) / result.boards : result.equity[0];
    this.splitEl.setAttribute('aria-label', `First side ${frequency(result.equity[0], 2)}, second side ${frequency(result.equity[1], 2)}`);
    replace(
      this.splitEl,
      h('i.a', { style: { width: `${winA * 100}%` } }),
      tie > 0 ? h('i.t', { style: { width: `${tie * 100}%` } }) : null,
      h('i.b', { style: { flex: '1' } }),
    );
    const rows: (HTMLElement | null)[][] = [];
    if (result.mode === 'hands') {
      rows.push(
        [h('dt', gloss('First hand wins', '第一方赢')), h('dd', `${integer(result.win!)} boards`)],
        [h('dt', gloss('Tied', '平分')), h('dd', `${integer(result.tie!)} boards`)],
        [h('dt', gloss('Second hand wins', '第二方赢')), h('dd', `${integer(result.lose!)} boards`)],
        [h('dt', gloss('Dealt', '发牌')), h('dd', `${integer(result.boards)} boards, every one, in ${seconds(result.ms)}`)],
      );
    } else if (result.mode === 'ranges') {
      rows.push([h('dt', gloss('Dealt', '发牌')), h('dd', `${integer(result.boards)} ways to finish the board, every one, in ${seconds(result.ms)}`)]);
      rows.push([h('dt', gloss('Counted', '计数')), h('dd', 'each hand against the whole opposing range, less the hands that share a card')]);
    } else {
      rows.push([h('dt', gloss('From', '来源')), h('dd', `the exact preflop table: ${integer(result.boards)} boards for every pairing of hands`)]);
      rows.push([h('dt', gloss('Counted in', '用时')), h('dd', seconds(result.ms))]);
    }
    replace(this.blockEl, rows);

    if (result.byCombo && this.ranges) {
      this.gridsEl.hidden = false;
      result.byCombo.forEach((byCombo, p) => {
        const sum = new Float64Array(169);
        const weight = new Float64Array(169);
        const size = new Float64Array(169);
        for (let i = 0; i < COMBO_COUNT; i++) {
          const c = COMBO_CLASS[i]!;
          size[c]!++;
          const w = this.ranges![p]![i]!;
          if (!(w > 0) || Number.isNaN(byCombo[i]!)) continue;
          sum[c]! += w * byCombo[i]!;
          weight[c]! += w;
        }
        const seg = new Float32Array(169);
        const fill = new Float32Array(169);
        const tone = new Uint8Array(169);
        const text: (string | null)[] = [];
        for (let c = 0; c < 169; c++) {
          if (weight[c]! > 0) {
            seg[c] = sum[c]! / weight[c]!;
            fill[c] = 1;
            tone[c] = 2;
            text.push(String(Math.round(seg[c]! * 100)));
          } else text.push(null);
        }
        this.grids[p]!.set({ k: 1, seg, fill, styles: [p === 0 ? 'ink' : 'grey'], tone, text: p === 1 ? text : undefined });
      });
      if (!this.gridsEl.childElementCount) {
        this.gridsEl.append(
          h('div', h('div.sub', gloss('First range, equity of each hand', '第一方各手牌胜率')), this.grids[0]!.el),
          h('div', h('div.sub', gloss('Second range, equity of each hand', '第二方各手牌胜率')), this.grids[1]!.el),
        );
      }
    } else {
      this.gridsEl.hidden = true;
    }
  }
}
