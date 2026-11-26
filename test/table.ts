import { readFileSync } from 'node:fs';
import { readPreflopTable, type PreflopTable } from '../src/engine/pushfold.ts';

let cached: PreflopTable | undefined;

export function preflopTable(): PreflopTable {
  cached ??= readPreflopTable(readFileSync(new URL('../src/engine/data/preflop-equity.bin', import.meta.url)));
  return cached;
}
