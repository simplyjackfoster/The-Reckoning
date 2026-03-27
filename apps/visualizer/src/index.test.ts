import { describe, expect, it } from 'vitest';
import { renderFrame } from './index.js';

describe('renderFrame', () => {
  it('summarizes execution state, stack, and registers from vm events', () => {
    const frame = renderFrame([
      { seq: 0, tick: 0, type: 'vm.reset', payload: { pc: 0 } },
      { seq: 1, tick: 0, type: 'vm.stack.push', payload: { value: 4, depthAfter: 1 } },
      { seq: 2, tick: 0, type: 'vm.stack.push', payload: { value: 9, depthAfter: 2 } },
      { seq: 3, tick: 0, type: 'vm.stack.pop', payload: { value: 9, depthAfter: 1 } },
      { seq: 4, tick: 0, type: 'vm.register.write', payload: { register: 'a', previous: 0, value: 9 } },
      { seq: 5, tick: 1, type: 'vm.step.end', payload: { pc: 4, tick: 1, halted: false } },
      { seq: 6, tick: 1, type: 'vm.halt', payload: { reason: 'halt-instruction' } }
    ]);

    expect(frame).toEqual({
      tick: 1,
      pc: 4,
      halted: true,
      haltReason: 'halt-instruction',
      stackDepth: 1,
      topOfStack: 4,
      registers: { a: 9, l: 0, q: 0, z: 0 }
    });
  });
});
