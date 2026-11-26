// Cards set as type: the rank in the text face, the suit drawn here. Black
// suits are solid, red suits are drawn in outline, so no second colour is
// needed to tell them apart.

import { RANK_CHARS, rankOf, suitOf } from '../engine/cards.ts';
import { h } from './dom.ts';

const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];

// Outlines on a 20 x 20 box.
const PATHS = [
  // club
  'M10 2.2a3.9 3.9 0 0 1 3.4 5.8 3.9 3.9 0 1 1-2.3 6.6c.2 1.5.8 2.4 1.9 3.2H7c1.1-.8 1.7-1.7 1.9-3.2A3.9 3.9 0 1 1 6.6 8 3.9 3.9 0 0 1 10 2.2Z',
  // diamond
  'M10 1.8 16.6 10 10 18.2 3.4 10Z',
  // heart
  'M10 17.8C5.6 14 2.6 11.3 2.6 7.6a4 4 0 0 1 7.4-2.1 4 4 0 0 1 7.4 2.1c0 3.7-3 6.4-7.4 10.2Z',
  // spade
  'M10 1.8c4 3.7 7.2 6.3 7.2 9.7a3.7 3.7 0 0 1-6.1 2.8c.2 1.5.8 2.6 1.9 3.5H7c1.1-.9 1.7-2 1.9-3.5a3.7 3.7 0 0 1-6.1-2.8c0-3.4 3.2-6 7.2-9.7Z',
];

const SVG = 'http://www.w3.org/2000/svg';

export function suitIcon(suit: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', `suit suit-${SUIT_NAMES[suit]}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', PATHS[suit]!);
  const outline = suit === 1 || suit === 2;
  path.setAttribute('fill', outline ? 'none' : 'currentColor');
  if (outline) {
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.appendChild(path);
  return svg;
}

/** A card as inline type, readable by a screen reader as "king of spades". */
export function card(c: number): HTMLElement {
  const rank = RANK_CHARS[rankOf(c)]!;
  const names: Record<string, string> = { A: 'ace', K: 'king', Q: 'queen', J: 'jack', T: 'ten' };
  const el = h('span.card', { role: 'img', 'aria-label': `${names[rank] ?? rank} of ${SUIT_NAMES[suitOf(c)]}` });
  el.append(h('span.rank', { 'aria-hidden': 'true' }, rank === 'T' ? '10' : rank), suitIcon(suitOf(c)));
  return el;
}

export function cards(list: ArrayLike<number>): HTMLElement {
  const el = h('span.cards');
  for (let i = 0; i < list.length; i++) el.append(card(list[i]!));
  return el;
}

/** Draws a suit on a canvas, in a box of `size` pixels with its top-left corner at (x, y). */
export function drawSuit(ctx: CanvasRenderingContext2D, suit: number, x: number, y: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 20, size / 20);
  const path = new Path2D(PATHS[suit]!);
  if (suit === 1 || suit === 2) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  } else {
    ctx.fillStyle = color;
    ctx.fill(path);
  }
  ctx.restore();
}
