import { describe, expect, it } from 'vitest';
import { deserializeReplayLog, serializeReplayLog, type VmEvent } from './index.js';

describe('replay serialization', () => {
  it('serializes and deserializes typed vm events', () => {
    const events: readonly VmEvent[] = [
      { seq: 0, tick: 0, type: 'vm.reset', payload: { pc: 0 } },
      { seq: 1, tick: 0, type: 'vm.step.start', payload: { pc: 0, word: 5120 } },
      { seq: 2, tick: 0, type: 'vm.call', payload: { fromPc: 0, toPc: 10, returnPc: 1, depthAfter: 1 } },
      {
        seq: 3,
        tick: 1,
        type: 'vm.snapshot',
        payload: {
          pc: 10,
          tick: 1,
          opcode: 24,
          immediate: 10,
          stackDepth: 1,
          stackTop: 4,
          callDepth: 1,
          registers: { a: 0, l: 0, q: 1, z: 0 },
          halted: false,
          haltReason: null
        }
      },
      { seq: 4, tick: 1, type: 'vm.return', payload: { fromPc: 12, toPc: 1, depthAfter: 0 } },
      { seq: 5, tick: 1, type: 'vm.halt', payload: { reason: 'halt-instruction' } }
    ];

    const serialized = serializeReplayLog(events);
    const replay = deserializeReplayLog(serialized);

    expect(replay.schemaVersion).toBe(1);
    expect(replay.events).toEqual(events);
  });

  it('throws on unsupported schema version', () => {
    expect(() => deserializeReplayLog(JSON.stringify({ schemaVersion: 2, events: [] }))).toThrow(
      'unsupported-replay-schema'
    );
  });
});
