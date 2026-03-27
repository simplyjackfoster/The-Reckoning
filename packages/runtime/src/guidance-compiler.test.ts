import { describe, expect, it } from 'vitest';
import { Opcode } from '@dead-reckoning/vm-core';
import { compileGuidanceLines, type GuidanceLine } from './guidance-compiler.js';

function decodeOpcode(word: number): number {
  return (word >> 10) & 0b11111;
}

describe('compileGuidanceLines', () => {
  it('maps interpretive opcodes into executable vm words with symbolized memory', () => {
    const lines: GuidanceLine[] = [
      {
        sourceFile: 'Luminary099/TEST.agc',
        lineNumber: 1,
        opcodeIndex: 0,
        opcode: 'VLOAD',
        operand: 'RVEL',
        comment: null,
        isInterpretive: true,
        raw: ' VLOAD RVEL'
      },
      {
        sourceFile: 'Luminary099/TEST.agc',
        lineNumber: 2,
        opcodeIndex: 1,
        opcode: 'VXSC',
        operand: null,
        comment: null,
        isInterpretive: true,
        raw: ' VXSC'
      },
      {
        sourceFile: 'Luminary099/TEST.agc',
        lineNumber: 3,
        opcodeIndex: 2,
        opcode: 'STOVL',
        operand: 'OUTV',
        comment: null,
        isInterpretive: true,
        raw: ' STOVL OUTV'
      },
      {
        sourceFile: 'Luminary099/TEST.agc',
        lineNumber: 4,
        opcodeIndex: 3,
        opcode: 'EXIT',
        operand: null,
        comment: null,
        isInterpretive: true,
        raw: ' EXIT'
      }
    ];

    const compiled = compileGuidanceLines(lines);

    expect(compiled.compiledInstructions.length).toBe(3);
    expect(compiled.program.words.some((word: number) => decodeOpcode(word) === Opcode.LoadVec3)).toBe(true);
    expect(compiled.program.words.some((word: number) => decodeOpcode(word) === Opcode.Vxsc)).toBe(true);
    expect(compiled.program.words.some((word: number) => decodeOpcode(word) === Opcode.StoreVec3)).toBe(true);
    expect(decodeOpcode(compiled.program.words.at(-1) ?? -1)).toBe(Opcode.Halt);
    expect(compiled.symbolTable.RVEL).toBeGreaterThan(0);
    expect(compiled.symbolTable.OUTV).toBeGreaterThan(0);
    expect(compiled.initialMemory.length).toBeGreaterThan(compiled.symbolTable.OUTV);
  });
});
