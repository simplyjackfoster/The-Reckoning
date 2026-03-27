# DEAD RECKONING — Implementation Plan

## Source Material Map

The chrislgarry/Apollo-11 repo contains two programs:

- **Luminary099** — LM guidance computer (Luminary 1A, the one that landed). This is your primary source.
- **Comanche055** — CM guidance computer (Colossus 2A). Ignore for now.

Within Luminary099, the files that matter to this project:

| File | What it contains |
|------|-----------------|
| `INTERPRETER.agc` | The interpretive VM itself — the dispatcher (INTPRET, DANZIG, NEWOPS), opcode handlers for DLOAD, VLOAD, VXV, DOT, VXSC, UNIT, MXV, etc., and the push-down list (MPAC area) logic |
| `POWERED_DESCENT_INITIALIZAION.agc` | P63 init — sets up the guidance state, initial conditions |
| `BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc` | BURNBABY — the main ignition sequence; calls guidance routines |
| `THE_LUNAR_LANDING.agc` | P64/P66 — final approach and landing phase guidance |
| `GUIDANCE_P70_AND_P71.agc` | Abort guidance |
| `DIGITAL_AUTOPILOT.agc` | DAP — thruster selection logic |
| `ASSEMBLY_AND_OPERATION_INFORMATION.agc` | Flag/verb/noun assignments — useful for the annotation layer |
| `ERASABLE_ASSIGNMENTS.agc` | Memory map — MPAC location, register assignments, scaling |

The Virtual AGC project (virtualagc/virtualagc on GitHub) contains:
- `yaAGC/` — the C emulator source; reference implementation for cycle-accurate behavior
- HTML assembly listings at virtualagc.github.io with hyperlinking — essential for the comment extraction pass
- The `INTERPRETER.agc` in Luminary099 is also present in the virtualagc repo with cross-links to the Comanche version

---

## Critical Architectural Decision: How Deep Does "Faithful" Go?

Before writing a line of code, you need to resolve this. Three options, in order of scope:

**Option A — Full AGC emulator in Wasm, intercept interpreter calls**
Run yaAGC (the C emulator) compiled to WebAssembly. Hook the instruction trace output. When the interpreter is active, pipe each opcode + register state to a stream. The renderer consumes that stream.

*Pro:* Maximally authentic. The restart machinery, the executive, the 1202 alarm — all real. The phase table runs. Every arithmetic quirk is correct because yaAGC has been verified against Verilog gate-level simulation.  
*Con:* yaAGC is ~50K lines of C with heavy use of shared memory and IPC sockets. Porting to Wasm is non-trivial. The instruction stream is at AGC machine code level — you'll need to identify interpreter execution windows within the raw trace. This is 6–8 weeks of work before you have anything renderable.

**Option B — Standalone interpretive engine only (recommended)**
Write the interpretive VM from scratch in TypeScript/Wasm, implementing only the ~60 interpreter opcodes. The base AGC machine is not emulated; you implement just the layer that INTPRET runs. The powered descent guidance routines are extracted from Luminary099 and transcribed to your interpreter's bytecode format.

*Pro:* The thing the spec document describes is actually this. The interpretive language is already a separate VM — MIT designed it that way. Scope is tractable: one strong engineer, three months to a working demo. The arithmetic you need (1's complement 15-bit scaled fixed-point) can be cleanly isolated in 2–3 source files.  
*Con:* The restart machinery requires you to implement just enough of the executive to be faithful. The 1202 alarm requires a job queue model. These are bounded but real additions.

**Option C — JavaScript approximation**
Implement the math using modern floating-point but with the same algorithmic structure. Visually identical. Arithmetically a lie.

*Con:* Defeats the entire point of the project. Do not do this.

**Recommendation: Option B.** The interpretive language is a self-contained VM. This is the right level of abstraction for what the project actually is.

---

## Phase Structure

### Phase 0 — Ground Truth (2 weeks)
*No code. Only reading and data extraction.*

**0.1 — Parse Luminary099/INTERPRETER.agc**  
Extract the complete opcode table. The dispatch table in the interpreter maps 7-bit opcode values to handler routines. You need: opcode mnemonic, opcode number, operand types (vector/scalar/matrix/address), stack effect (what it pushes and pops from MPAC push-down list), and scaling conventions.

The definitive reference for this is the MIT "Programmed Guidance Equations" document (available on ibiblio.org/apollo) and Don Eyles' "Sunburst and Luminary" memoir. Both explain the interpreter's internal conventions in plain English.

**0.2 — Extract the powered descent guidance routine**  
From Luminary099, extract the interpretive-language code blocks in:
- `POWERED_DESCENT_INITIALIZAION.agc` — P63
- `BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc` — the guidance equation calls
- `THE_LUNAR_LANDING.agc` — P64 approach

You want the sequence of interpreter opcodes that compute the required-velocity vector. This is the "computation" that Dead Reckoning visualizes. Write it out as a flat list: opcode, operand, comment, source line number.

**0.3 — Build the comment annotation map**  
Run Claude API against all interpretive-language sections of Luminary099. For each comment:
- Extract the comment text
- Identify which opcode/operand pair it precedes
- Classify: mathematical explanation, caution/warning, reference to document, historical note, procedural annotation
- Score its "surfaceable quality" — some comments are gold ("COMPUTE THE DESIRED CROSS-RANGE COMPONENT OF VELOCITY"), some are bureaucratic noise ("SEE REF 3")

Output: a JSON file mapping `{source_file, line_number, opcode_index} → {comment_text, quality_score, classification}`. This is the annotation layer, built once.

**0.4 — Obtain Apollo 11 initial conditions**  
The Lunar Surface Journal (history.nasa.gov/alsj) contains the powered descent timeline with telemetry values. The specific quantities needed:
- Position and velocity at Powered Descent Initiation (PDI), T+0
- The REFSMMAT (reference stable member matrix) at PDI
- The landing site coordinates Neil Armstrong flew to (shifted ~4 miles long due to boulder avoidance)

These give you authentic starting values. The 1202 alarm occurs at approximately T+102 seconds into powered descent.

---

### Phase 1 — The Interpreter Core (4 weeks)
*This is the hardest engineering in the project. Everything else depends on it.*

**Repository structure:**
```
dead-reckoning/
  interpreter/
    src/
      arithmetic.ts      # 1's complement 15-bit fixed-point
      mpac.ts            # push-down accumulator (MPAC, VAC area)
      opcodes/
        vector.ts        # VXV, DOT, VXSC, UNIT, VAD, VSU
        scalar.ts        # DMP, DDV, DAD, DSU, ABS, SIGN
        trig.ts          # SINE, COSINE, ARCSIN, ARCTAN
        matrix.ts        # MXV, VXM, TRANSPOSE
        store.ts         # STORE, STODL, STOVL, STCALL
        load.ts          # DLOAD, VLOAD, DMOVE
        control.ts       # CALL, GOTO, RTB, EXIT
      interpreter.ts     # dispatch loop, opcode fetch, INTPRET entry
      memory.ts          # erasable memory model (registers, VAC area)
    tests/
      arithmetic.test.ts # verify 1's complement edge cases
      opcodes.test.ts    # test each opcode against known values
    index.ts             # public API
```

**1.1 — Arithmetic layer (1 week)**

The AGC used 1's complement 15-bit integers. In 1's complement, there are two representations of zero (+0 = 0x0000, −0 = 0x7FFF for 15 bits). This is not an exotic edge case — the interpreter relies on it for overflow detection.

Double-precision values are two consecutive 15-bit words (SP is single, DP is double). Scaling is by powers of 2 relative to physical units — position is in units of 2^28 cm (roughly 2.68 km), velocity in corresponding units. You do not need to support every scaling convention immediately; start with the ones used in the guidance equations.

Key invariants to test from the start:
- Overflow on add/subtract wraps in 1's complement (result + overflow bit)
- DP multiply (DMP) uses Q-register handoff conventions
- Division (DDV) requires divisor ≥ dividend in absolute value or produces nonsense

Write a small test suite with known input-output pairs taken directly from the Luminary source comments. MIT programmers often annotated intermediate results with expected values.

**1.2 — MPAC push-down structure (3 days)**

The MPAC (multi-precision accumulator) is a 7-word erasable area. The push-down list is a separate scratch area (VAC area — Vector Accumulator Cells). When the interpreter executes VXSC (vector times scalar), it:
1. Pops the current MPAC contents
2. Performs the operation
3. Pushes the result back into MPAC

The "push-down" aspect means previous results remain accessible in the VAC area. STOVL and STODL operations use this. Model MPAC as a struct with the 7 words plus a pointer into the VAC stack.

**1.3 — Opcode implementations (2 weeks)**

Priority order for the powered descent guidance equations. Implement and test in this sequence:

*Vector ops first (most of what guidance does):*
- VLOAD — load vector from memory into MPAC
- VXSC — scale vector by scalar (used constantly)
- VXV — vector cross product (three multiplies, the cross-range computation)
- DOT — dot product (inner product, used in unit vector checks)
- UNIT — normalize to unit length (includes division, gimbal singularity check)
- VAD — vector add
- VSU — vector subtract

*Scalar ops:*
- DLOAD — load double-precision scalar
- DMP — double-precision multiply
- DDV — double-precision divide
- DAD, DSU — add/subtract scalars
- ABS, SIGN — absolute value, sign extraction

*Trig:*
- SINE, COSINE — implemented using the AGC's CORDIC-equivalent polynomial approximation (documented in the MIT memos)
- ARCSIN, ARCTAN — inverse trig

*Matrix ops:*
- MXV — matrix times vector (attitude transformation, used heavily in DAP)
- VXM — vector times matrix (transpose multiply)
- TRANSPOSE — transpose a 3x3 scaled matrix

*Store/load conventions:*
- STORE — write MPAC to memory address
- STODL — store and immediately load new scalar (very common pattern)
- STOVL — store and immediately load new vector

*Control:*
- CALL / GOTO / RTB / EXIT — interpretive subroutine calls

**1.4 — Interpreter dispatch loop**

The real interpreter entry point is INTPRET, which:
1. Sets LOC to the word following the calling TC instruction
2. Fetches opcode pairs (two 7-bit opcodes packed in three words)
3. Dispatches to the handler
4. Returns to DANZIG to fetch the next pair

Your TypeScript version should: accept a bytecode array (the extracted guidance routines), execute one opcode per step(), emit a StateSnapshot after each step with the full MPAC contents, MODE register, and the operand resolved to physical units.

This StateSnapshot is the stream that the renderer consumes.

**Deliverable for Phase 1:** A terminal demo. Run the powered descent guidance routine from PDI initial conditions. Print MPAC state after each instruction. Show the required-velocity vector converging over the first 30 seconds. No graphics yet.

---

### Phase 2 — Stack Visualization (3 weeks)
*The central visual object.*

**Technology:** Three.js in a single-page web app. No framework required — this is one page.

**2.1 — StateSnapshot → visual object mapping**

Each MPAC state maps to a visual object:

| MPAC content | Visual representation |
|---|---|
| Vector (3 components) | ArrowHelper pointing from origin; magnitude encodes scale |
| Scalar (DP) | Sphere; radius proportional to value; color encodes sign |
| Matrix (3×3) | Three colored arrows (column vectors); shows transformation |
| Mode = SP (single precision) | Small indicator glyph |

The push-down list history (previous MPAC states before the current instruction) shows as fading ghost arrows behind the current state. This makes the accumulation pattern visible — you can see what the instruction is working with before it resolves.

**2.2 — Opcode transition animations**

Each opcode class has a characteristic animation:

- VXV: Two input arrows materialize, then a perpendicular third appears (the cross product). The right-hand rule is visually legible.
- UNIT: An arrow snaps to unit length; the original length ghost remains briefly.
- DOT: Two arrows approach each other; a scalar sphere appears whose radius is the inner product magnitude.
- DMP: Two spheres merge into one; size scales to product.
- STODL / STOVL: Arrow or sphere slides into a "memory slot" background element; a new object loads in.

Do not over-animate. The rhythm of the interpreter is already inherently visual; the animations should clarify the operation, not decorate it. Each transition should complete in under 400ms.

**2.3 — Camera behavior**

Default camera orbits the current MPAC vector, keeping it centered. "Auto" mode follows the computation — when a new vector loads, the camera smoothly reorients to show it well. "Free" mode gives the user full Three.js OrbitControls.

For the cross product operations, briefly switch to a top-down view along the third axis to make the right-hand rule legible. Return to the previous view after 1.5 seconds.

**2.4 — The physical unit overlay**

At the top of the stack panel, always show the current MPAC value in physical units with a label: "Required Δv: 47.3 m/s", "LOS unit vector: [0.23, -0.71, 0.66]". This is derived from the scaling conventions in ERASABLE_ASSIGNMENTS.agc. It bridges the raw fixed-point arithmetic and the physical meaning.

**Deliverable for Phase 2:** The stack visualization running in a browser, driven by the Phase 1 interpreter stepping through the powered descent routine. No LM model yet. No interactivity. The computation plays in real-time; stack objects appear, transform, and settle.

---

### Phase 3 — The Ghost Panel and Annotation Layer (2 weeks)

**3.1 — Source scroll**

Right panel: the Luminary099 interpretive source, scrolling in real-time as the interpreter executes. The currently-executing opcode line is highlighted. One source line per interpreter step; the scroll follows with a small easing lag (200ms) so the user's eye can track.

The source text uses monospace type. Opcodes are one color, operand addresses another, comments a third. This is already done in the Virtual AGC HTML listings — you can derive the syntax rules from yaYUL's tokenizer.

**3.2 — Annotation overlay delivery**

When the interpreter steps to a line that has a quality_score above your surfacing threshold, the comment text fades in as a floating annotation to the right of the highlighted line. It holds for 2–3 seconds (or until the next surfaceable annotation is ready), then fades.

Rules:
- Never show two annotations simultaneously
- If a sequence of instructions fires too fast (interpreter runs at mission cadence, which is ~several hundred instructions per second during braking phase), buffer the annotations and surface them with a brief delay to remain readable
- Quality filter: only show classified annotations of type "mathematical explanation" or "historical note" during normal playback; show "caution/warning" annotations always (they're the most interesting); suppress "reference to document" unless the user hovers the source line

**3.3 — Temporal collapse moments**

Three specific annotations are the emotional core of the project. Identify these in Phase 0 and flag them specially:

1. The cross-range velocity computation ("COMPUTE THE DESIRED CROSS-RANGE COMPONENT OF VELOCITY") — this appears during VXV, simultaneously with the perpendicular arrow materializing in the stack panel.
2. The unit line-of-sight computation — appears when UNIT snaps an arrow to unit length.
3. The numerical caution comment near the gimbal lock singularity check.

These three get special treatment: the annotation text is larger, the fade-in is slower, and a subtle pulse on the source line draws attention. These are the "séance moments."

**Deliverable for Phase 3:** The full three-panel layout. Interpreter runs, stack animates, source scrolls, annotations surface at the right moments. Show this to someone unfamiliar with the project. The séance moments should produce a reaction.

---

### Phase 4 — The Spacecraft and Physics (4 weeks)
*The left panel. The most engineering-intensive phase.*

**4.1 — LM 3D model**

Use an existing open-licensed LM mesh. Several exist on Sketchfab and NASA's 3D resources page. The model needs: descent stage, ascent stage, four landing legs, and sixteen RCS thruster positions (four quads of four jets).

Import with Three.js GLTFLoader. Apply a flat, slightly emissive material — this is space, not a film set. The LM should look like engineering hardware, not a toy.

**4.2 — Newtonian 6-DOF simulation**

This is the physics layer that drives LM orientation and position.

State vector: position (3D, lunar-surface-relative frame), velocity (3D), quaternion (attitude), angular velocity (3).

At each timestep:
1. Read the thruster command bitfield from the DAP module
2. For each commanded thruster, apply force at its position vector (torque = r × F)
3. Sum all forces and torques
4. Integrate with a fixed 10ms timestep (Euler is fine for this; RK4 is not necessary at this accuracy level)
5. Apply lunar gravity (1.622 m/s²) along the -Z axis (nadir direction)

The LM mass decreases as fuel burns. At PDI, total mass is approximately 15,100 kg. The descent engine burns at roughly 4.7 kN (throttled) to 44.4 kN (full thrust). The fuel mass flow rate is approximately 15 kg/s at full thrust.

**4.3 — DAP (Digital Autopilot) thruster selection**

The DAP solves: given a desired torque vector (from attitude error), select the minimum set of RCS jets that produces that torque, subject to the constraint of not firing opposing jets simultaneously.

This is the discrete optimization that lives in `DIGITAL_AUTOPILOT.agc`. The real implementation uses a jet-selection table (a precomputed lookup that maps torque direction to jet combinations). You can implement this faithfully by transcribing the jet-selection logic from the AGC source.

The 16 RCS jets are organized in 4 quads (A, B, C, D), each with 4 jets (firing fore, aft, left, right relative to the quad's mounting axis). The selection table maps desired roll/pitch/yaw torques to specific jet combinations.

**4.4 — Feedback loop**

The LM physics state feeds back to the interpreter. After each guidance cycle (approximately every 2 seconds), the interpreter reads:
- Current position from the physics state
- Current velocity from the physics state  
- Current attitude from the physics state (via the IMU model)

These values are written to the erasable memory locations that the guidance equations read. This closes the loop — the spacecraft IS the output of the interpreter.

**4.5 — Visual feedback: thruster plumes**

When the DAP commands a thruster, a short plume renders at that thruster's position. Use Three.js Points with a custom shader: each plume is a cone of particles expanding away from the thruster nozzle, fading over 200ms. The plume color is slightly blue-white (hypergolic propellant exhaust in vacuum).

The plumes are the most viscerally satisfying visual: they fire in micro-bursts, asymmetrically (because attitude control is not symmetric), and the LM visibly responds.

**4.6 — Readouts**

Three readouts in the left panel corners:
- Altitude (m)
- Velocity (m/s, decomposed into horizontal and vertical)
- Time to go (derived from guidance state)

These are NOT from a separate simulation. They read directly from the interpreter's erasable memory state, converted from fixed-point to physical units using the scaling constants.

**Deliverable for Phase 4:** Full three-panel application running in real-time. Landing plays out. The 1202 alarm fires at T+102s. Plumes fire. LM descends. Stack animates. Source scrolls. Annotations surface. This is the shippable demo.

---

### Phase 5 — Interactivity (2 weeks)

**5.1 — Landing target drag**

Render the landing site as a crosshair on the lunar surface. Make it draggable (Three.js Raycaster against a plane at altitude 0). On drag:
1. Update the landing site coordinates in erasable memory
2. The guidance equations pick up the new target on the next cycle
3. The required-velocity vector in the stack shifts to reflect the new error
4. The LM begins adjusting

The maximum draggable range is physically bounded by what the guidance can converge within the remaining descent time. If the user drags too far, the algorithm alarms. Make this visible: the stack shows diverging oscillation before the PROGRAM ALARM state.

**5.2 — Thruster kill**

Checkbox grid for the 16 RCS jets. Toggle off individual jets. The DAP recalculates with the reduced jet set; some torque axes become uncoverable; the attitude control becomes sluggish or asymmetric. The LM tilts. This is one of the most intuitive ways to feel how robust (and fragile) the system was.

**5.3 — IMU drift**

A slider: gyro drift rate from 0 to 0.1 deg/hr (0 is truth; 0.1 is the actual pre-mission uncertainty). With drift dialed in, watch the attitude matrix in the stack slowly diverge from truth. The autopilot fights the drift. Eventually, if drift is large enough, the landing site drifts off the crosshair.

**5.4 — Trigger 1202**

A button. Fills the executive job queue artificially. Watch the phase table checkpoint, the low-priority job purge, the restart recovery. This is the most educational of the interactive features because it explains what actually happened on July 20, 1969 — not "the computer almost crashed" but "the computer's restart machinery worked exactly as designed."

**5.5 — Time scrub**

A timeline slider below the three panels. Every 200ms of simulation time, checkpoint the full state: interpreter register file, physics state, annotation queue. The checkpoint cost is small (< 1KB per checkpoint; at 200ms intervals, 12 minutes of powered descent produces ~3600 checkpoints at ~3.6 MB total).

Dragging the slider seeks to the nearest checkpoint and replays forward. Rewind is instant; the rendering just reads back from the checkpoint store.

---

### Phase 6 — Composer Mode (1 week)

*Do this earlier than the plan suggests. Even a rough version, built in Phase 3, will teach you how to sequence the other audio cues.*

Web Audio API. One AudioContext. Several oscillator/gain nodes:

- **Bass drone** — frequency tied to altitude. As the LM descends, pitch drops. This gives a continuous spatial sense of "approaching" even when eyes are elsewhere.
- **Stack rhythm** — each interpreter instruction produces a short transient. Opcode class determines timbre: vector ops are a soft click, scalar ops are a duller thud, trig ops have a slightly brighter character. At the braking phase cadence, this produces a frenetic rapid-fire texture.
- **Guidance convergence** — a slow harmonic tone whose overtone structure tracks how close the guidance is to a null solution. Far from convergence: dissonant, slightly tense. Converging: harmonics resolve. At landing: a pure tone.
- **Thruster events** — each RCS fire produces a short atonal transient at the corresponding spatial position (panning left/right based on which side of the LM fired).

The emotional arc of the music mirrors the mission: braking phase is loud and frenetic, approach quiets and focuses, final descent is almost meditative.

---

## Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| Interpreter | TypeScript, compiled to Wasm via AssemblyScript | Type-safe arithmetic; Wasm for performance-critical inner loop |
| Renderer | Three.js r155+ | Mature, browser-native, WebGL; GLTF support; OrbitControls |
| Physics | Inline TypeScript | 6-DOF Euler integration is ~50 lines; no library needed |
| Audio | Web Audio API | Browser-native, no dependency |
| Build | Vite | Fast HMR during development; straightforward Wasm integration |
| Testing | Vitest | Co-located with Vite |
| Source parsing | Node.js script (one-time) | Parse `.agc` files, extract comments, write JSON |
| Annotation AI | Claude API (Anthropic SDK) | Build-time only; input: comment + context; output: quality score + classification |

No React. No framework. The application is a single HTML file with a canvas and two side panels. Framework overhead would complicate the tight interpreter→renderer loop.

---

## The 1202 Implementation

This is the one feature that requires implementing a slice of the AGC executive, not just the interpreter. The minimum viable executive for 1202 is:

- A job queue with priority levels (FINDVAC routine)
- A "waitlist" (timed job scheduler)
- A phase table checkpoint (restart list)
- Detection of "executive overflow" — the condition where FINDVAC cannot find a free VAC slot

When your simulation reaches T+102s, artificially increase the job queue occupancy (or let the rendez-vous radar interrupt do it, as happened in reality). The executive overflows. The AGC issues a PROGRAM ALARM 1202. The interpreter checkpoints its phase table entry. Low-priority jobs are killed. The interpreter restarts from the checkpoint.

The visual: everything in the stack panel briefly clears, then the highest-priority jobs repopulate. The spacecraft continues — the guidance reconverges within two seconds. This is why Armstrong didn't abort.

---

## File Extraction Script

This is the first code to write:

```typescript
// extract-guidance.ts
// Parses Luminary099 .agc files and extracts interpretive-language sections
// with their associated comments, producing structured JSON for the annotation pass

import { readFileSync } from 'fs'

type InterpretiveLine = {
  sourceFile: string
  lineNumber: number
  opcode: string
  operand: string | null
  comment: string | null
  isInterpretive: boolean  // false = native AGC assembly within a guidance routine
}

// Files to parse, in execution order during powered descent
const FILES = [
  'Luminary099/POWERED_DESCENT_INITIALIZAION.agc',
  'Luminary099/BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc',
  'Luminary099/THE_LUNAR_LANDING.agc',
]

// The interpreter is active between TC INTPRET and EXITS
// Opcodes that appear in interpretive context are tokenized differently
const INTERP_OPCODES = new Set([
  'VLOAD', 'VXSC', 'VXV', 'DOT', 'UNIT', 'VAD', 'VSU',
  'DLOAD', 'DMP', 'DDV', 'DAD', 'DSU', 'ABS', 'SIGN',
  'SINE', 'COSINE', 'ARCSIN', 'ARCTAN',
  'MXV', 'VXM', 'TRANSPOSE',
  'STORE', 'STODL', 'STOVL', 'STCALL',
  'CALL', 'GOTO', 'RTB', 'EXIT', 'EXITS',
])
```

Run this script in Phase 0 before any other code. Its output JSON drives every subsequent phase.

---

## Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| 1's complement arithmetic has subtle bugs | High | Build the test suite before the opcode implementations; use known intermediate values from MIT memos as ground truth |
| MPAC scaling conventions are underdocumented | Medium | Don Eyles' "Sunburst and Luminary" (available online) explains the scaling conventions in plain English; this is the primary reference |
| Three.js performance at interpreter speed | Low | The interpreter produces at most a few hundred state snapshots/sec; Three.js handles thousands of draw calls/sec; this is not a bottleneck |
| yaAGC Wasm compilation issues | Medium (if you chose Option A) | This risk is eliminated by choosing Option B |
| LM 3D model quality / license | Low | NASA 3D resources are public domain; multiple LM models exist |
| Annotation quality from LLM pass | Medium | Build a manual override system; the 20 most important annotations should be hand-curated regardless of the automated pass |
| Time scrub memory budget | Low | 3.6 MB for 12 minutes at 200ms intervals is negligible; even at 50ms intervals it's ~15 MB |

---

## Milestone Schedule

| Week | Deliverable |
|---|---|
| 1–2 | Phase 0 complete: comment JSON extracted, initial conditions documented, opcode table written out |
| 3–4 | Arithmetic layer + MPAC model passing all unit tests |
| 5–6 | All vector opcodes implemented and tested; guidance routine executes partially |
| 7–8 | Full interpreter running; terminal print of MPAC state per instruction through 30s of descent |
| 9–10 | Stack visualization in browser; Three.js rendering stack state in real-time |
| 11–12 | Ghost panel: source scrolling, annotation overlays firing at correct moments |
| 13–14 | LM model in Three.js; physics simulation; thruster plumes |
| 15–16 | DAP thruster selection; feedback loop closed; full three-panel application |
| 17–18 | Interactivity: landing target drag, thruster kill, IMU drift, 1202 button |
| 19 | Composer mode |
| 20 | Time scrub; performance pass; first external demo |

Total: approximately 5 months for a single strong engineer. The Phase 4 physics/DAP work is parallelizable if two engineers are available — the interpreter and the renderer are independent until Phase 4.

---

## The First Day's Work

Do not open a code editor. Do this instead:

1. Clone the repo: `git clone https://github.com/chrislgarry/Apollo-11`
2. Open `Luminary099/INTERPRETER.agc`
3. Find the INTPRET entry point and read through to DANZIG
4. Write down, on paper or a doc, the answers to: what registers does the interpreter use? What is MPAC? What is the push-down list? What is MODE?
5. Open `Luminary099/BURN_BABY_BURN--MASTER_IGNITION_ROUTINE.agc`
6. Find `TC INTPRET` — the point where control passes to the interpreter
7. Read forward from that point, listing every interpreter opcode until `EXIT` or `EXITS`
8. Look up what each opcode does in the Virtual AGC assembly language manual (ibiblio.org/apollo/assembly_language_manual.html)

That reading session is the foundation. When you sit down to write `arithmetic.ts`, you'll know exactly what you're building.
