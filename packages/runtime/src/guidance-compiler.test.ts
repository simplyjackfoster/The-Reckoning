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

  it('compiles label-based branching and call/return control flow', () => {
    const lines: GuidanceLine[] = [
      mkLine(0, 'DLOAD', 'FLAG'),
      mkLine(1, 'BON', 'TARGET'),
      mkLine(2, 'DLOAD', 'FALLBACK'),
      mkLine(3, 'GOTO', 'END'),
      mkLine(4, 'LABEL', 'TARGET'),
      mkLine(5, 'CALL', 'SUBR'),
      mkLine(6, 'LABEL', 'END'),
      mkLine(7, 'STODL', 'OUT'),
      mkLine(8, 'LABEL', 'SUBR'),
      mkLine(9, 'DLOAD', 'RETVAL'),
      mkLine(10, 'RTB', null)
    ];

    const compiled = compileGuidanceLines(lines);
    const opcodes = compiled.program.words.map(decodeOpcode);

    expect(opcodes).toContain(Opcode.JumpIfNonZero);
    expect(opcodes).toContain(Opcode.Jump);
    expect(opcodes).toContain(Opcode.Call);
    expect(opcodes).toContain(Opcode.Return);
  });

  it('supports inline PC targets for compact synthetic slices', () => {
    const lines: GuidanceLine[] = [
      mkLine(0, 'DLOAD', 'FLAG'),
      mkLine(1, 'GOTO', 'PC_4'),
      mkLine(2, 'DLOAD', 'A'),
      mkLine(3, 'DLOAD', 'B'),
      mkLine(4, 'STODL', 'OUT')
    ];

    const compiled = compileGuidanceLines(lines);
    expect(compiled.program.words.length).toBeGreaterThan(0);
  });
});

function mkLine(opcodeIndex: number, opcode: string, operand: string | null): GuidanceLine {
  return {
    sourceFile: 'Luminary099/CONTROL_TEST.agc',
    lineNumber: opcodeIndex + 1,
    opcodeIndex,
    opcode,
    operand,
    comment: null,
    isInterpretive: true,
    raw: `${opcode}${operand ? ` ${operand}` : ''}`
  };
}
