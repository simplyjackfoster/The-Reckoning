import { describe, expect, it } from 'vitest';
import { encodeInstruction, Opcode, onesComplementToSigned } from '@dead-reckoning/vm-core';
import {
  readReplay,
  runGuidanceSlice,
  runProgram,
  runProgramWithReplay,
  summarizeRuntime,
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
    expect(result.stats.opcodeCount).toBeGreaterThan(0);
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
  it('compiles guidance lines and runs them end to end with vector/scalar memory effects', () => {
    const lines: GuidanceLine[] = [
      {
        sourceFile: 'Luminary099/THE_LUNAR_LANDING.agc',
        lineNumber: 1,
        opcodeIndex: 0,
        opcode: 'VLOAD',
        operand: 'RVEL',
        comment: null,
        isInterpretive: true,
        raw: ' VLOAD RVEL'
      },
      {
        sourceFile: 'Luminary099/THE_LUNAR_LANDING.agc',
        lineNumber: 2,
        opcodeIndex: 1,
        opcode: 'VLOAD',
        operand: 'RPOS',
        comment: null,
        isInterpretive: true,
        raw: ' VLOAD RPOS'
      },
      {
        sourceFile: 'Luminary099/THE_LUNAR_LANDING.agc',
        lineNumber: 3,
        opcodeIndex: 2,
        opcode: 'VAD',
        operand: null,
        comment: null,
        isInterpretive: true,
        raw: ' VAD'
      },
      {
        sourceFile: 'Luminary099/THE_LUNAR_LANDING.agc',
        lineNumber: 4,
        opcodeIndex: 3,
        opcode: 'STOVL',
        operand: 'RWORK',
        comment: null,
        isInterpretive: true,
        raw: ' STOVL RWORK'
      },
      {
        sourceFile: 'Luminary099/THE_LUNAR_LANDING.agc',
        lineNumber: 5,
        opcodeIndex: 4,
        opcode: 'DLOAD',
        operand: 'TAU',
        comment: null,
        isInterpretive: true,
        raw: ' DLOAD TAU'
      },
      {
        sourceFile: 'Luminary099/THE_LUNAR_LANDING.agc',
        lineNumber: 6,
        opcodeIndex: 5,
        opcode: 'ABS',
        operand: null,
        comment: null,
        isInterpretive: true,
        raw: ' ABS'
      },
      {
        sourceFile: 'Luminary099/THE_LUNAR_LANDING.agc',
        lineNumber: 7,
        opcodeIndex: 6,
        opcode: 'STODL',
        operand: 'TAU_ABS',
        comment: null,
        isInterpretive: true,
        raw: ' STODL TAU_ABS'
      }
    ];

    const result = runGuidanceSlice(lines);

    expect(result.compiled.program.words.length).toBeGreaterThan(0);
    expect(result.finalState.halted).toBe(true);
    expect(result.events.some((event) => event.type === 'vm.memory.write')).toBe(true);

    const workAddress = result.compiled.symbolTable.RWORK;
    expect(workAddress).toBeGreaterThan(0);
    expect(result.finalState.memory.slice(workAddress, workAddress + 3).some((value: number) => onesComplementToSigned(value) !== 0)).toBe(true);

    const tauAbsAddress = result.compiled.symbolTable.TAU_ABS;
    expect(onesComplementToSigned(result.finalState.memory[tauAbsAddress] ?? 0)).toBeGreaterThanOrEqual(0);
  });

  it('supports label + control-flow guidance opcodes end-to-end', () => {
    const lines: GuidanceLine[] = [
      mkLine(0, 'DLOAD', 'FLAG'),
      mkLine(1, 'BON', 'TAKE_BRANCH'),
      mkLine(2, 'DLOAD', 'FALLBACK'),
      mkLine(3, 'GOTO', 'END'),
      mkLine(4, 'LABEL', 'TAKE_BRANCH'),
      mkLine(5, 'CALL', 'SUBR'),
      mkLine(6, 'LABEL', 'END'),
      mkLine(7, 'STODL', 'OUT'),
      mkLine(8, 'LABEL', 'SUBR'),
      mkLine(9, 'DLOAD', 'RETVAL'),
      mkLine(10, 'RTB', null)
    ];

    const result = runGuidanceSlice(lines, 500);
    expect(result.finalState.halted).toBe(true);
    expect(result.stats.callCount).toBe(1);
    expect(result.stats.returnCount).toBe(1);
    expect(result.stats.jumpCount).toBeGreaterThanOrEqual(1);

    const outAddr = result.compiled.symbolTable.OUT;
    expect(onesComplementToSigned(result.finalState.memory[outAddr] ?? 0)).not.toBe(0);
  });
});

describe('summarizeRuntime', () => {
  it('captures branch/call/memory metrics from events', () => {
    const result = runProgram({
      words: [
        encodeInstruction(Opcode.PushImmediate, 1),
        encodeInstruction(Opcode.Call, 4),
        encodeInstruction(Opcode.JumpIfNonZero, 2),
        encodeInstruction(Opcode.Halt),
        encodeInstruction(Opcode.Halt),
        encodeInstruction(Opcode.PushImmediate, 1),
        encodeInstruction(Opcode.Return)
      ]
    });

    const stats = summarizeRuntime(result.events);
    expect(stats.callCount).toBe(1);
    expect(stats.returnCount).toBe(1);
    expect(stats.jumpCount).toBeGreaterThanOrEqual(1);
    expect(stats.maxStackDepth).toBeGreaterThanOrEqual(1);
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
