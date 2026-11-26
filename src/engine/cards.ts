// Cards are integers 0..51: rank * 4 + suit.
// Rank 0 is the deuce, rank 12 the ace. Suits are c, d, h, s in that order.

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';
export const DECK_SIZE = 52;

export const rankOf = (card: number): number => card >> 2;
export const suitOf = (card: number): number => card & 3;
export const makeCard = (rank: number, suit: number): number => (rank << 2) | suit;

export function parseCard(text: string): number {
  const rank = RANK_CHARS.indexOf(text[0]!.toUpperCase());
  const suit = SUIT_CHARS.indexOf(text[1]!.toLowerCase());
  if (text.length !== 2 || rank < 0 || suit < 0) throw new Error(`Not a card: "${text}"`);
  return makeCard(rank, suit);
}

export function parseCards(text: string): number[] {
  const compact = text.replace(/[\s,]/g, '');
  if (compact.length % 2 !== 0) throw new Error(`Not a list of cards: "${text}"`);
  const cards: number[] = [];
  for (let i = 0; i < compact.length; i += 2) cards.push(parseCard(compact.slice(i, i + 2)));
  if (new Set(cards).size !== cards.length) throw new Error(`Repeated card in "${text}"`);
  return cards;
}

export const cardName = (card: number): string => RANK_CHARS[rankOf(card)]! + SUIT_CHARS[suitOf(card)]!;

// --- Two-card combos -------------------------------------------------------
// A combo is an unordered pair of cards, indexed 0..1325 with hi > lo.

export const COMBO_COUNT = 1326;

export const comboIndex = (a: number, b: number): number => {
  const hi = a > b ? a : b;
  const lo = a > b ? b : a;
  return ((hi * (hi - 1)) >> 1) + lo;
};

export const COMBO_HI = new Uint8Array(COMBO_COUNT);
export const COMBO_LO = new Uint8Array(COMBO_COUNT);
for (let hi = 1; hi < DECK_SIZE; hi++) {
  for (let lo = 0; lo < hi; lo++) {
    const i = comboIndex(hi, lo);
    COMBO_HI[i] = hi;
    COMBO_LO[i] = lo;
  }
}

// --- The 169 starting-hand classes -----------------------------------------
// Laid out as the usual 13 x 13 grid with aces first: row r, column c hold
// ranks (12 - r) and (12 - c). Pairs sit on the diagonal, suited hands above
// it, offsuit hands below.

export const CLASS_COUNT = 169;

export function classOf(a: number, b: number): number {
  const ra = rankOf(a);
  const rb = rankOf(b);
  const hi = ra > rb ? ra : rb;
  const lo = ra > rb ? rb : ra;
  if (hi === lo) return (12 - hi) * 13 + (12 - hi);
  return suitOf(a) === suitOf(b) ? (12 - hi) * 13 + (12 - lo) : (12 - lo) * 13 + (12 - hi);
}

export const COMBO_CLASS = new Uint8Array(COMBO_COUNT);
for (let i = 0; i < COMBO_COUNT; i++) COMBO_CLASS[i] = classOf(COMBO_HI[i]!, COMBO_LO[i]!);

export function className(cls: number): string {
  const row = Math.floor(cls / 13);
  const col = cls % 13;
  const a = RANK_CHARS[12 - Math.min(row, col)]!;
  const b = RANK_CHARS[12 - Math.max(row, col)]!;
  if (row === col) return a + b;
  return a + b + (col > row ? 's' : 'o');
}

export const CLASS_NAMES: string[] = Array.from({ length: CLASS_COUNT }, (_, i) => className(i));

export function classFromName(name: string): number {
  const i = CLASS_NAMES.indexOf(name);
  if (i < 0) throw new Error(`Not a starting hand: "${name}"`);
  return i;
}

/** Number of combos in a class: 6 for pairs, 4 suited, 12 offsuit. */
export function classSize(cls: number): number {
  const row = Math.floor(cls / 13);
  const col = cls % 13;
  return row === col ? 6 : col > row ? 4 : 12;
}
