import { describe, expect, it } from 'vitest';
import type { VmEvent } from '@dead-reckoning/event-stream';
import { buildFrameTimeline, PlaybackController, renderFrame } from './index.js';

describe('renderFrame', () => {
  it('summarizes execution state, stack, registers, and decoded opcode from vm events', () => {
    const events: readonly VmEvent[] = [
      { seq: 0, tick: 0, type: 'vm.reset', payload: { pc: 0 } },
      { seq: 1, tick: 0, type: 'vm.opcode.decoded', payload: { pc: 0, opcode: 1, immediate: 4 } },
      { seq: 2, tick: 0, type: 'vm.stack.push', payload: { value: 4, depthAfter: 1 } },
      { seq: 3, tick: 0, type: 'vm.opcode.decoded', payload: { pc: 1, opcode: 2, immediate: 0 } },
      { seq: 4, tick: 0, type: 'vm.register.write', payload: { register: 'a', previous: 0, value: 4 } },
      { seq: 5, tick: 1, type: 'vm.step.end', payload: { pc: 2, tick: 1, halted: false } },
      { seq: 6, tick: 1, type: 'vm.halt', payload: { reason: 'halt-instruction' } },
      { seq: 7, tick: 2, type: 'vm.step.end', payload: { pc: 3, tick: 2, halted: true } }
    ];

    const frame = renderFrame(events);

    expect(frame).toEqual({
      tick: 2,
      pc: 3,
      halted: true,
      haltReason: 'halt-instruction',
      stackDepth: 1,
      topOfStack: 4,
      registers: { a: 4, l: 0, q: 0, z: 0 },
      lastOpcode: 2,
      lastImmediate: 0
    });
  });
});

describe('buildFrameTimeline + PlaybackController', () => {
  it('builds per-step frames and supports deterministic stepping/seek', () => {
    const events: readonly VmEvent[] = [
      { seq: 0, tick: 0, type: 'vm.reset', payload: { pc: 0 } },
      { seq: 1, tick: 0, type: 'vm.stack.push', payload: { value: 10, depthAfter: 1 } },
      { seq: 2, tick: 1, type: 'vm.step.end', payload: { pc: 1, tick: 1, halted: false } },
      { seq: 3, tick: 1, type: 'vm.stack.push', payload: { value: 20, depthAfter: 2 } },
      { seq: 4, tick: 2, type: 'vm.step.end', payload: { pc: 2, tick: 2, halted: false } }
    ];

    const frames = buildFrameTimeline(events);
    expect(frames.length).toBe(2);
    expect(frames[0]?.stackDepth).toBe(1);
    expect(frames[1]?.stackDepth).toBe(2);

    const controller = new PlaybackController(frames);
    expect(controller.currentFrame()).toEqual(frames[0]);

    controller.stepForward();
    expect(controller.snapshot().cursor).toBe(1);
    expect(controller.currentFrame()).toEqual(frames[1]);

    controller.seek(0);
    expect(controller.currentFrame()).toEqual(frames[0]);
    expect(controller.snapshot().mode).toBe('single-step');
  });
});
