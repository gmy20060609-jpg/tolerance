// The 13 x 13 grid of starting hands, drawn on a canvas.
//
// Each cell has a strip for the hand's name and, under it, a bar. The bar's
// height says how much of the hand is in play; its width is divided among
// segments, one per action. Passive actions are flat grey, aggressive ones red:
// hatched lightly for the smallest size, more densely for larger ones, solid
// for the largest.

import { CLASS_NAMES } from '../engine/cards.ts';
import { capture } from './dom.ts';
import { FONT, GREY, INK, INK_3, INK_4, LINE, PAPER, RED, pixelRatio } from './theme.ts';

export type SegStyle = 'none' | 'grey' | 'solid' | 'hatch0' | 'hatch1' | 'hatch2' | 'ink';

export interface GridData {
  /** Segments per cell. */
  k: number;
  /** seg[cell * k + i]: share of the bar's width given to segment i. */
  seg: Float32Array;
  /** fill[cell]: height of the bar, 0 to 1. */
  fill: Float32Array;
  styles: SegStyle[];
  /** 0: not in play, 1: still moving, 2: settled. */
  tone: Uint8Array;
  /** Optional figure per cell, drawn over the bar. */
  text?: (string | null)[];
}

const patterns = new Map<string, CanvasPattern>();

function hatch(ctx: CanvasRenderingContext2D, level: number, dpr: number): CanvasPattern {
  const key = `${level}@${dpr}`;
  const cached = patterns.get(key);
  if (cached) return cached;
  const spacing = Math.round([7, 3.5, 4][level]! * dpr);
  const tile = document.createElement('canvas');
  tile.width = tile.height = spacing;
  const t = tile.getContext('2d')!;
  t.strokeStyle = RED;
  t.lineWidth = Math.max(1, dpr * 0.9);
  t.lineCap = 'square';
  const stroke = (rising: boolean) => {
    for (let k = -1; k <= 1; k++) {
      t.beginPath();
      if (rising) {
        t.moveTo(k * spacing, spacing);
        t.lineTo((k + 1) * spacing, 0);
      } else {
        t.moveTo(k * spacing, 0);
        t.lineTo((k + 1) * spacing, spacing);
      }
      t.stroke();
    }
  };
  stroke(true);
  if (level === 2) stroke(false);
  const pattern = ctx.createPattern(tile, 'repeat')!;
  patterns.set(key, pattern);
  return pattern;
}

export function segFill(ctx: CanvasRenderingContext2D, style: SegStyle, dpr: number): string | CanvasPattern | null {
  switch (style) {
    case 'none':
      return null;
    case 'grey':
      return GREY;
    case 'solid':
      return RED;
    case 'ink':
      return INK;
    case 'hatch0':
      return hatch(ctx, 0, dpr);
    case 'hatch1':
      return hatch(ctx, 1, dpr);
    case 'hatch2':
      return hatch(ctx, 2, dpr);
  }
}

/** Paints a legend swatch with the same fills the grid uses. */
export function swatch(style: SegStyle): HTMLCanvasElement {
  const dpr = pixelRatio();
  const canvas = document.createElement('canvas');
  canvas.className = 'swatch';
  canvas.width = canvas.height = Math.round(14 * dpr);
  const ctx = canvas.getContext('2d')!;
  const fill = segFill(ctx, style, dpr);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = dpr;
  ctx.strokeRect(dpr / 2, dpr / 2, canvas.width - dpr, canvas.height - dpr);
  return canvas;
}

export class Grid {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private data: GridData | null = null;
  private size = 0;
  private dpr = 1;
  hover = -1;
  selected = -1;
  marks: number[] = [];
  /** Called when the pointer or keyboard focus moves to a cell, -1 when it leaves. */
  onhover?: (cell: number) => void;
  /** Called on click, tap or Enter. */
  onpick?: (cell: number) => void;
  /** Called while a pointer is held down and dragged across cells. */
  onpaint?: (cell: number, first: boolean) => void;

  constructor(label: string) {
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', label);
    this.el = document.createElement('div');
    this.el.className = 'grid';
    this.el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(this.el);
    this.listen();
  }

  set(data: GridData): void {
    this.data = data;
    this.draw();
  }

  private resize(): void {
    const width = this.el.clientWidth;
    const dpr = pixelRatio();
    if (!width) return;
    const size = Math.round(width * dpr);
    if (size === this.size && dpr === this.dpr) return;
    this.size = size;
    this.dpr = dpr;
    this.canvas.width = this.canvas.height = size;
    this.draw();
  }

  private cellAt(event: PointerEvent): number {
    const box = this.canvas.getBoundingClientRect();
    const col = Math.floor(((event.clientX - box.left) / box.width) * 13);
    const row = Math.floor(((event.clientY - box.top) / box.height) * 13);
    if (col < 0 || col > 12 || row < 0 || row > 12) return -1;
    return row * 13 + col;
  }

  private listen(): void {
    const c = this.canvas;
    let down = false;
    let last = -1;
    let moved = false;
    c.addEventListener('pointerdown', (event) => {
      const cell = this.cellAt(event);
      if (cell < 0) return;
      down = true;
      moved = false;
      last = cell;
      if (this.onpaint) {
        capture(c, event);
        this.onpaint(cell, true);
      }
    });
    c.addEventListener('pointermove', (event) => {
      const cell = this.cellAt(event);
      if (down && this.onpaint && cell >= 0 && cell !== last) {
        moved = true;
        last = cell;
        this.onpaint(cell, false);
      }
      if (event.pointerType === 'mouse' && cell !== this.hover) {
        this.hover = cell;
        this.onhover?.(cell);
        this.draw();
      }
    });
    c.addEventListener('pointerup', (event) => {
      const cell = this.cellAt(event);
      if (down && !moved && cell >= 0 && !this.onpaint) this.onpick?.(cell);
      down = false;
    });
    c.addEventListener('pointercancel', () => (down = false));
    c.addEventListener('pointerleave', () => {
      if (this.hover !== -1) {
        this.hover = -1;
        this.onhover?.(-1);
        this.draw();
      }
    });
    c.addEventListener('keydown', (event) => {
      const at = this.hover >= 0 ? this.hover : this.selected >= 0 ? this.selected : 0;
      let next = at;
      if (event.key === 'ArrowRight') next = at % 13 < 12 ? at + 1 : at;
      else if (event.key === 'ArrowLeft') next = at % 13 > 0 ? at - 1 : at;
      else if (event.key === 'ArrowDown') next = at < 156 ? at + 13 : at;
      else if (event.key === 'ArrowUp') next = at >= 13 ? at - 13 : at;
      else if (event.key === 'Enter' || event.key === ' ') {
        if (this.onpaint) this.onpaint(at, true);
        else this.onpick?.(at);
        event.preventDefault();
        return;
      } else return;
      event.preventDefault();
      this.hover = next;
      this.onhover?.(next);
      this.draw();
    });
    c.addEventListener('blur', () => {
      if (this.hover !== -1) {
        this.hover = -1;
        this.onhover?.(-1);
        this.draw();
      }
    });
  }

  draw(): void {
    const { ctx, size, dpr, data } = this;
    if (!size) return;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, size, size);
    const edge = (i: number) => Math.round((i * (size - dpr)) / 13);
    const cell = (size - dpr) / 13;
    const cssCell = cell / dpr;
    const strip = Math.round(cell * 0.36);
    const fontSize = Math.max(8, Math.min(13, cssCell * 0.205)) * dpr;
    const pad = Math.round(Math.max(2.5, cssCell * 0.075) * dpr);

    if (data) {
      const { k, seg, fill, styles } = data;
      const fills = styles.map((style) => segFill(ctx, style, dpr));
      for (let row = 0; row < 13; row++) {
        const y0 = edge(row) + dpr;
        const y1 = edge(row + 1);
        const zone = y1 - y0 - strip;
        for (let col = 0; col < 13; col++) {
          const c = row * 13 + col;
          const f = fill[c]!;
          if (f <= 0) continue;
          const x0 = edge(col) + dpr;
          const x1 = edge(col + 1);
          const width = x1 - x0;
          const height = Math.max(dpr, Math.round(zone * Math.min(1, f)));
          let x = x0;
          let acc = 0;
          for (let i = 0; i < k; i++) {
            acc += seg[c * k + i]!;
            const next = i === k - 1 ? x0 + Math.round(width * Math.min(1, acc)) : x0 + Math.round(width * Math.min(1, acc));
            const style = fills[i];
            if (style && next > x) {
              ctx.fillStyle = style;
              ctx.fillRect(x, y1 - height, next - x, height);
            }
            x = next;
          }
        }
      }
    }

    // Hairlines between cells, a full line around the grid.
    ctx.fillStyle = LINE;
    const hair = Math.max(1, Math.round(dpr / 2));
    for (let i = 1; i < 13; i++) {
      ctx.fillRect(edge(i), 0, hair, size);
      ctx.fillRect(0, edge(i), size, hair);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, size, dpr);
    ctx.fillRect(0, size - dpr, size, dpr);
    ctx.fillRect(0, 0, dpr, size);
    ctx.fillRect(size - dpr, 0, dpr, size);

    // Names.
    ctx.font = `${fontSize}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (let c = 0; c < 169; c++) {
      const row = (c / 13) | 0;
      const col = c % 13;
      const t = data ? data.tone[c]! : 0;
      ctx.fillStyle = t === 2 ? INK : t === 1 ? INK_3 : INK_4;
      ctx.fillText(CLASS_NAMES[c]!, edge(col) + dpr + pad, edge(row) + dpr + strip / 2 + dpr * 0.5);
    }

    if (data?.text) {
      ctx.font = `500 ${Math.max(8.5, Math.min(15, cssCell * 0.25)) * dpr}px ${FONT}`;
      ctx.textAlign = 'right';
      for (let c = 0; c < 169; c++) {
        const text = data.text[c];
        if (!text) continue;
        const row = (c / 13) | 0;
        const col = c % 13;
        ctx.fillStyle = INK;
        ctx.fillText(text, edge(col + 1) - pad, edge(row) + dpr + strip + (edge(row + 1) - edge(row) - strip) / 2);
      }
    }

    // Marked cells carry a corner flag; the hovered and the selected cell an outline.
    ctx.fillStyle = INK;
    for (const c of this.marks) {
      const x1 = edge((c % 13) + 1);
      const y0 = edge((c / 13) | 0) + dpr;
      const flag = Math.round(Math.max(5, cssCell * 0.16) * dpr);
      ctx.beginPath();
      ctx.moveTo(x1, y0);
      ctx.lineTo(x1 - flag, y0);
      ctx.lineTo(x1, y0 + flag);
      ctx.closePath();
      ctx.fill();
    }
    const outline = (c: number, weight: number) => {
      const x0 = edge(c % 13);
      const y0 = edge((c / 13) | 0);
      const x1 = edge((c % 13) + 1) + dpr;
      const y1 = edge(((c / 13) | 0) + 1) + dpr;
      const w = weight * dpr;
      ctx.fillStyle = INK;
      ctx.fillRect(x0, y0, x1 - x0, w);
      ctx.fillRect(x0, y1 - w, x1 - x0, w);
      ctx.fillRect(x0, y0, w, y1 - y0);
      ctx.fillRect(x1 - w, y0, w, y1 - y0);
    };
    if (this.selected >= 0) outline(this.selected, 2);
    if (this.hover >= 0 && this.hover !== this.selected) outline(this.hover, 1);
  }
}
