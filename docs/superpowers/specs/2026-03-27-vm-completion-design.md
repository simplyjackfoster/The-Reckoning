# VM Completion Design — Dead Reckoning

**Date:** 2026-03-27
**Scope:** Complete the AGC interpretive VM to support a compelling terminal demo, using a hybrid checkpoint approach: VXV + UNIT first, then MPAC/VAC refactor, then trig + matrix, then real Apollo 11 initial conditions.

---

## Context

The project has a working interpreter core (`packages/vm-core`) with ~27 opcodes, a guidance compiler (`packages/runtime`), and a CLI runner (`apps/visualizer`). The backend event stream is deterministic and replay-verified. What's missing before the visual layer can be built:

- **VXV** (vector cross product) — the central computation in the cross-range guidance equation
- **UNIT** (normalize to unit length) — used constantly; produces the "snap to unit length" visual
- Correct **MPAC/VAC accumulator model** — current flat stack has wrong STODL/STOVL semantics
- **Trig opcodes** — SINE, COSINE, ARCSIN, ARCTAN2
- **Matrix opcodes** — MXV, VXM, TRANSPOSE (+ LoadMat3/StoreMat3)
- **Real Apollo 11 PDI initial conditions** — current data is seeded/synthetic

---

## Instruction Encoding Change (prerequisite for all checkpoints)

The current `encodeInstruction` uses a **5-bit opcode field** (mask `0b11111`, max value 31). The 12 new opcodes (27–38) require values up to 38, which exceeds the 5-bit ceiling — opcodes ≥ 32 silently collide with existing opcodes 0–5 when the mask is applied.

**Fix**: extend the opcode field to **6 bits** before any new opcodes are added.

New instruction word layout (15 bits total):
- Bits 14–9: 6-bit opcode (0–63)
- Bits 8–0: 9-bit signed immediate (range −256 to +255)

Changes required in `packages/vm-core/src/index.ts`:

```typescript
// encodeInstruction
const normalizedImmediate = immediate & 0x01ff;  // was 0x03ff
return normalizeWord15(((opcode & 0b111111) << 9) | normalizedImmediate);  // was 0b11111 << 10

// decodeInstruction
const opcode = ((word >> 9) & 0b111111) as Opcode;  // was >> 10 & 0b11111
const immediate9 = word & 0x01ff;                    // was 0x03ff

// signExtend9 (replaces signExtend10)
function signExtend9(value: number): number {
  const normalized = value & 0x01ff;
  return (normalized & 0x0100) === 0 ? normalized : normalized - 0x0200;
}
```

This is a breaking encoding change. All existing encoded programs (test fixtures, `artifacts/*.json`) must be re-encoded after this change. The `Opcode` enum values themselves (0–26 for existing opcodes) do not change — only the bit packing.

The 9-bit immediate supports addresses 0–255, which covers the default 256-word memory size. Programs that use relative jumps/calls larger than ±255 instructions will not fit; the existing guidance slices are well within this range.

**Sequencing requirement**: The encoding change (`encodeInstruction`, `decodeInstruction`, `signExtend9`) must be implemented and all existing tests passing before any new opcode enum values are added. Do not add `Opcode.Vxv = 27` or any higher value until the encoding PR is merged. Adding enum values ≥ 32 before the encoding change silently corrupts the dispatch table.

---

## Checkpoint 1 — VXV + UNIT

### `onesComplementMultiplyFractional` helper

New exported function in `packages/vm-core/src/index.ts`:

```typescript
export function onesComplementMultiplyFractional(a: Word15, b: Word15): Word15 {
  // Inputs are Word15 (ones-complement encoded integers).
  // Convert to signed, multiply, right-shift 14 to keep result in SP range.
  const signedA = onesComplementToSigned(a);
  const signedB = onesComplementToSigned(b);
  const product = Math.trunc((signedA * signedB) / 16384); // >> 14
  return signedToOnesComplement(product);
}
```

The right-shift of 14 (division by 2^14 = 16384) matches the AGC's SP × SP → SP convention. The inputs must be passed as `Word15` values; the function calls `onesComplementToSigned` internally. This function is used by VXV, UNIT (magnitude computation), MXV, VXM, and VXM's internal transpose-multiply.

The existing `onesComplementMultiply` (raw integer product, no shift) continues to be used by `Vxsc`, `Dot3`, and scalar `Mul` — these operate on bounded compiler-seeded values where overflow is not a concern.

### VXV (Opcode 27)

Pops two vec3s from stack, pushes their cross product.

```
result.x = lhs.y * rhs.z − lhs.z * rhs.y
result.y = lhs.z * rhs.x − lhs.x * rhs.z
result.z = lhs.x * rhs.y − lhs.y * rhs.x
```

Each multiply uses `onesComplementMultiplyFractional`. Stack effect: −6 words, +3 words (net −3). Halt on stack underflow: `stack-underflow:vxv`.

### UNIT (Opcode 28)

Pops one vec3, pushes its unit-normalized form.

1. Compute magnitude² = `dot(v, v)` using `onesComplementMultiplyFractional` for each component product
2. Convert magnitude² to signed float, take `Math.sqrt` → float magnitude
3. If float magnitude < `1e-6` (normalized), halt with `division-by-zero:unit` — this mirrors the AGC gimbal singularity guard. The threshold is in float terms after `onesComplementToSigned` conversion, not raw integer comparison.
4. For each component: `result[i] = signedToOnesComplement(Math.round(onesComplementToSigned(v[i]) / floatMagnitude))`

Stack effect: −3 words, +3 words (net 0).

### New event type: `vm.vector.op`

Emitted by VXV and UNIT in addition to the standard stack push/pop events. Uses a discriminated union:

```typescript
type VmVectorOpPayload =
  | {
      readonly opcode: 'vxv';
      readonly inputA: readonly [number, number, number];
      readonly inputB: readonly [number, number, number];
      readonly output: readonly [number, number, number];
    }
  | {
      readonly opcode: 'unit';
      readonly inputA: readonly [number, number, number];
      readonly output: readonly [number, number, number];
    };
```

All values are raw `Word15` integers (ones-complement encoded). The renderer converts to physical units.

### Checkpoint 1 acceptance

Test assertions (in `index.test.ts`):
- VXV of `[0x3FFF, 0, 0]` × `[0, 0x3FFF, 0]` produces `[0, 0, X]` where X is a positive nonzero value within the range `[0x1000, 0x3FFF]` (the fractional multiply reduces magnitude)
- VXV output components do not equal 0x7FFF (WORD15_MASK — overflow sentinel)
- UNIT of `[0x2000, 0x2000, 0]` produces a result whose float magnitude (via `onesComplementToSigned` + Pythagorean) is within 0.01 of 1.0
- UNIT pre-normalization magnitude and post-normalization magnitude printed by CLI

---

## Checkpoint 2 — MPAC/VAC Refactor

### Problem with current flat stack

`STODL` (store current value to memory, load new scalar) and `STOVL` (store, load new vector) require the AGC's push-down accumulator model. On the real AGC:

- **MPAC** is a fixed 7-word register holding the "current" interpreter result
- **VAC area** is a push-down stack of MPAC snapshots

`STODL` does: write MPAC to memory → push current MPAC onto VAC → load new scalar into MPAC.
`RTB`/`EXIT` restore from VAC.

The current flat stack collapses MPAC and VAC into one structure, which breaks STODL/STOVL round-trip semantics.

### New VmState model

`VmState` replaces `stack` with:

```typescript
interface VmState {
  // ...existing fields minus `stack`...
  readonly mpac: readonly Word15[];                  // always exactly 7 words
  readonly vac: readonly (readonly Word15[])[];      // push-down stack of 7-word MPAC snapshots
}
```

**MPAC word layout**:
- Scalar (SP/DP) operations use `mpac[0]` (SP) or `mpac[0..1]` (DP). `mpacDepth = 1`.
- Vec3 operations use `mpac[0..2]`. `mpacDepth = 3`.
- Matrix operations use `mpac[0..8]` — but since MPAC is only 7 words, matrices pass through the stack directly and are never held in MPAC alone. Matrix opcodes (MXV, VXM, TRANSPOSE) read their 9-word operands from the flat-stack remnant (see note below) and write a 3-word result into MPAC.
- `mpac[3..6]` are scratch words preserved across `pushVac`/`popVac` but not used by any opcode in this phase.

**Note on matrices and the stack**: After the MPAC/VAC refactor, matrix operands (9 words) are too large to fit in MPAC. LoadMat3/StoreMat3 use a separate temporary flat buffer (a `Word15[]` field on `AgcInterpretiveVm` called `matrixBuffer`) not exposed in `VmState`. MXV/VXM read their matrix operand from `matrixBuffer` and their vector operand from `mpac[0..2]`, then write the 3-word result back to `mpac[0..2]`. This keeps `VmState` clean while supporting the matrix opcodes.

### writeMpac semantics

`writeMpac(words: readonly Word15[])` overwrites only the words provided, zero-padding `mpac[words.length..6]`. So:
- `writeMpac([scalar])` sets `mpac[0] = scalar`, `mpac[1..6] = 0`
- `writeMpac([x, y, z])` sets `mpac[0..2] = [x,y,z]`, `mpac[3..6] = 0`

`pushVac()` snapshots the full 7-word MPAC. `popVac()` restores the full 7-word MPAC. This means STODL/STOVL correctly preserves and restores the complete previous accumulator state.

### New internal operations on `AgcInterpretiveVm`

- `writeMpac(words)` — overwrite MPAC (zero-padded to 7 words), emit `vm.mpac.write`
- `readMpac()` — return current MPAC contents
- `pushVac()` — snapshot current MPAC onto VAC, emit `vm.vac.push`
- `popVac()` — restore MPAC from top of VAC, emit `vm.vac.pop`; halt with `vac-underflow` if VAC is empty

`STODL` becomes: `Store(address)` → `pushVac()` → `writeMpac([Load(address2)])`.
`STOVL` becomes: `StoreMpacVec3(address)` → `pushVac()` → `writeMpac([LoadVec3(address2)])`.
`EXIT`/`RTB` call `popVac()` before returning.

### Event payloads for new event types

```typescript
readonly 'vm.mpac.write': {
  readonly words: readonly Word15[];  // full 7-word MPAC after write
  readonly mpacDepth: number;         // 1, 3, or 7 (how many words are meaningful)
};
readonly 'vm.vac.push': {
  readonly vacDepth: number;          // depth after push
  readonly snapshot: readonly Word15[]; // the 7-word MPAC that was saved
};
readonly 'vm.vac.pop': {
  readonly vacDepth: number;          // depth after pop
  readonly restored: readonly Word15[]; // the 7-word MPAC that was restored
};
```

### EXIT/EXITS in the guidance compiler

`EXIT` and `EXITS` mnemonics currently produce zero bytecode (silently skipped). After this refactor they must compile to `Opcode.PopVac = 38`. **Sequencing requirement**: `Opcode.PopVac` must be added to the enum and its handler implemented in `AgcInterpretiveVm` before this compiler case is added — the TypeScript reference to `Opcode.PopVac` will fail to compile otherwise. Add to `guidance-compiler.ts` only after the VM opcode is live:
```
case 'EXIT':
case 'EXITS':
  emitted.push(encodeInstruction(Opcode.PopVac));
```

### VmSnapshotPayload update

Replace `stackDepth`/`stackTop` with:
```typescript
readonly mpacDepth: number;   // 1, 3, or 7 — sourced from the most recent vm.mpac.write event's mpacDepth field; defaults to 1 if no vm.mpac.write has been emitted yet
readonly vacDepth: number;    // current VAC stack depth
```

`buildFrameTimeline` sources `Frame.vacDepth` from `vm.vac.push`/`vm.vac.pop` events (`event.payload.vacDepth`). The `Frame` interface replaces `stackDepth`/`topOfStack` with `vacDepth`. The `top=` column in `renderAsciiTimeline` is removed (no per-word display of MPAC contents in the ASCII render in this phase).

### Direct `this.state.stack` reads to migrate

The following private methods in `AgcInterpretiveVm` read `this.state.stack` directly (bypassing `popWord`/`pushWord`) and must be updated to read `this.state.mpac` during the MPAC/VAC refactor:
- `storeVec3` (line ~596): reads `stack.at(-3)`, `stack.at(-2)`, `stack.at(-1)` → reads `mpac[0]`, `mpac[1]`, `mpac[2]`
- `jumpOnZero` (line ~404): reads `stack.at(-1)` → reads `mpac[0]`
- `dupTop` (line ~485): reads `stack.at(-1)` → reads `mpac[0]`
- `storeTopToMemory` (line ~636): reads `stack.at(-1)` → reads `mpac[0]`

### Event stream schema migration

`VmReplayLog.schemaVersion` bumps to `2`. `serializeReplayLog` writes `schemaVersion: 2`. `deserializeReplayLog` accepts `1 | 2` and rejects anything else. `VmReplayLog` type: `schemaVersion: 1 | 2`.

Existing `vm.stack.push`/`vm.stack.pop` event types are retired from `VmEventType` and `VmEventPayloadMap`. After retirement, deserializing a v1 log containing these event types would produce events whose `type` field is not in the union — causing TypeScript type errors if assigned to `VmEvent`. To handle this: `deserializeReplayLog` for v1 logs returns `VmReplayLog` with events typed as `VmEventV1 | VmEvent` where `VmEventV1` is a minimal legacy type covering `vm.stack.push` and `vm.stack.pop`. Only the v1 regression test consumes this type; all production code uses `VmEvent` from v2 logs only.

`summarizeRuntime` in `packages/runtime/src/index.ts`: rename `maxStackDepth` → `maxVacDepth`, source from `vm.vac.push` events (`event.payload.vacDepth`). Update `RuntimeStats` type accordingly.

### Checkpoint 2 acceptance

- `STODL`/`STOVL` round-trips: after one STODL and one EXIT, `vm.vac.push` count equals `vm.vac.pop` count
- Correct values restored to MPAC after `popVac` (test with known scalar and vector round-trip)
- All tests pass with updated event schema
- A v1 replay log fixture deserializes successfully (regression test)

---

## Checkpoint 3 — Trig + Matrix Opcodes

### Trig (Opcodes 29–32)

| Opcode | Mnemonic | Stack effect | Notes |
|--------|----------|-------------|-------|
| 29 | SINE | pop 1 → push 1 | |
| 30 | COSINE | pop 1 → push 1 | |
| 31 | ARCSIN | pop 1 → push 1 | halt `domain-error:arcsin` if float \|x\| > 1.0 |
| 32 | ARCTAN2 | pop 2 → push 1 | four-quadrant arctangent |

**Angle scaling**: AGC convention — 1 full revolution = full scale. `angle_rad = onesComplementToSigned(word) / 0x3FFF * Math.PI`. Thus `0x3FFF` = π radians = one half-revolution. SINE/COSINE accept half-revolutions; ARCSIN/ARCTAN2 output half-revolutions.

**Implementation**: `onesComplementToSigned` → `Math.sin`/`Math.cos`/`Math.asin`/`Math.atan2` → `signedToOnesComplement`.

**ARCTAN2 argument order**: pops X first (top of MPAC / top of stack in pre-refactor terms), then Y. Calls `Math.atan2(y, x)`. Programs must push Y first, then X.

### Matrix (Opcodes 33–37, PopVac = 38)

| Opcode | Mnemonic | Stack effect |
|--------|----------|-------------|
| 33 | MXV | load matrix from `matrixBuffer`; pop vec3 from MPAC; push result vec3 to MPAC |
| 34 | VXM | load matrix from `matrixBuffer`; pop vec3 from MPAC; apply transposed multiply; push result |
| 35 | TRANSPOSE | transpose `matrixBuffer` in-place; no MPAC effect |
| 36 | LoadMat3 | (immediate: base address) read 9 words from memory into `matrixBuffer` |
| 37 | StoreMat3 | (immediate: base address) write `matrixBuffer` 9 words to memory |
| 38 | PopVac | call `popVac()` — restores MPAC from VAC |

**Matrix layout**: `matrixBuffer` is a `Word15[9]` field on `AgcInterpretiveVm`, column-major: `[m00, m10, m20, m01, m11, m21, m02, m12, m22]`.

**Precision note**: REFSMMAT is stored as 9 single-precision words here (vs. 18 double-precision on the real AGC). Acceptance tests must tolerate ~1% error vs. archival values.

**MXV computation**: all 9 multiply-accumulate operations use `onesComplementMultiplyFractional`.

**VXM**: computes `M^T * v` (rotate body-to-inertial using REFSMMAT). Internally transposes `matrixBuffer` into a local array, then applies MXV. Does **not** emit `vm.vac.push`/`vm.vac.pop` events during the internal transpose — the transpose is a pure in-memory local operation with no VAC interaction.

### Checkpoint 3 acceptance

- `SINE(0x0CCC)` ≈ `sin(0.2π)` = `sin(36°)` ≈ 0.588 → expected fixed-point word ≈ `0x12B0` ± 2
- `COSINE(0x0CCC)` ≈ `cos(36°)` ≈ 0.809 → expected word ≈ `0x19E3` ± 2
- `ARCTAN2(y=0x3FFF, x=0x3FFF)` → `Math.atan2(1,1)` = π/4 radians = 0.25 half-revolutions → expected word = `Math.round(0x3FFF * 0.25)` = `0x0FFF` ± 1
- MXV of `[0x3FFF, 0, 0]` through a 90° rotation matrix produces `[0, 0x3FFF, 0]` ± 2 per component
- Full guidance slice: zero `Opcode.Nop` fallbacks for recognized guidance mnemonics

---

## Checkpoint 4 — Real Apollo 11 Initial Conditions

### Artifact: `artifacts/apollo11-pdi-initial-conditions.json`

Replaces `artifacts/powered-descent-trace-seed.json` for the primary demo run. Contains:

```json
{
  "description": "Apollo 11 Powered Descent Initiation — July 20, 1969, ~102:33 GET",
  "source": "Lunar Surface Journal / archival telemetry reconstruction",
  "position_agc": [x, y, z],
  "velocity_agc": [vx, vy, vz],
  "refsmmat_agc": [9 words],
  "landing_site_agc": [lx, ly, lz],
  "t0_get_seconds": 6153
}
```

**Scaling note**: AGC position uses 2^28 cm ≈ 2684 km per unit. LM altitude at PDI is ~110 km, which is `~0.041` in these units — a small fraction of full scale. The archival values must be stored in the double-precision AGC convention (pairs of SP words) to avoid total loss of precision. The JSON stores each DP value as a 2-element sub-array `[high_word, low_word]`, and the CLI loader interprets them as DP pairs before loading into the initial memory image. Position and velocity are the only DP values; REFSMMAT entries are stored as 9 SP words (per the precision note in Checkpoint 3).

### Checkpoint 4 acceptance

- Required-Δv scalar decreasing over first 30 guidance steps
- VXV cross-range vector components in physically plausible range for PDI geometry (~50–200 m/s lateral)
- UNIT normalization applied to LOS vector produces float magnitude 1.000 ± 0.001
- MXV with REFSMMAT applied to body-frame velocity within 1% of archival inertial-frame values

---

## Terminal Demo — Done Criteria

Single command:
```
bun run scripts/run-guidance-slice.ts --input artifacts/apollo11-pdi-initial-conditions.json
```

The six output lines are owned by `apps/visualizer/src/cli.ts`. `scripts/run-guidance-slice.ts` is a thin build-and-invoke wrapper:

1. **VXV moment** — cross-range vector components in m/s (on `vm.vector.op { opcode: 'vxv' }` event)
2. **UNIT moment** — pre/post float magnitude (on `vm.vector.op { opcode: 'unit' }` event)
3. **VAC depth** — STODL/STOVL round-trip: `vac +1` / `vac -1` annotations
4. **Trig values** — SINE/COSINE of PDI pitch angle with expected values in parentheses
5. **MXV result** — attitude-transformed velocity with archival comparison
6. **Convergence** — required-Δv for first 30 steps, showing monotonic decrease

Exit conditions: halts cleanly, zero compiler warnings for recognized guidance opcodes.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/vm-core/src/index.ts` | Extend opcode field to 6 bits (`signExtend9`); add `onesComplementMultiplyFractional`; add VXV, UNIT, trig, matrix, PopVac opcodes; refactor `VmState` to MPAC/VAC model; add `matrixBuffer` field |
| `packages/event-stream/src/index.ts` | Add `vm.vector.op`, `vm.mpac.write`, `vm.vac.push`, `vm.vac.pop` with defined payloads; retire `vm.stack.push`, `vm.stack.pop`; update `VmSnapshotPayload`; bump `schemaVersion: 1 \| 2` |
| `packages/vm-core/src/index.test.ts` | Tests for encoding change, VXV, UNIT, trig, matrix, MPAC/VAC round-trips; v1 replay regression |
| `packages/runtime/src/guidance-compiler.ts` | Map VXV, UNIT, SINE, COSINE, ARCSIN, ARCTAN2, MXV, VXM, TRANSPOSE, EXIT, EXITS mnemonics to new opcodes |
| `packages/runtime/src/index.ts` | Update `summarizeRuntime`: `maxStackDepth` → `maxVacDepth` from `vm.vac.push`; update `RuntimeStats` |
| `apps/visualizer/src/index.ts` | Update `Frame`: `stackDepth`/`topOfStack` → `vacDepth`; update `buildFrameTimeline` |
| `apps/visualizer/src/cli.ts` | Add six structured demo output lines |
| `artifacts/apollo11-pdi-initial-conditions.json` | New file — real PDI initial conditions with DP position/velocity |
| `scripts/run-guidance-slice.ts` | Update default `--input`; pass through to CLI |

---

## Out of Scope

- WebAssembly compilation of the VM (TypeScript sufficient for terminal demo and Phase 2)
- Phase/restart machinery and 1202 alarm executive
- Any browser or Three.js code
- LLM annotation pass (separate workstream)
