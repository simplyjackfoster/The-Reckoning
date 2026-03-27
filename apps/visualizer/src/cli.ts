import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { onesComplementToSigned } from '@dead-reckoning/vm-core';
import { runGuidanceSlice, type GuidanceLine } from '@dead-reckoning/runtime';
import { buildFrameTimeline, renderAsciiTimeline } from './index.js';

function parseArg(flagLong: string, flagShort: string): string | null {
  const args = process.argv.slice(2);
  const index = args.findIndex((arg) => arg === flagLong || arg === flagShort);
  if (index < 0) {
    return null;
  }

  return args[index + 1] ?? null;
}

function parseNumber(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function main() {
  const inputArg = parseArg('--input', '-i') ?? 'artifacts/powered-descent-trace-seed.json';
  const limit = parseNumber(parseArg('--limit', '-n'), 250);
  const maxSteps = parseNumber(parseArg('--max-steps', '-m'), 20_000);
  const timelineCount = parseNumber(parseArg('--timeline', '-t'), 12);
  const replayOut = parseArg('--replay-out', '-r');

  const lines = JSON.parse(readFileSync(resolve(inputArg), 'utf8')) as GuidanceLine[];
  const slicedLines = lines.slice(0, Math.max(1, limit));
  const result = runGuidanceSlice(slicedLines, maxSteps);
  const frames = buildFrameTimeline(result.events);

  if (replayOut) {
    const resolvedReplayOut = resolve(replayOut);
    writeFileSync(resolvedReplayOut, `${result.replay}\n`, 'utf8');
    console.log(`Replay written: ${resolvedReplayOut}`);
  }

  console.log(`Guidance lines compiled: ${slicedLines.length}`);
  console.log(`Program words: ${result.compiled.program.words.length}`);
  console.log(`Final tick: ${result.finalState.tick}`);
  console.log(`Final pc: ${result.finalState.pc}`);
  console.log(`Final halted: ${result.finalState.halted} (${result.finalState.haltReason ?? 'none'})`);
  console.log(`Stack (signed): [${result.finalState.stack.map((word: number) => onesComplementToSigned(word)).join(', ')}]`);
  console.log(`Events emitted: ${result.stats.eventCount}`);
  console.log(
    `Stats: opcodes=${result.stats.opcodeCount} jumps=${result.stats.jumpCount} calls=${result.stats.callCount} returns=${result.stats.returnCount} memoryWrites=${result.stats.memoryWriteCount} maxStack=${result.stats.maxStackDepth}`
  );

  const topSymbols = Object.entries(result.compiled.symbolTable)
    .slice(0, 8)
    .map(([name, address]) => `${name}@${address}=${onesComplementToSigned(result.finalState.memory[address] ?? 0)}`);

  console.log(`Symbol preview: ${topSymbols.join(' | ')}`);

  console.log('\nRecent timeline:');
  console.log(renderAsciiTimeline(frames, { maxFrames: timelineCount }));
}

main();
