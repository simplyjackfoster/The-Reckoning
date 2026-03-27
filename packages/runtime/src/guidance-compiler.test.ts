import { describe, expect, it } from 'vitest';
import { Opcode } from '@dead-reckoning/vm-core';
import { compileGuidanceLines, type GuidanceLine } from './guidance-compiler.js';

function decodeOpcode(word: number): number {
  return (word >> 10) & 0b11111;
}

describe('compileGuidanceLines', () => {
  it('maps interpretive opcodes into executable vm words', () => {
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
        opcode: 'VAD',
        operand: null,
        comment: null,
        isInterpretive: true,
        raw: ' VAD'
      },
      {
        sourceFile: 'Luminary099/TEST.agc',
        lineNumber: 3,
        opcodeIndex: 2,
        opcode: 'EXIT',
        operand: null,
        comment: null,
        isInterpretive: true,
        raw: ' EXIT'
      }
    ];

    const compiled = compileGuidanceLines(lines);

    expect(compiled.compiledInstructions.length).toBe(2);
    expect(decodeOpcode(compiled.program.words[0])).toBe(Opcode.PushImmediate);
    expect(compiled.program.words.some((word) => decodeOpcode(word) === Opcode.Vadd3)).toBe(true);
    expect(decodeOpcode(compiled.program.words.at(-1) ?? -1)).toBe(Opcode.Halt);
  });
});
