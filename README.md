# Desktop Pet World

A **real-time 3D world** on your desktop where a chick and a puppy live.
Seasons and weather pass, the pets farm, cook and fish — and **on the days you don't log in, they still live their day and write a diary.**

> 한국어 버전은 [README_KO.md](README_KO.md)를 보세요.

Built as a fork of [super-agent-party](https://github.com/heshengtao/super-agent-party), which provides
the Electron shell and the LLM agent backend. This fork adds a ~30k-line 3D world (`static/js/world.js`),
two original characters modeled in Blender, and an offline day simulator that keeps the pets living while
you are away — all in three.js, under a hard thermal budget on Apple Silicon, with a self-built
test / performance / balance harness.

---

## What this fork is

**Upstream** — [`heshengtao/super-agent-party`](https://github.com/heshengtao/super-agent-party) (AGPL-3.0)
provides the Electron shell, the LLM agent backend and the desktop-pet windows. The original documentation is in [README_UPSTREAM.md](README_UPSTREAM.md).

**What this fork adds**

| | |
|---|---|
| `static/js/world.js` | **30,287 lines · entirely new** — the whole 3D world |
| `chick_and_puppy_cute.blend` → `*.glb` | Chick and puppy, **modeled from scratch** |
| `scripts/` | Smoke tests · performance probes · balance simulator |
| `design/` | Modeling reference sheets (illustrated specs for the eat / drink stages) |
| [`PATCHING-GUIDE.md`](PATCHING-GUIDE.md) | The project's invariants and verification routine |

Since the fork: 220 files changed · +46,142 / −75,369 (a net reduction — the upstream VRM pipeline and more were removed).

---

## The world

### A living environment
- **Four seasons** — spring, summer, autumn, winter. Tree colors vary per tree; in winter the grass texture swaps to snowfield
- **Weather** — clear / cloudy / rain / snow. When it rains the pets run home on their own, sit and wait, and come back out when it clears
  (snow is the exception — a walk in the snow is allowed)
- **Day and night** — sky gradient, sun and moon travelling in arcs, refreshed every 30 seconds
- **Constellations** — connect stars to register a constellation and it stays in the night sky every night (`config/world_constellations.json`)

### Daily life
- **Farming** — seed → sprout → growth → harvest. Real-time growth; one watering per stage halves the time
- **Cooking** — match ingredient lineages (diving / shellfish / market / pantry) and plate the dish. A successful match is promoted to a proper recipe card
- **Fishing · diving for seafood · shell gathering**
- **Ferry delivery** — one order a day, three items per kind. The delivery notice is not a toast but a crate left on the pier
- **Digging** — ⌘ while controlling a pet, or `<game=treasure>` in chat. Very occasionally a pet digs on its own

### Interaction
- **Controlling a pet (possession)** — two layers: Sims-style panel commands and Animal Crossing-style direct control
- **Vehicles** — three times walking speed, with a passenger seat
- **Holding hands · hide-and-seek** — choreographed inside the scene, without any IPC between windows
- **Music** — drop files into `static/music/` and they show up in the list and loop
- **Snacks and drinks** — a 3D cup is parented to a paw or wing and sways with the body. Taking a bite actually shrinks it

### Offline day simulation ⭐
The core idea of this project.

```
A day you didn't log in
      ↓  the day simulator rolls an "abstract day" from a date seed
  That day's events
      ↓  the diary daemon writes the day from the pet's point of view
   Folded into the world log (canon)
      ↓
Next time you log in, the pet greets you and brings up that day
```

The pets stay alive on the days you are not there. The day rolls over at 6 a.m., so even a diary written in the small hours gets a morning comment.

---

## Engineering notes

### The thermal budget (the biggest constraint)
To keep this world open all day on an M-series MacBook, GPU heat was the real ceiling.

- **Removed the post-processing chain** — the GTAO / bloom composer was stacking ~19 full-screen half-float passes per frame.
  Replaced with a single forward pass + MSAA + blob shadows + glow sprites
- **Frame tiers of 60 / 30 / 15 fps** — drops to 15 fps when nobody is watching. The pet windows do the same
- **Particles are shader Points only** (precipitation, fountain, fireflies). No sprite creation / disposal
- **Ocean waves live in the vertex shader** — the CPU writes nothing per frame
- **Lights that are off are `scene.remove`d** — `intensity = 0` is forbidden (a forward shader bills every pixel for every light)
- **Cross-prop mesh merging** — merged per material instance into a handful of meshes per group. Originals are only hidden
  (`visible=false`, not removed) so Raycaster click detection keeps working
- **Vertex-color baking (`bakeGrad`)** — gradients live in the geometry instead of the material, so one kind is one draw call

The invariants are pinned down in [`PATCHING-GUIDE.md` §1](PATCHING-GUIDE.md), and the smoke test enforces **`draws ≤ 250`**.

### Verification harness

```bash
npm run test:world      # smoke 15/15 — zero pageerrors, draws ≤ 250, core state assertions
npm run perf:world      # headless fps / draws / CPU% — four scenarios: active / parked / ambient / toast
npm run balance:world   # Monte Carlo balance of autonomous behavior
```

The **balance simulator** is the unusual one. It mirrors the leisure decision logic in `world.js`, rolls a virtual day
400 times and prints an occupancy table per activity. It is the before / after gate for refactors and tuning, and if a
new activity exceeds 10% occupancy you are made to confirm that was intended.

```bash
node scripts/balance-sim.mjs --mode both        # ± deviation table, before vs. after a patch
node scripts/balance-sim.mjs --day 2026-08-08   # roll an absent day from its date seed and emit the event JSON
```

It exists so that game balance is never tuned by feel.

### Modeling review lab
The eat / drink stages have reference illustrations in [`design/`](design/README.md), and a review lab built into the
world lines the 3D result up against them.

```
world.html?foodlab=1    9 foods × 3 bite stages
world.html?drinklab=1   9 drinks × 3 sip stages
world.html?dishlab=1    8 harvest dishes
```

Headless screenshot scripts (`scripts/_*lab-shot.mjs`) capture them for side-by-side comparison with the spec.

---

## Running

```bash
npm install
npm run dev        # run Electron in development
```

Build:

```bash
npm run build:mac    # or build:win / build:linux
```

LLM backend configuration follows the upstream documentation ([README_UPSTREAM.md](README_UPSTREAM.md)).

---

## Tech stack

`three.js` · `Electron` · `Python (FastAPI)` · `Blender` · `Playwright (headless)` · `Node.js`

---

## License · credits

This repository is a fork of [`heshengtao/super-agent-party`](https://github.com/heshengtao/super-agent-party)
and is distributed under **AGPL-3.0**, the same as upstream. See [LICENSE](LICENSE) for the full text and
[`LICENSE-third-party/`](LICENSE-third-party/) for the third-party list.

The footstep sounds are used under the terms in [`static/sounds/steps/LICENSE.txt`](static/sounds/steps/LICENSE.txt).

The chick and puppy characters (`chick_and_puppy_cute.blend`, `Chick.glb`, `Puppy.glb`) and the world
implementation, `static/js/world.js` included, were written new in this fork.
