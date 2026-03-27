import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type InterpretiveLine = {
  sourceFile: string;
  lineNumber: number;
  opcodeIndex: number;
  opcode: string;
  operand: string | null;
  comment: string | null;
  isInterpretive: boolean;
  raw: string;
};

const FILES = [
  ['Luminary099/POWERED_DESCENT_INITIALIZAION.agc', 'Luminary099/POWERED_FLIGHT_SUBROUTINES.agc'],
  ['Luminary099/LUNAR_LANDING_GUIDANCE_EQUATIONS.agc'],
  ['Luminary099/BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc'],
  ['Luminary099/THE_LUNAR_LANDING.agc']
] as const;

const INTERP_OPCODES = new Set([
  'VLOAD', 'VXSC', 'VXV', 'DOT', 'UNIT', 'VAD', 'VSU',
  'DLOAD', 'DMP', 'DDV', 'DAD', 'DSU', 'ABS', 'SIGN',
  'SINE', 'COSINE', 'ARCSIN', 'ARCTAN',
  'MXV', 'VXM', 'TRANSPOSE',
  'STORE', 'STODL', 'STOVL', 'STCALL',
  'CALL', 'GOTO', 'RTB', 'EXIT', 'EXITS',
  'SETPD', 'BON', 'BOF', 'BOV', 'SL', 'SR', 'SQRT'
]);

function stripLabelToken(token: string | undefined): string {
  if (!token) return '';
  return token.replace(/[:,]$/, '');
}

function parseInstruction(content: string): { opcode: string | null; operand: string | null } {
  const tokens = content
    .trim()
    .split(/\s+/)
    .map((token) => stripLabelToken(token));

  if (tokens.length === 0) {
    return { opcode: null, operand: null };
  }

  if (INTERP_OPCODES.has(tokens[0])) {
    return {
      opcode: tokens[0],
      operand: tokens.slice(1).join(' ') || null
    };
  }

  if (tokens.length > 1 && INTERP_OPCODES.has(tokens[1])) {
    return {
      opcode: tokens[1],
      operand: tokens.slice(2).join(' ') || null
    };
  }

  return { opcode: null, operand: null };
}

function resolveFirstExistingPath(candidates: readonly string[]): string {
  for (const filePath of candidates) {
    const absolutePath = resolve(filePath);
    try {
      readFileSync(absolutePath, 'utf8');
      return filePath;
    } catch {
      // Continue searching.
    }
  }

  throw new Error(`None of the candidate files exist: ${candidates.join(', ')}`);
}

function extractFromFile(sourceFile: string): InterpretiveLine[] {
  const absolutePath = resolve(sourceFile);
  const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/);

  const extracted: InterpretiveLine[] = [];
  let inInterpretive = false;
  let opcodeIndex = 0;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;

    if (/\b(TC|TCF)\s+INTPRETX?\b/.test(rawLine)) {
      inInterpretive = true;
    }

    const [content, ...commentParts] = rawLine.split('#');
    const comment = commentParts.length > 0 ? commentParts.join('#').trim() || null : null;

    const { opcode, operand } = parseInstruction(content);
    if (!opcode || !inInterpretive) {
      return;
    }

    extracted.push({
      sourceFile,
      lineNumber,
      opcodeIndex,
      opcode,
      operand,
      comment,
      isInterpretive: true,
      raw: rawLine
    });
    opcodeIndex += 1;

    if (opcode === 'EXIT' || opcode === 'EXITS') {
      inInterpretive = false;
    }
  });

  return extracted;
}

export function extractGuidanceLines(): InterpretiveLine[] {
  const sourceFiles = FILES.map((candidates) => resolveFirstExistingPath(candidates));
  return sourceFiles.flatMap((sourceFile) => extractFromFile(sourceFile));
}

export function writeGuidanceLines(lines: readonly InterpretiveLine[], outputPath: string): string {
  const absoluteOutput = resolve(outputPath);
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  writeFileSync(absoluteOutput, `${JSON.stringify(lines, null, 2)}\n`, 'utf8');
  return absoluteOutput;
}

function parseOutputPathArg(args: string[]): string {
  const outputFlagIndex = args.findIndex((arg) => arg === '--output' || arg === '-o');
  if (outputFlagIndex < 0) {
    return 'artifacts/powered-descent-trace-seed.json';
  }

  const outputValue = args[outputFlagIndex + 1];
  if (!outputValue) {
    throw new Error('Missing value for --output / -o');
  }

  return outputValue;
}

function main() {
  const args = process.argv.slice(2);
  const outputPath = parseOutputPathArg(args);
  const lines = extractGuidanceLines();
  const writtenTo = writeGuidanceLines(lines, outputPath);

  console.log(`Extracted ${lines.length} interpretive lines.`);
  console.log(`Wrote ${writtenTo}`);
}

if (import.meta.main) {
  main();
}
