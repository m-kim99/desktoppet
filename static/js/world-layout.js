// World layout data — the single place that says WHERE everything is.
// world.js owns the HOW (terrain math, prop builders, behaviors); this file owns the WHAT/WHERE,
// so growing the world is a data edit, not an engine edit:
//   · new land     → add an ISLANDS circle (+ a BRIDGES entry so it can be reached)
//   · new prop     → add a PROPS line (its `type` must exist in world.js PROP_BUILDERS;
//                    optional rotY / scale / variant — `r` is the walk-blocking radius, 0 = walkable)
//   · level ground → add a FLAT_SPOTS circle (flat pads under buildings, ponds, plazas)
// Positions are in world units: a pet stands ~0.4–0.5 tall, the main island radius is 6.2.
// ⚠️ Whenever coordinates are added/changed, always run the full overlap / off-island / road-intrusion sweep (layout-sweep pattern).

export const ISLAND_R = 6.2;   // 5.6→6.2: layout renewal — lower occupancy to secure walkways (0.5m+ corridor clearance)
// Archipelago: the main island plus three satellites reached over wooden bridges. Every land query
// (terrain height, blocking, bridge decks) goes through the helpers in world.js, so pets, the
// player, particles and roads all agree on what counts as ground.
// Layout renewal (2026-07): pushed the satellite islands 2.5~2.7m away from the main island — not "attached lumps" but
// real destinations reached by crossing a bridge. Bearings kept (delta move), within SWIM_LEASH 18.
export const ISLANDS = [
    { x: 0,      z: 0,     r: ISLAND_R },
    { x: 11.23,  z: 5.73,  r: 3.8 },     // NE island — playground (swing, seesaw, gym, trampoline), r 3.2→3.8 + bearing-preserving delta (+0.54,+0.28) keeps the 2.6m gap
    { x: -10.72, z: -4.69, r: 2.9 },     // SW island — Memory Island (monument, peck-peck tree, wishing well, time capsule), gap 2.6m
    { x: 10.12,  z: -7.17, r: 3.5 },     // SE island — Adventure Island (hill, cave, lookout deck, treasure sand patch), gap 2.7m
    // Resort sand island — no bridge (boat/swim only): kind:'sand' splits off the ground texture, beach slope and
    // footstep sounds. buildRouteWalk falls back to a straight line on bridgeless islands (guarded) — AI wandering never targets this island.
    { x: -3.2,   z: 11.8,  r: 2.9, kind: 'sand' },   // Gap 3.4m after the main island expansion — radius 2.6→2.9 for the campfire (precedent: playground expansion)
    // Farm island — garden plot moved here and expanded (8 beds), scarecrow, compost bin. Gap to main island 3.6m, a step back from the standard (2.6)
    // (breathing room for the west view — precedent: sand island 3.4), 2.8m from SW Memory Island. Bridge = BRIDGES[4].
    { x: -12.2,  z: 3.9,   r: 3.0 },
    // 🌸 Chick Meadow — flower hill in the southwest sea (4.5 wishlist #2). North was out: the gap between sand island and playground is too narrow
    // for spacing, due south is the rocket launch pad area, and the first spot (-2.6,-12.2) looked odd with the pad next to it (owner) —
    // so further west and bigger. kind 'meadow' = yellowish bright light-green tint (buildIslandMeshes).
    { x: -3.1,   z: -13.25, r: 3.1, kind: 'meadow' },
];
// Note: buildRoute looks up bridges as BRIDGES[island index-1] — bridge order must match the satellite island order above.
// Formula (radial axis through island centers): A = u·(mainR−0.5), B = satCenter − u·(satR−0.5), inner = A−0.4u, outer = B+0.4u
export const BRIDGES = [
    { A: { x: 5.08,  z: 2.59 },  B: { x: 8.29,  z: 4.23 },  inner: { x: 4.72,  z: 2.41 },  outer: { x: 8.65,  z: 4.41 } },
    { A: { x: -5.22, z: -2.29 }, B: { x: -8.52, z: -3.73 }, inner: { x: -4.86, z: -2.13 }, outer: { x: -8.89, z: -3.89 } },
    { A: { x: 4.65,  z: -3.30 }, B: { x: 7.67,  z: -5.44 }, inner: { x: 4.32,  z: -3.06 }, outer: { x: 7.99,  z: -5.67 } },
    null,   // [3] Resort sand island — placeholder hole for no bridge (boat/swim only). Iterating code must guard with if (!br) continue
    { A: { x: -5.43, z: 1.74 }, B: { x: -9.82, z: 3.14 }, inner: { x: -5.05, z: 1.62 }, outer: { x: -10.20, z: 3.26 } },   // Farm island bridge — span 4.6m (plank density is per length, so it stays dense)
    { A: { x: -1.30, z: -5.55 }, B: { x: -2.51, z: -10.72 }, inner: { x: -1.21, z: -5.16 }, outer: { x: -2.60, z: -11.11 } },   // Meadow bridge — span 5.3m, radial axis through the gap between tree and hammock · a long bridge since the island was pushed far out
];

// ⛴️ Ferry route data — 2 piers (A=land side, B=sea-side end; world.js turns them into walkable decks via the bridge grammar) and
// an open-sea ring (loops outside the whole archipelago; can't pass under bridges so the corridors between satellite islands are unusable — only the
// main island↔sand island gap is a bridgeless waterway). When adding a new island: route generation reads ISLANDS and avoids it automatically;
// to make it a stop, just add a pier + ring point. On coordinate changes the sweep checks ring validity (island interference).
export const FERRY_PIERS = [
    { A: { x: 0.1,   z: 5.98 },  B: { x: 0.35, z: 7.85 } },    // Main island north pier (hub)
    { A: { x: -1.55, z: 12.6 },  B: { x: 0.0,  z: 13.15 } },   // Resort sand island east pier
];
export const FERRY_SEA_POINTS = [   // Open-sea ring (clockwise) — all open water, inside the horizon bound 19.6.
    // First point is the turn buoy for the wide NE swing after docking at the sand island (so it doesn't cut across the palms on the island's north face)
    { x: -0.6, z: 16.6 }, { x: -4.5, z: 16 }, { x: -11, z: 12 }, { x: -18.3, z: 3.5 }, { x: -14.5, z: -11 },   // West buoy moved -16,2 → -18.3,3.5 for the new farm island (island clearance 4.4m, horizon 18.6 < 19.6)
    { x: -6.82, z: -15.4 }, { x: -5.25, z: -16.97 }, { x: -3.1, z: -17.55 }, { x: -0.95, z: -16.97 }, { x: 0.62, z: -15.4 },   // 5-point detour arc south of the meadow island — chord sag eats into island clearance (r+1.0), so 30° spacing (horizon ≤17.8)
    { x: 13, z: -13 }, { x: 18, z: -4 }, { x: 16, z: 1.5 }, { x: 17, z: 8 }, { x: 7, z: 14 },
];

// Hills (HILLS): plateau-shaped peaks added to terrainHeight — the top (35% of radius) is flat so a deck
// can sit on it, and pets simply walk up the slopes. FLAT_SPOTS pads also press into hills (cave pocket),
// producing a natural cut wall on the hill's southwest face.
export const HILLS = [
    { x: 11.12, z: -7.87, r: 2.6, h: 1.1 },   // Adventure Island hill — lookout deck on top, cave on the southwest face (moves with the island delta)
    { x: -3.1, z: -13.25, r: 2.2, h: 0.75 },  // 🌸 Meadow hill — gentle flower hill, bench on the flat top (35%)
];

// Two-story house anchor — the walk-space helpers in world.js (floor/loft/stairs/walls)
// derive everything from this one entry. If you change hw/hd/loftY, also update world.js houseFloorY/houseBlocked
// hard-coded local constants (stair span, loft corners, railing strip, porch posts) and the makeHouse geometry to match.
export const HOUSE = { x: 3.42, z: 4.305, rotY: -2.22, hw: 1.3, hd: 1.04, floorY: 0.05, loftY: 0.78, k: 1.2 };   // k=overall scale (scales geometry + walk-space together — consumed by world.js houseLocal/houseWorld), rotY -2.22 = the front door faces the island center

// Terrain flattening pads — the rolling bumps settle flat inside these circles.
// `follow`: link so that if the prop is moved in construction mode, the pad follows from the next load (world.js syncs at startup).
export const FLAT_SPOTS = [
    { x: 0.0, z: 0.0, r: 1.7 },     // central plaza (hug point / monument to come)
    { x: 3.42, z: 4.305, r: 2.5, follow: 'house-1' },   // house pad — enlarged for k=1.2 (2.05→2.5)
    { x: -3.44, z: -3.44, r: 0.95, follow: 'pond-1' },  // pond basin — now movable in construction mode (the pad follows from the next load)
    { x: 11.7, z: 8.2, r: 1.0, follow: 'swing-1' },   // NE island swing pad (level ground under the A-frame legs)
    { x: 13.15, z: 4.6, r: 1.0, follow: 'seesaw-1' }, // NE island seesaw pad (level ground under the fulcrum + plank)
    { x: 8.9, z: 6.8, r: 1.15, follow: 'gym-1' },    // NE island gym pad — keeps the mat/dumbbells from sinking into the hillocks (same principle as the swing/seesaw pads)
    { x: 9.9, z: 3.9, r: 1.1, follow: 'trampoline-1' },  // NE island trampoline pad — new space in the expanded south
    { x: -10.72, z: -4.69, r: 1.55 },  // Memory Island central yard — monument, wishing well and time capsule stand level
    { x: 9.77, z: -7.12, r: 1.15 },    // Adventure Island cave pocket — flat floor carved into the hill's southwest face
    { x: -2.75, z: 11.95, r: 0.6 },      // Resort island sandcastle base — sits level on the dune undulation (synced with sandcastle moves)
    { x: -12.95, z: 4.25, r: 1.8, follow: 'garden-1' },   // Farm island plot base — keeps the 2.78m frame from tilting on the hillocks (swing pad principle)
];

// Props: type + position + blocking radius (`r` is the circle collider pets steer around; the
// pond blocks too — pets shouldn't wade). The bowl doubles as the Eat-motion spot.
// Kit hook (currently unused — the Kenney pilot was reverted, procedural look won): a tree/rock
// entry may carry `variant` (GLB name under /models/world-kit) + `kitScale`; world-kit.js loads
// it with the procedural builder as fallback.
// Layout renewal (2026-07, main island r6.2) — zoning: plaza (center — street piano, bulletin board and fountain
// line its edge) · house yard (NE: house+food bowl+radio) · N yard (garden plot, mailbox, flower basket) · NW cafe street (coffee, snacks)
// · W yard (library, fence) · S rest spot (hammock) · E rest spot (sunbed, portal). Any two props keep 0.5m+ corridor clearance,
// no intruding on the road ribbon. Order maps 1:1 to layoutId (type-ordinal) — never reorder; new props go at the end of the list.
export const PROPS = [
    { type: 'tree',  x: -2.455, z: -5.249, rotY: 0.0,  r: 0.45, big: true  },   // S rim tree (south of the pond)
    { type: 'tree',  x: 3.4, z: -4.532,  rotY: -0.256,  r: 0.45, big: false },   // S grassland tree (left of the clump)
    { type: 'tree',  x: 9.547, z: 8.597,  rotY: -2.083,  r: 0.45, big: true  },   // NE playground island central shade tree (moved in the house-expansion renewal)
    { type: 'tree',  x: -2.832, z: 4.708, rotY: 0.515,  r: 0.45, big: false },   // S grassland tree (right of the clump — the two form a grove)
    { type: 'house', x: 3.42, z: 4.305, rotY: -2.22, r: 0 },   // walls/rooms block precisely (houseBlocked) — front door faces the island center
        { type: 'bowl',  x:  0.75, z:  1.7,  rotY: 0.0,  r: 0.28 },   // Front-yard food bowl — in front of the new front door
    { type: 'fence', x: -5.25, z:  0.1,  rotY: 1.35, r: 0.5 },    // W rim fence piece — shifted south away from the farm bridge landing (with MOVED_DEFAULTS)
    { type: 'pond',  x: -3.44, z: -3.44, rotY: 0.0,  r: 0.72 },   // SW rim waterside (user-specified — toward the edge)
    { type: 'sunbed',  x: 5.11, z: -0.213,  rotY: -1.35, r: 0.42 },   // E waterside rest spot
    { type: 'hammock', x: -0.19, z: -5.4,  rotY: 0.35,  r: 0.55 },   // S rim rest spot
    { type: 'lamp', x: -0.508, z: 3.523, rotY: 0.0, r: 0.18 },
    { type: 'lamp', x:  4.24, z:  0.30, rotY: 0, r: 0.18 },
    { type: 'lamp', x:  2.54, z: -3.40, rotY: 0, r: 0.18 },
    { type: 'lamp', x: -1.33, z: -4.19, rotY: 0, r: 0.18 },
        { type: 'lamp', x: -3.89, z: -1.89, rotY: 0, r: 0.18 },
        { type: 'lamp', x: -3.869, z: 1.411, rotY: 0.0, r: 0.18 },
        { type: 'radio', x: 2.825, z: 2.131, rotY: -2.027, r: 0.24 },    // House yard radio — on the grass outside the porch deck (avoids overlapping the deck corner)
    { type: 'coffee',        x: -2.884, z: 0.803,  rotY: 2.1,   r: 0.5 },   // Plaza west — inside the ring (road 3.6 renewal)  // NW cafe street — coffee booth (order with Ctrl/⌘)
    { type: 'food', x: -1.771, z: 1.903, rotY: 2.73, r: 0.5 },   // NW cafe street — snack booth (order with Ctrl/⌘)
    { type: 'icebox', x: -0.38, z: 5.5, rotY: 3.05, r: 0.3 },   // Beside the main island north pier — catch storage box (cooking ingredients; destination of the catch '보관' (store) choice)
    { type: 'kitchen', x: -2.52, z: -0.5, rotY: 1.62, r: 0.55 },   // End of NW cafe street — outdoor kitchen (next to the coffee booth; the stage for the cooking feature)
    { type: 'bonfire', x: -4.35, z: 11.35, rotY: -0.7, r: 0.4 },   // Resort sand island — beach campfire (grilling spot, lit at dusk)
    // Satellite islands: a tree and a lamp at each bridgehead (otherwise open feature ground)
    { type: 'tree',  x: 11.136, z: 2.463, rotY: -0.085, r: 0.45, big: true  },   // NE south clearing (moves with the island delta)
    { type: 'tree',  x: -12.369, z: -3.32,  rotY: 2.9, r: 0.45, big: false },   // Memory Island northwest
    { type: 'lamp', x:  9.28, z:  5.12,  rotY: 0, r: 0.18 },   // NE bridgehead   // (separated from the trampoline zone — toward the bridgehead)
    { type: 'lamp', x: -8.97, z: -5.203, rotY: 0.0, r: 0.18 },   // SW bridgehead
    { type: 'swing', x: 11.7, z: 8.2, rotY: 3.14, r: 0.55 }, // NE island swing — north edge, sea at its back (user-specified: toward the edge)
    { type: 'seesaw', x: 13.15, z: 4.6, rotY: 0, r: 0.62 },  // NE island seesaw — SE zone
    { type: 'trampoline', x: 9.9, z: 3.9, rotY: 0, r: 0 },  // NE island trampoline — r 0 (non-blocking): the mat is walkable ground (world.groundHeightAt hook)
    // Cherry blossom tree (P1 ③): blooms pink in spring with petals drifting — painted by the season system.
    // (construction-mode save ids are per-type ordinals, so new props must be appended at the end of the list)
    { type: 'tree',  x: 1.586, z: -5.57, rotY: 0.115, r: 0.45, big: true, cherry: true },   // Cherry tree — outside the south yard after the ring 3.6 expansion
    // Hug point (P1 ㉕): heart south of the plaza — r 0 = must be standable for the auto-hug to trigger.
    // The monument moved to Memory Island (SW) — our own sanctuary, visited by crossing the bridge.
    { type: 'monument', x: -12.55, z: -5.35, rotY: 1.28, r: 0.38 },   // West side of the island, facing the bridge
    { type: 'hugspot',  x: -0.15, z:  0.95, rotY: 0, r: 0 },   // Heart beside the fountain
    // Memory Island set (P5→moved up ㉒㉓㉔): peck-peck tree (SE) · wishing well (island heart) · time capsule (NE)
    { type: 'pecktree', x: -9.609,  z: -6.876, rotY: 0.4, r: 0.45 },
    { type: 'well',     x: -10.782, z: -4.548, rotY: 0.0,  r: 0.5 },
    { type: 'capsule',  x: -11.05, z: -2.85, rotY: 0.6, r: 0.28 },
    // Adventure Island (stage 0 basic dressing): bridgehead streetlamp + coastal tree + three rocks (hill crag, flat ground, gentle slope)
    { type: 'lamp',    x:  7.53, z: -6.64, rotY: 0,   r: 0.18 },
    { type: 'tree',    x:  9.4,  z: -4.6,  rotY: 1.8, r: 0.45, big: true },
    { type: 'boulder', x:  12.12, z: -8.17, rotY: 0.5, r: 0.5 },
    { type: 'boulder', x:  9.5,   z: -9.6,  rotY: 2.2, r: 0.45 },
    { type: 'boulder', x:  10.82, z: -5.77, rotY: 4.1, r: 0.4 },
    // Cave (Adventure Island stage 1): rock shell over the pocket on the hill's SW face — entrance faces the bridge (SW).
    // Fused with the terrain (flat pad + hill cut), so not movable in construction mode. For colliders, world.js lays
    // a furniture collider per shell rock (r: 0 = walking inside allowed).
    { type: 'cave', x: 9.77, z: -7.12, rotY: -0.88, r: 0 },
    // Lookout deck (Adventure Island stage 2): deck on the hill plateau — the railing gap (entrance) faces the downhill NW.
    // Fused with the hill so not movable, r 0 = walkable on the deck.
    { type: 'lookout', x: 11.12, z: -7.87, rotY: -0.97, r: 0 },
    // Treasure sand patch (Adventure Island stage 4): one of three X spots sparkles each day — dig with ⌘ for an outfit treasure.
    { type: 'digsite', x: 8.52, z: -8.17, rotY: 0.3, r: 0 },
    // Warp portal pair (Adventure Island stage 5): plaza edge ↔ Adventure Island. rotY direction is the exit (step-off side).
    // Routing references the coordinates so not movable, r 0 = non-blocking (you just walk through the ring).
    { type: 'portal', x: 4.98, z: -2.06, rotY: 1.902, r: 0 },   // SE rim (user-specified — toward the edge)
    { type: 'portal', x: 9.3,  z: -6.39, rotY: -0.93, r: 0 },
    // Main island N yard: garden plot (⑫) + street piano at the plaza's NW edge (⑪) + photo bulletin board at the plaza's W edge (⑭)
    // 🚜 Moved to the farm island + expanded to 8 beds (2×4) — the old main island spot had only 1.0m to the rim, so no room to expand (measured).
    // An ISLAND_SIG change auto-discards saved satellite-island prop coordinates, so user saves also snap to the new defaults.
    { type: 'garden',     x: -12.95, z: 4.25,  rotY: 1.87,   r: 1.4 },
    { type: 'scarecrow',  x: -10.6,  z: 5.3,   rotY: -1.99,  r: 0.22 },   // Scarecrow facing the plot
    { type: 'compost',    x: -11.5,  z: 2.0,   rotY: 0.6,    r: 0.3 },    // Compost bin — SE rim
    { type: 'vine', vine: 'tomato',   x: 0.62, z: -2.02, rotY: 0.4,  r: 0.24 },   // 🍅 Tepee stakes at the south yard path entrance
    { type: 'vine', vine: 'eggplant', x: -3.668, z: 2.599, rotY: -0.3, r: 0.24 },   // 🍆 NW yard (road ring 3.6 renewal)
    { type: 'fruitbasket', x: 5.191, z: 1.315, rotY: -0.6, r: 0.24 },               // 🧺 House yard entrance (east rim)
    { type: 'piano',         x: -4.881, z: 2.914, rotY: 2.2,   r: 0.42 },  // Plaza west edge (house-expansion renewal)
    { type: 'photoboard',    x: -3.857, z: 4.222, rotY: 2.685,  r: 0.4 },   // Plaza SW (house-expansion renewal)
    // The last 6 — mailbox (N yard roadside), gym space (NE playground island), library (W yard),
    // fountain (plaza south-edge landmark), flower basket (N yard toggle).
    { type: 'mailbox',       x: 0.882, z: 4.086, rotY: -2.2,  r: 0.2 },   // Mailbox beside the front door (renewal — outside the ring)
    { type: 'gym',           x:  8.9, z:  6.8, rotY: 3.6,   r: 0.8 },   // NE playground island — NW zone
    { type: 'library',       x: -4.99, z: -0.57, rotY: 1.214,   r: 0.65 },
    { type: 'fountain',      x:  0,    z:  0,    rotY: 0,     r: 0.55 },  // Dead center of the plaza — village fountain landmark
    { type: 'flowerbasket',  x: 0.521, z: 4.73, rotY: 1.3,   r: 0.15 },
    // Resort sand island (no bridge — boat/swim only): palms stand at the beach edge (2.0m from center, the band where
    // the ground starts sloping toward the water) and lean seaward — rotY is computed so the trunk curve (+x)
    // faces outward. Sandcastle on the central dune. Not movable (outside MOVABLE_TYPES). Overlap check done.
    { type: 'palm', x: -5.2, z: 12.5, rotY: 2.80,  r: 0.4 },   // Moved to the west shore to make room for the campfire
    { type: 'palm', x: -2.58, z: 13.7,  rotY: -1.25, r: 0.4 },
    { type: 'palm', x: -1.4,  z: 10.92, rotY: 0.46,  r: 0.4 },
    { type: 'palm', x: -4.08, z: 13.6,  rotY: -2.03, r: 0.4 },
    { type: 'sandcastle', x: -2.75, z: 11.95, rotY: 0.9, r: 0.38 },   // Moved east to make room for the campfire
    { type: 'pierboard', x: 1.4, z: 5.2, rotY: -2.88, r: 0.22 },   // 🛒 Ferry order board — east of the main island north pier, facing the village
    { type: 'fishchair', x: -1.9, z: 5.35, rotY: -0.341, r: 0 },
    { type: 'melonpatch', x: -10.05, z: 4.25, rotY: 0.9, r: 0.35 },
    { type: 'ringnest', x: -11.15, z: -6.0, rotY: -1.14, r: 0.45 },   // 💍 BFF ring nest — Memory Island, facing the monument (4.5 wishlist #1)
    { type: 'chickgarden', x: -3.1,  z: -14.2,  rotY: 0.0,  r: 0 },     // 🌸 Flower bed + sign — anchor on the south slope (spacing rule with the bench), free to walk through (4.5 wish #2)
    { type: 'gardenbench', x: -3.1,  z: -12.8,  rotY: 3.14, r: 0.35 },   // Hilltop bench — faces the southern sea (0.95 wide)
    { type: 'fence', x: -0.89, z: -13.88, rotY: 3.42,  r: 0.5 },         // Meadow fence E
    { type: 'fence', x: -5.31, z: -13.88, rotY: -0.28, r: 0.5 },         // Meadow fence W
    { type: 'fence', x: -1.63, z: -11.34, rotY: 1.80,  r: 0.5 },         // Meadow gate fence — east side of the bridge entrance
    { type: 'fence', x: -3.57, z: -10.88, rotY: 1.80,  r: 0.5 },         // Meadow gate fence — west side of the bridge entrance   // 🍉 Farm island field ridge — the watermelon the chick wished for (between garden plot and scarecrow)    // 🪑 The chick's little fishing chair — fulfills the puppy's morning-comment wish (10/16). North shore waterside, facing the sea. r=0 (a seat, so passage allowed)
];
