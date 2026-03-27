import { describe, expect, it } from 'vitest';
import { InMemoryEventSink } from '@dead-reckoning/event-stream';
import {
  AgcInterpretiveVm,
  createInitialVmState,
  isNegativeZero,
  normalizeWord15,
  normalizeZero,
  onesComplementAdd,
  onesComplementToSigned,
  signedToOnesComplement
} from './index.js';

function encodeInstruction(opcode: number, immediate = 0): number {
  const encodedImmediate = immediate < 0 ? (immediate + 0x1000) & 0xfff : immediate & 0xfff;
  return ((opcode & 0b111) << 12) | encodedImmediate;
}

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
      halted: false,
      haltReason: null
    });
  });
});

describe('AgcInterpretiveVm', () => {
  it('executes stack and register opcodes and halts deterministically', () => {
    const sink = new InMemoryEventSink();
    const vm = new AgcInterpretiveVm(
      {
        words: [
          encodeInstruction(1, 8),
          encodeInstruction(1, 2),
          encodeInstruction(3),
          encodeInstruction(2),
          encodeInstruction(4, 13),
          encodeInstruction(5),
          encodeInstruction(6)
        ]
      },
      sink
    );

    vm.reset();
    while (!vm.snapshot().halted) {
      vm.step();
    }

    expect(vm.snapshot().registers.a).toBe(signedToOnesComplement(13));
    expect(vm.snapshot().registers.l).toBe(signedToOnesComplement(10));
    expect(vm.snapshot().stack).toEqual([]);
    expect(vm.snapshot().haltReason).toBe('halt-instruction');

    const events = sink.all();
    expect(events.some((event) => event.type === 'vm.stack.push')).toBe(true);
    expect(events.some((event) => event.type === 'vm.stack.pop')).toBe(true);
    expect(events.some((event) => event.type === 'vm.register.write')).toBe(true);
    expect(events.some((event) => event.type === 'vm.opcode.decoded')).toBe(true);
  });

  it('halts on stack underflow in add opcode', () => {
    const sink = new InMemoryEventSink();
    const vm = new AgcInterpretiveVm({ words: [encodeInstruction(3)] }, sink);

    vm.reset();
    vm.step();

    expect(vm.snapshot().halted).toBe(true);
    expect(vm.snapshot().haltReason).toBe('stack-underflow:add');
  });

  it('decodes sign-extended immediates for literal pushes', () => {
    const sink = new InMemoryEventSink();
    const vm = new AgcInterpretiveVm({ words: [encodeInstruction(1, -3), encodeInstruction(2)] }, sink);

    vm.reset();
    vm.step();
    vm.step();

    expect(onesComplementToSigned(vm.snapshot().registers.a)).toBe(-3);
  });
});
