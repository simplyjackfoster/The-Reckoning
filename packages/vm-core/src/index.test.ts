import { describe, expect, it } from 'vitest';
import { InMemoryEventSink } from '@dead-reckoning/event-stream';
import {
  AgcInterpretiveVm,
  Opcode,
  createInitialVmState,
  encodeInstruction,
  isNegativeZero,
  normalizeWord15,
  normalizeZero,
  onesComplementAdd,
  onesComplementToSigned,
  signedToOnesComplement
} from './index.js';

describe('normalizeWord15', () => {
  it('wraps values into a deterministic AGC 15-bit word range', () => {
    expect(normalizeWord15(0)).toBe(0);
    expect(normalizeWord15(0o100000)).toBe(0);
    expect(normalizeWord15(-1)).toBe(0o77777);
    expect(normalizeWord15(0o177777)).toBe(0o77777);
  });
});

describe('ones-complement helpers', () => {
  it('converts between signed and ones-complement values', () => {
    expect(signedToOnesComplement(37)).toBe(37);
    expect(onesComplementToSigned(signedToOnesComplement(37))).toBe(37);

    const negative = signedToOnesComplement(-37);
    expect(onesComplementToSigned(negative)).toBe(-37);
  });

  it('represents and normalizes negative zero explicitly', () => {
    expect(isNegativeZero(0o77777)).toBe(true);
    expect(onesComplementToSigned(0o77777)).toBe(0);
    expect(normalizeZero(0o77777)).toBe(0);
    expect(normalizeZero(0o77777, { preserveNegativeZero: true })).toBe(0o77777);
  });

  it('implements end-around carry addition', () => {
    const lhs = signedToOnesComplement(-1);
    const rhs = signedToOnesComplement(1);
    expect(onesComplementAdd(lhs, rhs)).toBe(0o77777);
  });
});

describe('createInitialVmState', () => {
  it('returns the phase-2 bootstrap VM state', () => {
    expect(createInitialVmState()).toEqual({
      tick: 0,
      pc: 0,
      stack: [],
      registers: { a: 0, l: 0, q: 0, z: 0 },
      memory: Array.from({ length: 256 }, () => 0),
      halted: false,
      haltReason: null
    });
  });
});

describe('AgcInterpretiveVm', () => {
  it('executes arithmetic, memory, and control flow opcodes', () => {
    const sink = new InMemoryEventSink();
    const vm = new AgcInterpretiveVm(
      {
        words: [
          encodeInstruction(Opcode.PushImmediate, 8),
          encodeInstruction(Opcode.PushImmediate, 2),
          encodeInstruction(Opcode.Add),
          encodeInstruction(Opcode.Store, 3),
          encodeInstruction(Opcode.Load, 3),
          encodeInstruction(Opcode.PushImmediate, 10),
          encodeInstruction(Opcode.Sub),
          encodeInstruction(Opcode.JumpIfZero, 2),
          encodeInstruction(Opcode.Halt),
          encodeInstruction(Opcode.PushImmediate, 99),
          encodeInstruction(Opcode.Halt)
        ]
      },
      sink
    );

    vm.reset();
    while (!vm.snapshot().halted) {
      vm.step();
    }

    expect(vm.snapshot().haltReason).toBe('halt-instruction');
    expect(vm.snapshot().memory[3]).toBe(10);
    expect(onesComplementToSigned(vm.snapshot().stack.at(-1) ?? 1)).toBe(99);

    const events = sink.all();
    expect(events.some((event) => event.type === 'vm.memory.write')).toBe(true);
    expect(events.some((event) => event.type === 'vm.jump')).toBe(true);
    expect(events.some((event) => event.type === 'vm.snapshot')).toBe(true);
  });

  it('executes vector add primitive via VADD3', () => {
    const sink = new InMemoryEventSink();
    const vm = new AgcInterpretiveVm(
      {
        words: [
          encodeInstruction(Opcode.PushImmediate, 1),
          encodeInstruction(Opcode.PushImmediate, 2),
          encodeInstruction(Opcode.PushImmediate, 3),
          encodeInstruction(Opcode.PushImmediate, 4),
          encodeInstruction(Opcode.PushImmediate, 5),
          encodeInstruction(Opcode.PushImmediate, 6),
          encodeInstruction(Opcode.Vadd3),
          encodeInstruction(Opcode.Halt)
        ]
      },
      sink
    );

    vm.reset();
    while (!vm.snapshot().halted) {
      vm.step();
    }

    expect(vm.snapshot().stack.map(onesComplementToSigned)).toEqual([5, 7, 9]);
  });

  it('decodes sign-extended immediates for literal pushes', () => {
    const sink = new InMemoryEventSink();
    const vm = new AgcInterpretiveVm(
      { words: [encodeInstruction(Opcode.PushImmediate, -3), encodeInstruction(Opcode.PopToA), encodeInstruction(Opcode.Halt)] },
      sink
    );

    vm.reset();
    while (!vm.snapshot().halted) {
      vm.step();
    }

    expect(onesComplementToSigned(vm.snapshot().registers.a)).toBe(-3);
  });
});
