// Tolerance: the page shell. Four tools, one per route.

import { gloss, h } from './ui/dom.ts';
import { RiverView } from './views/river.ts';

interface View {
  el: HTMLElement;
  /** Called each time the view is shown. */
  opened?(): void;
}

const routes: { hash: string; en: string; zh: string; load: () => Promise<View> }[] = [
  // The river view is the first screen, so it ships with the page itself.
  { hash: '#river', en: 'River', zh: '河牌', load: async () => new RiverView() },
  { hash: '#push-or-fold', en: 'Push or fold', zh: '全下或弃牌', load: async () => new (await import('./views/pushfold.ts')).PushFoldView() },
  { hash: '#equity', en: 'Equity', zh: '胜率', load: async () => new (await import('./views/equity.ts')).EquityView() },
  { hash: '#proof', en: 'Proof', zh: '验证', load: async () => new (await import('./views/proof.ts')).ProofView() },
];

const app = document.getElementById('app')!;
const slot = h('div.slot');
const links = routes.map((route) => h('a', { href: route.hash }, gloss(route.en, route.zh)));

app.append(
  h(
    'header.top',
    h('a.mark', { href: '#river', 'aria-label': 'Tolerance, home' }, gloss('Tolerance', '公差')),
    h('nav.nav', { 'aria-label': 'Tools' }, links),
    h('a.by', { href: 'https://karnak.design', target: '_blank', rel: 'noopener' }, 'Karnak'),
  ),
  slot,
  h(
    'footer.foot',
    h(
      'p',
      'Tolerance solves heads-up poker in two places: any river, and all-in-or-fold play before the flop. Every answer is stated with what a perfect opponent could still win from it.',
      h('span.zh', { lang: 'zh-Hans' }, '公差只解单挑的两处：任意河牌，以及翻前的全下或弃牌。每个答案都附带完美对手还能多赢多少。'),
    ),
    h(
      'p',
      h('a', { href: 'https://github.com/gmy20060609-jpg/tolerance', target: '_blank', rel: 'noopener' }, 'Source and tests'),
      ' · made by ',
      h('a', { href: 'https://karnak.design', target: '_blank', rel: 'noopener' }, 'Karnak'),
    ),
  ),
);

const views = new Map<string, View>();

async function show(): Promise<void> {
  const hash = routes.some((route) => route.hash === location.hash) ? location.hash : null;
  // Other hashes are anchors inside the current view.
  if (!hash && location.hash && views.size) return;
  const route = routes.find((r) => r.hash === hash) ?? routes[0]!;
  links.forEach((link, i) => (routes[i] === route ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current')));
  let view = views.get(route.hash);
  if (!view) {
    view = await route.load();
    views.set(route.hash, view);
  }
  slot.replaceChildren(view.el);
  view.opened?.();
  window.scrollTo(0, 0);
  document.title = `${route.en} · Tolerance`;
}

window.addEventListener('hashchange', show);
show();

// Fetch the other three views once the first one is up, so switching is instant.
const idle = (window as { requestIdleCallback?: (run: () => void) => void }).requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500));
idle(() => {
  void import('./views/pushfold.ts');
  void import('./views/equity.ts');
  void import('./views/proof.ts');
});
