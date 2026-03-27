import { describe, expect, it } from 'vitest';
import { deserializeReplayLog, serializeReplayLog, type VmEvent } from './index.js';

describe('replay serialization', () => {
  it('serializes and deserializes typed vm events', () => {
    const events: readonly VmEvent[] = [
      { seq: 0, tick: 0, type: 'vm.reset', payload: { pc: 0 } },
      { seq: 1, tick: 0, type: 'vm.step.start', payload: { pc: 0, word: 5120 } },
      {
        seq: 2,
        tick: 1,
        type: 'vm.snapshot',
        payload: {
          pc: 1,
          tick: 1,
          opcode: 1,
          immediate: 4,
          stackDepth: 1,
          stackTop: 4,
          registers: { a: 0, l: 0, q: 0, z: 0 },
          halted: false,
          haltReason: null
        }
      },
      { seq: 3, tick: 1, type: 'vm.halt', payload: { reason: 'halt-instruction' } }
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
