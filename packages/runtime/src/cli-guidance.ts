import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { onesComplementToSigned } from '@dead-reckoning/vm-core';
import { runGuidanceSlice, type GuidanceLine } from './index.js';

function parseArg(flagLong: string, flagShort: string): string | null {
  const args = process.argv.slice(2);
  const index = args.findIndex((arg) => arg === flagLong || arg === flagShort);
  if (index < 0) {
    return null;
  }

  return args[index + 1] ?? null;
}

function main() {
  const inputArg = parseArg('--input', '-i') ?? 'artifacts/powered-descent-trace-seed.json';
  const limitArg = parseArg('--limit', '-n');
  const limit = Number.parseInt(limitArg ?? '250', 10);

  const lines = JSON.parse(readFileSync(resolve(inputArg), 'utf8')) as GuidanceLine[];
  const slicedLines = lines.slice(0, Number.isFinite(limit) ? limit : 250);
  const result = runGuidanceSlice(slicedLines, 20_000);

  console.log(`Guidance lines compiled: ${slicedLines.length}`);
  console.log(`Program words: ${result.compiled.program.words.length}`);
  console.log(`Final tick: ${result.finalState.tick}`);
  console.log(`Final pc: ${result.finalState.pc}`);
  console.log(`Final halted: ${result.finalState.halted} (${result.finalState.haltReason ?? 'none'})`);
  console.log(`Stack (signed): [${result.finalState.stack.map((word: number) => onesComplementToSigned(word)).join(', ')}]`);
  console.log(`Events emitted: ${result.events.length}`);

  const topSymbols = Object.entries(result.compiled.symbolTable)
    .slice(0, 8)
    .map(([name, address]) => `${name}@${address}=${onesComplementToSigned(result.finalState.memory[address] ?? 0)}`);

  console.log(`Symbol preview: ${topSymbols.join(' | ')}`);
}

main();
