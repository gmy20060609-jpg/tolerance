// Push or fold: the exact heads-up equilibrium at any stack depth, solved as
// the ruler is dragged.

import { CLASS_NAMES } from '../engine/cards.ts';
import type { PushFoldSolution } from '../engine/pushfold.ts';
import { capture, frameLoop, gloss, h, replace } from '../ui/dom.ts';
import { frequency } from '../ui/format.ts';
import { Grid, type GridData } from '../ui/grid.ts';
import { FONT, GREY, INK, INK_3, INK_4, PAPER, RED, pixelRatio } from '../ui/theme.ts';
import type { Request, Response } from '../worker/protocol.ts';

const MIN = 1;
const MAX = 25;
const STEP = 0.1;
const key = (stack: number) => Math.round(stack * 10);

export class PushFoldView {
  readonly el: HTMLElement;
  private readonly worker: Worker;
  private stack = 10;
  private readonly solved = new Map<number, PushFoldSolution>();
  private shown: PushFoldSolution | null = null;
  private lastMs = 0;
  private mode: 'now' | 'limit' = 'now';
  private selected = CLASS_NAMES.indexOf('63s');
  private request = 0;
  private sweepDone = false;

  private readonly grids = [
    new Grid('How often the small blind moves all-in with each starting hand'),
    new Grid('How often the big blind calls an all-in with each starting hand'),
  ];
  private readonly ruler = document.createElement('canvas');
  private readonly rulerBox = h('div.ruler');
  private readonly trace = document.createElement('canvas');
  private readonly traceBox = h('div.trace');
  private readonly stackEl = h('div.figure');
  private readonly shares = [h('span.share'), h('span.share')];
  private readonly blockEl = h('dl.block');
  private readonly handEl = h('div');
  private readonly modeButtons: HTMLButtonElement[] = [];
  private readonly loop = frameLoop(() => this.draw());

  constructor() {
    this.worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<Response>) => this.receive(event.data);

    this.ruler.tabIndex = 0;
    this.ruler.setAttribute('role', 'slider');
    this.ruler.setAttribute('aria-label', 'Stack depth in big blinds');
    this.ruler.setAttribute('aria-valuemin', String(MIN));
    this.ruler.setAttribute('aria-valuemax', String(MAX));
    this.rulerBox.append(this.ruler);
    this.traceBox.append(this.trace);
    new ResizeObserver(() => this.loop.kick()).observe(this.rulerBox);
    new ResizeObserver(() => this.loop.kick()).observe(this.traceBox);
    this.listen();

    for (const grid of this.grids) {
      grid.onpick = (cell) => {
        this.selected = cell;
        this.loop.kick();
      };
      grid.onhover = () => this.loop.kick();
    }

    const modes: ['now' | 'limit', string, string][] = [
      ['now', 'At this stack', '当前深度'],
      ['limit', 'Deepest stack played', '最深玩到'],
    ];
    const toggle = h(
      'div.toggle',
      { role: 'group', 'aria-label': 'What the grids show' },
      modes.map(([mode, en, zh]) => {
        const button = h('button', { 'aria-pressed': String(mode === this.mode), onclick: () => this.setMode(mode) }, gloss(en, zh));
        this.modeButtons.push(button);
        return button;
      }),
    );

    const column = (index: number, en: string, zh: string) =>
      h('div.pf-grid', h('div.pf-head', h('h3', gloss(en, zh)), this.shares[index]!), this.grids[index]!.el);

    this.el = h(
      'main',
      { id: 'main' },
      h('h1.sr', 'Push or fold: the heads-up equilibrium'),
      h(
        'div.pf',
        h(
          'div.pf-top',
          h(
            'div.pf-stack',
            h('div.label', gloss('Each player starts the hand with', '双方起始筹码')),
            this.stackEl,
          ),
          h(
            'div.pf-rule',
            this.rulerBox,
            h(
              'p.dim',
              'Drag the ruler. Blinds are 0.5 and 1, no ante. The small blind moves all-in or folds; the big blind calls or folds. Each depth is solved as you reach it.',
              h('span.zh', { lang: 'zh-Hans' }, '拖动标尺。盲注 0.5/1，无前注。小盲全下或弃牌，大盲跟注或弃牌。每个深度到了才解。'),
            ),
          ),
        ),
        h(
          'div.pf-body',
          column(0, 'Small blind moves all-in', '小盲全下'),
          column(1, 'Big blind calls', '大盲跟注'),
          h('div.pf-side', toggle, this.blockEl, this.handEl, this.traceBox),
        ),
      ),
    );

    this.send({ type: 'sweep', id: ++this.request, from: MIN, to: MAX, step: STEP });
    this.ask();
    this.draw();
  }

  private send(request: Request): void {
    this.worker.postMessage(request);
  }

  private ask(): void {
    if (!this.solved.has(key(this.stack))) this.send({ type: 'pushfold', id: ++this.request, stack: this.stack });
    this.loop.kick();
  }

  private receive(message: Response): void {
    if (message.type === 'pushfold') {
      this.solved.set(key(message.solution.stack), message.solution);
      this.lastMs = message.ms;
    } else if (message.type === 'sweep') {
      this.solved.set(key(message.solution.stack), message.solution);
      if (message.done) this.sweepDone = true;
    } else return;
    this.loop.kick();
  }

  private setMode(mode: 'now' | 'limit'): void {
    this.mode = mode;
    this.modeButtons.forEach((button, i) => button.setAttribute('aria-pressed', String((i === 0) === (mode === 'now'))));
    this.loop.kick();
  }

  private setStack(stack: number): void {
    const next = Math.min(MAX, Math.max(MIN, Math.round(stack / STEP) * STEP));
    if (key(next) === key(this.stack)) return;
    this.stack = Math.round(next * 10) / 10;
    this.ask();
  }

  private listen(): void {
    const at = (event: PointerEvent) => {
      const box = this.ruler.getBoundingClientRect();
      const inset = 14;
      return MIN + ((event.clientX - box.left - inset) / (box.width - 2 * inset)) * (MAX - MIN);
    };
    let down = false;
    this.ruler.addEventListener('pointerdown', (event) => {
      down = true;
      capture(this.ruler, event);
      this.setStack(at(event));
    });
    this.ruler.addEventListener('pointermove', (event) => down && this.setStack(at(event)));
    this.ruler.addEventListener('pointerup', () => (down = false));
    this.ruler.addEventListener('pointercancel', () => (down = false));
    this.ruler.addEventListener('keydown', (event) => {
      const big = event.shiftKey ? 1 : STEP;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') this.setStack(this.stack + big);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') this.setStack(this.stack - big);
      else if (event.key === 'PageUp') this.setStack(this.stack + 1);
      else if (event.key === 'PageDown') this.setStack(this.stack - 1);
      else if (event.key === 'Home') this.setStack(MIN);
      else if (event.key === 'End') this.setStack(MAX);
      else return;
      event.preventDefault();
    });
  }

  /** The deepest solved stack at which the hand is played at least half the time. */
  private limit(side: 'push' | 'call', hand: number): number {
    let last = 0;
    for (let k = key(MIN); k <= key(MAX); k++) {
      const solution = this.solved.get(k);
      if (solution && solution[side][hand]! >= 0.5) last = k / 10;
    }
    return last;
  }

  private draw(): void {
    const solution = this.solved.get(key(this.stack)) ?? this.shown;
    if (solution && solution.stack === this.stack) this.shown = solution;
    this.ruler.setAttribute('aria-valuenow', String(this.stack));
    this.ruler.setAttribute('aria-valuetext', `${this.stack.toFixed(1)} big blinds`);
    replace(this.stackEl, this.stack.toFixed(1), h('span.unit', ' bb'));
    this.drawRuler();

    const current = this.solved.get(key(this.stack));
    const sides = ['push', 'call'] as const;
    sides.forEach((side, index) => {
      const source = current ?? this.shown;
      const seg = new Float32Array(169);
      const fill = new Float32Array(169);
      const tone = new Uint8Array(169);
      let text: (string | null)[] | undefined;
      if (this.mode === 'now') {
        if (source) {
          for (let c = 0; c < 169; c++) {
            const f = source[side][c]!;
            seg[c] = f;
            fill[c] = f > 0.001 ? 1 : 0;
            tone[c] = f > 0.001 ? 2 : 0;
          }
        }
      } else {
        text = [];
        for (let c = 0; c < 169; c++) {
          const limit = this.limit(side, c);
          seg[c] = limit / MAX;
          fill[c] = limit > 0 ? 1 : 0;
          tone[c] = limit > 0 ? 2 : 0;
          // The figures are only final once every depth has been solved.
          text.push(!this.sweepDone ? null : limit >= MAX ? '25+' : limit > 0 ? limit.toFixed(1) : null);
        }
      }
      const data: GridData = { k: 1, seg, fill, styles: [side === 'push' ? 'solid' : 'grey'], tone, text };
      const grid = this.grids[index]!;
      grid.selected = this.selected;
      grid.set(data);
      this.shares[index]!.textContent = current ? frequency(side === 'push' ? current.pushShare : current.callShare) : '';
    });

    if (current) {
      replace(
        this.blockEl,
        h('dt', gloss('Small blind wins', '小盲期望')),
        h('dd', `${current.value >= 0 ? '+' : '−'}${Math.abs(current.value).toFixed(4)} bb a hand`),
        h('dt', gloss('Exploitable for', '可剥削度')),
        h('dd', `${current.exploitability.toFixed(8)} bb a hand`),
        h('dt', gloss('Solved in', '求解')),
        h('dd', `${current.iterations} iterations${this.lastMs ? `, ${Math.round(this.lastMs)} ms` : ''}`),
        h('dt', gloss('Depths solved', '已解深度')),
        h('dd', `${this.solved.size} of ${key(MAX) - key(MIN) + 1}`),
      );
    }
    this.drawHand(current ?? this.shown);
  }

  private drawRuler(): void {
    const dpr = pixelRatio();
    const width = Math.round(this.rulerBox.clientWidth * dpr);
    const height = Math.round(this.rulerBox.clientHeight * dpr);
    if (!width || !height) return;
    if (this.ruler.width !== width || this.ruler.height !== height) {
      this.ruler.width = width;
      this.ruler.height = height;
    }
    const ctx = this.ruler.getContext('2d')!;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);
    const inset = 14 * dpr;
    const x = (stack: number) => Math.round(inset + ((width - 2 * inset) * (stack - MIN)) / (MAX - MIN));
    const base = height - Math.round(22 * dpr);
    const hair = Math.max(1, Math.round(dpr / 2));
    const fine = (width - 2 * inset) / dpr / (key(MAX) - key(MIN)) >= 3;
    for (let k = key(MIN); k <= key(MAX); k++) {
      const whole = k % 10 === 0;
      const half = k % 5 === 0;
      if (!fine && !half) continue;
      const length = (whole ? 22 : half ? 13 : 7) * dpr;
      ctx.fillStyle = this.solved.has(k) ? INK : INK_4;
      ctx.fillRect(x(k / 10), base - length, whole ? dpr : hair, length);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(x(MIN), base, x(MAX) - x(MIN) + dpr, dpr);
    ctx.font = `${11 * dpr}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let s = MIN; s <= MAX; s++) {
      if (s !== 1 && s % 5 !== 0 && width / dpr < 900) continue;
      ctx.fillStyle = INK_3;
      ctx.fillText(String(s), x(s), height - 5 * dpr);
    }
    // The marker.
    const mx = x(this.stack);
    ctx.fillStyle = RED;
    ctx.fillRect(mx - dpr, 0, 2 * dpr + (dpr % 2 ? 0 : 0), base);
    ctx.beginPath();
    ctx.moveTo(mx - 6 * dpr, 0);
    ctx.lineTo(mx + 7 * dpr, 0);
    ctx.lineTo(mx + dpr / 2, 9 * dpr);
    ctx.closePath();
    ctx.fill();
  }

  /** The selected hand across every solved depth. */
  private drawHand(solution: PushFoldSolution | null): void {
    const hand = this.selected;
    const name = CLASS_NAMES[hand]!;
    const spans = (side: 'push' | 'call'): string => {
      const parts: string[] = [];
      let from = -1;
      let prev = -1;
      for (let k = key(MIN); k <= key(MAX) + 1; k++) {
        const s = this.solved.get(k);
        const on = k <= key(MAX) && s !== undefined && s[side][hand]! >= 0.5;
        if (on && from < 0) from = k;
        if (!on && from >= 0) {
          parts.push(from === prev ? (from / 10).toFixed(1) : `${(from / 10).toFixed(1)} to ${(prev / 10).toFixed(1)}`);
          from = -1;
        }
        if (on) prev = k;
      }
      return parts.length ? parts.join(', ') : 'never';
    };
    replace(
      this.handEl,
      h('div.sub', h('span', `${name} across every depth`, h('span.zh', { lang: 'zh-Hans' }, '所选手牌')), h('span.dim', { style: { fontWeight: '400' } }, 'pick a hand in either grid')),
      h(
        'dl.block',
        h('dt', 'Pushed at'),
        h('dd', `${spans('push')} bb`),
        h('dt', 'Called at'),
        h('dd', `${spans('call')} bb`),
        solution ? [h('dt', `Pushing at ${solution.stack.toFixed(1)} bb gains`), h('dd', `${solution.pushEdge[hand]! >= 0 ? '+' : '−'}${Math.abs(solution.pushEdge[hand]!).toFixed(4)} bb over folding`)] : null,
      ),
    );

    const dpr = pixelRatio();
    const width = Math.round(this.traceBox.clientWidth * dpr);
    const height = Math.round(this.traceBox.clientHeight * dpr);
    if (!width || !height) return;
    if (this.trace.width !== width || this.trace.height !== height) {
      this.trace.width = width;
      this.trace.height = height;
    }
    const ctx = this.trace.getContext('2d')!;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);
    const left = 0;
    const right = width - dpr;
    const top = 6 * dpr;
    const bottom = height - 18 * dpr;
    const x = (stack: number) => left + ((right - left) * (stack - MIN)) / (MAX - MIN);
    const y = (f: number) => bottom - (bottom - top) * f;
    const hair = Math.max(1, Math.round(dpr / 2));
    ctx.fillStyle = INK_4;
    ctx.fillRect(left, Math.round(y(1)), right - left, hair);
    ctx.fillRect(left, Math.round(y(0.5)), right - left, hair);
    ctx.fillStyle = INK;
    ctx.fillRect(left, Math.round(y(0)), right - left, dpr);
    ctx.font = `${11 * dpr}px ${FONT}`;
    ctx.fillStyle = INK_3;
    ctx.textBaseline = 'alphabetic';
    for (const s of [1, 5, 10, 15, 20, 25]) {
      ctx.textAlign = s === 1 ? 'left' : s === 25 ? 'right' : 'center';
      ctx.fillText(String(s), x(s), height - 4 * dpr);
    }
    const line = (side: 'push' | 'call', color: string, weight: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = weight * dpr;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (let k = key(MIN); k <= key(MAX); k++) {
        const s = this.solved.get(k);
        if (!s) {
          started = false;
          continue;
        }
        const px = x(k / 10);
        const py = y(s[side][hand]!);
        if (started) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        started = true;
      }
      ctx.stroke();
    };
    line('call', GREY, 3);
    line('push', RED, 1.5);
    ctx.fillStyle = INK;
    ctx.fillRect(Math.round(x(this.stack)), top, hair, bottom - top);
  }
}
