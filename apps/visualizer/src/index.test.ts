import { describe, expect, it } from 'vitest';
import { renderFrame } from './index.js';

describe('renderFrame', () => {
  it('summarizes execution state from vm events', () => {
    const frame = renderFrame([
      { seq: 0, tick: 0, type: 'vm.reset', payload: { pc: 0 } },
      { seq: 1, tick: 1, type: 'vm.step.end', payload: { pc: 4, tick: 1, halted: false } },
      { seq: 2, tick: 1, type: 'vm.halt', payload: { reason: 'end-of-program' } }
    ]);

    expect(frame).toEqual({ tick: 1, pc: 4, halted: true });
  });
});
