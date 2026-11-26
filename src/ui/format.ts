// Number formatting. One figure style throughout: lining, tabular, no padding.

/** A share shown as a percentage with three significant figures: 22.5%, 4.99%, 0.0101%. */
export function percent(share: number, digits = 3): string {
  if (!Number.isFinite(share)) return '–';
  const value = share * 100;
  if (value === 0) return '0%';
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.max(0, Math.min(6, digits - 1 - magnitude));
  return `${value.toFixed(decimals)}%`;
}

/** A frequency as a whole or one-decimal percentage. */
export function frequency(share: number, decimals = 1): string {
  if (!Number.isFinite(share)) return '–';
  return `${(share * 100).toFixed(decimals)}%`;
}

export const integer = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Chips or big blinds: whole numbers with separators, small ones with a decimal. */
export function amount(n: number): string {
  if (!Number.isFinite(n)) return '–';
  if (Math.abs(n) >= 1000) return integer(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 10 ? 2 : 1).replace(/\.?0+$/, '');
}

export function seconds(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}
