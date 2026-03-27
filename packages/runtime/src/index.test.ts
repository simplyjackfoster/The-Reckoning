import { describe, expect, it } from 'vitest';
import { runProgram } from './index.js';

function encodeInstruction(opcode: number, immediate = 0): number {
  const encodedImmediate = immediate < 0 ? (immediate + 0x1000) & 0xfff : immediate & 0xfff;
  return ((opcode & 0b111) << 12) | encodedImmediate;
}

describe('runProgram', () => {
  it('runs an opcode program and emits mutation events for integration consumers', () => {
    const result = runProgram({
      words: [
        encodeInstruction(1, 4),
        encodeInstruction(1, 5),
        encodeInstruction(3),
        encodeInstruction(2),
        encodeInstruction(6)
      ]
    });

    expect(result.finalState.halted).toBe(true);
    expect(result.finalState.haltReason).toBe('halt-instruction');
    expect(result.finalState.registers.a).toBe(9);
    expect(result.events.some((event) => event.type === 'vm.stack.push')).toBe(true);
    expect(result.events.some((event) => event.type === 'vm.register.write')).toBe(true);
    expect(result.events.at(-1)?.type).toBe('vm.step.end');
  });
});
