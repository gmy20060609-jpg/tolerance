// A few lines of DOM plumbing. There is no framework underneath.

type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown>;

/** Creates an element: h('button.primary', { onclick }, 'Solve'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  props?: Props | Child,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag as K);
  if (classes.length) el.className = classes.join(' ');
  if (props !== undefined && props !== null && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
    for (const [key, value] of Object.entries(props as Props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener);
      else if (key === 'class') el.className = [el.className, value].filter(Boolean).join(' ');
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key in el && key !== 'list') (el as unknown as Props)[key] = value;
      else el.setAttribute(key, String(value));
    }
  } else {
    children.unshift(props as Child);
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child): void {
  if (Array.isArray(children)) for (const child of children) append(el, child);
  else if (children instanceof Node) el.appendChild(children);
  else if (children !== null && children !== undefined && children !== false) el.appendChild(document.createTextNode(String(children)));
}

export function replace(el: Element, ...children: Child[]): void {
  el.textContent = '';
  append(el, children);
}

/** English text with its Chinese gloss. */
export function gloss(en: Child, zh: string): HTMLElement {
  return h('span.pair', en, h('span.zh', { lang: 'zh-Hans' }, zh));
}

/** Runs `draw` at most once per animation frame. */
export function frameLoop(draw: (time: number) => boolean | void): { kick(): void; stop(): void } {
  let handle = 0;
  const tick = (time: number) => {
    handle = 0;
    if (draw(time) === true) handle = requestAnimationFrame(tick);
  };
  return {
    kick() {
      if (!handle) handle = requestAnimationFrame(tick);
    },
    stop() {
      if (handle) cancelAnimationFrame(handle);
      handle = 0;
    },
  };
}

export const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Keeps a drag attached to the element it started on, where the browser allows it. */
export function capture(el: Element, event: PointerEvent): void {
  try {
    el.setPointerCapture(event.pointerId);
  } catch {
    // A synthetic or already released pointer cannot be captured; the drag still works inside the element.
  }
}

/**
 * Rebuilds part of the page without dropping keyboard focus: whichever
 * control held it gets it back, by position.
 */
export function keepFocus(container: Element, rebuild: () => void): void {
  const controls = 'button, a[href], select, input, textarea';
  const active = document.activeElement;
  const index = active && container.contains(active) ? Array.from(container.querySelectorAll(controls)).indexOf(active) : -1;
  rebuild();
  if (index < 0) return;
  const items = container.querySelectorAll<HTMLElement>(controls);
  items[Math.min(index, items.length - 1)]?.focus();
}
