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

## Checkpoint 1 — VXV + UNIT

### VXV (Opcode 27)

Pops two vec3s from stack, pushes their cross product.

```
result.x = lhs.y * rhs.z − lhs.z * rhs.y
result.y = lhs.z * rhs.x − lhs.x * rhs.z
result.z = lhs.x * rhs.y − lhs.y * rhs.x
```

All arithmetic uses `onesComplementMultiply` and `onesComplementSubtract`. Stack effect: −6 words, +3 words (net −3).

Halt on stack underflow: `stack-underflow:vxv`.

### UNIT (Opcode 28)

Pops one vec3, pushes its unit-normalized form.

1. Compute magnitude² = dot(v, v) via existing `dot3` arithmetic
2. Convert to signed float, take `Math.sqrt`, convert back to fixed-point scale factor
3. Divide each component by magnitude
4. Edge case: if magnitude is near-zero (< 1), halt with `division-by-zero:unit` — mirrors the AGC gimbal singularity guard

Stack effect: −3 words, +3 words (net 0).

### New event type: `vm.vector.op`

Emitted by VXV and UNIT in addition to the standard stack push/pop events:

```typescript
interface VmVectorOpPayload {
  readonly opcode: 'vxv' | 'unit';
  readonly inputA: readonly [number, number, number];
  readonly inputB: readonly [number, number, number] | null; // null for UNIT
  readonly output: readonly [number, number, number];
}
```

This payload is what the Three.js renderer will consume to drive the cross-product animation. Emitting it now (at the VM layer) means the renderer doesn't need to reconstruct vectors from raw push/pop events.

### Checkpoint 1 acceptance

Terminal output shows:
- VXV producing a nonzero cross-range vector printed in physical units
- UNIT printing pre-normalization magnitude and post-normalization magnitude ≈ 1.0

---

## Checkpoint 2 — MPAC/VAC Refactor

### Problem with current flat stack

`STODL` (store current value to memory, load new scalar) and `STOVL` (store, load new vector) require the AGC's push-down accumulator model. On the real AGC:

- **MPAC** is a fixed 7-word register holding the "current" interpreter result
- **VAC area** is a push-down stack of MPAC snapshots

`STODL` does: write MPAC to memory address → push current MPAC onto VAC → load new scalar into MPAC.
`RTB`/`EXIT` restore from VAC.

The current flat stack collapses MPAC and VAC into one structure, which breaks STODL/STOVL round-trip semantics.

### New model

`VmState` gains:

```typescript
interface VmState {
  // ...existing fields minus `stack`...
  readonly mpac: readonly Word15[];     // 7 words — current accumulator
  readonly vac: readonly (readonly Word15[])[];  // push-down stack of saved MPACs
}
```

The `stack` field is removed. All opcodes that previously pushed/popped the flat stack are updated to read/write `mpac` directly.

New internal operations on `AgcInterpretiveVm`:
- `writeMpac(words)` — overwrite MPAC, emit `vm.mpac.write`
- `readMpac()` — return current MPAC contents
- `pushVac()` — snapshot current MPAC onto VAC stack, emit `vm.vac.push`
- `popVac()` — restore MPAC from top of VAC stack, emit `vm.vac.pop`

`STODL` becomes: `Store(address)` → `pushVac()` → `Load(address2)`.
`STOVL` becomes: `StoreVec3(address)` → `pushVac()` → `LoadVec3(address2)`.
`EXIT`/`RTB` call `popVac()` before returning.

### Event stream compatibility

New event types added (never removed):
- `vm.mpac.write` — full 7-word MPAC contents after write
- `vm.vac.push` / `vm.vac.pop` — VAC depth before/after

Existing event types (`vm.stack.push`, `vm.stack.pop`) are **retired** — existing replay logs are not forward-compatible across this refactor. A schema version bump in `VmReplayLog` (`schemaVersion: 2`) signals this.

`PlaybackController` and the ASCII timeline CLI are updated to consume the new event types.

### Checkpoint 2 acceptance

- `STODL` / `STOVL` round-trips produce correct VAC depth increments/decrements
- No memory corruption across a full guidance slice execution
- Existing tests updated to new event schema; all pass

---

## Checkpoint 3 — Trig + Matrix Opcodes

### Trig (Opcodes 29–32)

| Opcode | Mnemonic | Stack effect | Notes |
|--------|----------|-------------|-------|
| 29 | SINE | pop 1 → push 1 | |
| 30 | COSINE | pop 1 → push 1 | |
| 31 | ARCSIN | pop 1 → push 1 | halt `domain-error:arcsin` if \|x\| > max representable |
| 32 | ARCTAN2 | pop 2 (y, x) → push 1 | four-quadrant arctangent |

**Angle scaling**: AGC convention is 1 full revolution = full-scale (0x3FFF ≈ π radians in half-revolution units). Input to SINE/COSINE is in half-revolutions; output of ARCSIN/ARCTAN2 is in half-revolutions.

**Implementation**: convert fixed-point to float using `onesComplementToSigned` → apply `Math.sin`/`Math.cos`/`Math.asin`/`Math.atan2` → convert back. No CORDIC approximation — the AGC's polynomial quirks only affect cycle counts, not output values at the precision level the guidance equations use.

### Matrix (Opcodes 33–37)

| Opcode | Mnemonic | Stack effect |
|--------|----------|-------------|
| 33 | MXV | pop 9 (matrix) + 3 (vec) → push 3 |
| 34 | VXM | pop 3 (vec) + 9 (matrix) → push 3 (transposed multiply) |
| 35 | TRANSPOSE | pop 9 → push 9 |
| 36 | LoadMat3 | (immediate: base address) push 9 words from memory |
| 37 | StoreMat3 | (immediate: base address) write top 9 words to memory |

**Matrix layout**: 9 consecutive words on the MPAC/stack, column-major (matches AGC REFSMMAT storage convention). Matrix word order: `[m00, m10, m20, m01, m11, m21, m02, m12, m22]`.

**MXV computation**: standard matrix-vector multiply using `onesComplementMultiply` and `onesComplementAdd` for each of the 9 multiply-accumulate operations per output component.

### Checkpoint 3 acceptance

- SINE/COSINE of the PDI pitch angle (~72° from vertical, 0.2 half-revolutions) match expected values within fixed-point precision
- MXV applied to a unit body-frame vector using the REFSMMAT produces a correct inertial-frame result (verifiable against known mission geometry)
- Full guidance slice runs without unknown opcodes (zero `Opcode.Nop` fallbacks for recognized mnemonics)

---

## Checkpoint 4 — Real Apollo 11 Initial Conditions

### Artifact: `artifacts/apollo11-pdi-initial-conditions.json`

Replaces `artifacts/powered-descent-trace-seed.json` for the primary demo run. Contains:

```json
{
  "description": "Apollo 11 Powered Descent Initiation — July 20, 1969, ~102:33 GET",
  "source": "Lunar Surface Journal / archival telemetry reconstruction",
  "position_agc": [x, y, z],        // AGC fixed-point, 2^28 cm units
  "velocity_agc": [vx, vy, vz],      // AGC fixed-point, corresponding velocity units
  "refsmmat_agc": [9 words],          // column-major, AGC fixed-point
  "landing_site_agc": [lx, ly, lz],  // shifted target (~6.4 km east of planned)
  "t0_get_seconds": 6153             // Ground elapsed time at PDI in seconds
}
```

The 1202 alarm happens at approximately T+102s into powered descent because the computational load at that point (rendezvous radar + guidance + display updates simultaneously) genuinely overloads the executive. With real initial conditions loaded, the guidance routine's execution profile matches the actual mission.

### Checkpoint 4 acceptance

CLI run with `--input artifacts/apollo11-pdi-initial-conditions.json` shows:
- Required-Δv scalar decreasing over first 30 guidance steps
- VXV cross-range vector in physically plausible range for PDI geometry (~50–200 m/s lateral component)
- UNIT normalization applied to LOS vector produces magnitude 1.000 ± fixed-point epsilon
- MXV with REFSMMAT applied to body-frame velocity produces inertial-frame velocity matching archival values

---

## Terminal Demo — Done Criteria

Single command:
```
bun run scripts/run-guidance-slice.ts --input artifacts/apollo11-pdi-initial-conditions.json
```

Output demonstrates all six items:
1. VXV cross-range vector printed with components in m/s
2. UNIT LOS normalization with pre/post magnitude
3. STODL/STOVL VAC depth round-trip (no corruption)
4. SINE/COSINE of PDI pitch angle with expected values
5. MXV attitude transform correct against REFSMMAT
6. Required-Δv decreasing monotonically over first 30 steps

Exit conditions: halts cleanly, zero compiler warnings for recognized guidance opcodes.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/vm-core/src/index.ts` | Add VXV, UNIT opcodes; refactor MPAC/VAC model; add trig + matrix opcodes |
| `packages/event-stream/src/index.ts` | Add `vm.vector.op`, `vm.mpac.write`, `vm.vac.push`, `vm.vac.pop`; bump schema to v2 |
| `packages/vm-core/src/index.test.ts` | Tests for VXV, UNIT, trig, matrix ops; MPAC/VAC round-trip tests |
| `packages/runtime/src/guidance-compiler.ts` | Map VXV, UNIT, SINE, COSINE, MXV, VXM, TRANSPOSE mnemonics to new opcodes |
| `apps/visualizer/src/index.ts` | Update `buildFrameTimeline` for new event types |
| `apps/visualizer/src/cli.ts` | Print VXV/UNIT moments explicitly in output |
| `artifacts/apollo11-pdi-initial-conditions.json` | New file — real PDI state |
| `scripts/run-guidance-slice.ts` | Load new artifact, print convergence metrics |

---

## Out of Scope

- WebAssembly compilation of the VM (TypeScript is sufficient for terminal demo and Phase 2 browser use)
- Phase/restart machinery and 1202 alarm executive (deferred to Phase 2 interactivity)
- Any browser or Three.js code
- LLM annotation pass (separate workstream)
