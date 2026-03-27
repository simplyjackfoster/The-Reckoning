import { describe, expect, it } from 'vitest';
import { InMemoryEventSink } from '@dead-reckoning/event-stream';
import { AgcInterpretiveVm } from './index.js';

describe('AgcInterpretiveVm', () => {
  it('increments pc and halts when out of program words', () => {
    const sink = new InMemoryEventSink();
    const vm = new AgcInterpretiveVm({ words: [42] }, sink);

    vm.reset();
    vm.step();
    vm.step();

    expect(vm.snapshot().halted).toBe(true);
    expect(vm.snapshot().pc).toBe(1);
    expect(sink.all().at(-1)?.type).toBe('vm.step.end');
  });
});
