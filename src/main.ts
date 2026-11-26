// Tolerance: the page shell. Four tools, one per route.

import { gloss, h } from './ui/dom.ts';

interface View {
  el: HTMLElement;
  /** Called each time the view is shown. */
  opened?(): void;
}

const routes: { hash: string; en: string; zh: string; load: () => Promise<View> }[] = [
  { hash: '#river', en: 'River', zh: '河牌', load: async () => new (await import('./views/river.ts')).RiverView() },
  { hash: '#push-or-fold', en: 'Push or fold', zh: '全下或弃牌', load: async () => new (await import('./views/pushfold.ts')).PushFoldView() },
  { hash: '#equity', en: 'Equity', zh: '胜率', load: async () => new (await import('./views/equity.ts')).EquityView() },
  { hash: '#proof', en: 'Proof', zh: '验证', load: async () => new (await import('./views/proof.ts')).ProofView() },
];

const app = document.getElementById('app')!;
const slot = h('div');
const links = routes.map((route) => h('a', { href: route.hash }, gloss(route.en, route.zh)));

app.append(
  h(
    'header.top',
    h('a.mark', { href: '#river', 'aria-label': 'Tolerance, home' }, gloss('Tolerance', '公差')),
    h('nav.nav', { 'aria-label': 'Tools' }, links),
    h('a.by', { href: 'https://karnak.design', target: '_blank', rel: 'noopener' }, 'Karnak'),
  ),
  slot,
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
