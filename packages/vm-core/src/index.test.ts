import { describe, expect, it } from 'vitest';
import { InMemoryEventSink } from '@dead-reckoning/event-stream';
import { AgcInterpretiveVm, createInitialVmState, normalizeWord15 } from './index.js';

describe('normalizeWord15', () => {
  it('wraps values into a deterministic AGC 15-bit word range', () => {
    expect(normalizeWord15(0)).toBe(0);
    expect(normalizeWord15(0o100000)).toBe(0);
    expect(normalizeWord15(-1)).toBe(0o77777);
    expect(normalizeWord15(0o177777)).toBe(0o77777);
  });
});

describe('createInitialVmState', () => {
  it('returns the phase-1 bootstrap VM state', () => {
    expect(createInitialVmState()).toEqual({
      tick: 0,
      pc: 0,
      stack: [],
      registers: { a: 0, l: 0, q: 0, z: 0 },
      halted: false
    });
  });
});

describe('AgcInterpretiveVm', () => {
  it('resets to invariant baseline state', () => {
    const sink = new InMemoryEventSink();
    const vm = new AgcInterpretiveVm({ words: [42] }, sink);

    vm.step();
    vm.reset();

    expect(vm.snapshot()).toEqual(createInitialVmState());
    expect(sink.all()[0]?.type).toBe('vm.step.start');
    expect(sink.all().at(-1)?.type).toBe('vm.reset');
  });

  it('keeps pc fixed and halts when program words are exhausted', () => {
    const sink = new InMemoryEventSink();
    const vm = new AgcInterpretiveVm({ words: [42] }, sink);

    vm.reset();
    vm.step();
    vm.step();

    expect(vm.snapshot().halted).toBe(true);
    expect(vm.snapshot().pc).toBe(1);
    expect(sink.all().at(-1)?.type).toBe('vm.step.end');
  });

  it('normalizes fetched words before emitting step-start payloads', () => {
    const sink = new InMemoryEventSink();
    const vm = new AgcInterpretiveVm({ words: [-1] }, sink);

    vm.reset();
    vm.step();

    expect(sink.all().find((event) => event.type === 'vm.step.start')?.payload.word).toBe(0o77777);
  });
});
