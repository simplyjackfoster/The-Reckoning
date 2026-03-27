import { describe, expect, it } from 'vitest';
import { deserializeReplayLog, serializeReplayLog, type VmEvent } from './index.js';

describe('replay serialization', () => {
  it('serializes and deserializes typed vm events', () => {
    const events: readonly VmEvent[] = [
      { seq: 0, tick: 0, type: 'vm.reset', payload: { pc: 0 } },
      { seq: 1, tick: 0, type: 'vm.step.start', payload: { pc: 0, word: 5120 } },
      { seq: 2, tick: 0, type: 'vm.halt', payload: { reason: 'halt-instruction' } }
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
