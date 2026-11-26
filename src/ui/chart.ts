// Exploitability against iterations, both on log axes, with the tolerance drawn
// as a line to cross. Dragging across the chart steps back through the solve.

import { FONT, INK, INK_3, INK_4, PAPER, RED, pixelRatio } from './theme.ts';
import { capture } from './dom.ts';
import { percent } from './format.ts';

export interface ChartPoint {
  iteration: number;
  /** Exploitability as a share of the pot. */
  value: number;
}

export class ConvergenceChart {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private points: ChartPoint[] = [];
  private head = 0;
  private tolerance = 0.001;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private scrubbing = false;
  /** Called with a point index while the pointer is over the chart, null when it leaves. */
  onscrub?: (index: number | null) => void;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'slider');
    this.canvas.setAttribute('aria-label', 'Step through the solve, iteration by iteration');
    this.el = document.createElement('div');
    this.el.className = 'chart';
    this.el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(this.el);

    const at = (event: PointerEvent) => {
      const box = this.canvas.getBoundingClientRect();
      const x = (event.clientX - box.left) * this.dpr;
      let best = 0;
      let distance = Infinity;
      for (let i = 0; i < this.points.length; i++) {
        const d = Math.abs(this.x(this.points[i]!.iteration) - x);
        if (d < distance) {
          distance = d;
          best = i;
        }
      }
      return best;
    };
    this.canvas.addEventListener('pointerdown', (event) => {
      if (!this.points.length) return;
      this.scrubbing = true;
      capture(this.canvas, event);
      this.onscrub?.(at(event));
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.points.length) return;
      if (event.pointerType === 'mouse' || this.scrubbing) this.onscrub?.(at(event));
    });
    const leave = () => {
      this.scrubbing = false;
      this.onscrub?.(null);
    };
    this.canvas.addEventListener('pointerup', (event) => {
      if (event.pointerType !== 'mouse') leave();
      this.scrubbing = false;
    });
    this.canvas.addEventListener('pointerleave', leave);
    this.canvas.addEventListener('pointercancel', leave);
    this.canvas.addEventListener('keydown', (event) => {
      if (!this.points.length) return;
      let next = this.head;
      if (event.key === 'ArrowLeft') next = Math.max(0, this.head - 1);
      else if (event.key === 'ArrowRight') next = Math.min(this.points.length - 1, this.head + 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = this.points.length - 1;
      else if (event.key === 'Escape') {
        this.onscrub?.(null);
        return;
      } else return;
      event.preventDefault();
      this.onscrub?.(next);
    });
    this.canvas.addEventListener('blur', () => this.onscrub?.(null));
  }

  set(points: ChartPoint[], head: number, tolerance: number): void {
    this.points = points;
    this.head = Math.max(0, Math.min(points.length - 1, head));
    this.tolerance = tolerance;
    const point = points[this.head];
    if (point) {
      this.canvas.setAttribute('aria-valuemin', '0');
      this.canvas.setAttribute('aria-valuemax', String(points[points.length - 1]!.iteration));
      this.canvas.setAttribute('aria-valuenow', String(point.iteration));
      this.canvas.setAttribute('aria-valuetext', `Iteration ${point.iteration}, exploitable for ${percent(point.value)} of the pot`);
    }
    this.draw();
  }

  private resize(): void {
    const dpr = pixelRatio();
    const width = Math.round(this.el.clientWidth * dpr);
    const height = Math.round(this.el.clientHeight * dpr);
    if (!width || !height || (width === this.width && height === this.height)) return;
    this.width = this.canvas.width = width;
    this.height = this.canvas.height = height;
    this.dpr = dpr;
    this.draw();
  }

  // Plot area and scales, in device pixels.
  private left = 0;
  private right = 0;
  private top = 0;
  private bottom = 0;
  private xMax = 3;
  private yTop = 2;
  private yBottom = -3;

  private x(iteration: number): number {
    return this.left + ((this.right - this.left) * Math.log10(1 + iteration)) / this.xMax;
  }

  private y(value: number): number {
    const v = Math.log10(Math.max(1e-9, value * 100));
    return this.top + ((this.bottom - this.top) * (this.yTop - v)) / (this.yTop - this.yBottom);
  }

  draw(): void {
    const { ctx, width, height, dpr, points } = this;
    if (!width) return;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);
    const text = 11 * dpr;
    ctx.font = `${text}px ${FONT}`;
    this.left = Math.round(46 * dpr);
    this.right = width - Math.round(8 * dpr);
    this.top = Math.round(10 * dpr);
    this.bottom = height - Math.round(22 * dpr);

    const lastIteration = points.length ? points[points.length - 1]!.iteration : 100;
    this.xMax = Math.max(2, Math.log10(1 + lastIteration) * 1.02);
    let peak = 100;
    for (const p of points) peak = Math.max(peak, p.value * 100);
    this.yTop = Math.ceil(Math.log10(peak) - 1e-9);
    let floor = this.tolerance * 100;
    for (const p of points) if (p.value > 0) floor = Math.min(floor, p.value * 100);
    this.yBottom = Math.floor(Math.log10(floor) + 1e-9) - 0.35;

    // Decade lines and their labels.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    const hair = Math.max(1, Math.round(dpr / 2));
    for (let d = this.yTop; d >= Math.ceil(this.yBottom); d--) {
      const y = Math.round(this.y(Math.pow(10, d) / 100));
      ctx.fillStyle = INK_4;
      ctx.fillRect(this.left, y, this.right - this.left, hair);
      ctx.fillStyle = INK_3;
      const label = d >= 0 ? `${Math.pow(10, d)}%` : `${(Math.pow(10, d)).toFixed(-d)}%`;
      ctx.fillText(label, this.left - 8 * dpr, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let d = 0; d <= Math.floor(this.xMax); d++) {
      const iteration = Math.pow(10, d);
      const x = Math.round(this.x(iteration));
      if (x > this.right) break;
      ctx.fillStyle = INK;
      ctx.fillRect(x, this.bottom, hair, 4 * dpr);
      ctx.fillStyle = INK_3;
      ctx.fillText(iteration.toLocaleString('en-US'), x, height - 4 * dpr);
    }
    ctx.fillStyle = INK;
    ctx.fillRect(this.left, this.bottom, this.right - this.left, dpr);
    ctx.fillRect(this.left, this.top, dpr, this.bottom - this.top);

    // The tolerance.
    const ty = Math.round(this.y(this.tolerance));
    ctx.strokeStyle = RED;
    ctx.lineWidth = dpr;
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.moveTo(this.left, ty + dpr / 2);
    ctx.lineTo(this.right, ty + dpr / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = RED;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`Tolerance ${percent(this.tolerance, 1)}`, this.left + 8 * dpr, ty - 5 * dpr);

    if (points.length < 1) return;
    const path = (from: number, to: number, color: string) => {
      if (to <= from) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = from; i <= to; i++) {
        const p = points[i]!;
        const px = this.x(p.iteration);
        const py = this.y(p.value);
        if (i === from) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };
    path(this.head, points.length - 1, INK_4);
    path(0, this.head, INK);

    const p = points[this.head]!;
    const px = this.x(p.iteration);
    const py = this.y(p.value);
    if (this.head < points.length - 1) {
      ctx.fillStyle = INK;
      ctx.fillRect(Math.round(px), this.top, hair, this.bottom - this.top);
    }
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(px, py, 3.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
}
