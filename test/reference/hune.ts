// The published heads-up push-or-fold equilibrium chart, no ante.
//
// Source: HoldemResources.net, "HeadsUp Push/Fold Nash Equilibrium",
// https://www.holdemresources.net/hune (read 26 November 2026).
//
// Each number is the largest effective stack, in big blinds, at which the hand
// is pushed by the small blind (PUSHER) or called by the big blind (CALLER).
// "20+" means the hand is played at every stack up to 20 big blinds. Rows and
// columns run from the ace down to the deuce; suited hands are above the
// diagonal, offsuit hands below it. The page notes that the chart is
// simplified: most hands are mixed at some stack sizes, and three suited hands
// are pushed over two separate spans, listed in PUSHER_SPANS.

export const PUSHER = `
20+  20+  20+  20+  20+  20+  20+  20+  20+  20+  20+  20+  20+
20+  20+  20+  20+  20+  20+  20+  20+  20+  20+  20+  19.9 19.3
20+  20+  20+  20+  20+  20+  20+  20+  20+  20+  16.3 13.5 12.7
20+  20+  20+  20+  20+  20+  20+  20+  18.6 14.7 13.5 10.6 8.5
20+  20+  20+  20+  20+  20+  20+  20+  20+  11.9 10.5 7.7  6.5
20+  20+  20+  20+  20+  20+  20+  20+  20+  14.4 6.9  4.9  3.7
20+  18.0 13.0 13.3 17.5 20+  20+  20+  20+  18.8 10.1 2.7  2.5
20+  16.1 10.3 8.5  9.0  10.8 14.7 20+  20+  20+  13.9 2.5  2.1
20+  15.1 9.6  6.5  5.7  5.2  7.0  10.7 20+  20+  16.3 *    2.0
20+  14.2 8.9  6.0  4.1  3.5  3.0  2.6  2.4  20+  20+  *    2.0
20+  13.1 7.9  5.4  3.8  2.7  2.3  2.1  2.0  2.1  20+  *    1.8
20+  12.2 7.5  5.0  3.4  2.5  1.9  1.8  1.7  1.8  1.6  20+  1.7
20+  11.6 7.0  4.6  2.9  2.2  1.8  1.6  1.5  1.5  1.4  1.4  20+
`;

export const CALLER = `
20+  20+  20+  20+  20+  20+  20+  20+  20+  20+  20+  20+  20+
20+  20+  20+  20+  20+  20+  17.6 15.2 14.3 13.2 12.1 11.4 10.7
20+  20+  20+  20+  20+  16.1 13.0 10.5 9.9  8.9  8.4  7.8  7.2
20+  20+  19.5 20+  18.0 13.4 10.6 8.8  7.0  6.9  6.1  5.8  5.6
20+  20+  15.3 12.7 20+  11.5 9.3  7.4  6.3  5.2  5.2  4.8  4.5
20+  17.1 11.7 9.5  8.4  20+  8.2  7.0  5.8  5.0  4.3  4.1  3.9
20+  13.8 9.7  7.6  6.6  6.0  20+  6.5  5.6  4.8  4.1  3.6  3.5
20+  12.4 8.0  6.4  5.5  5.0  4.7  20+  5.4  4.8  4.1  3.6  3.3
20+  11.0 7.3  5.4  4.6  4.2  4.1  4.0  20+  4.9  4.3  3.8  3.3
20+  10.2 6.8  5.1  4.0  3.7  3.6  3.6  3.7  20+  4.6  4.0  3.6
18.3 9.1  6.2  4.7  3.8  3.3  3.2  3.2  3.3  3.5  20+  3.8  3.4
16.6 8.7  5.9  4.5  3.6  3.1  2.9  2.9  2.9  3.1  3.0  20+  3.3
15.8 8.1  5.6  4.2  3.5  3.0  2.8  2.6  2.7  2.8  2.7  2.6  15.0
`;

/** Hands the chart marks with an asterisk: pushed between `from` and `to`, and again at `low` and below. */
export const PUSHER_SPANS: Record<string, { to: number; from: number; low: number }> = {
  '63s': { to: 7.1, from: 5.1, low: 2.3 },
  '53s': { to: 12.9, from: 3.8, low: 2.4 },
  '43s': { to: 10.0, from: 4.9, low: 2.2 },
};

/** Reads a chart into 169 entries in grid order: a number, Infinity for "20+", or NaN for "*". */
export function readChart(text: string): Float64Array {
  const cells = text.trim().split(/\s+/);
  if (cells.length !== 169) throw new Error('A chart has 169 cells');
  return Float64Array.from(cells, (cell) => (cell === '20+' ? Infinity : cell === '*' ? NaN : Number(cell)));
}
