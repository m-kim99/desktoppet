// World layout data (월드 배치 데이터) — the single place that says WHERE everything is.
// world.js owns the HOW (terrain math, prop builders, behaviors); this file owns the WHAT/WHERE,
// so growing the world is a data edit, not an engine edit:
//   · new land     → add an ISLANDS circle (+ a BRIDGES entry so it can be reached)
//   · new prop     → add a PROPS line (its `type` must exist in world.js PROP_BUILDERS;
//                    optional rotY / scale / variant — `r` is the walk-blocking radius, 0 = walkable)
//   · level ground → add a FLAT_SPOTS circle (flat pads under buildings, ponds, plazas)
// Positions are in world units: a pet stands ~0.4–0.5 tall, the main island radius is 6.2.
// ⚠️ 좌표를 추가/변경하면 반드시 겹침·섬이탈·도로침범 전수검사(layout-sweep 패턴)를 돌릴 것.

export const ISLAND_R = 6.2;   // 5.6→6.2: 배치 리뉴얼 — 점유율을 낮춰 동선(통로 여유 0.5m+)을 확보
// Archipelago: the main island plus three satellites reached over wooden bridges. Every land query
// (terrain height, blocking, bridge decks) goes through the helpers in world.js, so pets, the
// player, particles and roads all agree on what counts as ground.
// 배치 리뉴얼(2026-07): 위성섬을 본섬에서 2.5~2.7m 간격으로 밀어냄 — "붙은 혹"이 아니라
// 다리를 건너 가는 진짜 목적지가 되도록. 방위각은 유지(델타 이동), SWIM_LEASH 18 안쪽.
export const ISLANDS = [
    { x: 0,      z: 0,     r: ISLAND_R },
    { x: 11.23,  z: 5.73,  r: 3.8 },     // NE island — 놀이터 (그네·시소·운동·트램펄린), r 3.2→3.8 + 방위각 유지 델타(+0.54,+0.28)로 간격 2.6m 유지
    { x: -10.72, z: -4.69, r: 2.9 },     // SW island — 추억의 섬 (기념비·쪼아쪼아나무·소원우물·타임캡슐), 간격 2.6m
    { x: 10.12,  z: -7.17, r: 3.5 },     // SE island — 모험의 섬 (언덕·동굴·전망대·보물 모래밭), 간격 2.7m
    // 휴양지 모래섬 — 다리 없음(보트/수영으로만): kind:'sand'가 지면 텍스처·해변 경사·발소리를
    // 가른다. buildRouteWalk는 다리 없는 섬에서 직선 폴백(가드 있음) — AI 배회는 여길 목표로 안 잡는다.
    { x: -3.2,   z: 11.8,  r: 2.6, kind: 'sand' },   // 본섬 확장 후 간격 3.4m
];
// 주의: buildRoute가 BRIDGES[섬 인덱스-1]로 다리를 찾는다 — 다리 순서는 위 위성섬 순서와 같아야 한다.
// 공식(섬 중심선 방사축): A = u·(본섬R−0.5), B = 위성중심 − u·(위성R−0.5), inner = A−0.4u, outer = B+0.4u
export const BRIDGES = [
    { A: { x: 5.08,  z: 2.59 },  B: { x: 8.29,  z: 4.23 },  inner: { x: 4.72,  z: 2.41 },  outer: { x: 8.65,  z: 4.41 } },
    { A: { x: -5.22, z: -2.29 }, B: { x: -8.52, z: -3.73 }, inner: { x: -4.86, z: -2.13 }, outer: { x: -8.89, z: -3.89 } },
    { A: { x: 4.65,  z: -3.30 }, B: { x: 7.67,  z: -5.44 }, inner: { x: 4.32,  z: -3.06 }, outer: { x: 7.99,  z: -5.67 } },
];

// ⛴️ 페리 항로 데이터 — 잔교 2곳(A=뭍쪽, B=바다쪽 끝. world.js가 다리 문법으로 보행 데크化)과
// 외해 경유 링(전 군도 바깥 순환, 다리 밑 통과 불가라 위성섬 사이 corridor는 못 씀 — 본섬↔모래섬
// 사이만 다리 없는 물길). 새 섬을 추가하면: 항로 생성이 ISLANDS를 읽어 자동 회피, 정차시키고
// 싶으면 잔교+링 포인트만 추가. 좌표 변경 시 스윕이 링 유효성(섬 간섭)을 검사한다.
export const FERRY_PIERS = [
    { A: { x: 0.1,   z: 5.98 },  B: { x: 0.35, z: 7.85 } },    // 본섬 북 잔교 (허브)
    { A: { x: -1.55, z: 12.6 },  B: { x: 0.0,  z: 13.15 } },   // 휴양지 모래섬 동 잔교
];
export const FERRY_SEA_POINTS = [   // 외해 링 (시계방향) — 전부 열린 물, 수평선 경계 19.6 안.
    // 첫 점은 모래섬 정박 후 북동으로 크게 도는 턴 부표 (섬 북면 야자수 위를 안 가로지르게)
    { x: -1.5, z: 16.5 }, { x: -4.5, z: 16 }, { x: -11, z: 12 }, { x: -16, z: 2 }, { x: -14.5, z: -11 },
    { x: 0, z: -14.5 }, { x: 13, z: -13 }, { x: 18, z: -4 }, { x: 16, z: 1.5 }, { x: 17, z: 8 }, { x: 7, z: 14 },
];

// 언덕 (HILLS): terrainHeight에 더해지는 고원형 봉우리 — 정상부(반경 35%)는 평평해서 데크를
// 얹을 수 있고, 사면은 펫이 그냥 걸어 오른다. FLAT_SPOTS 패드가 언덕도 눌러서(동굴 포켓)
// 언덕 남서면에 자연스러운 절개 벽이 생긴다.
export const HILLS = [
    { x: 11.12, z: -7.87, r: 2.6, h: 1.1 },   // 모험의 섬 언덕 — 위에 전망대, 서남면에 동굴 (섬 이동 델타 동반)
];

// 복층집 (two-story house) anchor — the walk-space helpers in world.js (floor/loft/stairs/walls)
// derive everything from this one entry. hw/hd/loftY를 바꾸면 world.js의 houseFloorY/houseBlocked
// 하드 로컬 상수(계단 구간·다락 모서리·난간 띠·포치 기둥)와 makeHouse 지오메트리도 함께 맞출 것.
export const HOUSE = { x: 2.7, z: 2.05, rotY: -0.65, hw: 1.3, hd: 1.04, floorY: 0.05, loftY: 0.78 };   // 리모델: 1.0×0.8 → 1.3×1.04, 다락 0.62→0.78

// Terrain flattening pads — the rolling bumps settle flat inside these circles.
// `follow`: 공사모드로 그 프롭이 이사가면 패드도 다음 로드부터 따라가는 연결 (world.js가 시작 시 동기화).
export const FLAT_SPOTS = [
    { x: 0.0, z: 0.0, r: 1.7 },     // central plaza (hug point / monument to come)
    { x: 2.7, z: 2.05, r: 2.05, follow: 'house-1' },   // house pad — 리모델로 커진 집 + 앞마당 여유 (1.7→2.05)
    { x: -2.6, z: -2.9, r: 0.95 },  // pond basin (연못은 이동 불가 — 지형 함몰)
    { x: 11.59, z: 6.58, r: 1.0, follow: 'swing-1' },   // NE island swing pad (level ground under the A-frame legs)
    { x: 12.71, z: 5.05, r: 1.0, follow: 'seesaw-1' }, // NE island seesaw pad (level ground under the fulcrum + plank)
    { x: 9.16, z: 6.79, r: 1.15, follow: 'gym-1' },    // NE island gym pad — 매트/아령이 구릉에 뚫리지 않게 (그네·시소 패드와 같은 원리)
    { x: 9.9, z: 3.9, r: 1.1, follow: 'trampoline-1' },  // NE island trampoline pad — 확장된 남쪽 새 공간
    { x: -10.72, z: -4.69, r: 1.55 },  // 추억의 섬 중앙 뜰 — 기념비·소원우물·타임캡슐이 반듯하게 선다
    { x: 9.77, z: -7.12, r: 1.15 },    // 모험의 섬 동굴 포켓 — 언덕 남서면을 파서 만든 평탄 바닥
    { x: -3.3, z: 11.6, r: 0.6 },      // 휴양지 섬 모래성 받침 — 사구 굴곡 위에 반듯하게
];

// Props: type + position + blocking radius (`r` is the circle collider pets steer around; the
// pond blocks too — pets shouldn't wade). The bowl doubles as the Eat-motion spot.
// Kit hook (currently unused — the Kenney pilot was reverted, procedural look won): a tree/rock
// entry may carry `variant` (GLB name under /models/world-kit) + `kitScale`; world-kit.js loads
// it with the procedural builder as fallback.
// 배치 리뉴얼(2026-07, 본섬 r6.2) — 존닝: 광장(중앙 — 스트리트 피아노·게시판·분수가 가장자리를
// 두른다) · 집 마당(NE: 집+밥그릇+라디오) · N 뜰(텃밭·우체통·꽃바구니) · NW 카페 거리(커피·간식)
// · W 뜰(도서관·울타리) · S 쉼터(해먹) · E 쉼터(선베드·포탈). 어떤 두 소품도 통로 여유 0.5m+,
// 도로 리본 침범 금지. 순서는 layoutId(타입-순번)와 1:1 — 절대 재배열 금지, 새 프롭은 목록 끝에.
export const PROPS = [
    { type: 'tree',  x: -2.12, z: -4.99, rotY: 0.0,  r: 0.45, big: true  },   // S 림 나무 (연못 남쪽)
    { type: 'tree',  x:  2.55, z: -4.4,  rotY: 2.1,  r: 0.45, big: false },   // S 초원 나무 (클럼프 왼쪽)
    { type: 'tree',  x:  2.05, z:  5.2,  rotY: 4.2,  r: 0.45, big: true  },   // N 림 나무
    { type: 'tree',  x:  3.75, z: -4.15, rotY: 1.3,  r: 0.45, big: false },   // S 초원 나무 (클럼프 오른쪽 — 둘이 숲 무리)
    { type: 'house', x:  2.7, z:  2.05, rotY: -0.65, r: 0 },   // walls/rooms block precisely (houseBlocked)
    { type: 'bowl',  x:  0.95, z:  1.62, rotY: 0.0,  r: 0.28 },   // 집 앞마당 밥그릇 (Eat 스팟)
    { type: 'fence', x: -5.13, z:  1.52, rotY: 1.05, r: 0.5 },    // W 림 울타리 조각
    { type: 'pond',  x: -2.6, z: -2.9, rotY: 0.0,  r: 0.72 },
    { type: 'sunbed',  x:  5.53, z: -0.4,  rotY: -1.35, r: 0.42 },   // E 물가 쉼터
    { type: 'hammock', x: -0.19, z: -5.4,  rotY: 0.35,  r: 0.55 },   // S 림 쉼터
    { type: 'lamp', x:  1.30, z:  3.09, rotY: 0, r: 0.18 },
    { type: 'lamp', x:  3.34, z:  0.24, rotY: 0, r: 0.18 },
    { type: 'lamp', x:  2.00, z: -2.68, rotY: 0, r: 0.18 },
    { type: 'lamp', x: -1.05, z: -3.30, rotY: 0, r: 0.18 },
    { type: 'lamp', x: -3.33, z: -0.37, rotY: 0, r: 0.18 },
    { type: 'lamp', x: -1.85, z:  2.79, rotY: 0, r: 0.18 },
    { type: 'radio', x: 2.2, z: 0.63, rotY: 2.6, r: 0.24 },    // 집 마당 코너 라디오 (Ctrl/⌘로 재생)
    { type: 'coffee', x: -3.35, z: 2.18, rotY: 2.2, r: 0.5 },  // NW 카페 거리 — 커피 부스 (Ctrl/⌘로 주문)
    { type: 'food', x: -3.11, z: 3.98, rotY: 2.73, r: 0.5 },   // NW 카페 거리 — 간식 부스 (Ctrl/⌘로 주문)
    // Satellite islands: a tree and a lamp at each bridgehead (otherwise open feature ground)
    { type: 'tree',  x:  11.73, z:  3.56, rotY: 0.7, r: 0.45, big: true  },   // NE 남쪽 공터 (섬 델타 동반)
    { type: 'tree',  x: -12.35, z: -3.6,  rotY: 2.9, r: 0.45, big: false },   // 추억의 섬 북서
    { type: 'lamp', x:  9.35, z:  5.05,  rotY: 0, r: 0.18 },   // NE 다리목   // (트램펄린 존과 분리 — 다리목 쪽으로)
    { type: 'lamp', x: -9.42, z: -4.82, rotY: 0, r: 0.18 },   // SW 다리목
    { type: 'swing', x: 11.59, z: 6.58, rotY: 3.14, r: 0.55 }, // NE 섬 그네 (2인 A자, 앞자리 섬 안쪽 향함)
    { type: 'seesaw', x: 12.71, z: 5.05, rotY: 0, r: 0.62 },  // NE 섬 시소 (플랭크 남북 방향, 양끝 마주봄)
    { type: 'trampoline', x: 9.9, z: 3.9, rotY: 0, r: 0 },  // NE 섬 트램펄린 — r 0(비차단): 매트는 걸어 올라가는 지면(world.groundHeightAt 훅)
    // 벚꽃나무 (P1 ③): 봄에 분홍으로 만개하고 꽃잎이 흩날린다 — 계절 시스템이 칠한다.
    // (공사 모드 저장 id가 타입별 순번이라 새 프롭은 반드시 목록 끝에 추가)
    { type: 'tree',  x:  1.35, z: -3.5, rotY: 0.9, r: 0.45, big: true, cherry: true },
    // 포옹 포인트 (P1 ㉕): 광장 남쪽 하트 — r 0 = 밟고 설 수 있어야 자동 포옹이 발동한다.
    // 기념비는 추억의 섬(SW)으로 이사 — 다리를 건너 만나러 가는 우리만의 성지.
    { type: 'monument', x: -12.55, z: -5.35, rotY: 1.28, r: 0.38 },   // 섬 서쪽, 다리 쪽을 바라봄
    { type: 'hugspot',  x: -0.15, z:  0.95, rotY: 0, r: 0 },   // 분수 곁 하트
    // 추억의 섬 세트 (P5→앞당김 ㉒㉓㉔): 쪼아쪼아나무(남동) · 소원우물(섬 심장) · 타임캡슐(북동)
    { type: 'pecktree', x: -9.7,  z: -6.05, rotY: 0.4, r: 0.45 },
    { type: 'well',     x: -10.81, z: -4.51, rotY: 0,  r: 0.5 },
    { type: 'capsule',  x: -11.05, z: -2.85, rotY: 0.6, r: 0.28 },
    // 모험의 섬 (0단계 기본 드레싱): 다리목 가로등 + 해안 나무 + 바위 셋 (언덕 크래그·평지·완사면)
    { type: 'lamp',    x:  7.53, z: -6.64, rotY: 0,   r: 0.18 },
    { type: 'tree',    x:  9.4,  z: -4.6,  rotY: 1.8, r: 0.45, big: true },
    { type: 'boulder', x:  12.12, z: -8.17, rotY: 0.5, r: 0.5 },
    { type: 'boulder', x:  9.5,   z: -9.6,  rotY: 2.2, r: 0.45 },
    { type: 'boulder', x:  10.82, z: -5.77, rotY: 4.1, r: 0.4 },
    // 동굴 (모험의 섬 1단계): 언덕 남서면 포켓 위 바위 셸 — 입구가 다리 쪽(남서)을 본다.
    // 지형(평탄 패드+언덕 절개)과 한 몸이라 공사 모드 이동 불가. 콜라이더는 world.js가 셸
    // 바위별로 가구 콜라이더를 깐다 (r: 0 = 내부 걷기 허용).
    { type: 'cave', x: 9.77, z: -7.12, rotY: -0.88, r: 0 },
    // 전망대 (모험의 섬 2단계): 언덕 고원 위 데크 — 난간 갭(입구)이 내리막 북서쪽을 본다.
    // 언덕과 한 몸이라 이동 불가, r 0 = 데크 위를 걷는다.
    { type: 'lookout', x: 11.12, z: -7.87, rotY: -0.97, r: 0 },
    // 보물 모래밭 (모험의 섬 4단계): X 셋 중 매일 한 곳이 반짝인다 — ⌘로 파면 코디 보물.
    { type: 'digsite', x: 8.52, z: -8.17, rotY: 0.3, r: 0 },
    // 워프 포탈 한 쌍 (모험의 섬 5단계): 광장가 ↔ 모험의 섬. rotY 방향이 출구(내려서는 쪽).
    // 라우팅이 좌표를 참조하므로 이동 불가, r 0 = 비차단 (링을 그냥 지나 걷는다).
    { type: 'portal', x: 4.3,  z: -1.5,  rotY: -1.24, r: 0 },
    { type: 'portal', x: 9.3,  z: -6.39, rotY: -0.93, r: 0 },
    // 본섬 N 뜰: 텃밭(⑫) + 광장 북서가 스트리트 피아노(⑪) + 광장 서가 사진 게시판(⑭)
    { type: 'garden',     x: -1.11, z: 4.88, rotY: 0.55,  r: 0.72 },
    { type: 'piano',      x: -0.61, z: 1.95, rotY: 2.6,   r: 0.4 },
    { type: 'photoboard', x: -1.95, z: -0.73, rotY: 1.21, r: 0.42 },   // 커뮤니티 보드 — 광장을 본다
    // 마지막 6종 — 우체통(N 뜰 길가)·운동 공간(NE 놀이터 섬)·도서관(W 뜰)·
    // 분수(광장 남가 랜드마크)·꽃바구니(N 뜰 토글).
    { type: 'mailbox',      x:  0.38, z:  3.9,  rotY: -3.04, r: 0.15 },
    { type: 'gym',           x:  9.16, z:  6.79, rotY: 3.6,   r: 0.8 },   // NE 놀이터 섬 — 그네·시소와 한 존
    { type: 'library',       x: -4.99, z: -0.57, rotY: 2.0,   r: 0.65 },
    { type: 'fountain',      x:  0,    z:  0,    rotY: 0,     r: 0.55 },  // 광장 정중앙 — 마을 분수 랜드마크
    { type: 'flowerbasket',  x:  0.85, z:  4.83, rotY: 1.3,   r: 0.15 },
    // 휴양지 모래섬 (다리 없음 — 보트/수영 전용): 야자수는 해변 가장자리(중심에서 2.0m, 지면이
    // 물 쪽으로 내려가기 시작하는 띠)에 서서 바다로 기운다 — rotY는 트렁크 커브(+x)가 바깥을
    // 보도록 계산한 값. 모래성은 중앙 사구. 이동 불가(MOVABLE_TYPES 밖). 겹침 검산 완료.
    { type: 'palm', x: -5.08, z: 11.12, rotY: 2.80,  r: 0.4 },
    { type: 'palm', x: -2.58, z: 13.7,  rotY: -1.25, r: 0.4 },
    { type: 'palm', x: -1.4,  z: 10.92, rotY: 0.46,  r: 0.4 },
    { type: 'palm', x: -4.08, z: 13.6,  rotY: -2.03, r: 0.4 },
    { type: 'sandcastle', x: -3.3, z: 11.6, rotY: 0.9, r: 0.38 },
];
