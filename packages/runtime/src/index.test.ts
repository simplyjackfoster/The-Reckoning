import { describe, expect, it } from 'vitest';
import { runProgram } from './index.js';

describe('runProgram', () => {
  it('halts deterministically at end of program and emits events', () => {
    const result = runProgram({ words: [1, 2] });

    expect(result.finalState.halted).toBe(true);
    expect(result.finalState.pc).toBe(2);
    expect(result.events[0]?.type).toBe('vm.reset');
    expect(result.events.some((event) => event.type === 'vm.halt')).toBe(true);
  });
});
