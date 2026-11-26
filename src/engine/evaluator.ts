// Hand evaluator for 5 to 7 cards.
//
// A hand's strength is one integer: a higher number beats a lower one and
// equal numbers tie. The top bits hold the category, the low 20 bits order
// hands inside that category.
//
// The evaluator keeps four pieces of state while cards are added: one 13-bit
// rank mask per suit (packed into two numbers), and four rank masks telling
// which ranks have appeared at least once, twice, three and four times.

export const HIGH_CARD = 0;
export const PAIR = 1;
export const TWO_PAIR = 2;
export const TRIPS = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const QUADS = 7;
export const STRAIGHT_FLUSH = 8;

export const CATEGORY_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

export const categoryOf = (value: number): number => value >> 20;

const MASKS = 1 << 13;

/** Number of set bits in a 13-bit mask. */
const POPCOUNT = new Uint8Array(MASKS);
/** Index of the highest set bit, 0 for the empty mask. */
const TOP_RANK = new Uint8Array(MASKS);
/** The mask reduced to its highest two, three and five bits. */
const TOP2 = new Uint16Array(MASKS);
const TOP3 = new Uint16Array(MASKS);
const TOP5 = new Uint16Array(MASKS);
/** Rank of the top card of the best straight in the mask, plus one; 0 if none. */
const STRAIGHT_TOP = new Uint8Array(MASKS);

for (let m = 1; m < MASKS; m++) {
  POPCOUNT[m] = POPCOUNT[m >> 1]! + (m & 1);
  TOP_RANK[m] = 31 - Math.clz32(m);
  let kept = 0;
  let rest = m;
  for (let n = 1; n <= 5 && rest; n++) {
    const bit = 1 << (31 - Math.clz32(rest));
    kept |= bit;
    rest ^= bit;
    if (n === 2) TOP2[m] = kept;
    if (n === 3) TOP3[m] = kept;
  }
  if (POPCOUNT[m]! < 2) TOP2[m] = kept;
  if (POPCOUNT[m]! < 3) TOP3[m] = kept;
  TOP5[m] = kept;
  // Straights: five consecutive ranks, the ace also plays low.
  for (let top = 12; top >= 4; top--) {
    const run = 0b11111 << (top - 4);
    if ((m & run) === run) {
      STRAIGHT_TOP[m] = top + 1;
      break;
    }
  }
  const WHEEL = 0b1000000001111;
  if (!STRAIGHT_TOP[m] && (m & WHEEL) === WHEEL) STRAIGHT_TOP[m] = 3 + 1;
}

/**
 * Strength of the best five-card hand given the evaluator state.
 *
 * suitsLo holds the rank masks of suits 0 and 1 (13 bits each), suitsHi those
 * of suits 2 and 3. any/two/three/four are the rank masks of ranks seen at
 * least once, twice, three and four times.
 */
export function strengthFromState(
  suitsLo: number,
  suitsHi: number,
  any: number,
  two: number,
  three: number,
  four: number,
): number {
  // With at most seven cards a flush rules out quads and full houses, so it
  // can be settled first.
  let flush = -1;
  const s0 = suitsLo & 0x1fff;
  const s1 = suitsLo >> 13;
  const s2 = suitsHi & 0x1fff;
  const s3 = suitsHi >> 13;
  if (POPCOUNT[s0]! >= 5) flush = s0;
  else if (POPCOUNT[s1]! >= 5) flush = s1;
  else if (POPCOUNT[s2]! >= 5) flush = s2;
  else if (POPCOUNT[s3]! >= 5) flush = s3;
  if (flush >= 0) {
    const top = STRAIGHT_TOP[flush]!;
    if (top) return (STRAIGHT_FLUSH << 20) | top;
    return (FLUSH << 20) | TOP5[flush]!;
  }

  if (four) {
    const quad = TOP_RANK[four]!;
    return (QUADS << 20) | (quad << 4) | TOP_RANK[any & ~(1 << quad)]!;
  }

  if (three) {
    const trip = TOP_RANK[three]!;
    const others = two & ~(1 << trip);
    if (others) return (FULL_HOUSE << 20) | (trip << 4) | TOP_RANK[others]!;
    const top = STRAIGHT_TOP[any]!;
    if (top) return (STRAIGHT << 20) | top;
    return (TRIPS << 20) | (trip << 13) | TOP2[any & ~(1 << trip)]!;
  }

  const top = STRAIGHT_TOP[any]!;
  if (top) return (STRAIGHT << 20) | top;

  if (two) {
    const pairs = TOP2[two]!;
    if (pairs !== (pairs & -pairs)) {
      const hi = TOP_RANK[pairs]!;
      const lo = TOP_RANK[pairs & ~(1 << hi)]!;
      return (TWO_PAIR << 20) | (hi << 8) | (lo << 4) | TOP_RANK[any & ~pairs]!;
    }
    const pair = TOP_RANK[two]!;
    return (PAIR << 20) | (pair << 13) | TOP3[any & ~(1 << pair)]!;
  }

  return (HIGH_CARD << 20) | TOP5[any]!;
}

/** Strength of the best five-card hand among the first n cards of the array. */
export function evaluate(cards: ArrayLike<number>, n: number = cards.length): number {
  let suitsLo = 0;
  let suitsHi = 0;
  let any = 0;
  let two = 0;
  let three = 0;
  let four = 0;
  for (let i = 0; i < n; i++) {
    const card = cards[i]!;
    const bit = 1 << (card >> 2);
    const suit = card & 3;
    if (suit < 2) suitsLo |= bit << (suit * 13);
    else suitsHi |= bit << ((suit - 2) * 13);
    four |= three & bit;
    three |= two & bit;
    two |= any & bit;
    any |= bit;
  }
  return strengthFromState(suitsLo, suitsHi, any, two, three, four);
}

/**
 * A board with its evaluator state kept, so that many two-card hands can be
 * ranked against the same board without redoing the board's share of the work.
 */
export class BoardState {
  suitsLo = 0;
  suitsHi = 0;
  any = 0;
  two = 0;
  three = 0;
  four = 0;

  constructor(cards: ArrayLike<number> = []) {
    for (let i = 0; i < cards.length; i++) this.add(cards[i]!);
  }

  copyFrom(other: BoardState): void {
    this.suitsLo = other.suitsLo;
    this.suitsHi = other.suitsHi;
    this.any = other.any;
    this.two = other.two;
    this.three = other.three;
    this.four = other.four;
  }

  add(card: number): void {
    const bit = 1 << (card >> 2);
    const suit = card & 3;
    if (suit < 2) this.suitsLo |= bit << (suit * 13);
    else this.suitsHi |= bit << ((suit - 2) * 13);
    this.four |= this.three & bit;
    this.three |= this.two & bit;
    this.two |= this.any & bit;
    this.any |= bit;
  }

  /** Strength of the board plus two hole cards. */
  with2(a: number, b: number): number {
    let suitsLo = this.suitsLo;
    let suitsHi = this.suitsHi;
    let any = this.any;
    let two = this.two;
    let three = this.three;
    let four = this.four;

    let bit = 1 << (a >> 2);
    let suit = a & 3;
    if (suit < 2) suitsLo |= bit << (suit * 13);
    else suitsHi |= bit << ((suit - 2) * 13);
    four |= three & bit;
    three |= two & bit;
    two |= any & bit;
    any |= bit;

    bit = 1 << (b >> 2);
    suit = b & 3;
    if (suit < 2) suitsLo |= bit << (suit * 13);
    else suitsHi |= bit << ((suit - 2) * 13);
    four |= three & bit;
    three |= two & bit;
    two |= any & bit;
    any |= bit;

    return strengthFromState(suitsLo, suitsHi, any, two, three, four);
  }
}
