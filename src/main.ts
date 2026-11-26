// Tolerance: the page shell. A front page and four tools, one per route.

import { gloss, h } from './ui/dom.ts';
import { HomeView } from './views/home.ts';

interface View {
  el: HTMLElement;
  /** Called each time the view is shown. */
  opened?(): void;
}

const routes: { hash: string; en: string; zh: string; load: () => Promise<View> }[] = [
  // The front page is the first screen, so it ships with the page itself.
  { hash: '', en: '', zh: '', load: async () => new HomeView() },
  { hash: '#river', en: 'Solver', zh: '求解器', load: async () => new (await import('./views/river.ts')).RiverView() },
  { hash: '#push-or-fold', en: 'Push or fold', zh: '全下或弃牌', load: async () => new (await import('./views/pushfold.ts')).PushFoldView() },
  { hash: '#equity', en: 'Equity', zh: '胜率', load: async () => new (await import('./views/equity.ts')).EquityView() },
  { hash: '#proof', en: 'Proof', zh: '验证', load: async () => new (await import('./views/proof.ts')).ProofView() },
];

const app = document.getElementById('app')!;
const slot = h('div.slot');
const links = routes.map((route) => (route.hash ? h('a', { href: route.hash }, gloss(route.en, route.zh)) : null));

app.append(
  h(
    'header.top',
    h('a.mark', { href: '#', 'aria-label': 'Tolerance, front page' }, gloss('Tolerance', '公差')),
    h('nav.nav', { 'aria-label': 'Tools' }, links),
    h('a.by', { href: 'https://karnak.design', target: '_blank', rel: 'noopener' }, 'Karnak'),
  ),
  slot,
  h(
    'footer.foot',
    h(
      'p',
      'Tolerance solves heads-up poker in three places: any river, a turn with every river after it, and all-in-or-fold play before the flop. Every answer is stated with what a perfect opponent could still win from it.',
      h('span.zh', { lang: 'zh-Hans' }, '公差只解单挑的三处：任意河牌、转牌连同其后的每张河牌，以及翻前的全下或弃牌。每个答案都附带完美对手还能多赢多少。'),
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

let current: (typeof routes)[number] | undefined;

async function show(): Promise<void> {
  // Any other hash is an anchor inside the solver.
  const hash = location.hash === '#' ? '' : location.hash;
  const anchor = hash && !routes.some((r) => r.hash === hash) ? hash : '';
  const route = routes.find((r) => r.hash === hash) ?? routes[1]!;
  if (route !== current) {
    current = route;
    links.forEach((link, i) => (routes[i] === route ? link?.setAttribute('aria-current', 'page') : link?.removeAttribute('aria-current')));
    let view = views.get(route.hash);
    if (!view) {
      view = await route.load();
      views.set(route.hash, view);
    }
    if (current !== route) return; // another navigation won the race
    slot.replaceChildren(view.el);
    view.opened?.();
    document.title = route.en ? `${route.en} · Tolerance` : 'Tolerance. A heads-up poker solver that states its error';
    document.documentElement.dataset.view = route.hash.slice(1) || 'home';
    if (!anchor) window.scrollTo(0, 0);
  } else if (!anchor) {
    window.scrollTo(0, 0);
  }
  if (anchor) document.getElementById(anchor.slice(1))?.scrollIntoView();
}

window.addEventListener('hashchange', show);
show();

// Fetch the other views once the first one is up, so switching is instant.
const idle = (window as { requestIdleCallback?: (run: () => void) => void }).requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1500));
idle(() => {
  void import('./views/river.ts');
  void import('./views/pushfold.ts');
  void import('./views/equity.ts');
  void import('./views/proof.ts');
});
