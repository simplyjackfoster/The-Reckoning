import { describe, expect, it } from 'vitest';
import { encodeInstruction, Opcode } from '@dead-reckoning/vm-core';
import {
  readReplay,
  runGuidanceSlice,
  runProgram,
  runProgramWithReplay,
  verifyDeterministicReplay,
  type GuidanceLine
} from './index.js';

describe('runProgram', () => {
  it('runs an opcode program and emits mutation events for integration consumers', () => {
    const result = runProgram({
      words: [
        encodeInstruction(Opcode.PushImmediate, 4),
        encodeInstruction(Opcode.PushImmediate, 5),
        encodeInstruction(Opcode.Add),
        encodeInstruction(Opcode.PopToA),
        encodeInstruction(Opcode.Halt)
      ]
    });

    expect(result.finalState.halted).toBe(true);
    expect(result.finalState.haltReason).toBe('halt-instruction');
    expect(result.finalState.registers.a).toBe(9);
    expect(result.events.some((event) => event.type === 'vm.stack.push')).toBe(true);
    expect(result.events.some((event) => event.type === 'vm.register.write')).toBe(true);
    expect(result.events.some((event) => event.type === 'vm.snapshot')).toBe(true);
    expect(result.events.at(-1)?.type).toBe('vm.step.end');
  });
});

describe('runProgramWithReplay', () => {
  it('serializes replay logs and round-trips event payloads', () => {
    const result = runProgramWithReplay({
      words: [encodeInstruction(Opcode.PushImmediate, 7), encodeInstruction(Opcode.PopToA), encodeInstruction(Opcode.Halt)]
    });

    const replay = readReplay(result.replay);

    expect(replay.schemaVersion).toBe(1);
    expect(replay.events).toEqual(result.events);
  });
});

describe('runGuidanceSlice', () => {
  it('compiles guidance lines and runs them end to end', () => {
    const lines: GuidanceLine[] = [
      {
        sourceFile: 'Luminary099/THE_LUNAR_LANDING.agc',
        lineNumber: 1,
        opcodeIndex: 0,
        opcode: 'DLOAD',
        operand: 'TAU',
        comment: null,
        isInterpretive: true,
        raw: ' DLOAD TAU'
      },
      {
        sourceFile: 'Luminary099/THE_LUNAR_LANDING.agc',
        lineNumber: 2,
        opcodeIndex: 1,
        opcode: 'DLOAD',
        operand: 'KAPPA',
        comment: null,
        isInterpretive: true,
        raw: ' DLOAD KAPPA'
      },
      {
        sourceFile: 'Luminary099/THE_LUNAR_LANDING.agc',
        lineNumber: 3,
        opcodeIndex: 2,
        opcode: 'DAD',
        operand: null,
        comment: null,
        isInterpretive: true,
        raw: ' DAD'
      },
      {
        sourceFile: 'Luminary099/THE_LUNAR_LANDING.agc',
        lineNumber: 4,
        opcodeIndex: 3,
        opcode: 'STORE',
        operand: 'GAMMA',
        comment: null,
        isInterpretive: true,
        raw: ' STORE GAMMA'
      }
    ];

    const result = runGuidanceSlice(lines);

    expect(result.compiled.program.words.length).toBeGreaterThan(0);
    expect(result.finalState.halted).toBe(true);
    expect(result.events.some((event) => event.type === 'vm.memory.write')).toBe(true);
  });
});

describe('verifyDeterministicReplay', () => {
  it('reports deterministic runs for the same program and step budget', () => {
    const verification = verifyDeterministicReplay({
      words: [
        encodeInstruction(Opcode.PushImmediate, 3),
        encodeInstruction(Opcode.PushImmediate, 2),
        encodeInstruction(Opcode.Add),
        encodeInstruction(Opcode.Halt)
      ]
    });

    expect(verification.deterministic).toBe(true);
    expect(verification.mismatch).toBeNull();
    expect(verification.firstRun.events).toEqual(verification.secondRun.events);
  });
});
