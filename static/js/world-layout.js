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
    { x: 8.2,   z: 4.18,  r: 2.2 },      // NE island — 놀이터 (그네·시소)
    { x: -8.06, z: -3.53, r: 2.9 },      // SW island — 추억의 섬 (기념비·쪼아쪼아나무·소원우물·타임캡슐)
    { x: 7.9,   z: -5.6,  r: 3.5 },      // SE island — 모험의 섬 (언덕·동굴·전망대·보물 모래밭), 위성 중 최대
];
// 주의: buildRoute가 BRIDGES[섬 인덱스-1]로 다리를 찾는다 — 다리 순서는 위 위성섬 순서와 같아야 한다.
export const BRIDGES = [
    { A: { x: 4.41,  z: 2.25 },  B: { x: 6.46,  z: 3.30 },  inner: { x: 4.10,  z: 2.09 },  outer: { x: 6.73,  z: 3.43 } },
    { A: { x: -4.53, z: -1.99 }, B: { x: -6.46, z: -2.83 }, inner: { x: -4.21, z: -1.84 }, outer: { x: -6.73, z: -2.95 } },
    { A: { x: 4.04,  z: -2.86 }, B: { x: 5.59,  z: -3.96 }, inner: { x: 3.75,  z: -2.65 }, outer: { x: 5.83,  z: -4.13 } },
];

// 언덕 (HILLS): terrainHeight에 더해지는 고원형 봉우리 — 정상부(반경 35%)는 평평해서 데크를
// 얹을 수 있고, 사면은 펫이 그냥 걸어 오른다. FLAT_SPOTS 패드가 언덕도 눌러서(동굴 포켓)
// 언덕 남서면에 자연스러운 절개 벽이 생긴다.
export const HILLS = [
    { x: 8.9, z: -6.3, r: 2.6, h: 1.1 },   // 모험의 섬 언덕 — 위에 전망대, 서남면에 동굴
];

// 복층집 (two-story house) anchor — the walk-space helpers in world.js (floor/loft/stairs/walls)
// derive everything from this one entry.
export const HOUSE = { x: 2.7, z: 2.05, rotY: -0.65, hw: 1.0, hd: 0.8, floorY: 0.05, loftY: 0.62 };

// Terrain flattening pads — the rolling bumps settle flat inside these circles.
// `follow`: 공사모드로 그 프롭이 이사가면 패드도 다음 로드부터 따라가는 연결 (world.js가 시작 시 동기화).
export const FLAT_SPOTS = [
    { x: 0.0, z: 0.0, r: 1.7 },     // central plaza (hug point / monument to come)
    { x: 2.7, z: 2.05, r: 1.7, follow: 'house-1' },    // house pad (two-story house needs a wide level base)
    { x: -2.6, z: -2.9, r: 0.95 },  // pond basin (연못은 이동 불가 — 지형 함몰)
    { x: 8.2, z: 4.85, r: 1.0, follow: 'swing-1' },    // NE island swing pad (level ground under the A-frame legs)
    { x: 9.3, z: 4.0, r: 1.0, follow: 'seesaw-1' },    // NE island seesaw pad (level ground under the fulcrum + plank)
    { x: -8.06, z: -3.53, r: 1.55 },   // 추억의 섬 중앙 뜰 — 기념비·소원우물·타임캡슐이 반듯하게 선다
    { x: 7.55, z: -5.55, r: 1.15 },    // 모험의 섬 동굴 포켓 — 언덕 남서면을 파서 만든 평탄 바닥
];

// Props: type + position + blocking radius (`r` is the circle collider pets steer around; the
// pond blocks too — pets shouldn't wade). The bowl doubles as the Eat-motion spot.
// Kit hook (currently unused — the Kenney pilot was reverted, procedural look won): a tree/rock
// entry may carry `variant` (GLB name under /models/world-kit) + `kitScale`; world-kit.js loads
// it with the procedural builder as fallback.
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
    { type: 'tree',  x: -9.3,  z: -2.55, rotY: 2.9, r: 0.45, big: false },   // 추억의 섬 북서로 물러남 — 가운데 뜰을 비워줌
    { type: 'lamp', x:  6.97, z:  3.05, rotY: 0, r: 0.18 },
    { type: 'lamp', x: -6.60, z: -3.38, rotY: 0, r: 0.18 },
    { type: 'swing', x: 8.2, z: 4.85, rotY: 3.14, r: 0.55 },   // NE 섬 그네 (2인 A자, 앞자리 섬 안쪽 향함)
    { type: 'seesaw', x: 9.3, z: 4.0, rotY: 0, r: 0.62 },      // NE 섬 시소 (플랭크 남북 방향, 양끝 마주봄)
    // 벚꽃나무 (P1 ③): 봄에 분홍으로 만개하고 꽃잎이 흩날린다 — 계절 시스템이 칠한다.
    // (공사 모드 저장 id가 타입별 순번이라 새 프롭은 반드시 목록 끝에 추가)
    { type: 'tree',  x:  1.35, z: -3.5, rotY: 0.9, r: 0.45, big: true, cherry: true },
    // 포옹 포인트 (P1 ㉕): 광장 남쪽 하트 — r 0 = 밟고 설 수 있어야 자동 포옹이 발동한다.
    // 기념비는 추억의 섬(SW)으로 이사 — 다리를 건너 만나러 가는 우리만의 성지.
    { type: 'monument', x: -9.35, z: -3.75, rotY: 1.28, r: 0.38 },   // 섬 서쪽, 다리 쪽을 바라봄
    { type: 'hugspot',  x: -0.15, z:  0.7,  rotY: 0, r: 0 },
    // 추억의 섬 세트 (P5→앞당김 ㉒㉓㉔): 쪼아쪼아나무(남동) · 소원우물(섬 심장) · 타임캡슐(북동 언덕가)
    { type: 'pecktree', x: -7.3,  z: -4.55, rotY: 0.4, r: 0.45 },
    { type: 'well',     x: -8.15, z: -3.35, rotY: 0,   r: 0.5 },
    { type: 'capsule',  x: -8.55, z: -2.25, rotY: 0.6, r: 0.28 },
    // 모험의 섬 (0단계 기본 드레싱): 다리목 가로등 + 해안 나무 + 바위 셋 (언덕 크래그·평지·완사면)
    { type: 'lamp',    x:  5.55, z: -4.5,  rotY: 0,   r: 0.18 },
    { type: 'tree',    x:  9.3,  z: -4.4,  rotY: 1.8, r: 0.45, big: true },
    { type: 'boulder', x:  9.9,  z: -6.6,  rotY: 0.5, r: 0.5 },
    { type: 'boulder', x:  6.2,  z: -6.9,  rotY: 2.2, r: 0.45 },
    { type: 'boulder', x:  8.6,  z: -4.2,  rotY: 4.1, r: 0.4 },
    // 동굴 (모험의 섬 1단계): 언덕 남서면 포켓 위 바위 셸 — 입구가 다리 쪽(남서)을 본다.
    // 지형(평탄 패드+언덕 절개)과 한 몸이라 공사 모드 이동 불가. 콜라이더는 world.js가 셸
    // 바위별로 가구 콜라이더를 깐다 (r: 0 = 내부 걷기 허용).
    { type: 'cave', x: 7.55, z: -5.55, rotY: -0.88, r: 0 },
];
