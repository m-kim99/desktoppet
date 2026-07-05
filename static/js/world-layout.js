// World layout data (월드 배치 데이터) — the single place that says WHERE everything is.
// world.js owns the HOW (terrain math, prop builders, behaviors); this file owns the WHAT/WHERE,
// so growing the world is a data edit, not an engine edit:
//   · new land     → add an ISLANDS circle (+ a BRIDGES entry so it can be reached)
//   · new prop     → add a PROPS line (its `type` must exist in world.js PROP_BUILDERS;
//                    optional rotY / scale / variant — `r` is the walk-blocking radius, 0 = walkable)
//   · level ground → add a FLAT_SPOTS circle (flat pads under buildings, ponds, plazas)
// Positions are in world units: a pet stands ~0.4–0.5 tall, the main island radius is 5.2.

export const ISLAND_R = 5.2;
// Archipelago: the main island plus two satellites reached over wooden bridges. Every land query
// (terrain height, blocking, bridge decks) goes through the helpers in world.js, so pets, the
// player, particles and roads all agree on what counts as ground.
export const ISLANDS = [
    { x: 0,     z: 0,     r: ISLAND_R },
    { x: 8.2,   z: 4.18,  r: 2.2 },      // NE island — open ground for future features
    { x: -8.06, z: -3.53, r: 2.0 },      // SW island
];
export const BRIDGES = [
    { A: { x: 4.41,  z: 2.25 },  B: { x: 6.46,  z: 3.30 },  inner: { x: 4.10,  z: 2.09 },  outer: { x: 6.73,  z: 3.43 } },
    { A: { x: -4.53, z: -1.99 }, B: { x: -6.46, z: -2.83 }, inner: { x: -4.21, z: -1.84 }, outer: { x: -6.73, z: -2.95 } },
];

// 복층집 (two-story house) anchor — the walk-space helpers in world.js (floor/loft/stairs/walls)
// derive everything from this one entry.
export const HOUSE = { x: 2.7, z: 2.05, rotY: -0.65, hw: 1.0, hd: 0.8, floorY: 0.05, loftY: 0.62 };

// Terrain flattening pads — the rolling bumps settle flat inside these circles.
export const FLAT_SPOTS = [
    { x: 0.0, z: 0.0, r: 1.7 },     // central plaza (hug point / monument to come)
    { x: 2.7, z: 2.05, r: 1.7 },    // house pad (two-story house needs a wide level base)
    { x: -2.6, z: -2.9, r: 0.95 },  // pond basin
];

// Props: type + position + blocking radius (`r` is the circle collider pets steer around; the
// pond blocks too — pets shouldn't wade). The bowl doubles as the Eat-motion spot.
// Zoned layout on the bigger island: NE = house yard (+bowl), E = rest area (sunbed), S = hammock
// nook, SW = pond, W = fence lawn, plus four trees spread around. The center stays an open plaza
// (hug point / monument land later) and the N/NW meadows are reserved for future features
// (텃밭·커피 스탠드·도서관·전망대). Six lamps line the loop road.
export const PROPS = [
    { type: 'tree',  x: -3.4, z: -1.9, rotY: 0.0,  r: 0.45, big: true  },
    { type: 'tree',  x:  3.6, z: -2.6, rotY: 2.1,  r: 0.45, big: false },
    { type: 'tree',  x: -1.2, z:  3.7, rotY: 4.2,  r: 0.45, big: true  },
    { type: 'tree',  x:  4.1, z:  1.0, rotY: 1.3,  r: 0.45, big: false },
    { type: 'house', x:  2.7, z:  2.05, rotY: -0.65, r: 0 },   // walls/rooms block precisely (houseBlocked)
    { type: 'bowl',  x:  1.15, z:  1.75, rotY: 0.0,  r: 0.28 },
    { type: 'fence', x: -4.1, z:  0.9, rotY: 1.05, r: 0.5 },
    { type: 'pond',  x: -2.6, z: -2.9, rotY: 0.0,  r: 0.72 },
    { type: 'sunbed',  x:  4.05, z: -0.4,  rotY: -1.35, r: 0.42 },
    { type: 'hammock', x: -0.9,  z: -4.15, rotY: 0.35,  r: 0.55 },
    { type: 'lamp', x:  1.30, z:  3.09, rotY: 0, r: 0.18 },
    { type: 'lamp', x:  3.34, z:  0.24, rotY: 0, r: 0.18 },
    { type: 'lamp', x:  2.00, z: -2.68, rotY: 0, r: 0.18 },
    { type: 'lamp', x: -1.48, z: -3.00, rotY: 0, r: 0.18 },
    { type: 'lamp', x: -3.33, z: -0.37, rotY: 0, r: 0.18 },
    { type: 'lamp', x: -1.85, z:  2.79, rotY: 0, r: 0.18 },
    { type: 'radio', x: 0.35, z: 1.55, rotY: 2.6, r: 0.24 },   // plaza-edge radio (Ctrl/⌘로 재생)
    { type: 'coffee', x: -1.5, z: 1.1, rotY: 2.2, r: 0.5 },    // 커피 부스 (Ctrl/⌘로 주문)
    { type: 'food', x: -0.85, z: 1.95, rotY: 2.73, r: 0.5 },   // 간식 부스 (Ctrl/⌘로 주문)
    // Satellite islands: a tree and a lamp at each bridgehead (otherwise open feature ground)
    { type: 'tree',  x:  8.7,  z:  3.78, rotY: 0.7, r: 0.45, big: true  },
    { type: 'tree',  x: -8.4,  z: -3.0,  rotY: 2.9, r: 0.45, big: false },
    { type: 'lamp', x:  6.97, z:  3.05, rotY: 0, r: 0.18 },
    { type: 'lamp', x: -6.60, z: -3.38, rotY: 0, r: 0.18 },
];
