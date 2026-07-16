// Pet world (월드): a small diorama scene where the GLB pets live together, opened from the tray.
// A floating grass-island stage with primitive props (data-driven so an asset kit can replace them),
// an orbit camera, and the `world` ground/blocking interface the pets query — they never assume
// flat/open ground, so later phases can swap in a heightmap (3rd-person) or voxels (sandbox).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createGlbPetEntity, updateGlbPetEntity, GLB_MOTIONS, GLB_ACCESSORIES, setGlbPetAccessory } from './glb-pet-entity.js';
import { ISLAND_R, ISLANDS, BRIDGES, HILLS, HOUSE, FLAT_SPOTS, PROPS, FERRY_PIERS, FERRY_SEA_POINTS } from './world-layout.js';
import { kitProp } from './world-kit.js';

// ---- 🔨 공사모드 저장 레이아웃: 씬을 짓기 "전에" PROPS/HOUSE/FLAT_SPOTS에 덮어쓴다. 지형 패드·
// 침대 좌표·블롭 그림자·집 내부가 전부 빌드 시점의 p.x/z에서 파생되므로, 여기서 바꿔두면 아래의
// 모든 빌더가 저절로 새 위치 기준으로 굽는다. 저장은 서버(/api/world_layout — 폰·데스크톱 공유)
// 우선, 없으면(정적 서버 등) localStorage 폴백. id는 "타입-등장순번"(tree-1, lamp-3…) — 같은
// 타입의 새 프롭은 world-layout.js 목록의 끝에 추가해야 저장된 배치가 어긋나지 않는다.
const savedLayout = await (async () => {
    try {
        const r = await fetch('/api/world_layout', { signal: AbortSignal.timeout(1500) });
        if (r.ok) {
            const j = await r.json();
            if (j && j.layout && typeof j.layout === 'object') return j.layout;
        }
    } catch (err) {}
    try { return JSON.parse(localStorage.getItem('world-layout')) || {}; } catch (err) { return {}; }
})();
// 이동 가능한 타입 (연못=지형 함몰이라 고정, furniture=집 내부 파생이라 집을 따라감)
const MOVABLE_TYPES = new Set(['tree', 'bowl', 'fence', 'sunbed', 'hammock', 'lamp', 'radio', 'coffee', 'food', 'swing', 'seesaw', 'house', 'monument', 'hugspot', 'pecktree', 'well', 'capsule', 'boulder', 'garden', 'piano', 'photoboard', 'mailbox', 'gym', 'library', 'flowerbasket']);
// 섬 정의 지문 — 섬을 옮기거나 크기를 바꾸면 값이 달라진다(재발 방지: 저장 배치의 "섬 이사" 자동 감지).
const ISLAND_SIG = ISLANDS.map((i) => `${i.x},${i.z},${i.r}`).join('|');
{
    const counts = {};
    // 저장본 지문이 현재와 다르면 위성섬이 이사/확장된 것 — 그 섬 프롭의 옛 저장 좌표는 버리고 base로.
    const islandsChanged = savedLayout._sig !== undefined && savedLayout._sig !== ISLAND_SIG;
    for (const p of PROPS) {
        p.layoutId = `${p.type}-${counts[p.type] = (counts[p.type] || 0) + 1}`;
        p.def = { x: p.x, z: p.z, rotY: p.rotY || 0 };            // "전부 원위치"용 원본 좌표
        let o = MOVABLE_TYPES.has(p.type) ? savedLayout[p.layoutId] : null;
        // ① 섬이 바뀌었고 이 프롭의 홈 섬(base 기준)이 위성섬(≥1)이면 옛 저장값 폐기 → base 정위치로 스냅
        //    (섬이 통째로 이사가면 옛 절대좌표는 무의미 — world-layout.js에서 함께 옮긴 base가 정답)
        if (o && islandsChanged && islandOf(p.def.x, p.def.z) >= 1) { o = null; delete savedLayout[p.layoutId]; }
        // ② 옛 저장 좌표가 물 위에 고립됐으면 버리고 새 기본 위치로 — islandOf(r−0.3 마진)·다리 위만 유효한 뭍.
        if (o && Number.isFinite(o.x) && Number.isFinite(o.z) && (islandOf(o.x, o.z) >= 0 || onBridge(o.x, o.z))) {
            p.x = o.x; p.z = o.z;
            if (Number.isFinite(o.rotY)) p.rotY = o.rotY;
        }
    }
    // 지문이 없거나(첫 로드) 달라졌으면 새 지문으로 1회 재저장 → 다음 섬 이동을 감지할 기준점 확보.
    // (setTimeout: 지금은 saveLayout이 참조하는 let/CAR/BOAT가 아직 TDZ라 모듈 로드 후로 미룬다)
    if (savedLayout._sig !== ISLAND_SIG) setTimeout(saveLayout, 1500);
    const h = PROPS.find((p) => p.type === 'house');
    if (h) { HOUSE.x = h.x; HOUSE.z = h.z; HOUSE.rotY = h.rotY; } // houseWorld/houseBlocked의 앵커 동기화
    // 지형 평탄화 패드가 주인 프롭을 따라간다 (다음 로드부터 새 위치가 평평해짐)
    for (const s of FLAT_SPOTS) {
        if (!s.follow) continue;
        const p = PROPS.find((q) => q.layoutId === s.follow);
        if (p) { s.x = p.x; s.z = p.z; }
    }
}

const renderer = new THREE.WebGLRenderer({ antialias: true });   // MSAA — near-free on Apple's tile-based GPU, all the AA a single forward pass needs
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));    // full retina again: without the ~19-pass chain, 2x + MSAA costs less than 1.5x did with it
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;   // 그림자 맵은 renderFrame()이 2프레임에 1번 굽는다 (30/15Hz — 소프트 섀도라 안 보임)
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // gentle filmic rolloff — pastels stay soft
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Soft image-based ambient (RoomEnvironment) — gives every standard material a gentle studio
// sheen instead of dead-flat shading. Kept subtle; the sun/hemisphere still carry the scene.
{
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.15;
    pmrem.dispose();
}
// Sky: a vertical gradient painted onto a big inside-out dome (fog is disabled on it so the
// gradient stays crisp), repainted through the day/night cycle below — plus drifting clouds, a
// sun, a moon, and a bed of stars that fades in after dark.
scene.background = new THREE.Color(0xdff1fd);
scene.fog = new THREE.Fog(0xdff1fd, 14, 34);
const skyCv = document.createElement('canvas');
skyCv.width = 1; skyCv.height = 256;
const skyCtx = skyCv.getContext('2d');
const skyTex = new THREE.CanvasTexture(skyCv);
{
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(42, 32, 24),
        // toneMapped:false — ACES가 하늘까지 탈색·회색화하던 것을 차단(게임 스카이박스 표준).
        // 팔레트 hex가 그대로 화면에 나오므로 SKY_* 색이 곧 최종 색이다.
        new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false })
    );
    scene.add(sky);
}
// Sun & moon share one east→west arc (rise 6시 / set 18시 — the moon takes the night shift); both
// ignore fog so they glow through the haze. Stars sit on the upper dome, opacity driven at night.
const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd75e, fog: false, toneMapped: false })   // 하늘과 같은 이유 — 쨍한 노랑 유지
);
scene.add(sunMesh);
const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xf2eede, fog: false, toneMapped: false })
);
scene.add(moonMesh);
let starMat = null, starPts = null;
{
    // 고정 시드 별밭 — 별자리(㉞) 저장이 부팅을 넘어 유효하려면 별들이 언제나 같은 자리에 떠야 한다.
    let starSeed = 20260707;
    const srand = () => { starSeed = (starSeed * 1664525 + 1013904223) >>> 0; return starSeed / 4294967296; };
    const pts = [];
    for (let i = 0; i < 240; i++) {
        const u = srand() * 2 - 1, a = srand() * Math.PI * 2;
        const v = new THREE.Vector3(Math.sqrt(1 - u * u) * Math.cos(a), u, Math.sqrt(1 - u * u) * Math.sin(a));
        v.y = Math.abs(v.y) * 0.9 + 0.08;       // upper hemisphere only
        v.normalize().multiplyScalar(39);
        pts.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0, fog: false, depthWrite: false });
    starPts = new THREE.Points(g, starMat);
    scene.add(starPts);
}
// 별자리(㉞) 렌더 상태 — updateDayNight가 별과 함께 페이드시키므로 여기(첫 호출 전)에 선언.
const constelLineMat = new THREE.LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const constelObjs = [];   // { line, label }
const cloudSpin = new THREE.Group();     // rotated a hair every frame → clouds drift
scene.add(cloudSpin);
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xaecbe8, emissiveIntensity: 0.35 });
let seaMat = null;           // assigned when the ocean is built below; day/night tints it
const foamRings = [];        // lapping foam meshes around the cliff
// Streetlamps: filled with the stage; glow ramps up through dusk, scaled by the 💡 slider.
const lamps = [];            // { light: PointLight }
const lampGlobeMat = new THREE.MeshLambertMaterial({ color: 0xfff1cf, emissive: 0xffc978, emissiveIntensity: 0 });
let lampBrightness = 0.6;
try {
    const saved = parseFloat(localStorage.getItem('worldLampBrightness'));
    if (!Number.isNaN(saved)) lampBrightness = THREE.MathUtils.clamp(saved, 0, 1);
} catch (e) {}
{
    const defs = [
        { a: 0.3, r: 11,   y: 4.6, s: 1.0 },
        { a: 1.9, r: 13,   y: 5.6, s: 1.35 },
        { a: 3.6, r: 10,   y: 4.1, s: 0.8 },
        { a: 5.1, r: 12.5, y: 5.1, s: 1.1 },
    ];
    // 로브 20개가 전부 같은 재질이라 하나의 지오메트리로 병합 — 드로우콜 20→1, 모양 동일.
    // (변환을 지오메트리에 베이크: 로브 squash → 로브 위치 → 구름 스케일 → 구름 위치 —
    //  기존 그룹 계층이 만들던 것과 같은 순서다.)
    const geos = [];
    for (const d of defs) {
        for (const [lx, ly, lz, lr] of [[0, 0, 0, 0.55], [0.5, 0.08, 0.1, 0.4], [-0.48, 0.05, -0.08, 0.42], [0.15, 0.3, 0, 0.35], [-0.2, 0.26, 0.12, 0.3]]) {
            const lobe = new THREE.SphereGeometry(lr, 18, 14);
            lobe.scale(1, 0.62, 1);           // squash into that puffy-flat cartoon cloud shape
            lobe.translate(lx, ly, lz);
            lobe.scale(d.s, d.s, d.s);
            lobe.translate(Math.cos(d.a) * d.r, d.y, Math.sin(d.a) * d.r);
            geos.push(lobe);
        }
    }
    const clouds = new THREE.Mesh(mergeGeometries(geos), cloudMat);
    clouds.matrixAutoUpdate = false;   // 부모(cloudSpin)만 돈다 — 로컬 변환은 영원히 identity
    cloudSpin.add(clouds);
}

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 3.0, 8.2);
camera.lookAt(0, 0.4, 0);

// ---- Game-style shading (게임식 — no post chain): the old GTAO→bloom→SMAA composer re-rendered
// the scene a second time for normals and pushed ~19 fullscreen half-float passes per frame — the
// most expensive possible shape on Apple's tile-based GPUs. Production playbook instead: bake what
// never moves, fake what's cheap to fake. Contact shading became load-time blob shadows (see the
// PROPS loop); halos are additive glow sprites below; AA is canvas MSAA; ACES tone mapping already
// lives on the renderer. One forward render per frame, storybook look intact. ----
const glowTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
})();
function glowSprite(color, size, opacity) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color, opacity, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    sp.scale.setScalar(size);
    return sp;
}
const sunGlow = glowSprite(0xffdf8a, 5.2, 0.75);   // the warm halo the bloom pass used to paint
sunMesh.add(sunGlow);
moonMesh.add(glowSprite(0xbcd2ff, 3.2, 0.5));

// 📱 터치 기기 감지: UI 크기·가상 조이스틱 표시·절전 기본값 같은 "화면 구성"에만 쓴다. 입력
// 분기는 이 플래그가 아니라 각 이벤트의 pointerType으로 판정해서, 터치스크린 노트북에서도
// 마우스 동작이 그대로 유지되게 한다.
const IS_TOUCH = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;

// ⚠️ 에러 가시성: 폰에선 콘솔이 안 보이니 스크립트 오류를 토스트로 띄우고 서버 로그
// (/api/world_log → USER_DATA_DIR/world/client-errors.log)로 보낸다. 같은 메시지 도배 방지.
let lastErrAt = 0, lastErrMsg = '';
function reportClientError(msg) {
    try {
        const m = String(msg || '').slice(0, 300);
        if (!m || (m === lastErrMsg && Date.now() - lastErrAt < 30000)) return;
        lastErrAt = Date.now(); lastErrMsg = m;
        try { showToast(`⚠️ 오류가 났어요: ${m.slice(0, 80)}`); } catch (e) {}
        fetch('/api/world_log', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msg: m, ua: navigator.userAgent }),
        }).catch(() => {});
    } catch (e) {}
}
window.addEventListener('error', (e) => reportClientError(e.message || e.error));
window.addEventListener('unhandledrejection', (e) => reportClientError(e.reason && (e.reason.message || e.reason)));

// ♡ laptop-friendly pacing: one forward pass is already cheap, so 절전 is now about *when* we
// draw, not how. Watched + plugged in → 60fps at full retina; window unfocused (the world usually
// sits beside real work) → 15fps; ⚡ eco (persisted) or on battery → 30fps at 1.5x pixels.
// 티어 전체는 frameIntervalMs() 참조 — 포커스 구경 30fps, 60초+ 구경/비포커스는 15fps.
// 📱 폰/태블릿은 절전이 기본(30fps·1.5x — 발열·배터리). 사용자가 ⚡ 버튼으로 명시적으로 껐다면
// localStorage에 '0'이 남아 있으니 그 선택을 존중한다.
const savedEco = localStorage.getItem('world-eco');
let ecoMode = savedEco === null ? IS_TOUCH : savedEco === '1';
let onBattery = false;
let winFocused = document.hasFocus();
window.addEventListener('focus', () => { winFocused = true; });
window.addEventListener('blur', () => { winFocused = false; });
// 입력 idle: 포커스여도 12초간 입력이 없으면 30fps(구경 모드), 입력 즉시 60fps 복귀.
// 저더가 제일 잘 보이는 카메라 조작은 입력 그 자체라 언제나 60fps다. 공사모드·줌 홀드는
// idle로 치지 않고, 펫이 말을 걸어오면(말풍선·토스트) wakeSoft로 몇 초만 깨운다 — 12초
// 타이머를 통째로 리셋하면 선제대화가 있는 한 60fps가 기본 상태가 돼버린다(발열).
let lastInputMs = performance.now();
let softWakeUntil = 0;   // 말풍선·토스트용 짧은 웨이크의 만료 시각
const wakeInput = () => { lastInputMs = performance.now(); };
const wakeSoft = (ms) => { softWakeUntil = Math.max(softWakeUntil, performance.now() + ms); };
for (const ev of ['pointerdown', 'wheel', 'keydown', 'touchstart']) {
    window.addEventListener(ev, wakeInput, { passive: true, capture: true });
}
// pointermove만 따로: 커서 밑에서 콘텐츠가 움직이면 Chromium이 움직임 0짜리 합성 move를
// 쏜다 — 커서를 창 위에 둔 채 손만 떼도 idle에 영영 못 들어가던 원인. 실제 움직임만 입력으로
// 치되, 터치는 기기에 따라 movement가 0으로 오니 pointerType으로 무조건 통과시킨다.
window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || e.movementX !== 0 || e.movementY !== 0) wakeInput();
}, { passive: true, capture: true });
const renderIdle = () => !buildMode && !heldZoom
    && performance.now() - lastInputMs > 12000 && performance.now() >= softWakeUntil;
const ecoActive = () => ecoMode || onBattery;
function applyPixelRatio() {
    const pr = Math.min(window.devicePixelRatio, ecoActive() ? 1.5 : 2);
    if (renderer.getPixelRatio() !== pr) {
        renderer.setPixelRatio(pr);
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
}
if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
        const sync = () => { onBattery = !b.charging; applyPixelRatio(); };
        b.addEventListener('chargingchange', sync);
        sync();
    }).catch(() => {});
}
// 시작 시 한 번 적용: getBattery가 없는 브라우저(iOS/macOS Safari)에선 위 sync가 안 돌아서,
// 저장된/기본 절전 모드가 리사이즈 전까지 픽셀비에 반영되지 않던 갭을 메운다.
applyPixelRatio();
let statsFrames = 0, statsLastT = performance.now();
let shadowTick = 0;
function renderFrame() {
    // 그림자 맵은 매 프레임 새로 구울 필요가 없다 — 2렌더에 1번(60fps 기준 30Hz)이면 PCFSoft
    // 블러 안에서 차이가 안 보이고, depth 패스(캐스터 전부 재드로우) 비용이 반으로 준다.
    if ((shadowTick++ & 1) === 0) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    if (statsOn) {
        statsFrames++;
        const now = performance.now();
        if (now - statsLastT >= 500) {
            const fps = Math.round((statsFrames * 1000) / (now - statsLastT));
            statsFrames = 0;
            statsLastT = now;
            let objs = 0;
            scene.traverse(() => objs++);
            statsEl.textContent = `${fps} fps · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1000).toFixed(1)}k tris · ${objs} objs`;
        }
    }
}

// Lights: hemisphere fill (sky blue above, grass green below) + a shadow-casting sun
const hemiLight = new THREE.HemisphereLight(0xcfe6ff, 0x8fca62, 0.85);
scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.7);   // warm afternoon sun
sunLight.position.set(4, 7, 3);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -8.5;
sunLight.shadow.camera.right = 8.5;
sunLight.shadow.camera.top = 8.5;
sunLight.shadow.camera.bottom = -8.5;
sunLight.shadow.radius = 5;              // PCFSoft blur — soft cartoon-edged shadows
sunLight.shadow.bias = -0.0002;
sunLight.shadow.normalBias = 0.03;       // rolling terrain: keep self-shadow acne away
scene.add(sunLight);

// ---- Day/night cycle (밤낮): driven by the real clock — 해 6시 뜨고 18시 지고, 달이 밤 교대.
// Refreshes at most every 30s: repaints the sky gradient, slides sun/moon along their arc, re-aims
// the shadow light (sun by day, moon by night) and dresses clouds/stars/fog for the hour.
// Preview any time of day with world.html?hour=21.5 in a browser.
const HOUR_OVERRIDE = parseFloat(new URLSearchParams(window.location.search).get('hour'));
// 스카이돔 UV에서 수평선은 v=0.5 (0=천정, 1=바닥 극점) — 카메라가 실제로 보는 하늘 띠는
// 0.28~0.52뿐이다. 예전 스탑 [0, .45, .8, 1]은 쨍한 파랑을 천정(화면 밖)에 두고 보이는 띠엔
// 제일 연한 두 색만 걸어서 "낮인데 흐린 단색" 하늘의 주범이었다. 램프 전체를 보이는 띠에 건다.
const SKY_STOPS = [0, 0.3, 0.44, 0.52];
const SKY_DAY   = ['#2f9de8', '#5fbcee', '#a9e2f0', '#e9f6ec'].map((c) => new THREE.Color(c));   // 동숲풍: 아주르→아쿠아→민트 수평선
const SKY_NIGHT = ['#0a1430', '#13214a', '#1c2e5c', '#2c3c6a'].map((c) => new THREE.Color(c));
const SKY_DUSK  = ['#33518f', '#6f68b0', '#ee9a6e', '#ffc98a'].map((c) => new THREE.Color(c));

// ---- Weather state (날씨): clear ↔ rain/snow episodes on the real clock — snow takes the 11~2월
// shift. wxF is the eased overcast factor (0 clear → 1 wet); updateDayNight composites it over the
// day/night palette, and the particles / rainbow / rain hiss live with the live systems below.
// Preview (locks the scheduler): world.html?weather=rain|snow|storm|clear|rainbow ----
const WEATHER_OVERRIDE = (new URLSearchParams(window.location.search).get('weather') || '').toLowerCase() || null;
const SKY_GLOOM = ['#6b7684', '#93a0ad', '#b8c2cc', '#ccd4da'].map((c) => new THREE.Color(c));
const _gloomStop = new THREE.Color();
// 켜면 항상 맑음: 첫 강수는 이 첫 맑음 에피소드(10~25분)가 끝난 뒤에야 온다. 날씨는 세션
// 한정이라 창을 다시 열면 늘 맑은 하늘+자동 모드로 시작한다 (?weather= 미리보기만 예외).
let wx = { type: 'clear', until: Date.now() + (10 + Math.random() * 15) * 60000 };
try { localStorage.removeItem('world-weather'); localStorage.removeItem('world-weather-manual'); } catch (e) {}   // pre-"켜면 맑음" persisted keys
if (WEATHER_OVERRIDE) wx = { type: (WEATHER_OVERRIDE === 'rain' || WEATHER_OVERRIDE === 'snow' || WEATHER_OVERRIDE === 'storm') ? WEATHER_OVERRIDE : 'clear', until: Infinity };
// 수동 날씨 (독의 🌦️ 날씨 설정 버튼): 고르면 자동 스케줄러 대신 그 날씨가 유지된다. 새 날씨는 여기에 추가.
const WEATHER_CHOICES = [
    { id: null,    icon: '🔄', label: '자동',     toast: '🔄 날씨 자동 모드' },
    { id: 'clear', icon: '☀️', label: '맑음',     toast: '☀️ 하늘이 활짝 개었어요' },
    { id: 'rain',  icon: '🌧️', label: '비',      toast: '🌧️ 비가 내려요' },
    { id: 'snow',  icon: '❄️', label: '눈',      toast: '❄️ 눈이 내려요' },
    { id: 'storm', icon: '⛈️', label: '천둥번개', toast: '⛈️ 천둥번개가 몰려와요' },
    { id: 'aurora', icon: '🌌', label: '오로라',  toast: '🌌 오로라 — 밤이 되면 하늘에 일렁여요' },
];
let manualWx = null;   // 세션 한정 — 다시 열면 자동 모드로 (켜면 맑음 원칙)
let wxF = wx.type === 'clear' ? 0 : 1;   // restored mid-episode → start already wet, no fake fade-in
let stormF = wx.type === 'storm' ? 1 : 0;   // ⛈️ 뇌우 계수: 비보다 한 단계 더 어둡게 누르는 추가 감쇠 (updateWeather가 이진다)
let lastDayF = 1;                        // rainbow needs to know if the sun is out when rain ends

// ---- Season state (계절): 자동 = 실제 달력(3-5 봄 / 6-8 여름 / 9-11 가을 / 12-2 겨울), 수동 =
// 🌦️ 패널에서 고정(계절은 에피소드가 아니라 모드라서 저장된다). 여름이 원본 룩 — 봄/가을은
// 잎·잔디를 되칠하고 겨울은 설원 텍스처+눈모자를 얹는다(applySeason — 월드가 다 지어진 뒤 정의).
// 낮 길이도 계절을 따른다: 여름 해가 길고 겨울 해가 짧다. 미리보기: world.html?season=winter 등
const SEASON_OVERRIDE = (new URLSearchParams(window.location.search).get('season') || '').toLowerCase() || null;
const SEASONS = {
    spring: { ko: '봄',   icon: '🌸', sunrise: 6.0, sunset: 18.8 },
    summer: { ko: '여름', icon: '🌿', sunrise: 5.3, sunset: 19.6 },
    autumn: { ko: '가을', icon: '🍂', sunrise: 6.4, sunset: 18.1 },
    winter: { ko: '겨울', icon: '⛄', sunrise: 7.3, sunset: 17.4 },
};
function calendarSeason() {
    const m = new Date().getMonth() + 1;
    return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
}
let manualSeason = null;
try {
    const s = localStorage.getItem('world-season');
    if (SEASONS[s]) manualSeason = s;
} catch (e) {}
if (SEASON_OVERRIDE && SEASONS[SEASON_OVERRIDE]) manualSeason = SEASON_OVERRIDE;
const worldSeason = () => manualSeason || calendarSeason();
let season = worldSeason();   // the season currently painted onto the scene
let seasonBlend = null;       // in-flight 2.5s crossfade, advanced by updateSeasonBlend()
let buildMode = false;        // 🔨 공사모드 — 핸들러들은 아래쪽에, 선언은 초기 계절 적용보다 먼저
// Season palettes (여름 = 원본). Leaf pairs are [top, bottom] for the baked lobe gradients.
const LEAF_AUTUMN = [[0xffc95e, 0xc07a28], [0xff9448, 0xbb5a22], [0xe8654e, 0xa03a28]];   // 금빛/주황/빨강 — 나무마다 하나
const CHERRY_LEAF = { spring: [0xffc9de, 0xf095bb], summer: [0x8bd678, 0x4a9345], autumn: [0xff9a66, 0xc25a35], winter: [0xd3ccda, 0x968ea2] };
const GRASS_TINT  = { spring: [0.97, 1.03, 0.9], summer: [1, 1, 1], autumn: [1.28, 0.92, 0.48], winter: [1, 1, 1] };
const TUFT_COLOR  = { spring: 0x63bb46, summer: 0x5fae44, autumn: 0xb99a3e, winter: 0x5fae44 };
const SEA_TINT    = { spring: null, summer: null, autumn: [0x4d7a86, 0.18], winter: [0x2e5f83, 0.35] };
const HEMI_GROUND = { spring: [0x233524, 0x8fca62], summer: [0x233524, 0x8fca62], autumn: [0x30291a, 0xb0a05e], winter: [0x2a3140, 0xdde6f0] };
const _seasonSea = new THREE.Color();
// Registries filled while the world is built; applySeason() repaints them.
const seasonGrass = [];      // island grass meshes — winter swaps their texture to snow
const seasonLeaves = [];     // { geo, orig: [top, bottom], cherry, treeNo, li } per canopy lobe
const seasonSnowCaps = [];   // white caps on canopies + the house roof — winter only
const seasonFall = [];       // { pts, when } falling particles: 벚꽃잎(spring) / 낙엽(autumn)
let seasonDecor = null;      // { tuftMesh, stemMesh, headMesh, pebbleMesh } once decorations exist
const snowCapMat = new THREE.MeshStandardMaterial({ color: 0xf2f7ff, roughness: 1, metalness: 0, transparent: true, opacity: 0 });
const wxTime = { value: 0 };   // shared clock uniform for every falling-particle shader (비/눈/꽃잎/낙엽)

function currentHour() {
    if (!Number.isNaN(HOUR_OVERRIDE)) return ((HOUR_OVERRIDE % 24) + 24) % 24;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}
// 1 = full day, 0 = full night; ramps over sunrise±1h and sunset±1h. The season sets the hours
// (여름 해가 길고 겨울 해가 짧다) so lamps, the sun arc and dusk glow all follow along.
function dayFactor(h) {
    const { sunrise, sunset } = SEASONS[season];
    if (h < sunrise - 1 || h >= sunset + 1) return 0;
    if (h < sunrise + 1) return THREE.MathUtils.smoothstep(h, sunrise - 1, sunrise + 1);
    if (h < sunset - 1) return 1;
    return 1 - THREE.MathUtils.smoothstep(h, sunset - 1, sunset + 1);
}
// Golden-hour glow peaking exactly at the season's sunrise and sunset.
function duskGlow(h) {
    const { sunrise, sunset } = SEASONS[season];
    return Math.min(1, Math.max(0, 1 - Math.abs(h - sunrise) / 1.3) + Math.max(0, 1 - Math.abs(h - sunset) / 1.3));
}
// t: 0 = rising in the east → 1 = setting in the west, along an arc behind the island.
function arcPos(t, height, out) {
    const a = t * Math.PI;
    return out.set(Math.cos(a) * 16, Math.sin(a) * height + 0.4, -7);
}

const _skyStop = new THREE.Color();
let lastSkyStamp = -1;
function updateDayNight(force = false) {
    const stamp = Math.floor(Date.now() / 30000);
    if (!force && stamp === lastSkyStamp) return;
    lastSkyStamp = stamp;

    // 달력이 계절을 넘기면(자동 모드) 30초 스탬프 주기로 알아채고 크로스페이드로 갈아입힌다.
    const liveSeason = worldSeason();
    if (liveSeason !== season && !seasonBlend) applySeason(liveSeason, true);

    const h = currentHour();
    const dayF = dayFactor(h);
    const glow = duskGlow(h);
    const nightF = 1 - dayF;

    // Sky gradient; fog + background follow the blended horizon color. Overcast (wxF) drags every
    // stop toward a gray ramp — dimmed to charcoal at night so rain never brightens the dark.
    const grad = skyCtx.createLinearGradient(0, 0, 0, 256);
    for (let i = 0; i < SKY_STOPS.length; i++) {
        _skyStop.copy(SKY_NIGHT[i]).lerp(SKY_DAY[i], dayF).lerp(SKY_DUSK[i], glow * 0.8);
        if (wxF > 0) _skyStop.lerp(_gloomStop.copy(SKY_GLOOM[i]).multiplyScalar((0.3 + 0.7 * dayF) * (1 - 0.55 * stormF)), wxF * 0.8);
        grad.addColorStop(SKY_STOPS[i], `#${_skyStop.getHexString()}`);
    }
    grad.addColorStop(1, `#${_skyStop.getHexString()}`);   // 수평선(0.52) 아래 반구는 수평선 색 고정 — 바다 너머가 새하얘지지 않게
    skyCtx.fillStyle = grad;
    skyCtx.fillRect(0, 0, 1, 256);
    skyTex.needsUpdate = true;
    _skyStop.copy(SKY_NIGHT[3]).lerp(SKY_DAY[3], dayF).lerp(SKY_DUSK[3], glow * 0.8);
    if (wxF > 0) _skyStop.lerp(_gloomStop.copy(SKY_GLOOM[3]).multiplyScalar((0.3 + 0.7 * dayF) * (1 - 0.55 * stormF)), wxF * 0.8);
    scene.fog.color.copy(_skyStop);
    scene.background.copy(_skyStop);
    scene.fog.near = 14 - 5.5 * wxF;   // the wet front pulls the haze in close
    scene.fog.far = 34 - 9 * wxF;

    // Sun & moon ride their arcs across the season's daylight window; each shows around its shift.
    const { sunrise, sunset } = SEASONS[season];
    arcPos(THREE.MathUtils.clamp((h - sunrise) / (sunset - sunrise), 0, 1), 11, sunMesh.position);
    arcPos(THREE.MathUtils.clamp(((h - sunset + 24) % 24) / (24 - sunset + sunrise), 0, 1), 9, moonMesh.position);
    sunMesh.visible = h > sunrise - 0.6 && h < sunset + 0.6 && wxF < 0.55;   // overcast swallows the discs
    moonMesh.visible = (h > sunset - 0.6 || h < sunrise + 0.6) && wxF < 0.55;

    // The one shadow light plays sun by day and moon by night; overcast flattens and grays it.
    sunLight.position.copy(dayF >= 0.5 ? sunMesh.position : moonMesh.position);
    sunLight.color.copy(new THREE.Color(0x9db8e8).lerp(new THREE.Color(0xfff4e0), dayF).lerp(new THREE.Color(0xffb37a), glow * 0.55).lerp(new THREE.Color(0x9aa4b2), wxF * 0.5));
    sunLight.intensity = (0.62 + 1.1 * dayF) * (1 - 0.45 * wxF) * (1 - 0.3 * stormF);
    hemiLight.color.set(0x1d2b52).lerp(new THREE.Color(0xcfe6ff), dayF);
    hemiLight.groundColor.set(HEMI_GROUND[season][0]).lerp(new THREE.Color(HEMI_GROUND[season][1]), dayF);   // 겨울엔 설원 반사광
    hemiLight.intensity = (0.4 + 0.45 * dayF) * (1 - 0.22 * wxF) * (1 - 0.25 * stormF);

    // Streetlamps fade up through dusk — and glow softly through a daytime rain (아늑함).
    const lampGlow = Math.max(1 - dayF, wxF * 0.45) * lampBrightness;
    lampGlobeMat.emissiveIntensity = 0.05 + 1.3 * lampGlow;
    // 꺼진 램프는 씬에서 뗀다: three 포워드는 셰이더에 박힌 라이트 수만큼 "모든 픽셀"이 비용을
    // 내서, intensity 0으로 남겨두면 맑은 낮에도 포인트라이트 ~10개 값을 레티나 해상도로 낸다.
    // 라이트 수가 바뀌는 새벽·황혼 경계 프레임에 셰이더 재컴파일이 한 번 있지만(세션당 상태별
    // 1회 캐시) updateDayNight 스로틀 덕에 그 한 번뿐이다. 부모가 그룹인 램프(동굴 데크 등)도
    // 있어 원래 부모를 기억해 뒀다 그 자리에 되붙인다.
    const lampsOn = lampGlow > 0.001;
    for (const l of lamps) {
        const home = l.light.userData.homeParent || (l.light.userData.homeParent = l.light.parent);
        if (lampsOn && !l.light.parent) home.add(l.light);
        else if (!lampsOn && l.light.parent) home.remove(l.light);
        l.light.intensity = 6 * lampGlow;
        if (l.glow) l.glow.opacity = 0.9 * lampGlow;   // the indoor reading lamp has no halo
    }
    sunGlow.material.color.set(0xffdf8a).lerp(new THREE.Color(0xff9d5c), glow * 0.7);   // golden-hour halo
    sunGlow.material.opacity = 0.75 * (1 - 0.85 * wxF);

    // Night dresses the clouds and reveals the stars; overcast turns the clouds to slate and
    // hides the stars entirely.
    cloudMat.color.set(0x6c7ea6).lerp(new THREE.Color(0xffffff), dayF).lerp(new THREE.Color(0x66707c), wxF * 0.75);
    cloudMat.emissiveIntensity = (0.12 + 0.23 * dayF) * (1 - 0.5 * wxF);
    starMat.opacity = nightF * (0.35 + 0.55 * THREE.MathUtils.smoothstep(nightF, 0.6, 1)) * (1 - wxF);
    constelLineMat.opacity = starMat.opacity * 0.9;   // 저장된 별자리는 별과 함께 뜨고 진다
    for (const co of constelObjs) co.label.material.opacity = starMat.opacity * 0.8;

    // The sea darkens after sunset, warms a touch at golden hour, grays under rain.
    if (seaMat) {
        seaMat.color.set(0x16345c).lerp(new THREE.Color(0x3fa9d0), dayF).lerp(new THREE.Color(0x5a79b0), glow * 0.35).lerp(new THREE.Color(0x51707e), wxF * 0.45);
        const st = SEA_TINT[season];
        if (st) seaMat.color.lerp(_seasonSea.set(st[0]), st[1]);   // 계절 물빛 — 가을 차분, 겨울 차가움
        for (const foam of foamRings) {
            foam.material.color.set(0x9fb8d8).lerp(new THREE.Color(0xffffff), dayF);
        }
    }
    lastDayF = dayF;
}
updateDayNight(true);

// Orbit camera: drag to circle the island, wheel to zoom; capped just above the horizon.
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.35, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;          // lower = silkier glide after a drag
controls.rotateSpeed = 0.85;
controls.minDistance = 2.2;
controls.maxDistance = 15;
controls.maxPolarAngle = Math.PI * 0.49;
// Wheel zoom: OrbitControls dollies in hard steps per wheel tick, which feels stiff. Disable it and
// glide toward a target distance in animate() instead (the ＋/－ buttons steer the same target).
controls.enableZoom = false;
// 📱 두 손가락 제스처는 커스텀 핀치줌(캔버스 pointerdown 쪽)이 전담한다. OrbitControls의 기본
// 두-손가락 팬은 조종 팔로우캠(updateFollowCam)과 타겟을 두고 싸우고, 관람 중엔 섬을 화면
// 밖으로 밀어낼 수 있어 통째로 끈다(-1 → onTouchStart switch가 default: NONE). 마우스
// 우클릭-드래그 팬은 별개 경로라 데스크톱은 그대로.
controls.touches.TWO = -1;
// 🎥 프리뷰 카메라 (?cam=px,py,pz[,tx,ty,tz]) — ?hour=처럼 개발/스크린샷용. 소품 클로즈업을
// 헤드리스 캡처로 검증할 때 쓴다. 줌 글라이드 타깃(zoomTargetDist)도 같이 맞춰 되돌아가지 않게.
{
    const cs = (new URLSearchParams(window.location.search).get('cam') || '').split(',').map(parseFloat);
    if (cs.length >= 3 && cs.every((v) => Number.isFinite(v))) {
        camera.position.set(cs[0], cs[1], cs[2]);
        if (cs.length >= 6) controls.target.set(cs[3], cs[4], cs[5]);
        controls.update();
    }
}
let zoomTargetDist = camera.position.distanceTo(controls.target);
renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1);   // lines/pages → px
    zoomTargetDist = THREE.MathUtils.clamp(
        zoomTargetDist * Math.pow(1.0015, dy),
        controls.minDistance, controls.maxDistance
    );
}, { passive: false });
// The ＋/－ buttons and keyboard +/- steer the same smoothed target; animate() glides the camera.
// (This function was lost when the old button panel was removed — the buttons silently threw.)
function camZoom(factor) {
    zoomTargetDist = THREE.MathUtils.clamp(zoomTargetDist * factor, controls.minDistance, controls.maxDistance);
}
controls.update();

// ---- Hand-drawn repeat textures (동물의 숲 스타일): tiny canvas paintings tiled across the
// stage — the iconic staggered-triangle grass, wood grain, cliff strata, plaster, shingles,
// awning stripes and sand speckle. No external files; everything is painted at load. ----
function canvasTex(size, repeatX, repeatY, draw) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    draw(ctx, size);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}
// 시드 고정 난수 — 텍스처가 로드마다 달라지지 않게 (전후 비교·스크린샷 재현성)
function seededRand(seed) {
    let sd = seed;
    return () => (sd = (sd * 16807) % 2147483647) / 2147483647;
}
// 잔디: 동숲식 삼각 패턴의 고밀도판 — 톤 4종을 섞고 위치·크기를 지터해서 "타일 카펫" 반복감을
// 깬다. 밑에 저주파 얼룩, 위에 가는 잎날 스트로크. (256px, 월드 1.25m 반복은 그대로)
const grassTex = canvasTex(256, 1, 1, (ctx, s) => {
    const R = seededRand(7);
    ctx.fillStyle = '#79c04f';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {   // 저주파 얼룩 — 셀 경계와 무관한 큰 붓터치
        const g = ctx.createRadialGradient(R() * s, R() * s, 0, R() * s, R() * s, s * (0.12 + R() * 0.16));
        const warm = R() > 0.5;
        g.addColorStop(0, warm ? 'rgba(168,205,90,0.16)' : 'rgba(88,168,96,0.15)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
    }
    const cell = s / 10;
    const tones = ['rgba(255,255,240,0.13)', 'rgba(214,240,140,0.15)', 'rgba(40,105,30,0.13)', 'rgba(25,75,15,0.10)'];
    for (let r = 0; r < 10; r++) {
        for (let q = 0; q < 10; q++) {
            if (R() < 0.14) continue;   // 빈 칸 — 규칙성 깨기
            const x = q * cell + (r % 2 ? cell / 2 : 0) + (R() - 0.5) * cell * 0.34;
            const y = r * cell + (R() - 0.5) * cell * 0.3;
            const k = 0.72 + R() * 0.44;
            ctx.fillStyle = tones[Math.floor(R() * tones.length)];
            ctx.beginPath();
            ctx.moveTo(x + cell * 0.5, y + cell * (0.62 - 0.42 * k));
            ctx.lineTo(x + cell * (0.5 + 0.3 * k), y + cell * 0.62);
            ctx.lineTo(x + cell * (0.5 - 0.3 * k), y + cell * 0.62);
            ctx.closePath();
            ctx.fill();
        }
    }
    ctx.strokeStyle = 'rgba(226,248,168,0.35)';   // 가는 잎날 — 근경에서 "풀"로 읽히는 디테일
    ctx.lineWidth = s / 170;
    ctx.lineCap = 'round';
    for (let i = 0; i < 44; i++) {
        const x = R() * s, y = R() * s, h = s * (0.02 + R() * 0.03), lean = (R() - 0.5) * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + lean * 0.3, y - h * 0.6, x + lean, y - h);
        ctx.stroke();
    }
});
const snowGroundTex = canvasTex(256, 1, 1, (ctx, s) => {   // 겨울 설원 — grassTex와 같은 패턴 문법의 눈 팔레트판
    const R = seededRand(11);
    ctx.fillStyle = '#eef3fb';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 18; i++) {   // 바람이 쓸어놓은 자국 — 저주파 명암
        const g = ctx.createRadialGradient(R() * s, R() * s, 0, R() * s, R() * s, s * (0.14 + R() * 0.16));
        g.addColorStop(0, R() > 0.5 ? 'rgba(255,255,255,0.30)' : 'rgba(176,194,224,0.14)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
    }
    const cell = s / 10;
    const tones = ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.35)', 'rgba(150,172,208,0.15)', 'rgba(132,156,196,0.10)'];
    for (let r = 0; r < 10; r++) {
        for (let q = 0; q < 10; q++) {
            if (R() < 0.16) continue;
            const x = q * cell + (r % 2 ? cell / 2 : 0) + (R() - 0.5) * cell * 0.34;
            const y = r * cell + (R() - 0.5) * cell * 0.3;
            const k = 0.72 + R() * 0.44;
            ctx.fillStyle = tones[Math.floor(R() * tones.length)];
            ctx.beginPath();
            ctx.moveTo(x + cell * 0.5, y + cell * (0.62 - 0.42 * k));
            ctx.lineTo(x + cell * (0.5 + 0.3 * k), y + cell * 0.62);
            ctx.lineTo(x + cell * (0.5 - 0.3 * k), y + cell * 0.62);
            ctx.closePath();
            ctx.fill();
        }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';   // 반짝이 결정 몇 점
    for (let i = 0; i < 14; i++) {
        ctx.beginPath();
        ctx.arc(R() * s, R() * s, s / 200 + R() * s / 260, 0, Math.PI * 2);
        ctx.fill();
    }
});
// 휴양지 모래 — 알갱이 스펙클(밀도 높게) + 바람이 쓸어놓은 물결 라인 + 드문 조가비 점.
// grassTex와 같은 월드 평면 매핑(1.25m 반복)으로 섬 지면·해변 경사 둘 다 쓴다.
const sandTopTex = canvasTex(256, 1, 1, (ctx, s) => {
    const R = seededRand(83);
    ctx.fillStyle = '#eedcae';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 20; i++) {   // 저주파 명암 — 사구의 미묘한 톤
        const g = ctx.createRadialGradient(R() * s, R() * s, 0, R() * s, R() * s, s * (0.12 + R() * 0.18));
        g.addColorStop(0, R() > 0.5 ? 'rgba(255,244,214,0.16)' : 'rgba(196,164,116,0.13)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
    }
    for (let i = 0; i < 900; i++) {   // 모래 알갱이
        const warm = R();
        ctx.fillStyle = warm < 0.45 ? `rgba(178,142,92,${0.1 + R() * 0.14})`
            : warm < 0.9 ? `rgba(255,250,230,${0.1 + R() * 0.12})` : `rgba(230,150,120,${0.08 + R() * 0.08})`;
        ctx.fillRect(R() * s, R() * s, 1 + R(), 1 + R());
    }
    ctx.lineCap = 'round';   // 바람 물결 라인 — 어두운 골과 밝은 등을 쌍으로
    for (let i = 0; i < 9; i++) {
        const y0 = R() * s, amp = s * (0.01 + R() * 0.015), ph = R() * Math.PI * 2;
        for (const [off, col, w] of [[0, 'rgba(186,152,102,0.22)', s / 110], [s / 90, 'rgba(255,246,222,0.20)', s / 140]]) {
            ctx.strokeStyle = col;
            ctx.lineWidth = w;
            ctx.beginPath();
            for (let x = 0; x <= s; x += s / 24) {
                const y = y0 + off + Math.sin((x / s) * Math.PI * 4 + ph) * amp;
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    }
    for (let i = 0; i < 7; i++) {   // 드문 조가비/산호 점
        ctx.fillStyle = R() > 0.5 ? 'rgba(255,255,255,0.75)' : 'rgba(245,170,150,0.6)';
        ctx.beginPath();
        ctx.arc(R() * s, R() * s, s / 130 + R() * s / 160, 0, Math.PI * 2);
        ctx.fill();
    }
});
// 야자수 프론드 — 중심 스파인 + 양쪽으로 갈라지는 잎살(끝으로 갈수록 짧아짐)을 알파로 그린다.
// 벤트 스트립 지오메트리에 얹으면 톱니 실루엣의 진짜 야자잎이 된다.
const frondTex = canvasTex(128, 1, 1, (ctx, s) => {
    const R = seededRand(97);
    ctx.clearRect(0, 0, s, s);
    const midY = s / 2;
    ctx.strokeStyle = '#3f7a34';   // 스파인
    ctx.lineWidth = s / 26;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(s * 0.98, midY);
    ctx.stroke();
    for (let i = 0; i < 15; i++) {   // 잎살 쌍 — 뿌리 쪽 길고 끝 쪽 짧다, 살짝 뒤로 눕는다
        const t = i / 15;
        const x = s * (0.04 + t * 0.9);
        const len = s * 0.42 * (1 - t * 0.62) * (0.85 + R() * 0.3);
        for (const side of [-1, 1]) {
            const g2 = ctx.createLinearGradient(x, midY, x + s * 0.1, midY + side * len);
            g2.addColorStop(0, '#5da44b');
            g2.addColorStop(1, '#7fce69');
            ctx.strokeStyle = g2;
            ctx.lineWidth = s / 22 * (1 - t * 0.4);
            ctx.beginPath();
            ctx.moveTo(x, midY);
            ctx.quadraticCurveTo(x + s * 0.06, midY + side * len * 0.55, x + s * 0.11, midY + side * len);
            ctx.stroke();
        }
    }
});
const palmFrondMat = new THREE.MeshLambertMaterial({ map: frondTex, alphaTest: 0.4, side: THREE.DoubleSide });
// 알파 재질의 그림자는 기본이 "사각 판때기" — 톱니 모양대로 떨어지게 알파 인지 깊이 재질을 쓴다
const palmFrondDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: frondTex, alphaTest: 0.4 });
// 꽃송이 스프라이트 — 루미넌스 꽃잎(instanceColor·계절 틴트가 착색) + 웜 옐로 수술.
const flowerTex = canvasTex(48, 1, 1, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2, cy = s / 2;
    for (let i = 0; i < 6; i++) {   // 꽃잎 6장
        const a = (i / 6) * Math.PI * 2;
        const px = cx + Math.cos(a) * s * 0.27, py = cy + Math.sin(a) * s * 0.27;
        const g = ctx.createRadialGradient(px, py, 0, px, py, s * 0.21);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.75, 'rgba(226,222,214,1)');
        g.addColorStop(1, 'rgba(226,222,214,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, s * 0.21, 0, Math.PI * 2);
        ctx.fill();
    }
    const c = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 0.15);   // 수술 — 고정 웜톤 (틴트와 곱해도 노랗게 남는다)
    c.addColorStop(0, 'rgba(255,214,110,1)');
    c.addColorStop(1, 'rgba(230,168,64,1)');
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.15, 0, Math.PI * 2);
    ctx.fill();
});
// 섬 기슭 거품 링의 알파맵 — 매끈한 도넛 대신 스캘럽·끊김이 있는 유기적 거품선.
// RingGeometry의 평면 UV(외접원 기준)에 맞춰 캔버스 가장자리 밴드(반지름 0.86~1.0)에 그린다.
const foamTex = canvasTex(128, 1, 1, (ctx, s) => {
    const R = seededRand(31);
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2;
    for (let i = 0; i < 150; i++) {   // 링 경로를 따라 방울 뭉치 — 겹치면 띠, 빈 곳은 끊김
        const a = R() * Math.PI * 2;
        const rr = s * (0.435 + R() * 0.05);
        if (R() < 0.15) continue;
        ctx.fillStyle = `rgba(255,255,255,${0.5 + R() * 0.5})`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, s * (0.012 + R() * 0.022), 0, Math.PI * 2);
        ctx.fill();
    }
});
// 연못물 — 중심으로 갈수록 깊어지는 라디얼 그라데이션 (플라스틱 원판 → 물).
const pondTex = canvasTex(128, 1, 1, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, '#2e7ba6');     // 깊은 중심
    g.addColorStop(0.55, '#4aa3c8');
    g.addColorStop(0.85, '#7fd0e8');  // 얕은 가장자리
    g.addColorStop(1, '#a5e2f0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const R = seededRand(41);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';   // 잔물결 호
    ctx.lineWidth = s / 90;
    for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s * (0.12 + R() * 0.33), R() * Math.PI * 2, R() * Math.PI * 2 + 0.6 + R() * 0.9);
        ctx.stroke();
    }
});
const petalTex = canvasTex(32, 1, 1, (ctx) => {   // 벚꽃잎 스프라이트 — 봄의 벚나무가 흩날린다
    const g = ctx.createRadialGradient(16, 15, 0, 16, 15, 13);
    g.addColorStop(0, 'rgba(255,214,231,0.95)');
    g.addColorStop(0.6, 'rgba(255,182,213,0.8)');
    g.addColorStop(1, 'rgba(255,182,213,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(16, 15, 13, 0, Math.PI * 2); ctx.fill();
});
const woodTex = canvasTex(64, 1, 1, (ctx, s) => {
    ctx.fillStyle = '#cfae7f';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 20; i++) {
        const x = Math.random() * s;
        ctx.strokeStyle = `rgba(90,55,25,${0.10 + Math.random() * 0.14})`;
        ctx.lineWidth = 1 + Math.random() * 1.6;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 6, s / 2, x, s);
        ctx.stroke();
    }
});
const strataTex = canvasTex(128, 4, 1, (ctx, s) => {
    const bands = ['#a3744e', '#8a5f40', '#9c6f49', '#815838', '#946849', '#7c5335'];
    const bh = s / bands.length;
    bands.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(0, i * bh, s, bh + 1);
        ctx.fillStyle = 'rgba(255,235,200,0.10)';
        ctx.fillRect(0, i * bh, s, 2);
    });
    for (let i = 0; i < 70; i++) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '60,38,20' : '235,205,170'},0.16)`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 3, 2 + Math.random() * 2);
    }
});
// 회벽 스터코 — 중립 톤 유지 (부스 카운터·기념비 등이 material.color로 틴트해 쓴다):
// 미세 스펙클 + 붓자국 + 아주 옅은 얼룩으로 "칠한 벽"의 질감만 얹는다.
const plasterTex = canvasTex(128, 2, 2, (ctx, s) => {
    const R = seededRand(53);
    ctx.fillStyle = '#fbf5ea';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 12; i++) {   // 넓은 얼룩 — 회벽의 미장 자국
        const g = ctx.createRadialGradient(R() * s, R() * s, 0, R() * s, R() * s, s * (0.12 + R() * 0.2));
        g.addColorStop(0, R() > 0.5 ? 'rgba(224,204,172,0.08)' : 'rgba(255,255,255,0.12)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
    }
    for (let i = 0; i < 200; i++) {   // 모래알 스펙클
        ctx.fillStyle = `rgba(${R() < 0.5 ? '205,180,145' : '255,255,255'},${0.06 + R() * 0.08})`;
        ctx.fillRect(R() * s, R() * s, 1 + R() * 1.6, 1 + R() * 1.6);
    }
    ctx.strokeStyle = 'rgba(214,196,168,0.10)';   // 흙손 붓자국 — 완만한 호
    ctx.lineWidth = s / 42;
    for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.arc(R() * s, R() * s, s * (0.1 + R() * 0.24), R() * Math.PI * 2, R() * Math.PI * 2 + 0.8 + R());
        ctx.stroke();
    }
});
// 지붕 기와 — 스캘럽 한 장 한 장을 칠한다: 장마다 톤이 다르고, 아랫단 그림자·윗변 하이라이트로
// "겹쳐 얹힌 기와"가 읽힌다. (예전엔 균일 코랄판에 호 스트로크뿐이라 멀리서 민무늬)
const roofTex = canvasTex(128, 4, 3, (ctx, s) => {
    const R = seededRand(61);
    ctx.fillStyle = '#d96f5e';
    ctx.fillRect(0, 0, s, s);
    const rows = 4, cols = 4, rw = s / rows;
    for (let r = rows; r >= 0; r--) {   // 위에서 아래로 겹치게 — 아랫장을 먼저
        for (let q = -1; q <= cols; q++) {
            const cx = q * (s / cols) + (r % 2 ? s / (cols * 2) : 0) + s / (cols * 2);
            const cy = r * rw;
            const tone = 0.88 + R() * 0.24;   // 장별 톤 편차
            ctx.fillStyle = `rgb(${Math.round(239 * tone)},${Math.round(138 * tone)},${Math.round(122 * tone)})`;
            ctx.beginPath();
            ctx.arc(cx, cy, s / cols / 2, 0, Math.PI);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,235,225,0.5)';   // 윗변 하이라이트
            ctx.lineWidth = s / 110;
            ctx.beginPath();
            ctx.arc(cx, cy, s / cols / 2 - s / 220, 0.15, Math.PI - 0.15);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(120,40,30,0.4)';     // 아랫단 그림자선
            ctx.lineWidth = s / 70;
            ctx.beginPath();
            ctx.arc(cx, cy + s / 100, s / cols / 2, 0.35, Math.PI - 0.35);
            ctx.stroke();
        }
    }
});
// 마루널 — 널 사이 이음선 + 널마다 톤/나뭇결. 집 바닥·다락 슬래브용.
const plankTex = canvasTex(128, 2, 2, (ctx, s) => {
    const R = seededRand(67);
    const rows = 5;
    for (let r = 0; r < rows; r++) {
        const tone = 0.9 + R() * 0.22;
        ctx.fillStyle = `rgb(${Math.round(206 * tone)},${Math.round(172 * tone)},${Math.round(128 * tone)})`;
        ctx.fillRect(0, (r * s) / rows, s, s / rows);
        ctx.strokeStyle = 'rgba(120,90,60,0.55)';   // 이음선
        ctx.lineWidth = s / 90;
        ctx.beginPath();
        ctx.moveTo(0, (r * s) / rows);
        ctx.lineTo(s, (r * s) / rows);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(150,115,80,0.3)';   // 나뭇결
        ctx.lineWidth = s / 140;
        for (let i = 0; i < 3; i++) {
            const y = (r + 0.2 + R() * 0.6) * (s / rows);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.bezierCurveTo(s * 0.3, y + (R() - 0.5) * 5, s * 0.7, y + (R() - 0.5) * 5, s, y);
            ctx.stroke();
        }
        const jx = R() * s;   // 널 끝 세로 이음 — 한 줄에 하나
        ctx.strokeStyle = 'rgba(120,90,60,0.45)';
        ctx.lineWidth = s / 110;
        ctx.beginPath();
        ctx.moveTo(jx, (r * s) / rows);
        ctx.lineTo(jx, ((r + 1) * s) / rows);
        ctx.stroke();
    }
});
// 벽돌 — 굴뚝용: 지그재그 줄눈 + 장별 톤.
const brickTex = canvasTex(64, 1.6, 3, (ctx, s) => {
    const R = seededRand(71);
    ctx.fillStyle = '#d9cfc4';   // 줄눈 모르타르
    ctx.fillRect(0, 0, s, s);
    const rows = 5, bw = s / 2.5, bh = s / rows;
    for (let r = 0; r < rows; r++) {
        for (let q = -1; q < 4; q++) {
            const x = q * bw + (r % 2 ? bw / 2 : 0);
            const tone = 0.86 + R() * 0.3;
            ctx.fillStyle = `rgb(${Math.round(201 * tone)},${Math.round(120 * tone)},${Math.round(105 * tone)})`;
            ctx.fillRect(x + s / 42, r * bh + s / 42, bw - s / 21, bh - s / 21);
        }
    }
});
// 원형 러그 — 동심 링 패턴 (원기둥 윗면의 원형 UV에 맞춰 캔버스 중심 기준으로 그린다).
const rugTex = canvasTex(128, 1, 1, (ctx, s) => {
    const c = s / 2;
    const rings = [
        [0.5, '#e8b9a0'], [0.44, '#f6dfc4'], [0.36, '#efc9aa'],
        [0.28, '#f9ead2'], [0.18, '#f2d5b4'], [0.09, '#fbf0dc'],
    ];
    for (const [rr, col] of rings) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(c, c, s * rr, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.strokeStyle = 'rgba(190,130,95,0.5)';   // 테두리 스티치
    ctx.lineWidth = s / 64;
    ctx.setLineDash([s / 32, s / 40]);
    ctx.beginPath();
    ctx.arc(c, c, s * 0.465, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
});
// 벽 그림 두 점 — ① 바다와 노을 ② 병아리·강아지 하트. 액자 안 캔버스용 미니 페인팅.
const artSeaTex = canvasTex(64, 1, 1, (ctx, s) => {
    const sky = ctx.createLinearGradient(0, 0, 0, s * 0.62);
    sky.addColorStop(0, '#ffd9a0');
    sky.addColorStop(1, '#ff9d7a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, s, s * 0.62);
    ctx.fillStyle = '#ffe9b8';   // 해
    ctx.beginPath(); ctx.arc(s * 0.62, s * 0.4, s * 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a90c2';   // 바다
    ctx.fillRect(0, s * 0.62, s, s * 0.38);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = s / 40;
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s * (0.1 + i * 0.18), s * (0.7 + i * 0.09));
        ctx.lineTo(s * (0.34 + i * 0.18), s * (0.7 + i * 0.09));
        ctx.stroke();
    }
});
const artPetsTex = canvasTex(64, 1, 1, (ctx, s) => {
    ctx.fillStyle = '#fdf4e5';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#f7dd66';   // 병아리
    ctx.beginPath(); ctx.arc(s * 0.32, s * 0.58, s * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8dccb';   // 강아지
    ctx.beginPath(); ctx.arc(s * 0.68, s * 0.58, s * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f78fb3';   // 하트
    const hx = s * 0.5, hy = s * 0.28, hs = s * 0.1;
    ctx.beginPath();
    ctx.arc(hx - hs / 2, hy, hs / 2, 0, Math.PI * 2);
    ctx.arc(hx + hs / 2, hy, hs / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(hx - hs, hy + hs * 0.2);
    ctx.lineTo(hx, hy + hs * 1.1);
    ctx.lineTo(hx + hs, hy + hs * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2b2b33';   // 눈 네 점
    for (const [ex, ey] of [[0.27, 0.55], [0.37, 0.55], [0.63, 0.55], [0.73, 0.55]]) {
        ctx.beginPath(); ctx.arc(s * ex, s * ey, s * 0.018, 0, Math.PI * 2); ctx.fill();
    }
});
// 벽시계 문자반 — 원기둥 윗면 UV용.
const clockTex = canvasTex(64, 1, 1, (ctx, s) => {
    const c = s / 2;
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a3a44';
    for (let i = 0; i < 12; i++) {   // 시각 눈금
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(c + Math.cos(a) * c * 0.78, c + Math.sin(a) * c * 0.78, s * (i % 3 ? 0.02 : 0.035), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.strokeStyle = '#3a3a44';   // 바늘 — 10시 10분
    ctx.lineCap = 'round';
    ctx.lineWidth = s / 22;
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + c * 0.38 * Math.cos(-2.09), c + c * 0.38 * Math.sin(-2.09)); ctx.stroke();
    ctx.lineWidth = s / 30;
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + c * 0.58 * Math.cos(-1.05), c + c * 0.58 * Math.sin(-1.05)); ctx.stroke();
});
const awningTex = canvasTex(64, 3, 1, (ctx, s) => {
    for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? '#fdf0d5' : '#f6c96d';
        ctx.fillRect((i * s) / 4, 0, s / 4, s);
    }
});
const towelTex = canvasTex(64, 2, 1, (ctx, s) => {
    for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? '#ffe4ee' : '#ff8fb3';
        ctx.fillRect((i * s) / 4, 0, s / 4, s);
    }
});
const sandTex = canvasTex(64, 2, 2, (ctx, s) => {
    ctx.fillStyle = '#e8d8a8';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 80; i++) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '170,145,90' : '255,248,220'},0.20)`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5);
    }
});
// Tree crowns get a vertical shade gradient baked into vertex colors (dark under, lit on top) —
// the classic Animal Crossing foliage read.
// Baked top-lit gradient colors for a sphere geometry — split out so the season system can
// recompute a lobe's palette in place (top/bottom accept hex or THREE.Color).
// geo.userData.dapple(정점별 명암 지터)이 있으면 램프에 곱한다 — 계절이 잎색을 리베이크해도
// 퍼프의 얼룩덜룩한 질감이 살아남는 통로.
function gradColors(g, top, bottom) {
    const pos = g.attributes.position, r = g.parameters.radius;
    const dap = g.userData && g.userData.dapple;
    const cT = new THREE.Color(top), cB = new THREE.Color(bottom), c = new THREE.Color();
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const t = THREE.MathUtils.clamp(pos.getY(i) / r * 0.5 + 0.5, 0, 1);
        c.copy(cB).lerp(cT, t);
        const d = dap ? dap[i] : 1;
        cols[i * 3] = c.r * d; cols[i * 3 + 1] = c.g * d; cols[i * 3 + 2] = c.b * d;
    }
    return cols;
}
// 잎 로브: 실루엣은 원래의 매끈한 구(사용자 픽 — 변위 버전은 롤백). 질감은 색으로만:
// 방향 기반 노이즈로 "볼록한 데 밝고 골 어두운" dapple을 정점색에 굽는다 — 형태 불변,
// 잎 뭉치의 얼룩덜룩함만 얹힌다. dapple은 userData로 남아 계절 리베이크에도 보존.
function gradSphereGeo(r, topHex, bottomHex) {
    const g = new THREE.SphereGeometry(r, 18, 14);
    const pos = g.attributes.position;
    const dap = new Float32Array(pos.count);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).divideScalar(r);   // 단위 방향
        const n = Math.sin(v.x * 5.3 + v.y * 3.9) * Math.sin(v.y * 4.5 - v.z * 6.1) * Math.sin(v.z * 5.1 + v.x * 3.3)
                + 0.5 * Math.sin(v.x * 9.7 - v.y * 8.1) * Math.sin(v.z * 10.3 + v.y * 7.7);   // 큰 얼룩 + 잔 얼룩
        dap[i] = 1 + 0.17 * n;
    }
    g.userData.dapple = dap;
    g.setAttribute('color', new THREE.Float32BufferAttribute(gradColors(g, topHex, bottomHex), 3));
    return g;
}
// ---- 범용 그라디언트 굽기 (동숲식 셰이딩의 일반화): 나무 잎이 증명한 "위-밝음/아래-어두움
// 램프를 버텍스에 굽기"를 아무 지오메트리에나. 색은 지오메트리가 들고 재질은 공유(gradMat) —
// 한 프롭의 그라디언트 부품들이 재질이 같아져 mergePropGroup에서 드로우콜 1개로 합쳐진다.
// curve>1 = 아랫도리를 더 눌러 접지 AO 느낌. yMin/yMax로 램프 구간을 고정할 수도 있다.
function bakeGrad(geo, topHex, bottomHex, { yMin = null, yMax = null, curve = 1 } = {}) {
    const pos = geo.attributes.position;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < lo) lo = y; if (y > hi) hi = y; }
    if (yMin !== null) lo = yMin;
    if (yMax !== null) hi = yMax;
    const cT = new THREE.Color(topHex), cB = new THREE.Color(bottomHex), c = new THREE.Color();
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const t = Math.pow(THREE.MathUtils.clamp((pos.getY(i) - lo) / Math.max(1e-6, hi - lo), 0, 1), curve);
        c.copy(cB).lerp(cT, t);
        cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    return geo;
}
// 그라디언트 부품용 공유 재질: 민무늬/나무결. (InstancedMesh나 계절-틴트 재질에 쓸 땐 색을
// 흰~회색 루미넌스 램프로 구우면 material.color·instanceColor와 곱해져 틴트가 살아남는다.)
const gradMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
const gradMatWood = new THREE.MeshStandardMaterial({ vertexColors: true, map: woodTex, roughness: 0.95, metalness: 0 });
// 왕복형 Lathe 프로파일(안벽↑ 립 바깥벽↓)은 되돌아오는 구간의 와인딩이 뒤집혀 앞면 컬링에
// 잡아먹힌다 — 그런 셸 조형(분수 수반·컵처럼 안팎이 다 보이는 것)만 양면 재질을 쓴다.
const gradMatDS = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
const GM = (geo, top, bottom, opts) => new THREE.Mesh(bakeGrad(geo, top, bottom, opts), gradMat);

// ---- Stage: a floating meadow island — gently rolling vertex-colored grass over a rounded dirt
// cliff, dressed with chubby pastel props. Pets still sense it ONLY through `world` below.
// WHERE everything sits (islands, bridges, house, flat pads, props) lives in world-layout.js —
// this file only knows HOW to build and simulate it. ----
function islandOf(x, z) {
    for (let i = 0; i < ISLANDS.length; i++) {
        const s = ISLANDS[i];
        if (Math.hypot(x - s.x, z - s.z) <= s.r - 0.3) return i;
    }
    return -1;
}
function onBridge(x, z) {
    for (const br of BRIDGES) {
        const dx = br.B.x - br.A.x, dz = br.B.z - br.A.z;
        const len2 = dx * dx + dz * dz;
        const t = ((x - br.A.x) * dx + (z - br.A.z) * dz) / len2;
        if (t < 0 || t > 1) continue;
        if (Math.hypot(br.A.x + dx * t - x, br.A.z + dz * t - z) < 0.34) return { br, t };
    }
    for (const br of FERRY_PIERS) {   // ⛴️ 잔교 데크 — 다리 문법 재사용 (평평, BRIDGES 인덱스 매핑과 분리)
        const dx = br.B.x - br.A.x, dz = br.B.z - br.A.z;
        const len2 = dx * dx + dz * dz;
        const t = ((x - br.A.x) * dx + (z - br.A.z) * dz) / len2;
        if (t < 0 || t > 1) continue;
        if (Math.hypot(br.A.x + dx * t - x, br.A.z + dz * t - z) < 0.4) return { br, t, pier: true };
    }
    return null;
}
function bridgeDeckY(hit) {
    if (hit.pier) return 0.12;                        // 잔교는 평평한 데크 (파도·조수 위)
    return 0.05 + Math.sin(hit.t * Math.PI) * 0.22;   // gentle arch over the water
}

// ---- 복층집 (two-story house) walk-space: the interior is part of the world's heightfield —
// floor 1 up front, a stair ramp along the right wall, a loft over the back half. houseFloorY
// returns the walk height inside (null outside); houseBlocked fences the walls, porch posts and
// the loft-edge line (which doubles as the under-loft partition below and the railing above).
const HOUSE_COS = Math.cos(HOUSE.rotY), HOUSE_SIN = Math.sin(HOUSE.rotY);
function houseLocal(x, z) {
    const dx = x - HOUSE.x, dz = z - HOUSE.z;
    return { lx: dx * HOUSE_COS - dz * HOUSE_SIN, lz: dx * HOUSE_SIN + dz * HOUSE_COS };
}
function houseWorld(lx, lz) {
    return {
        x: HOUSE.x + lx * HOUSE_COS + lz * HOUSE_SIN,
        z: HOUSE.z - lx * HOUSE_SIN + lz * HOUSE_COS,
    };
}
// 리모델(1.3×1.04) 로컬 상수 — makeHouse 지오메트리와 1:1로 맞춘 값들 (기존 1.0×0.8의 ×1.3)
function houseFloorY(x, z) {
    const { lx, lz } = houseLocal(x, z);
    if (Math.abs(lx) > HOUSE.hw || Math.abs(lz) > HOUSE.hd) return null;
    if (lz <= -0.325) return HOUSE.loftY;                                  // loft over the back half
    if (lx >= 0.81 && lz <= 0.715) {                                       // stair ramp along the right wall
        const k = THREE.MathUtils.clamp((0.715 - lz) / 1.04, 0, 1);
        return HOUSE.floorY + k * (HOUSE.loftY - HOUSE.floorY);
    }
    return HOUSE.floorY;
}
function houseBlocked(x, z) {
    const { lx, lz } = houseLocal(x, z);
    if (Math.abs(lx) > HOUSE.hw + 0.1 || Math.abs(lz) > HOUSE.hd + 0.1) return false;
    if (Math.abs(lx) > HOUSE.hw - 0.06) return true;                       // side walls
    if (lz < -(HOUSE.hd - 0.06)) return true;                              // back wall
    if (lz > -0.403 && lz < -0.247 && lx < 0.715) return true;             // loft railing / under-loft partition
    if (Math.hypot(lx - 1.04, lz - 0.962) < 0.1) return true;              // porch posts
    if (Math.hypot(lx + 1.04, lz - 0.962) < 0.1) return true;
    return false;
}

const stage = new THREE.Group();
scene.add(stage);

// Terrain: soft rolling bumps that settle flat at the rim and under the FLAT_SPOTS pads. This ONE
// function feeds both the visible mesh and world.groundHeightAt, so feet, props, the select ring
// and the catch ball always agree with what you see.
function terrainHeight(x, z) {
    for (const isl of ISLANDS) {
        const rr = Math.hypot(x - isl.x, z - isl.z);
        if (rr >= isl.r) continue;
        if (isl.kind === 'sand') {
            // 해변 프로파일: 중심의 낮은 사구 → 바깥 띠는 물밑으로 잠긴다 (f≈0.95쯤에서 수면
            // -0.52와 교차) — 섬이 물 위에 "떠 있는" 대신 물가선이 모래 중턱을 지나가고, 파도와
            // 조수를 따라 밀렸다 쓸렸다 한다. 위엔 잔물결 사구 굴곡만 살짝.
            const f = rr / isl.r;
            let h = 0.07 - 0.65 * THREE.MathUtils.smoothstep(f, 0.4, 1.08)
                  + 0.018 * Math.sin(x * 3.1 + 0.7) * Math.sin(z * 2.7 - 1.2);
            for (const s of FLAT_SPOTS) {
                h *= THREE.MathUtils.smoothstep(Math.hypot(x - s.x, z - s.z), s.r * 0.55, s.r);
            }
            return h;
        }
        let h = 0.05 * Math.sin(x * 1.7 + 1.3) * Math.sin(z * 1.9 - 0.7)
              + 0.04 * Math.sin((x + z) * 1.1 + 2.1) + 0.045;
        // 언덕: 고원형 봉우리 (정상 35%는 평평 — 데크 자리, 사면은 걸어 오르는 완경사)
        for (const hl of HILLS) {
            const d = Math.hypot(x - hl.x, z - hl.z);
            if (d < hl.r) h += hl.h * (1 - THREE.MathUtils.smoothstep(d, hl.r * 0.35, hl.r));
        }
        h *= THREE.MathUtils.smoothstep(isl.r - rr, 0, 0.9);
        for (const s of FLAT_SPOTS) {
            h *= THREE.MathUtils.smoothstep(Math.hypot(x - s.x, z - s.z), s.r * 0.55, s.r);
        }
        return h;
    }
    return 0;
}

// Island meshes: every island in the archipelago gets the same treatment — a polar-grid grass top
// displaced by terrainHeight (AC triangle texture + near-white vertex patches, resolution scaled
// to the island's radius) over a lathed strata cliff tapering to a rounded tip.
function buildIslandMeshes(isl) {
    const sand = isl.kind === 'sand';   // 휴양지 모래섬 — 텍스처·얼룩 팔레트·해변 경사·스커트 톤이 갈린다
    const rings = Math.max(16, Math.round(isl.r * 6.5));
    const segs = Math.max(48, Math.round(isl.r * 18));
    const positions = [], colors = [], uvs = [], indices = [];
    const base = sand ? new THREE.Color(0.97, 0.95, 0.9) : new THREE.Color(0.93, 0.95, 0.88);
    const light = sand ? new THREE.Color(1.06, 1.04, 0.98) : new THREE.Color(1.07, 1.1, 1.0);
    const warmG = sand ? new THREE.Color(1.09, 1.02, 0.88) : new THREE.Color(1.1, 1.05, 0.8);
    const coolG = sand ? new THREE.Color(0.9, 0.9, 0.96) : new THREE.Color(0.8, 0.94, 1.02);
    const c = new THREE.Color();
    for (let i = 0; i <= rings; i++) {
        const r = (i / rings) * isl.r;
        for (let j = 0; j < segs; j++) {
            const a = (j / segs) * Math.PI * 2;
            const x = isl.x + Math.cos(a) * r, z = isl.z + Math.sin(a) * r;
            // 높이는 경계 살짝 안쪽에서 샘플 — terrainHeight는 rr ≥ r에서 0으로 떨어져서, 최외곽
            // 링이 해변 높이(-0.55)에서 0으로 튀며 섬 테두리에 사다리꼴 왕관 톱니를 세웠었다.
            const hr = Math.min(r, isl.r - 0.002);
            const y = terrainHeight(isl.x + Math.cos(a) * hr, isl.z + Math.sin(a) * hr);
            positions.push(x, y, z);
            uvs.push(x * 0.8, z * 0.8);                 // planar world mapping — pattern flows across islands
            const patch = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
            c.copy(base).lerp(light, Math.min(1, patch * 0.45 + y * 2.2));
            // 저주파 웜/쿨 얼룩 (2~3m 붓터치): 균일한 초록 카펫 느낌을 깨고 프롭을 지면에 앉힌다.
            // 곱셈 계열(1.0 근방) 틴트라 grassTex·계절 틴트·설원 텍스처와 그대로 합성된다.
            const blotch = Math.sin(x * 1.05 + Math.sin(z * 0.85) * 1.6) * Math.sin(z * 1.2 + Math.sin(x * 0.75) * 1.4);
            if (blotch > 0) c.lerp(warmG, blotch * 0.16);
            else c.lerp(coolG, -blotch * 0.14);
            colors.push(c.r, c.g, c.b);
        }
    }
    // 잔디 스커트(turf lip): 테두리에서 절벽 안쪽으로 말려 내려가는 한 겹. 굴곡진 잔디 끝단(y가
    // 지형 따라 들쭉날쭉)과 고정 높이 절벽 상단(0.004) 사이에 각도에 따라 틈이 생겨 낮은 앵글에서
    // 섬 내부가 관통돼 보이던 것을 모든 방향에서 봉인한다 — 동숲 섬의 "잔디가 절벽을 덮는 입술".
    const skirtStart = positions.length / 3;
    for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = isl.x + Math.cos(a) * isl.r * 1.004, z = isl.z + Math.sin(a) * isl.r * 1.004;
        positions.push(x, sand ? -0.74 : -0.26, z);   // 모래섬 테두리는 이미 물밑(-0.55) — 스커트도 더 아래로
        uvs.push(x * 0.8, z * 0.8);
        if (sand) colors.push(0.8, 0.72, 0.56);    // 젖은 모래 톤 — 물밑 모래턱으로 이어진다
        else colors.push(0.52, 0.47, 0.4);         // 흙그늘 톤 — 지층 절벽과 이어지는 어두운 립
    }
    for (let i = 0; i < rings; i++) {
        for (let j = 0; j < segs; j++) {
            const a = i * segs + j;
            const b = i * segs + (j + 1) % segs;
            const d = (i + 1) * segs + j;
            const e = (i + 1) * segs + (j + 1) % segs;
            indices.push(a, b, d, b, e, d);
        }
    }
    for (let j = 0; j < segs; j++) {   // 마지막 잔디 링 → 스커트 링
        const a = rings * segs + j;
        const b = rings * segs + (j + 1) % segs;
        const d = skirtStart + j;
        const e = skirtStart + (j + 1) % segs;
        indices.push(a, b, d, b, e, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    // DoubleSide: 물이 반투명이라 수면 너머로 섬 껍데기의 뒷면이 보이는 각도가 있다 — 한 면
    // 컬링이면 그 자리가 "뚫린 것"처럼 하늘/건너편이 비친다. 잔디·절벽 둘 다 양면으로.
    const grass = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: sand ? sandTopTex : grassTex, vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
    grass.receiveShadow = true;
    stage.add(grass);
    if (!sand) seasonGrass.push(grass);   // the season system re-tints this (and snow-swaps its texture) — 열대 휴양지는 사계절 모래

    // 모래섬은 절벽 대신 해변 경사 — 지면 테두리(이미 물밑 -0.55)에서 물속 모래턱으로 이어진다
    const pts = sand ? [
        new THREE.Vector2(isl.r, -0.54),
        new THREE.Vector2(isl.r * 1.005, -0.64),
        new THREE.Vector2(isl.r * 0.9, -0.82),
        new THREE.Vector2(isl.r * 0.55, -0.98),
        new THREE.Vector2(0.05, -1.06),
    ] : [
        new THREE.Vector2(isl.r, 0.004),
        new THREE.Vector2(isl.r * 0.995, -0.12),
        new THREE.Vector2(isl.r * 0.93, -0.42),
        new THREE.Vector2(isl.r * 0.72, -0.78),
        new THREE.Vector2(isl.r * 0.42, -1.0),
        new THREE.Vector2(0.05, -1.14),
    ];
    const cliff = new THREE.Mesh(
        new THREE.LatheGeometry(pts, Math.max(48, Math.round(isl.r * 14))),
        sand
            ? new THREE.MeshStandardMaterial({ map: sandTopTex, color: 0xf2e3bd, roughness: 1, metalness: 0, side: THREE.DoubleSide })
            : new THREE.MeshStandardMaterial({ map: strataTex, roughness: 1, metalness: 0, flatShading: true, side: THREE.DoubleSide })
    );
    cliff.position.set(isl.x, 0, isl.z);
    cliff.castShadow = true;         // islands shade the sea at low sun
    cliff.receiveShadow = true;
    stage.add(cliff);
}
for (const isl of ISLANDS) buildIslandMeshes(isl);

// Props are placed from the world-layout.js data list — the builders below are the HOW.
const BEDS = [];   // filled during prop placement: where pets sleep at night / lie via Ctrl
const SWINGS = []; // swing seats (also pushed into BEDS so mount/⌘ reuse works) — each is a pendulum
const SEESAWS = [];        // seesaw seats (in BEDS too); two per plank share one tilting body
const SEESAW_BODIES = [];  // the tilting planks — one shared angle drives both of its seats
// 월드 팔레트 가이드 (퀄리티 패스 ④): 파스텔 톤 유지 — 나무 0xb08a60/0x8a6647 계열, 돌·바위는
// 웜 베이지(0xc2b096~0xa08d74, 순수 회색 금지), 포인트 색은 파스텔 원색(코랄 f5a394 · 민트 93d1c8 ·
// 하늘 a5d6ef · 분홍 f7c6d3 · 꿀 e8c46f · 버터 f7dd66). 새 프롭은 이 대역에서 고르고, 정적 부품은
// bakeGrad(top, bottom)로 톱라이트 램프를 얹는 것이 기본 문법.
// bare M(color)는 색상별 공유 인스턴스다(월드 베이크가 소품 경계를 넘어 병합하는 열쇠) —
// 재질을 개별로 만지고 싶으면(색 애니메이션 등) extra를 넘기거나 전용 material을 만들 것.
// extra가 있으면 예전처럼 호출마다 새 인스턴스라 안전하다 (tuft·pebble의 계절 틴트가 이 경우).
const M_CACHE = new Map();
const M = (color, extra) => {
    if (extra && extra.unique) {   // 색·불투명도를 개별 애니메이션할 재질은 캐시 밖 (계절 틴트 등)
        const { unique, ...rest } = extra;
        return new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, ...rest });
    }
    const key = extra
        ? color + '|' + Object.entries(extra).map(([k, v]) => k + ':' + (v && v.uuid ? v.uuid : v)).sort().join('|')
        : color;
    if (!M_CACHE.has(key)) M_CACHE.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, ...(extra || {}) }));
    return M_CACHE.get(key);
};
const leafMatGrad = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });

function makeTree(p) {
    // Layout entries with a `variant` use the CC0 kit model; the fluffy procedural tree below
    // stays as the offline/load-failure fallback (and the way back if the kit look loses).
    if (p && p.variant) return kitProp(p.variant, { scale: p.kitScale || 1, fallback: () => makeProceduralTree(p) });
    return makeProceduralTree(p);
}
let seasonTreeNo = 0;   // stable per-tree pick from the autumn palette trio
function makeProceduralTree(p) {
    const g = new THREE.Group();
    const cherry = !!(p && p.cherry);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.095, 0.46, 10), M(cherry ? 0x8a5a48 : 0x9a6a45, { map: woodTex }));
    trunk.position.y = 0.23;
    g.add(trunk);
    // Fluffy crown: overlapping spheres with a baked top-lit gradient; the big (non-cherry) tree
    // gets berries. Every lobe registers with the season system — 잎 리베이크 + 겨울 눈모자 — and
    // a cherry tree carries its own falling-petal cloud (spring only), tree-local so it follows
    // the tree when construction mode moves it.
    const lobes = p && p.big
        ? [[0, 0.72, 0, 0.34, 0x7fd06c, 0x3f8f3a], [0.22, 0.6, 0.1, 0.26, 0x8fdc7a, 0x4da045], [-0.24, 0.62, -0.06, 0.27, 0x8fdc7a, 0x4da045], [0.02, 0.92, -0.02, 0.24, 0x8fdc7a, 0x4da045], [0.05, 0.55, 0.24, 0.22, 0x7fd06c, 0x3f8f3a]]
        : [[0, 0.62, 0, 0.28, 0x7fd06c, 0x3f8f3a], [0.18, 0.52, 0.08, 0.2, 0x8fdc7a, 0x4da045], [-0.18, 0.55, -0.05, 0.21, 0x8fdc7a, 0x4da045], [0, 0.78, 0, 0.18, 0x8fdc7a, 0x4da045]];
    const treeNo = seasonTreeNo++;
    lobes.forEach(([x, y, z, r, top, bottom], li) => {
        const geo = gradSphereGeo(r, top, bottom);
        const s = new THREE.Mesh(geo, leafMatGrad);
        s.position.set(x, y, z);
        g.add(s);
        seasonLeaves.push({ geo, orig: [top, bottom], cherry, treeNo, li });
        const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.045, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.4), snowCapMat);
        cap.position.set(x, y, z);
        cap.visible = false;
        g.add(cap);
        seasonSnowCaps.push(cap);
    });
    if (p && p.big && !cherry) {
        const berry = M(0xff6b6b);
        for (const [x, y, z] of [[0.2, 0.78, 0.18], [-0.25, 0.7, 0.14], [0.05, 0.98, 0.12], [0.3, 0.58, -0.1]]) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), berry);
            b.position.set(x, y, z);
            g.add(b);
        }
    }
    if (cherry) {
        const petals = precipPoints(90, petalTex, 0.055, 0.2, 0.4, 0.3, 1.05, 1.4, 1.5, g);
        seasonFall.push({ pts: petals, when: 'spring' });
    }
    return g;
}

// 🌴 야자수 (휴양지 모래섬): 통짜 굽은 트렁크(정점 벤딩 — 이음새 없음) + 커브를 타는 마디 링 +
// 톱니 알파 프론드 9장(잎맥 텍스처, 처짐 커브, 알파 인지 그림자). 열대 상록이라 계절 시스템
// (seasonLeaves/snowCaps)에 등록하지 않는다 — 겨울에도 초록.
function makePalm() {
    const g = new THREE.Group();
    const bend = (t) => 0.34 * t * t;   // +x로 휘는 야자수 커브 (t = 0..1 높이 비율)
    const TRUNK_H = 0.98;
    // 트렁크: 원기둥 하나를 커브로 벤딩 — 세그먼트 조립이 아니라서 "분리된 몸통"이 없다
    const trunkGeo = new THREE.CylinderGeometry(0.042, 0.064, TRUNK_H, 9, 8).translate(0, TRUNK_H / 2, 0);
    {
        const pos = trunkGeo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const t = pos.getY(i) / TRUNK_H;
            pos.setX(i, pos.getX(i) + bend(t));
        }
        trunkGeo.computeVertexNormals();
    }
    const trunk = new THREE.Mesh(bakeGrad(trunkGeo, 0xbf9264, 0x775134, { curve: 1.2 }), gradMat);
    g.add(trunk);
    const ringMat = M(0x8a6647, { map: woodTex });
    for (let i = 1; i <= 5; i++) {   // 마디 링 — 같은 커브 위에 앉아 트렁크를 감싼다
        const t = i / 6;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.062 - t * 0.017, 0.011, 6, 12).rotateX(Math.PI / 2), ringMat);
        ring.position.set(bend(t), t * TRUNK_H, 0);
        ring.rotation.z = -0.55 * t;   // 커브 기울기 따라 눕는다
        g.add(ring);
    }
    // 프론드: 벤트 스트립(끝으로 갈수록 좁아지고 처짐) + frondTex 톱니 잎 — 방사형 9장
    const crownX = bend(1), crownY = TRUNK_H;
    const frondGeo = new THREE.PlaneGeometry(0.68, 0.2, 8, 1).translate(0.34, 0, 0);
    {
        const pos = frondGeo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const t = pos.getX(i) / 0.68;
            pos.setY(i, pos.getY(i) * (1 - 0.45 * t));   // 끝 테이퍼
        }
        frondGeo.rotateX(-Math.PI / 2);                  // XZ 평면으로 (길이 x · 폭 z)
        for (let i = 0; i < pos.count; i++) {
            const t = pos.getX(i) / 0.68;
            pos.setY(i, 0.1 * t - 0.42 * t * t);         // 살짝 들렸다가 끝이 처지는 야자잎 커브
        }
        frondGeo.computeVertexNormals();
    }
    for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.3;
        const frond = new THREE.Mesh(frondGeo, palmFrondMat);
        frond.customDepthMaterial = palmFrondDepth;      // 그림자도 톱니 모양대로
        frond.position.set(crownX, crownY + 0.02, 0);
        frond.rotation.y = -a;
        frond.rotation.z = -0.08 - (i % 3) * 0.1;        // 세 단으로 층지게
        frond.scale.setScalar(0.85 + ((i * 37) % 10) / 10 * 0.3);
        g.add(frond);
    }
    const crownBase = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), ringMat);   // 잎 밑동 뭉치
    crownBase.position.set(crownX, crownY + 0.01, 0);
    g.add(crownBase);
    const coconutMat = M(0x9a7a56);
    for (const [cx, cz] of [[0.07, 0.045], [-0.035, 0.08], [0.02, -0.08]]) {
        const nut = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), coconutMat);
        nut.position.set(crownX + cx, crownY - 0.045, cz);
        g.add(nut);
    }
    return g;
}
// 🏰 모래성 (휴양지 모래섬): 양동이로 찍은 성 — 원기둥 킵 + 코너 타워 4 + 성벽 + 총안 + 깃발.
// 전부 모래 램프(bakeGrad) 정적 조형이라 월드 베이크에 흡수된다.
function makeSandcastle() {
    const g = new THREE.Group();
    const sTop = 0xf6e7c2, sBot = 0xc9ad82;
    const mound = GM(new THREE.CylinderGeometry(0.42, 0.5, 0.07, 18), sTop, sBot);   // 받침 모래둔덕
    mound.position.y = 0.035;
    g.add(mound);
    const keep = GM(new THREE.CylinderGeometry(0.13, 0.155, 0.3, 12), sTop, sBot, { curve: 1.2 });   // 중앙 킵
    keep.position.y = 0.22;
    g.add(keep);
    for (let i = 0; i < 5; i++) {   // 킵 흉벽(총안)
        const a = (i / 5) * Math.PI * 2;
        const merlon = GM(new THREE.BoxGeometry(0.05, 0.05, 0.035), sTop, sBot);
        merlon.position.set(Math.cos(a) * 0.115, 0.395, Math.sin(a) * 0.115);
        merlon.rotation.y = -a;
        g.add(merlon);
    }
    const towerPos = [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]];
    for (const [tx, tz] of towerPos) {   // 코너 타워 + 고깔 지붕
        const tower = GM(new THREE.CylinderGeometry(0.07, 0.085, 0.2, 10), sTop, sBot, { curve: 1.2 });
        tower.position.set(tx, 0.17, tz);
        g.add(tower);
        const cone = GM(new THREE.ConeGeometry(0.085, 0.09, 10), sTop, sBot);
        cone.position.set(tx, 0.315, tz);
        g.add(cone);
    }
    for (const [[ax, az], [bx, bz]] of [[towerPos[0], towerPos[1]], [towerPos[1], towerPos[3]], [towerPos[3], towerPos[2]], [towerPos[2], towerPos[0]]]) {
        const wall = GM(new THREE.BoxGeometry(Math.hypot(bx - ax, bz - az) - 0.12, 0.11, 0.06), sTop, sBot);   // 성벽
        wall.position.set((ax + bx) / 2, 0.125, (az + bz) / 2);
        wall.rotation.y = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
        g.add(wall);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), M(0xb08a60, { map: woodTex }));   // 깃대
    pole.position.y = 0.475;
    g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.055), new THREE.MeshLambertMaterial({ color: 0xf05a5a, side: THREE.DoubleSide }));
    flag.position.set(0.048, 0.52, 0);
    g.add(flag);
    return g;
}

function makeHouse() {
    // Two-story dollhouse (리모델 1.3×1.04): the front stays open so the camera sees inside.
    // Geometry matches the walk-space helpers exactly — floor at 0.05, stair ramp along the right
    // wall (lx 0.81~1.3, lz 0.715→-0.325), loft top at 0.78 over the back half (lz≤-0.325) with a
    // railing (gap where the stairs land), porch posts at (±1.04, 0.962).
    const g = new THREE.Group();
    const plaster = M(0xffffff, { map: plasterTex });
    const wood = M(0xb08a60, { map: woodTex });
    const woodDark = M(0x8a6647, { map: woodTex });
    const plank = M(0xd8b88a, { map: plankTex });
    const trimWhite = M(0xfffbf2);
    const wallH = 1.55;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 2.08), plank);
    floor.position.y = 0.02;
    g.add(floor);
    // 포치 데크 + 계단 + 도어매트 — 현관의 "얼굴"
    const porch = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.5), wood);
    porch.position.set(0, 0.03, 1.3);
    g.add(porch);
    const porchStep = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.2), woodDark);
    porchStep.position.set(0, 0.02, 1.63);
    g.add(porchStep);
    const doormat = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.012, 22), M(0xffffff, { map: rugTex }));
    doormat.position.set(0, 0.066, 1.3);
    g.add(doormat);
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.06, wallH, 2.08), plaster);
    wallL.position.set(-1.3, wallH / 2, 0);
    g.add(wallL);
    const wallR = wallL.clone();
    wallR.position.x = 1.3;
    g.add(wallR);
    const wallB = new THREE.Mesh(new THREE.BoxGeometry(2.66, wallH, 0.06), plaster);
    wallB.position.set(0, wallH / 2, -1.04);
    g.add(wallB);
    // 목구조 트림: 모서리 기둥 4 + 층간 띠 + 정면 상단 인방 — 흰 박스가 "지어진 집"으로 읽히는 뼈대
    for (const [cx, cz] of [[-1.3, -1.04], [1.3, -1.04], [-1.3, 1.04], [1.3, 1.04]]) {
        const corner = new THREE.Mesh(new THREE.BoxGeometry(0.1, wallH + 0.02, 0.1), woodDark);
        corner.position.set(cx, wallH / 2, cz);
        g.add(corner);
    }
    for (const sx of [-1, 1]) {   // 층간 띠 (측벽 바깥면)
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 2.1), woodDark);
        band.position.set(sx * 1.325, 0.78, 0);
        g.add(band);
    }
    const bandB = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.08, 0.03), woodDark);   // 층간 띠 (뒷벽)
    bandB.position.set(0, 0.78, -1.065);
    g.add(bandB);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.1, 0.1), wood);   // 정면 인방
    lintel.position.set(0, wallH - 0.05, 1.0);
    g.add(lintel);
    for (const px of [-1.04, 1.04]) {   // 포치 기둥 (houseBlocked의 원과 1:1)
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, wallH, 10), wood);
        post.position.set(px, wallH / 2, 0.962);
        g.add(post);
        const postCap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), wood);
        postCap.position.set(px, wallH + 0.02, 0.962);
        g.add(postCap);
    }
    // 측면 창 — 십자 살 + 창턱 + 화단 (동숲 창의 문법)
    for (const sx of [-1, 1]) {
        const frame = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.4, 0.4, 2, 0.025), trimWhite);
        frame.position.set(sx * 1.31, 0.82, 0.39);
        g.add(frame);
        const pane = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.32, 0.32), M(0xbfe3f2));
        pane.position.copy(frame.position);
        g.add(pane);
        const munV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, 0.024), trimWhite);   // 세로 살
        munV.position.copy(frame.position);
        g.add(munV);
        const munH = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.024, 0.32), trimWhite);   // 가로 살
        munH.position.copy(frame.position);
        g.add(munH);
        const sill = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.46), trimWhite);
        sill.position.set(sx * 1.315, 0.6, 0.39);
        g.add(sill);
        const flowerBox = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.38), woodDark);   // 창가 화단
        flowerBox.position.set(sx * 1.34, 0.53, 0.39);
        g.add(flowerBox);
        for (let fi = 0; fi < 3; fi++) {
            const fl = new THREE.Mesh(
                new THREE.PlaneGeometry(0.075, 0.075).rotateX(-Math.PI / 2),
                new THREE.MeshLambertMaterial({ map: flowerTex, alphaTest: 0.4, side: THREE.DoubleSide, color: [0xff8fb3, 0xffd54f, 0xff8a65][fi] }));
            fl.position.set(sx * 1.34, 0.585, 0.28 + fi * 0.11);
            g.add(fl);
        }
    }
    // 다락 뒷창 — 침실에 빛
    {
        const frame = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.34, 0.07, 2, 0.025), trimWhite);
        frame.position.set(-0.42, 1.18, -1.05);
        g.add(frame);
        const pane = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.08), M(0xbfe3f2));
        pane.position.copy(frame.position);
        g.add(pane);
        const munV = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.26, 0.085), trimWhite);
        munV.position.copy(frame.position);
        g.add(munV);
        const munH = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.024, 0.085), trimWhite);
        munH.position.copy(frame.position);
        g.add(munH);
    }
    // loft slab (top at 0.78), stairs, railing, under-loft partition
    const loft = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.715), plank);
    loft.position.set(0, 0.75, -0.6825);
    g.add(loft);
    const loftEdge = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.07, 0.06), woodDark);   // 다락 앞단 마감재
    loftEdge.position.set(-0.29, 0.75, -0.325);
    g.add(loftEdge);
    const STEPS = 10;
    for (let i = 0; i < STEPS; i++) {
        const h = 0.05 + ((i + 1) / STEPS) * 0.73;
        const stp = new THREE.Mesh(new THREE.BoxGeometry(0.44, h, 0.104), woodDark);
        stp.position.set(1.05, h / 2, 0.715 - (i + 0.5) * 0.104);
        g.add(stp);
    }
    for (let i = 0; i <= 6; i++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.34, 8), wood);
        post.position.set(-1.2 + i * 0.3, 0.95, -0.325);
        g.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.05, 0.06), wood);
    rail.position.set(-0.3, 1.14, -0.325);
    g.add(rail);
    const partition = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 0.05), plaster);
    partition.position.set(-0.3, 0.4, -0.325);
    g.add(partition);
    // 지붕: 리페인트 기와 + 처마 페시아 + 꼭대기 피니얼
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.35, 0.98, 4), M(0xffffff, { map: roofTex, flatShading: true }));
    roof.position.y = wallH + 0.49;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    for (const [fx, fz, fw, fd] of [[1.63, 0, 0.06, 3.3], [-1.63, 0, 0.06, 3.3], [0, 1.63, 3.3, 0.06], [0, -1.63, 3.3, 0.06]]) {
        const fascia = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.09, fd), woodDark);
        fascia.position.set(fx, wallH + 0.02, fz);
        g.add(fascia);
    }
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), M(0xe8c46f));
    finial.position.y = wallH + 0.98 + 0.04;
    g.add(finial);
    const roofSnow = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.64, 4), snowCapMat);   // 겨울 지붕 눈이불 — 지붕보다 완만한 경사라 어디서나 살짝 도드라진다
    roofSnow.position.y = wallH + 0.72;
    roofSnow.rotation.y = Math.PI / 4;
    roofSnow.visible = false;
    g.add(roofSnow);
    seasonSnowCaps.push(roofSnow);
    const chimney = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.44, 0.2, 3, 0.02), M(0xffffff, { map: brickTex }));
    chimney.position.set(-0.72, wallH + 0.62, -0.46);
    g.add(chimney);
    const chimneyCap = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.07, 0.26, 2, 0.02), M(0xc4b6a0));
    chimneyCap.position.set(-0.72, wallH + 0.87, -0.46);
    g.add(chimneyCap);
    // ---- floor-1 furniture: sofa (sit here!), low table + reading lamp, rug, bookshelf ----
    const sofa = new THREE.Group();
    const sofaBase = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.14, 0.78, 3, 0.04), M(0x7aa6dc));
    sofaBase.position.y = 0.1;
    sofa.add(sofaBase);
    for (const cz of [-0.19, 0.19]) {   // 좌방석 두 장 — "앉는 자리"가 읽힌다
        const cushion = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.09, 0.34, 3, 0.035), M(0x8fb7e8));
        cushion.position.set(0.01, 0.19, cz);
        sofa.add(cushion);
    }
    const backRest = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.4, 0.78, 3, 0.045), M(0x7aa6dc));
    backRest.position.set(-0.17, 0.26, 0);
    sofa.add(backRest);
    for (const bz of [-0.19, 0.19]) {   // 등쿠션
        const bp = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.26, 0.3, 3, 0.035), M(0xa5c8f0));
        bp.position.set(-0.1, 0.33, bz);
        bp.rotation.z = -0.18;
        sofa.add(bp);
    }
    for (const az of [-0.35, 0.35]) {
        const arm = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.13, 0.1, 2, 0.04), M(0x6f9bd2));
        arm.position.set(0, 0.24, az);
        sofa.add(arm);
    }
    for (const [lx2, lz2] of [[-0.15, -0.32], [0.15, -0.32], [-0.15, 0.32], [0.15, 0.32]]) {   // 다리
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.06, 8), woodDark);
        leg.position.set(lx2, 0.03, lz2);
        sofa.add(leg);
    }
    sofa.position.set(-0.884, 0.05, 0.26);
    g.add(sofa);
    const table = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 20), wood);
    top.position.y = 0.18;
    table.add(top);
    const legT = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.05, 0.17, 10), woodDark);
    legT.position.y = 0.085;
    table.add(legT);
    const legFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.025, 12), woodDark);
    legFoot.position.y = 0.012;
    table.add(legFoot);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.1, 10), M(0x5a6a75));
    lampBase.position.set(-0.09, 0.25, -0.06);
    table.add(lampBase);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.08, 12, 1, true), lampGlobeMat);
    shade.position.set(-0.09, 0.33, -0.06);
    table.add(shade);
    // 탁자 위 그림일기장 📔 — 내용은 독의 📔 버튼으로 읽는다 (밤마다 펫이 쓴다).
    const diaryBook = new THREE.Group();
    const pageL = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.008, 0.115), M(0xfdf3df));
    pageL.position.x = -0.043;
    pageL.rotation.z = 0.09;
    const pageR = pageL.clone();
    pageR.position.x = 0.043;
    pageR.rotation.z = -0.09;
    const spineB = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 0.115), M(0xc96f6f));
    diaryBook.add(pageL, pageR, spineB);
    diaryBook.position.set(0.11, 0.205, 0.05);
    diaryBook.rotation.y = -0.5;
    table.add(diaryBook);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.019, 0.035, 12), M(0xfff1cf));   // 찻잔
    cup.position.set(-0.02, 0.218, 0.13);
    table.add(cup);
    table.position.set(0, 0.05, 0.195);
    g.add(table);
    const rug = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.012, 28), M(0xffffff, { map: rugTex }));
    rug.position.set(-0.2, 0.056, 0.29);
    g.add(rug);
    const shelf = new THREE.Group();
    const shelfBody = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.74, 0.44, 2, 0.02), woodDark);
    shelfBody.position.y = 0.37;
    shelf.add(shelfBody);
    const bookColors = [0xef8a8a, 0x8fb7e8, 0xffd54f, 0x9fd8c9, 0xb39ddb, 0xff8a65, 0xf6c560, 0x9fd8c9];
    for (let i = 0; i < 8; i++) {   // 두 단 가득 — 기울어진 책도 한 권씩
        const book = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.115, 0.04), M(bookColors[i]));
        book.position.set(0.065, i < 4 ? 0.56 : 0.28, -0.15 + (i % 4) * 0.09);
        if (i % 4 === 3) book.rotation.x = 0.22;
        shelf.add(book);
    }
    const shelfPot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.05, 10), M(0xc97b6e));   // 꼭대기 화분
    shelfPot.position.set(0.02, 0.77, 0.12);
    shelf.add(shelfPot);
    for (let i = 0; i < 3; i++) {
        const leafBall = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), M(0x5da95f));
        leafBall.position.set(0.02 + (i - 1) * 0.022, 0.82 + (i % 2) * 0.02, 0.12 + (i - 1) * 0.014);
        shelf.add(leafBall);
    }
    shelf.position.set(-1.014, 0.05, 0.676);
    g.add(shelf);
    // 벽 장식: 그림 두 점 + 벽시계 — "사는 집"의 마감
    const artFrame1 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.03), woodDark);
    artFrame1.position.set(-0.62, 0.5, -0.302);   // 파티션 정면 (소파 뒤 벽)
    g.add(artFrame1);
    const artCanvas1 = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.17), M(0xffffff, { map: artSeaTex }));
    artCanvas1.position.set(-0.62, 0.5, -0.284);
    g.add(artCanvas1);
    const clockFace = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.025, 20), M(0xffffff, { map: clockTex }));
    clockFace.rotation.x = Math.PI / 2;   // 윗면(문자반)이 +z를 본다
    clockFace.position.set(0.25, 0.56, -0.297);
    g.add(clockFace);
    // 펜던트 조명 — 지붕에서 테이블 위로 내려오는 코드 + 글로브 (밤이면 lampGlobeMat이 켠다)
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.42, 6), M(0x5a6a75));
    cord.position.set(0, wallH - 0.21, 0.195);
    g.add(cord);
    const pendant = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 12), lampGlobeMat);
    pendant.position.set(0, wallH - 0.46, 0.195);
    g.add(pendant);
    // ---- loft furniture: bed (sleep here!) + nightstand — 다락 침실 ----
    const bed = new THREE.Group();
    const bedFrame = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.12, 0.84, 3, 0.03), woodDark);
    bedFrame.position.y = 0.08;
    bed.add(bedFrame);
    const headBoard = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.34, 0.07, 3, 0.03), woodDark);
    headBoard.position.set(0, 0.22, -0.42);
    bed.add(headBoard);
    const mattress = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.1, 0.74, 3, 0.03), M(0xffffff));
    mattress.position.y = 0.17;
    bed.add(mattress);
    const blanket = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.06, 0.44, 3, 0.025), M(0xff8fb3));
    blanket.position.set(0, 0.215, 0.16);
    bed.add(blanket);
    const blanketFold = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.03, 0.09, 2, 0.012), M(0xffc2d6));   // 접힌 이불깃
    blanketFold.position.set(0, 0.245, -0.05);
    bed.add(blanketFold);
    for (const px of [-0.12, 0.12]) {   // 베개 두 개 — 둘이 자니까
        const pillow = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.07, 0.15, 2, 0.028), M(0xfff3e0));
        pillow.position.set(px, 0.245, -0.28);
        pillow.rotation.y = px < 0 ? 0.08 : -0.08;
        bed.add(pillow);
    }
    bed.position.set(-0.585, 0.78, -0.65);
    g.add(bed);
    const artFrame2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.03), woodDark);   // 침대맡 그림
    artFrame2.position.set(-0.95, 1.3, -0.99);
    g.add(artFrame2);
    const artCanvas2 = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.23), M(0xffffff, { map: artPetsTex }));
    artCanvas2.position.set(-0.95, 1.3, -0.972);
    g.add(artCanvas2);
    const stand = new THREE.Group();
    const standBody = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.19, 0.17, 2, 0.02), woodDark);
    standBody.position.y = 0.095;
    stand.add(standBody);
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 10), M(0xfff3e0));
    candle.position.y = 0.215;
    stand.add(candle);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), M(0xffd9a0, { emissive: 0xffb066, emissiveIntensity: 0.7 }));
    flame.position.y = 0.25;
    stand.add(flame);
    stand.position.set(0.065, 0.78, -0.806);
    g.add(stand);
    return g;
}

function makeBowl() {
    const g = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.11, 0.085, 24), M(0xef5350));
    bowl.position.y = 0.0425;
    g.add(bowl);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.148, 0.018, 10, 24), M(0xf47c78));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.085;
    g.add(rim);
    const food = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.03, 20), M(0xa1887f));
    food.position.y = 0.075;
    g.add(food);
    const kibble = M(0x8d6e5c);
    for (const [x, z] of [[0.04, 0.02], [-0.03, 0.05], [0.01, -0.05], [-0.06, -0.02], [0.07, -0.03]]) {
        const k = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), kibble);
        k.position.set(x, 0.095, z);
        g.add(k);
    }
    return g;
}

function makeFence() {
    const g = new THREE.Group();
    const wood = M(0xe6d2b8, { map: woodTex });
    for (let i = -1; i <= 1; i++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.34, 10), wood);
        post.position.set(i * 0.34, 0.17, 0);
        g.add(post);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), wood);
        cap.position.set(i * 0.34, 0.345, 0);
        g.add(cap);
    }
    for (const y of [0.13, 0.25]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.8, 8), wood);
        rail.rotation.z = Math.PI / 2;
        rail.position.y = y;
        g.add(rail);
    }
    return g;
}

function makePond() {
    const g = new THREE.Group();
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.76, 0.05, 36), M(0xffffff, { map: sandTex }));
    sand.position.y = 0.012;
    g.add(sand);
    const water = new THREE.Mesh(
        new THREE.CylinderGeometry(0.585, 0.585, 0.045, 36),
        // 깊이 그라데이션(중심 진청 → 가장자리 여울) + 살짝 매끈한 표면 — 플라스틱 원판을 물로.
        // 투명은 유지: 모래 바닥과 발장구가 비쳐 보인다.
        new THREE.MeshStandardMaterial({ map: pondTex, transparent: true, opacity: 0.8, roughness: 0.32, metalness: 0 })
    );
    water.position.y = 0.038;
    g.add(water);
    // 수련잎: 노치(파이 컷) 있는 잎 3장 — 원기둥 단추 하나였던 걸 잎으로.
    const padMat = M(0x5da95f);
    for (const [px, pz, rot, sc] of [[0.16, -0.12, 0.6, 1], [-0.2, 0.16, 2.8, 0.8], [0.05, 0.33, 4.4, 0.65]]) {
        const pad = new THREE.Mesh(new THREE.CircleGeometry(0.088 * sc, 18, 0.35, Math.PI * 1.78).rotateX(-Math.PI / 2), padMat);
        pad.position.set(px, 0.063, pz);
        pad.rotation.y = rot;
        g.add(pad);
    }
    const bloom = new THREE.Mesh(
        new THREE.PlaneGeometry(0.085, 0.085).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ map: flowerTex, alphaTest: 0.4, side: THREE.DoubleSide, color: 0xff8fb3 }));
    bloom.position.set(0.16, 0.075, -0.12);
    g.add(bloom);
    const stoneM = M(0xc4b6a0);   // 팔레트 ④: 웜 스톤
    for (const [x, z, s] of [[-0.62, 0.28, 1], [0.05, 0.68, 0.8], [0.6, -0.35, 0.9]]) {
        const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07 * s, 0), stoneM);
        st.position.set(x, 0.045, z);
        st.scale.y = 0.6;
        g.add(st);
    }
    return g;
}

function makeSunbed() {
    const g = new THREE.Group();
    const frame = M(0xf5f2ea);
    for (const [lx, lz] of [[-0.15, -0.22], [0.15, -0.22], [-0.15, 0.22], [0.15, 0.22]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.12, 8), frame);
        leg.position.set(lx, 0.06, lz);
        g.add(leg);
    }
    const deck = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.05, 0.6, 3, 0.02), M(0x9fd8c9));
    deck.position.y = 0.145;
    g.add(deck);
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.05, 0.3, 3, 0.02), M(0x9fd8c9));
    back.position.set(0, 0.225, -0.345);
    back.rotation.x = -0.85;                      // reclined backrest (pets tip onto it)
    g.add(back);
    const towel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.2), M(0xffffff, { map: towelTex }));
    towel.position.set(0, 0.176, 0.1);
    g.add(towel);
    const pillow = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.06, 0.12, 3, 0.025), M(0xffffff));
    pillow.position.set(0, 0.28, -0.33);
    pillow.rotation.x = -0.85;
    g.add(pillow);
    return g;
}

function makeHammock() {
    const g = new THREE.Group();
    const wood = M(0xb08a60, { map: woodTex });
    for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.52, 10), wood);
        post.position.set(side * 0.52, 0.26, 0);
        post.rotation.z = -side * 0.12;           // lean slightly outward
        g.add(post);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), wood);
        cap.position.set(side * 0.55, 0.52, 0);
        g.add(cap);
    }
    // Sagging cloth: a plane bent down along its length with the edges curling up across the width.
    const cloth = new THREE.PlaneGeometry(1.04, 0.34, 16, 4);
    const cp = cloth.attributes.position;
    for (let i = 0; i < cp.count; i++) {
        const x = cp.getX(i), y = cp.getY(i);
        cp.setZ(i, -0.13 * Math.cos((x / 0.52) * (Math.PI / 2)) + 0.05 * Math.pow(Math.abs(y) / 0.17, 2));
    }
    cloth.computeVertexNormals();
    const clothMesh = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ map: awningTex, side: THREE.DoubleSide, roughness: 1, metalness: 0 }));
    clothMesh.rotation.x = -Math.PI / 2;
    clothMesh.position.y = 0.5;
    g.add(clothMesh);
    return g;
}

// 그네 (2-seat A-frame swing): one top bar on two A-frame supports, two seats hung side by side.
// Geometry lives here; SWING gives the shared numbers the seat registration + pendulum both read
// so the visual plank and the riding pet stay locked to the same arc.
const SWING = { barY: 0.98, span: 1.36, seatX: 0.31, ropeL: 0.62, sitLift: 0.05, approach: 0.66, rideMs: 600000 };
function makeSwing() {
    const g = new THREE.Group();
    const wood = M(0xb08a60, { map: woodTex });
    const half = SWING.span / 2;
    const legSplay = 0.44, legLen = Math.hypot(SWING.barY, legSplay), legAng = Math.atan2(legSplay, SWING.barY);
    for (const side of [-1, 1]) {                       // two A-frame supports (an inverted V each)
        for (const dz of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.038, legLen, 8), wood);
            leg.position.set(side * half, SWING.barY / 2, dz * legSplay / 2);
            leg.rotation.x = -dz * legAng;
            g.add(leg);
        }
        const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, legSplay * 0.9, 6), wood);
        brace.position.set(side * half, SWING.barY * 0.4, 0);
        brace.rotation.x = Math.PI / 2;
        g.add(brace);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, SWING.span + 0.18, 10), wood);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = SWING.barY;
    g.add(bar);
    const cord = M(0x7a6248);
    const seatCols = [0xf6c560, 0xa9c7e8];              // 병아리 노랑 · 강아지 파랑 (각자 자리)
    const seats = [];
    [-SWING.seatX, SWING.seatX].forEach((ox, i) => {
        const sg = new THREE.Group();
        sg.position.set(ox, SWING.barY, 0);             // pivot ON the bar; rotation.x swings the seat
        for (const rx of [-0.11, 0.11]) {
            const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, SWING.ropeL, 6), cord);
            rope.position.set(rx, -SWING.ropeL / 2, 0);
            sg.add(rope);
        }
        const plank = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.05, 0.17, 3, 0.02), M(seatCols[i]));
        plank.position.y = -SWING.ropeL;
        sg.add(plank);
        g.add(sg);
        seats.push(sg);
    });
    g.userData.seats = seats;
    return g;
}

// 시소 (seesaw / teeter-totter): one plank pivots on a central fulcrum; a seat at each end rides the
// same tilt so one goes up as the other goes down. SEESAW holds the shared numbers; the plank group
// (userData.plank) tilts each frame and carries its seat meshes, so riders stay locked to the ends.
const SEESAW = { fulcrumH: 0.32, armLen: 0.74, lift: 0.06 };
function makeSeesaw() {
    const g = new THREE.Group();
    const wood = M(0xb08a60, { map: woodTex });
    const strutLen = Math.hypot(SEESAW.fulcrumH, 0.2), strutAng = Math.atan2(0.2, SEESAW.fulcrumH);
    for (const dz of [-1, 1]) {                          // fulcrum: two slanted struts meeting at the axle
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, strutLen, 8), wood);
        strut.position.set(0, SEESAW.fulcrumH / 2, dz * 0.1);
        strut.rotation.x = -dz * strutAng;
        g.add(strut);
    }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.26, 10), M(0xC98A4E));
    axle.rotation.z = Math.PI / 2;                       // axle runs along local X (the tilt axis)
    axle.position.y = SEESAW.fulcrumH;
    g.add(axle);
    const plank = new THREE.Group();                     // pivots about the axle; tilt = plank.rotation.x
    plank.position.y = SEESAW.fulcrumH;
    const beam = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.05, SEESAW.armLen * 2 + 0.14, 3, 0.02), M(0xeab94e));
    plank.add(beam);
    const seatCols = [0xf6c560, 0xa9c7e8];               // 병아리 노랑 · 강아지 파랑 (양 끝 각자 자리)
    [1, -1].forEach((e, i) => {
        const seat = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.04, 0.2, 3, 0.02), M(seatCols[i]));
        seat.position.set(0, 0.045, e * SEESAW.armLen);
        plank.add(seat);
        const grip = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 14), wood);
        grip.position.set(0, 0.14, e * (SEESAW.armLen - 0.16));
        grip.rotation.x = Math.PI / 2;
        plank.add(grip);
    });
    g.add(plank);
    g.userData.plank = plank;
    return g;
}

function makeLamp() {
    const g = new THREE.Group();
    const metal = M(0x5a6a75);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.06, 12), metal);
    base.position.y = 0.03;
    g.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.82, 10), metal);
    pole.position.y = 0.47;
    g.add(pole);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 12), lampGlobeMat);
    globe.position.y = 0.95;
    g.add(globe);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.09, 10), metal);
    cap.position.y = 1.06;
    g.add(cap);
    return g;
}

function makeRadio() {
    const g = new THREE.Group();
    const stand = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.03, 0.16, 3, 0.012), M(0xb08a60, { map: woodTex }));
    stand.position.y = 0.015;
    g.add(stand);
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.16, 0.11, 3, 0.03), M(0xef8a8a));
    body.position.y = 0.12;
    g.add(body);
    const speaker = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.112, 20), M(0x5a4a42));
    speaker.rotation.x = Math.PI / 2;
    speaker.position.set(-0.055, 0.12, 0.002);
    g.add(speaker);
    const knobMat = M(0xfff1cf);
    for (const ky of [0.145, 0.095]) {
        const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.115, 10), knobMat);
        knob.rotation.x = Math.PI / 2;
        knob.position.set(0.07, ky, 0.002);
        g.add(knob);
    }
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.24, 6), M(0x5a6a75));
    antenna.position.set(-0.09, 0.28, -0.02);
    antenna.rotation.z = 0.5;
    g.add(antenna);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), M(0x5a6a75));
    tip.position.set(-0.147, 0.385, -0.02);
    g.add(tip);
    return g;
}

function makeCoffeeBooth() {
    const g = new THREE.Group();
    const wood = M(0xb08a60, { map: woodTex });
    const counter = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.4, 0.42, 3, 0.03), M(0xfff2dd, { map: plasterTex }));
    counter.position.y = 0.2;
    g.add(counter);
    const top = new THREE.Mesh(new RoundedBoxGeometry(0.88, 0.05, 0.5, 2, 0.02), wood);
    top.position.y = 0.42;
    g.add(top);
    for (const px of [-0.4, 0.4]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.75, 8), wood);
        post.position.set(px, 0.78, -0.12);
        g.add(post);
    }
    const awning = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.03, 0.55), new THREE.MeshStandardMaterial({ map: awningTex, roughness: 1, metalness: 0 }));
    awning.position.set(0, 1.16, 0.02);
    awning.rotation.x = 0.22;
    g.add(awning);
    // espresso machine
    const machine = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.2, 0.2, 3, 0.02), M(0x5a6a75));
    machine.position.set(-0.2, 0.545, -0.05);
    g.add(machine);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.06, 8), M(0xcfd6dd));
    spout.position.set(-0.2, 0.47, 0.06);
    g.add(spout);
    // little stack of cups + sign
    for (let i = 0; i < 3; i++) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.024, 0.05, 10), M(0xffffff));
        cup.position.set(0.18 + i * 0.02, 0.47 + i * 0.035, -0.08);
        g.add(cup);
    }
    const signCv = document.createElement('canvas');
    signCv.width = 128; signCv.height = 64;
    const sctx = signCv.getContext('2d');
    sctx.fillStyle = '#6b4a2f';
    sctx.fillRect(0, 0, 128, 64);
    sctx.fillStyle = '#fff2dd';
    sctx.font = 'bold 26px sans-serif';
    sctx.textAlign = 'center';
    sctx.fillText('☕ COFFEE', 64, 40);
    const signTex = new THREE.CanvasTexture(signCv);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.03), new THREE.MeshStandardMaterial({ map: signTex, roughness: 1, metalness: 0 }));
    sign.position.set(0, 0.95, -0.1);
    g.add(sign);
    return g;
}

const foodAwningTex = canvasTex(64, 3, 1, (ctx, s) => {
    for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? '#f4fbf6' : '#9fd8c9';
        ctx.fillRect((i * s) / 4, 0, s / 4, s);
    }
});
function makeFoodBooth() {
    const g = new THREE.Group();
    const wood = M(0xb08a60, { map: woodTex });
    const counter = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.4, 0.42, 3, 0.03), M(0xfff2dd, { map: plasterTex }));
    counter.position.y = 0.2;
    g.add(counter);
    const top = new THREE.Mesh(new RoundedBoxGeometry(0.88, 0.05, 0.5, 2, 0.02), wood);
    top.position.y = 0.42;
    g.add(top);
    for (const px of [-0.4, 0.4]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.75, 8), wood);
        post.position.set(px, 0.78, -0.12);
        g.add(post);
    }
    const awning = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.03, 0.55), new THREE.MeshStandardMaterial({ map: foodAwningTex, roughness: 1, metalness: 0 }));
    awning.position.set(0, 1.16, 0.02);
    awning.rotation.x = 0.22;
    g.add(awning);
    // griddle + a couple of display snacks
    const griddle = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.06, 0.22, 2, 0.02), M(0x3a3f45));
    griddle.position.set(-0.18, 0.475, -0.04);
    g.add(griddle);
    const toastD = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.02, 0.09, 2, 0.008), M(0xe3b878));
    toastD.position.set(-0.22, 0.515, -0.04);
    toastD.rotation.y = 0.4;
    g.add(toastD);
    const donutD = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.016, 8, 16), M(0xf5a3bb));
    donutD.rotation.x = -Math.PI / 2;
    donutD.position.set(0.16, 0.465, -0.06);
    g.add(donutD);
    const signCv = document.createElement('canvas');
    signCv.width = 128; signCv.height = 64;
    const sctx = signCv.getContext('2d');
    sctx.fillStyle = '#3f7d6a';
    sctx.fillRect(0, 0, 128, 64);
    sctx.fillStyle = '#f4fbf6';
    sctx.font = 'bold 26px sans-serif';
    sctx.textAlign = 'center';
    sctx.fillText('🍞 SNACK', 64, 40);
    const signTex = new THREE.CanvasTexture(signCv);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.03), new THREE.MeshStandardMaterial({ map: signTex, roughness: 1, metalness: 0 }));
    sign.position.set(0, 0.95, -0.1);
    g.add(sign);
    return g;
}

// ---- 광장 세트 (P1 ㉑㉕): 베프 기념비 + 포옹 포인트 ----
function makeMonument() {
    // 조그만 돌 기념비: 받침 두 단 + 각인 판("베프 포에버" — 주인의 선택은 날짜 없이 문구만) + 꼭대기 하트.
    const g = new THREE.Group();
    const stone = M(0xcfd4d8);
    const base = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.1, 0.44, 3, 0.03), stone);
    base.position.y = 0.05;
    g.add(base);
    const tier = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.08, 0.32, 3, 0.025), stone);
    tier.position.y = 0.14;
    g.add(tier);
    const slab = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.5, 0.12, 3, 0.035), M(0xe7e3da, { map: plasterTex }));
    slab.position.y = 0.43;
    g.add(slab);
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 160;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#f6efdf';
    ctx.fillRect(0, 0, 256, 160);
    ctx.strokeStyle = 'rgba(150,120,80,0.55)';
    ctx.lineWidth = 6;
    ctx.strokeRect(9, 9, 238, 142);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6b5335';
    ctx.font = '44px sans-serif';
    ctx.fillText('🐕🐣', 128, 64);
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('베프 포에버', 128, 107);
    ctx.font = '26px sans-serif';
    ctx.fillText('💕', 128, 142);
    const plateTex = new THREE.CanvasTexture(cv);
    plateTex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.175), new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.9, metalness: 0 }));
    plate.position.set(0, 0.45, 0.065);   // 남쪽 = 기본 카메라 쪽 면
    g.add(plate);
    const heartMat = M(0xf28bb0);
    const heart = new THREE.Group();
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), heartMat);
    hl.position.x = -0.036;
    const hr = hl.clone();
    hr.position.x = 0.036;
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.088, 0.058), heartMat);
    hb.rotation.z = Math.PI / 4;
    hb.position.y = -0.045;
    heart.add(hl, hr, hb);
    heart.position.y = 0.77;
    g.add(heart);
    return g;
}
// 포옹 포인트: 하트 데칼 + 숨쉬는 링. 둘이 같이 서면 자동 포옹 — updateHugSpot이 지켜본다.
let hugRing = null;
const hugHeartTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.translate(64, 60);
    ctx.fillStyle = 'rgba(255,150,190,0.92)';
    ctx.beginPath();
    ctx.moveTo(0, 34);
    ctx.bezierCurveTo(-66, -12, -30, -58, 0, -22);
    ctx.bezierCurveTo(30, -58, 66, -12, 0, 34);
    ctx.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
})();
function makeHugSpot() {
    const g = new THREE.Group();
    const decal = new THREE.Mesh(
        new THREE.PlaneGeometry(0.85, 0.85).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: hugHeartTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, opacity: 0.8 })
    );
    decal.position.y = 0.045;   // 광장 석재 타일 리본보다 확실히 위 — 아니면 타일이 하트를 덮는다
    g.add(decal);
    hugRing = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.56, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xff9ec2, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    hugRing.position.y = 0.05;
    g.add(hugRing);
    return g;
}
let hugSpotCooldownUntil = 0;
const hugBurst = [];   // { spr, vx, vy, vz, t } — 하트·반짝이가 둥실 떠오르다 사라진다
function triggerHugBurst(x, y, z) {
    for (let i = 0; i < 14; i++) {
        const heartish = Math.random() < 0.6;
        const spr = heartish
            ? new THREE.Sprite(new THREE.SpriteMaterial({ map: hugHeartTex, transparent: true, opacity: 0.95, depthWrite: false }))
            : glowSprite(0xfff3a6, 1, 0.9);
        spr.scale.setScalar(heartish ? 0.14 + Math.random() * 0.09 : 0.16 + Math.random() * 0.1);
        spr.position.set(x + (Math.random() - 0.5) * 0.5, y + 0.05, z + (Math.random() - 0.5) * 0.5);
        scene.add(spr);
        hugBurst.push({ spr, vx: (Math.random() - 0.5) * 0.5, vy: 0.85 + Math.random() * 0.7, vz: (Math.random() - 0.5) * 0.5, t: 0 });
    }
    try {   // 반짝이는 4음 아르페지오 (C-E-G-C) — 파일 없는 신스, sfx 볼륨을 따른다
        const t0 = audioCtx.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
            const o = audioCtx.createOscillator();
            o.type = 'triangle';
            o.frequency.value = f;
            const gn = audioCtx.createGain();
            gn.gain.setValueAtTime(0, t0 + i * 0.09);
            gn.gain.linearRampToValueAtTime(0.05, t0 + i * 0.09 + 0.02);
            gn.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.5);
            o.connect(gn);
            gn.connect(sfxMaster);
            o.start(t0 + i * 0.09);
            o.stop(t0 + i * 0.09 + 0.55);
        });
    } catch (e) {}
}
function updateHugSpot(delta) {
    if (hugRing) {   // 링이 은은하게 숨쉰다
        const s = 1 + 0.05 * Math.sin(wxTime.value * 2.2);
        hugRing.scale.set(s, 1, s);
        hugRing.material.opacity = 0.26 + 0.13 * Math.sin(wxTime.value * 2.2);
    }
    for (let i = hugBurst.length - 1; i >= 0; i--) {
        const b = hugBurst[i];
        b.t += delta;
        b.spr.position.x += b.vx * delta;
        b.spr.position.y += b.vy * delta;
        b.spr.position.z += b.vz * delta;
        b.vy -= 0.5 * delta;
        b.spr.material.opacity = Math.max(0, 0.95 * (1 - b.t / 1.6));
        if (b.t > 1.6) {
            scene.remove(b.spr);
            b.spr.material.dispose();
            hugBurst.splice(i, 1);
        }
    }
    const spot = PROPS.find((pr) => pr.type === 'hugspot');   // live — 공사 모드로 옮겨도 그대로
    if (!spot || Date.now() < hugSpotCooldownUntil || pets.length < 2) return;
    const on = (q) => Math.hypot(q.mover.position.x - spot.x, q.mover.position.z - spot.z) < 0.6;
    const [a, b] = pets;
    if (!on(a) || !on(b)) return;
    const fxY = terrainHeight(spot.x, spot.z) + 0.25;
    if (possessed) {   // 주인이 데려온 순간: 조종은 안 뺏고, 버스트 + 절친의 솔로 하트 포즈로 화답
        const buddy = pets.find((q) => q !== possessed);
        if (!buddy || buddy.pet.sleeping || buddy.bed || buddy.dip || buddy.ai.state === 'held' || duoBusy) return;
        hugSpotCooldownUntil = Date.now() + 90 * 1000;
        triggerHugBurst(spot.x, fxY, spot.z);
        buddy.mover.rotation.y = Math.atan2(possessed.mover.position.x - buddy.mover.position.x, possessed.mover.position.z - buddy.mover.position.z);
        buddy.pet.action = { id: 'hug', t: 0, role: 'solo', dir: 1 };
        logWorldEvent('포옹 포인트에서 주인과 마음이 통했다 💕');
        return;
    }
    const free = (q) => !q.pet.sleeping && !q.bed && !q.dip && q.ai.state !== 'held' && q.ai.state !== 'busy' && q.ai.state !== 'goto';
    if (duoBusy || !free(a) || !free(b)) return;
    hugSpotCooldownUntil = Date.now() + 5 * 60 * 1000;   // 자주 터지면 마법이 아니니까
    triggerHugBurst(spot.x, fxY, spot.z);
    logWorldEvent('포옹 포인트가 반짝이며 자동 포옹이 시작됐다 💕');
    worldHug(a);
}

// ---- 동굴 (모험의 섬 ②): 언덕 남서면의 평탄 포켓 위에 얹는 바위 셸. 두꺼운 셸이 해를 등지고
// 내부에 진짜 그림자를 드리워서(castShadow) 별도 렌더 트릭 없이 어둑하고, 호박빛 랜턴이 그
// 안을 데운다. 쿠션 두 개는 sit-침대(⌘로 앉기)이자 비 피신 자리. 지형과 한 몸이라 이동 불가. ----
let caveLamp = null;   // 랜턴 포인트라이트 — updateMemorialIsland가 불꽃처럼 일렁이게 한다
function makeCave() {
    const g = new THREE.Group();
    // 팔레트 ④: 회색 바위는 파스텔 월드의 이탈자 — 웜 베이지로 (형태 인식은 flatShading이 지킨다)
    const rock = M(0xbcaa90, { flatShading: true });
    const rockDark = M(0xa08d74, { flatShading: true });
    const back = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 8), rock);
    back.position.set(0, 0.35, -0.8);
    back.scale.set(1.35, 0.95, 0.8);
    const left = new THREE.Mesh(new THREE.SphereGeometry(0.8, 9, 7), rock);
    left.position.set(-1.0, 0.3, -0.05);
    left.scale.set(0.85, 0.9, 1.15);
    const right = left.clone();
    right.position.x = 1.0;
    const roof = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), rockDark);
    roof.position.set(0, 0.92, -0.35);
    roof.scale.set(1.12, 0.58, 1.02);
    const pillarL = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), rockDark);
    pillarL.position.set(-0.85, 0.32, 0.62);
    pillarL.scale.set(0.8, 1.15, 0.8);
    const pillarR = pillarL.clone();
    pillarR.position.x = 0.85;
    const lintel = new THREE.Mesh(new THREE.SphereGeometry(0.62, 8, 6), rock);
    lintel.position.set(0, 1.02, 0.5);
    lintel.scale.set(1.5, 0.5, 0.7);
    g.add(back, left, right, roof, pillarL, pillarR, lintel);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.18, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.32), snowCapMat);
    cap.position.copy(roof.position);
    cap.scale.copy(roof.scale).multiplyScalar(1.02);
    cap.visible = false;
    g.add(cap);
    seasonSnowCaps.push(cap);
    // 내부: 러그 + 쿠션 둘 + 랜턴 (아늑함의 3요소)
    const rug = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.015, 20), M(0xd8a878));
    rug.position.set(0, 0.012, -0.15);
    g.add(rug);
    const cushA = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.15, 0.3, 3, 0.05), M(0xf2b8c6));
    cushA.position.set(-0.35, 0.075, -0.28);
    cushA.rotation.y = 0.25;
    const cushB = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.15, 0.3, 3, 0.05), M(0x9fc4e8));
    cushB.position.set(0.36, 0.075, -0.32);
    cushB.rotation.y = -0.2;
    g.add(cushA, cushB);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.08, 8), M(0x6f5030, { map: woodTex }));
    lampBase.position.set(0, 0.04, -0.68);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffd9a8, emissive: 0xff9d4d, emissiveIntensity: 0.9 }));
    glass.position.set(0, 0.15, -0.68);
    g.add(lampBase, glass);
    const halo = glowSprite(0xffb066, 0.5, 0.5);
    halo.position.set(0, 0.16, -0.68);
    g.add(halo);
    caveLamp = new THREE.PointLight(0xffb066, 1.1, 3.4, 2);
    caveLamp.position.set(0, 0.35, -0.55);
    g.add(caveLamp);
    return g;
}

// ---- 전망대 (모험의 섬 ①): 언덕 고원 위 팔각 나무 데크 — 난간은 내리막(입구) 쪽만 트여
// 있고, 망원경이 바다를 향한다. 데크는 얇아서(0.08) 펫이 그냥 밟고 올라선다. 램프 기둥은
// lamps 배열에 합류해 밤이면 다른 가로등처럼 켜진다. 언덕과 한 몸 — 이동 불가. ----
function makeLookout() {
    const g = new THREE.Group();
    const wood = M(0xb08a60, { map: woodTex });
    const woodDark = M(0x8a6647, { map: woodTex });
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.1, 0.08, 8), wood);
    deck.position.y = 0.04;
    g.add(deck);
    // 난간: 입구 방향(+z 로컬, 내리막)만 ±0.55rad 비운다
    const postGeo = new THREE.CylinderGeometry(0.03, 0.035, 0.34, 8);
    const railGeo = new THREE.BoxGeometry(0.02, 0.035, 1);
    const posts = [];
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        if (Math.abs(THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI) < 0.55) { posts.push(null); continue; }   // 입구 갭
        const post = new THREE.Mesh(postGeo, woodDark);
        post.position.set(Math.sin(a) * 0.95, 0.25, Math.cos(a) * 0.95);
        g.add(post);
        posts.push(post);
    }
    for (let i = 0; i < 10; i++) {
        const p1 = posts[i], p2 = posts[(i + 1) % 10];
        if (!p1 || !p2) continue;
        const rail = new THREE.Mesh(railGeo, wood);
        rail.position.lerpVectors(p1.position, p2.position, 0.5);
        rail.position.y = 0.4;
        const dx = p2.position.x - p1.position.x, dz = p2.position.z - p1.position.z;
        rail.scale.z = Math.hypot(dx, dz);
        rail.rotation.y = Math.atan2(dx, dz);
        g.add(rail);
    }
    // 망원경: 삼각대 + 하늘로 든 경통 (바다 쪽 = 로컬 -z)
    const scope = new THREE.Group();
    const legGeo = new THREE.CylinderGeometry(0.014, 0.018, 0.34, 6);
    for (const la of [0.3, 2.4, 4.5]) {
        const leg = new THREE.Mesh(legGeo, M(0x5a6a75));
        leg.position.set(Math.sin(la) * 0.09, 0.16, Math.cos(la) * 0.09);
        leg.rotation.z = Math.sin(la) * 0.28;
        leg.rotation.x = -Math.cos(la) * 0.28;
        scope.add(leg);
    }
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.058, 0.42, 12), M(0xd9b25e));
    tube.position.set(0, 0.42, 0.02);
    tube.rotation.x = Math.PI / 2 - 0.65;   // 위로 55° — 별 보기 각도
    scope.add(tube);
    const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.06, 8), M(0x4a3f30));
    eye.position.set(0, 0.28, 0.15);
    eye.rotation.x = Math.PI / 2 - 0.65;
    scope.add(eye);
    scope.position.set(0.35, 0.08, -0.35);
    scope.rotation.y = Math.PI;   // 경통이 로컬 -z(바다)로
    g.add(scope);
    // 데크 램프: 밤이면 가로등과 함께 켜진다 (lamps 합류)
    const lpost = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.62, 8), M(0x5a6a75));
    lpost.position.set(-0.7, 0.39, -0.55);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), lampGlobeMat);
    globe.position.set(-0.7, 0.76, -0.55);
    g.add(lpost, globe);
    const light = new THREE.PointLight(0xffd9a0, 0, 3.6, 2);
    light.position.set(-0.7, 0.78, -0.55);
    g.add(light);
    const halo = glowSprite(0xffc978, 0.5, 0);
    halo.position.set(-0.7, 0.78, -0.55);
    g.add(halo);
    lamps.push({ light, glow: halo.material });
    return g;
}

// 바위 (모험의 섬 드레싱): 각진 저폴리 바위 덩어리 둘 — 계절 중립, 숨기 스팟 겸용.
function makeBoulder() {
    const g = new THREE.Group();
    const mat = M(0xc2b096, { flatShading: true });   // 팔레트 ④: 웜 베이지 (회색 이탈자 보정)
    const big = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), mat);
    big.position.y = 0.2;
    big.scale.set(1.15, 0.78, 1);
    big.rotation.y = 0.5;
    const small = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2, 0), mat);
    small.position.set(0.32, 0.12, 0.14);
    small.scale.y = 0.75;
    small.rotation.y = 2.1;
    g.add(big, small);
    return g;
}

// ---- 보물 모래밭 (모험의 섬 ㉜): X 세 곳 중 매일 한 곳에 보물이 묻힌다 — 반짝이는 자리를
// 조종 중 ⌘로 파거나 채팅 <game=treasure>로 시키고, 펫이 아주 가끔 스스로 발굴하기도 한다.
// 파기는 새 Dig 모션(엔티티 공용)이고, 보상은 잠긴 코디가 차례로 열린다: 👒 밀짚모자 → 🎀 리본
// → 그다음부턴 반짝이는 동전. 일일 상태·언락은 localStorage. ----
const DIG_SPOTS_LOCAL = [[-0.4, 0.4], [0.45, -0.35], [-0.15, -0.55]];
const DIG_UNLOCK_ORDER = ['straw-hat', 'ribbon'];
let digGlint = null, digsitePr = null;
let accUnlocked = new Set(['santa-hat']);
try {
    const saved = JSON.parse(localStorage.getItem('world-acc-unlocked'));
    if (Array.isArray(saved)) saved.forEach((id) => accUnlocked.add(id));
} catch (e) {}
accUnlocked.add('santa-hat');   // 산타모자는 언제나 — 이미 출시된 코디를 잠그지 않는다
function saveAccUnlocked() {
    try { localStorage.setItem('world-acc-unlocked', JSON.stringify([...accUnlocked])); } catch (e) {}
}
let digState = null;   // { date, spot, dug }
function refreshDigState() {
    const today = localDateStr();
    if (digState && digState.date === today) return;
    try { digState = JSON.parse(localStorage.getItem('world-treasure')); } catch (e) { digState = null; }
    if (!digState || digState.date !== today) {
        digState = { date: today, spot: Math.floor(Math.random() * DIG_SPOTS_LOCAL.length), dug: false };
        try { localStorage.setItem('world-treasure', JSON.stringify(digState)); } catch (e) {}
    }
}
function digSpotWorld() {
    if (!digsitePr || !digState) return null;
    const [lx, lz] = DIG_SPOTS_LOCAL[digState.spot];
    const cy = Math.cos(digsitePr.rotY || 0), sy = Math.sin(digsitePr.rotY || 0);
    return { x: digsitePr.x + lx * cy + lz * sy, z: digsitePr.z - lx * sy + lz * cy };
}
function makeDigsite(p) {
    digsitePr = p;
    const g = new THREE.Group();
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#e8d5a8';
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 90; i++) {
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.25)' : 'rgba(150,120,70,0.2)';
        ctx.fillRect(Math.random() * 63, Math.random() * 63, 1.6, 1.6);
    }
    const sandTex = new THREE.CanvasTexture(cv);
    sandTex.colorSpace = THREE.SRGBColorSpace;
    const sand = new THREE.Mesh(new THREE.CircleGeometry(1.2, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, metalness: 0 }));
    sand.position.y = 0.03;
    g.add(sand);
    const xcv = document.createElement('canvas');
    xcv.width = xcv.height = 48;
    const xctx = xcv.getContext('2d');
    xctx.strokeStyle = 'rgba(178,90,60,0.85)';
    xctx.lineWidth = 7;
    xctx.lineCap = 'round';
    xctx.beginPath();
    xctx.moveTo(10, 10); xctx.lineTo(38, 38);
    xctx.moveTo(38, 10); xctx.lineTo(10, 38);
    xctx.stroke();
    const xTex = new THREE.CanvasTexture(xcv);
    const xMat = new THREE.MeshBasicMaterial({ map: xTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    for (const [lx, lz] of DIG_SPOTS_LOCAL) {
        const xm = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32).rotateX(-Math.PI / 2), xMat);
        xm.position.set(lx, 0.045, lz);
        g.add(xm);
    }
    digGlint = glowSprite(0xfff2a8, 0.45, 0);   // 오늘의 보물 자리 반짝임 — updateMemorialIsland가 움직인다
    digGlint.position.y = 0.22;
    g.add(digGlint);
    return g;
}
let digDoing = false, digAutoAt = Date.now() + 15 * 60000;
async function startDig(p) {
    refreshDigState();
    if (!digState || digState.dug || digDoing || !p || p.bed || p.dip) return;
    const w = digSpotWorld();
    if (!w) return;
    digDoing = true;
    try {
        p.mover.rotation.y = Math.atan2(w.x - p.mover.position.x, w.z - p.mover.position.z);
        p.pet.action = { id: 'dig', t: 0 };
        const y = terrainHeight(w.x, w.z);
        for (let i = 0; i < 10; i++) {   // 흙 puffs — 어두운 스프라이트라 가산 대신 보통 블렌딩
            const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: blobTex, transparent: true, opacity: 0.75, depthWrite: false }));
            puff.scale.setScalar(0.12 + Math.random() * 0.12);
            puff.position.set(w.x + (Math.random() - 0.5) * 0.3, y + 0.06, w.z + (Math.random() - 0.5) * 0.3);
            scene.add(puff);
            hugBurst.push({ spr: puff, vx: (Math.random() - 0.5) * 0.8, vy: 0.7 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.8, t: Math.random() * -0.9 });
        }
        await sleepMs(2900);
        digState.dug = true;
        try { localStorage.setItem('world-treasure', JSON.stringify(digState)); } catch (e) {}
        triggerHugBurst(w.x, y + 0.25, w.z);
        const next = DIG_UNLOCK_ORDER.find((id) => !accUnlocked.has(id));
        if (next) {
            accUnlocked.add(next);
            saveAccUnlocked();
            const label = GLB_ACCESSORIES.find((a) => a.id === next)?.label || next;
            showToast(`🎁 보물 발견! ${label} 코디가 열렸어요`);
            logWorldEvent(`${petKo(p)}가 모래밭에서 보물을 파냈다 — ${label} 코디 언락 🎁`);
            maybeProactive(p, `방금 모래밭에서 보물을 파냈다! ${label}이(가) 나왔다!`);
        } else {
            showToast('✨ 반짝이는 동전을 찾았다 — 소원 우물에 어울리겠어');
            logWorldEvent(`${petKo(p)}가 모래밭에서 반짝이는 동전을 파냈다 ✨`);
        }
    } finally {
        digDoing = false;
    }
}

// ---- 상호작용: 공용 양피지 다이얼로그 (소원/캡슐/우편함이 함께 쓴다 — 서버 config/*.json에
// 저장되는 건 일기와 같은 방식) ----
function memorialPanel(title) {
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed; left:50%; top:44%; transform:translate(-50%,-50%); display:none; z-index:120; width:min(330px, calc(100vw - 60px)); max-height:66vh; background:#fbf3e2; color:#4a3f30; border-radius:14px; box-shadow:0 10px 34px rgba(0,0,0,0.45); font-family:sans-serif; flex-direction:column; overflow:hidden;';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex; align-items:center; gap:6px; padding:9px 12px; font-size:13.5px; font-weight:700; background:rgba(120,90,50,0.12);';
    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText = 'flex:1;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'border:none; background:rgba(120,90,50,0.15); color:#4a3f30; border-radius:7px; font-size:12px; padding:3px 9px; cursor:pointer;';
    closeBtn.onclick = () => { panel.style.display = 'none'; };
    head.append(titleEl, closeBtn);
    const body = document.createElement('div');
    body.style.cssText = 'padding:10px 12px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; font-size:12.5px;';
    panel.append(head, body);
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    panel.addEventListener('keydown', (e) => e.stopPropagation());   // 입력 중 WASD/Space가 펫을 몰지 않게
    document.body.appendChild(panel);
    return { panel, body };
}
const memoInput = (ph, rows = 2) => {
    const t = document.createElement('textarea');
    t.placeholder = ph;
    t.rows = rows;
    t.maxLength = 200;
    t.style.cssText = 'width:100%; box-sizing:border-box; border:1px solid rgba(120,90,50,0.35); border-radius:8px; background:#fffdf6; color:#4a3f30; font-size:13px; padding:7px 9px; resize:none; font-family:sans-serif;';
    return t;
};
const memoBtn = (label) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'border:none; border-radius:8px; background:#e8b04b; color:#3d2f18; font-weight:700; font-size:12.5px; padding:7px 10px; cursor:pointer;';
    return b;
};

// ---- 우편함 (⑬): 빨간 우편함 — 클릭하면 편지 패널. 편지를 보내면 병아리·강아지가 함께 답장을
// 쓰고(서버 LLM, 일기 페르소나 재사용) 4~12분 뒤 "배달"된다 — 깃발이 올라가고 알림이 온다. ----
let mailFlag = null, mailData = [], mailReadTs = 0;
try { mailReadTs = parseInt(localStorage.getItem('world-mail-read') || '0', 10) || 0; } catch (e) {}
function makeMailbox() {
    const g = new THREE.Group();
    // 리모델: "덩어리 모음" 탈피 — 클래식 터널형 우체통. 반원 지붕+직벽 프로파일을 통짜
    // Extrude(베벨)로 뽑아 이음새·캡 없이 매끈하고, 문판·테두리·투입구·걸쇠가 정면의 "얼굴"을
    // 만든다. 발치 둔덕·덤불 블롭은 제거(징검돌만 유지), 깃발(mailFlag) 애니메이션은 그대로.
    const post = new THREE.Mesh(bakeGrad(new THREE.CylinderGeometry(0.034, 0.046, 0.52, 12), 0xa8845e, 0x6f5238, { curve: 1.3 }), gradMatWood);
    post.position.y = 0.26;
    g.add(post);
    const basePlate = GM(new THREE.CylinderGeometry(0.075, 0.09, 0.032, 12), 0x9a7a56, 0x6f5238);
    basePlate.position.y = 0.016;
    g.add(basePlate);
    const tunnel = new THREE.Shape();   // 정면에서 본 몸통 단면: ⌒ 위 반원 + 직벽
    tunnel.moveTo(-0.105, 0);
    tunnel.lineTo(-0.105, 0.085);
    tunnel.absarc(0, 0.085, 0.105, Math.PI, 0, true);
    tunnel.lineTo(0.105, 0);
    tunnel.closePath();
    const bodyGeo = new THREE.ExtrudeGeometry(tunnel, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.012, bevelSegments: 3, curveSegments: 16 });
    bodyGeo.translate(0, 0, -0.12);    // 프로파일 면이 곧 정면(+z) — 깊이만 가운데로
    const body = new THREE.Mesh(bakeGrad(bodyGeo, 0xf08a70, 0xaf4f3e, { curve: 1.1 }), gradMat);
    body.position.y = 0.52;
    g.add(body);
    const doorShape = new THREE.Shape();   // 문판 — 몸통 단면의 축소판 (테두리가 자연히 남는다)
    doorShape.moveTo(-0.078, 0.014);
    doorShape.lineTo(-0.078, 0.085);
    doorShape.absarc(0, 0.085, 0.078, Math.PI, 0, true);
    doorShape.lineTo(0.078, 0.014);
    doorShape.closePath();
    const doorGeo = new THREE.ExtrudeGeometry(doorShape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 14 });
    const door = new THREE.Mesh(bakeGrad(doorGeo, 0xfdf7e8, 0xd8c7ae), gradMat);
    door.position.set(0, 0.52, 0.128);   // 몸통 정면(z≈0.134)에 얹힘 — 테두리가 몸통색으로 남는다
    g.add(door);
    const slot = GM(new RoundedBoxGeometry(0.096, 0.02, 0.016, 2, 0.008), 0x6b5644, 0x4a3a2c);   // 투입구
    slot.position.set(0, 0.645, 0.152);
    g.add(slot);
    const latch = GM(new THREE.SphereGeometry(0.018, 10, 8), 0xe8c46f, 0xb08d43);   // 꿀색 걸쇠
    latch.position.set(0, 0.555, 0.155);
    g.add(latch);
    // 징검돌 두 장 — 길가 장면의 발끝만 남긴다
    for (const [sx, sz, sr] of [[0.02, 0.34, 0.085], [-0.1, 0.6, 0.068]]) {
        const step = GM(new THREE.CylinderGeometry(sr, sr * 1.08, 0.022, 10), 0xd8cbb4, 0xa89a82);
        step.position.set(sx, 0.011, sz);
        g.add(step);
    }
    mailFlag = new THREE.Group();
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.032, 0.15, 0.022, 2, 0.011), M(0xf2c53d));
    arm.position.y = 0.075;
    const tip = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.052, 0.022, 2, 0.011), M(0xf2c53d));
    tip.position.set(0.028, 0.15, 0);
    mailFlag.add(arm, tip);
    mailFlag.position.set(0.118, 0.56, 0.05);   // 몸통 옆구리 — 접힘/기립 애니메이션은 기존 그대로
    mailFlag.rotation.z = -1.5;   // 평소엔 접힘 — 답장이 오면 선다
    g.add(mailFlag);
    return g;
}
const mailUI = memorialPanel('📮 우편함');
const mailInput = memoInput('펫들에게 편지를 남겨요…', 3);
const mailSend = memoBtn('📮 편지 보내기');
const mailListEl = document.createElement('div');
mailListEl.style.cssText = 'display:flex; flex-direction:column; gap:8px; border-top:1px dashed rgba(120,90,50,0.35); padding-top:8px;';
mailUI.body.append(mailInput, mailSend, mailListEl);
function renderMail() {
    mailListEl.textContent = '';
    if (!mailData.length) {
        mailListEl.textContent = '아직 주고받은 편지가 없어요.';
        return;
    }
    const now = Date.now();
    for (const m of [...mailData].reverse().slice(0, 20)) {
        const row = document.createElement('div');
        row.style.cssText = 'line-height:1.55; white-space:pre-wrap;';
        const d = new Date(m.ts);
        let txt = `📤 ${d.getMonth() + 1}.${d.getDate()} 나: ${m.text}`;
        if (m.reply) txt += m.deliverAt <= now ? `\n📥 🐤🐶: ${m.reply}` : '\n🕊️ 답장이 오는 중…';
        row.textContent = txt;
        mailListEl.appendChild(row);
    }
}
async function fetchMail() {
    try {
        const res = await fetch('/api/world_mail');
        if (res.ok) mailData = (await res.json()).letters || [];
    } catch (e) {}
    renderMail();
    updateMailFlag();
}
let mailNotified = new Set();
function updateMailFlag() {
    if (!mailFlag) return;
    const now = Date.now();
    const has = mailData.some((m) => m.reply && m.deliverAt <= now && m.deliverAt > mailReadTs);
    mailFlag.rotation.z = has ? -0.15 : -1.5;
    for (const m of mailData) {   // 막 도착한 답장은 한 번 알려준다
        if (m.reply && m.deliverAt <= now && !mailNotified.has(m.id)) {
            mailNotified.add(m.id);
            if (now - m.deliverAt < 90000) {
                showToast('📮 우편함에 답장이 왔어요!');
                logWorldEvent('우편함에 펫들의 답장이 도착했다 📮');
            }
        }
    }
}
let mailPollAt = 0;
let gardenPollAt = 0;   // 텃밭 성장 티커 (animate에서 10초마다 단계 변화 감지)
let petSaveAt = 0;      // 펫 이어하기 저장 티커 (8초 — 크래시/강제종료에도 최근 위치 보존)
mailSend.onclick = async () => {
    const text = mailInput.value.trim();
    if (!text) { showToast('📮 편지 내용을 먼저 적어주세요'); return; }
    mailSend.disabled = true;
    try {
        const res = await fetch('/api/world_mail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(await res.text());
        mailData.push((await res.json()).letter);
        mailInput.value = '';
        renderMail();
        showToast('📮 편지를 넣었어요 — 답장을 기다려요');
        logWorldEvent('펫들에게 편지를 보냈다 📮');
    } catch (e) {
        console.error('[World] mail failed', e);
        showToast('📮 편지 보내기에 실패했어요 — 잠시 후 다시');
    } finally {
        mailSend.disabled = false;
    }
};
function openMailbox() {
    mailUI.panel.style.display = 'flex';
    fetchMail().then(() => {
        mailReadTs = Date.now();
        try { localStorage.setItem('world-mail-read', String(mailReadTs)); } catch (e) {}
        updateMailFlag();
    });
}
fetchMail();   // 부팅 — 깃발 상태 복원

// ---- 운동 공간 (⑦): 요가 매트 둘 + 아령 + 스트레칭 바. 매트 클릭 = 가까운 펫이 와서 스트레칭
// (신규 16번째 모션), 조종 중 ⌘ 근접 = 내 펫이 직접, 한가할 땐 스스로도 한다. ----
const GYM_MAT_LOCAL = [[-0.34, 0.05], [0.34, -0.05]];
function makeGym() {
    const g = new THREE.Group();
    // 동숲식 조형: 매트는 더 도톰+큰 라운딩+톱라이트 그라디언트, 바는 그네와 같은 나무 언어
    // (테이퍼 기둥+둥근 캡), 아령은 통통한 파스텔 볼. 매트 위치(GYM_MAT_LOCAL)는 불변.
    // 비네트: 수건 롤 + 물병 — 매트 곁에 놓여 "운동 코너"로 묶인다. (받침 데크는 시도했다가 뺐다:
    // 이 월드의 평탄 패드는 지반 0으로 눌러 만드는 얕은 크레이터라, 낮은 판은 턱에 늘 묻혀 보인다.
    // 그네·시소처럼 패드 바닥에 직접 놓는 게 이 지형의 문법.)
    const towel = GM(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10), 0xffffff, 0xcfc8ba);
    towel.rotation.z = Math.PI / 2;
    towel.rotation.y = 0.5;
    towel.position.set(-0.38, 0.045, -0.47);
    g.add(towel);
    const bottle = GM(new THREE.CylinderGeometry(0.028, 0.03, 0.11, 10), 0x93d1c8, 0x5fa197);
    bottle.position.set(0.4, 0.055, 0.47);
    g.add(bottle);
    const bottleCap = GM(new THREE.SphereGeometry(0.024, 8, 6), 0xf3ead8, 0xc2b79f);
    bottleCap.position.set(0.4, 0.117, 0.47);
    g.add(bottleCap);
    const MAT_COLS = [[0xa5d6ef, 0x76a8c8], [0xf7c6d3, 0xd897a8]];   // 하늘/분홍
    for (const [i, [lx, lz]] of GYM_MAT_LOCAL.entries()) {
        const mat = GM(new RoundedBoxGeometry(0.55, 0.048, 0.88, 3, 0.024), MAT_COLS[i][0], MAT_COLS[i][1], { curve: 1.4 });
        mat.position.set(lx, 0.024, lz);
        mat.rotation.y = (i ? -1 : 1) * 0.08;
        g.add(mat);
    }
    const bar = new THREE.Group();   // 스트레칭 바
    for (const s of [-1, 1]) {
        const postB = new THREE.Mesh(bakeGrad(new THREE.CylinderGeometry(0.034, 0.046, 0.52, 10), 0xbb9268, 0x7d5e40, { curve: 1.3 }), gradMatWood);
        postB.position.set(s * 0.45, 0.26, -0.62);
        bar.add(postB);
        const cap = new THREE.Mesh(bakeGrad(new THREE.SphereGeometry(0.042, 10, 8), 0xc79c70, 0x8a6a49), gradMatWood);
        cap.position.set(s * 0.45, 0.525, -0.62);
        bar.add(cap);
    }
    const rail = GM(new THREE.CylinderGeometry(0.027, 0.027, 0.92, 10), 0xe8c46f, 0xb98f42);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 0.5, -0.62);
    bar.add(rail);
    g.add(bar);
    const dumb = new THREE.Group();   // 아령 한 쌍
    const W_COLS = [[0xf5a394, 0xc96f60], [0x93d1c8, 0x5fa197]];     // 코랄/민트
    for (const [di, dz] of [[0, 0], [1, 0.13]]) {
        const shaft = GM(new THREE.CylinderGeometry(0.02, 0.02, 0.21, 10), 0xf3ead8, 0xc2b79f);
        shaft.rotation.z = Math.PI / 2;
        shaft.position.set(0, 0.05, dz);
        dumb.add(shaft);
        for (const s of [-1, 1]) {
            const w = GM(new THREE.SphereGeometry(0.052, 12, 10), W_COLS[di][0], W_COLS[di][1], { curve: 1.2 });
            w.position.set(s * 0.105, 0.05, dz);
            dumb.add(w);
        }
    }
    dumb.position.set(0.62, 0, 0.42);
    g.add(dumb);
    return g;
}
let gymBusy = false, gymAutoAt = Date.now() + 18 * 60000;
async function petStretch(player) {
    if (gymBusy) return;
    const pr = PROPS.find((q) => q.type === 'gym');
    if (!pr) return;
    const p = player || pets.find((q) => q !== possessed && !q.pet.sleeping && !q.bed && !q.dip
        && (q.ai.state === 'idle' || q.ai.state === 'walk'));
    if (!p) { showToast('🧘 지금 스트레칭할 펫이 없어요'); return; }
    gymBusy = true;
    try {
        if (p !== possessed) {
            const [lx, lz] = GYM_MAT_LOCAL[Math.floor(Math.random() * GYM_MAT_LOCAL.length)];
            const cy = Math.cos(pr.rotY || 0), sy = Math.sin(pr.rotY || 0);
            await Promise.race([gotoAsync(p, pr.x + lx * cy + lz * sy, pr.z - lx * sy + lz * cy), sleepMs(20000)]);
            p.ai.state = 'busy';
        }
        p.mover.rotation.y = pr.rotY || 0;   // 바를 보고
        logWorldEvent(`${petKo(p)}가 매트에서 스트레칭을 했다 🧘`);
        for (let rep = 0; rep < 2; rep++) {
            p.pet.action = { id: 'stretch', t: 0 };
            await sleepMs(3750);
        }
    } finally {
        gymBusy = false;
        if (p !== possessed) releaseAI(p);
    }
}

// ---- 도서관 코너 (⑤): 책장 + 독서 의자 둘(sit-침대) + 독서등. 앉으면 앞에 펼친 책이 떠서
// 페이지를 넘기듯 가끔 골똘해진다(💭). 몸통 클릭 = 펫이 와서 읽고, 한가할 땐 스스로도 온다. ----
const LIB_SEATS_LOCAL = [[-0.18, 0.52], [0.42, 0.46]];
let libBooks = [];
function makeLibrary() {
    const g = new THREE.Group();
    // 동숲식 조형: 책장에 톱라이트 그라디언트+크라운 몰딩, 책은 더 통통하고 살짝 기울여 꽂고
    // (전부 gradMat 공유 → 병합 후 드로우콜 1), 방석은 더 둥글게. 좌석 좌표(LIB_SEATS_LOCAL) 불변.
    const shelf = new THREE.Mesh(bakeGrad(new RoundedBoxGeometry(0.95, 1.0, 0.24, 3, 0.035), 0xc79a6b, 0x84603e, { curve: 1.25 }), gradMatWood);
    shelf.position.set(0, 0.5, -0.15);
    g.add(shelf);
    const crown = new THREE.Mesh(bakeGrad(new RoundedBoxGeometry(1.02, 0.055, 0.28, 2, 0.02), 0xd3a878, 0x9a7449), gradMatWood);
    crown.position.set(0, 1.02, -0.15);
    g.add(crown);
    let bookSeed = 7;
    const brand = () => { bookSeed = (bookSeed * 1664525 + 1013904223) >>> 0; return bookSeed / 4294967296; };
    const bookColors = [0xe8746a, 0xf2b04b, 0x8fd06c, 0x7fc9e8, 0xb39ddb, 0xf27ba0];
    const _bc = new THREE.Color(), _w = new THREE.Color(0xfff6e4), _d = new THREE.Color(0x2c2018);
    for (let row = 0; row < 3; row++) {
        let bx = -0.36;
        while (bx < 0.32) {
            const bw = 0.055 + brand() * 0.045;
            const bh = 0.17 + brand() * 0.065;
            _bc.setHex(bookColors[Math.floor(brand() * bookColors.length)]);
            const top = _bc.clone().lerp(_w, 0.28).getHex(), bot = _bc.clone().lerp(_d, 0.3).getHex();
            const book = GM(new RoundedBoxGeometry(bw, bh, 0.15, 2, 0.012), top, bot);
            book.position.set(bx + bw / 2, 0.22 + row * 0.3 + bh / 2, -0.14);
            book.rotation.z = (brand() - 0.5) * 0.14;   // 살짝 기대어 꽂힌 책들
            g.add(book);
            bx += bw + 0.018;
        }
    }
    const rug = GM(new THREE.CylinderGeometry(0.55, 0.55, 0.014, 24), 0xfae3c0, 0xe3c298);
    rug.position.set(0.1, 0.01, 0.45);
    g.add(rug);
    const CUSH_COLS = [[0xf7dd66, 0xd0ad38], [0xaecfec, 0x7fa6cb]];
    for (const [i, [lx, lz]] of LIB_SEATS_LOCAL.entries()) {
        const cush = GM(new RoundedBoxGeometry(0.35, 0.17, 0.32, 4, 0.075), CUSH_COLS[i][0], CUSH_COLS[i][1], { curve: 1.3 });
        cush.position.set(lx, 0.08, lz);
        g.add(cush);
    }
    // 비네트: 라운드 사이드 테이블 + 찻잔·받침 + 바닥에 쌓아둔 책 두 권 — 독서 코너의 완성.
    const tTop = new THREE.Mesh(bakeGrad(new THREE.CylinderGeometry(0.095, 0.105, 0.024, 14), 0xc79a6b, 0x8e6b46), gradMatWood);
    tTop.position.set(0.14, 0.15, 0.78);
    g.add(tTop);
    const tLeg = new THREE.Mesh(bakeGrad(new THREE.CylinderGeometry(0.022, 0.03, 0.14, 10), 0xa8845e, 0x7a5b3d), gradMatWood);
    tLeg.position.set(0.14, 0.07, 0.78);
    g.add(tLeg);
    const saucer = GM(new THREE.CylinderGeometry(0.037, 0.037, 0.008, 12), 0xfdf7e8, 0xd0c4ac);
    saucer.position.set(0.11, 0.166, 0.76);
    g.add(saucer);
    const cup = GM(new THREE.CylinderGeometry(0.024, 0.019, 0.034, 10), 0xfdf7e8, 0xd8ccb4);
    cup.position.set(0.11, 0.187, 0.76);
    g.add(cup);
    [[0xe8746a, 0.016], [0x7fc9e8, 0.046]].forEach(([bc, by], bi) => {
        const bb = GM(new RoundedBoxGeometry(0.12, 0.03, 0.09, 2, 0.01),
            _bc.setHex(bc).clone().lerp(_w, 0.25).getHex(), _bc.setHex(bc).clone().lerp(_d, 0.3).getHex());
        bb.position.set(0.38, by, 0.72);
        bb.rotation.y = bi * 0.45 - 0.2;
        g.add(bb);
    });
    const lpost = GM(new THREE.CylinderGeometry(0.02, 0.03, 0.7, 10), 0x8b9bad, 0x5c6a7a);
    lpost.position.set(-0.62, 0.35, 0.3);
    g.add(lpost);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), lampGlobeMat);
    globe.position.set(-0.62, 0.76, 0.3);
    g.add(globe);
    const light = new THREE.PointLight(0xffd9a0, 0, 3.2, 2);
    light.position.set(-0.62, 0.78, 0.3);
    g.add(light);
    const halo = glowSprite(0xffc978, 0.45, 0);
    halo.position.set(-0.62, 0.78, 0.3);
    g.add(halo);
    lamps.push({ light, glow: halo.material });
    return g;
}
function mkOpenBook() {
    const b = new THREE.Group();
    const pageL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.13), M(0xfdf3df));
    pageL.position.x = -0.05;
    pageL.rotation.z = 0.18;
    const pageR = pageL.clone();
    pageR.position.x = 0.05;
    pageR.rotation.z = -0.18;
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.014, 0.13), M(0x7fa8c9));
    b.add(pageL, pageR, spine);
    b.visible = false;
    scene.add(b);
    return b;
}
let libAutoAt = Date.now() + 14 * 60000;
async function petRead(player) {
    const bed = BEDS.find((b) => b.id.startsWith('libchair') && !b.occupant);
    const p = player || pets.find((q) => q !== possessed && !q.pet.sleeping && !q.bed && !q.dip
        && (q.ai.state === 'idle' || q.ai.state === 'walk'));
    if (!bed || !p || p.bed) { if (!player) return; showToast('📚 지금은 빈 의자가 없어요'); return; }
    p._libUntil = player ? 0 : Date.now() + (2 + Math.random() * 2) * 60000;   // 자율 독서만 타이머로 일어난다
    logWorldEvent(`${petKo(p)}가 도서관 의자에서 책을 폈다 📚`);
    mountBed(p, bed);
}
function updateLibrary(delta) {
    const libPr = PROPS.find((q) => q.type === 'library');
    if (!libPr) return;
    if (libBooks.length < 2) libBooks = [mkOpenBook(), mkOpenBook()];
    const now = Date.now();
    BEDS.filter((b) => b.id.startsWith('libchair')).forEach((bed, i) => {
        const book = libBooks[i];
        if (!book) return;
        const p = bed.occupant;
        if (p && p.bedPhase === 'lying') {
            book.visible = true;
            const fx = Math.sin(bed.lie.rotY), fz = Math.cos(bed.lie.rotY);
            book.position.set(bed.lie.x + fx * 0.27, bed.lie.y + 0.15 + Math.sin(wxTime.value * 1.2 + i) * 0.006, bed.lie.z + fz * 0.27);
            book.rotation.y = bed.lie.rotY;
            book.rotation.x = 0.35;
            if (!p.pet.action && Math.random() < delta / 7) p.pet.action = { id: 'think', t: 0 };   // 골똘…
            if (p._libUntil && now > p._libUntil) { p._libUntil = 0; p.bedExit = true; }
        } else {
            book.visible = false;
        }
    });
}

// ---- 🏰 모래놀이: sandspot-0에 앉으면 손에 삽이 들려 모래를 파고(스윙 + 모래 폴폴 + dig 모션),
// sandspot-1에 앉으면 성 곁에서 토닥토닥 만진다(손끝 모래 반짝 + happy). 도서관 책과 같은
// 문법 — 자리 점유를 보고 소품이 나타나 펫을 따라다닌다. ----
let sandShovel = null;
function mkShovel() {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.13, 6), M(0xb08a60, { map: woodTex }));
    handle.position.y = 0.065;
    g.add(handle);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 6).rotateZ(Math.PI / 2), M(0xb08a60, { map: woodTex }));
    grip.position.y = 0.13;
    g.add(grip);
    const scoop = new THREE.Mesh(new RoundedBoxGeometry(0.055, 0.016, 0.07, 2, 0.007), M(0xf05a5a));   // 코랄 장난감 삽날
    scoop.position.set(0, -0.005, 0.012);
    scoop.rotation.x = 0.35;
    g.add(scoop);
    g.visible = false;
    scene.add(g);
    return g;
}
// 앉기 다리 접기: 엔티티가 매 프레임 다리를 리셋하므로(updateGlbPetEntity가 먼저 돈다) 앉아
// 있는 동안 여기서 덮어쓰기만 하면 되고, 일어나면 자동 복원된다. -1.35 ≈ 앞으로 눕힌 다리.
function sandSitLegs(p) {
    for (const f of p.pet.feet) f.rotation.x = (f.userData._restRotX || 0) - 1.35;
}
function updateSandPlay(delta) {
    const s0 = BEDS.find((b) => b.id === 'sandspot-0');
    if (!s0) return;
    if (!sandShovel) sandShovel = mkShovel();
    const p0 = s0.occupant;
    if (p0 && p0.bedPhase === 'lying') {
        sandSitLegs(p0);
        sandShovel.visible = true;
        const fx = Math.sin(s0.lie.rotY), fz = Math.cos(s0.lie.rotY);
        const rx = Math.cos(s0.lie.rotY), rz = -Math.sin(s0.lie.rotY);
        const dig = Math.sin(wxTime.value * 3.4);   // 파기 스윙 박자
        sandShovel.position.set(   // 기대앉은 몸의 날개/앞발 높이(+0.1), 코앞(전방 0.09) — 쥔 것처럼
            s0.lie.x + fx * 0.09 + rx * 0.04,
            s0.lie.y + 0.1 + Math.max(0, dig) * 0.03,
            s0.lie.z + fz * 0.09 + rz * 0.04);
        sandShovel.rotation.y = s0.lie.rotY;
        sandShovel.rotation.x = 0.5 + dig * 0.45;
        if (Math.random() < delta / 2.2) {   // 퍼낸 모래가 폴폴
            for (let i = 0; i < 2; i++) {
                const spr = glowSprite(0xd9c49a, 0.05 + Math.random() * 0.04, 0.8);
                spr.position.set(sandShovel.position.x + (Math.random() - 0.5) * 0.06, s0.lie.y + 0.08, sandShovel.position.z + (Math.random() - 0.5) * 0.06);
                scene.add(spr);
                hugBurst.push({ spr, vx: fx * 0.25 + (Math.random() - 0.5) * 0.2, vy: 0.35, vz: fz * 0.25 + (Math.random() - 0.5) * 0.2, t: 0.4 });
            }
        }
        if (!p0.pet.action && Math.random() < delta / 5) p0.pet.action = { id: 'dig', t: 0 };
        if (p0._sandUntil && Date.now() > p0._sandUntil) { p0._sandUntil = 0; p0.bedExit = true; }
    } else if (sandShovel) {
        sandShovel.visible = false;
    }
    const s1 = BEDS.find((b) => b.id === 'sandspot-1');
    const p1 = s1 && s1.occupant;
    if (p1 && p1.bedPhase === 'lying') {
        sandSitLegs(p1);
        if (Math.random() < delta / 2.8) {   // 맨손으로 같이 판다 — 손끝에서 모래 반짝
            const fx = Math.sin(s1.lie.rotY), fz = Math.cos(s1.lie.rotY);
            const spr = glowSprite(0xe8d8b0, 0.05, 0.75);
            spr.position.set(s1.lie.x + fx * 0.16, s1.lie.y + 0.1, s1.lie.z + fz * 0.16);
            scene.add(spr);
            hugBurst.push({ spr, vx: (Math.random() - 0.5) * 0.2, vy: 0.25, vz: (Math.random() - 0.5) * 0.2, t: 0.35 });
        }
        // 빙글 도는 happy는 앉은 채 보면 어색하다(사용자 피드백) — 삽 없이 같이 파는 dig 모션으로
        if (!p1.pet.action && Math.random() < delta / 5) p1.pet.action = { id: 'dig', t: 0 };
        if (p1._sandUntil && Date.now() > p1._sandUntil) { p1._sandUntil = 0; p1.bedExit = true; }
    }
}
// 클릭 = 대리주문(심즈式): 한가한 펫을 골라 모래성으로 보낸다 — 이미 한 마리가 놀고 있으면
// 남은 자리(만지기)로 다른 친구가 간다. 조종 중엔 ⌘(일반 침대 문법)로 직접 앉는다.
function petSandPlay(player) {
    const free = BEDS.find((b) => b.id.startsWith('sandspot') && !b.occupant);
    const p = player || pets.find((q) => q !== possessed && !q.pet.sleeping && !q.bed && !q.dip
        && (q.ai.state === 'idle' || q.ai.state === 'walk'));
    if (!free || !p || p.bed) { if (!player) showToast('🏰 지금은 모래놀이 자리가 없어요'); return; }
    p._sandUntil = player ? 0 : Date.now() + 90000 + Math.random() * 90000;   // 자율 모래놀이만 타이머로 일어난다
    logWorldEvent(`${petKo(p)}가 모래성 곁에 앉아 모래놀이를 시작했다 🏖️`);
    mountBed(p, free);
}

// ---- 분수 (④): 자체 원형 돌 둘레 + 물그릇을 갖춘 독립 분수 — 물방울이 끊임없이 솟아 떨어지고,
// 가까이 가면 잔잔한 물소리가 난다 (파일 없는 노이즈 루프, 카메라 거리 감쇠).
// 물방울은 강수(precipPoints)와 같은 원칙의 GPU Points 하나: 프레임마다 스프라이트를 만들고
// 버리던 옛 방식(개당 드로우콜 + GC 압박)을 버리고, 버텍스 셰이더가 wxTime으로 각 방울의
// 포물선(p = v·t − ½g·t²)을 제 주기로 돌린다 — CPU 0, 드로우콜 1, 겉모습 동일. ----
let fountainPr = null;
let fountainHiss = null;
function makeFountain(p) {
    fountainPr = p;
    const g = new THREE.Group();
    // 동숲식 조형: 원기둥 스택 대신 Lathe 곡선 — 바깥으로 말린 립을 가진 수반, 플레어 받침에서
    // 잘록해졌다 컵으로 벌어지는 기둥. 따뜻한 크림 스톤에 위-밝음 그라디언트를 굽는다.
    const STONE_T = 0xf0e6d6, STONE_B = 0xa89a86;
    const lathe = (pts, segs = 28) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs);
    const basin = new THREE.Mesh(bakeGrad(lathe([
        [0.30, 0.05], [0.385, 0.055], [0.405, 0.115],          // 안바닥 → 안벽
        [0.415, 0.175], [0.45, 0.19], [0.485, 0.175], [0.5, 0.13],   // 도톰하게 말린 립
        [0.49, 0.05], [0.515, -0.05],                           // 바깥벽 → 치맛단 (지면 아래로 — 구릉에 뜨지 않게)
    ]), STONE_T, STONE_B, { yMin: 0, curve: 1.3 }), gradMatDS);
    g.add(basin);
    const basinWater = new THREE.Mesh(new THREE.CylinderGeometry(0.375, 0.375, 0.03, 24), new THREE.MeshBasicMaterial({ color: 0x6ec6e8, transparent: true, opacity: 0.75 }));
    basinWater.position.y = 0.055;
    g.add(basinWater);
    for (const [x, z, s] of [[-0.4, 0.18, 0.9], [0.32, -0.3, 1], [0.1, 0.42, 0.75]]) {   // 둘레 돌 (연못 스타일 재사용)
        const st = GM(new THREE.DodecahedronGeometry(0.06 * s, 0), 0xd8ccba, 0xa39684);
        st.position.set(x, 0.035, z);
        st.scale.y = 0.6;
        g.add(st);
    }
    const pedestal = new THREE.Mesh(bakeGrad(lathe([
        [0.0, 0.02], [0.19, 0.02], [0.215, 0.06], [0.13, 0.115],   // 둥근 받침 플레어
        [0.08, 0.17], [0.062, 0.29],                                // 잘록한 기둥 (테이퍼)
        [0.125, 0.35], [0.158, 0.40], [0.165, 0.445],               // 컵 바깥 곡선
        [0.128, 0.455], [0.112, 0.415], [0.0, 0.405],               // 말린 립 → 컵 안바닥
    ], 24), STONE_T, STONE_B, { curve: 1.2 }), gradMatDS);
    g.add(pedestal);
    const bowlWater = new THREE.Mesh(new THREE.CircleGeometry(0.108, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9fd8ff }));
    bowlWater.position.y = 0.42;
    g.add(bowlWater);
    // 비네트: 둘레 꽃 여섯 송이 — 분수가 남쪽 뜰의 포컬 포인트가 된다 (콜라이더 밖, 비차단 장식).
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.35;
        const fr = 0.62 + (i % 2) * 0.09;
        const fx = Math.cos(a) * fr, fz = Math.sin(a) * fr;
        const stem = GM(new THREE.CylinderGeometry(0.009, 0.011, 0.09, 6), 0x5d9a48, 0x3f6b30);
        stem.position.set(fx, 0.04, fz);
        g.add(stem);
        const fc = [0xff8fb3, 0xffd54f, 0xffffff][i % 3];
        const head = GM(new THREE.SphereGeometry(0.03, 10, 8), fc, new THREE.Color(fc).multiplyScalar(0.62).getHex(), { curve: 1.2 });
        head.position.set(fx, 0.095, fz);
        g.add(head);
    }
    {
        // 물방울 Points: 그릇(로컬 y 0.42)에서 솟아 바닥(로컬 y 0.02)에 떨어질 때까지의 포물선을
        // 방울마다 제 수명으로 반복한다. 예전 스프라이트 시뮬과 같은 분포(속도·크기·개수 ~24 동시).
        const N = 24, G = 3.2;
        const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
        const phase = new Float32Array(N), life = new Float32Array(N), sz = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            pos[i * 3 + 1] = 0.42;
            const a = Math.random() * Math.PI * 2, m = 0.12 + Math.random() * 0.22;
            const vy = 1.25 + Math.random() * 0.5;
            vel[i * 3] = Math.cos(a) * m; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = Math.sin(a) * m;
            life[i] = (vy + Math.sqrt(vy * vy + 2 * G * 0.365)) / G;   // 0.42 + vy·t − ½G·t² = 0.055(수면) 의 양근
            phase[i] = Math.random() * life[i];                        // 방울마다 어긋난 시작 위상
            sz[i] = (0.05 + Math.random() * 0.04) * 2.414;             // 스프라이트 월드 크기 → gl_PointSize 환산 (fov 45)
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
        geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
        geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
        const mat = new THREE.PointsMaterial({
            map: glowTex, color: 0xbfe8ff, size: 1, transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false, fog: false,   // glowSprite와 동일한 룩
        });
        mat.onBeforeCompile = (sh) => {
            sh.uniforms.uWxT = wxTime;
            sh.vertexShader = 'uniform float uWxT;\nattribute vec3 aVel;\nattribute float aPhase;\nattribute float aLife;\nattribute float aSize;\n'
                + sh.vertexShader
                    .replace('#include <begin_vertex>',
                        '#include <begin_vertex>\n'
                        + 'float fT = mod(uWxT + aPhase, aLife);\n'
                        + `transformed += vec3(aVel.x * fT, aVel.y * fT - ${(G / 2).toFixed(2)} * fT * fT, aVel.z * fT);`)
                    .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
        };
        const drops = new THREE.Points(geo, mat);
        drops.frustumCulled = false;   // 셰이더가 방울을 움직이니 정적 바운즈를 믿을 수 없다
        g.add(drops);                  // 그룹의 자식 — 공사모드로 분수가 이사해도 그대로 따라간다
    }
    return g;
}
function updateFountain(delta) {
    if (!fountainPr) return;
    // 물방울은 GPU(Points 셰이더)가 wxTime으로 알아서 돌린다 — 여기는 물소리 감쇠만 남았다.
    try {
        if (!fountainHiss) {
            const src = audioCtx.createBufferSource();
            src.buffer = synthNoiseBuffer(1.7, () => 0.35);
            src.loop = true;
            const lp = audioCtx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 2600;
            const gain = audioCtx.createGain();
            gain.gain.value = 0;
            src.connect(lp);
            lp.connect(gain);
            gain.connect(sfxMaster);
            src.start();
            fountainHiss = gain;
        }
        fountainHiss.gain.value = 0.03 * attAtPoint(fountainPr.x, fountainPr.z);
    } catch (e) {}
}

// ---- 꽃 심기 챌린지 (㉝): 바구니를 클릭해 모드를 켜고, 잔디를 클릭해 꽃을 심는다 — 100송이가
// 목표. 심은 꽃은 서버(config/world_flowers.json)에 남아 어느 기기에서나 같은 꽃밭이 된다. ----
const FLOWER_COLORS = [0xff8fb3, 0xffd54f, 0xffffff, 0xb39ddb, 0xff8a65, 0xf27ba0];
let flowerMode = false, flowersData = [];
const flowerGroup = new THREE.Group();
scene.add(flowerGroup);
let flowersDone = false;
function makeFlowerBasket() {
    const g = new THREE.Group();
    // 동숲식 조형: 배가 볼록한 Lathe 바구니 + 도톰하게 말린 테 + 속 채움판 + 큼직한 꽃송이와 잎.
    const basket = new THREE.Mesh(bakeGrad(new THREE.LatheGeometry([
        [0.0, 0.005], [0.085, 0.005], [0.122, 0.032], [0.143, 0.09], [0.128, 0.148],
    ].map(([x, y]) => new THREE.Vector2(x, y)), 18), 0xd9b078, 0x8f6a42, { curve: 1.2 }), gradMatWood);
    g.add(basket);
    const fill = GM(new THREE.CircleGeometry(0.115, 14).rotateX(-Math.PI / 2), 0x5d8244, 0x435f30);
    fill.position.y = 0.132;
    g.add(fill);
    const rim2 = new THREE.Mesh(bakeGrad(new THREE.TorusGeometry(0.128, 0.024, 10, 18).rotateX(Math.PI / 2), 0xc59a68, 0x8a6540), gradMatWood);
    rim2.position.y = 0.15;
    g.add(rim2);
    const handle = new THREE.Mesh(bakeGrad(new THREE.TorusGeometry(0.115, 0.019, 10, 16, Math.PI), 0xc59a68, 0x8a6540), gradMatWood);
    handle.position.y = 0.152;
    g.add(handle);
    for (const [x, z, c, s] of [[-0.045, 0.02, 0xff8fb3, 0.05], [0.05, -0.03, 0xffd54f, 0.046], [0.01, 0.05, 0xffffff, 0.038]]) {
        const head = GM(new THREE.SphereGeometry(s, 12, 10), c, new THREE.Color(c).multiplyScalar(0.62).getHex(), { curve: 1.2 });
        head.position.set(x, 0.175, z);
        g.add(head);
    }
    for (const [x, z] of [[-0.02, -0.045], [0.075, 0.035]]) {
        const leaf = GM(new THREE.SphereGeometry(0.026, 8, 6), 0x77b45a, 0x4a7336);
        leaf.scale.y = 0.55;
        leaf.position.set(x, 0.155, z);
        g.add(leaf);
    }
    // 비네트: 미니 씨앗 팻말 — "여기서 꽃을 심어요"가 그림으로 읽힌다.
    const sPost = new THREE.Mesh(bakeGrad(new THREE.CylinderGeometry(0.012, 0.016, 0.16, 8), 0xa8845e, 0x6f5238), gradMatWood);
    sPost.position.set(0.22, 0.08, -0.06);
    g.add(sPost);
    const sBoard = GM(new RoundedBoxGeometry(0.12, 0.075, 0.016, 2, 0.008), 0xfdf3da, 0xd9c9a8);
    sBoard.position.set(0.22, 0.175, -0.06);
    sBoard.rotation.y = -0.35;
    g.add(sBoard);
    const sBloom = GM(new THREE.SphereGeometry(0.016, 8, 6), 0xff8fb3, 0xa85f77);
    sBloom.position.set(0.185, 0.222, -0.075);
    g.add(sBloom);
    return g;
}
// 꽃은 InstancedMesh 두 개(줄기·머리)로 그린다 — 150송이 만발해도 드로우콜 2. 예전엔 송이마다
// 메시 2개(+개별 재질)라 꽃밭이 자랄수록 프레임이 무거워졌다. 머리 색은 instanceColor.
const FLOWER_CAP = 150;   // plantFlowerAt의 '가득해요' 상한과 같은 수
let flowerStemIM = null, flowerHeadIM = null;
const flowerTmpM = new THREE.Matrix4(), flowerTmpC = new THREE.Color();
function ensureFlowerIM() {
    if (flowerStemIM) return;
    flowerStemIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.009, 0.011, 0.1, 6), M(0x4e9a3d), FLOWER_CAP);
    // 머리 = 수평 꽃송이 quad — flowerTex(루미넌스 꽃잎 + 웜 수술)에 instanceColor(꽃색)가 곱해진다.
    // 들꽃(headMesh)과 같은 문법: 구슬 막대사탕이 아니라 꽃잎이 보이는 꽃.
    flowerHeadIM = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.095, 0.095).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ map: flowerTex, alphaTest: 0.4, side: THREE.DoubleSide, color: 0xffffff }), FLOWER_CAP);
    flowerStemIM.count = 0;
    flowerHeadIM.count = 0;
    flowerStemIM.frustumCulled = false;   // 인스턴스가 온 섬에 흩어진다 — 지오메트리 바운즈 무의미
    flowerHeadIM.frustumCulled = false;
    flowerGroup.add(flowerStemIM, flowerHeadIM);
}
function plantFlowerMesh(f) {
    ensureFlowerIM();
    const i = flowerStemIM.count;
    if (i >= FLOWER_CAP) return;
    const y = terrainHeight(f.x, f.z);
    flowerTmpM.makeTranslation(f.x, y + 0.05, f.z);
    flowerStemIM.setMatrixAt(i, flowerTmpM);
    flowerTmpM.makeTranslation(f.x, y + 0.105, f.z);
    flowerHeadIM.setMatrixAt(i, flowerTmpM);
    flowerHeadIM.setColorAt(i, flowerTmpC.set(f.c || 0xff8fb3));
    flowerStemIM.count = flowerHeadIM.count = i + 1;
    flowerStemIM.instanceMatrix.needsUpdate = true;
    flowerHeadIM.instanceMatrix.needsUpdate = true;
    flowerHeadIM.instanceColor.needsUpdate = true;
}
async function fetchFlowers() {
    try {
        const res = await fetch('/api/world_flowers');
        if (res.ok) flowersData = (await res.json()).flowers || [];
    } catch (e) {}
    flowersData.forEach(plantFlowerMesh);
    flowersDone = flowersData.length >= 100;
}
function onBasketClick() {
    flowerMode = !flowerMode;
    showToast(flowerMode
        ? `🌸 꽃심기 모드 — 잔디를 클릭해 심어요 (${flowersData.length}/100 · 바구니 다시 클릭 = 종료)`
        : '🌸 꽃심기 종료');
}
function plantFlowerAt(x, z) {
    if (world.isBlocked(x, z) || islandOf(x, z) < 0 || houseFloorY(x, z) !== null) return;
    if (flowersData.length >= 150) { showToast('🌸 꽃밭이 가득해요!'); return; }
    const f = { x: +x.toFixed(2), z: +z.toFixed(2), c: FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)] };
    flowersData.push(f);
    plantFlowerMesh(f);
    fetch('/api/world_flowers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
    }).catch(() => {});
    const n = flowersData.length;
    if (n === 100 && !flowersDone) {
        flowersDone = true;
        triggerHugBurst(x, terrainHeight(x, z) + 0.3, z);
        showToast('🌸 꽃 100송이 챌린지 달성! 동산이 꽃밭이 됐어요');
        logWorldEvent('꽃 100송이 챌린지를 달성했다 🌸🌸🌸');
        maybeProactive(null, '주인이 방금 꽃 100송이 챌린지를 달성했다! 온 동산이 꽃밭이다!');
    } else if (n % 10 === 0) {
        showToast(`🌸 ${n}/100`);
    }
}

// ---- 반딧불이 (⑱): 연못가에 점점이 떠다니는 초록 불빛 — 강수 Points 셰이더 재사용(아주 느린
// 낙하+큰 스웨이 = 떠다님), 두 군집이 어긋난 위상으로 깜빡이고 밤에만 떠오른다. ----
const fireflyTex = precipTexture((ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 13);
    g.addColorStop(0, 'rgba(235,255,190,1)');
    g.addColorStop(0.5, 'rgba(216,255,160,0.7)');
    g.addColorStop(1, 'rgba(216,255,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(16, 16, 13, 0, Math.PI * 2);
    ctx.fill();
});
const fireflyClouds = [];
for (let i = 0; i < 2; i++) {
    const pts = precipPoints(26, fireflyTex, 0.085, 0.02, 0.05, 0.55, 2.1, 1.6, 1.4);
    pts.position.set(-2.6, 0, -2.9);   // 연못가
    pts.material.blending = THREE.AdditiveBlending;
    pts.material.color.set(0xd8ffa0);
    fireflyClouds.push(pts);
}
function updateFireflies(delta) {
    const nightF = 1 - dayFactor(currentHour());
    const base = THREE.MathUtils.clamp((nightF - 0.55) / 0.45, 0, 1) * (1 - wxF);   // 깊은 밤 + 맑음에서만
    fireflyClouds.forEach((pts, i) => {
        pts.visible = base > 0.02;
        const blink = 0.55 + 0.45 * Math.sin(wxTime.value * (i ? 2.3 : 1.7) + i * 2.4);
        pts.material.opacity = base * blink * 0.85;
    });
}

// ---- 피아노 (⑪): 8건반 미니 스탠드 피아노 — 건반 클릭 = 그 음(주인의 손), 몸통 클릭이나
// ⌘ 근접 = 펫이 다가와 짧은 펜타토닉 즉흥곡을 춤추며 연주(펫의 몸). 소리는 오실레이터 2겹. ----
const PIANO_FREQS = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5];   // C5~C6
const PIANO_KEY_COLORS = [0xf28ba8, 0xf2b04b, 0xf2d54b, 0x8fd06c, 0x7fc9e8, 0x8f9de8, 0xc59de8, 0xf2a8c9];
let pianoKeys = null;
const pianoKeyAnims = [];
function makePiano() {
    const g = new THREE.Group();
    const wood = M(0x8a5a48, { map: woodTex });
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.34, 0.34, 3, 0.04), wood);
    body.position.y = 0.42;
    g.add(body);
    for (const lx of [-0.42, 0.42]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.28, 8), M(0x6f4436, { map: woodTex }));
        leg.position.set(lx, 0.14, 0);
        g.add(leg);
    }
    pianoKeys = [];
    for (let i = 0; i < 8; i++) {
        const key = new THREE.Mesh(new RoundedBoxGeometry(0.105, 0.05, 0.2, 2, 0.015), M(PIANO_KEY_COLORS[i]));
        key.position.set(-0.42 + i * 0.12, 0.615, 0.08);
        key.rotation.x = 0.12;
        key.userData.keyIdx = i;
        key.userData.restY = 0.615;
        g.add(key);
        pianoKeys.push(key);
    }
    const lid = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.05, 0.26, 2, 0.02), wood);
    lid.position.set(0, 0.68, -0.13);
    lid.rotation.x = -0.55;
    g.add(lid);
    return g;
}
function pianoNote(i, vol = 0.05) {
    try {
        const t0 = audioCtx.currentTime;
        for (const [type, mul, v] of [['triangle', 1, vol], ['sine', 2, vol * 0.3]]) {
            const o = audioCtx.createOscillator();
            o.type = type;
            o.frequency.value = PIANO_FREQS[i] * mul;
            const gn = audioCtx.createGain();
            gn.gain.setValueAtTime(0, t0);
            gn.gain.linearRampToValueAtTime(v, t0 + 0.015);
            gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
            o.connect(gn);
            gn.connect(sfxMaster);
            o.start(t0);
            o.stop(t0 + 0.95);
        }
    } catch (e) {}
    if (pianoKeys && pianoKeys[i]) pianoKeyAnims.push({ key: pianoKeys[i], t: 0 });
}
function updatePianoKeys(delta) {
    for (let i = pianoKeyAnims.length - 1; i >= 0; i--) {
        const a = pianoKeyAnims[i];
        a.t += delta;
        const k = Math.min(1, a.t / 0.22);
        a.key.position.y = a.key.userData.restY - Math.sin(k * Math.PI) * 0.022;
        if (k >= 1) pianoKeyAnims.splice(i, 1);
    }
}
function onPianoClick(pr, hit) {
    let o = hit && hit.object;
    while (o) {
        if (o.userData && o.userData.keyIdx != null) { pianoNote(o.userData.keyIdx); return; }
        o = o.parent;
    }
    petPlayPiano();   // 몸통 클릭 = 펫에게 연주 부탁 (심즈式 — 가까운 펫이 걸어와서 친다)
}
let pianoBusy = false, pianoAutoAt = Date.now() + 20 * 60000;
async function petPlayPiano(player) {
    if (pianoBusy) return;
    const pr = PROPS.find((q) => q.type === 'piano');
    if (!pr) return;
    const p = player || pets.find((q) => q !== possessed && !q.pet.sleeping && !q.bed && !q.dip
        && (q.ai.state === 'idle' || q.ai.state === 'walk'));
    if (!p) { showToast('🎹 지금 연주할 펫이 없어요'); return; }
    pianoBusy = true;
    try {
        if (p !== possessed) {
            const side = { x: pr.x + Math.sin(pr.rotY || 0) * 0.78, z: pr.z + Math.cos(pr.rotY || 0) * 0.78 };
            await Promise.race([gotoAsync(p, side.x, side.z), sleepMs(20000)]);
            p.ai.state = 'busy';
        }
        p.mover.rotation.y = Math.atan2(pr.x - p.mover.position.x, pr.z - p.mover.position.z);
        logWorldEvent(`${petKo(p)}가 피아노를 연주했다 🎹`);
        p.pet.action = { id: 'dance', t: 0 };   // 살랑이며 치는 몸
        const penta = [0, 1, 2, 4, 5, 7];
        let cur = 2;
        for (let n = 0; n < 12; n++) {
            cur = THREE.MathUtils.clamp(cur + Math.round((Math.random() - 0.5) * 2.4), 0, penta.length - 1);
            pianoNote(penta[cur], 0.045);
            await sleepMs(300 + Math.random() * 120);
        }
    } finally {
        pianoBusy = false;
        if (p !== possessed) releaseAI(p);
    }
}

// ---- 사진 게시판 (⑭): 코르크 보드에 최근 스크린샷 6장이 핀으로 꽂힌다. 클릭 = 라이트박스
// (◀ ▶로 전체 넘기기). 목록은 /api/screenshots_list, 원본은 /screenshots/ 정적 마운트. ----
let photoSlots = null, photoFiles = [];
function makePhotoboard() {
    const g = new THREE.Group();
    const wood = M(0x8a6647, { map: woodTex });
    for (const lx of [-0.55, 0.55]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.05, 0.07), wood);
        post.position.set(lx, 0.52, 0);
        g.add(post);
    }
    const frame = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.78, 0.06, 2, 0.02), wood);
    frame.position.y = 0.9;
    g.add(frame);
    const cork = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.66), M(0xd8b98a));
    cork.position.set(0, 0.9, 0.035);
    g.add(cork);
    const cap = new THREE.Mesh(new RoundedBoxGeometry(1.42, 0.06, 0.28, 2, 0.02), M(0x6f4436, { map: woodTex }));
    cap.position.y = 1.33;
    g.add(cap);
    photoSlots = [];
    for (let i = 0; i < 6; i++) {
        const col = i % 3, row = Math.floor(i / 3);
        const ph = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.255), new THREE.MeshBasicMaterial({ color: 0xf5efe2 }));
        ph.position.set(-0.38 + col * 0.38, 1.05 - row * 0.3, 0.045);
        ph.rotation.z = (Math.random() - 0.5) * 0.12;
        g.add(ph);
        const pin = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), M(0xe64a3c));
        pin.position.set(ph.position.x, ph.position.y + 0.12, 0.06);
        g.add(pin);
        photoSlots.push(ph);
    }
    refreshPhotoboard();
    return g;
}
const photoTexLoader = new THREE.TextureLoader();
async function refreshPhotoboard() {
    try {
        const res = await fetch('/api/screenshots_list');
        if (!res.ok) return;
        photoFiles = (await res.json()).files || [];
    } catch (e) { return; }
    if (!photoSlots) return;
    photoSlots.forEach((ph, i) => {
        const f = photoFiles[i];
        if (!f) return;
        photoTexLoader.load(`/screenshots/${encodeURIComponent(f)}`, (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            ph.material.map = t;
            ph.material.color.set(0xffffff);
            ph.material.needsUpdate = true;
        });
    });
}
const photoViewer = document.createElement('div');
photoViewer.style.cssText = 'position:fixed; inset:0; display:none; z-index:130; background:rgba(12,14,20,0.82); align-items:center; justify-content:center; gap:14px;';
const pvImg = document.createElement('img');
pvImg.style.cssText = 'max-width:min(86vw, 1100px); max-height:82vh; border-radius:12px; box-shadow:0 12px 44px rgba(0,0,0,0.6); background:#222;';
const mkPvBtn = (label) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'border:none; border-radius:10px; background:rgba(255,255,255,0.14); color:#fff; font-size:20px; padding:12px 14px; cursor:pointer;';
    return b;
};
const pvPrev = mkPvBtn('◀'), pvNext = mkPvBtn('▶'), pvClose = mkPvBtn('✕');
pvClose.style.position = 'absolute';
pvClose.style.top = '18px';
pvClose.style.right = '18px';
photoViewer.append(pvPrev, pvImg, pvNext, pvClose);
document.body.appendChild(photoViewer);
photoViewer.addEventListener('pointerdown', (e) => e.stopPropagation());
let pvIdx = 0;
function pvShow() {
    if (!photoFiles.length) return;
    pvIdx = ((pvIdx % photoFiles.length) + photoFiles.length) % photoFiles.length;
    pvImg.src = `/screenshots/${encodeURIComponent(photoFiles[pvIdx])}`;
}
pvPrev.onclick = () => { pvIdx -= 1; pvShow(); };
pvNext.onclick = () => { pvIdx += 1; pvShow(); };
pvClose.onclick = () => { photoViewer.style.display = 'none'; };
photoViewer.onclick = (e) => { if (e.target === photoViewer) photoViewer.style.display = 'none'; };
async function openPhotoViewer() {
    await refreshPhotoboard();
    if (!photoFiles.length) {
        showToast('📌 아직 사진이 없어요 — 📷 버튼으로 찍으면 여기 붙어요');
        return;
    }
    pvIdx = 0;
    pvShow();
    photoViewer.style.display = 'flex';
}

// ---- 별자리 만들기 (㉞): 밤에 전망대를 클릭하면 별 잇기 모드 — 별을 차례로 탭해 잇고 이름을
// 붙이면 그 별자리가 매일 밤 하늘에 남는다 (서버 config/world_constellations.json). 별밭은
// 고정 시드라 저장된 좌표가 부팅을 넘어 유효하다. Esc = 취소. ----
let constelMode = false;
let constelPicked = [];
let constelTempLine = null;
const constelMarks = [];
let constellations = [];
const constelBar = document.createElement('div');
constelBar.style.cssText = 'position:fixed; left:50%; bottom:calc(120px + env(safe-area-inset-bottom, 0px)); transform:translateX(-50%); display:none; z-index:96; align-items:center; gap:7px; background:rgba(30,32,40,0.93); border-radius:12px; padding:8px 10px; box-shadow:0 8px 28px rgba(0,0,0,0.4); font-family:sans-serif;';
const constelInfo = document.createElement('div');
constelInfo.style.cssText = 'color:#cfe3ff; font-size:12.5px;';
const constelName = document.createElement('input');
constelName.placeholder = '별자리 이름';
constelName.maxLength = 20;
constelName.style.cssText = 'border:none; border-radius:8px; background:rgba(255,255,255,0.1); color:#fff; font-size:13px; padding:6px 9px; width:120px;';
const mkCsBtn = (label, bg) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `border:none; border-radius:8px; background:${bg}; color:#fff; font-size:12.5px; font-weight:700; padding:6px 11px; cursor:pointer;`;
    return b;
};
const constelSave = mkCsBtn('⭐ 저장', '#5b8def');
const constelCancel = mkCsBtn('✕', 'rgba(255,255,255,0.14)');
constelBar.append(constelInfo, constelName, constelSave, constelCancel);
document.body.appendChild(constelBar);
constelBar.addEventListener('pointerdown', (e) => e.stopPropagation());
constelBar.addEventListener('keydown', (e) => e.stopPropagation());
function updateConstelBar() {
    constelInfo.textContent = constelPicked.length < 2 ? `⭐ 별을 차례로 탭해 이으세요 (${constelPicked.length})` : `⭐ ${constelPicked.length}개 연결됨`;
    constelSave.style.opacity = constelPicked.length >= 2 ? '1' : '0.4';
}
function clearConstelTemp() {
    if (constelTempLine) {
        scene.remove(constelTempLine);
        constelTempLine.geometry.dispose();
        constelTempLine = null;
    }
    for (const m of constelMarks) scene.remove(m);
    constelMarks.length = 0;
}
function endConstellationMode() {
    constelMode = false;
    constelBar.style.display = 'none';
    clearConstelTemp();
    constelPicked = [];
}
function onLookoutClick() {
    if (constelMode) return;
    if (dayFactor(currentHour()) > 0.3) { showToast('🔭 별자리는 밤에 — 해가 지면 다시 와요'); return; }
    constelMode = true;
    constelPicked = [];
    constelName.value = '';
    updateConstelBar();
    constelBar.style.display = 'flex';
    showToast('⭐ 별을 차례로 탭해 이어보세요 (Esc 취소)');
}
function pickConstelStar() {
    raycaster.params.Points.threshold = 1.3;
    const hits = starPts ? raycaster.intersectObject(starPts) : [];
    raycaster.params.Points.threshold = 1;
    if (!hits.length) return;
    const idx = hits[0].index;
    const pos = starPts.geometry.attributes.position;
    const v = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
    const last = constelPicked[constelPicked.length - 1];
    if (last && last.distanceTo(v) < 0.01) return;
    constelPicked.push(v);
    const mark = glowSprite(0xbfe3ff, 1.5, 0.85);
    mark.position.copy(v);
    scene.add(mark);
    constelMarks.push(mark);
    if (constelPicked.length >= 2) {
        if (constelTempLine) { scene.remove(constelTempLine); constelTempLine.geometry.dispose(); }
        constelTempLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(constelPicked), new THREE.LineBasicMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        scene.add(constelTempLine);
    }
    updateConstelBar();
}
function drawConstellation(c) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(c.points.map((p) => new THREE.Vector3(p.x, p.y, p.z))), constelLineMat);
    scene.add(line);
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(207,227,255,0.95)';
    ctx.fillText(c.name, 128, 42);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
    const centroid = c.points.reduce((a, p) => a.add(new THREE.Vector3(p.x, p.y, p.z)), new THREE.Vector3()).multiplyScalar(1 / c.points.length);
    label.position.copy(centroid).multiplyScalar(1.02).add(new THREE.Vector3(0, 1.6, 0));
    label.scale.set(6, 1.5, 1);
    scene.add(label);
    constelObjs.push({ line, label });
}
async function fetchConstellations() {
    try {
        const res = await fetch('/api/world_constellations');
        if (res.ok) constellations = (await res.json()).constellations || [];
    } catch (e) {}
    for (const c of constellations) drawConstellation(c);
}
constelCancel.onclick = () => endConstellationMode();
constelSave.onclick = async () => {
    if (constelPicked.length < 2) { showToast('⭐ 별을 두 개 이상 이어주세요'); return; }
    const name = constelName.value.trim() || '우리 별자리';
    const entry = { name, points: constelPicked.map((v) => ({ x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) })) };
    try {
        const res = await fetch('/api/world_constellations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
        });
        if (!res.ok) throw new Error(await res.text());
        constellations.push(entry);
        drawConstellation(entry);
        showToast(`⭐ 「${name}」 별자리가 밤하늘에 남았어요`);
        logWorldEvent(`밤하늘에 우리 별자리 「${name}」를 그렸다 ⭐`);
        maybeProactive(null, `주인이 방금 밤하늘에 「${name}」 별자리를 그렸다! 매일 밤 보이겠다.`);
        endConstellationMode();
    } catch (e) {
        console.error('[World] constellation save failed', e);
        showToast('⭐ 저장에 실패했어요 — 잠시 후 다시');
    }
};
fetchConstellations();   // 부팅 시 저장된 별자리를 하늘에 그려둔다
fetchFlowers();           // 부팅 시 저장된 꽃밭을 심어둔다

// ---- 텃밭 (⑫): 나무 프레임 안 2×2 밭. 빈 밭 클릭 = 심기(랜덤 작물), 자라는 중 클릭 = 물주기
// (다음 단계까지 남은 시간 절반, 단계당 1회), 다 자라면 클릭 = 수확. 성장은 실시간 — 씨앗→새싹
// 1시간, 새싹→수확 4시간. 상태는 서버(config/world_garden.json)라 기기끼리 같은 밭을 본다. ----
const GARDEN_CROPS = [
    { id: 'carrot', ko: '당근', emoji: '🥕' },
    { id: 'tomato', ko: '토마토', emoji: '🍅' },
    { id: 'sunflower', ko: '해바라기', emoji: '🌻' },
];
const GARDEN_T1 = 3600000, GARDEN_T2 = 14400000;
const GARDEN_PLOTS_LOCAL = [[-0.32, -0.21], [0.32, -0.21], [-0.32, 0.26], [0.32, 0.26]];
let gardenPlots = [null, null, null, null];   // { kind, plantedAt, boost, wateredStage } | null
let gardenGroups = null;
let gardenStageHash = '';
function gardenStage(pl) {   // 0 빈 밭, 1 씨앗, 2 새싹, 3 수확 가능
    if (!pl) return 0;
    const el = Date.now() - pl.plantedAt + (pl.boost || 0);
    return el >= GARDEN_T1 + GARDEN_T2 ? 3 : el >= GARDEN_T1 ? 2 : 1;
}
function buildPlotVisual(stage, kind) {
    const v = new THREE.Group();
    if (stage === 1) {
        const mound = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), M(0x7d5c38));
        mound.scale.y = 0.5;
        v.add(mound);
    } else if (stage === 2) {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.11, 6), M(0x4e9a3d));
        stem.position.y = 0.055;
        v.add(stem);
        for (const s of [-1, 1]) {
            const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), M(0x66bb4a));
            leaf.position.set(s * 0.04, 0.11, 0);
            leaf.scale.set(1, 0.5, 0.6);
            v.add(leaf);
        }
    } else if (stage === 3) {
        if (kind === 'carrot') {
            const top = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, 8), M(0xf28034));
            top.position.y = 0.035;
            v.add(top);
            for (const a of [0, 2.1, 4.2]) {
                const frond = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 6), M(0x4e9a3d));
                frond.position.set(Math.sin(a) * 0.03, 0.13, Math.cos(a) * 0.03);
                frond.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
                v.add(frond);
            }
        } else if (kind === 'tomato') {
            const bush = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), M(0x4d9a44));
            bush.position.y = 0.1;
            v.add(bush);
            for (const [x, y, z] of [[0.07, 0.13, 0.05], [-0.06, 0.09, 0.08], [0.02, 0.16, -0.06]]) {
                const t = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), M(0xe64a3c));
                t.position.set(x, y, z);
                v.add(t);
            }
        } else {
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, 0.26, 6), M(0x4e9a3d));
            stem.position.y = 0.13;
            v.add(stem);
            const petals = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 12), M(0xf2c53d));
            petals.position.y = 0.27;
            petals.rotation.x = 0.5;
            v.add(petals);
            const core = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), M(0x6f5030));
            core.position.set(0, 0.275, 0.012);
            v.add(core);
        }
    }
    return v;
}
function refreshGardenVisuals() {
    if (!gardenGroups) return;
    gardenGroups.forEach((pg, i) => {
        for (let c = pg.children.length - 1; c >= 0; c--) {
            const ch = pg.children[c];
            pg.remove(ch);
            ch.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        }
        const st = gardenStage(gardenPlots[i]);
        if (st > 0) pg.add(buildPlotVisual(st, gardenPlots[i].kind));
    });
    gardenStageHash = gardenPlots.map((pl) => gardenStage(pl)).join('');
}
function makeGarden() {
    const g = new THREE.Group();
    const wood = M(0x8a6647, { map: woodTex });
    for (const [x, z, w, d] of [[0, -0.52, 1.5, 0.12], [0, 0.57, 1.5, 0.12], [-0.72, 0.025, 0.12, 1.0], [0.72, 0.025, 0.12, 1.0]]) {
        const rail = new THREE.Mesh(new RoundedBoxGeometry(w, 0.16, d, 2, 0.03), wood);
        rail.position.set(x, 0.08, z);
        g.add(rail);
    }
    const soil = GM(new THREE.BoxGeometry(1.36, 0.07, 0.98), 0x96744e, 0x684d31);   // 팔레트 ④: 어둡던 흙을 웜 브라운 + 톱라이트로 — 멀리서 "검은 판"으로 읽히던 문제
    soil.position.set(0, 0.07, 0.025);
    g.add(soil);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10), M(0x7fa8c9));
    can.position.set(0.68, 0.2, -0.5);
    g.add(can);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.12, 6), M(0x7fa8c9));
    spout.position.set(0.61, 0.22, -0.46);
    spout.rotation.z = 0.9;
    g.add(spout);
    gardenGroups = GARDEN_PLOTS_LOCAL.map(([lx, lz], i) => {
        const pg = new THREE.Group();
        pg.position.set(lx, 0.105, lz);
        pg.userData.plotIdx = i;
        // 빈 밭도 클릭되도록 투명 픽킹 패드
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.38), new THREE.MeshBasicMaterial({ visible: false }));
        pad.userData.plotIdx = i;
        pg.add(pad);
        g.add(pg);
        return pg;
    });
    refreshGardenVisuals();
    return g;
}
async function fetchGarden() {
    try {
        const res = await fetch('/api/world_garden');
        if (res.ok) {
            const j = await res.json();
            if (Array.isArray(j.plots)) gardenPlots = [0, 1, 2, 3].map((i) => j.plots[i] || null);
        }
    } catch (e) {}
    refreshGardenVisuals();
}
function saveGarden() {
    fetch('/api/world_garden', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plots: gardenPlots }),
    }).catch(() => {});
}
function onGardenClick(pr, hit) {
    let o = hit && hit.object, idx = -1;
    while (o) {
        if (o.userData && o.userData.plotIdx != null) { idx = o.userData.plotIdx; break; }
        o = o.parent;
    }
    const cy = Math.cos(pr.rotY || 0), sy = Math.sin(pr.rotY || 0);
    // 픽킹 패드(0.5×0.38)를 못 맞히면 흙판·틀에 맞아 안내 토스트만 나와 "작동 안 함"으로 읽혔다 —
    // 텃밭 어디를 찍었든 히트 지점에서 가장 가까운 밭 칸으로 해석한다 (의도는 자명하니까).
    if (idx < 0 && hit && hit.point) {
        let best = Infinity;
        GARDEN_PLOTS_LOCAL.forEach(([plx, plz], i) => {
            const px = pr.x + plx * cy + plz * sy, pz = pr.z - plx * sy + plz * cy;
            const d = Math.hypot(hit.point.x - px, hit.point.z - pz);
            if (d < best) { best = d; idx = i; }
        });
        if (best > 1.1) idx = -1;   // 텃밭 몸통에서 한참 벗어난 히트만 안내로
    }
    if (idx < 0) { showToast('🌱 밭 한 칸을 콕 집어 클릭해 보세요'); return; }
    const pl = gardenPlots[idx];
    const st = gardenStage(pl);
    const [lx, lz] = GARDEN_PLOTS_LOCAL[idx];
    const wx = pr.x + lx * cy + lz * sy, wz = pr.z - lx * sy + lz * cy;
    if (st === 0) {
        const crop = GARDEN_CROPS[Math.floor(Math.random() * GARDEN_CROPS.length)];
        gardenPlots[idx] = { kind: crop.id, plantedAt: Date.now(), boost: 0, wateredStage: 0 };
        showToast(`🌱 ${crop.ko} 씨앗을 심었어요`);
        logWorldEvent(`텃밭에 ${crop.ko} 씨앗을 심었다 🌱`);
    } else if (st === 3) {
        const crop = GARDEN_CROPS.find((c) => c.id === pl.kind) || GARDEN_CROPS[0];
        gardenPlots[idx] = null;
        triggerHugBurst(wx, terrainHeight(wx, wz) + 0.25, wz);
        showToast(`${crop.emoji} ${crop.ko} 수확!`);
        logWorldEvent(`텃밭에서 ${crop.ko}를 수확했다 ${crop.emoji}`);
        maybeProactive(null, `주인이 방금 텃밭에서 ${crop.ko}를 수확했다! 맛있겠다!`);
        const p = pets.find((q) => q.ai.state === 'idle' || q.ai.state === 'walk');
        if (p) p.pet.action = { id: 'happy', t: 0 };
    } else {
        if (pl.wateredStage === st) { showToast('💧 이 단계엔 이미 물을 줬어요 — 조금만 기다려요'); return; }
        pl.wateredStage = st;
        const el = Date.now() - pl.plantedAt + (pl.boost || 0);
        const target = st === 1 ? GARDEN_T1 : GARDEN_T1 + GARDEN_T2;
        pl.boost = (pl.boost || 0) + Math.max(0, (target - el) / 2);
        showToast('💧 물을 줬어요 — 쑥쑥!');
        logWorldEvent('텃밭에 물을 줬다 💧');
        const y = terrainHeight(wx, wz) + 0.2;
        for (let i = 0; i < 6; i++) {
            const spr = glowSprite(0x8fc9f2, 0.1 + Math.random() * 0.07, 0.85);
            spr.position.set(wx + (Math.random() - 0.5) * 0.25, y, wz + (Math.random() - 0.5) * 0.25);
            scene.add(spr);
            hugBurst.push({ spr, vx: (Math.random() - 0.5) * 0.3, vy: -0.25 - Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.3, t: 0.5 });
        }
    }
    saveGarden();
    refreshGardenVisuals();
}
fetchGarden();   // 부팅 시 서버의 밭 상태를 읽는다

// ---- 워프 포탈 (㉖): 광장가 ↔ 모험의 섬 돌링 한 쌍. AI 펫은 buildRoute가 "포탈 경유가 확실히
// 짧을 때만" tp 웨이포인트를 심어 순간이동하고, 조종 중인 펫은 소용돌이에 들어서면 넘어간다.
// 링은 r 0(비차단) — 차단원이면 경로 스텝퍼가 blocked=도착으로 오인해 중간에 멈춘다. ----
function makePortal() {
    const g = new THREE.Group();
    const stone = M(0x9aa3ad, { flatShading: true });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.12, 10), stone);
    base.position.y = 0.06;
    g.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.075, 10, 22), M(0x7c8894, { flatShading: true }));
    ring.position.y = 0.62;
    g.add(ring);
    const mat = new THREE.ShaderMaterial({   // 도는 나선 — 오로라와 같은 셰이더 계열, 드로우콜 1
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uT: wxTime },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
            uniform float uT; varying vec2 vUv;
            void main(){
                vec2 c = vUv - 0.5;
                float r = length(c) * 2.0;
                float ang = atan(c.y, c.x);
                float sw = sin(ang * 3.0 - uT * 2.4 + r * 7.0) * 0.5 + 0.5;
                float a = smoothstep(1.0, 0.15, r) * (0.25 + 0.55 * sw);
                vec3 col = mix(vec3(0.45, 0.95, 1.0), vec3(0.62, 0.5, 1.0), r);
                gl_FragColor = vec4(col, a);
            }`,
    });
    const swirl = new THREE.Mesh(new THREE.CircleGeometry(0.36, 24), mat);
    swirl.position.y = 0.62;
    g.add(swirl);
    const halo = glowSprite(0x8fd8ff, 0.9, 0.35);
    halo.position.y = 0.62;
    g.add(halo);
    return g;
}
const PORTALS = PROPS.filter((q) => q.type === 'portal');
const portalExit = (pr) => ({ x: pr.x + Math.sin(pr.rotY || 0) * 0.75, z: pr.z + Math.cos(pr.rotY || 0) * 0.75 });
let portalCoolAt = 0, portalLogAt = 0;
function portalSparkle(x, z) {
    const y = terrainHeight(x, z) + 0.3;
    for (let i = 0; i < 8; i++) {
        const spr = glowSprite(Math.random() < 0.5 ? 0x7fe8ff : 0xb490ff, 0.14 + Math.random() * 0.1, 0.9);
        spr.position.set(x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.3);
        scene.add(spr);
        hugBurst.push({ spr, vx: (Math.random() - 0.5) * 0.7, vy: 0.4 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.7, t: 0 });
    }
}
function portalHop(p, to) {
    portalSparkle(p.mover.position.x, p.mover.position.z);
    p.mover.position.set(to.x, world.groundHeightAt(to.x, to.z), to.z);
    portalSparkle(to.x, to.z);
    try {   // 슝— 위로 감기는 스윕음
        const o = audioCtx.createOscillator();
        o.type = 'sine';
        const gn = audioCtx.createGain();
        const t0 = audioCtx.currentTime;
        o.frequency.setValueAtTime(280, t0);
        o.frequency.exponentialRampToValueAtTime(980, t0 + 0.22);
        gn.gain.setValueAtTime(0.05, t0);
        gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        o.connect(gn);
        gn.connect(sfxMaster);
        o.start(t0);
        o.stop(t0 + 0.32);
    } catch (e) {}
    if (Date.now() - portalLogAt > 60000) {
        portalLogAt = Date.now();
        logWorldEvent(`${petKo(p)}가 워프 포탈을 통과했다 🌀`);
    }
}

// ---- 추억의 섬 (SW, ㉒㉓㉔): 쪼아쪼아나무 · 소원우물 · 타임캡슐 — 기념비와 함께 다리 건너
// 우리만의 성지. 나무·우물·캡슐은 클릭/탭으로 상호작용한다 (renderer pointerup의 PROP_CLICKS). ----
function mkHeart(scale, mat) {
    const h = new THREE.Group();
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.052 * scale, 10, 8), mat);
    l.position.x = -0.036 * scale;
    const r = l.clone();
    r.position.x = 0.036 * scale;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.088 * scale, 0.088 * scale, 0.058 * scale), mat);
    b.rotation.z = Math.PI / 4;
    b.position.y = -0.045 * scale;
    h.add(l, r, b);
    return h;
}
function makePeckTree() {
    // 하트잎 나무: 사시사철 장미빛 캐노피(계절 리베이크에 등록하지 않는다 — 언제나 우리의 분홍)
    // + 하트 열매 다섯 알. 겨울 눈모자만 계절을 따른다.
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.5, 10), M(0x8a5a48, { map: woodTex }));
    trunk.position.y = 0.25;
    g.add(trunk);
    const lobes = [
        [0, 0.66, 0, 0.3, 0xff9db8, 0xd06080],
        [0.2, 0.56, 0.08, 0.22, 0xffb2c8, 0xdb7295],
        [-0.2, 0.58, -0.05, 0.23, 0xffb2c8, 0xdb7295],
        [0, 0.84, 0, 0.2, 0xffa8c0, 0xd06888],
    ];
    for (const [x, y, z, r, top, bottom] of lobes) {
        const s = new THREE.Mesh(gradSphereGeo(r, top, bottom), leafMatGrad);
        s.position.set(x, y, z);
        g.add(s);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.045, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.4), snowCapMat);
        cap.position.set(x, y, z);
        cap.visible = false;
        g.add(cap);
        seasonSnowCaps.push(cap);
    }
    const fruitMat = M(0xe8506e);
    for (const [x, y, z, ry] of [[0.26, 0.62, 0.14, 0.4], [-0.24, 0.7, 0.1, 2.2], [0.05, 0.9, 0.05, 1.1], [0.18, 0.5, -0.2, 3.6], [-0.15, 0.52, 0.22, 5.0]]) {
        const f = mkHeart(0.45, fruitMat);
        f.position.set(x, y, z);
        f.rotation.y = ry;
        g.add(f);
    }
    return g;
}
let peckLogAt = 0, peckDuoCooldownUntil = 0;
function onPeckTreeClick(pr) {
    const y = terrainHeight(pr.x, pr.z) + 0.7;
    triggerHugBurst(pr.x, y, pr.z);
    try {   // "쪼아쪼아~" — 네 번의 짧은 쪼기 삑
        const t0 = audioCtx.currentTime;
        [988, 1319, 988, 1319].forEach((f, i) => {
            const at = t0 + [0, 0.09, 0.24, 0.33][i];
            const o = audioCtx.createOscillator();
            o.type = 'square';
            o.frequency.value = f;
            const gn = audioCtx.createGain();
            gn.gain.setValueAtTime(0, at);
            gn.gain.linearRampToValueAtTime(0.03, at + 0.012);
            gn.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
            o.connect(gn);
            gn.connect(sfxMaster);
            o.start(at);
            o.stop(at + 0.14);
        });
    } catch (e) {}
    if (Date.now() - peckLogAt > 60000) {   // 연타는 소리만 — 로그는 분당 하나
        peckLogAt = Date.now();
        logWorldEvent('쪼아쪼아 나무를 콕콕 두드렸다 — 하트가 반짝 💗');
    }
}
// 소원 우물: 돌 몸통 + 지붕 달린 도르래 + 두레박. 클릭하면 소원 패널이 뜬다.
function makeWell() {
    const g = new THREE.Group();
    const stone = M(0xb9c1ca, { map: plasterTex });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.3, 14), stone);
    body.position.y = 0.15;
    g.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 10, 18), M(0x9aa3ad));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.31;
    g.add(rim);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.27, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1d3a5f }));
    water.position.y = 0.26;
    g.add(water);
    const glint = new THREE.Mesh(new THREE.CircleGeometry(0.025, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd968 }));
    glint.position.set(0.08, 0.262, -0.05);   // 먼저 던져진 동전 하나가 반짝
    g.add(glint);
    const wood = M(0xb08a60, { map: woodTex }), woodDark = M(0x8a6647, { map: woodTex });
    for (const px of [-0.3, 0.3]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.05), wood);
        post.position.set(px, 0.55, 0);
        g.add(post);
    }
    for (const s of [-1, 1]) {
        const slope = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, 0.44), woodDark);
        slope.position.set(s * 0.155, 0.985, 0);
        slope.rotation.z = -s * 0.66;
        g.add(slope);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.64, 8), woodDark);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 0.78;
    g.add(bar);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 6), M(0xd8c49a));
    rope.position.y = 0.66;
    g.add(rope);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.08, 10, 1, true), woodDark);
    bucket.position.y = 0.52;
    g.add(bucket);
    return g;
}
// 타임캡슐: 흙무덤에 반쯤 파묻힌 상자 뚜껑 + 팻말. 클릭하면 캡슐 패널이 뜬다.
function makeCapsule() {
    const g = new THREE.Group();
    const mound = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), M(0x9a7b55));
    mound.scale.y = 0.34;
    mound.position.y = 0.02;
    g.add(mound);
    const lid = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.09, 0.18, 3, 0.02), M(0xb08a60, { map: woodTex }));
    lid.position.y = 0.1;
    lid.rotation.set(-0.08, 0, 0.1);
    g.add(lid);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.095, 0.05), M(0x6f5030));
    strap.position.y = 0.1;
    strap.rotation.set(-0.08, 0, 0.1);
    g.add(strap);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.055), M(0xffd968));
    buckle.position.set(0.0, 0.145, 0.0);
    buckle.rotation.set(-0.08, 0, 0.1);
    g.add(buckle);
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.24, 8), M(0x8a6647, { map: woodTex }));
    stake.position.set(0.24, 0.12, -0.1);
    g.add(stake);
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 80;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#f0e6cf';
    ctx.fillRect(0, 0, 128, 80);
    ctx.textAlign = 'center';
    ctx.font = '44px sans-serif';
    ctx.fillText('🕰️', 64, 58);
    const signTex = new THREE.CanvasTexture(cv);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.09), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
    sign.position.set(0.24, 0.26, -0.1);
    sign.rotation.y = 0.5;
    g.add(sign);
    return g;
}
// 소원 우물 패널
const wellUI = memorialPanel('⛲ 소원 우물');
const wishInput = memoInput('소원을 적어요… (동전과 함께 우물에 잠겨요)');
const wishToss = memoBtn('🪙 동전 던지고 소원 빌기');
const wishListEl = document.createElement('div');
wishListEl.style.cssText = 'display:flex; flex-direction:column; gap:5px; border-top:1px dashed rgba(120,90,50,0.35); padding-top:8px;';
wellUI.body.append(wishInput, wishToss, wishListEl);
let wishesData = [];
function renderWishes() {
    wishListEl.textContent = '';
    if (!wishesData.length) {
        wishListEl.textContent = '아직 빌어둔 소원이 없어요.';
        return;
    }
    for (const w of [...wishesData].reverse().slice(0, 30)) {
        const row = document.createElement('div');
        const d = new Date(w.ts);
        row.textContent = `✨ ${d.getMonth() + 1}.${d.getDate()} — ${w.text}`;
        row.style.cssText = 'line-height:1.5;';
        wishListEl.appendChild(row);
    }
}
async function fetchWishes() {
    try {
        const res = await fetch('/api/world_wishes');
        if (res.ok) wishesData = (await res.json()).wishes || [];
    } catch (e) {}
    renderWishes();
}
const coinFlights = [];   // { m, t, x, z, y0 }
wishToss.onclick = async () => {
    const text = wishInput.value.trim();
    if (!text) { showToast('⛲ 소원을 먼저 적어주세요'); return; }
    wishToss.disabled = true;
    try {
        const res = await fetch('/api/world_wishes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(await res.text());
        wishesData.push((await res.json()).wish);
        wishInput.value = '';
        renderWishes();
        const pr = PROPS.find((q) => q.type === 'well');
        if (pr) {   // 동전이 포물선을 그리며 우물로 퐁당
            const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 12), M(0xffd968));
            const y0 = terrainHeight(pr.x, pr.z);
            coin.position.set(pr.x + 0.55, y0 + 0.55, pr.z + 0.35);
            scene.add(coin);
            coinFlights.push({ m: coin, t: 0, x: pr.x, z: pr.z, y0 });
        }
        showToast('✨ 소원이 우물 깊이 잠겼어요');
        logWorldEvent('소원 우물에 동전을 던지고 소원을 빌었다 ✨');
        maybeProactive(null, '주인이 방금 소원 우물에 동전을 던졌다! 무슨 소원인지 궁금하다.');
    } catch (e) {
        console.error('[World] wish failed', e);
        showToast('⛲ 소원 저장에 실패했어요 — 잠시 후 다시');
    } finally {
        wishToss.disabled = false;
    }
};
function openWellPanel() {
    wellUI.panel.style.display = 'flex';
    fetchWishes();
}
// 타임캡슐 패널
const capUI = memorialPanel('🕰️ 타임캡슐');
const capInput = memoInput('미래의 우리에게 남길 말…', 3);
const capDate = document.createElement('input');
capDate.type = 'date';
capDate.style.cssText = 'border:1px solid rgba(120,90,50,0.35); border-radius:8px; background:#fffdf6; color:#4a3f30; font-size:13px; padding:6px 9px; font-family:sans-serif;';
const capBury = memoBtn('🕰️ 캡슐 묻기');
const capListEl = document.createElement('div');
capListEl.style.cssText = 'display:flex; flex-direction:column; gap:7px; border-top:1px dashed rgba(120,90,50,0.35); padding-top:8px;';
capUI.body.append(capInput, capDate, capBury, capListEl);
let capsulesData = [];
function renderCapsules() {
    capListEl.textContent = '';
    if (!capsulesData.length) {
        capListEl.textContent = '아직 묻어둔 캡슐이 없어요.';
        return;
    }
    const today = localDateStr();
    for (const c of [...capsulesData].reverse()) {
        const row = document.createElement('div');
        row.style.cssText = 'line-height:1.5;';
        const buried = new Date(c.ts);
        if (c.opened) {
            row.textContent = `📜 (${buried.getMonth() + 1}.${buried.getDate()}에 묻음 · 개봉함) ${c.text}`;
        } else if (today >= c.openAt) {
            const btn = memoBtn('🎁 열어보기');
            btn.style.padding = '4px 8px';
            btn.onclick = () => openCapsule(c.id);
            row.textContent = `🎁 ${c.openAt.replace(/-/g, '.')} 캡슐이 열릴 준비가 됐어요! `;
            row.appendChild(btn);
        } else {
            const dday = Math.max(1, Math.ceil((new Date(c.openAt) - Date.now()) / 86400000));
            row.textContent = `🔒 ${c.openAt.replace(/-/g, '.')}에 열려요 (D-${dday})`;
        }
        capListEl.appendChild(row);
    }
}
async function fetchCapsules() {
    try {
        const res = await fetch('/api/world_capsules');
        if (res.ok) capsulesData = (await res.json()).capsules || [];
    } catch (e) {}
    renderCapsules();
}
capBury.onclick = async () => {
    const text = capInput.value.trim();
    if (!text) { showToast('🕰️ 남길 말을 먼저 적어주세요'); return; }
    if (!capDate.value || capDate.value <= localDateStr()) { showToast('🕰️ 내일 이후의 개봉 날짜를 골라주세요'); return; }
    capBury.disabled = true;
    try {
        const res = await fetch('/api/world_capsules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'bury', text, openAt: capDate.value }),
        });
        if (!res.ok) throw new Error(await res.text());
        capsulesData.push((await res.json()).capsule);
        capInput.value = '';
        renderCapsules();
        showToast(`🕰️ 타임캡슐을 묻었어요 — ${capDate.value.replace(/-/g, '.')}에 만나요`);
        logWorldEvent('타임캡슐을 묻었다 — 미래의 우리에게 🕰️');
        maybeProactive(null, '주인이 방금 타임캡슐을 묻었다! 안에 뭐가 들었을까.');
    } catch (e) {
        console.error('[World] capsule bury failed', e);
        showToast('🕰️ 캡슐 묻기에 실패했어요 — 잠시 후 다시');
    } finally {
        capBury.disabled = false;
    }
};
async function openCapsule(id) {
    try {
        const res = await fetch('/api/world_capsules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'open', id }),
        });
        if (!res.ok) throw new Error(await res.text());
        const c = (await res.json()).capsule;
        const i = capsulesData.findIndex((q) => q.id === id);
        if (i >= 0) capsulesData[i] = c;
        renderCapsules();
        const pr = PROPS.find((q) => q.type === 'capsule');
        if (pr) triggerHugBurst(pr.x, terrainHeight(pr.x, pr.z) + 0.3, pr.z);
        showToast('🎁 타임캡슐이 열렸어요!');
        logWorldEvent('묻어두었던 타임캡슐을 열었다 🎁');
        maybeProactive(null, '방금 타임캡슐이 열렸다! 과거의 주인이 남긴 말이 나왔다.');
    } catch (e) {
        console.error('[World] capsule open failed', e);
        showToast('🎁 개봉에 실패했어요 — 잠시 후 다시');
    }
}
function openCapsulePanel() {
    const tomorrow = new Date(Date.now() + 86400000);
    capDate.min = localDateStr(tomorrow);
    if (!capDate.value || capDate.value < capDate.min) capDate.value = capDate.min;
    capUI.panel.style.display = 'flex';
    fetchCapsules();
}
// ---- 상호작용 문법 통일 (실무 조사 반영): "세상은 클릭, 펫 몸은 ⌘" — 클릭/탭 = 주인의 손
// (패널·스위치·대리주문, 심즈式), ⌘/✋ = 조종 중인 펫의 몸(탑승·운전·손잡기, 동숲式). 마크처럼
// 두 경로를 병행하고, Roblox ProximityPrompt처럼 호버 라벨이 "무엇이 되는지"를 그 자리에서
// 알려준다 (updateHoverPrompt). ----
const PROP_CLICKS = {
    pecktree: onPeckTreeClick,
    well: () => openWellPanel(),
    capsule: () => openCapsulePanel(),
    radio: () => toggleRadioPanel(),
    lamp: () => cycleLampBrightness(),
    coffee: () => toggleCoffeePanel(),
    food: () => toggleFoodPanel(),
    garden: (pr, hit) => onGardenClick(pr, hit),
    piano: (pr, hit) => onPianoClick(pr, hit),
    photoboard: () => openPhotoViewer(),
    lookout: (pr, hit) => onLookoutClick(pr, hit),
    mailbox: () => openMailbox(),
    gym: () => petStretch(),
    library: () => petRead(),
    flowerbasket: () => onBasketClick(),
    sandcastle: () => petSandPlay(),
};
// 호버 프롬프트: 클릭형은 "· 클릭", 몸이 필요한 것은 ⌘ 안내, 나머지는 이름표만.
const HOVER_PROMPTS = {
    pecktree: () => '💗 쪼아쪼아 나무 · 클릭',
    well: () => '🪙 소원 빌기 · 클릭',
    capsule: () => '🕰️ 타임캡슐 · 클릭',
    radio: () => '📻 라디오 · 클릭',
    lamp: () => `💡 가로등 밝기 ${Math.round(lampBrightness * 100)}% · 클릭`,
    coffee: () => '☕ 커피 주문 · 클릭',
    food: () => '🍞 간식 주문 · 클릭',
    swing: () => '🛝 그네 — 조종 중 ⌘/✋로 타요',
    seesaw: () => '🛝 시소 — 조종 중 ⌘/✋로 타요',
    sunbed: () => '🛏️ 선베드 — 조종 중 ⌘/✋로 누워요',
    hammock: () => '🛏️ 해먹 — 조종 중 ⌘/✋로 누워요',
    monument: () => '🗿 베프 포에버 💕',
    hugspot: () => '💕 포옹 포인트 — 둘이 같이 서면!',
    cave: () => '🕳️ 아늑한 동굴 — 조종 중 ⌘/✋로 쿠션에 앉아요',
    boulder: () => '🪨 바위',
    lookout: () => '🔭 전망대 — 언덕 위, 별이 잘 보여요',
    digsite: () => (digState && !digState.dug ? '⛏️ 보물 모래밭 — 반짝이는 자리를 조종 중 ⌘로 파요' : '⛏️ 보물 모래밭 — 오늘 보물은 이미 찾았어요'),
    portal: () => '🌀 워프 포탈 — 들어서면 반대편으로',
    garden: () => '🥕 텃밭 — 밭 칸 클릭: 심기 · 물주기 · 수확',
    piano: () => '🎹 피아노 — 건반 클릭 = 음, 몸통 클릭 = 펫 연주',
    photoboard: () => '📌 사진 게시판 — 클릭해서 추억 넘겨보기',
    mailbox: () => (mailFlag && mailFlag.rotation.z > -0.5 ? '📮 우편함 — 답장이 와 있어요!' : '📮 우편함 — 클릭해서 편지 쓰기'),
    gym: () => '🧘 운동 공간 — 매트 클릭 또는 조종 중 ⌘로 스트레칭',
    library: () => '📚 도서관 코너 — 클릭하면 펫이 와서 책을 읽어요',
    fountain: () => '⛲ 분수',
    flowerbasket: () => (flowerMode ? '🌸 꽃심기 모드 켜짐 — 다시 클릭하면 꺼요' : `🌸 꽃심기 바구니 — 클릭해서 심기 모드 (${flowersData.length}/100)`),
    boat: () => '🚣 노 젓는 보트 — 조종 중 ⌘로 타기 (절친 동승 가능)',
    plane: () => '🛩️ 경비행기 — 조종 중 ⌘로 탑승! 전속력 활주 = 이륙, W/S로 고도 (절친 동승 가능)',
    balloon: () => '🎈 열기구 — 조종 중 ⌘로 탑승! 혼자 두둥실 하늘 산책 (매번 다른 경로, 절친이 곁에 있으면 함께)',
    ferry: () => '⛴️ 통통호 — 조종 중 ⌘로 승선! 모래섬 잔교에 정차하는 자동 항로 (절친 동승 가능)',
    sandcastle: () => '🏰 모래성 — 클릭하면 펫이 모래놀이 · 조종 중 ⌘ = 직접 앉기',
    palm: () => '🌴 야자수',
};
const HOVER_H = { pecktree: 1.15, well: 1.25, capsule: 0.45, radio: 0.55, lamp: 1.35, coffee: 1.5, food: 1.5, swing: 1.55, seesaw: 0.85, sunbed: 0.6, hammock: 0.85, monument: 1.0, hugspot: 0.4, cave: 1.6, boulder: 0.7, lookout: 1.1, digsite: 0.7, portal: 1.15, garden: 0.85, piano: 1.05, photoboard: 1.55, mailbox: 0.75, gym: 0.55, library: 1.15, fountain: 0.7, flowerbasket: 0.35, boat: 0.55, plane: 1.05, balloon: 2.1, ferry: 1.3, sandcastle: 0.65, palm: 1.2 };
const hoverEl = document.createElement('div');
hoverEl.style.cssText = 'position:fixed; display:none; transform:translate(-50%,-100%); z-index:88; pointer-events:none; background:rgba(30,32,40,0.88); color:#fff; font-size:11.5px; padding:4px 9px; border-radius:8px; white-space:nowrap; box-shadow:0 3px 10px rgba(0,0,0,0.3);';
document.body.appendChild(hoverEl);
let hoverSX = -1, hoverSY = -1, hoverActive = false, hoverProp = null, hoverT = 0;
const _hoverV = new THREE.Vector3();
function updateHoverPrompt(delta) {
    hoverT += delta;
    if (hoverT >= 0.12) {   // 레이캐스트는 ~8회/초만 — 발열 예산
        hoverT = 0;
        hoverProp = null;
        if (hoverActive && !buildMode) {
            pointerNdc.set((hoverSX / window.innerWidth) * 2 - 1, -(hoverSY / window.innerHeight) * 2 + 1);
            raycaster.setFromCamera(pointerNdc, camera);
            for (const pr of PROPS) {
                if (!HOVER_PROMPTS[pr.type] || !pr.obj) continue;
                if (raycaster.intersectObject(pr.obj, true).length) { hoverProp = pr; break; }
            }
        }
        renderer.domElement.style.cursor = hoverProp && PROP_CLICKS[hoverProp.type] ? 'pointer' : '';
    }
    if (!hoverProp) {
        if (hoverEl.style.display !== 'none') hoverEl.style.display = 'none';
        return;
    }
    _hoverV.set(hoverProp.x, terrainHeight(hoverProp.x, hoverProp.z) + (HOVER_H[hoverProp.type] || 1), hoverProp.z).project(camera);
    if (_hoverV.z > 1) { hoverEl.style.display = 'none'; return; }
    hoverEl.textContent = HOVER_PROMPTS[hoverProp.type]();
    hoverEl.style.left = `${(_hoverV.x * 0.5 + 0.5) * window.innerWidth}px`;
    hoverEl.style.top = `${(-_hoverV.y * 0.5 + 0.5) * window.innerHeight}px`;
    hoverEl.style.display = 'block';
}
let capsuleNoticeT = 55, capsuleNoticed = false;
function updateMemorialIsland(delta) {
    // 동전 포물선: 0.7초에 우물 속으로 — 끝나면 퐁당 + 반짝
    for (let i = coinFlights.length - 1; i >= 0; i--) {
        const c = coinFlights[i];
        c.t += delta;
        const k = Math.min(1, c.t / 0.7);
        c.m.position.x = c.x + 0.55 * (1 - k);
        c.m.position.z = c.z + 0.35 * (1 - k);
        c.m.position.y = c.y0 + 0.55 + Math.sin(k * Math.PI) * 0.45 - k * 0.28;
        c.m.rotation.x += delta * 9;
        if (k >= 1) {
            scene.remove(c.m);
            coinFlights.splice(i, 1);
            try { playBuffer(splashBuf, { vol: 0.5, rate: 1.5, filterFreq: 1600 }); } catch (e) {}
            triggerHugBurst(c.x, c.y0 + 0.5, c.z);
        }
    }
    // 쪼아쪼아 나무: 둘이 나무 밑에 모이면 하트가 터지고 포옹으로 이어진다 (7분 쿨다운)
    if (Date.now() > peckDuoCooldownUntil && pets.length >= 2 && !duoBusy && !possessed) {
        const pr = PROPS.find((q) => q.type === 'pecktree');
        if (pr) {
            const near = (q) => Math.hypot(q.mover.position.x - pr.x, q.mover.position.z - pr.z) < 1.15;
            const free = (q) => !q.pet.sleeping && !q.bed && !q.dip && q.ai.state !== 'held' && q.ai.state !== 'busy' && q.ai.state !== 'goto';
            if (near(pets[0]) && near(pets[1]) && free(pets[0]) && free(pets[1])) {
                peckDuoCooldownUntil = Date.now() + 7 * 60 * 1000;
                triggerHugBurst(pr.x, terrainHeight(pr.x, pr.z) + 0.7, pr.z);
                logWorldEvent('쪼아쪼아 나무 아래에서 하트가 터졌다 — 포옹! 💗');
                worldHug(pets[0]);
            }
        }
    }
    // 동굴 랜턴: 불꽃처럼 일렁인다
    if (caveLamp) caveLamp.intensity = 1.05 + 0.1 * Math.sin(wxTime.value * 9) + 0.05 * Math.sin(wxTime.value * 23);
    // 보물 모래밭: 오늘의 자리 반짝임 + 아주 가끔 펫이 스스로 발굴
    refreshDigState();
    if (digGlint && digState) {
        if (!digState.dug) {
            const [lx, lz] = DIG_SPOTS_LOCAL[digState.spot];
            digGlint.position.set(lx, 0.2 + 0.05 * Math.sin(wxTime.value * 3), lz);
            digGlint.material.opacity = 0.3 + 0.22 * Math.sin(wxTime.value * 3);
            digGlint.visible = true;
        } else {
            digGlint.visible = false;
        }
    }
    // 워프 포탈: 조종 중인 펫이 소용돌이에 들어서면 반대편으로 (운전 중엔 제외, 2.5초 쿨다운)
    if (PORTALS.length === 2 && possessed && Date.now() > portalCoolAt && !(carDrive && carDrive.driver === possessed)) {
        for (let i = 0; i < 2; i++) {
            const pa = PORTALS[i];
            if (Math.hypot(possessed.mover.position.x - pa.x, possessed.mover.position.z - pa.z) < 0.45) {
                portalCoolAt = Date.now() + 2500;
                portalHop(possessed, portalExit(PORTALS[1 - i]));
                break;
            }
        }
    }
    // 피아노: 아주 가끔 펫이 스스로 한 곡 (한가할 때만)
    if (Date.now() > pianoAutoAt) {
        pianoAutoAt = Date.now() + 20 * 60000;
        if (!pianoBusy && !duoBusy && Math.random() < 0.08) petPlayPiano();
    }
    if (Date.now() > digAutoAt) {
        digAutoAt = Date.now() + 15 * 60000;
        if (digState && !digState.dug && !digDoing && !duoBusy && Math.random() < 0.1) {
            const p = pets.find((q) => q !== possessed && !q.pet.sleeping && !q.bed && !q.dip
                && (q.ai.state === 'idle' || q.ai.state === 'walk'));
            const w = digSpotWorld();
            if (p && w) (async () => {
                await gotoAsync(p, w.x + 0.3, w.z + 0.2);
                p.ai.state = 'busy';
                await startDig(p);
                releaseAI(p);
            })();
        }
    }
    // 타임캡슐 개봉 알림: 1분마다 확인, 세션당 한 번만 조른다
    capsuleNoticeT += delta;
    if (capsuleNoticeT >= 60) {
        capsuleNoticeT = 0;
        if (!capsuleNoticed) {
            const today = localDateStr();
            if (capsulesData.some((c) => !c.opened && today >= c.openAt)) {
                capsuleNoticed = true;
                showToast('🎁 열 수 있는 타임캡슐이 있어요! (추억의 섬에서 탭)');
                logWorldEvent('묻어둔 타임캡슐이 열릴 때가 됐다 🎁');
                maybeProactive(null, '묻어둔 타임캡슐이 드디어 열릴 때가 됐다! 두근두근.');
            }
        }
    }
}
renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') { hoverActive = false; return; }   // 터치는 탭=실행 (마크式 직접 터치)
    hoverSX = e.clientX;
    hoverSY = e.clientY;
    hoverActive = true;
});
renderer.domElement.addEventListener('pointerleave', () => { hoverActive = false; });
fetchCapsules();   // 부팅 시 한 번 — 개봉 알림용

const PROP_BUILDERS = { tree: makeTree, rock: (p) => kitProp(p.variant || 'rock_largeA', { scale: p.kitScale || 0.6 }), house: makeHouse, bowl: makeBowl, fence: makeFence, pond: makePond, sunbed: makeSunbed, hammock: makeHammock, swing: makeSwing, seesaw: makeSeesaw, lamp: makeLamp, radio: makeRadio, coffee: makeCoffeeBooth, food: makeFoodBooth, monument: makeMonument, hugspot: makeHugSpot, pecktree: makePeckTree, well: makeWell, capsule: makeCapsule, boulder: makeBoulder, cave: makeCave, lookout: makeLookout, digsite: makeDigsite, portal: makePortal, garden: makeGarden, piano: makePiano, photoboard: makePhotoboard, mailbox: makeMailbox, gym: makeGym, library: makeLibrary, fountain: makeFountain, flowerbasket: makeFlowerBasket, palm: makePalm, sandcastle: makeSandcastle };
// Baked contact shading (게임식 블롭 섀도): the soft dark pool where a prop meets the grass — the
// look GTAO recomputed 60×/s for props that never move, now one alpha-faded disc placed at load.
// The fence (thin posts) and pond (a water hole) read better without one.
const blobTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(18,26,16,0.34)');
    g.addColorStop(0.55, 'rgba(18,26,16,0.15)');
    g.addColorStop(1, 'rgba(18,26,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
})();
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
const BLOB_SIZE = { tree: 0.55, bowl: 0.42, sunbed: 0.85, hammock: 0.9, swing: 1.3, seesaw: 1.5, lamp: 0.3, radio: 0.42, coffee: 1.0, food: 1.0, monument: 0.62, pecktree: 0.55, well: 0.75, capsule: 0.5, boulder: 0.75, garden: 1.5, piano: 0.8, photoboard: 0.8, mailbox: 0.35, gym: 1.5, library: 1.35 };
// Beds register a lying spot (on the furniture, with a lean-back tilt + heading) and an
// approach point just outside their collider that the pet walks to before climbing on.
// 🔨 함수로 분리: 로드 시 프롭 루프가 굽고, 공사모드에서 프롭이 이사하면 unbake→bake로 다시
// 굽는다 — 좌표 파생 공식이 한 곳에만 산다.
function bakePropBeds(p) {
    const obj = p.obj;
    if (p.type === 'sunbed' || p.type === 'hammock') {
        const sy = Math.sin(p.rotY || 0), cy = Math.cos(p.rotY || 0);
        const baseY = terrainHeight(p.x, p.z);
        const entry = (p.type === 'sunbed')
            ? {
                id: 'sunbed', occupant: null, sway: 0,
                lie: { x: p.x + sy * 0.05, z: p.z + cy * 0.05, y: baseY + 0.18, rotY: p.rotY || 0, tilt: -1.05 },
                approach: { x: p.x + sy * 0.75, z: p.z + cy * 0.75 },
            }
            : {
                id: 'hammock', occupant: null, sway: 1,
                lie: { x: p.x, z: p.z, y: baseY + 0.4, rotY: (p.rotY || 0) + Math.PI / 2, tilt: -1.25 },
                approach: { x: p.x + sy * 0.7, z: p.z + cy * 0.7 },
            };
        BEDS.push(entry);
        p.bedEntries = [entry];
    }
    // 그네 seats: two pendulum seats hung from the bar. Registered as BEDS so nearestFreeBed / mountBed
    // (the ⌘ interaction) and the approach→mount→dismount tweens all work unchanged; updateSwings drives
    // the pendulum + 10-min auto-dismount. Pivot/axis are baked to world space from the prop transform.
    if (p.type === 'swing') {
        const rotY = p.rotY || 0, sy = Math.sin(rotY), cy = Math.cos(rotY);
        const baseY = terrainHeight(p.x, p.z);
        const seats = obj.userData.seats || [];
        p.bedEntries = [];
        [-SWING.seatX, SWING.seatX].forEach((ox, i) => {
            const pivot = { x: p.x + ox * cy, z: p.z - ox * sy, y: baseY + SWING.barY };
            const axis = { x: sy, z: cy };                      // world direction the seat swings along (local +Z)
            const entry = {
                id: 'swing', mode: 'swing', occupant: null, sway: 0,
                seat: seats[i] || null, pivot, axis, L: SWING.ropeL, headY: rotY, angle: 0, vel: 0, mountedAt: 0,
                lie: { x: pivot.x, z: pivot.z, y: pivot.y - SWING.ropeL + SWING.sitLift, rotY, tilt: 0 },
                approach: { x: pivot.x + axis.x * SWING.approach, z: pivot.z + axis.z * SWING.approach },
            };
            SWINGS.push(entry);
            BEDS.push(entry);
            p.bedEntries.push(entry);
        });
    }
    // 시소 seats: two seats on one pivoting plank (a shared SEESAW_BODIES entry). Registered as BEDS so
    // ⌘/mount/dismount reuse works; updateSeesaws tilts the plank + places both riders on the same arc.
    if (p.type === 'seesaw') {
        const rotY = p.rotY || 0, sy = Math.sin(rotY), cy = Math.cos(rotY);
        const axis = { x: sy, z: cy };                     // world direction along the plank length
        const pivot = { x: p.x, z: p.z, y: terrainHeight(p.x, p.z) + SEESAW.fulcrumH };
        const body = { plank: obj.userData.plank || null, pivot, axis, armLen: SEESAW.armLen, angle: 0, vel: 0, t: 0, seats: [] };
        p.bedEntries = [];
        [1, -1].forEach((e) => {
            const headY = Math.atan2(-e * axis.x, -e * axis.z);   // face the partner across the pivot
            const entry = {
                id: 'seesaw', mode: 'seesaw', occupant: null, sway: 0, body, end: e, headY, mountedAt: 0,
                lie: { x: pivot.x + axis.x * e * SEESAW.armLen, z: pivot.z + axis.z * e * SEESAW.armLen, y: pivot.y + SEESAW.lift, rotY: headY, tilt: 0 },
                approach: { x: pivot.x + axis.x * e * (SEESAW.armLen + 0.5), z: pivot.z + axis.z * e * (SEESAW.armLen + 0.5) },
            };
            body.seats.push(entry);
            SEESAWS.push(entry);
            BEDS.push(entry);
            p.bedEntries.push(entry);
        });
        SEESAW_BODIES.push(body);
        p.bedBody = body;
    }
}
function unbakePropBeds(p) {
    if (!p.bedEntries) return;
    const rm = (arr, e) => { const i = arr.indexOf(e); if (i >= 0) arr.splice(i, 1); };
    for (const e of p.bedEntries) {
        if (e.occupant) forceEndBed(e.occupant);   // 안전망 — 공사모드 진입 시 이미 전부 하차시킨다
        rm(BEDS, e); rm(SWINGS, e); rm(SEESAWS, e);
    }
    if (p.bedBody) rm(SEESAW_BODIES, p.bedBody);
    p.bedEntries = null;
    p.bedBody = null;
}
// ---- 정적 병합 (드로우콜 다이어트): 프롭 하나가 부품 메시 5~30개로 지어지는데, 절대 움직이지
// 않는 부품들을 재질 인스턴스별로 합쳐 그룹당 몇 개의 메시로 줄인다. 그룹(p.obj) 계층은 그대로라
// 공사모드 이동·클릭 레이캐스트(intersectObject(pr.obj, true))·계절 재질 틴트(재질 공유)가 전부
// 이전과 동일하게 동작한다. 제외 규칙:
//  · 움직이거나 토글되는 부품 — 그네 시트(userData.seats)·시소 플랭크(userData.plank)·우편함
//    깃발(mailFlag)·피아노 건반/텃밭 칸(userData.keyIdx·plotIdx — 클릭이 자식 identity를 판별)
//  · 계절 시스템이 만지는 것 — 눈모자(seasonSnowCaps)는 스킵, 잎은 나무 타입째 제외
//    (seasonLeaves가 지오메트리 색 버퍼를 직접 리베이크한다)
//  · 타입째 제외: tree(계절 잎)·hugspot(링 펄스)·portal(스월)·photoboard(사진 슬롯 교체)·
//    digsite(발굴 상태 토글) — 전부 몇 메시 안 되는 소품이라 손해도 없다
//  · Mesh가 아닌 것(라이트·스프라이트·Points)과 visible=false(숨김 토글류)는 그냥 둔다
const MERGE_TYPES = new Set(['house', 'bowl', 'fence', 'pond', 'sunbed', 'hammock', 'lamp', 'radio',
    'coffee', 'food', 'monument', 'pecktree', 'well', 'capsule', 'boulder', 'cave', 'lookout',
    'garden', 'piano', 'mailbox', 'gym', 'library', 'fountain', 'flowerbasket', 'swing', 'seesaw', 'palm', 'sandcastle']);
function mergePropGroup(root) {
    const skip = new Set(seasonSnowCaps);
    if (mailFlag) mailFlag.traverse((o) => skip.add(o));
    if (root.userData.seats) for (const s of root.userData.seats) s.traverse((o) => skip.add(o));
    if (root.userData.plank) root.userData.plank.traverse((o) => skip.add(o));
    root.updateMatrixWorld(true);   // 아직 씬에 붙기 전(원점) — matrixWorld = 그룹 기준 상대 변환
    const buckets = new Map();      // 재질 인스턴스 + attribute 시그니처 → 메시 목록
    root.traverse((o) => {
        if (!o.isMesh || !o.visible || skip.has(o)) return;
        if (o.userData && (o.userData.keyIdx != null || o.userData.plotIdx != null)) return;
        if (Array.isArray(o.material)) return;   // 멀티 재질은 그대로 둔다 (현재 빌더엔 없음)
        const sig = Object.keys(o.geometry.attributes).sort().join(',') + (o.geometry.index ? '+i' : '');
        const key = o.material.uuid + '|' + sig;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(o);
    });
    for (const list of buckets.values()) {
        if (list.length < 2) continue;   // 혼자면 합칠 이유가 없다
        const merged = mergeGeometries(list.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld)), false);
        if (!merged) continue;           // 시그니처가 같아도 실패하면 원본 유지 (안전망)
        const mm = new THREE.Mesh(merged, list[0].material);
        mm.matrixAutoUpdate = false;     // 그룹 원점에 identity 고정 — 부모가 움직이면 따라간다
        root.add(mm);
        for (const m of list) m.parent.remove(m);
    }
}
const NO_MERGE_DEBUG = new URLSearchParams(window.location.search).get('nomerge') === '1';   // 병합 on/off 비교용

// ---- 월드 베이크 (마크의 청크 메싱 원리): 소품 경계를 넘어 같은 재질 인스턴스끼리 한 덩어리로.
// 타입 내 병합(mergePropGroup)과 판정 규칙이 완전히 같아서 안전 범위도 같다 — 다른 점은 소품
// 경계를 넘는다는 것뿐이고, 그걸 가능하게 하는 게 bare M(color) 공유 캐시다. 원본 메시는
// visible=false로 남는다: Raycaster(r178)는 visible을 안 보므로 클릭·호버·공사 판정은 예전
// 그대로 원본에 맞고, 그리기(+그림자 캐스터)만 병합본이 맡아 draw call이 준다. 공사모드 진입
// 시 unbake(원본 복원·병합본 폐기), 종료 시 재베이크 — 블록이 바뀔 때만 청크를 다시 굽는 것.
let worldBakeMeshes = [];
let worldBakeHidden = [];
// 나무는 타입 병합(원본 제거)엔 못 넣지만 — seasonLeaves가 원본 geo의 색 버퍼를 리베이크하니까 —
// 월드 베이크(원본 숨김)엔 넣을 수 있다: 계절 전환이 시작되면 unbake로 원본을 되살려 크로스페이드를
// 보여주고, 전환이 끝나면 새 잎색 그대로 재베이크한다 (applySeason/updateSeasonBlend의 훅).
const BAKE_TYPES = new Set([...MERGE_TYPES, 'tree', 'rock']);
const WORLD_STATIC_ROOTS = [];   // 소품이 아닌 정적물(다리·길 리본) — 만들 때 여기 등록하면 베이크된다
function worldUnbake() {
    for (const m of worldBakeMeshes) { stage.remove(m); m.geometry.dispose(); }   // 재질은 공유라 dispose 금지
    worldBakeMeshes = [];
    for (const m of worldBakeHidden) m.visible = true;
    worldBakeHidden = [];
}
function worldBake() {
    if (NO_MERGE_DEBUG) return;
    if (seasonBlend) return;   // 전환 크로스페이드 중엔 원본이 그려야 한다 — 끝나는 프레임이 재베이크한다
    worldUnbake();
    const skip = new Set(seasonSnowCaps);
    if (mailFlag) mailFlag.traverse((o) => skip.add(o));
    const buckets = new Map();
    const collect = (o) => {
        if (!o.isMesh || o.isInstancedMesh || !o.visible || skip.has(o)) return;
        if (o.userData && (o.userData.keyIdx != null || o.userData.plotIdx != null)) return;
        if (Array.isArray(o.material)) return;
        const sig = Object.keys(o.geometry.attributes).sort().join(',') + (o.geometry.index ? '+i' : '');
        const key = o.material.uuid + '|' + sig;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(o);
    };
    for (const p of PROPS) {
        if (!p.obj || !BAKE_TYPES.has(p.type)) continue;
        if (p.obj.userData.seats) for (const s of p.obj.userData.seats) s.traverse((o) => skip.add(o));
        if (p.obj.userData.plank) p.obj.userData.plank.traverse((o) => skip.add(o));
        // plotIdx/keyIdx 노드의 서브트리 전체 제외 — 텃밭 작물 비주얼(plotIdx 그룹의 자식,
        // 자기 자신엔 태그 없음)이 재베이크에 병합·숨김되면 수확해도 "구운 유령"이 남는다.
        p.obj.traverse((o) => {
            if (o.userData && (o.userData.plotIdx != null || o.userData.keyIdx != null)) o.traverse((q) => skip.add(q));
        });
        p.obj.updateMatrixWorld(true);
        p.obj.traverse(collect);
        if (p.blob) { p.blob.updateMatrixWorld(true); collect(p.blob); }   // 그림자 블롭: 전부 blobMat 공유 → 1콜
    }
    for (const r of WORLD_STATIC_ROOTS) { r.updateMatrixWorld(true); r.traverse(collect); }
    for (const list of buckets.values()) {
        if (list.length < 2) continue;   // 혼자면 원본이 그대로 그린다
        const merged = mergeGeometries(list.map((m) => m.geometry.clone().applyMatrix4(m.matrixWorld)), false);
        if (!merged) continue;           // 실패하면 원본 유지 (안전망)
        const mm = new THREE.Mesh(merged, list[0].material);
        mm.castShadow = list[0].castShadow;       // 버킷은 재질 단위라 동질적 — 블롭 데칼(false)은
        mm.receiveShadow = list[0].receiveShadow; // false를, 소품(true)은 true를 그대로 잇는다
        mm.renderOrder = list[0].renderOrder;
        if (list[0].customDepthMaterial) mm.customDepthMaterial = list[0].customDepthMaterial;   // 알파 그림자(야자잎) 승계
        mm.matrixAutoUpdate = false;     // stage는 무변환 그룹 — world 좌표를 그대로 굳힌다
        stage.add(mm);
        worldBakeMeshes.push(mm);
        for (const m of list) { m.visible = false; worldBakeHidden.push(m); }
    }
}
// 집 리모델(1.0×0.8→1.3×1.04) 마이그레이션: 예전 저장 레이아웃(world_layout.json)의 소품이
// 커진 풋프린트에 삼켜졌으면 로컬 +z(현관 밖)로 밀어낸다 — 한 번 밀리면 다음 저장에 그 자리로 굳는다.
for (const p of PROPS) {
    if (p.type === 'house' || !MOVABLE_TYPES.has(p.type)) continue;
    const { lx, lz } = houseLocal(p.x, p.z);
    const margin = (p.r || 0.2) + 0.12;
    if (Math.abs(lx) < HOUSE.hw + margin && Math.abs(lz) < HOUSE.hd + margin) {
        const w = houseWorld(THREE.MathUtils.clamp(lx, -HOUSE.hw + 0.3, HOUSE.hw - 0.3), HOUSE.hd + margin + 0.25);
        p.x = w.x; p.z = w.z;
    }
}
for (const p of PROPS) {
    const obj = PROP_BUILDERS[p.type](p);
    if (MERGE_TYPES.has(p.type) && !NO_MERGE_DEBUG) mergePropGroup(obj);
    p.obj = obj;                                     // 🔨 공사모드가 이 그룹을 집어 옮긴다
    obj.position.set(p.x, terrainHeight(p.x, p.z), p.z);
    obj.rotation.y = p.rotY || 0;
    if (p.scale) obj.scale.setScalar(p.scale);   // layout data may size a prop (kit variants etc.)
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    stage.add(obj);
    if (BLOB_SIZE[p.type] || p.type === 'house') {
        const blob = new THREE.Mesh(blobGeo, blobMat);
        if (p.type === 'house') blob.scale.set(3.1, 1, 2.6);   // shade peeking out around the slab rim (리모델 1.3× 반영)
        else blob.scale.setScalar(BLOB_SIZE[p.type]);
        blob.rotation.y = p.rotY || 0;
        blob.position.set(p.x, terrainHeight(p.x, p.z) + 0.012, p.z);
        stage.add(blob);
        p.blob = blob;
    }
    if (p.type === 'lamp') {
        const light = new THREE.PointLight(0xffd9a0, 0, 4.5, 2);
        light.position.set(p.x, terrainHeight(p.x, p.z) + 0.95, p.z);
        scene.add(light);
        const halo = glowSprite(0xffc978, 0.55, 0);   // night halo around the globe, driven with the light
        halo.position.copy(light.position);
        scene.add(halo);
        lamps.push({ light, glow: halo.material });
        p.lampLight = light;
        p.lampHalo = halo;
    }
    bakePropBeds(p);
}

// Cave extras (루프 뒤에서 — 순회 중 PROPS에 push하면 안 되니까): 쿠션 둘을 sit-침대로 등록하고
// (shelter: true — 비 피신 대상), 셸 바위들을 가구 콜라이더로 막는다. 입구(+z 로컬)만 뚫린다.
{
    const cavePr = PROPS.find((q) => q.type === 'cave');
    if (cavePr) {
        const cy = Math.cos(cavePr.rotY || 0), sy = Math.sin(cavePr.rotY || 0);
        const cw = (lx, lz) => ({ x: cavePr.x + lx * cy + lz * sy, z: cavePr.z - lx * sy + lz * cy });
        const baseY = terrainHeight(cavePr.x, cavePr.z);
        for (const [lx, lz, id] of [[-0.35, -0.28, 'cavecushion-a'], [0.36, -0.32, 'cavecushion-b']]) {
            const w = cw(lx, lz);
            const ap = cw(lx * 0.6, 1.35);
            BEDS.push({
                id, mode: 'sit', occupant: null, sway: 0, shelter: true,
                lie: { x: w.x, z: w.z, y: baseY + 0.16, rotY: cavePr.rotY || 0, tilt: -0.35 },
                approach: { x: ap.x, z: ap.z },
            });
        }
        for (const [lx, lz, r] of [[0, -0.8, 0.95], [-1.0, -0.05, 0.68], [1.0, -0.05, 0.68], [-0.85, 0.62, 0.34], [0.85, 0.62, 0.34]]) {
            const w = cw(lx, lz);
            PROPS.push({ type: 'furniture', x: w.x, z: w.z, rotY: 0, r });
        }
    }
}

// Library extras (⑤ — 루프 뒤에서, 캐빈 패턴과 동일): 독서 의자 둘을 sit-침대로, 책장을
// 가구 콜라이더로 막는다.
{
    const libPr = PROPS.find((q) => q.type === 'library');
    if (libPr) {
        const cy = Math.cos(libPr.rotY || 0), sy = Math.sin(libPr.rotY || 0);
        const lw = (lx, lz) => ({ x: libPr.x + lx * cy + lz * sy, z: libPr.z - lx * sy + lz * cy });
        const baseY = terrainHeight(libPr.x, libPr.z);
        LIB_SEATS_LOCAL.forEach(([lx, lz], i) => {
            const w = lw(lx, lz);
            const ap = lw(lx, lz + 0.75);
            BEDS.push({
                id: `libchair-${i}`, mode: 'sit', occupant: null, sway: 0,
                lie: { x: w.x, z: w.z, y: baseY + 0.16, rotY: libPr.rotY || 0, tilt: -0.32 },
                approach: { x: ap.x, z: ap.z },
            });
        });
        const shelfW = lw(0, -0.15);
        PROPS.push({ type: 'furniture', x: shelfW.x, z: shelfW.z, rotY: 0, r: 0.55 });
    }
}

// 🏰 모래성 extras: 성 곁에 sit-스팟 두 자리 — 0번은 삽 들고 모래놀이(파기), 1번은 옆에 앉아
// 모래성 만지기. 일반 침대 문법(mountBed/bedExit)을 그대로 타서 접근·앉기·하차가 공짜다.
{
    const sandPr = PROPS.find((q) => q.type === 'sandcastle');
    if (sandPr) {
        const cy = Math.cos(sandPr.rotY || 0), sy = Math.sin(sandPr.rotY || 0);
        const sw = (lx, lz) => ({ x: sandPr.x + lx * cy + lz * sy, z: sandPr.z - lx * sy + lz * cy });
        [[0.66, 0.42], [-0.6, 0.5]].forEach(([lx, lz], i) => {
            const w = sw(lx, lz);
            const ap = sw(lx * 1.7, lz * 1.7);
            const faceCastle = Math.atan2(sandPr.x - w.x, sandPr.z - w.z);   // 성을 바라보고 앉는다
            BEDS.push({
                id: `sandspot-${i}`, mode: 'sit', occupant: null, sway: 0,
                // 실무 게임식 앉기: 몸은 곧게(tilt 0) + 다리만 앞으로 눕힌다(updateSandPlay가
                // 매 프레임 feet.rotation.x를 접음 — 일어나면 엔티티가 원위치). 몸은 살짝 가라앉혀 접지.
                lie: { x: w.x, z: w.z, y: terrainHeight(w.x, w.z) - 0.06, rotY: faceCastle, tilt: 0 },
                approach: { x: ap.x, z: ap.z },
            });
        });
    }
}

// House extras: furniture colliders (collision-only entries — the meshes live inside the house
// group), the sofa (sit) and loft bed (sleep) registered like outdoor beds, and the reading lamp.
// 🔨 집이 이사하면(공사모드 — 이동만, 회전은 HOUSE_COS/SIN이 로드 시 상수라 불가) 이 파생
// 좌표들을 houseWorld로 다시 계산한다 — 로컬 좌표와 참조를 붙들어 둔다.
const HOUSE_DERIVED = { cols: [], beds: [], light: null };
{
    const fCol = (lx, lz, r) => {
        const w = houseWorld(lx, lz);
        const entry = { type: 'furniture', x: w.x, z: w.z, rotY: 0, r };
        PROPS.push(entry);
        HOUSE_DERIVED.cols.push({ entry, lx, lz });
    };
    fCol(-0.884, 0.26, 0.34);    // sofa (리모델 좌표 — makeHouse와 1:1)
    fCol(0, 0.195, 0.28);        // table
    fCol(-1.014, 0.676, 0.2);    // bookshelf
    fCol(-0.585, -0.65, 0.36);   // loft bed
    fCol(0.065, -0.806, 0.12);   // nightstand
    const sofaW = houseWorld(-0.884, 0.26), sofaA = houseWorld(-0.364, 0.754);
    const sofa = {
        id: 'sofa', mode: 'sit', occupant: null, sway: 0, shelter: true,   // 비 피신 폴백 자리
        lie: { x: sofaW.x, z: sofaW.z, y: HOUSE.floorY + 0.21, rotY: HOUSE.rotY + Math.PI / 2, tilt: -0.35 },
        approach: { x: sofaA.x, z: sofaA.z },
    };
    BEDS.push(sofa);
    HOUSE_DERIVED.beds.push({ entry: sofa, lx: -0.884, lz: 0.26, alx: -0.364, alz: 0.754 });
    const bedW = houseWorld(-0.585, -0.65), bedA = houseWorld(0.39, -0.585);
    const loftbed = {
        id: 'loftbed', mode: 'sleep', occupant: null, sway: 0,
        lie: { x: bedW.x, z: bedW.z, y: HOUSE.loftY + 0.2, rotY: HOUSE.rotY, tilt: -1.2 },
        approach: { x: bedA.x, z: bedA.z },
    };
    BEDS.push(loftbed);
    HOUSE_DERIVED.beds.push({ entry: loftbed, lx: -0.585, lz: -0.65, alx: 0.39, alz: -0.585 });
    const lampW = houseWorld(0, 0.195);
    const indoor = new THREE.PointLight(0xffd9a0, 0, 3.0, 2);   // 커진 거실 — 도달 2.4→3.0, 펜던트 높이에서
    indoor.position.set(lampW.x, HOUSE.floorY + 1.0, lampW.z);
    scene.add(indoor);
    lamps.push({ light: indoor });
    HOUSE_DERIVED.light = indoor;
}
function refreshHouseDerived() {
    for (const c of HOUSE_DERIVED.cols) {
        const w = houseWorld(c.lx, c.lz);
        c.entry.x = w.x; c.entry.z = w.z;
    }
    for (const b of HOUSE_DERIVED.beds) {
        const w = houseWorld(b.lx, b.lz), a = houseWorld(b.alx, b.alz);
        b.entry.lie.x = w.x; b.entry.lie.z = w.z;
        b.entry.approach.x = a.x; b.entry.approach.z = a.z;
    }
    const lampW = houseWorld(0, 0.195);
    HOUSE_DERIVED.light.position.set(lampW.x, HOUSE.floorY + 1.0, lampW.z);
}

// ---- 🚗 스포츠카: parked in the middle of the plaza. Ctrl/⌘ beside it hops in (a held/nearby
// friend takes the passenger seat), arrow keys drive at 3× walking speed, Ctrl/⌘ again hops out.
// Bridges count as road, so you can drive to the satellite islands (wheels overhang, who cares).
// The collider entry moves with the car so wandering pets steer around it, parked or not.
const CAR = { x: 2.5, z: -1.35, heading: 1.05, vel: 0 };   // 광장 남동쪽 길가 — 광장 가운데는 기념비·포옹 포인트의 자리
{   // 🔨 저장된 주차 위치 — 차는 PROPS 루프 밖에서 만들어져 여기서 따로 적용한다
    const o = savedLayout['car-1'];
    if (o && Number.isFinite(o.x) && Number.isFinite(o.z)) {
        CAR.x = o.x; CAR.z = o.z;
        if (Number.isFinite(o.rotY)) CAR.heading = o.rotY;
    }
}
const carCollider = { type: 'car', layoutId: 'car-1', x: CAR.x, z: CAR.z, rotY: 0, r: 0.55, def: { x: 0, z: 0, rotY: 1.05 } };
PROPS.push(carCollider);
const carWheels = [];
let carDrive = null;    // { driver, passenger } while someone is at the wheel
function makeCar() {
    const g = new THREE.Group();
    const bodyMat = M(0xe8484f);
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.16, 1.05, 4, 0.05), bodyMat);
    body.position.y = 0.17;
    g.add(body);
    const hood = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.07, 0.34, 3, 0.03), bodyMat);
    hood.position.set(0, 0.245, 0.32);
    g.add(hood);
    const cabin = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.15, 0.5, 4, 0.05), M(0xbfe3f2, { transparent: true, opacity: 0.75 }));
    cabin.position.set(0, 0.3, -0.06);
    g.add(cabin);
    const spoiler = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.03, 0.12, 2, 0.012), bodyMat);
    spoiler.position.set(0, 0.32, -0.5);
    g.add(spoiler);
    for (const [fx, fz] of [[-0.17, 0.53], [0.17, 0.53]]) {
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), M(0xfff1cf, { emissive: 0xffe9a0, emissiveIntensity: 0.5 }));
        light.position.set(fx, 0.2, fz);
        g.add(light);
    }
    for (const [sx, sz] of [[-0.28, 0.34], [0.28, 0.34], [-0.28, -0.34], [0.28, -0.34]]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 14), M(0x2e2e34));
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx, 0.1, sz);
        g.add(wheel);
        carWheels.push(wheel);
    }
    return g;
}
const carGroup = makeCar();
carCollider.obj = carGroup;                        // 🔨 공사모드 드래그 대상
carGroup.position.set(CAR.x, terrainHeight(CAR.x, CAR.z), CAR.z);
carGroup.rotation.y = CAR.heading;
carGroup.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
stage.add(carGroup);
function carBlocked(nx, nz) {
    if (islandOf(nx, nz) < 0 && !onBridge(nx, nz)) return true;    // stay on land or a bridge deck
    if (houseFloorY(nx, nz) !== null || houseBlocked(nx, nz)) return true;
    for (const q of PROPS) {
        if (q === carCollider || q.r <= 0) continue;
        if (Math.hypot(nx - q.x, nz - q.z) < q.r + 0.32) return true;
    }
    return false;
}

// ---- 🚣 노 젓는 보트 상태 + 모델: 본섬 북쪽 물가에 정박 — 휴양지 모래섬으로 가는 발.
// 기본 정박 (1.1, 6.0): 기슭 걷기 한계(r-0.35)에서 승선 반경 1.25 안 — 뭍에서 바로 탄다 (검산). ----
const BOAT = { x: 2.4, z: 6.95, heading: -0.4, vel: 0 };   // 북쪽 물가 동편 — 서편은 페리 잔교/선석 (구 1.2,6.8)
{   // 🔨 저장된 정박 위치 — 차와 같은 방식. 키를 boat-2로 세대교체: 초기 배포 때 모래섬 곁에
    // 저장된 boat-1 정박들을 리셋해 "초기 위치 = 메인 땅 물가"로 되돌린다 (사용자 요청).
    // 이후 정박은 boat-2로 정상 저장·복원된다. 육지에 찍힌/섬 확장으로 뭍이 된 저장값은 무시.
    const o = savedLayout['boat-2'];
    const nearPier = (x, z, buf) => FERRY_PIERS.some((pr) => {
        const dx = pr.B.x - pr.A.x, dz = pr.B.z - pr.A.z, l2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((x - pr.A.x) * dx + (z - pr.A.z) * dz) / l2));
        return Math.hypot(pr.A.x + dx * t - x, pr.A.z + dz * t - z) < buf;
    }) || Math.hypot(x - 0.94, z - 7.77) < 1.7;   // 본섬 선석 (페리 정위치)
    if (o && Number.isFinite(o.x) && Number.isFinite(o.z)
        && ISLANDS.every((il) => Math.hypot(o.x - il.x, o.z - il.z) > il.r + 0.2)
        && !nearPier(o.x, o.z, 1.2)) {   // 잔교·선석 신설 자리에 낀 옛 정박은 기본 위치로
        BOAT.x = o.x; BOAT.z = o.z;
        if (Number.isFinite(o.rotY)) BOAT.heading = o.rotY;
    }
    window.__nearFerryPier = nearPier;   // plane-1 마이그레이션에서 재사용
}
const boatCollider = { type: 'boat', layoutId: 'boat-2', x: BOAT.x, z: BOAT.z, rotY: 0, r: 0.5, def: { x: 2.4, z: 6.95, rotY: -0.4 } };
PROPS.push(boatCollider);
let boatRide = null;    // { driver, passenger, row, lastPh } while someone is rowing
function makeBoat() {
    const g = new THREE.Group();
    // 선체: 반구를 눌러 늘인 셸 — 안팎이 다 보이는 조형이라 양면(gradMatDS) 규칙을 따른다
    const hull = new THREE.Mesh(
        bakeGrad(new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xb9835a, 0x6f4a2c),
        gradMatDS);
    hull.scale.set(0.62, 0.56, 1.3);
    hull.position.y = 0.2;
    g.add(hull);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 8, 22).rotateX(Math.PI / 2), M(0x8a6647, { map: woodTex }));   // 뱃전 테
    rim.scale.set(0.62, 1, 1.3);
    rim.position.y = 0.2;
    g.add(rim);
    const deck = new THREE.Mesh(new THREE.CircleGeometry(0.44, 18).rotateX(-Math.PI / 2), M(0xd8b88a, { map: plankTex }));   // 바닥 마루
    deck.scale.set(0.58, 1, 1.22);
    deck.position.y = 0.04;
    g.add(deck);
    for (const bz of [-0.12, 0.34]) {   // 가로 벤치 둘 (노잡이 + 뱃머리 절친)
        const bench = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.05, 0.16, 2, 0.02), M(0xb08a60, { map: woodTex }));
        bench.position.set(0, 0.16, bz);
        g.add(bench);
    }
    g.userData.oars = [];
    for (const side of [-1, 1]) {   // 노 — 오르락(rotation.x)과 벌림(rotation.z)을 stepBoat가 젓는다
        const oar = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.72, 7), M(0xb08a60, { map: woodTex }));
        shaft.rotation.z = Math.PI / 2;
        shaft.position.x = side * 0.3;
        oar.add(shaft);
        const blade = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.02, 0.16, 2, 0.01), M(0x8a6647, { map: woodTex }));
        blade.position.set(side * 0.62, -0.02, 0);
        blade.rotation.x = 0.5;
        oar.add(blade);
        const lock = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.009, 6, 10), M(0xe8c46f));   // 노걸이
        lock.position.set(side * 0.31, 0.025, 0);
        oar.add(lock);
        const base = side * 0.32;   // 살짝 벌어진 기본 자세
        oar.rotation.z = base;
        oar.position.set(0, 0.22, -0.12);
        g.add(oar);
        g.userData.oars.push({ grp: oar, side, base });
    }
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), lampGlobeMat);   // 고물 랜턴 — 밤이면 은은히
    lantern.position.set(0, 0.34, -0.56);
    g.add(lantern);
    const lanternPole = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.16, 6), M(0x8a6647, { map: woodTex }));
    lanternPole.position.set(0, 0.26, -0.56);
    g.add(lanternPole);
    return g;
}
const boatGroup = makeBoat();
boatCollider.obj = boatGroup;                       // 호버 라벨 + propTopAt(뱃전에 올라서기)용
boatGroup.position.set(BOAT.x, -0.5, BOAT.z);       // 정확한 파고는 첫 updateBoatIdle이 잡는다 (OCEAN_LEVEL은 아직 TDZ)
boatGroup.rotation.y = BOAT.heading;
boatGroup.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
stage.add(boatGroup);

// ---- World interface: the ONLY way pets sense the ground/space (keeps them portable) ----
const world = {
    islandRadius: ISLAND_R,
    groundHeightAt(x, z) {
        const hf = houseFloorY(x, z);
        if (hf !== null) return hf;                              // house floors / stairs / loft
        const hit = onBridge(x, z);
        if (hit) return bridgeDeckY(hit);                        // bridge decks count as ground
        return terrainHeight(x, z);
    },
    isBlocked(x, z) {
        let onLand = onBridge(x, z) !== null;
        if (!onLand) {
            for (const s of ISLANDS) {
                if (Math.hypot(x - s.x, z - s.z) < s.r - 0.35) { onLand = true; break; }
            }
        }
        if (!onLand) return true;                                // off every rim and off the bridges
        if (houseBlocked(x, z)) return true;                     // walls / railing / porch posts
        for (const p of PROPS) {
            if (p.r > 0 && Math.hypot(x - p.x, z - p.z) < p.r) return true; // prop circle colliders
        }
        return false;
    },
};

// ---- 길 (roads & plaza): a stone-dust loop at mid-radius with four spokes out of the central
// plaza — ribbons that hug the terrain (every vertex sits on terrainHeight), so movement between
// zones reads as real paths. Pets bias their wandering onto ROAD_NODES; decorations avoid paths.
const ROAD_LOOP_R = 3.0;
const ROAD_W = 0.55;
const PLAZA_R = 1.45;
const SPOKE_ANGLES = [0.92, 1.67, 3.6, 5.0];    // toward house yard / rest area / pond·hammock / west lawn

// `pad` widens (decorations keep their distance) or tightens (footstep sounds only count as road
// when clearly ON the pavement) the road test.
function isOnRoad(x, z, pad = 0.12) {
    const r = Math.hypot(x, z);
    if (r < PLAZA_R + pad) return true;
    if (Math.abs(r - ROAD_LOOP_R) < ROAD_W * 0.5 + pad) return true;
    for (const a of SPOKE_ANGLES) {
        const dx = Math.sin(a), dz = Math.cos(a);
        const t = x * dx + z * dz;
        if (t < PLAZA_R - 0.2 || t > 3.4) continue;
        const px = x - dx * t, pz = z - dz * t;
        if (Math.hypot(px, pz) < ROAD_W * 0.5 + pad) return true;
    }
    return false;
}

const pathTex = canvasTex(64, 5, 1, (ctx, s) => {
    ctx.fillStyle = '#d9c294';
    ctx.fillRect(0, 0, s, s);
    // 가장자리 어둠띠 + 은은한 중앙 밟힘 하이라이트 — 리본 UV의 y가 정확히 길 폭(0..1)이라
    // 텍스처에 구우면 모든 길·모든 스포크에 공짜로 테두리가 생긴다 (원인⑤: 길이 잔디에 스티커처럼 뜨는 문제).
    const eg = ctx.createLinearGradient(0, 0, 0, s);
    eg.addColorStop(0, 'rgba(122,94,58,0.55)');
    eg.addColorStop(0.14, 'rgba(122,94,58,0)');
    eg.addColorStop(0.86, 'rgba(122,94,58,0)');
    eg.addColorStop(1, 'rgba(122,94,58,0.55)');
    ctx.fillStyle = eg;
    ctx.fillRect(0, 0, s, s);
    const cg = ctx.createLinearGradient(0, 0, 0, s);
    cg.addColorStop(0.34, 'rgba(255,246,222,0)');
    cg.addColorStop(0.5, 'rgba(255,246,222,0.18)');
    cg.addColorStop(0.66, 'rgba(255,246,222,0)');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '150,120,75' : '255,245,215'},0.18)`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    for (let i = 0; i < 7; i++) {                                  // little flat stones
        ctx.fillStyle = 'rgba(160,150,130,0.5)';
        ctx.beginPath();
        ctx.ellipse(Math.random() * s, Math.random() * s, 3 + Math.random() * 3, 2 + Math.random() * 2, Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
    }
});
const plazaTex = canvasTex(128, 4, 4, (ctx, s) => {
    ctx.fillStyle = '#e5decb';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(150,135,110,0.35)';
    ctx.lineWidth = 2;
    const tile = s / 4;
    for (let i = 0; i <= 4; i++) {
        ctx.beginPath(); ctx.moveTo(i * tile, 0); ctx.lineTo(i * tile, s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * tile); ctx.lineTo(s, i * tile); ctx.stroke();
    }
    for (let i = 0; i < 50; i++) {
        ctx.fillStyle = 'rgba(170,155,125,0.14)';
        ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
});
const roadMat = new THREE.MeshStandardMaterial({ map: pathTex, roughness: 1, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });

function buildRibbon(points, width, closed) {
    const positions = [], uvs = [], indices = [];
    const n = points.length;
    let dist = 0;
    for (let i = 0; i < n; i++) {
        const p = points[i];
        const prev = points[(i - 1 + n) % n];
        const next = points[(i + 1) % n];
        let dx, dz;
        if (!closed && i === 0) { dx = next.x - p.x; dz = next.z - p.z; }
        else if (!closed && i === n - 1) { dx = p.x - prev.x; dz = p.z - prev.z; }
        else { dx = next.x - prev.x; dz = next.z - prev.z; }
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len;
        if (i > 0) dist += Math.hypot(p.x - prev.x, p.z - prev.z);
        for (const side of [-1, 1]) {
            const x = p.x + nx * side * width / 2;
            const z = p.z + nz * side * width / 2;
            positions.push(x, terrainHeight(x, z) + 0.013, z);
            uvs.push(dist * 0.9, side * 0.5 + 0.5);
        }
    }
    const segCount = closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
        const a = i * 2, b = i * 2 + 1;
        const c2 = ((i + 1) % n) * 2, d = c2 + 1;
        indices.push(a, b, c2, b, d, c2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, roadMat);
    mesh.receiveShadow = true;
    return mesh;
}
{
    // Loop road
    const loopPts = [];
    for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        loopPts.push({ x: Math.sin(a) * ROAD_LOOP_R, z: Math.cos(a) * ROAD_LOOP_R });
    }
    const loopRibbon = buildRibbon(loopPts, ROAD_W, true);
    stage.add(loopRibbon);
    WORLD_STATIC_ROOTS.push(loopRibbon);   // 리본은 전부 roadMat 공유 — 베이크가 1콜로 합친다
    // Spokes from the plaza edge out just past the loop
    for (const a of SPOKE_ANGLES) {
        const dx = Math.sin(a), dz = Math.cos(a);
        const pts = [];
        for (let t = PLAZA_R - 0.15; t <= 3.4; t += 0.3) pts.push({ x: dx * t, z: dz * t });
        const spoke = buildRibbon(pts, ROAD_W * 0.85, false);
        stage.add(spoke);
        WORLD_STATIC_ROOTS.push(spoke);
    }
    // Plaza: a stone-tiled circle at the center (terrain there is auto-leveled by its flat spot)
    const plazaGeo = new THREE.CircleGeometry(PLAZA_R, 48);
    plazaGeo.rotateX(-Math.PI / 2);
    const pp = plazaGeo.attributes.position;
    const puv = plazaGeo.attributes.uv;
    for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i), z = pp.getZ(i);
        pp.setY(i, terrainHeight(x, z) + 0.012);
        puv.setXY(i, x * 0.9, z * 0.9);
    }
    plazaGeo.computeVertexNormals();
    const plaza = new THREE.Mesh(plazaGeo, new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1 }));
    plaza.receiveShadow = true;
    stage.add(plaza);
}

// Wander destinations pets are drawn to — the plaza, points along the loop, and each spoke end —
// so daily movement actually follows the paths instead of cutting across the meadow.
const ROAD_NODES = [{ x: 0, z: 0 }];
for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ROAD_NODES.push({ x: Math.sin(a) * ROAD_LOOP_R, z: Math.cos(a) * ROAD_LOOP_R });
}
for (const a of SPOKE_ANGLES) ROAD_NODES.push({ x: Math.sin(a) * 3.3, z: Math.cos(a) * 3.3 });
for (const br of BRIDGES) ROAD_NODES.push({ ...br.inner }, { ...br.outer });
for (let i = 1; i < ISLANDS.length; i++) ROAD_NODES.push({ x: ISLANDS[i].x, z: ISLANDS[i].z });

// Wooden bridges out to the satellite islands: stepped planks over the arch, posts and rails.
{
    const bridgeWood = M(0xb08a60, { map: woodTex });
    for (const br of BRIDGES) {
        const g = new THREE.Group();
        const dx = br.B.x - br.A.x, dz = br.B.z - br.A.z;
        const len = Math.hypot(dx, dz);
        const heading = Math.atan2(dx, dz);
        const px = -dz / len, pz = dx / len;
        const N = Math.max(10, Math.round(len / 0.22));   // 섬 간격이 벌어져 다리가 길어짐 — 플랭크 밀도 유지
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            const plank = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.045, (len / N) * 0.82), bridgeWood);
            plank.position.set(br.A.x + dx * t, bridgeDeckY({ t }) - 0.022, br.A.z + dz * t);
            plank.rotation.y = heading;
            g.add(plank);
        }
        for (const side of [-1, 1]) {
            for (const t of [0.04, 0.5, 0.96]) {
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.3, 8), bridgeWood);
                post.position.set(br.A.x + dx * t + px * side * 0.34, bridgeDeckY({ t }) + 0.13, br.A.z + dz * t + pz * side * 0.34);
                g.add(post);
                const cap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), bridgeWood);
                cap.position.set(post.position.x, post.position.y + 0.16, post.position.z);
                g.add(cap);
            }
            for (let i = 0; i < N; i++) {
                const t = (i + 0.5) / N;
                const rail = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.035, len / N + 0.02), bridgeWood);
                rail.position.set(br.A.x + dx * t + px * side * 0.34, bridgeDeckY({ t }) + 0.25, br.A.z + dz * t + pz * side * 0.34);
                rail.rotation.y = heading;
                g.add(rail);
            }
        }
        g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        stage.add(g);
        WORLD_STATIC_ROOTS.push(g);   // 다리는 공유 bridgeWood 하나 — 베이크가 섬 3개 다리를 1콜로
    }
}

// ---- Decorations (non-blocking set dressing): instanced grass tufts, flowers and pebbles ----
{
    const rnd = (a, b) => a + Math.random() * (b - a);
    const spots = (count, margin) => {
        const out = [];
        for (let tries = 0; out.length < count && tries < count * 30; tries++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * (ISLAND_R - margin);
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            if (world.isBlocked(x, z)) continue;
            if (isOnRoad(x, z)) continue;               // keep the paths and plaza clear
            if (houseFloorY(x, z) !== null) continue;   // no flowers in the living room
            out.push({ x, z });
        }
        return out;
    };
    const dummy = new THREE.Object3D();
    // 클러스터 살포: 균일 랜덤은 노이즈로 읽힌다 — 실제 들판처럼 몇 포기씩 뭉쳐 나게 한다.
    // (중심을 spots로 뽑아 길/광장/집/프롭은 이미 피하고, 오프셋 지점도 한 번 더 거른다.)
    const clusters = (centerCount, perLo, perHi, spread, margin) => {
        const out = [];
        spots(centerCount, margin + spread).forEach((cpt, ci) => {
            const k = perLo + Math.floor(Math.random() * (perHi - perLo + 1));
            for (let i = 0; i < k; i++) {
                const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * spread;
                const x = cpt.x + Math.cos(a) * rr, z = cpt.z + Math.sin(a) * rr;
                if (world.isBlocked(x, z) || isOnRoad(x, z) || houseFloorY(x, z) !== null || islandOf(x, z) < 0) continue;
                out.push({ x, z, ci });   // ci: 다발 번호 — 들꽃은 "한 다발 = 한 색"에 쓴다
            }
        });
        return out;
    };

    const tufts = clusters(68, 4, 7, 0.42, 0.45);   // ~370포기가 4~7포기씩 다발로
    // 원뿔 잔디(사용자 픽 — quad 풀잎에서 복귀), 대신 "자연스럽게" 세 겹:
    //  ① 포기 = 원뿔 3개 다발 (꼿꼿한 중심 + 반대로 기운 곁가지 둘) — 스파이크가 아니라 포기로 읽힌다
    //  ② 다발(ci)마다 체격이 다르다 (0.66~1.4 — 무성한 데와 성긴 데)
    //  ③ 포기마다 키/퍼짐 독립 스케일 + 기울기 + 밝기·색조 지터(instanceColor)
    // bakeGrad 램프(밑동 그늘) × instanceColor × material.color(계절 틴트) — 전부 곱셈이라 공존.
    const tuftCone = (r, h, lean, ax, dx, dz) => {
        const geo = new THREE.ConeGeometry(r, h, 5).translate(0, h / 2, 0);   // 밑동을 원점에 — 기울여도 뿌리가 땅에
        geo.rotateZ(lean);
        geo.rotateX(ax);
        geo.translate(dx, 0, dz);
        return geo;
    };
    const tuftGeo = bakeGrad(mergeGeometries([
        tuftCone(0.02, 0.11, 0.05, -0.03, 0, 0),
        tuftCone(0.0145, 0.072, 0.42, 0.14, 0.015, 0.007),
        tuftCone(0.016, 0.086, -0.38, -0.1, -0.014, -0.006),
    ]), 0xffffff, 0xa9b89c, { curve: 1.1 });
    const tuftMesh = new THREE.InstancedMesh(tuftGeo, M(0x5fae44, { vertexColors: true, unique: true }), tufts.length);   // 계절이 color를 만진다 — 공유 금지
    const clumpK = (ci) => Math.abs(Math.sin((ci + 1) * 78.233) * 43758.5453) % 1;   // 다발 고유 체격 0..1
    const tuftC = new THREE.Color();
    tufts.forEach((s, i) => {
        const build = 0.66 + clumpK(s.ci) * 0.74;                        // 다발 체격
        const sxz = build * rnd(0.8, 1.25), sy = build * rnd(0.7, 1.55); // 포기별 퍼짐/키 독립
        dummy.position.set(s.x, terrainHeight(s.x, s.z) + 0.002, s.z);
        dummy.rotation.set(rnd(-0.16, 0.16), rnd(0, Math.PI * 2), rnd(-0.16, 0.16));
        dummy.scale.set(sxz, sy, sxz);
        dummy.updateMatrix();
        tuftMesh.setMatrixAt(i, dummy.matrix);
        const b = rnd(0.88, 1.1);                                        // 밝기 + 웜/쿨 색조 지터
        tuftMesh.setColorAt(i, tuftC.setRGB(b * rnd(0.92, 1.06), b, b * rnd(0.86, 1.0)));
    });
    tuftMesh.castShadow = true;
    stage.add(tuftMesh);

    const petals = [0xff8fb3, 0xffd54f, 0xffffff, 0xb39ddb, 0xff8a65];
    const blooms = clusters(17, 3, 6, 0.3, 0.5);    // 들꽃도 화단처럼 3~6송이 다발로
    const stemMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.01, 0.09, 6), M(0x4e9a3d), blooms.length);
    // 꽃머리 = 수평 꽃송이 quad (flowerTex 루미넌스 꽃잎 × instanceColor) — 구슬 막대사탕 탈피.
    // 카메라가 위에서 내려다보는 월드라 수평 디스크가 제일 "꽃"으로 읽힌다. 살짝 랜덤 틸트.
    const headMesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.085, 0.085).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ map: flowerTex, alphaTest: 0.4, side: THREE.DoubleSide, color: 0xffffff }),   // 계절이 color를 만진다 — 전용 재질
        blooms.length);
    blooms.forEach((s, i) => {
        const y = terrainHeight(s.x, s.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(rnd(0.8, 1.3));
        dummy.position.set(s.x, y + 0.045, s.z);
        dummy.updateMatrix();
        stemMesh.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, y + 0.095, s.z);
        dummy.rotation.set(rnd(-0.22, 0.22), rnd(0, Math.PI), rnd(-0.22, 0.22));
        dummy.updateMatrix();
        headMesh.setMatrixAt(i, dummy.matrix);
        headMesh.setColorAt(i, new THREE.Color(petals[(s.ci ?? i) % petals.length]));
    });
    stage.add(stemMesh);
    stage.add(headMesh);

    const pebbles = spots(46, 0.5);
    const pebbleMesh = new THREE.InstancedMesh(
        bakeGrad(new THREE.DodecahedronGeometry(0.045, 0), 0xffffff, 0x9d9588, { curve: 1.1 }),
        M(0xbdb7ab, { vertexColors: true, unique: true }), pebbles.length);   // 계절이 color를 만진다 — 공유 금지
    pebbles.forEach((s, i) => {
        dummy.position.set(s.x, terrainHeight(s.x, s.z) + 0.012, s.z);
        dummy.rotation.set(rnd(0, Math.PI), rnd(0, Math.PI), 0);
        dummy.scale.set(rnd(0.6, 1.4), rnd(0.4, 0.8), rnd(0.6, 1.4));
        dummy.updateMatrix();
        pebbleMesh.setMatrixAt(i, dummy.matrix);
    });
    pebbleMesh.receiveShadow = true;
    stage.add(pebbleMesh);
    seasonDecor = { tuftMesh, stemMesh, headMesh, pebbleMesh };   // 계절이 데코를 되칠한다 (겨울엔 꽃·풀이 눈 밑으로)
}

// ---- Season painting (계절 칠하기): 여름이 원본. applySeason은 잎 버텍스 컬러를 리베이크하고
// (가을은 나무마다 금빛/주황/빨강 중 하나), 잔디를 틴트하고(겨울엔 즉시 설원 텍스처 스왑 —
// "눈이 쌓였다"의 순간), 눈모자·꽃잎·낙엽·데코를 2.5초 크로스페이드로 갈아입힌다. 하늘·바다·
// 낮길이 축은 updateDayNight가 SEASONS/SEA_TINT/HEMI_GROUND 테이블에서 매번 읽는다. ----
const _white = new THREE.Color(0xfff6e8), _fresh = new THREE.Color(0xd6ffbe), _frost = new THREE.Color(0xa8c0b2);
function leafPair(e, s) {
    if (e.cherry) {
        const [t, b] = CHERRY_LEAF[s];
        const top = new THREE.Color(t), bottom = new THREE.Color(b);
        if (e.li % 2) { top.lerp(_white, 0.1); bottom.lerp(_white, 0.1); }
        return [top, bottom];
    }
    const top = new THREE.Color(e.orig[0]), bottom = new THREE.Color(e.orig[1]);
    if (s === 'spring') { top.lerp(_fresh, 0.22); bottom.lerp(_fresh, 0.16); }
    else if (s === 'winter') { top.lerp(_frost, 0.55); bottom.lerp(_frost, 0.5); }
    else if (s === 'autumn') {
        const [t, b] = LEAF_AUTUMN[e.treeNo % LEAF_AUTUMN.length];
        top.set(t); bottom.set(b);
        if (e.li % 2) { top.lerp(_white, 0.14); bottom.lerp(_white, 0.1); }
    }
    return [top, bottom];
}
function applySeason(next, animate = true) {
    season = next;
    worldUnbake();   // 잎 크로스페이드는 원본 lobe들이 그린다 — 전환이 끝나면 재베이크 (updateSeasonBlend)
    const winter = next === 'winter';
    const lobes = seasonLeaves.map((e) => {
        const [top, bottom] = leafPair(e, next);
        return { attr: e.geo.attributes.color, from: e.geo.attributes.color.array.slice(), to: gradColors(e.geo, top, bottom) };
    });
    const cols = [], nums = [];
    const gt = GRASS_TINT[next];
    for (const grass of seasonGrass) {
        grass.material.map = winter ? snowGroundTex : grassTex;   // instant swap — 눈 쌓임/눈 녹음의 순간
        cols.push({ ref: grass.material.color, from: grass.material.color.clone(), to: new THREE.Color(gt[0], gt[1], gt[2]) });
    }
    if (seasonDecor) {
        const { tuftMesh, stemMesh, headMesh, pebbleMesh } = seasonDecor;
        tuftMesh.visible = !winter; stemMesh.visible = !winter; headMesh.visible = !winter;
        cols.push({ ref: tuftMesh.material.color, from: tuftMesh.material.color.clone(), to: new THREE.Color(TUFT_COLOR[next]) });
        cols.push({ ref: headMesh.material.color, from: headMesh.material.color.clone(), to: new THREE.Color(next === 'autumn' ? 0xf0d8c0 : 0xffffff) });
        cols.push({ ref: pebbleMesh.material.color, from: pebbleMesh.material.color.clone(), to: new THREE.Color(winter ? 0xe6ebf2 : 0xbdb7ab) });
    }
    for (const cap of seasonSnowCaps) cap.visible = true;   // fade via the shared opacity; hidden at blend end unless winter
    nums.push({ obj: snowCapMat, key: 'opacity', from: snowCapMat.opacity, to: winter ? 1 : 0 });
    for (const f of seasonFall) {
        f.pts.visible = true;
        nums.push({ obj: f.pts.material, key: 'opacity', from: f.pts.material.opacity, to: next === f.when ? 0.9 : 0 });
    }
    nums.push({ obj: blobMat, key: 'opacity', from: blobMat.opacity, to: winter ? 0.55 : 1 });   // 눈 위 접지 그림자는 옅게
    seasonBlend = { t: 0, dur: animate ? 2.5 : 0.0001, lobes, cols, nums };
    if (!animate) updateSeasonBlend(1);
    updateDayNight(true);   // 낮길이 창이 바뀌었다 — 즉시 하늘 재합성
}
function updateSeasonBlend(delta) {
    if (!seasonBlend) return;
    const b = seasonBlend;
    b.t = Math.min(1, b.t + delta / b.dur);
    const k = THREE.MathUtils.smoothstep(b.t, 0, 1);
    for (const L of b.lobes) {
        const a = L.attr.array;
        for (let i = 0; i < a.length; i++) a[i] = L.from[i] + (L.to[i] - L.from[i]) * k;
        L.attr.needsUpdate = true;
    }
    for (const c of b.cols) c.ref.copy(c.from).lerp(c.to, k);
    for (const n of b.nums) n.obj[n.key] = n.from + (n.to - n.from) * k;
    if (b.t >= 1) {
        if (season !== 'winter') for (const cap of seasonSnowCaps) cap.visible = false;
        for (const f of seasonFall) f.pts.visible = season === f.when;
        seasonBlend = null;
        if (!buildMode) worldBake();   // 새 계절 색으로 재베이크 (공사 중이면 종료 훅이 맡는다)
    }
}
// 🌦️ 패널의 계절 줄에서 호출: id 고정(예: 'winter'), null = 달력 자동.
function setManualSeason(id) {
    manualSeason = id;
    try {
        if (id) localStorage.setItem('world-season', id);
        else localStorage.removeItem('world-season');
    } catch (e) {}
    const next = worldSeason();
    if (next === season) return;
    applySeason(next, true);
    logWorldEvent(`주인이 계절을 ${SEASONS[next].ko}로 바꿨다 ${SEASONS[next].icon}`);
    maybeProactive(null, `주인이 방금 계절을 ${SEASONS[next].ko}(으)로 바꿨다!`);
}

// ---- Ocean (바다): an animated sea ringing the floating island. A polar grid with geometric ring
// spacing (dense near the island where you look, sparse toward the horizon) gets four layered
// directional sine waves each frame; recomputed normals make the swells actually catch the sun and
// moonlight on the water (Phong specular), and the amplitude fades toward the foggy horizon so the
// far sea doesn't shimmer. Two foam rings lap against the cliff, swelling and fading out of phase.
const OCEAN_LEVEL = -0.52;
let oceanMesh = null;
{
    const inner = ISLAND_R * 0.81, outer = 40, rings = 40, segs = 112;
    const positions = [], indices = [], fades = [], colors = [];   // fade: 수평선 밖 0 → 변위·법선 모두 원값 유지
    for (let i = 0; i <= rings; i++) {
        const r = inner * Math.pow(outer / inner, i / rings);
        for (let j = 0; j < segs; j++) {
            const a = (j / segs) * Math.PI * 2;
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            positions.push(x, OCEAN_LEVEL, z);
            fades.push(1 - THREE.MathUtils.smoothstep(r, 24, 36));
            // 기슭 여울: 가장 가까운 섬 기슭까지의 거리로 근해를 밝고 초록끼 돌게, 원양은 살짝
            // 깊게 — 곱셈(1.0 근방) 정점색이라 낮/밤/계절 물빛(seaMat.color)과 그대로 합성된다.
            let minD = Infinity;
            for (const q of ISLANDS) {
                const d = Math.hypot(x - q.x, z - q.z) - q.r;
                if (d < minD) minD = d;
            }
            const shore = 1 - THREE.MathUtils.smoothstep(minD, 0.1, 2.6);
            const deep = THREE.MathUtils.smoothstep(minD, 2.6, 15);
            colors.push(1 + shore * 0.2 - deep * 0.1, 1 + shore * 0.26 - deep * 0.05, 1 + shore * 0.14);
        }
    }
    for (let i = 0; i < rings; i++) {
        for (let j = 0; j < segs; j++) {
            const a = i * segs + j;
            const b = i * segs + (j + 1) % segs;
            const d = (i + 1) * segs + j;
            const e = (i + 1) * segs + (j + 1) % segs;
            indices.push(a, b, d, b, e, d);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aFade', new THREE.Float32BufferAttribute(fades, 1));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();   // 평면이라 전부 (0,1,0) — 매 프레임 셰이더가 해석 법선으로 대체
    seaMat = new THREE.MeshPhongMaterial({
        color: 0x3fa9d0, specular: 0xaee6ff, shininess: 68, vertexColors: true,   // 기슭 여울 정점색 · 물비늘용으로 하이라이트 약간 타이트하게 (42→68)
        transparent: true, opacity: 0.85,     // glassy: the submerged cliff + swimmers show through
    });
    // 파도는 GPU에서 (강수·분수와 같은 wxTime 시계): 4파 사인 변위와 그 편미분(해석 법선)을
    // 버텍스 셰이더에 주입한다. 예전엔 CPU가 4,592정점을 매 프레임 다시 계산하고 position+normal
    // ~110KB를 재업로드했다(발열) — 이제 CPU 몫은 공유 uniform 1개뿐이다. 상수는 CPU 버전과
    // 동일해야 한다(수영 펫 등이 파고를 CPU에서 다시 샘플링하게 되면 이 식과 맞출 것).
    // 물비늘(sun glitter)은 프래그먼트에서: 월드 xz 기반 고주파 사인 리플 3겹으로 픽셀 노멀을
    // 잘게 흔들면 스페큘러가 파도 위에서 반짝반짝 부서진다 — 정점(4.6k)으론 못 내는 입자감을
    // 픽셀 단위로 공짜에 가깝게. 수평선 페이드(aFade→varying)로 원양에선 잦아들어 앨리어싱 방지.
    seaMat.onBeforeCompile = (shader) => {
        shader.uniforms.uWxT = wxTime;
        shader.vertexShader = 'uniform float uWxT;\nattribute float aFade;\nvarying vec2 vSeaXZ;\nvarying float vSeaFade;\n' + shader.vertexShader
            .replace('#include <beginnormal_vertex>', [
                'float wvA1 = position.x * 0.9 + uWxT * 0.9;',
                'float wvA2 = position.z * 1.15 - uWxT * 0.75;',
                'float wvA3 = (position.x * 0.55 + position.z * 0.83) * 1.6 + uWxT * 1.35;',
                'float wvA4 = position.x * 3.1 - position.z * 2.3 + uWxT * 2.4;',
                'float wvDx = aFade * (0.0405 * cos(wvA1) + 0.02464 * cos(wvA3) + 0.0372 * cos(wvA4));',
                'float wvDz = aFade * (0.0437 * cos(wvA2) + 0.037184 * cos(wvA3) - 0.0276 * cos(wvA4));',
                'vec3 objectNormal = normalize(vec3(-wvDx, 1.0, -wvDz));',
            ].join('\n'))
            .replace('#include <begin_vertex>',
                'vec3 transformed = vec3(position);\n'
                // 마지막 항 = 조수 (≈5분 주기 ±5.5cm) — waveYAt/tideOffset과 동일 상수 (밀물썰물)
                + 'transformed.y += aFade * (0.045 * sin(wvA1) + 0.038 * sin(wvA2) + 0.028 * sin(wvA3) + 0.012 * sin(wvA4) + sin(uWxT * 0.021) * 0.055);\n'
                + 'vSeaXZ = position.xz;\n'
                + 'vSeaFade = aFade;');
        shader.fragmentShader = 'uniform float uWxT;\nvarying vec2 vSeaXZ;\nvarying float vSeaFade;\n' + shader.fragmentShader
            .replace('#include <normal_fragment_begin>', [
                '#include <normal_fragment_begin>',
                // 물비늘: 고주파(파장 ~10cm)라 격자가 아니라 입자로 읽히고, 저주파 패치 봉투가
                // 균일 반복을 깬다. 진폭은 스페큘러가 부서질 만큼만 — 크게 주면 디퓨즈까지
                // 체커 무늬가 배어나 근거리 수면에 초록 격자가 그려진다 (실측 스샷에서 확인).
                'float spkA = sin(vSeaXZ.x * 33.0 + uWxT * 2.1) * sin(vSeaXZ.y * 39.0 - uWxT * 1.6);',
                'float spkB = sin(vSeaXZ.x * 52.0 - vSeaXZ.y * 47.0 + uWxT * 2.9);',
                'float spkC = sin((vSeaXZ.x + vSeaXZ.y) * 66.0 + uWxT * 3.7);',
                'float spkEnv = 0.55 + 0.45 * sin(vSeaXZ.x * 2.3 + uWxT * 0.7) * sin(vSeaXZ.y * 2.9 - uWxT * 0.5);',
                'normal = normalize(normal + vec3(spkA * 0.03 + spkB * 0.022, 0.0, spkB * 0.024 - spkC * 0.027) * (spkEnv * vSeaFade));',
            ].join('\n'));
    };
    oceanMesh = new THREE.Mesh(geo, seaMat);
    oceanMesh.receiveShadow = true;
    oceanMesh.matrixAutoUpdate = false;   // 지오메트리만 출렁인다 — 메시 변환은 identity 고정
    scene.add(oceanMesh);

    for (const isl of ISLANDS) {
        for (let i = 0; i < 2; i++) {
            const sandy = isl.kind === 'sand';   // 해변은 물가선(f≈0.95)에 맞춰 — 젖은 모래에 밀려오는 서프
            const foam = new THREE.Mesh(
                new THREE.RingGeometry(isl.r * (sandy ? 0.88 : 0.82), isl.r * (sandy ? 1.0 : 0.93), 96),
                // alphaMap(foamTex): 매끈한 도넛 띠 → 방울이 뭉치고 끊기는 유기적 거품선
                new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: foamTex, transparent: true, opacity: 0.4, depthWrite: false })
            );
            foam.rotation.x = -Math.PI / 2;
            foam.position.set(isl.x, OCEAN_LEVEL + 0.035, isl.z);
            scene.add(foam);
            foamRings.push(foam);
        }
    }
    updateDayNight(true);            // tint the fresh sea/foam for the current hour
}

function updateOcean() {
    // 파고·법선은 버텍스 셰이더가 wxTime으로 계산한다 — CPU 몫은 거품 링 2개짜리 루프뿐.
    const t = wxTime.value;
    // Foam: swell outward, fade, restart — the two rings run half a phase apart.
    foamRings.forEach((foam, i) => {
        const ph = (t * 0.42 + i * 0.5) % 1;
        const s = 1 + ph * 0.085;
        foam.scale.set(s, s, 1);
        foam.material.opacity = (1 - ph) * (1 - ph) * 0.42;
        foam.position.y = OCEAN_LEVEL + 0.035 + Math.sin(t * 1.4 + i * 2.6) * 0.012;
    });
}

// ---- Weather systems (날씨): precipitation is ONE Points draw call per kind — a vertex-shader
// patch wraps each drop down its column on a time uniform, so the CPU writes nothing per frame
// (heat budget: the world stays a single forward pass + two tiny point clouds). Rain = streak
// sprites, snow = flakes on a sine drift. A rainbow rises over the sea when rain ends in daylight,
// and the rain hiss is synthesized noise through the sfx chain — no files, same as the water. ----
const WX_AREA_R = 16, WX_TOP = 8.5, WX_H = 9.5;   // drop cylinder: covers all four islands (모험의 섬 가장자리 13.2까지)
function precipTexture(draw) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    draw(cv.getContext('2d'));
    return new THREE.CanvasTexture(cv);
}
const rainTex = precipTexture((ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgba(205,225,255,0)');
    g.addColorStop(0.25, 'rgba(205,225,255,0.9)');
    g.addColorStop(1, 'rgba(205,225,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(14, 0, 4, 32);
});
const snowTex = precipTexture((ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 14);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2); ctx.fill();
});
// Falling-particle cloud: one draw call, zero per-frame CPU — the vertex shader wraps each point
// down its column on the shared wxTime uniform. Weather uses the world-sized defaults; the season
// system passes a small area + a parent for tree-local clouds (벚꽃잎이 나무를 따라다닌다).
function precipPoints(count, tex, size, speedLo, speedHi, sway, areaR = WX_AREA_R, top = WX_TOP, fallH = WX_H, parent = scene) {
    const pos = new Float32Array(count * 3), spd = new Float32Array(count), ph = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, r = areaR * Math.sqrt(Math.random());
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = top - Math.random() * fallH;
        pos[i * 3 + 2] = Math.sin(a) * r;
        spd[i] = speedLo + Math.random() * (speedHi - speedLo);
        ph[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(spd, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const mat = new THREE.PointsMaterial({ map: tex, size, transparent: true, opacity: 0, depthWrite: false });
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.uWxT = wxTime;
        sh.vertexShader = 'uniform float uWxT;\nattribute float aSpeed;\nattribute float aPhase;\n' + sh.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\n'
            + `transformed.y = ${top.toFixed(2)} - mod(${top.toFixed(2)} - transformed.y + uWxT * aSpeed, ${fallH.toFixed(2)});\n`
            + `transformed.x += sin(uWxT * 0.8 + aPhase) * ${sway.toFixed(2)};\n`
            + `transformed.z += cos(uWxT * 0.63 + aPhase * 1.7) * ${sway.toFixed(2)};`
        );
    };
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;   // the shader slides drops outside the static bounds
    pts.visible = false;
    parent.add(pts);
    return pts;
}
const rainPts = precipPoints(2000, rainTex, 0.2, 6.5, 9.5, 0.05);
const leafFallTex = precipTexture((ctx) => {   // 가을 낙엽 — 말랑한 잎사귀 실루엣
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 13);
    g.addColorStop(0, 'rgba(255,190,120,0.95)');
    g.addColorStop(0.7, 'rgba(230,140,70,0.85)');
    g.addColorStop(1, 'rgba(230,140,70,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(16, 16, 12, 8, 0.6, 0, Math.PI * 2); ctx.fill();
});
const autumnLeafPts = precipPoints(320, leafFallTex, 0.06, 0.45, 0.85, 0.55);   // 가을에만 — applySeason이 켠다
seasonFall.push({ pts: autumnLeafPts, when: 'autumn' });
applySeason(season, false);   // 부팅 계절 즉시 칠하기 (여름이면 사실상 no-op)
const snowPts = precipPoints(850, snowTex, 0.075, 0.55, 1.05, 0.4);

// Rainbow (무지개): a half ring standing in the sea behind the island; UVs rewritten radially so
// the 1D band texture paints arcs.
const rainbow = (() => {
    const inner = 7.2, outer = 9.0;
    const geo = new THREE.RingGeometry(inner, outer, 72, 1, 0, Math.PI);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - inner) / (outer - inner), 0.5);
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 1;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    [['#ff5f5f', 0.06], ['#ffab4e', 0.22], ['#ffe45e', 0.38], ['#7ed86f', 0.54], ['#5fb7ff', 0.7], ['#7f7bff', 0.86]].forEach(([c, s]) => g.addColorStop(s, c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 1);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(-2.5, -0.45, -13);   // feet in the sea, offset from the sun's arc
    m.visible = false;
    scene.add(m);
    return m;
})();
let rainbowT = WEATHER_OVERRIDE === 'rainbow' ? 1e9 : 0;
let rainbowAge = 10;   // seconds since it appeared (starts past the fade-in for the preview)

// ---- Aurora (오로라): two shader curtains over the northern night sky — the world's first custom
// shader. The vertex stage bends each flat plane into an arc behind the island and sways it on the
// shared weather clock; the fragment stage layers sine "rays" over a green→violet ramp, additive
// so the stars keep shining through. Night + clear skies only: a rare treat in auto mode, or
// pinned from the 🌦️ panel. Heat budget: two draw calls, a few hundred verts, no fullscreen work.
function auroraCurtain(radius, baseY, height, phase, strength) {
    const geo = new THREE.PlaneGeometry(28, height, 72, 6);
    const mat = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uT: wxTime, uOpacity: { value: 0 }, uPhase: { value: phase }, uR: { value: radius } },
        vertexShader: `
            uniform float uT; uniform float uPhase; uniform float uR;
            varying vec2 vUv;
            void main() {
                vUv = uv;
                float ang = position.x / uR;
                float sway = sin(ang * 6.0 + uT * 0.22 + uPhase) + 0.55 * sin(ang * 13.0 - uT * 0.15 + uPhase * 1.7);
                vec3 p = vec3(sin(ang) * uR + sway * 0.4, position.y + sway * 0.5, -cos(ang) * uR);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }`,
        fragmentShader: `
            uniform float uT; uniform float uOpacity; uniform float uPhase;
            varying vec2 vUv;
            void main() {
                float n = 0.5 * sin(vUv.x * 16.0 + uT * 0.33 + uPhase)
                        + 0.3 * sin(vUv.x * 37.0 - uT * 0.21 + uPhase * 2.3)
                        + 0.2 * sin(vUv.x * 85.0 + uT * 0.12);
                float rays = 0.55 + 0.45 * n;
                float shape = smoothstep(0.0, 0.14, vUv.y) * pow(1.0 - vUv.y, 1.3) * 1.15;
                vec3 col = mix(vec3(0.30, 1.0, 0.55), vec3(0.55, 0.38, 1.0), clamp(vUv.y * 1.25 + 0.18 * n, 0.0, 1.0)) * 1.55;
                gl_FragColor = vec4(col, uOpacity * rays * shape);
            }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = baseY;
    m.frustumCulled = false;   // the shader bends the flat plane into an arc
    m.visible = false;
    m.userData.strength = strength;
    scene.add(m);
    return m;
}
const auroraCurtains = [auroraCurtain(30, 5.6, 6.5, 0, 1), auroraCurtain(33.5, 7.0, 5.5, 2.1, 0.55)];   // 수평선에서 피어오르는 높이 — 기본 카메라에도 하단이 담긴다
let auroraUntil = 0;        // auto-mode episode end (ms)
let auroraNextRoll = 0;     // next auto lottery draw
let auroraF = WEATHER_OVERRIDE === 'aurora' ? 1 : 0;   // eased on/off — 미리보기는 켜진 채 시작
let auroraVis = 0;          // final visibility this frame — the chat snapshot reads it
function updateAurora(delta) {
    // Auto lottery: clear auto-mode nights only, drawn every ~8 minutes — a sometimes-treat.
    const now = Date.now();
    if (!manualWx && !WEATHER_OVERRIDE && wx.type === 'clear' && now > auroraNextRoll) {
        auroraNextRoll = now + 8 * 60000;
        if (dayFactor(currentHour()) < 0.05 && now > auroraUntil && Math.random() < 0.14) {
            auroraUntil = now + (6 + Math.random() * 5) * 60000;
            logWorldEvent('밤하늘에 오로라가 떴다 🌌');
            maybeProactive(pets.find((q) => q.name === 'puppy'), '방금 밤하늘에 오로라가 떴다! 초록 커튼이 일렁인다.');
        }
    }
    const active = manualWx === 'aurora' || WEATHER_OVERRIDE === 'aurora' || now < auroraUntil;
    auroraF = THREE.MathUtils.clamp(auroraF + (active ? 1 : -1) * delta / 6, 0, 1);
    const nightF = 1 - dayFactor(currentHour());
    auroraVis = auroraF * THREE.MathUtils.clamp((nightF - 0.25) / 0.75, 0, 1) * (1 - wxF);   // 밤 + 맑음에서만
    for (const c of auroraCurtains) {
        c.material.uniforms.uOpacity.value = 0.78 * auroraVis * c.userData.strength;   // 0.78×1.15×ray≈0.7 — 가산 클램프(백화) 직전
        c.visible = auroraVis > 0.01;
    }
}

// ---- 비 피신 (⑯ v2): 비/뇌우가 내리기 시작하면 한가한 펫들이 동굴 쿠션(폴백: 집 소파)으로
// 뛰어들어가 앉아 기다리고, 날이 개면 스스로 일어난다. 눈은 예외 — 눈밭 산책은 낭만이니까.
// 바쁜 펫(식사·탑승·조종·듀오·goto)은 양보하고, 이동·착석은 기존 mountBed/bedExit 표준을 쓴다. ----
let shelterMode = false;
function shelterFreePets() {
    let went = false;
    for (const p of pets) {
        if (p === possessed || p.bed || p.dip || p.pet.sleeping) continue;
        if (p.ai.state !== 'idle' && p.ai.state !== 'walk') continue;
        const bed = BEDS.find((b) => b.shelter && !b.occupant);
        if (!bed) break;
        p.sheltering = true;
        mountBed(p, bed);
        went = true;
    }
    if (went) logWorldEvent('비가 쏟아져서 동굴로 피했다 ☔');
}
function updateShelter() {
    const wet = wx.type === 'rain' || wx.type === 'storm';
    if (wet && !shelterMode && wxF > 0.25) {
        shelterMode = true;
        shelterFreePets();
    } else if (!wet && shelterMode && wxF < 0.2) {
        shelterMode = false;
    }
    if (!shelterMode) {   // 갠 뒤: 앉아 있던 펫은 일어나고, 아직 걸어가던 펫은 그냥 해제
        for (const p of pets) {
            if (!p.sheltering) continue;
            if (p.bed && p.bedPhase === 'lying') {
                p.sheltering = false;
                p.bedExit = true;
            } else if (!p.bed && p.ai.state !== 'goto') {
                p.sheltering = false;
            }
        }
    }
}

// Rain hiss: looped synthesized noise through a lowpass, faded with wxF. Snow stays silent.
let rainHiss = null;
function setRainHiss(vol) {
    try {
        if (vol > 0.001 && !rainHiss) {
            const src = audioCtx.createBufferSource();
            src.buffer = synthNoiseBuffer(2.4, () => 0.5);
            src.loop = true;
            const lp = audioCtx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 1100;
            const gain = audioCtx.createGain();
            gain.gain.value = 0;
            src.connect(lp); lp.connect(gain); gain.connect(sfxMaster);
            src.start();
            rainHiss = gain;
        }
        if (rainHiss) rainHiss.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.6);
    } catch (e) {}
}

// ⛈️ 번개: 씨의 순간광(그림자 없는 DirectionalLight) + 화면 오버레이 섬광을 이중 플래시 봉투로 트고,
// 0.25~1.8초 뒤 거리감 있는 천둥(합성 노이즈, 파일 없음)이 따라온다. 스톰 중 3~11초 간격.
const lightningLight = new THREE.DirectionalLight(0xdfe8ff, 0);
lightningLight.position.set(6, 12, -4);
// scene 합류는 updateWeather가 뇌우 경계(stormF 0↔양수)에서만 — 맑은 날 셰이더 라이트 수 절약
const lightningFlashEl = document.createElement('div');
lightningFlashEl.style.cssText = 'position:fixed; inset:0; background:linear-gradient(rgba(215,228,255,0.95), rgba(180,200,245,0.5)); opacity:0; pointer-events:none; z-index:60;';
document.body.appendChild(lightningFlashEl);
let thunderBuf = null;
function playThunder(vol) {
    try {
        if (!thunderBuf) thunderBuf = synthNoiseBuffer(2.6, (t) => (t < 0.05 ? t / 0.05 : Math.pow(1 - t, 1.7)) * (0.72 + 0.28 * Math.sin(t * 43 + Math.sin(t * 12) * 2.5)));
        const src = audioCtx.createBufferSource();
        src.buffer = thunderBuf;
        src.playbackRate.value = 0.72 + Math.random() * 0.45;   // 낮을수록 멀리서 울리는 느낌
        const lp = audioCtx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 220 + Math.random() * 180;
        const g = audioCtx.createGain();
        g.gain.value = vol;
        src.connect(lp); lp.connect(g); g.connect(sfxMaster);
        src.start();
    } catch (e) {}
}
let boltTimer = 4, boltT = -1;
function updateLightning(delta) {
    if (wx.type === 'storm' && wxF > 0.55) {
        boltTimer -= delta;
        if (boltTimer <= 0 && boltT < 0) {
            boltT = 0;
            boltTimer = 3 + Math.random() * 8;
            lightningLight.position.set((Math.random() - 0.5) * 24, 10 + Math.random() * 4, (Math.random() - 0.5) * 24);
            const away = 0.25 + Math.random() * 1.55;   // 초 — 섬광→천둥 딜레이, 멀수록 작게
            setTimeout(() => playThunder(0.5 / (0.8 + away)), away * 1000);
        }
    }
    if (boltT >= 0) {
        boltT += delta;
        const t = boltT;
        const k = t < 0.07 ? t / 0.07
              : t < 0.15 ? 1 - ((t - 0.07) / 0.08) * 0.65
              : t < 0.24 ? 0.35 + ((t - 0.15) / 0.09) * 0.65
              : Math.max(0, 1 - (t - 0.24) / 0.32);
        lightningLight.intensity = 2.4 * k;
        lightningFlashEl.style.opacity = (0.34 * k * Math.min(1, wxF * 1.5)).toFixed(3);
        if (t >= 0.56) { boltT = -1; lightningLight.intensity = 0; lightningFlashEl.style.opacity = '0'; }
    }
}

// Scheduler: 맑음 10~25분 ↔ 강수 3~8분 on the real clock, session-only — every window open
// starts from a fresh clear episode (켜면 맑음). Snow replaces rain through 11~2월.
let wxKind = wx.type === 'clear' ? 'rain' : wx.type;   // which particle set the current/last front uses (storm은 비 입자 공유)
function rollWeather() {
    if (WEATHER_OVERRIDE || manualWx) return;
    const now = Date.now();
    if (now < wx.until) return;
    if (wx.type === 'clear') {
        wx = { type: worldSeason() === 'winter' ? 'snow' : 'rain', until: now + (3 + Math.random() * 5) * 60000 };   // 겨울(수동 포함)엔 비 대신 눈
        logWorldEvent(wx.type === 'snow' ? '눈이 내리기 시작했다' : '비가 내리기 시작했다');
        maybeProactive(null, wx.type === 'snow' ? '방금 눈이 내리기 시작했다!' : '방금 비가 내리기 시작했다!');
    } else {
        const gotRainbow = wx.type === 'rain' && lastDayF > 0.35;
        if (gotRainbow) { rainbowT = 75; rainbowAge = 0; }   // sun comes back out
        wx = { type: 'clear', until: now + (10 + Math.random() * 15) * 60000 };
        logWorldEvent(gotRainbow ? '비가 그치고 바다 위에 무지개가 떴다' : '날이 개었다');
        if (gotRainbow) maybeProactive(pets.find((q) => q.name === 'chick'), '방금 비가 그치고 바다 위에 무지개가 떴다!');
    }
}
// 날씨 설정 버튼에서 호출: type 고정(예: 'rain'), null이면 즉시 개고 자동 스케줄러 복귀.
function setManualWeather(type) {
    if (manualWx === type) return;
    manualWx = type;
    if (type === 'aurora') {
        wx = { type: 'clear', until: Infinity };   // 오로라는 맑은 밤하늘 위에 — updateAurora가 페이드를 맡는다
        logWorldEvent('주인이 밤하늘에 오로라를 불러왔다 🌌');
        maybeProactive(null, '주인이 방금 오로라를 불러왔다! 밤하늘에 초록 커튼이 일렁인다.');
        return;
    }
    if (type && type !== 'clear') {
        wx = { type, until: Infinity };
        logWorldEvent(type === 'snow' ? '주인이 눈을 내리게 했다 ❄️' : type === 'storm' ? '주인이 천둥번개를 불러왔다 ⛈️' : '주인이 비를 내리게 했다 🌧️');
        maybeProactive(null, type === 'snow' ? '주인이 방금 눈을 내리게 했다!' : type === 'storm' ? '주인이 방금 천둥번개를 불러왔다! 조금 무섭다.' : '주인이 방금 비를 내리게 했다!');
        return;
    }
    // 맑음 고정('clear') 또는 자동 복귀(null): 내리던 강수는 즉시 개고, 낮 비/뇌우 뒤엔 무지개.
    if (wx.type !== 'clear') {
        const gotRainbow = (wx.type === 'rain' || wx.type === 'storm') && lastDayF > 0.35;
        if (gotRainbow) { rainbowT = 75; rainbowAge = 0; }
        logWorldEvent(gotRainbow ? '비가 그치고 바다 위에 무지개가 떴다' : '날이 개었다');
    }
    wx = { type: 'clear', until: type === 'clear' ? Infinity : Date.now() + (10 + Math.random() * 15) * 60000 };
}
function updateWeather(delta) {
    rollWeather();
    const target = wx.type === 'clear' ? 0 : 1;
    if (wx.type !== 'clear') wxKind = wx.type;
    if (wxF !== target) {
        wxF = THREE.MathUtils.clamp(wxF + Math.sign(target - wxF) * delta / 9, 0, 1);   // ~9s soft front
        updateDayNight(true);   // recomposite sky/light while the front moves through
    }
    const stormTarget = wx.type === 'storm' ? 1 : 0;
    if (stormF !== stormTarget) {
        stormF = THREE.MathUtils.clamp(stormF + Math.sign(stormTarget - stormF) * delta / 4, 0, 1);   // 뇌우는 ~4s로 빠르게 내려앉는다
        updateDayNight(true);
    }
    // 번개 라이트는 뇌우 동안만 씬에 — 상시 intensity 0으로 두면 맑은 날에도 셰이더 라이트 수에
    // 포함돼 모든 픽셀이 값을 낸다 (램프와 같은 원리, 경계는 stormF 0↔양수).
    if (stormF > 0 && !lightningLight.parent) scene.add(lightningLight);
    else if (stormF === 0 && lightningLight.parent) scene.remove(lightningLight);
    wxTime.value += delta;
    const rainy = wxKind === 'rain' || wxKind === 'storm';
    rainPts.visible = rainy && wxF > 0.02;
    snowPts.visible = wxKind === 'snow' && wxF > 0.02;
    rainPts.material.opacity = (0.55 + 0.25 * stormF) * wxF;   // 뇌우엔 빗발이 좀 더 굵다
    snowPts.material.opacity = 0.9 * wxF;
    setRainHiss(rainy ? (0.06 + 0.045 * stormF) * wxF : 0);
    updateLightning(delta);
    updateAurora(delta);
    updateShelter();
    if (rainbowT > 0) {
        rainbowT -= delta;
        rainbowAge += delta;
        rainbow.material.opacity = Math.max(0, Math.min(rainbowAge / 3, 1, rainbowT / 20)) * 0.5 * lastDayF;
        rainbow.visible = rainbow.material.opacity > 0.01;
    } else if (rainbow.visible) {
        rainbow.visible = false;
    }
}

// ---- Pets: both GLB pets live in this one scene (separate instances from the desktop windows) ----
// Each entity sits inside a "mover" group that carries its world position + travel heading. The
// entity's own wrap stays motion-local (the shared motions treat wrap.rotation.y = π as "face
// forward"), so everything from the pet windows plays unchanged on top of the mover.
const PETS = [
    { name: 'chick', url: '/vrm/Chick.glb', height: 0.4, speed: 0.35, spawn: { x: -0.7, z: -0.3 } },
    { name: 'puppy', url: '/vrm/Puppy.glb', height: 0.5, speed: 0.45, spawn: { x:  0.7, z:  0.2 } },
];
const pets = [];   // filled as each model loads: { name, speed, pet, mover, ai }

// 이어하기 (심즈+동숲 하이브리드): 위치·방향·침대·수영 상태를 8초마다+창 닫힐 때 저장하고,
// 켜면 그 자리에서 하던 모습으로 복원한다 — 활동의 "지금 뭐 할 시간인가"는 이미 실제 시계
// 기반(식사·취침·낮밤)이라, 위치만 이어주면 시계 시스템이 나머지를 자연스럽게 이어받는다.
const savedPets = (() => { try { return JSON.parse(localStorage.getItem('world-pets') || 'null'); } catch (e) { return null; } })();
function savePetState() {
    try {
        const out = { ts: Date.now() };
        for (const p of pets) {
            out[p.name] = {
                x: +p.mover.position.x.toFixed(3),
                z: +p.mover.position.z.toFixed(3),
                rotY: +p.mover.rotation.y.toFixed(3),
                bed: p.bed && p.bedPhase === 'lying' ? p.bed.id : null,
                swim: p.swimming || null,
            };
        }
        localStorage.setItem('world-pets', JSON.stringify(out));
    } catch (e) {}
}
window.addEventListener('pagehide', savePetState);

for (const def of PETS) {
    const mover = new THREE.Group();
    mover.position.set(def.spawn.x, world.groundHeightAt(def.spawn.x, def.spawn.z), def.spawn.z);
    scene.add(mover);
    createGlbPetEntity(def.url, { targetHeight: def.height, parent: mover }).then(pet => {
        mover.rotation.y = Math.random() * Math.PI * 2;      // face somewhere, after limb classification
        const entry = { name: def.name, speed: def.speed, height: def.height, pet, mover, ai: makeWanderAI() };
        const sv = savedPets && savedPets[def.name];
        let restored = false;
        if (sv && Number.isFinite(sv.x) && Number.isFinite(sv.z)) {
            if (sv.swim === 'pond' && Math.hypot(sv.x - pondPropRef.x, sv.z - pondPropRef.z) < 0.6) {
                mover.position.set(sv.x, POND_WATER_Y - def.height * 0.45, sv.z);   // 연못에서 물놀이하던 채로
                entry.swimming = 'pond';
                restored = true;
            } else if (islandOf(sv.x, sv.z) >= 0 && !world.isBlocked(sv.x, sv.z)) {
                mover.position.set(sv.x, world.groundHeightAt(sv.x, sv.z), sv.z);   // 뭍의 그 자리에서
                restored = true;
            } else if (islandOf(sv.x, sv.z) < 0 && Math.hypot(sv.x, sv.z) <= SWIM_LEASH) {
                mover.position.set(sv.x, OCEAN_LEVEL + 0.02 - def.height * 0.45, sv.z);   // 바다 수영하던 채로
                entry.swimming = 'sea';
                restored = true;
            }
            if (restored && Number.isFinite(sv.rotY)) mover.rotation.y = sv.rotY;
            if (restored && sv.bed) {
                const bed = BEDS.find((b) => b.id === sv.bed && !b.occupant);   // 앉던/자던 자리가 비어 있으면 다시
                if (bed) setTimeout(() => { if (!entry.bed && entry.ai.state !== 'player') mountBed(entry, bed); }, 700);
            }
        }
        if (!restored) pet.action = { id: 'wave', t: 0 };   // 첫 이사 인사 — 이어하기엔 하던 대로 조용히
        wireWorldFx(entry);
        pets.push(entry);
    }).catch(e => console.error('[World] pet load failed', def.url, e));
}

// Sims-style wander loop: idle a while → pick a reachable spot → turn, then waddle over → idle.
// The AI only steers the mover and toggles pet.walking (the entity's own waddle animation reacts).
// Deliberately a swappable controller: the 3rd-person phase replaces this with keyboard input and a
// later phase can hand the choice of "what to do next" to the LLM, without touching entity/world code.
function makeWanderAI() {
    return { state: 'idle', wait: 1.5 + Math.random() * 3, target: null };
}

function pickTarget(from) {
    // Meandering hops, but ~45% of destinations are drawn from the road network (plaza / loop /
    // spoke ends) so the pets visibly travel the paths between zones; give up quietly if boxed in.
    for (let i = 0; i < 12; i++) {
        let x, z;
        if (Math.random() < 0.45) {
            const node = ROAD_NODES[Math.floor(Math.random() * ROAD_NODES.length)];
            x = node.x + (Math.random() - 0.5) * 0.7;
            z = node.z + (Math.random() - 0.5) * 0.7;
        } else {
            const ang = Math.random() * Math.PI * 2;
            const dist = 0.9 + Math.random() * 2.2;
            x = from.x + Math.cos(ang) * dist;
            z = from.z + Math.sin(ang) * dist;
        }
        if (!world.isBlocked(x, z)) return { x, z };
    }
    return null;
}

// Shared steering used by wandering and duo approaches: shortest-arc turn toward the target and
// stride only once roughly facing it, so departures read as "turn, then walk" instead of strafing.
// rotation.y=0 faces +Z; forward = (sin, cos). Returns 'arrived' | 'blocked' | 'moving'.
function steerToward(p, target, delta) {
    const { mover, pet } = p;
    const dx = target.x - mover.position.x;
    const dz = target.z - mover.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.08) { pet.walking = false; return 'arrived'; }
    const desired = Math.atan2(dx, dz);
    let diff = desired - mover.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    mover.rotation.y += THREE.MathUtils.clamp(diff, -delta * 3.5, delta * 3.5);
    pet.walking = true;
    if (Math.abs(diff) < 0.5) {
        const step = Math.min(p.speed * delta, dist);
        const nx = mover.position.x + Math.sin(mover.rotation.y) * step;
        const nz = mover.position.z + Math.cos(mover.rotation.y) * step;
        if (world.isBlocked(nx, nz)) { pet.walking = false; return 'blocked'; }
        const gy = world.groundHeightAt(nx, nz);
        if (Math.abs(gy - mover.position.y) > 0.26) { pet.walking = false; return 'blocked'; }   // no ledge hopping
        mover.position.set(nx, gy, nz);
    }
    return 'moving';
}

function updateWander(p, delta) {
    const { ai, mover, pet } = p;
    if (ai.state === 'player') return;                               // the keyboard controller owns it
    if (ai.state === 'held') return;                                 // walking hand-in-hand with the player
    if (ai.state === 'busy') { pet.walking = false; return; }        // a duo director owns the pet
    if (ai.state === 'goto') {
        // Approach walk (duo/bed/meal/dip): follows its waypoint route (bridges included) and
        // gives up gracefully (arrive-anyway) when blocked or stalled — directors never deadlock.
        ai.stall = (ai.stall || 0) + delta;
        const wp = (ai.waypoints && ai.waypoints.length) ? ai.waypoints[0] : ai.target;
        const res = steerToward(p, wp, delta);
        if (res === 'arrived' && ai.waypoints && ai.waypoints.length > 1) {
            if (wp && wp.tp) portalHop(p, wp.tp);   // 🌀 포탈 웨이포인트 — 반대편으로 슝
            ai.waypoints.shift();
            ai.stall = 0;
            return;
        }
        if (res === 'arrived' || res === 'blocked' || ai.stall > 10) {
            ai.state = 'busy';
            const done = ai.onArrive; ai.onArrive = null;
            if (done) done();
        }
        return;
    }
    if (pet.sleeping || pet.action) { pet.walking = false; return; }   // motions/sleep own the pet
    if (ai.state === 'idle') {
        pet.walking = false;
        ai.wait -= delta;
        if (ai.wait <= 0) {
            // Sometimes fancy a dip instead of a stroll (daytime only, on a cooldown) — so the
            // pets end up swimming together, player included.
            if (!isSleepTime(currentHour()) && Date.now() > (p.nextDipAt || 0) && Math.random() < 0.25) {
                p.nextDipAt = Date.now() + 150000 + Math.random() * 150000;
                startDip(p);
                return;
            }
            // …or carry the rod to the shore and fish a couple of rounds alone (daytime, cooldown).
            if (!isSleepTime(currentHour()) && !aiFishing && !(fishing && fishing.p === p)
                && Date.now() > (p.nextFishAt || 0) && Math.random() < 0.09) {
                p.nextFishAt = Date.now() + 300000 + Math.random() * 300000;
                startAiFishing(p);
                return;
            }
            // …또는 열기구를 타러 계류장으로 — 혼자 하늘 한 바퀴 (낮, 쿨다운, 열기구가 집에 있을 때).
            // 첫 쿨다운은 시드만 — 앱 켜자마자 열기구가 떠나버리면 주인이 탈 틈이 없다 (E2E에서 실측).
            if (!p.nextBalloonAt) p.nextBalloonAt = Date.now() + 240000 + Math.random() * 480000;
            else if (!isSleepTime(currentHour()) && !balloonRide && !aiBalloonWalk && BALLOON.mode === 'docked'
                && Date.now() > p.nextBalloonAt && Math.random() < 0.05) {
                p.nextBalloonAt = Date.now() + 420000 + Math.random() * 420000;
                startAiBalloon(p);
                return;
            }
            // …또는 통통호를 타러 잔교로 — 모래섬 찍고 오는 뱃놀이 (낮, 쿨다운 시드)
            if (!p.nextFerryAt) p.nextFerryAt = Date.now() + 300000 + Math.random() * 480000;
            else if (!isSleepTime(currentHour()) && !ferryRide && !aiFerryWalk && FERRY.mode === 'docked'
                && Date.now() > p.nextFerryAt && Math.random() < 0.04) {
                p.nextFerryAt = Date.now() + 480000 + Math.random() * 480000;
                startAiFerry(p);
                return;
            }
            // …or amble over to a free swing / seesaw and hop on (daytime, on its own cooldown).
            if (!isSleepTime(currentHour()) && Date.now() > (p.nextSwingAt || 0) && Math.random() < 0.14) {
                const seat = SWINGS.find((b) => !b.occupant) || SEESAWS.find((b) => !b.occupant);
                if (seat) {
                    p.nextSwingAt = Date.now() + 180000 + Math.random() * 180000;
                    mountBed(p, seat);
                    return;
                }
            }
            const target = pickTarget(mover.position);
            if (target) {
                ai.target = target;
                ai.waypoints = buildRoute(mover.position, target);
                ai.state = 'walk';
            }
            else ai.wait = 1 + Math.random() * 2;
        }
        return;
    }
    const wp = (ai.waypoints && ai.waypoints.length) ? ai.waypoints[0] : ai.target;
    const res = steerToward(p, wp, delta);
    if (res === 'arrived') {
        if (ai.waypoints && ai.waypoints.length > 1) {
            if (wp && wp.tp) portalHop(p, wp.tp);   // 🌀 배회 경로에 심긴 포탈 웨이포인트
            ai.waypoints.shift();
            return;
        }
        ai.state = 'idle'; ai.wait = 2 + Math.random() * 4;
        if (Math.random() < 0.22) pet.action = { id: Math.random() < 0.5 ? 'happy' : 'think', t: 0 };  // arrival flourish
    } else if (res === 'blocked') {
        ai.state = 'idle'; ai.wait = 0.5 + Math.random();              // grazed a prop en route — re-plan
    }
}

// Cross-island trips are routed through the right bridge (each satellite has exactly one), so a
// straight-line steer never tries to cross open water.
function buildRouteWalk(from, to) {
    const a = islandOf(from.x, from.z), b = islandOf(to.x, to.z);
    if (a === b || a === -1 || b === -1) return [{ x: to.x, z: to.z }];
    // 다리 없는 섬(휴양지 모래섬) — 직선 폴백: 물가에서 blocked → arrive-anyway가 곱게 포기한다
    if ((a !== 0 && !BRIDGES[a - 1]) || (b !== 0 && !BRIDGES[b - 1])) return [{ x: to.x, z: to.z }];
    const route = [];
    if (a !== 0) { const br = BRIDGES[a - 1]; route.push({ ...br.outer }, { ...br.inner }); }
    if (b !== 0) { const br = BRIDGES[b - 1]; route.push({ ...br.inner }, { ...br.outer }); }
    route.push({ x: to.x, z: to.z });
    return route;
}
function routeLen(from, wps) {
    let len = 0, px = from.x, pz = from.z;
    for (const w of wps) {
        len += Math.hypot(w.x - px, w.z - pz);
        px = w.x; pz = w.z;
    }
    return len;
}
// 다리 경로가 기본, 포탈 경유가 "확실히" 짧을 때만 tp 웨이포인트를 심는다 (팔랑귀 방지 문턱 1.2).
function buildRoute(from, to) {
    const walk = buildRouteWalk(from, to);
    if (PORTALS.length !== 2) return walk;
    let best = walk, bestLen = routeLen(from, walk);
    for (const i of [0, 1]) {
        const pa = PORTALS[i], pb = PORTALS[1 - i];
        const exit = portalExit(pb);
        const leg1 = buildRouteWalk(from, { x: pa.x, z: pa.z });
        const leg2 = buildRouteWalk(exit, to);
        const len = routeLen(from, leg1) + 0.8 + routeLen(exit, leg2);
        if (len < bestLen - 1.2) {
            bestLen = len;
            best = [...leg1.slice(0, -1), { x: pa.x, z: pa.z, tp: exit }, ...leg2];
        }
    }
    return best;
}

// ---- World FX: the shared motions emit emoji/overlays through per-entity hooks; here they anchor
// to the pet's projected screen position instead of the pet-window's fixed percentages. Mapping:
// the pet-window coords treat left:50 / top:70 as "at the feet" and sizes were tuned against a
// ~152px-tall character, so offsets and font sizes scale with the pet's projected height in px.
// Particles are fire-and-forget at their spawn point; persistent overlays re-anchor every frame.
const PET_WIN_CHAR_H = 152;
const _proj = new THREE.Vector3();
function petScreenAnchor(p) {
    _proj.copy(p.mover.position).project(camera);
    const fx = (_proj.x * 0.5 + 0.5) * window.innerWidth;
    const fy = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
    _proj.copy(p.mover.position); _proj.y += p.height; _proj.project(camera);
    const hy = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
    return { x: fx, y: fy, h: Math.max(24, fy - hy) };   // foot px + projected pet height px
}
function fxPoint(p, leftPct, topPct) {
    const a = petScreenAnchor(p);
    return { x: a.x + ((leftPct - 50) / 100) * a.h * 2, y: a.y + ((topPct - 70) / 100) * a.h * 2, h: a.h };
}
function fxScale(h, size, min = 9, max = 64) {
    return Math.round(THREE.MathUtils.clamp(size * (h / PET_WIN_CHAR_H), min, max));
}

function wireWorldFx(p) {
    const mk = (id, text, cssExtra = '') => {
        const el = document.createElement('div');
        el.id = `world-fx-${id}-${p.name}`;
        el.textContent = text;
        el.style.cssText = `position:fixed; left:0; top:0; transform:translate(-50%,-50%); opacity:0; pointer-events:none; z-index:60; transition:opacity 0.3s; will-change:transform; ${cssExtra}`;
        document.body.appendChild(el);
        return el;
    };
    const zzzEl   = mk('zzz', '💤');
    const thinkEl = mk('think', '💭');
    const cheerEl = mk('cheer', '파이팅!', 'font-weight:700; text-shadow:0 2px 5px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.5); white-space:nowrap;');
    const countEl = mk('count', '10', 'font-weight:800; color:#fff; text-shadow:0 2px 6px rgba(0,0,0,0.6);');
    const exclaimEl = mk('exclaim', '❗', 'font-weight:700; text-shadow:0 2px 6px rgba(0,0,0,0.5);');
    const overlays = [
        { el: zzzEl,   left: 58, top: 14, size: 44 },
        { el: thinkEl, left: 62, top: 10, size: 44 },
        { el: cheerEl, left: 50, top: 4,  size: 18 },
        { el: countEl, left: 60, top: 6,  size: 26 },
        { el: exclaimEl, left: 50, top: 2, size: 40 },
    ];
    p.pet.setZzz   = (on) => { zzzEl.style.opacity   = on ? '0.9' : '0'; };
    p.pet.setThink = (on) => { thinkEl.style.opacity = on ? '0.95' : '0'; };
    p.pet.setCheer = (on) => {
        if (on && cheerEl.style.opacity !== '1') {
            cheerEl.style.color = `hsl(${Math.floor(Math.random() * 360)}, 85%, 58%)`;
        }
        cheerEl.style.opacity = on ? '1' : '0';
    };
    // 숨바꼭질 오버레이: 술래 머리 위 카운트다운 숫자, 발견의 ❗.
    p.pet.setCount = (n) => {
        if (n == null) { countEl.style.opacity = '0'; return; }
        countEl.textContent = String(n);
        countEl.style.opacity = '1';
    };
    p.pet.setExclaim = (on) => { exclaimEl.style.opacity = on ? '1' : '0'; };
    // Eat FX are real 3D in the world (no emoji): a per-pet ground prop — grain patch for the
    // chick, mini kibble bowl for the puppy — placed in front of the pet when the motion starts,
    // and hidden entirely when eating at the real bowl (the bowl IS the food there).
    p.foodProp = p.pet.wings.length ? makeGrainPatch() : makeMiniBowl();
    p.foodProp.visible = false;
    scene.add(p.foodProp);
    p.pet.setEat = (on) => {
        if (!on) { p.foodProp.visible = false; return; }
        if (Math.hypot(p.mover.position.x - bowlProp.x, p.mover.position.z - bowlProp.z) < 0.65) {
            p.foodProp.visible = false;
            return;
        }
        if (!p.foodProp.visible) {
            const fx = p.mover.position.x + Math.sin(p.mover.rotation.y) * 0.2;
            const fz = p.mover.position.z + Math.cos(p.mover.rotation.y) * 0.2;
            p.foodProp.position.set(fx, world.groundHeightAt(fx, fz), fz);
        }
        p.foodProp.visible = true;
    };
    p.pet.spawnEmoji = (ch, { left = 50, top = 28, size = 28, dx = 0, duration = 1400 } = {}) => {
        if (p.pet.action && p.pet.action.id === 'eat') { spawnFoodCrumb(p); return; }   // 밥알은 3D로
        const pt = fxPoint(p, left, top);
        const el = document.createElement('div');
        el.textContent = ch;
        el.style.cssText = `position:fixed; left:${Math.round(pt.x)}px; top:${Math.round(pt.y)}px; font-size:${fxScale(pt.h, size)}px; opacity:0; pointer-events:none; z-index:60; will-change:transform,opacity;`;
        document.body.appendChild(el);
        el.animate([
            { transform: 'translate(-50%,-50%) rotate(-10deg)', opacity: 0 },
            { opacity: 0.95, offset: 0.25 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% - 48px)) rotate(10deg)`, opacity: 0 },
        ], { duration, easing: 'ease-out' }).onfinish = () => el.remove();
    };
    p.pet.heartFx = () => heartBurstAt(p);   // 💗 하트 모션은 이모지 대신 3D 하트로
    p.pet.holidayFx = () => holidayBurstAt(p);   // 🎄 홀리데이는 3D 눈송이/색종이+금별로
    p.pet.burstEmoji = (chars, count = 14, { cx = 50, cy = 32 } = {}) => {
        const pt = fxPoint(p, cx, cy);
        const k = pt.h / PET_WIN_CHAR_H;                     // scale the whole burst with the pet
        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.textContent = chars[Math.floor(Math.random() * chars.length)];
            el.style.cssText = `position:fixed; left:${Math.round(pt.x)}px; top:${Math.round(pt.y)}px; font-size:${fxScale(pt.h, 18 + Math.random() * 16)}px; opacity:1; pointer-events:none; z-index:60; will-change:transform,opacity;`;
            document.body.appendChild(el);
            const ang = Math.random() * Math.PI * 2;
            const dist = (40 + Math.random() * 90) * k;
            const ex = Math.cos(ang) * dist;
            const upY = -Math.abs(Math.sin(ang)) * dist * 0.5 - 20 * k;
            const fallY = (120 + Math.random() * 90) * k;
            el.animate([
                { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1, offset: 0 },
                { transform: `translate(calc(-50% + ${ex * 0.6}px), calc(-50% + ${upY}px)) rotate(${(Math.random() - 0.5) * 220}deg)`, opacity: 1, offset: 0.35 },
                { transform: `translate(calc(-50% + ${ex}px), calc(-50% + ${fallY}px)) rotate(${(Math.random() - 0.5) * 400}deg)`, opacity: 0, offset: 1 },
            ], { duration: 1100 + Math.random() * 800, easing: 'cubic-bezier(.2,.6,.3,1)' }).onfinish = () => el.remove();
        }
    };
    p.fxUpdate = () => {
        for (const o of overlays) {
            if ((o.el.style.opacity || '0') === '0') continue;
            const pt = fxPoint(p, o.left, o.top);
            o.el.style.left = `${Math.round(pt.x)}px`;
            o.el.style.top = `${Math.round(pt.y)}px`;
            o.el.style.fontSize = `${fxScale(pt.h, o.size)}px`;
        }
    };
}

// ---- Click a pet → the same motion menu the pet windows use (data-driven from GLB_MOTIONS) ----
const motionMenu = document.createElement('div');
motionMenu.id = 'world-motion-menu';
// 📱 터치는 행 간격·글자를 손가락 기준으로 키운다(44px 탭 타깃 가이드라인 근처).
const menuPad = IS_TOUCH ? '12px 14px' : '7px 12px';
const menuFont = IS_TOUCH ? 15 : 13;
motionMenu.style.cssText = `position:fixed; display:none; z-index:100; background:rgba(30,32,40,0.92); border-radius:10px; padding:6px; box-shadow:0 6px 24px rgba(0,0,0,0.35); max-height:${IS_TOUCH ? 'min(340px, 55vh)' : '230px'}; overflow-y:auto; min-width:${IS_TOUCH ? 170 : 150}px; font-family:sans-serif;`;
document.body.appendChild(motionMenu);
let menuPet = null;
// 🎮 control entry pinned above the motions: possess this pet (or release it) for keyboard control.
const controlItem = document.createElement('div');
controlItem.style.cssText = `padding:${menuPad}; font-size:${menuFont}px; color:#ffd54f; border-radius:7px; cursor:pointer; white-space:nowrap; border-bottom:1px solid rgba(255,255,255,0.12); margin-bottom:4px;`;
controlItem.onmouseenter = () => { controlItem.style.background = 'rgba(255,255,255,0.14)'; };
controlItem.onmouseleave = () => { controlItem.style.background = 'transparent'; };
controlItem.onclick = () => {
    const p = menuPet;
    hideMenu();
    if (!p) return;
    if (p === possessed) releasePossession();
    else possessPet(p);
};
motionMenu.appendChild(controlItem);
for (const m of GLB_MOTIONS) {
    const item = document.createElement('div');
    item.textContent = m.label;
    item.style.cssText = `padding:${menuPad}; font-size:${menuFont}px; color:#fff; border-radius:7px; cursor:pointer; white-space:nowrap;`;
    item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.14)'; };
    item.onmouseleave = () => { item.style.background = 'transparent'; };
    item.onclick = () => { const p = menuPet; hideMenu(); if (p) playWorldMotion(p, m.id); };
    motionMenu.appendChild(item);
}
// 놀이: 숨바꼭질 — 조종 중이면 주인이 숨고 (다른 펫이 술래), 아니면 클릭한 펫이 술래.
const hideSeekItem = document.createElement('div');
hideSeekItem.textContent = '🙈 숨바꼭질';
hideSeekItem.style.cssText = `padding:${menuPad}; font-size:${menuFont}px; color:#9be7ff; border-radius:7px; cursor:pointer; white-space:nowrap;`;
hideSeekItem.onmouseenter = () => { hideSeekItem.style.background = 'rgba(255,255,255,0.14)'; };
hideSeekItem.onmouseleave = () => { hideSeekItem.style.background = 'transparent'; };
hideSeekItem.onclick = () => { const p = menuPet; hideMenu(); if (p) worldHideSeek(p); };
motionMenu.appendChild(hideSeekItem);
// 📞/📍 소셜 항목 — 조종 중인 펫 메뉴에서만 (showMenu가 표시 토글)
const callItem = document.createElement('div');
callItem.textContent = '📞 친구 부르기';
callItem.style.cssText = `padding:${menuPad}; font-size:${menuFont}px; color:#9be7ff; border-radius:7px; cursor:pointer; white-space:nowrap;`;
callItem.onmouseenter = () => { callItem.style.background = 'rgba(255,255,255,0.14)'; };
callItem.onmouseleave = () => { callItem.style.background = 'transparent'; };
callItem.onclick = () => { hideMenu(); startPhoneCall(); };
motionMenu.appendChild(callItem);
const gotoFriendItem = document.createElement('div');
gotoFriendItem.textContent = '📍 친구한테 가기';
gotoFriendItem.style.cssText = `padding:${menuPad}; font-size:${menuFont}px; color:#9be7ff; border-radius:7px; cursor:pointer; white-space:nowrap;`;
gotoFriendItem.onmouseenter = () => { gotoFriendItem.style.background = 'rgba(255,255,255,0.14)'; };
gotoFriendItem.onmouseleave = () => { gotoFriendItem.style.background = 'transparent'; };
gotoFriendItem.onclick = () => { hideMenu(); teleportToFriend(); };
motionMenu.appendChild(gotoFriendItem);
// 코디 items below the motions (divider above the first); labels refresh per open in showMenu.
const accessoryItems = [];
for (let i = 0; i < GLB_ACCESSORIES.length; i++) {
    const a = GLB_ACCESSORIES[i];
    const item = document.createElement('div');
    item.style.cssText = `padding:${menuPad}; font-size:${menuFont}px; color:#ffd7e0; border-radius:7px; cursor:pointer; white-space:nowrap;` + (i === 0 ? 'border-top:1px solid rgba(255,255,255,0.12); margin-top:4px;' : '');
    item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.14)'; };
    item.onmouseleave = () => { item.style.background = 'transparent'; };
    item.onclick = () => {
        const p = menuPet;
        hideMenu();
        if (!p) return;
        if (!accUnlocked.has(a.id)) { showToast('🔒 모험의 섬 보물찾기에서 발견하면 열려요'); return; }
        setGlbPetAccessory(p.pet, (p.pet.accessory && p.pet.accessory.id === a.id) ? null : a.id);
    };
    motionMenu.appendChild(item);
    accessoryItems.push({ el: item, acc: a });
}
function showMenu(x, y, p) {
    menuPet = p;
    controlItem.textContent = (p === possessed) ? '🎮 조종 해제 (Esc)' : '🎮 조종하기';
    const social = (p === possessed && pets.length >= 2) ? 'block' : 'none';   // 📞/📍는 조종 중 메뉴 전용
    callItem.style.display = social;
    gotoFriendItem.style.display = social;
    for (const { el, acc } of accessoryItems) {
        el.textContent = !accUnlocked.has(acc.id) ? '🔒 ???'
            : (p.pet.accessory && p.pet.accessory.id === acc.id) ? `${acc.label} 벗기` : acc.label;
    }
    motionMenu.style.display = 'block';
    // Open to the RIGHT of the click point (the click lands on the pet — an offset keeps the
    // menu from covering the character; clamped to the window edge). 하드코딩 치수 대신 실측:
    // 터치 확대로 메뉴가 커져도, 좁은 폰 화면에서도 밖으로 나가지 않는다.
    const mw = motionMenu.offsetWidth + 12, mh = motionMenu.offsetHeight + 12;
    motionMenu.style.left = `${Math.max(6, Math.min(x + 80, window.innerWidth - mw))}px`;
    motionMenu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - mh))}px`;
}
function hideMenu() { motionMenu.style.display = 'none'; menuPet = null; hideSipMenu(); }   // the two travel together

// Click = short, unmoved pointer press (otherwise it was an orbit drag). Clicking a sleeping pet
// wakes it (like the pet window); clicking an awake pet opens the motion menu.
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let pressAt = null;
// 🔨 공사모드 상태 — 본체(버튼·링·드래그 로직)는 독 UI 아래에 있고, 여기 포인터 핸들러들은
// 모드가 켜져 있으면 펫 상호작용 대신 사물 선택/드래그로 분기한다.
// (buildMode 선언 자체는 파일 상단 — 초기 계절 적용이 월드 베이크 훅에서 읽는다)
let buildSel = null;    // 선택된 PROPS 엔트리
let buildDrag = null;   // { id(pointerId), p, planeY, dx, dz, fromX, fromZ, rot }
// 📱 핀치 줌: 터치 포인터를 직접 추적해 두 손가락 벌림/오므림을 휠과 같은 줌 경로(camZoom —
// min/max 클램프와 animate()의 글라이드 재사용)로 흘려보낸다. move/up 리스너는 window에 건다:
// OrbitControls가 첫 포인터만 캔버스에 캡처하고 두 번째는 캡처가 없어서, 손가락이 떠 있는
// UI 위로 미끄러지면 캔버스 리스너는 그 뒤 이벤트를 놓치기 때문.
const activeTouches = new Map();   // pointerId → {x, y}
let pinchDist = 0;
renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
        activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activeTouches.size === 2) {
            pressAt = null;   // 두 번째 손가락 = 핀치 시작: 진행 중이던 탭 후보는 무효
            if (buildDrag) endBuildDrag(true);   // 🔨 드래그 중 핀치가 시작되면 그 자리에 내려놓는다
            const [a, b] = [...activeTouches.values()];
            pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
            return;
        }
        if (activeTouches.size > 2) return;
    }
    // 🔨 공사모드: 사물 위에서 누르면 곧장 집어서 드래그 (마우스는 좌클릭만)
    if (buildMode && (e.pointerType === 'touch' || e.button === 0)) {
        if (startBuildDrag(e)) { pressAt = null; return; }
    }
    pressAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
window.addEventListener('pointermove', (e) => {
    const t = activeTouches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    if (activeTouches.size === 2) {
        const [a, b] = [...activeTouches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0 && d > 0) camZoom(pinchDist / d);   // 벌리면 <1 → 줌 인
        pinchDist = d;
    }
});
const endTouch = (e) => {
    if (!activeTouches.delete(e.pointerId)) return;
    pinchDist = 0;
    if (e.type === 'pointercancel') pressAt = null;   // iOS가 제스처를 가로채면 탭 후보도 폐기
};
window.addEventListener('pointerup', endTouch);
window.addEventListener('pointercancel', endTouch);
renderer.domElement.addEventListener('pointerup', (e) => {
    hideMenu();
    hideSipMenu();
    hideBoatMenu();
    planeMenu.style.display = 'none';
    balloonMenu.style.display = 'none';
    ferryMenu.style.display = 'none';
    if (!pressAt) return;
    const moved = Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y);
    const held = performance.now() - pressAt.t;
    pressAt = null;
    const slop = e.pointerType === 'touch' ? 13 : 6;   // 손가락은 마우스보다 떨림이 커서 탭 판정을 넉넉히
    if (moved > slop || held > 400) return;
    if (buildMode) { buildSelect(null); return; }   // 🔨 빈 곳 탭 = 선택 해제 (사물은 pointerdown이 잡음) · 펫 메뉴는 잠금
    pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    if (constelMode) { pickConstelStar(); return; }   // ⭐ 별 잇기 모드 — 탭은 전부 별 선택
    // 🎣 입질/파이팅 중엔 어디를 클릭하든 챔질·입력 잠금이 우선
    if (fishing && fishing.state !== 'idle' && fishingIntercept()) return;
    // 🛩️ 탑승 중엔 비행기 메뉴가 펫 메뉴보다 우선 — 조종사 머리가 가장 큰 클릭 타깃이라
    // 펫 루프가 먼저면 "친구 태우기"를 열기 어렵다 (기체 주변 1.5m 반경 판정, 공중 제외)
    if (e.button === 2 && planeRide && !planeRide.passenger && PLANE.mode !== 'fly'
        && raycaster.ray.distanceToPoint(planeGroup.position) < 1.5) {
        showPlaneMenu(e.clientX, e.clientY);
        return;
    }
    // ⛴️ 정박/출항 초반 통통호 우클릭 = 친구 태우기 — 잔교에서 갑판으로 폴짝
    if (e.button === 2 && ferryRide && !ferryRide.friend && !ferryRide.isAI
        && (FERRY.mode !== 'sail' || ferryRide.t < 15)
        && raycaster.ray.distanceToPoint(ferryGroup.position) < 2.4) {
        showFerryMenu(e.clientX, e.clientY);
        return;
    }
    // 🎈 이륙 직후(15초 내) 열기구 근처 우클릭 = 친구 태우기 — 데크에서 큰 아크로 승선
    if (e.button === 2 && balloonRide && !balloonRide.friend && !balloonRide.isAI && balloonRide.t < 15
        && BALLOON.mode !== 'land' && raycaster.ray.distanceToPoint(balloonGroup.position) < 2.2) {
        showBalloonMenu(e.clientX, e.clientY);
        return;
    }
    // 🎣 낚싯대 든 동안 좌클릭은 펫을 통과 — 펫 실루엣과 겹치는 물을 노릴 때 클릭이 먹히던 문제
    const fishingAim = fishing && fishing.state === 'idle' && e.button !== 2 && e.pointerType !== 'touch';
    if (!fishingAim) for (const p of pets) {
        if (raycaster.intersectObject(p.mover, true).length) {
            if (e.button !== 2 && e.pointerType !== 'touch') return;   // 마우스는 RIGHT-click 전용 (left = camera) · 터치는 탭이 곧 상호작용
            if (p.bed && p.bed.mode === 'sit') { p.bedExit = true; return; }   // tap a sitter → gets up
            if (p.pet.sleeping) { p.pet.sleeping = false; p.pet.autoSleeping = false; return; }
            showMenu(e.clientX, e.clientY, p);
            // Holding a drink/snack? Stack the 먹기 chooser right ABOVE the motion menu
            // (same left edge), so neither panel sits on top of the pet.
            if (p === possessed && ((p.drink && !p.drink.seq) || (p.food && !p.food.seq))) {
                const mRect = motionMenu.getBoundingClientRect();
                showSipMenuAt(mRect.left, mRect.top, true);
            }
            return;
        }
    }
    // 🚣 노 젓는 중 배를 우클릭 = 친구 태우기 메뉴 (소품 클릭 처리보다 먼저)
    if (e.button === 2 && boatRide && !boatRide.passenger && raycaster.intersectObject(boatGroup, true).length) {
        showBoatMenu(e.clientX, e.clientY);
        return;
    }
    // 🎣 낚싯대 든 채 물 클릭 = 캐스팅 (해석은 tryCastAtScreen — 헤드리스 진단과 공유)
    if (fishing && fishing.state === 'idle' && possessed === fishing.p && !airborne) {
        const res = tryCastAtScreen();   // raycaster는 위에서 이미 세팅됨
        if (res === 'cast') return;
        if (res === 'far') { showToast('🎣 너무 멀어요 — 물가에 더 가까이 가서 던져요'); return; }
        if (res === 'near') { showToast('🎣 발밑 말고 조금 앞에 던져요!'); return; }
        // 'land' = 물이 아님 — 아래 일반 클릭 처리로 계속
    }
    // 추억의 섬 소품 (쪼아쪼아나무·소원우물·타임캡슐): 클릭/탭으로 상호작용 — 드래그는 위의
    // slop 판정에서 이미 걸러졌으니 좌클릭 탭도 카메라와 안 싸운다.
    for (const pr of PROPS) {
        if (!PROP_CLICKS[pr.type] || !pr.obj) continue;
        const hits = raycaster.intersectObject(pr.obj, true);
        if (hits.length) {
            PROP_CLICKS[pr.type](pr, hits[0]);   // hit까지 넘긴다 — 텃밭 플롯·피아노 건반이 자식 메쉬를 판별
            return;
        }
    }
    // 🌸 꽃심기 모드: 소품에 안 맞았으면 잔디 클릭을 심기로 — 바구니를 다시 클릭하면 끈다(위에서 처리됨).
    if (flowerMode) {
        const hit = raycaster.ray.intersectPlane(buildPlane, buildHitV);
        if (hit) plantFlowerAt(hit.x, hit.z);
        return;
    }
});

// ---- Motions. Solo ones set the entity action exactly like the pet windows; hug/play are
// re-choreographed in-scene — no window IPC: the two entities walk to each other / toss a real
// 3D ball. `duoBusy` keeps the two directors from fighting; AIs are parked in 'goto'/'busy'. ----
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
let duoBusy = false;

function releaseAI(p, wait = 1.5) {
    if (p.ai.state === 'player') return;   // a director letting go of a pet the player took over
    p.ai.state = 'idle'; p.ai.wait = wait + Math.random();
    p.ai.target = null; p.ai.waypoints = null; p.ai.onArrive = null;
}
function gotoAsync(p, x, z) {
    return new Promise((resolve) => {
        p.pet.sleeping = false;
        p.ai.state = 'goto';
        p.ai.target = { x, z };
        p.ai.waypoints = buildRoute(p.mover.position, { x, z });   // routes over bridges if needed
        p.ai.stall = 0;
        p.ai.onArrive = resolve;
    });
}
// Points GAP apart across the midpoint of the two pets, on the line through them.
function duoSpots(a, b, gap) {
    const A = a.mover.position, B = b.mover.position;
    let ux = B.x - A.x, uz = B.z - A.z;
    const len = Math.hypot(ux, uz) || 1; ux /= len; uz /= len;
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    return [
        { x: mx - ux * gap / 2, z: mz - uz * gap / 2 },
        { x: mx + ux * gap / 2, z: mz + uz * gap / 2 },
    ];
}
function faceEachOther(a, b) {
    const A = a.mover.position, B = b.mover.position;
    a.mover.rotation.y = Math.atan2(B.x - A.x, B.z - A.z);
    b.mover.rotation.y = Math.atan2(A.x - B.x, A.z - B.z);
}

function playWorldMotion(p, id) {
    if (p.ai.state === 'goto' || p.ai.state === 'busy' || p.ai.state === 'held') return;   // choreography/hand-hold owns it
    if (id === 'sleep') { p.pet.sleeping = true; releaseAI(p, 4); return; }
    p.pet.sleeping = false; p.pet.autoSleeping = false;
    if (id === 'holiday') {
        if (p === possessed) releasePossession();          // 듀오 안무는 AI에게 맡긴다
        worldHoliday(p);
        return;
    }
    if (id === 'hug' || id === 'play') {
        if (p === possessed) releasePossession();          // hand the pet back to its AI for the duo
        (id === 'hug' ? worldHug : worldPlay)(p);
        return;
    }
    if (id === 'wave') petVoice(p);                       // 인사엔 목소리도 함께
    p.pet.action = { id, t: 0 };
}

// 🎄 홀리데이 듀오: 절친이 한가하면 걸어와 마주보고, 반박자(duoShift 0.5) 어긋난 거울
// 스텝(dir ±1)으로 같이 춘다 — 마주본 둘이 같은 세계 방향으로 기울어 하나의 안무로 읽힌다.
// 상대가 없거나 바쁘면 혼자 춘다. worldHug와 같은 디렉터 패턴(duoBusy·goto·faceEachOther).
async function worldHoliday(initiator) {
    // 축제엔 쉬던 절친도 불러낸다 — 잠·조종·손잡기만 빼고, 침대/그네/물놀이 중이면 내려서 합류.
    const partner = pets.find((q) => q !== initiator && !q.pet.sleeping && q !== possessed && q.ai.state !== 'held');
    if (!partner || duoBusy) { initiator.pet.action = { id: 'holiday', t: 0 }; return; }
    duoBusy = true;
    if (partner.bed) forceEndBed(partner);
    if (partner.dip) endDip(partner);
    if (initiator.bed) forceEndBed(initiator);
    if (initiator.dip) endDip(initiator);
    try {
        const [ta, tb] = duoSpots(initiator, partner, 0.85);
        if (world.isBlocked(ta.x, ta.z) || world.isBlocked(tb.x, tb.z)) {
            initiator.pet.action = { id: 'holiday', t: 0 };
            return;
        }
        await Promise.all([gotoAsync(initiator, ta.x, ta.z), gotoAsync(partner, tb.x, tb.z)]);
        faceEachOther(initiator, partner);
        initiator.pet.action = { id: 'holiday', t: 0, dir: 1 };
        partner.pet.action   = { id: 'holiday', t: 0, dir: -1, duoShift: 0.5 };
        logWorldEvent('병아리와 강아지가 마주보고 캐럴 스텝을 맞춰 췄다 🎄');
        await sleepMs(3700);                                   // holiday DUR 3.6s
    } finally {
        duoBusy = false; releaseAI(initiator); releaseAI(partner);
    }
}

async function worldHug(initiator) {
    const partner = pets.find((q) => q !== initiator && !q.pet.sleeping && q !== possessed && !q.bed && !q.dip && q.ai.state !== 'held');
    if (!partner || duoBusy) { initiator.pet.action = { id: 'hug', t: 0, role: 'solo', dir: 1 }; return; }
    duoBusy = true;
    try {
        const [ta, tb] = duoSpots(initiator, partner, 0.55);
        if (world.isBlocked(ta.x, ta.z) || world.isBlocked(tb.x, tb.z)) {
            initiator.pet.action = { id: 'hug', t: 0, role: 'solo', dir: 1 };   // no room here — air-hug
            return;
        }
        await Promise.all([gotoAsync(initiator, ta.x, ta.z), gotoAsync(partner, tb.x, tb.z)]);
        faceEachOther(initiator, partner);
        // Facing each other, the halves' sideways leans (dir/-dir) tilt both heads the same world
        // direction so they read as one embrace instead of a collision.
        initiator.pet.action = { id: 'hug', t: 0, role: 'initiator', dir: 1 };
        partner.pet.action   = { id: 'hug', t: 0, role: 'partner',   dir: -1 };
        logWorldEvent('병아리와 강아지가 포옹했다 💕');
        await sleepMs(3100);                                   // hug DUR is 3.0s
    } finally {
        duoBusy = false; releaseAI(initiator); releaseAI(partner);
    }
}

// ---- Hide and seek (숨바꼭질): the third duo director. The seeker counts at the plaza while the
// hider ducks behind a prop on the far side (or the OWNER hides, if possessing a pet); then the
// seeker patrols the hiding spots. "Seen" = close + inside the facing cone + a clear 2D line of
// sight — sight is sampled against the same prop circles the pets collide with, so whatever
// blocks walking blocks seeing, and construction-mode moves stay honest (PROPS positions are
// live). Starts from the pet menu, a <game=hideseek> chat tag, or occasionally on its own. ----
const HIDE_OCCLUDERS = { tree: 0.42, house: 1.15, coffee: 0.5, food: 0.5, swing: 0.5, seesaw: 0.55, fence: 0.5, radio: 0.3, monument: 0.3, pecktree: 0.42, well: 0.42, boulder: 0.45, cave: 1.05, library: 1.2, gym: 1.4 };
const HIDE_STANDOFF  = { tree: 0.75, house: 1.6, coffee: 0.85, food: 0.85, swing: 0.85, seesaw: 0.9, fence: 0.8, radio: 0.55, monument: 0.62, pecktree: 0.75, well: 0.8, boulder: 0.8, cave: 1.4, library: 1.5, gym: 1.7 };
const HS_COUNT_SPOT = { x: 0.25, z: 0.45 };   // 광장 가운데 — 술래가 눈 가리고 세는 자리
let hideSeekGame = null;   // { phase, seeker, hider, playerHides, countTotal, t, seekT, losT, lastLeft, found, cancel }
let hideSeekAutoAt = Date.now() + 12 * 60000;   // 가끔 스스로 한 판 (다음 추첨 시각)

function sightClear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(2, Math.ceil(d / 0.22));
    for (const pr of PROPS) {
        const rr = HIDE_OCCLUDERS[pr.type];
        if (!rr) continue;
        const rr2 = rr * rr;
        const aIn = (ax - pr.x) ** 2 + (az - pr.z) ** 2 < rr2;
        const bIn = (bx - pr.x) ** 2 + (bz - pr.z) ** 2 < rr2;
        if (aIn && bIn) continue;   // 둘 다 같은 차단원 안(집 안에서 마주침) — 그건 보인 것
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const dx = ax + (bx - ax) * t - pr.x, dz = az + (bz - az) * t - pr.z;
            if (dx * dx + dz * dz < rr2) return false;
        }
    }
    return true;
}
function canSee(seeker, target) {
    const S = seeker.mover.position, H = target.mover.position;
    const dx = H.x - S.x, dz = H.z - S.z;
    const d = Math.hypot(dx, dz);
    if (d > 3.2) return false;
    if (d > 0.8) {   // 팔 뻗을 거리 밖이면 시야 원뿔 안에도 있어야 한다
        const fx = Math.sin(seeker.mover.rotation.y), fz = Math.cos(seeker.mover.rotation.y);
        if ((fx * dx + fz * dz) / d < 0.25) return false;
    }
    return sightClear(S.x, S.z, H.x, H.z);
}
function pickHideSpot(fromX, fromZ) {
    const cands = [];
    for (const pr of PROPS) {
        const off = HIDE_STANDOFF[pr.type];
        if (!off) continue;
        const dx = pr.x - fromX, dz = pr.z - fromZ;
        const d = Math.hypot(dx, dz) || 1;
        const x = pr.x + (dx / d) * off, z = pr.z + (dz / d) * off;   // 술래 반대편, 프롭 뒤
        if (world.isBlocked(x, z)) continue;
        cands.push({ x, z, prop: pr, score: d + Math.random() * 4 });
    }
    cands.sort((a, b) => b.score - a.score);
    if (!cands.length) return null;
    return cands[Math.floor(Math.random() * Math.min(3, cands.length))];
}
async function worldHideSeek(clicked) {
    if (duoBusy || hideSeekGame || buildMode || pets.length < 2) return;
    const playerHides = !!possessed;
    const hider = playerHides ? possessed : clicked;
    const seeker = pets.find((q) => q !== hider);
    if (!seeker || !hider) return;
    const ok = (q) => q === possessed || (!q.pet.sleeping && !q.bed && !q.dip && q.ai.state !== 'held');
    if (!ok(seeker) || !ok(hider)) { showToast('🙈 지금은 숨바꼭질을 할 수 없어요'); return; }
    duoBusy = true;
    const g = hideSeekGame = {
        phase: 'count', seeker, hider, playerHides,
        countTotal: playerHides ? 15 : 10, t: 0, seekT: 0, losT: 0, lastLeft: -1,
        found: false, cancel: false,
    };
    logWorldEvent(`숨바꼭질 시작 — 술래는 ${petKo(seeker)} 🙈`);
    try {
        await gotoAsync(seeker, HS_COUNT_SPOT.x, HS_COUNT_SPOT.z);
        if (g.cancel) return;
        seeker.ai.state = 'busy';
        seeker.mover.rotation.y = Math.PI * 0.9;   // 숨는 쪽을 등지고 바다를 본다
        seeker.pet.action = { id: 'think', t: 0 };
        if (playerHides) {
            showToast(`🙈 ${petKo(seeker)}가 ${g.countTotal}까지 세요 — 어서 숨어요!`);
        } else {
            const spot = pickHideSpot(HS_COUNT_SPOT.x, HS_COUNT_SPOT.z);
            if (spot) {
                gotoAsync(hider, spot.x, spot.z).then(() => {
                    if (hideSeekGame !== g || g.cancel) return;
                    hider.ai.state = 'busy';
                    hider.mover.rotation.y = Math.atan2(spot.prop.x - spot.x, spot.prop.z - spot.z);   // 프롭에 딱 붙어 웅크린 방향
                });
            }
        }
        await waitFor(() => g.t >= g.countTotal || g.cancel, (g.countTotal + 6) * 1000);
        if (g.cancel) return;
        seeker.pet.setCount(null);
        seeker.pet.action = { id: 'happy', t: 0 };
        g.phase = 'seek';
        if (playerHides) showToast('👀 술래가 찾기 시작했어요!');
        // 수색: 숨을 만한 프롭들을 가까운 곳부터(약간 뒤섞어) 순회 — 시야 판정은 updateHideSeek가 맡는다.
        const spots = PROPS.filter((pr) => HIDE_STANDOFF[pr.type])
            .map((pr) => ({ x: pr.x, z: pr.z, d: Math.hypot(pr.x - HS_COUNT_SPOT.x, pr.z - HS_COUNT_SPOT.z) + Math.random() * 5 }))
            .sort((a, b) => a.d - b.d);
        const done = () => g.found || g.cancel || g.seekT > 90;
        for (const wp of spots) {
            if (done()) break;
            await Promise.race([
                gotoAsync(seeker, wp.x + (Math.random() - 0.5) * 0.8, wp.z + (Math.random() - 0.5) * 0.8),
                waitFor(done, 30000),
            ]);
        }
        while (!done()) {   // 코스를 다 돌고도 못 찾았으면 시간이 다할 때까지 재수색
            const wp = spots[Math.floor(Math.random() * spots.length)];
            await Promise.race([gotoAsync(seeker, wp.x, wp.z), waitFor(done, 30000)]);
        }
        if (g.cancel) return;
        g.phase = 'end';
        if (g.found) {
            seeker.pet.setExclaim(true);
            await gotoAsync(seeker, hider.mover.position.x + 0.5, hider.mover.position.z + 0.2);
            seeker.pet.setExclaim(false);
            if (hider !== possessed) faceEachOther(seeker, hider);
            seeker.pet.action = { id: 'cheer', t: 0 };
            if (hider !== possessed) hider.pet.action = { id: 'happy', t: 0 };
            showToast(playerHides ? '❗ 들켰다! 술래 승리 😆' : `❗ ${petKo(seeker)}가 ${petKo(hider)}를 찾았다!`);
            logWorldEvent(playerHides
                ? `숨바꼭질: ${petKo(seeker)}가 숨어 있던 주인을 찾아냈다 ❗`
                : `숨바꼭질: ${petKo(seeker)}가 ${petKo(hider)}를 찾아냈다 ❗`);
            if (playerHides) maybeProactive(seeker, '방금 숨바꼭질에서 주인님을 찾아냈다! 내가 이겼다!');
            await sleepMs(2600);
        } else {
            showToast(playerHides ? '🏆 승리! 술래가 끝까지 못 찾았어요' : `🙈 ${petKo(hider)}의 승리 — 술래가 못 찾았다`);
            logWorldEvent(playerHides
                ? '숨바꼭질: 주인이 끝까지 안 들켰다 🏆'
                : `숨바꼭질: ${petKo(hider)}가 끝까지 안 들켰다 🏆`);
            if (playerHides) maybeProactive(seeker, '숨바꼭질에서 주인님을 끝내 못 찾았다… 분하다!');
            seeker.pet.action = { id: 'think', t: 0 };
            if (hider !== possessed) {
                await gotoAsync(hider, seeker.mover.position.x + 0.6, seeker.mover.position.z);
                hider.pet.action = { id: 'cheer', t: 0 };
            }
            await sleepMs(2400);
        }
    } finally {
        seeker.pet.setCount(null);
        seeker.pet.setExclaim(false);
        duoBusy = false;
        hideSeekGame = null;
        releaseAI(seeker);
        releaseAI(hider);
    }
}
function updateHideSeek(delta) {
    const g = hideSeekGame;
    if (!g) {
        if (Date.now() > hideSeekAutoAt) {   // 가끔 스스로 한 판: 둘 다 한가한 낮에만
            hideSeekAutoAt = Date.now() + 12 * 60000;
            const okAuto = !duoBusy && !buildMode && !possessed && pets.length >= 2
                && dayFactor(currentHour()) > 0.3 && Math.random() < 0.12
                && pets.every((q) => !q.pet.sleeping && !q.bed && !q.dip && q.ai.state !== 'held'
                    && (q.ai.state === 'idle' || q.ai.state === 'walk'));
            if (okAuto) worldHideSeek(pets[Math.floor(Math.random() * pets.length)]);
        }
        return;
    }
    // 판 접기: 술래를 조종하거나, AI 하이더를 조종하거나, 공사 모드에 들어가면.
    if (buildMode || g.seeker.ai.state === 'player' || g.seeker.ai.state === 'held') g.cancel = true;
    if (g.playerHides && g.hider !== possessed) g.cancel = true;                        // 숨던 주인이 조종을 풀었다
    if (!g.playerHides && (g.hider.ai.state === 'player' || g.hider.ai.state === 'held')) g.cancel = true;
    if (g.phase === 'count') {
        g.t += delta;
        const left = Math.max(0, Math.ceil(g.countTotal - g.t));
        if (left !== g.lastLeft) { g.lastLeft = left; g.seeker.pet.setCount(left > 0 ? left : null); }
        if (!g.seeker.pet.action && g.t < g.countTotal) g.seeker.pet.action = { id: 'think', t: 0 };   // 계속 눈 가리는 포즈
    } else if (g.phase === 'seek') {
        g.seekT += delta;
        g.losT += delta;
        if (g.losT >= 0.35) {
            g.losT = 0;
            if (canSee(g.seeker, g.hider)) g.found = true;
        }
    }
}

// The catch ball is a real scene object arcing between the pets' "hands".
const ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 16, 12),
    new THREE.MeshLambertMaterial({ color: 0xff7043 })
);
ballMesh.castShadow = true;
ballMesh.visible = false;
scene.add(ballMesh);
let ballFlight = null;   // { from, to, t, dur, arc, resolve } — advanced in animate()

function tossBall(from, to, dur = 0.56, arc = 0.5) {
    return new Promise((resolve) => { ballMesh.visible = true; ballFlight = { from, to, t: 0, dur, arc, resolve }; });
}
function handPos(p) {
    return new THREE.Vector3(
        Math.sin(p.mover.rotation.y) * 0.16,
        p.height * 0.55,
        Math.cos(p.mover.rotation.y) * 0.16
    ).add(p.mover.position);
}

async function worldPlay(initiator) {
    const partner = pets.find((q) => q !== initiator && !q.pet.sleeping && q !== possessed && !q.bed && !q.dip && q.ai.state !== 'held');
    if (!partner || duoBusy) {
        initiator.pet.action = { id: 'play', t: 0, role: 'solo', dir: 1, cue: 'ready', cueT: 0 };
        setTimeout(() => { if (initiator.pet.action && initiator.pet.action.id === 'play') initiator.pet.action = null; }, 1600);
        return;
    }
    duoBusy = true;
    try {
        const [ta, tb] = duoSpots(initiator, partner, 1.6);
        if (world.isBlocked(ta.x, ta.z) || world.isBlocked(tb.x, tb.z)) return;
        await Promise.all([gotoAsync(initiator, ta.x, ta.z), gotoAsync(partner, tb.x, tb.z)]);
        faceEachOther(initiator, partner);
        initiator.pet.action = { id: 'play', t: 0, role: 'initiator', dir: 1, cue: 'ready', cueT: 0 };
        partner.pet.action   = { id: 'play', t: 0, role: 'partner',  dir: -1, cue: 'ready', cueT: 0 };
        await sleepMs(350);
        let thrower = initiator, catcher = partner;
        for (let i = 0; i < 4; i++) {
            if (thrower.pet.action && thrower.pet.action.id === 'play') { thrower.pet.action.cue = 'throw'; thrower.pet.action.cueT = 0; }
            await sleepMs(180);                                // windup before the release
            const flight = tossBall(handPos(thrower), handPos(catcher));
            const c = catcher;
            setTimeout(() => { if (c.pet.action && c.pet.action.id === 'play') { c.pet.action.cue = 'catch'; c.pet.action.cueT = 0; } }, 330);
            await flight;
            [thrower, catcher] = [catcher, thrower];
            await sleepMs(260);
        }
        ballMesh.visible = false;
        const last = thrower;                                  // after the final swap this is the last catcher
        if (last.pet.action && last.pet.action.id === 'play') { last.pet.action.cue = 'finish'; last.pet.action.cueT = 0; }
        await sleepMs(900);
        initiator.pet.action = null; partner.pet.action = null;
        logWorldEvent('병아리와 강아지가 공놀이를 했다');
    } finally {
        ballMesh.visible = false; ballFlight = null;
        duoBusy = false; releaseAI(initiator); releaseAI(partner);
    }
}

// ---- Chat (채팅) — 월드 전용 세션 (P1/P2): the world talks to its OWN backend session
// (/api/world_chat), fully separate from the main-UI agent. Each turn ships a Korean snapshot of
// the live world state plus recent world events, so the pets genuinely KNOW their day; per-pet
// history, persona and a rolling summary live on the server. Replies are bubble-only for now
// (TTS는 나중에) and may carry inline action tags the executor below runs (<motion=..> <goto=..>
// <mount=..> <drink=..> <snack=..> <hat=..>). The responder Think-poses while the LLM generates.

// World event log (P1): notable happenings, timestamped, sent to the LLM as "최근 있었던 일".
// Ring buffer persisted across window reopens so "아까 뭐 했어?" still works after a relaunch.
const worldEvents = [];
try {
    const savedEv = JSON.parse(localStorage.getItem('world-events'));
    if (Array.isArray(savedEv)) worldEvents.push(...savedEv.filter((e) => e && e.t && e.text).slice(-40));
} catch (e) {}
function petKo(p) { return p.name === 'chick' ? '병아리' : '강아지'; }
function logWorldEvent(text) {
    worldEvents.push({ t: Date.now(), text });
    if (worldEvents.length > 120) worldEvents.splice(0, worldEvents.length - 120);   // 하루치 — 그림일기가 먹는다
    try { localStorage.setItem('world-events', JSON.stringify(worldEvents)); } catch (e) {}
}
function recentEventsText() {
    const now = Date.now();
    return worldEvents
        .filter((e) => now - e.t < 6 * 3600000)
        .slice(-8)
        .map((e) => {
            const min = Math.round((now - e.t) / 60000);
            const when = min < 1 ? '방금' : min < 60 ? `${min}분 전` : `${Math.round(min / 60)}시간 전`;
            return `- (${when}) ${e.text}`;
        })
        .join('\n');
}
// 그림일기용: 오늘(자정 이후)의 이벤트를 시각과 함께 전부.
function todayEventsText() {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    return worldEvents
        .filter((e) => e.t >= dayStart.getTime())
        .map((e) => {
            const d = new Date(e.t);
            return `- ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${e.text}`;
        })
        .join('\n');
}
function localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Spot naming (P1 스냅샷): where is (x,z), in pet-understandable Korean?
const PROP_KO = { tree: '나무', house: '집', bowl: '밥그릇', fence: '울타리', pond: '연못', sunbed: '선베드', hammock: '해먹', lamp: '가로등', radio: '라디오', coffee: '커피 부스', food: '간식 부스', swing: '그네', seesaw: '시소', monument: '베프 기념비', hugspot: '포옹 포인트', pecktree: '쪼아쪼아 나무', well: '소원 우물', capsule: '타임캡슐', boulder: '바위', cave: '동굴', lookout: '전망대', digsite: '보물 모래밭', portal: '워프 포탈', garden: '텃밭', piano: '피아노', photoboard: '사진 게시판', mailbox: '우편함', gym: '운동 공간', library: '도서관', fountain: '분수', flowerbasket: '꽃바구니', palm: '야자수', sandcastle: '모래성', boat: '보트', plane: '경비행기', balloon: '열기구', ferry: '통통호' };
function describeSpot(x, z) {
    const hf = houseFloorY(x, z);
    if (hf !== null) return hf > HOUSE.floorY + 0.3 ? '집 2층' : '집 안';
    if (onBridge(x, z)) return '다리 위';
    const cavePr = PROPS.find((q) => q.type === 'cave');
    if (cavePr && Math.hypot(x - cavePr.x, z - cavePr.z) < 1.0) return '동굴 안';
    let best = null, bestD = Infinity;
    for (const q of PROPS) {
        const d = Math.hypot(x - q.x, z - q.z) - q.r;
        if (d < bestD) { bestD = d; best = q; }
    }
    if (best && bestD < 0.8) return `${PROP_KO[best.type] || best.type} 근처`;
    if (Math.hypot(x, z) < 1.8) return '중앙 광장';
    const idx = islandOf(x, z);
    if (idx === 0) return '본섬 풀밭';
    if (idx === 1) return '북동섬 놀이터';
    if (idx === 2) return '추억의 섬';
    if (idx === 3) return '모험의 섬';
    return '바다';
}
const BED_KO = { sunbed: '선베드', hammock: '해먹', swing: '그네', seesaw: '시소', sofa: '소파', loftbed: '2층 침대' };
function petStatusLine(p) {
    const pos = p.mover.position;
    const parts = [`위치: ${describeSpot(pos.x, pos.z)}`];
    if (carDrive && carDrive.driver === p) parts.push('스포츠카 운전 중');
    else if (carDrive && carDrive.passenger === p) parts.push('스포츠카 조수석에 타는 중');
    if (boatRide && boatRide.driver === p) parts.push('보트에서 노 젓는 중');
    else if (boatRide && boatRide.passenger === p) parts.push('보트 뱃머리에 타는 중');
    else if (ferryRide && (ferryRide.p === p || ferryRide.friend === p)) parts.push(FERRY.mode === 'dwell' ? '통통호 타고 모래섬 잔교에 정박 중 ⛴️' : '통통호 타고 바다 항해 중 ⛴️');
    else if (balloonRide && balloonRide.p === p) parts.push('열기구 타고 하늘 산책 중 🎈');
    else if (balloonRide && balloonRide.friend === p) parts.push('열기구에 절친과 동승 중 🎈');
    else if (planeRide && planeRide.driver === p) parts.push(PLANE.mode === 'fly' ? '경비행기 몰고 하늘을 나는 중!' : '경비행기 활주 중');
    else if (planeRide && planeRide.passenger === p) parts.push(PLANE.mode === 'fly' ? '경비행기 뒷좌석에서 하늘 구경 중!' : '경비행기 뒷좌석에 타는 중');
    else if (p.bed && p.bedPhase === 'lying') {
        const ko = BED_KO[p.bed.id] || p.bed.id;
        parts.push(p.bed.mode === 'swing' || p.bed.mode === 'seesaw' ? `${ko} 타는 중`
            : p.bed.mode === 'sit' ? `${ko}에 앉아 있음` : `${ko}에 누워 있음`);
    }
    else if (p.swimming) parts.push(p.swimming === 'pond' ? '연못에서 수영 중' : '바다에서 수영 중');
    else if (p.dip) parts.push('물놀이 하러 가는 중');
    else if (p.eatSpot) parts.push('밥그릇에서 밥 먹는 중');
    if (fishing && fishing.p === p) parts.push('낚싯대 들고 낚시하는 중');
    else if (aiFishing && aiFishing.p === p) parts.push('물가에 앉아 혼자 낚시하는 중');
    if (p.pet.sleeping) parts.push('잠자는 중');
    if (p === possessed) parts.push('주인이 직접 조종하는 중');
    if (handHold && (handHold.partner === p || possessed === p)) parts.push('둘이 손잡고 있음');
    if (p.drink) parts.push(`${p.drink.def.name} 들고 있음`);
    if (p.food) parts.push(`${p.food.def.name} 들고 있음`);
    if (p.pet.accessory) parts.push('산타모자 착용 중');
    if (parts.length === 1) parts.push(p.ai.state === 'walk' || p.ai.state === 'goto' ? '산책 중' : '한가로이 쉬는 중');
    return parts.join(', ');
}
function buildWorldSnapshot(me) {
    const d = new Date();
    const h = currentHour();
    const dayName = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    const hh = Math.floor(h), mm = String(Math.floor((h - hh) * 60)).padStart(2, '0');
    const month = d.getMonth() + 1;
    const seasonKo = SEASONS[worldSeason()].ko;   // 수동 계절 반영 — 펫도 지금 계절을 안다
    const daypart = h < 6 ? '새벽' : h < 12 ? '아침' : h < 18 ? '낮' : h < 22 ? '저녁' : '밤';
    const wxKo = wx.type === 'storm' ? '천둥번개가 치는 중' : wx.type === 'rain' ? '비가 내리는 중' : wx.type === 'snow' ? '눈이 내리는 중'
        : auroraVis > 0.05 ? '맑음 (밤하늘에 오로라가 일렁임!)' : rainbowT > 0 ? '맑음 (무지개가 떠 있음!)' : '맑음';
    const lines = [
        `시각: ${month}월 ${d.getDate()}일 (${dayName}) ${hh}:${mm} — ${seasonKo}, ${daypart}`,
        `날씨: ${wxKo}`,
    ];
    for (const p of pets) lines.push(`${petKo(p)}${p === me ? ' (나)' : ' (절친)'} — ${petStatusLine(p)}`);
    lines.push(`주인: ${possessed ? `${petKo(possessed)}를 직접 조종하며 함께 노는 중` : '화면 밖에서 지켜보는 중'}`);
    return lines.join('\n');
}

// Reply/bubble state — one conversation in flight at a time; the pet Think-poses while waiting.
let responder = null;
let waitingReply = false;
let waitTimer = null;          // give up if the LLM never answers
let thinkTimer = null;         // keeps re-posing Think while waiting
let bubbleHideTimer = null;
let typeTimer = null;          // typewriter reveal

const bubbleEl = document.createElement('div');
bubbleEl.id = 'world-chat-bubble';
bubbleEl.style.cssText = 'position:fixed; display:none; transform:translate(-50%,-100%); max-width:280px; background:rgba(255,255,255,0.96); color:#222; font-size:13px; line-height:1.45; font-family:sans-serif; padding:8px 12px; border-radius:12px; box-shadow:0 4px 16px rgba(0,0,0,0.25); z-index:80; pointer-events:none; white-space:pre-wrap; word-break:break-word;';
document.body.appendChild(bubbleEl);
function showBubble(text) {
    if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }
    bubbleEl.textContent = text;
    bubbleEl.style.display = 'block';
    wakeSoft(4000);   // 펫이 말을 걸어오면 4초만 60fps — 대답 모션 시작이 매끄럽게 보일 만큼만
}
function showBubbleTyped(text) {
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    showBubble('');
    let i = 0;
    typeTimer = setInterval(() => {
        i += 1;
        bubbleEl.textContent = text.slice(0, i);
        if (i >= text.length) {
            clearInterval(typeTimer);
            typeTimer = null;
            hideBubbleSoon(Math.min(10000, 2600 + text.length * 55));
        }
    }, 26);
}
function hideBubbleSoon(ms = 2400) {
    if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
    bubbleHideTimer = setTimeout(() => { bubbleEl.style.display = 'none'; }, ms);
}
function updateChatBubble() {
    if (bubbleEl.style.display === 'none' || !responder) return;
    const pt = fxPoint(responder, 50, -6);        // just above the head
    bubbleEl.style.left = `${Math.round(pt.x)}px`;
    bubbleEl.style.top = `${Math.round(pt.y)}px`;
}

// Chat bar (bottom center). Enter respects Korean IME composition; clicks don't reach the canvas.
const chatBar = document.createElement('div');
chatBar.id = 'world-chat-bar';
chatBar.style.cssText = 'position:fixed; left:50%; bottom:calc(14px + env(safe-area-inset-bottom, 0px)); transform:translateX(-50%); display:flex; gap:6px; z-index:90; width:min(480px, calc(100% - 32px));';
const chatInput = document.createElement('input');
chatInput.type = 'text';
chatInput.placeholder = '펫에게 말 걸기… (병아리/강아지를 부르면 그 펫이 대답해요)';
chatInput.style.cssText = `flex:1; padding:10px 14px; border:none; border-radius:20px; background:rgba(30,32,40,0.85); color:#fff; font-size:${IS_TOUCH ? 16 : 13}px; outline:none; box-shadow:0 4px 14px rgba(0,0,0,0.25);`;   // 16px 미만이면 iOS가 포커스 시 페이지를 확대한다
const chatSend = document.createElement('button');
chatSend.textContent = '보내기';
chatSend.style.cssText = 'padding:10px 16px; border:none; border-radius:20px; background:#5b8def; color:#fff; font-size:13px; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,0.25);';
chatBar.appendChild(chatInput);
chatBar.appendChild(chatSend);
document.body.appendChild(chatBar);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendWorldChat(); e.stopPropagation(); });
// 📱 iOS: 화면 키보드가 닫힐 때 페이지가 밀려 올라간 채로 남는 일이 있어 원점으로 되돌린다.
if (IS_TOUCH) chatInput.addEventListener('blur', () => window.scrollTo(0, 0));
chatBar.addEventListener('pointerdown', (e) => e.stopPropagation());
chatSend.addEventListener('click', sendWorldChat);

// ---- Right-side dock: 📷 screenshot + 🔍 zoom buttons. Sits above the chat-bar row (bottom:70)
// with a high z-index so nothing can swallow its clicks; tap = one step, hold = glide (same eased
// zoom target the wheel drives). Keyboard +/- (and numpad) zoom too. Lamp brightness lives on the
// lamps themselves now: walk a possessed pet up to one and press Ctrl/⌘.
let heldZoom = 0;
const dockUI = document.createElement('div');
dockUI.id = 'world-dock-ui';
dockUI.style.cssText = 'position:fixed; right:14px; bottom:calc(70px + env(safe-area-inset-bottom, 0px)); display:flex; flex-direction:column; gap:6px; z-index:95; user-select:none; -webkit-user-select:none;';
function dockBtn(symbol, title) {
    const b = document.createElement('div');
    b.textContent = symbol;
    b.title = title;
    const sz = IS_TOUCH ? 48 : 40;   // 손가락 탭 타깃
    b.style.cssText = `width:${sz}px; height:${sz}px; display:flex; align-items:center; justify-content:center; background:rgba(30,32,40,0.88); color:#fff; font-size:${IS_TOUCH ? 20 : 17}px; border-radius:11px; cursor:pointer; box-shadow:0 3px 10px rgba(0,0,0,0.3);`;
    dockUI.appendChild(b);
    return b;
}
const shotBtn = dockBtn('📷', '스크린샷 (screenshots/ 폴더에 저장)');
shotBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); });
shotBtn.addEventListener('click', () => { takeScreenshot(); });
// 🌦️ 날씨 설정 (카메라 아래): 패널에서 고르면 그 날씨로 고정 — WEATHER_CHOICES에 추가하면 메뉴에 뜬다.
const weatherBtn = dockBtn('🌦️', '날씨 설정');
const weatherPanel = document.createElement('div');
weatherPanel.style.cssText = 'position:fixed; right:calc(70px + env(safe-area-inset-right, 0px)); display:none; z-index:96; background:rgba(30,32,40,0.93); border-radius:12px; box-shadow:0 8px 28px rgba(0,0,0,0.4); font-family:sans-serif; padding:5px; flex-direction:column; gap:3px; max-height:min(62vh, 430px); overflow-y:auto; overscroll-behavior:contain;';
const weatherRows = WEATHER_CHOICES.map((c) => {
    const row = document.createElement('button');
    row.textContent = `${c.icon} ${c.label}`;
    row.style.cssText = `border:none; border-radius:8px; color:#fff; font-size:${IS_TOUCH ? 13.5 : 12}px; padding:${IS_TOUCH ? 7 : 5}px 12px; cursor:pointer; text-align:left; white-space:nowrap; flex-shrink:0; background:rgba(255,255,255,0.08);`;
    row.addEventListener('click', () => {
        setManualWeather(c.id);
        syncWeatherRows();
        showToast(c.toast);
        weatherPanel.style.display = 'none';
    });
    weatherPanel.appendChild(row);
    return row;
});
function syncWeatherRows() {
    WEATHER_CHOICES.forEach((c, i) => { weatherRows[i].style.background = manualWx === c.id ? '#5b8def' : 'rgba(255,255,255,0.08)'; });
}
// 계절 줄 (같은 패널, 구분선 아래): 자동(달력) 또는 수동 고정 — 고르면 2.5초 크로스페이드.
const seasonDivider = document.createElement('div');
seasonDivider.style.cssText = 'height:1px; background:rgba(255,255,255,0.16); margin:3px 4px;';
weatherPanel.appendChild(seasonDivider);
const SEASON_CHOICES = [{ id: null, icon: '🔄', label: '계절 자동' }].concat(
    Object.keys(SEASONS).map((id) => ({ id, icon: SEASONS[id].icon, label: SEASONS[id].ko }))
);
const seasonRows = SEASON_CHOICES.map((c) => {
    const row = document.createElement('button');
    row.textContent = `${c.icon} ${c.label}`;
    row.style.cssText = `border:none; border-radius:8px; color:#fff; font-size:${IS_TOUCH ? 13.5 : 12}px; padding:${IS_TOUCH ? 7 : 5}px 12px; cursor:pointer; text-align:left; white-space:nowrap; flex-shrink:0; background:rgba(255,255,255,0.08);`;
    row.addEventListener('click', () => {
        setManualSeason(c.id);
        syncSeasonRows();
        showToast(c.id ? `${c.icon} 계절: ${c.label}` : '🔄 계절 자동 — 달력을 따라가요');
        weatherPanel.style.display = 'none';
    });
    weatherPanel.appendChild(row);
    return row;
});
function syncSeasonRows() {
    SEASON_CHOICES.forEach((c, i) => { seasonRows[i].style.background = manualSeason === c.id ? '#5b8def' : 'rgba(255,255,255,0.08)'; });
}
document.body.appendChild(weatherPanel);
weatherPanel.addEventListener('pointerdown', (e) => e.stopPropagation());
weatherBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); });
weatherBtn.addEventListener('click', () => {
    const open = weatherPanel.style.display === 'none';
    if (open) {
        const btnBottom = weatherBtn.getBoundingClientRect().bottom;
        weatherPanel.style.bottom = `${Math.max(8, window.innerHeight - btnBottom)}px`;
        weatherPanel.style.maxHeight = `${Math.max(160, btnBottom - 12)}px`;   // 창 천장을 뚫지 않게 — 넘치면 스크롤
        syncWeatherRows();
        syncSeasonRows();
    }
    weatherPanel.style.display = open ? 'flex' : 'none';
});
const ecoBtn = dockBtn('⚡', '절전 모드 — 30fps·1.5x 해상도 (배터리에선 자동)');
const syncEcoBtn = () => { ecoBtn.style.opacity = ecoMode ? '0.5' : '1'; };
syncEcoBtn();
ecoBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); });
ecoBtn.addEventListener('click', () => {
    ecoMode = !ecoMode;
    localStorage.setItem('world-eco', ecoMode ? '1' : '0');
    applyPixelRatio();
    syncEcoBtn();
    showToast(ecoMode ? '⚡ 절전 모드 — 30fps · 1.5x 해상도' : '✨ 고품질 모드 — 60fps · 풀 해상도');
});
// 📊 개발용 렌더 계측 (⚡ 더블클릭 또는 ?stats=1): fps · 드로우콜 · 트라이앵글 · 씬 오브젝트 수.
// 최적화 전/후를 숫자로 비교하는 용도 — renderFrame()이 0.5초마다 채운다.
const statsEl = document.createElement('div');
statsEl.style.cssText = 'position:fixed; left:10px; top:8px; z-index:99; display:none; background:rgba(20,22,28,0.75); color:#9fe8a0; font:11px/1.5 monospace; padding:5px 9px; border-radius:8px; pointer-events:none; white-space:pre;';
document.body.appendChild(statsEl);
let statsOn = false;
try { statsOn = new URLSearchParams(location.search).get('stats') === '1'; } catch (e) {}
if (statsOn) statsEl.style.display = 'block';
// ?stats=1 전용 계측 훅 — perf 프로브가 토스트 웨이크(잠깐 60fps 후 복귀)와 장기 idle
// (ageInput으로 마지막 입력 시각을 과거로 밀어 60초 대기 없이 15fps 티어 진입)을 재현할 때 쓰고,
// scene은 draw call 브레이크다운 집계용, season은 계절 전환(베이크 훅·겨울 스킨) 자동 검증용이다.
if (statsOn) window.__worldDev = {
    toast: (m) => showToast(m),
    ageInput: (ms) => { lastInputMs = performance.now() - ms; },
    scene,
    season: (id) => setManualSeason(id),
    // 펫 몸통의 화면 좌표 — 스모크의 우클릭 프로브가 격자 스캔(위치 랜덤) 대신 정확히 조준한다
    petScreenXY: () => pets.map((p) => { const a = fxPoint(p, 50, 45); return { x: Math.round(a.x), y: Math.round(a.y) }; }),
    fishState: () => (fishing ? fishing.state : null),   // 낚시 헤드리스 검증용
    aiFishState: () => (aiFishing ? aiFishing.state : null),   // 절친 자율 낚시 검증용
    wrapDrift: () => (possessed ? +(possessed.pet.wrap.rotation.y - Math.PI).toFixed(4) : null),   // 몸 비틀림 누적 감시 (기준 π)
    planeState: () => ({ mode: PLANE.mode, x: +PLANE.x.toFixed(2), z: +PLANE.z.toFixed(2), y: +PLANE.y.toFixed(2), vel: +PLANE.vel.toFixed(2), riding: !!planeRide, passenger: !!(planeRide && planeRide.passenger) }),
    groundAt: (x, z) => +world.groundHeightAt(x, z).toFixed(3),    // 지형 프로브 (배치·활주로 검증용)
    petPos: (name) => { const q = pets.find((o) => o.name === name); return q ? { x: +q.mover.position.x.toFixed(2), y: +q.mover.position.y.toFixed(2), z: +q.mover.position.z.toFixed(2) } : null; },
    planeSummon: () => { summonPlanePassenger(); return !!planeHop; },   // 절친 뒷좌석 소환 (E2E)
    balloonState: () => ({ mode: BALLOON.mode, x: +BALLOON.x.toFixed(2), y: +BALLOON.y.toFixed(2), z: +BALLOON.z.toFixed(2), riding: !!balloonRide, rider: balloonRide && balloonRide.p ? balloonRide.p.name : null, friend: balloonRide && balloonRide.friend ? balloonRide.friend.name : null, lap: balloonRide ? balloonRide.lap : 0, pois: balloonRide && balloonRide.route ? balloonRide.route.names.length : 0 }),
    balloonSummon: () => { summonBalloonFriend(); return !!balloonHop; },   // 이륙 직후 절친 소환 (E2E)
    ferryState: () => ({ mode: FERRY.mode, x: +FERRY.x.toFixed(2), z: +FERRY.z.toFixed(2), u: +FERRY.u.toFixed(3), riding: !!ferryRide, rider: ferryRide && ferryRide.p ? ferryRide.p.name : null, friend: ferryRide && ferryRide.friend ? ferryRide.friend.name : null, dwellT: +FERRY.dwellT.toFixed(1) }),
    ferrySummon: () => { summonFerryFriend(); return !!ferryHop; },
    callFriend: () => { startPhoneCall(); return !!phoneCall; },
    shellState: () => ({ alive: shells.length, spots: shells.map((sh) => ({ t: sh.t.id, x: +sh.x.toFixed(2), z: +sh.z.toFixed(2) })), counts: shellCounts() }),
    shellSpawn: () => trySpawnShell(true),
    gotoFriend: () => { teleportToFriend(); return true; },
    social: () => ({
        calling: !!phoneCall,
        hand: !!handHold,
        gap: pets.length >= 2 ? +Math.hypot(pets[0].mover.position.x - pets[1].mover.position.x, pets[0].mover.position.z - pets[1].mover.position.z).toFixed(2) : null,
    }),
    buildMove: (id, x, z, rotY) => {   // 🔨 공사 이동 대행 (E2E) — canPlace 검사 포함
        const q = PROPS.find((o) => o.layoutId === id);
        if (!q) return 'none';
        if (!canPlace(q, x, z)) return 'blocked';
        applyPropMove(q, x, z, Number.isFinite(rotY) ? rotY : (q.rotY || 0));
        saveLayout();
        return 'ok';
    },
    vehicles: () => ({
        car: { x: +CAR.x.toFixed(2), z: +CAR.z.toFixed(2) },
        boat: { x: +BOAT.x.toFixed(2), z: +BOAT.z.toFixed(2) },
        plane: { x: +PLANE.x.toFixed(2), z: +PLANE.z.toFixed(2) },
        balloon: { x: +BALLOON_HOME.x.toFixed(2), z: +BALLOON_HOME.z.toFixed(2) },
        ferry: { x: +FERRY.x.toFixed(2), z: +FERRY.z.toFixed(2) },
    }),
    ferryAiStart: () => {
        const q = pets.find((o) => o !== possessed && !o.bed && !o.dip && !o.pet.sleeping && !o.swimming);
        if (!q) return 'busy';
        startAiFerry(q);
        return aiFerryWalk ? 'ok' : `fail(mode=${FERRY.mode},ride=${!!ferryRide})`;
    },
    balloonAiStart: () => {   // 'ok' | 'busy' | fail(원인)
        const q = pets.find((o) => o !== possessed && !o.bed && !o.dip && !o.pet.sleeping);
        if (!q) return 'busy';
        startAiBalloon(q);
        return aiBalloonWalk ? 'ok' : `fail(mode=${BALLOON.mode},ride=${!!balloonRide},walk=${!!aiBalloonWalk},st=${q.ai.state})`;
    },
    planeTp: (x, z, h) => {   // 비행기 순간이동 (E2E — 절벽 활주 등 시나리오 배치용)
        PLANE.x = x; PLANE.z = z;
        if (Number.isFinite(h)) PLANE.heading = h;
        PLANE.y = planeSupportY(x, z);
        PLANE.vel = 0;
        planeCollider.x = x; planeCollider.z = z;
        return window.__worldDev.planeState();
    },
    interact: () => doInteract(),                                  // 헤드리스 ⌘ 대행
    who: () => (possessed ? possessed.name : null),                // 빙의 대상 (E2E 진단)
    devKey: (k, on) => { if (on) heldKeys.add(k); else heldKeys.delete(k); return [...heldKeys]; },   // 조종 키 주입
    aiFishSnap: () => {   // 자율 낚시 도보 생략 — E2E가 먼 섬 출발(1~2분 도보)에 좌우되지 않게
        if (!aiFishing || !aiFishing.p.ai.target) return false;
        aiFishing.p.mover.position.x = aiFishing.p.ai.target.x;
        aiFishing.p.mover.position.z = aiFishing.p.ai.target.z;
        aiFishing.p.ai.waypoints = [aiFishing.p.ai.target];
        return true;
    },
    aiFishDebug: () => (aiFishing ? { st: aiFishing.state, ai: aiFishing.p.ai.state, began: !!aiFishing.began, arr: aiFishing.p.ai.onArrive === aiFishing.ownArrive, x: +aiFishing.p.mover.position.x.toFixed(2), z: +aiFishing.p.mover.position.z.toFixed(2), tgt: aiFishing.p.ai.target, wp: aiFishing.p.ai.waypoints ? aiFishing.p.ai.waypoints.length : 0, stall: +(aiFishing.p.ai.stall || 0).toFixed(1) } : null),
    startAiFish: () => {   // 한가한 펫 골라 자율 낚시 발동 — 'ok' | 'busy'(전원 딴짓) | 'fail'
        const q = pets.find((p) => p !== possessed && !p.bed && !p.dip && !p.pet.sleeping);
        if (!q) return 'busy';
        startAiFishing(q);
        return aiFishing ? 'ok' : 'fail';
    },
    fishdexOpen: () => { toggleFishdex(); return dexUI.panel.style.display; },
    tp: (x, z, rotY) => {   // 조종 펫 순간이동 — 헤드리스 테스트가 소품 미로를 건너뛰게
        if (!possessed) return;
        possessed.mover.position.set(x, world.groundHeightAt(x, z), z);
        if (Number.isFinite(rotY)) possessed.mover.rotation.y = rotY;
    },
    castAt: (x, z) => {   // 좌표 직접 캐스팅 — 입질~랜딩 플로우 검증용 (클릭 해석과 분리)
        if (fishing && fishing.state === 'idle') startCast(fishing, { x, z, water: islandOf(x, z) < 0 ? 'sea' : 'pond' });
    },
    aim: (sx, sy) => {   // 화면 좌표의 캐스팅 해석 결과 — 클릭 밴드 진단용
        pointerNdc.set((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
        raycaster.setFromCamera(pointerNdc, camera);
        if (!fishing || fishing.state !== 'idle') return 'no-rod';
        const before = fishing.state;
        const r = tryCastAtScreen();
        if (r === 'cast') { cancelFishing(true); }   // 진단이 실제 캐스팅을 남기지 않게 즉시 회수
        return r + (before !== 'idle' ? '?' : '');
    },
};
ecoBtn.addEventListener('dblclick', () => {
    statsOn = !statsOn;
    statsEl.style.display = statsOn ? 'block' : 'none';
});
// 💬 대화 기록 패널: 이 세션의 월드 대화 로그 + 펫별 서버 기억 초기화. 독 왼쪽에 뜬다.
const chatLogPanel = document.createElement('div');
chatLogPanel.style.cssText = 'position:fixed; right:calc(70px + env(safe-area-inset-right, 0px)); bottom:calc(70px + env(safe-area-inset-bottom, 0px)); display:none; z-index:94; width:min(300px, calc(100vw - 100px)); max-height:46vh; background:rgba(30,32,40,0.93); border-radius:14px; box-shadow:0 8px 28px rgba(0,0,0,0.4); font-family:sans-serif; color:#fff; flex-direction:column; overflow:hidden;';
const chatLogHead = document.createElement('div');
chatLogHead.style.cssText = 'display:flex; align-items:center; gap:6px; padding:8px 10px; font-size:12px; background:rgba(255,255,255,0.06);';
const chatLogTitle = document.createElement('span');
chatLogTitle.textContent = '💬 월드 대화';
chatLogTitle.style.cssText = 'flex:1;';
chatLogHead.appendChild(chatLogTitle);
// 기억 초기화 — 파괴적 동작이라 헤더의 탭처럼 보이던 자리에서 하단 구석으로 내렸다. OS의
// confirm()은 렌더 루프까지 멈추는 차단 다이얼로그라(월드가 통째로 얼어붙음) 인페이지 2단
// 확인으로 교체: 한 번 누르면 버튼이 빨갛게 "정말요?"로 바뀌고, 2.5초 안에 다시 누르면 실행.
function memResetBtn(petId, label) {
    const b = document.createElement('button');
    b.title = `${label}의 대화 기억(서버 세션)을 완전히 초기화`;
    b.style.cssText = 'border:none; border-radius:8px; color:#fff; font-size:11px; padding:4px 9px; cursor:pointer; white-space:nowrap;';
    const idle = () => { b.textContent = label; b.style.background = 'rgba(255,255,255,0.1)'; delete b.dataset.arm; };
    idle();
    let armTimer = null;
    b.onclick = async () => {
        if (!b.dataset.arm) {
            b.dataset.arm = '1';
            b.textContent = '정말요? 다시 탭';
            b.style.background = '#c0504d';
            clearTimeout(armTimer);
            armTimer = setTimeout(idle, 2500);
            return;
        }
        clearTimeout(armTimer);
        idle();
        try {
            const res = await fetch('/api/world_chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pet: petId, reset: true }) });
            if (!res.ok) throw new Error(String(res.status));
            if (responder && responder.name === petId) responder = null;   // 이름 생략 시 이어받던 연속성도 리셋
            pushChatLog('system', `— 🧹 ${label}의 기억이 초기화됐어요 —`);
            showToast(`🧹 ${label}의 기억을 비웠어요`);
        } catch (e) { showToast('초기화 실패 — 백엔드 연결을 확인해줘'); }
    };
    return b;
}
chatLogPanel.appendChild(chatLogHead);
const chatLogBody = document.createElement('div');
chatLogBody.style.cssText = 'overflow-y:auto; padding:8px 10px; display:flex; flex-direction:column; gap:6px; font-size:12px; line-height:1.45; flex:1;';
chatLogPanel.appendChild(chatLogBody);
const chatLogFoot = document.createElement('div');
chatLogFoot.style.cssText = 'display:flex; align-items:center; gap:6px; padding:7px 10px; font-size:11px; color:#99a; background:rgba(255,255,255,0.04);';
const chatLogFootLabel = document.createElement('span');
chatLogFootLabel.textContent = '🧹 기억 초기화:';
chatLogFootLabel.style.cssText = 'flex:1;';
chatLogFoot.appendChild(chatLogFootLabel);
chatLogFoot.appendChild(memResetBtn('chick', '병아리'));
chatLogFoot.appendChild(memResetBtn('puppy', '강아지'));
// 💾 백업/복원 — 배치·소원·일기·기억을 zip 하나로 (맥 교체·재설치 대비)
const bkBtn = document.createElement('button');
bkBtn.textContent = '💾';
bkBtn.title = '월드 데이터 백업 (zip 다운로드)';
bkBtn.style.cssText = 'border:none; border-radius:8px; background:rgba(255,255,255,0.1); color:#fff; font-size:11px; padding:4px 8px; cursor:pointer;';
bkBtn.onclick = () => { location.href = '/api/world_backup'; };
chatLogFoot.appendChild(bkBtn);
const rsInput = document.createElement('input');
rsInput.type = 'file';
rsInput.accept = '.zip';
rsInput.style.display = 'none';
document.body.appendChild(rsInput);
const rsBtn = document.createElement('button');
rsBtn.textContent = '📥';
rsBtn.title = '백업 zip에서 복원';
rsBtn.style.cssText = bkBtn.style.cssText;
rsBtn.onclick = () => rsInput.click();
rsInput.onchange = async () => {
    const f = rsInput.files && rsInput.files[0];
    rsInput.value = '';
    if (!f) return;
    try {
        const res = await fetch('/api/world_backup', { method: 'POST', body: f });
        const j = await res.json();
        showToast(j && j.ok ? `📥 ${j.restored}개 파일 복원 — 새로고침하면 적용돼요` : `복원 실패: ${(j && j.error) || res.status}`);
    } catch (e) { showToast('복원 실패 — 백엔드 연결을 확인해줘'); }
};
chatLogFoot.appendChild(rsBtn);
chatLogPanel.appendChild(chatLogFoot);
document.body.appendChild(chatLogPanel);
chatLogPanel.addEventListener('pointerdown', (e) => e.stopPropagation());
function pushChatLog(who, text) {
    const row = document.createElement('div');
    if (who === 'system') {   // 구분선 느낌의 시스템 안내 (기억 초기화 등)
        row.style.cssText = 'align-self:center; color:#99a; font-size:11px; padding:2px 0; text-align:center;';
        row.textContent = text;
        chatLogBody.appendChild(row);
        chatLogBody.scrollTop = chatLogBody.scrollHeight;
        return;
    }
    const mine = who === '주인';
    row.style.cssText = `max-width:92%; padding:6px 9px; border-radius:10px; white-space:pre-wrap; word-break:break-word; align-self:${mine ? 'flex-end' : 'flex-start'}; background:${mine ? '#5b8def' : 'rgba(255,255,255,0.1)'};`;
    row.textContent = mine ? text : `${who}: ${text}`;
    chatLogBody.appendChild(row);
    while (chatLogBody.children.length > 60) chatLogBody.removeChild(chatLogBody.firstChild);
    chatLogBody.scrollTop = chatLogBody.scrollHeight;
}
const logBtn = dockBtn('💬', '월드 대화 기록 · 기억 초기화');
logBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); });
logBtn.addEventListener('click', () => {
    const open = chatLogPanel.style.display === 'none';
    chatLogPanel.style.display = open ? 'flex' : 'none';
    if (open) chatLogBody.scrollTop = chatLogBody.scrollHeight;
});
// 📔 그림일기: 하루의 이벤트 로그를 펫이 1인칭 일기로 접어 서버(config/world_diary.json)에
// 보관한다. 밤 10시가 넘으면 그날의 일기를 스스로 쓰고, ✍️ 버튼으로 먼저 쓰게 할 수도 있다.
// 종이 노트 스타일 패널: ◀ 날짜 ▶ 넘기기 + 🐤/🐶 탭.
const diaryBtn = dockBtn('📔', '그림일기 — 펫이 쓴 오늘 하루');
const diaryPanel = document.createElement('div');
diaryPanel.style.cssText = 'position:fixed; right:calc(70px + env(safe-area-inset-right, 0px)); bottom:calc(70px + env(safe-area-inset-bottom, 0px)); display:none; z-index:95; width:min(330px, calc(100vw - 100px)); max-height:62vh; background:#fbf3e2; color:#4a3f30; border-radius:14px; box-shadow:0 8px 28px rgba(0,0,0,0.4); font-family:sans-serif; flex-direction:column; overflow:hidden;';
const diaryHead = document.createElement('div');
diaryHead.style.cssText = 'display:flex; align-items:center; gap:6px; padding:9px 10px; font-size:13px; font-weight:700; background:rgba(120,90,50,0.12);';
const diaryBody = document.createElement('div');
diaryBody.style.cssText = 'padding:12px 14px; font-size:13px; line-height:23px; white-space:pre-wrap; word-break:break-word; overflow-y:auto; min-height:92px; background:repeating-linear-gradient(transparent, transparent 22px, rgba(160,130,90,0.22) 22px, rgba(160,130,90,0.22) 23px);';
const diaryFoot = document.createElement('div');
diaryFoot.style.cssText = 'display:flex; gap:6px; padding:8px 10px; background:rgba(120,90,50,0.1);';
diaryPanel.append(diaryHead, diaryBody, diaryFoot);
document.body.appendChild(diaryPanel);
diaryPanel.addEventListener('pointerdown', (e) => e.stopPropagation());
const mkDiaryBtn = (label) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'border:none; background:rgba(120,90,50,0.15); color:#4a3f30; border-radius:7px; font-size:12px; padding:3px 8px; cursor:pointer;';
    return b;
};
const diaryPrev = mkDiaryBtn('◀'), diaryNext = mkDiaryBtn('▶');
const diaryDateEl = document.createElement('div');
diaryDateEl.style.cssText = 'flex:1; text-align:center;';
const diaryTabChick = mkDiaryBtn('🐤'), diaryTabPuppy = mkDiaryBtn('🐶');
diaryHead.append('📔', diaryPrev, diaryDateEl, diaryNext, diaryTabChick, diaryTabPuppy);
const diaryWriteBtn = document.createElement('button');
diaryWriteBtn.style.cssText = 'flex:1; border:none; border-radius:8px; background:#e8b04b; color:#3d2f18; font-weight:700; font-size:12.5px; padding:7px 0; cursor:pointer;';
diaryFoot.appendChild(diaryWriteBtn);
let diaryData = {};              // 서버 저장본 { 'YYYY-MM-DD': { chick: {text, mood, ts}, puppy: {...} } }
let diaryDate = localDateStr();
let diaryPet = 'chick';
let diaryBusy = false;
function diaryDates() {
    const set = new Set(Object.keys(diaryData));
    set.add(localDateStr());
    return [...set].sort();
}
function renderDiary() {
    const dates = diaryDates();
    const i = dates.indexOf(diaryDate);
    diaryPrev.style.opacity = i <= 0 ? '0.35' : '1';
    diaryNext.style.opacity = i >= dates.length - 1 ? '0.35' : '1';
    diaryDateEl.textContent = diaryDate.replace(/-/g, '.');
    diaryTabChick.style.background = diaryPet === 'chick' ? '#e8b04b' : 'rgba(120,90,50,0.15)';
    diaryTabPuppy.style.background = diaryPet === 'puppy' ? '#e8b04b' : 'rgba(120,90,50,0.15)';
    const entry = (diaryData[diaryDate] || {})[diaryPet];
    const today = diaryDate === localDateStr();
    if (diaryBusy) diaryBody.textContent = '✍️ 일기 쓰는 중…';
    else if (entry) diaryBody.textContent = entry.text;
    else diaryBody.textContent = today ? '아직 오늘 일기를 안 썼어요.\n(밤 10시가 지나면 스스로 써요)' : '이 날의 일기가 없어요.';
    diaryWriteBtn.textContent = entry ? '✍️ 오늘 일기 다시 쓰기' : '✍️ 지금 일기 쓰기';
    const canWrite = !diaryBusy && today && pets.length > 0;
    diaryWriteBtn.disabled = !canWrite;
    diaryWriteBtn.style.opacity = canWrite ? '1' : '0.45';
}
diaryPrev.onclick = () => { const d = diaryDates(); const i = d.indexOf(diaryDate); if (i > 0) { diaryDate = d[i - 1]; renderDiary(); } };
diaryNext.onclick = () => { const d = diaryDates(); const i = d.indexOf(diaryDate); if (i < d.length - 1) { diaryDate = d[i + 1]; renderDiary(); } };
diaryTabChick.onclick = () => { diaryPet = 'chick'; renderDiary(); };
diaryTabPuppy.onclick = () => { diaryPet = 'puppy'; renderDiary(); };
async function fetchDiary() {
    try {
        const res = await fetch('/api/world_diary');
        if (res.ok) diaryData = (await res.json()) || {};
    } catch (e) {}
}
async function writeDiary(petName, force = false, silent = false) {
    const me = pets.find((q) => q.name === petName);
    const events = todayEventsText();
    if (!me || !events) {
        if (!silent) showToast('📔 오늘은 아직 일기에 쓸 만한 일이 없어요');
        return;
    }
    diaryBusy = true;
    renderDiary();
    try {
        const res = await fetch('/api/world_diary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pet: petName, date: localDateStr(), events, snapshot: buildWorldSnapshot(me), force }),
        });
        if (!res.ok) throw new Error(await res.text());
        const entry = await res.json();
        (diaryData[localDateStr()] = diaryData[localDateStr()] || {})[petName] = entry;
    } catch (e) {
        console.error('[World] diary write failed', e);
        if (!silent) showToast('📔 일기 쓰기에 실패했어요 — 잠시 후 다시');
    } finally {
        diaryBusy = false;
        renderDiary();
    }
}
diaryWriteBtn.onclick = () => {
    if (diaryWriteBtn.disabled) return;
    writeDiary(diaryPet, !!(diaryData[diaryDate] || {})[diaryPet]);
};
diaryBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); });
diaryBtn.addEventListener('click', () => {
    const open = diaryPanel.style.display === 'none';
    if (open) {
        diaryDate = localDateStr();
        renderDiary();
        fetchDiary().then(renderDiary);
    }
    diaryPanel.style.display = open ? 'flex' : 'none';
});
// 밤 10시가 넘으면 하루 한 번, 두 펫이 나란히 그날의 일기를 쓴다 (animate가 부른다).
function maybeAutoDiary() {
    if (currentHour() < 22.05) return;
    const today = localDateStr();
    try { if (localStorage.getItem('world-diary-auto') === today) return; } catch (e) {}
    try { localStorage.setItem('world-diary-auto', today); } catch (e) {}
    if (!todayEventsText() || !pets.length) return;
    (async () => {
        for (const p of pets) await writeDiary(p.name, false, true);   // 순차 — LLM 호출이 겹치지 않게
        logWorldEvent('오늘의 그림일기를 썼다 📔');
    })();
}
function bindZoomBtn(b, dir) {
    b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        camZoom(dir < 0 ? 0.8 : 1.25);
        heldZoom = dir;
        try { b.setPointerCapture(e.pointerId); } catch (err) {}
    });
    const stop = () => { heldZoom = 0; };
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointercancel', stop);
    b.addEventListener('lostpointercapture', stop);
}
const buildBtn = dockBtn('🔨', '공사 모드 — 사물 옮기기');
const syncBuildBtn = () => { buildBtn.style.background = buildMode ? 'rgba(214,150,52,0.92)' : 'rgba(30,32,40,0.88)'; };
buildBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); });
buildBtn.addEventListener('click', () => setBuildMode(!buildMode));
// 🐤🐶 펫 바로가기: 누르면 카메라가 그 펫에게 날아가며(팔로우 캠) 즉시 조종 시작 — 같은 버튼을
// 다시 누르면 해제. 다른 펫 조종 중에 누르면 그 펫으로 갈아탄다.
function possessByName(name) {
    const p = pets.find((q) => q.name === name);
    if (!p) return;
    if (possessed === p) { escapeAction(); return; }   // 토글 해제 (메뉴·패널 정리 포함)
    if (buildMode) setBuildMode(false);                // 공사 중이면 저장하고 나와서 조종
    possessPet(p);
}
const chickBtn = dockBtn('🐤', '병아리 조종하기 — 다시 누르면 해제');
chickBtn.onclick = () => possessByName('chick');
const puppyBtn = dockBtn('🐶', '강아지 조종하기 — 다시 누르면 해제');
puppyBtn.onclick = () => possessByName('puppy');
const fishBtn = dockBtn('🎣', '낚싯대 들기/정리 — 물을 클릭해 캐스팅, 찌가 푹 잠기면 ⌘/Space 챔질');
fishBtn.onclick = () => equipFishing();
const dexBtn = dockBtn('🐟', '물고기 도감 — 잡은 어종 컬렉션');
dexBtn.onclick = () => toggleFishdex();
bindZoomBtn(dockBtn('＋', '확대 (키보드 + 키)'), -1);
bindZoomBtn(dockBtn('－', '축소 (키보드 - 키)'), 1);
document.body.appendChild(dockUI);

// ---- 🔨 공사 모드 (동물의 숲식 사물 옮기기): 사물을 누르면 집어 들고(살짝 떠오름), 끌어서
// 원하는 곳에 놓는다. 링이 초록(놓기 가능)/빨강(겹침·물·섬 밖)으로 판정을 보여주고, 놓으면
// 콜라이더·침대/그네/시소 좌표·블롭 그림자·램프 불빛이 함께 이사한다(bakePropBeds 재사용).
// 배치는 서버(/api/world_layout)+localStorage에 저장되고 다음 접속 때 씬을 짓기 전에 적용된다
// (파일 상단 savedLayout). 지형 평탄화 패드는 섬 메시에 구워져 있어 리로드 후에야 새 위치를
// 따라간다 — 그때까지 잔디가 살짝 울퉁불퉁할 수 있는 게 유일한 시각적 타협점.
const PROP_LABELS = { tree: '나무', bowl: '밥그릇', fence: '울타리', sunbed: '선베드', hammock: '해먹', lamp: '가로등', radio: '라디오', coffee: '커피 부스', food: '간식 부스', swing: '그네', seesaw: '시소', house: '집', car: '자동차' };
const buildRingMat = new THREE.MeshBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
const buildRing = new THREE.Mesh(new THREE.RingGeometry(0.82, 1.0, 40), buildRingMat);
buildRing.rotation.x = -Math.PI / 2;
buildRing.visible = false;
scene.add(buildRing);
const effR = (q) => (q.type === 'house' ? 1.25 : q.type === 'car' ? 0.55 : Math.max(q.r || 0, 0.22));
function positionBuildRing(p) {
    if (!p) { buildRing.visible = false; return; }
    buildRing.visible = true;
    buildRing.scale.setScalar(effR(p) + 0.3);
    buildRing.position.set(p.x, terrainHeight(p.x, p.z) + 0.02, p.z);
}
function canPlace(p, x, z) {
    const pr = effR(p);
    if (p.type === 'boat') {   // 🚣 보트: 열린 물 (선석·잔교·통통호·비행기와 간섭 금지)
        if (islandOf(x, z) >= 0 || onBridge(x, z) || Math.hypot(x, z) > 18) return false;
        if (Math.hypot(x - FERRY.x, z - FERRY.z) < 1.6 || window.__nearFerryPier(x, z, 1.1)) return false;
        if (Math.hypot(x - PLANE.x, z - PLANE.z) < 1.6) return false;
        return true;
    }
    if (p.type === 'plane') {   // 🛩️ 비행기: 뭍이든 물이든 (수륙양용)
        if (Math.hypot(x, z) > 19.5) return false;
        if (Math.hypot(x - FERRY.x, z - FERRY.z) < 1.8 || window.__nearFerryPier(x, z, 1.3)) return false;
        if (Math.hypot(x - BOAT.x, z - BOAT.z) < 1.5) return false;
        if (islandOf(x, z) < 0 && !onBridge(x, z)) return true;   // 물 위는 자유
        // 뭍이면 아래 공용 소품 간섭 검사로 합류
    }
    // 섬 안(가장자리 여유 포함)이어야 하고 — 다리 위·바다는 불가
    if (p.type !== 'plane' && !ISLANDS.some((isl) => Math.hypot(x - isl.x, z - isl.z) < isl.r - Math.min(pr * 0.6, 0.5) - 0.12)) return false;
    for (const q of PROPS) {
        if (q === p) continue;
        if (p.type === 'house' && q.type === 'furniture') continue;   // 집 안 가구는 집과 한 몸
        const qr = q.type === 'house' ? 1.25 : (q.r || 0);
        if (!qr) continue;
        if (Math.hypot(x - q.x, z - q.z) < (pr + qr) * 0.8) return false;
    }
    return true;
}
// 드래그 중: 그룹·블롭·불빛만 가볍게 따라오고(살짝 든 채), 좌표 파생물(침대 등)은 놓을 때 굽는다.
function movePropVisual(p, x, z) {
    p.x = x; p.z = z;
    const gy = terrainHeight(x, z);
    if (p.type === 'car') { CAR.x = x; CAR.z = z; carGroup.position.set(x, gy + 0.14, z); }
    else if (p.type === 'boat') { BOAT.x = x; BOAT.z = z; boatGroup.position.set(x, waveYAt(x, z) + 0.1, z); }
    else if (p.type === 'plane') { PLANE.x = x; PLANE.z = z; planeCollider.x = x; planeCollider.z = z; planeGroup.position.set(x, planeSupportY(x, z) + 0.1, z); }
    else if (p.type === 'balloon') { moveBalloonHome(x, z); balloonGroup.position.set(x, balloonDockY + 0.1, z); }
    else p.obj.position.set(x, gy + 0.14, z);
    if (p.blob) p.blob.position.set(x, gy + 0.012, z);
    if (p.lampLight) { p.lampLight.position.set(x, gy + 0.95, z); p.lampHalo.position.copy(p.lampLight.position); }
    positionBuildRing(p);
}
function applyPropMove(p, x, z, rotY) {
    p.x = x; p.z = z;
    const gy = terrainHeight(x, z);
    if (p.type === 'car') {
        CAR.x = x; CAR.z = z; CAR.heading = rotY;
        carGroup.position.set(x, world.groundHeightAt(x, z), z);
        carGroup.rotation.y = rotY;
    } else if (p.type === 'boat') {
        BOAT.x = x; BOAT.z = z;
        if (Number.isFinite(rotY)) BOAT.heading = rotY;
        boatGroup.position.set(x, waveYAt(x, z) + 0.02, z);
        boatGroup.rotation.y = BOAT.heading;
    } else if (p.type === 'plane') {
        PLANE.x = x; PLANE.z = z;
        if (Number.isFinite(rotY)) PLANE.heading = rotY;
        PLANE.y = planeSupportY(x, z);
        planeCollider.x = x; planeCollider.z = z;
        planeGroup.position.set(x, PLANE.y, z);
        planeGroup.rotation.set(0, PLANE.heading, 0);
    } else if (p.type === 'balloon') {
        moveBalloonHome(x, z);   // 회전 없음 — 계류장째 이사
    } else {
        p.rotY = rotY;
        p.obj.position.set(x, gy, z);
        p.obj.rotation.y = rotY;
        if (p.type === 'house') { HOUSE.x = x; HOUSE.z = z; refreshHouseDerived(); }
        if (p.bedEntries) { unbakePropBeds(p); bakePropBeds(p); }
    }
    if (p.blob) { p.blob.position.set(x, gy + 0.012, z); p.blob.rotation.y = p.type === 'car' ? 0 : rotY; }
    if (p.lampLight) { p.lampLight.position.set(x, gy + 0.95, z); p.lampHalo.position.copy(p.lampLight.position); }
    if (buildSel === p) positionBuildRing(p);
}
function pickMovable(e) {
    pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    let best = null, bestD = Infinity;
    for (const q of PROPS) {
        if (!q.obj || !(MOVABLE_TYPES.has(q.type) || q.type === 'car' || q.type === 'boat' || q.type === 'plane' || q.type === 'balloon')) continue;   // 🔨 운송기도 이동 (페리는 노선 시설이라 고정)
        const hits = raycaster.intersectObject(q.obj, true);
        if (hits.length && hits[0].distance < bestD) { best = q; bestD = hits[0].distance; }
    }
    return best;
}
const buildPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const buildHitV = new THREE.Vector3();
function buildGroundPoint(e, planeY) {
    pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    buildPlane.constant = -planeY;
    return raycaster.ray.intersectPlane(buildPlane, buildHitV);
}
function startBuildDrag(e) {
    const p = pickMovable(e);
    if (!p) return false;
    if ((p.type === 'boat' && boatRide) || (p.type === 'plane' && planeRide)
        || (p.type === 'balloon' && (balloonRide || BALLOON.mode !== 'docked'))
        || (p.type === 'car' && carDrive)) {
        showToast('🚧 지금 사용 중이에요 — 내린 뒤에 옮겨요');
        return true;
    }
    buildSelect(p);
    const planeY = terrainHeight(p.x, p.z);
    const g = buildGroundPoint(e, planeY);
    buildDrag = {
        id: e.pointerId, p, planeY,
        dx: g ? p.x - g.x : 0, dz: g ? p.z - g.z : 0,   // 잡은 지점 오프셋 — 사물이 손가락 밑으로 튀지 않게
        fromX: p.x, fromZ: p.z,
        rot: p.type === 'car' ? CAR.heading : (p.rotY || 0),
    };
    controls.enabled = false;                            // 이 포인터는 사물 것 — 카메라가 같이 돌지 않게
    return true;
}
function endBuildDrag(commit) {
    const d = buildDrag;
    if (!d) return;
    buildDrag = null;
    controls.enabled = true;
    const p = d.p;
    const movedFar = Math.hypot(p.x - d.fromX, p.z - d.fromZ) > 0.05;
    if (commit && canPlace(p, p.x, p.z)) {
        applyPropMove(p, p.x, p.z, d.rot);
        if (movedFar) {
            saveLayoutSoon();
            logWorldEvent(`주인이 ${PROP_LABELS[p.type] || p.type}를 옮겼다`);
        }
    } else {
        applyPropMove(p, d.fromX, d.fromZ, d.rot);
        if (commit && movedFar) showToast('🚫 거기엔 놓을 수 없어요');
    }
    buildRingMat.color.setHex(0x66d9ff);
}
window.addEventListener('pointermove', (e) => {
    if (!buildDrag || e.pointerId !== buildDrag.id) return;
    const g = buildGroundPoint(e, buildDrag.planeY);
    if (!g) return;
    const nx = g.x + buildDrag.dx, nz = g.z + buildDrag.dz;
    movePropVisual(buildDrag.p, nx, nz);
    buildRingMat.color.setHex(canPlace(buildDrag.p, nx, nz) ? 0x7ee08a : 0xe86a6a);
});
const endBuildDragUp = (e) => { if (buildDrag && e.pointerId === buildDrag.id) endBuildDrag(e.type !== 'pointercancel'); };
window.addEventListener('pointerup', endBuildDragUp);
window.addEventListener('pointercancel', endBuildDragUp);
function buildSelect(p) {
    buildSel = p;
    buildRingMat.color.setHex(0x66d9ff);
    positionBuildRing(p);
}
// 상단 공사 툴바: 회전(45°)·원위치·전부 원위치·완료
const buildBar = document.createElement('div');
buildBar.style.cssText = `position:fixed; left:50%; top:calc(12px + env(safe-area-inset-top, 0px)); transform:translateX(-50%); display:none; gap:6px; z-index:96; align-items:center; flex-wrap:wrap; justify-content:center; max-width:calc(100vw - 20px); background:rgba(30,32,40,0.9); padding:${IS_TOUCH ? '10px 12px' : '8px 10px'}; border-radius:12px; font-family:sans-serif; box-shadow:0 4px 14px rgba(0,0,0,0.35);`;
const buildTitle = document.createElement('span');
buildTitle.textContent = '🔨 공사 모드';
buildTitle.style.cssText = `color:#ffd54f; font-size:${IS_TOUCH ? 14 : 12.5}px; font-weight:700;`;
buildBar.appendChild(buildTitle);
const bbBtn = (label, fn) => {
    const b = document.createElement('div');
    b.textContent = label;
    b.style.cssText = `padding:${IS_TOUCH ? '9px 12px' : '6px 10px'}; font-size:${IS_TOUCH ? 14 : 12.5}px; color:#fff; background:rgba(255,255,255,0.12); border-radius:9px; cursor:pointer; white-space:nowrap; user-select:none; -webkit-user-select:none; touch-action:none;`;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    buildBar.appendChild(b);
    return b;
};
bbBtn('↺ 회전', () => {
    if (!buildSel) { showToast('먼저 사물을 탭해서 선택하세요'); return; }
    if (buildSel.type === 'house') { showToast('🏠 집은 회전 없이 이동만 돼요'); return; }
    if (buildSel.type === 'balloon') { showToast('🎈 열기구 계류장은 회전 없이 이동만 돼요'); return; }
    const r = (buildSel.type === 'car' ? CAR.heading : buildSel.type === 'boat' ? BOAT.heading : buildSel.type === 'plane' ? PLANE.heading : (buildSel.rotY || 0)) + Math.PI / 4;
    applyPropMove(buildSel, buildSel.x, buildSel.z, r);
    saveLayoutSoon();
});
bbBtn('원위치', () => {
    if (!buildSel) { showToast('먼저 사물을 탭해서 선택하세요'); return; }
    if (!canPlace(buildSel, buildSel.def.x, buildSel.def.z)) { showToast('🚫 원래 자리에 다른 사물이 있어요'); return; }
    applyPropMove(buildSel, buildSel.def.x, buildSel.def.z, buildSel.def.rotY);
    saveLayoutSoon();
});
bbBtn('전부 원위치', () => {
    for (const q of PROPS) {
        if (!q.def || !(MOVABLE_TYPES.has(q.type) || q.type === 'car')) continue;
        applyPropMove(q, q.def.x, q.def.z, q.def.rotY);
    }
    buildSelect(null);
    saveLayoutSoon();
    showToast('↩️ 모든 사물을 원래 자리로 되돌렸어요');
});
bbBtn('✓ 완료', () => setBuildMode(false));
document.body.appendChild(buildBar);
function setBuildMode(on) {
    if (buildMode === on) return;
    buildMode = on;
    if (on) {
        escapeAction();                                   // 조종 해제 + 메뉴/패널 정리 (차에서도 내림)
        for (const q of pets) forceEndBed(q);             // 침대·그네·시소에서 즉시 하차
        worldUnbake();                                    // 원본 복원 — 드래그가 소품 단위로 움직이게
        buildSelect(null);
        buildBar.style.display = 'flex';
        showToast('🔨 사물을 끌어서 옮기세요 — 놓을 곳이 빨간 링이면 못 놓아요');
    } else {
        endBuildDrag(false);
        buildSelect(null);
        buildBar.style.display = 'none';
        saveLayout();
        worldBake();                                      // 새 배치로 재베이크
        showToast('🔨 배치가 저장됐어요');
        if (buildDirty) {
            buildDirty = false;
            setTimeout(() => maybeProactive(null, '주인이 방금 공사 모드로 섬의 사물들을 옮겨 배치를 바꿨다.'), 1200);
        }
    }
    syncBuildBtn();
}
// 저장: 이동 가능 프롭 전체를 id→{x,z,rotY}로 — localStorage(이 기기) + 서버(기기 공유, 있으면)
let saveLayoutTimer = null;
let buildDirty = false;   // 이번 공사에서 실제로 무언가 옮겼나 — 종료 시 펫 반응 트리거
function saveLayoutSoon() { buildDirty = true; clearTimeout(saveLayoutTimer); saveLayoutTimer = setTimeout(saveLayout, 400); }
function saveLayout() {
    const out = {};
    for (const q of PROPS) {
        if (!q.layoutId || !(MOVABLE_TYPES.has(q.type) || q.type === 'car' || q.type === 'boat' || q.type === 'plane' || q.type === 'balloon')) continue;
        out[q.layoutId] = {
            x: +q.x.toFixed(3), z: +q.z.toFixed(3),
            rotY: +(((q.type === 'car' ? CAR.heading : q.type === 'boat' ? BOAT.heading : q.type === 'plane' ? PLANE.heading : q.rotY) || 0)).toFixed(3),
        };
    }
    out._sig = ISLAND_SIG;   // 현재 섬 지문 동봉 — 다음 로드가 "그 사이 섬이 바뀌었나"를 판정하는 기준점
    try { localStorage.setItem('world-layout', JSON.stringify(out)); } catch (err) {}
    fetch('/api/world_layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: out }),
    }).catch(() => {});
}
// Keyboard zoom: +/- (with or without shift) and the numpad keys; ignored while typing.
window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { e.preventDefault(); camZoom(0.86); }
    else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') { e.preventDefault(); camZoom(1.16); }
});

// Toast: small transient notice above the chat bar (screenshot results, radio errors).
const toastEl = document.createElement('div');
toastEl.style.cssText = 'position:fixed; left:50%; bottom:calc(70px + env(safe-area-inset-bottom, 0px)); transform:translateX(-50%); display:none; background:rgba(30,32,40,0.92); color:#fff; font-size:12.5px; font-family:sans-serif; padding:8px 14px; border-radius:10px; z-index:120; box-shadow:0 4px 14px rgba(0,0,0,0.3); pointer-events:none;';
document.body.appendChild(toastEl);
let toastTimer = null;
function showToast(text) {
    wakeSoft(3000);   // 토스트가 뜨는 순간(편지 도착 등)도 3초만 60fps — 연출이 뚝뚝 끊기지 않게
    toastEl.textContent = text;
    toastEl.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 2600);
}

// Screenshot: render a fresh frame, grab the canvas, POST it to the backend which writes a PNG
// into the screenshots/ folder. A quick white flash confirms the capture.
async function takeScreenshot() {
    renderFrame();   // fresh frame through the current render path — capture matches the screen
    logWorldEvent('주인이 월드 사진을 찍었다 📷');
    const dataURL = renderer.domElement.toDataURL('image/png');
    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed; inset:0; background:#fff; opacity:0.7; z-index:200; pointer-events:none; transition:opacity 0.35s;';
    document.body.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '0'; });
    setTimeout(() => flash.remove(), 420);
    try {
        const res = await fetch('/api/save_screenshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: dataURL }),
        });
        const j = await res.json();
        showToast(j && j.ok ? `📷 저장됨 — screenshots/${j.file}` : '📷 저장 실패');
        if (j && j.ok) refreshPhotoboard();   // 📌 게시판에 새 사진이 바로 붙는다
    } catch (e) {
        showToast('📷 저장 실패 (서버 응답 없음)');
    }
}

// ---- 📻 Radio: Ctrl/⌘ at the radio prop opens a small scrollable playlist of the files the user
// dropped into static/music/. Picking a track loops it; ⏹ stops; ✕ (or Esc) closes the panel.
let radioAudio = null;
let radioCurrent = null;
const radioPanel = document.createElement('div');
radioPanel.style.cssText = 'position:fixed; right:64px; bottom:calc(70px + env(safe-area-inset-bottom, 0px)); display:none; width:min(250px, calc(100vw - 90px)); background:rgba(30,32,40,0.94); border-radius:12px; padding:10px; z-index:110; box-shadow:0 6px 24px rgba(0,0,0,0.4); font-family:sans-serif;';
radioPanel.innerHTML = '';
const radioHeader = document.createElement('div');
radioHeader.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;';
radioHeader.innerHTML = '<span style="color:#fff; font-size:13px; font-weight:700;">📻 라디오</span>';
const radioClose = document.createElement('div');
radioClose.textContent = '✕';
radioClose.style.cssText = 'color:#aab; font-size:13px; cursor:pointer; padding:2px 6px;';
radioClose.onclick = () => { radioPanel.style.display = 'none'; };
radioHeader.appendChild(radioClose);
radioPanel.appendChild(radioHeader);
const radioList = document.createElement('div');
radioList.style.cssText = 'max-height:180px; overflow-y:auto; display:flex; flex-direction:column; gap:2px;';
radioPanel.appendChild(radioList);
const radioStop = document.createElement('div');
radioStop.textContent = '⏹ 끄기';
radioStop.style.cssText = 'margin-top:8px; text-align:center; padding:7px; font-size:12.5px; color:#fff; background:rgba(255,255,255,0.08); border-radius:8px; cursor:pointer;';
radioStop.onclick = () => { stopRadio(); renderRadioItems(radioLastFiles); };
radioPanel.appendChild(radioStop);
document.body.appendChild(radioPanel);
let radioLastFiles = [];
function renderRadioItems(files) {
    radioLastFiles = files;
    radioList.innerHTML = '';
    if (!files.length) {
        const empty = document.createElement('div');
        empty.textContent = 'static/music 폴더에 음악 파일을 넣어주세요';
        empty.style.cssText = 'color:#99a; font-size:12px; padding:10px 6px; line-height:1.5;';
        radioList.appendChild(empty);
        return;
    }
    for (const name of files) {
        const item = document.createElement('div');
        const playing = name === radioCurrent;
        item.textContent = `${playing ? '♪ ' : ''}${name}`;
        item.title = name;
        item.style.cssText = `padding:6px 8px; font-size:12px; color:${playing ? '#ffd54f' : '#fff'}; border-radius:7px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; background:${playing ? 'rgba(255,213,79,0.12)' : 'transparent'};`;
        item.onmouseenter = () => { if (name !== radioCurrent) item.style.background = 'rgba(255,255,255,0.1)'; };
        item.onmouseleave = () => { if (name !== radioCurrent) item.style.background = 'transparent'; };
        item.onclick = () => { playRadioTrack(name); renderRadioItems(files); };
        radioList.appendChild(item);
    }
}
function playRadioTrack(name) {
    if (radioAudio) { try { radioAudio.pause(); } catch (e) {} }
    radioAudio = new Audio(`/music/${encodeURIComponent(name)}`);
    radioAudio.loop = true;
    radioAudio.volume = 0.55;
    radioAudio.play().catch(() => showToast('📻 재생 실패 — 파일 형식을 확인해주세요'));
    radioCurrent = name;
}
function stopRadio() {
    if (radioAudio) { try { radioAudio.pause(); } catch (e) {} radioAudio = null; }
    radioCurrent = null;
}
async function toggleRadioPanel() {
    if (radioPanel.style.display === 'none' || !radioPanel.style.display) {
        radioPanel.style.display = 'block';
        try {
            const res = await fetch('/api/radio_list');
            const j = await res.json();
            renderRadioItems((j && j.files) || []);
        } catch (e) {
            renderRadioItems([]);
        }
    } else {
        radioPanel.style.display = 'none';
    }
}

// ---- 🔊 Footsteps & water (WebAudio). Step sets default to the Kenney CC0 files in
// static/sounds/steps/ (grass / road=concrete / wood for bridge decks); a manifest at
// static/sounds/custom/manifest.json overrides them per surface (that folder is git-ignored, so
// personal sounds never reach the repo). Water sounds are synthesized noise — no files, no
// licenses. Every one-shot gets random pitch/volume so steps never machine-gun, and AI pets'
// steps fade with camera distance.
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const sfxMaster = audioCtx.createGain();
sfxMaster.gain.value = 0.5;
sfxMaster.connect(audioCtx.destination);
document.addEventListener('pointerdown', () => {
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}, { once: true });

// 🐤/🐶 울음소리 — 다른 효과음처럼 파일 없이 합성한다. 병아리는 높은 사인 두 음의 짹짹,
// 강아지는 톱니파 피치 하강 두 번의 멍멍. 채팅 대답과 인사(Wave) 모션에서 운다.
// 실제 녹음이 있으면 그걸 최우선으로 쓴다: static/sounds/voice/{chick|puppy}_{0..2}.(ogg|mp3)
// 파일을 넣어두면 자동 감지해 재생(발소리와 같은 방식, 재생마다 피치를 살짝 흔들어 반복 티 제거).
// 없으면 아래 합성 울음으로 폴백.
const voiceBuffers = { chick: [], puppy: [] };
for (const petName of ['chick', 'puppy']) {
    for (let i = 0; i < 3; i++) {
        for (const ext of ['ogg', 'mp3']) {
            fetch(`/sounds/voice/${petName}_${i}.${ext}`)
                .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
                .then((ab) => audioCtx.decodeAudioData(ab))
                .then((buf) => voiceBuffers[petName].push(buf))
                .catch(() => {});
        }
    }
}
// 💗 하트 모션 3D FX — 진짜 입체 하트(Extrude+bevel) 8개 풀 재사용(생성/폐기 금지 — 발열 규칙).
// 정점에서 팡: 개별 위상 sway로 떠오르며 천천히 돌고(빛을 받아 반짝), 큰 메인 하트 하나가
// 잠깐 머물다 사라진다. 차임 2음(완전5도 상승 벨)이 같은 프레임에 울린다.
const HEART_POOL = [];
{
    const hs = new THREE.Shape();
    hs.moveTo(0.25, 0.25); hs.bezierCurveTo(0.25, 0.25, 0.2, 0, 0, 0); hs.bezierCurveTo(-0.3, 0, -0.3, 0.35, -0.3, 0.35);
    hs.bezierCurveTo(-0.3, 0.55, -0.1, 0.77, 0.25, 0.95); hs.bezierCurveTo(0.6, 0.77, 0.8, 0.55, 0.8, 0.35);
    hs.bezierCurveTo(0.8, 0.35, 0.8, 0, 0.5, 0); hs.bezierCurveTo(0.35, 0, 0.25, 0.25, 0.25, 0.25);
    const hg = new THREE.ExtrudeGeometry(hs, { depth: 0.22, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 10 });
    hg.center(); hg.rotateZ(Math.PI); hg.scale(0.16, 0.16, 0.16);
    for (let i = 0; i < 8; i++) {
        const mat = new THREE.MeshLambertMaterial({ color: i % 2 ? 0xffb3c9 : 0xff7fa8, transparent: true });
        const m = new THREE.Mesh(hg, mat);
        m.visible = false;
        scene.add(m);
        HEART_POOL.push({ m, t: -1, delay: 0, x: 0, y: 0, z: 0, phase: Math.random() * 6.28, big: i === 0 });
    }
}
function heartChime() {
    if (audioCtx.state === 'suspended') return;
    const t0 = audioCtx.currentTime;
    [[1318, 0], [1975, 0.09]].forEach(([f, d]) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + d);
        g.gain.exponentialRampToValueAtTime(0.13, t0 + d + 0.015);
        g.gain.setTargetAtTime(0.0001, t0 + d + 0.05, 0.09);
        o.connect(g); g.connect(sfxMaster);
        o.start(t0 + d); o.stop(t0 + d + 0.6);
    });
}
function heartBurstAt(p) {
    heartChime();
    const pos = p.mover.position;
    for (const h of HEART_POOL) {
        h.t = 0;
        h.delay = h.big ? 0.12 : Math.random() * 0.22;
        h.x = pos.x + (Math.random() - 0.5) * 0.26;
        h.z = pos.z + (Math.random() - 0.5) * 0.2;
        h.y = pos.y + p.height * 0.95;
    }
}
const heartOutBack = (x) => { const c = 1.7, q = x - 1; return 1 + (c + 1) * q * q * q + c * q * q; };
function updateHeartFx(delta) {
    for (const h of HEART_POOL) {
        if (h.t < 0) continue;
        h.t += delta;
        const t = h.t - h.delay, life = h.big ? 1.6 : 1.15;
        if (t < 0) { h.m.visible = false; continue; }
        if (t > life) { h.t = -1; h.m.visible = false; continue; }
        const k = t / life;
        h.m.visible = true;
        const base = h.big ? 1.5 : 0.7 + (h.phase % 0.45);
        h.m.scale.setScalar(Math.max(0.02, base * (k < 0.18 ? heartOutBack(k / 0.18) : 1)));
        h.m.position.set(h.x + Math.sin(h.phase + k * 5) * 0.05, h.y + k * (h.big ? 0.3 : 0.5), h.z);
        h.m.rotation.y = h.phase + k * (h.big ? 2.2 : 4.2);
        h.m.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }
}

// 🎄 홀리데이 3D FX — 눈송이(겨울)/색종이(그 외) + 금별, 풀 재사용. 위로 폭 → 살랑 낙하.
const FESTIVE_POOL = [];
{
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 0.11 : 0.045, an = (i / 10) * Math.PI * 2 - Math.PI / 2;
        i === 0 ? star.moveTo(Math.cos(an) * r, Math.sin(an) * r) : star.lineTo(Math.cos(an) * r, Math.sin(an) * r);
    }
    const starGeo = new THREE.ExtrudeGeometry(star, { depth: 0.03, bevelEnabled: false, curveSegments: 4 });
    const flakeGeo = new THREE.CircleGeometry(0.05, 6);
    for (let i = 0; i < 12; i++) {
        const isStar = i < 4;
        const mat = new THREE.MeshLambertMaterial({ color: isStar ? 0xffd54f : 0xffffff, transparent: true, side: THREE.DoubleSide });
        const m = new THREE.Mesh(isStar ? starGeo : flakeGeo, mat);
        m.visible = false;
        scene.add(m);
        FESTIVE_POOL.push({ m, isStar, t: -1, delay: 0, x: 0, y: 0, z: 0, phase: Math.random() * 6.28 });
    }
}
const CONFETTI_COLORS = [0xff8fb3, 0x8fd0ff, 0xb7e58a, 0xffcf7d, 0xd7a9ff];
function jingle() {
    if (audioCtx.state === 'suspended') return;
    const t0 = audioCtx.currentTime;
    [[659, 0], [659, 0.16], [659, 0.32], [784, 0.52]].forEach(([f, d]) => {   // E E E G — 캐럴 모티브
        for (const [mul, g0] of [[1, 0.12], [3, 0.03]]) {                     // 벨 톤 = 기음+3배음
            const o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = 'sine'; o.frequency.value = f * mul;
            g.gain.setValueAtTime(0.0001, t0 + d);
            g.gain.exponentialRampToValueAtTime(g0, t0 + d + 0.012);
            g.gain.setTargetAtTime(0.0001, t0 + d + 0.04, 0.1);
            o.connect(g); g.connect(sfxMaster);
            o.start(t0 + d); o.stop(t0 + d + 0.7);
        }
    });
}
function holidayBurstAt(p) {
    jingle();
    const m = new Date().getMonth() + 1;
    const winter = (m >= 11 || m <= 2);
    const pos = p.mover.position;
    for (const h of FESTIVE_POOL) {
        if (!h.isStar) h.m.material.color.setHex(winter ? 0xffffff : CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]);
        h.t = 0;
        h.delay = Math.random() * 0.25;
        h.x = pos.x + (Math.random() - 0.5) * 0.5;
        h.z = pos.z + (Math.random() - 0.5) * 0.4;
        h.y = pos.y + p.height * 1.05;
    }
}
function updateFestiveFx(delta) {
    for (const h of FESTIVE_POOL) {
        if (h.t < 0) continue;
        h.t += delta;
        const t = h.t - h.delay, life = 1.8;
        if (t < 0) { h.m.visible = false; continue; }
        if (t > life) { h.t = -1; h.m.visible = false; continue; }
        const k = t / life;
        h.m.visible = true;
        const up = Math.sin(Math.min(1, k * 3) * Math.PI * 0.5) * 0.22;       // 처음 위로 폭
        h.m.position.set(h.x + Math.sin(h.phase + k * 6) * 0.09, h.y + up - k * k * 0.55, h.z);
        h.m.rotation.set(h.isStar ? 0 : Math.sin(h.phase + k * 8) * 0.9, h.phase + k * 5, h.isStar ? k * 4 : 0);
        h.m.material.opacity = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    }
}

let lastVoiceAt = 0;
function petVoice(p) {
    if (!p || audioCtx.state === 'suspended') return;
    const now = performance.now();
    if (now - lastVoiceAt < 350) return;                  // 연타·중복 호출 방지
    lastVoiceAt = now;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const real = voiceBuffers[p.name];
    if (real && real.length) {
        const src = audioCtx.createBufferSource();
        src.buffer = real[Math.floor(Math.random() * real.length)];
        src.playbackRate.value = rnd(0.94, 1.06);
        const g = audioCtx.createGain();
        g.gain.value = 0.8;
        src.connect(g);
        g.connect(sfxMaster);
        src.start();
        return;
    }
    const t0 = audioCtx.currentTime + 0.01;
    if (p.name === 'chick') {
        // 삐약: 트라이앵글 캐리어에 빠른 FM 트릴(새소리의 씨앗) + 몸통 공명(밴드패스),
        // 2~3연음이 매번 살짝 다른 음높이·간격으로 — 반복이 똑같지 않아야 생물 같다.
        const n = Math.random() < 0.4 ? 3 : 2;
        let t = t0;
        for (let i = 0; i < n; i++) {
            const f0 = 3000 * rnd(0.92, 1.1);
            const dur = rnd(0.09, 0.13);
            const o = audioCtx.createOscillator();
            o.type = 'triangle';
            o.frequency.setValueAtTime(f0 * 0.75, t);
            o.frequency.exponentialRampToValueAtTime(f0 * 1.25, t + dur * 0.35);
            o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
            const mod = audioCtx.createOscillator();
            mod.frequency.value = rnd(55, 85);
            const modG = audioCtx.createGain();
            modG.gain.value = f0 * 0.12;
            mod.connect(modG);
            modG.connect(o.frequency);
            const bp = audioCtx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = f0;
            bp.Q.value = 2.5;
            const g = audioCtx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.55, t + 0.015);
            g.gain.setTargetAtTime(0.0001, t + dur * 0.55, dur * 0.16);
            o.connect(bp);
            bp.connect(g);
            g.connect(sfxMaster);
            o.start(t); o.stop(t + dur + 0.05);
            mod.start(t); mod.stop(t + dur + 0.05);
            t += dur + rnd(0.06, 0.13);
        }
    } else {
        // 멍: 톱니 성대 → 두 포먼트 밴드패스('아' 모음 성도) + 밴드패스 노이즈 숨소리 —
        // "왕!"의 입모양 울림. 1~2회, 피치·길이 랜덤.
        const n = Math.random() < 0.5 ? 2 : 1;
        let t = t0;
        for (let i = 0; i < n; i++) {
            const f0 = 240 * rnd(0.9, 1.12);
            const dur = rnd(0.1, 0.14);
            const o = audioCtx.createOscillator();
            o.type = 'sawtooth';
            o.frequency.setValueAtTime(f0 * 1.6, t);
            o.frequency.exponentialRampToValueAtTime(f0, t + dur * 0.5);
            o.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + dur);
            const f1 = audioCtx.createBiquadFilter();
            f1.type = 'bandpass';
            f1.Q.value = 4;
            f1.frequency.setValueAtTime(820, t);
            f1.frequency.exponentialRampToValueAtTime(560, t + dur);
            const f2 = audioCtx.createBiquadFilter();
            f2.type = 'bandpass';
            f2.Q.value = 5;
            f2.frequency.value = 1500;
            const g = audioCtx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.9, t + 0.012);
            g.gain.setTargetAtTime(0.0001, t + dur * 0.5, dur * 0.13);
            o.connect(f1);
            o.connect(f2);
            f1.connect(g);
            f2.connect(g);
            const nb = audioCtx.createBufferSource();
            nb.buffer = synthNoiseBuffer(dur, (x) => Math.exp(-x * 7));
            const nf = audioCtx.createBiquadFilter();
            nf.type = 'bandpass';
            nf.frequency.value = 1100;
            nf.Q.value = 0.8;
            const ng = audioCtx.createGain();
            ng.gain.value = 0.25;
            nb.connect(nf);
            nf.connect(ng);
            ng.connect(g);
            g.connect(sfxMaster);
            o.start(t); o.stop(t + dur + 0.05);
            nb.start(t);
            t += dur + rnd(0.15, 0.24);
        }
    }
}

const STEP_FILES = {
    grass: [0, 1, 2, 3, 4].map((i) => `/sounds/steps/footstep_grass_00${i}.ogg`),
    road:  [0, 1, 2, 3, 4].map((i) => `/sounds/steps/footstep_concrete_00${i}.ogg`),
    wood:  [0, 1, 2, 3, 4].map((i) => `/sounds/steps/footstep_wood_00${i}.ogg`),
    sand:  [],   // 파일 없음 — 아래 합성 폴백(바스락 노이즈)이 늘 담당
};
const stepBuffers = { grass: [], road: [], wood: [], sand: [] };

function synthNoiseBuffer(dur, shape) {
    const buf = audioCtx.createBuffer(1, Math.max(1, Math.ceil(audioCtx.sampleRate * dur)), audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
        const t = i / d.length;
        d[i] = (Math.random() * 2 - 1) * shape(t);
    }
    return buf;
}
const splashBuf = synthNoiseBuffer(0.45, (t) => Math.pow(1 - t, 2.2) * (t < 0.04 ? t / 0.04 : 1));
const swishBuf  = synthNoiseBuffer(0.22, (t) => Math.sin(t * Math.PI) * 0.7);
const swimLoopBuf = synthNoiseBuffer(2.6, (t) => 0.28 * (0.7 + 0.3 * Math.sin(t * Math.PI * 6)));

async function loadStepBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    return audioCtx.decodeAudioData(await res.arrayBuffer());
}
(async () => {
    let files = STEP_FILES;
    try {
        const res = await fetch('/sounds/custom/manifest.json');
        if (res.ok) {
            const m = await res.json();
            files = {
                grass: (m.grass && m.grass.length) ? m.grass.map((f) => `/sounds/custom/${f}`) : STEP_FILES.grass,
                road:  (m.road && m.road.length)  ? m.road.map((f) => `/sounds/custom/${f}`)  : STEP_FILES.road,
                wood:  (m.wood && m.wood.length)  ? m.wood.map((f) => `/sounds/custom/${f}`)  : STEP_FILES.wood,
            };
        }
    } catch (e) { /* no custom manifest — defaults */ }
    for (const key of Object.keys(stepBuffers)) {
        for (const url of files[key] || []) {
            try { stepBuffers[key].push(await loadStepBuffer(url)); } catch (e) { /* skip missing */ }
        }
        if (!stepBuffers[key].length) {
            // Synth fallback so surfaces always make SOME sound even without files.
            stepBuffers[key].push(key === 'sand'
                ? synthNoiseBuffer(0.2, (t) => Math.pow(1 - t, 1.5) * (t < 0.05 ? t / 0.05 : 1) * (0.75 + 0.25 * Math.sin(t * 90)))   // 모래 바스락 — 길고 부드러운 입자 감쇠 + 잘그락 결
                : synthNoiseBuffer(key === 'grass' ? 0.16 : 0.11, (t) => Math.pow(1 - t, key === 'road' ? 3 : 2)));
        }
    }
})();

function playBuffer(buf, { vol = 1, rate = 1, filterFreq = 0 } = {}) {
    if (!buf || audioCtx.state !== 'running') return;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = audioCtx.createGain();
    g.gain.value = vol;
    if (filterFreq) {
        const f = audioCtx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = filterFreq;
        src.connect(f);
        f.connect(g);
    } else {
        src.connect(g);
    }
    g.connect(sfxMaster);
    src.start();
}
function playStep(surface, vol) {
    const set = stepBuffers[surface] || stepBuffers.grass;
    if (!set || !set.length) return;
    const buf = set[Math.floor(Math.random() * set.length)];
    const filt = surface === 'grass' ? 2600 : surface === 'wood' ? 2000 : surface === 'sand' ? 1500 : 0;   // 모래는 낮게 눌러 포슬포슬
    playBuffer(buf, { vol: vol * (0.85 + Math.random() * 0.3), rate: 0.9 + Math.random() * 0.2, filterFreq: filt });
}
function attAtPoint(x, z) {
    const d = Math.hypot(camera.position.x - x, camera.position.z - z);
    return THREE.MathUtils.clamp(1 - d / 14, 0, 1);
}
function playSplashSound(x, z) {
    playBuffer(splashBuf, { vol: 0.85 * attAtPoint(x, z), rate: 0.85 + Math.random() * 0.3, filterFreq: 1100 });
}

// 🚗 engine: a low-passed saw that pitches up with speed (started on boarding, stopped on exit).
let engineOsc = null, engineGain = null;
function startEngine() {
    if (audioCtx.state !== 'running' || engineOsc) return;
    engineOsc = audioCtx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 52;
    const f = audioCtx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 320;
    engineGain = audioCtx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(f);
    f.connect(engineGain);
    engineGain.connect(sfxMaster);
    engineOsc.start();
}
function stopEngine() {
    if (engineOsc) {
        try { engineOsc.stop(); } catch (e) {}
        engineOsc = null;
        engineGain = null;
    }
}
function engineUpdate() {
    if (!engineOsc) { startEngine(); if (!engineOsc) return; }
    const sp = Math.abs(CAR.vel);
    engineOsc.frequency.setTargetAtTime(50 + sp * 55, audioCtx.currentTime, 0.08);
    engineGain.gain.setTargetAtTime(0.09 + Math.min(0.15, sp * 0.06), audioCtx.currentTime, 0.1);
}

// Gentle looping water lap while anyone is swimming (level follows the loudest swimmer).
let swimLoopGain = null;
function ensureSwimLoop() {
    if (swimLoopGain || audioCtx.state !== 'running') return;
    const src = audioCtx.createBufferSource();
    src.buffer = swimLoopBuf;
    src.loop = true;
    const f = audioCtx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    swimLoopGain = audioCtx.createGain();
    swimLoopGain.gain.value = 0;
    src.connect(f);
    f.connect(swimLoopGain);
    swimLoopGain.connect(sfxMaster);
    src.start();
}

function surfaceFor(p) {
    if (p.swimming) return 'water';
    const x = p.mover.position.x, z = p.mover.position.z;
    if (onBridge(x, z)) return 'wood';
    if (houseFloorY(x, z) !== null) return 'wood';         // house floors are wooden
    if (isOnRoad(x, z, -0.06)) return 'road';              // strict: only clearly ON the pavement
    const isl = islandOf(x, z);
    if (isl >= 0 && ISLANDS[isl].kind === 'sand') return 'sand';   // 휴양지 모래 — 바스락
    return 'grass';
}
// Footsteps fire on the gait phase: feet swing on sin(t*8), so a footfall lands each half-period —
// perfectly synced to the waddle. Swim strokes use the stroke cadence from applySwimPose.
function updateSfx() {
    ensureSwimLoop();
    let swimLevel = 0;
    for (const p of pets) {
        const att = attAtPoint(p.mover.position.x, p.mover.position.z);
        const isLeader = p === possessed;
        const vol = att * (isLeader ? 0.9 : 0.45);
        const surf = surfaceFor(p);
        if (surf === 'water') {
            swimLevel = Math.max(swimLevel, att * (p.pet.walking ? 0.55 : 0.28));
            const ph = Math.floor(p.pet.t * (p.pet.walking ? 5.2 : 3.4) / Math.PI);
            if (p._strokePh !== undefined && ph !== p._strokePh && p.pet.walking) {
                playBuffer(swishBuf, { vol: vol * 0.5, rate: 0.9 + Math.random() * 0.25, filterFreq: 1000 });
            }
            p._strokePh = ph;
            p._stepPh = undefined;
            continue;
        }
        const inAir = (isLeader && airborne) || p.dipAir;
        const moving = p.pet.walking && p.pet.walkAmt > 0.45 && !inAir;
        const ph = Math.floor(p.pet.t * 8 / Math.PI);
        if (moving && p._stepPh !== undefined && ph !== p._stepPh) {
            playStep(surf, vol * (isLeader && running ? 1.2 : 1));
        }
        p._stepPh = ph;
        p._strokePh = undefined;
    }
    if (swimLoopGain) swimLoopGain.gain.setTargetAtTime(swimLevel * 0.5, audioCtx.currentTime, 0.18);
}

// ---- ☕ 커피 테이크아웃: Ctrl/⌘ at the booth opens a 3×3 menu of canvas-drawn drink icons.
// Picking one puts a little 3D cup in the pet's paw/wing (parented to the motion wrap, so it bobs
// with every animation) — walk, run, even swim with it. Right-click = one sip: the cup rises to
// the mouth with a small head-tip, a gulp sound plays, and after 4 sips the cup is finished with a
// happy hop. Climbing into a bed puts the cup down (poof).
const DRINKS = [
    { id: 'americano',  name: '아메리카노',        color: '#6b4a2f', iced: false },
    { id: 'iced-ame',   name: '아이스 아메리카노', color: '#7a5230', iced: true },
    { id: 'espresso',   name: '에스프레소',        color: '#4a2e1c', iced: false, small: true },
    { id: 'latte',      name: '카페라떼',          color: '#c9a377', iced: false },
    { id: 'cappuccino', name: '카푸치노',          color: '#d7b98e', iced: false, foam: true },
    { id: 'choco',      name: '초코라떼',          color: '#8a5a3b', iced: false, cream: true },
    { id: 'strawberry', name: '딸기라떼',          color: '#f5a3bb', iced: true },
    { id: 'matcha',     name: '녹차라떼',          color: '#9ccc65', iced: true },
    { id: 'icetea',     name: '아이스티',          color: '#e0a53c', iced: true },
];
const sipBuf = synthNoiseBuffer(0.16, (t) => Math.pow(Math.sin(t * Math.PI), 2) * (t < 0.5 ? 1 : 0.55));
const munchBuf = synthNoiseBuffer(0.09, (t) => Math.pow(1 - t, 1.5));

// ---- 🍞 간식 부스: nine snacks, held in the OTHER paw/wing (both hands at once — 자유도!).
// Bites shrink the snack until it's gone.
const FOODS = [
    { id: 'toast',   name: '토스트' },
    { id: 'omurice', name: '오므라이스' },
    { id: 'burrito', name: '부리또' },
    { id: 'hotdog',  name: '핫도그' },
    { id: 'donut',   name: '도넛' },
    { id: 'bungeo',  name: '붕어빵' },
    { id: 'gimbap',  name: '삼각김밥' },
    { id: 'churros', name: '츄러스' },
    { id: 'cupcake', name: '컵케이크' },
];
function drawFoodIcon(cv, f) {
    const ctx = cv.getContext('2d');
    const s = cv.width;
    ctx.clearRect(0, 0, s, s);
    const rr = (x, y, w, h, r, fill) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fill();
    };
    if (f.id === 'toast') {
        rr(s * 0.2, s * 0.22, s * 0.6, s * 0.6, s * 0.12, '#c98f4e');
        rr(s * 0.25, s * 0.27, s * 0.5, s * 0.5, s * 0.1, '#f2d9a0');
        rr(s * 0.4, s * 0.42, s * 0.2, s * 0.2, s * 0.04, '#ffe98a');
    } else if (f.id === 'omurice') {
        ctx.fillStyle = '#f4f1ea';
        ctx.beginPath(); ctx.ellipse(s * 0.5, s * 0.62, s * 0.4, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd54f';
        ctx.beginPath(); ctx.ellipse(s * 0.5, s * 0.52, s * 0.3, s * 0.17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#e8484f';
        ctx.lineWidth = s * 0.045;
        ctx.beginPath();
        ctx.moveTo(s * 0.34, s * 0.5);
        for (let i = 0; i < 4; i++) ctx.lineTo(s * (0.38 + i * 0.08), s * (i % 2 ? 0.54 : 0.46));
        ctx.stroke();
    } else if (f.id === 'burrito') {
        rr(s * 0.16, s * 0.4, s * 0.68, s * 0.26, s * 0.13, '#e8cf9e');
        ctx.fillStyle = '#8fbf6a';
        ctx.beginPath(); ctx.ellipse(s * 0.8, s * 0.53, s * 0.06, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(150,110,60,0.4)';
        ctx.lineWidth = s * 0.02;
        for (const lx of [0.32, 0.48, 0.64]) {
            ctx.beginPath(); ctx.moveTo(s * lx, s * 0.41); ctx.lineTo(s * (lx - 0.05), s * 0.65); ctx.stroke();
        }
    } else if (f.id === 'hotdog') {
        rr(s * 0.18, s * 0.42, s * 0.64, s * 0.24, s * 0.12, '#e3b878');
        rr(s * 0.14, s * 0.38, s * 0.72, s * 0.14, s * 0.07, '#d1584e');
        ctx.strokeStyle = '#ffd54f';
        ctx.lineWidth = s * 0.035;
        ctx.beginPath();
        ctx.moveTo(s * 0.2, s * 0.45);
        for (let i = 0; i < 5; i++) ctx.lineTo(s * (0.26 + i * 0.12), s * (i % 2 ? 0.49 : 0.41));
        ctx.stroke();
    } else if (f.id === 'donut') {
        ctx.fillStyle = '#f5a3bb';
        ctx.beginPath(); ctx.arc(s * 0.5, s * 0.5, s * 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(s * 0.5, s * 0.5, s * 0.11, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 8; i++) {
            ctx.fillStyle = ['#ffd54f', '#8fb7e8', '#9fd8c9', '#fff'][i % 4];
            const a = (i / 8) * Math.PI * 2;
            ctx.fillRect(s * 0.5 + Math.cos(a) * s * 0.2 - 2, s * 0.5 + Math.sin(a) * s * 0.2 - 1, 5, 3);
        }
    } else if (f.id === 'bungeo') {
        ctx.fillStyle = '#e3b878';
        ctx.beginPath(); ctx.ellipse(s * 0.44, s * 0.52, s * 0.28, s * 0.18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(s * 0.68, s * 0.52); ctx.lineTo(s * 0.86, s * 0.38); ctx.lineTo(s * 0.86, s * 0.66);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5a4a42';
        ctx.beginPath(); ctx.arc(s * 0.3, s * 0.47, s * 0.03, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(150,110,60,0.5)';
        ctx.lineWidth = s * 0.02;
        ctx.beginPath(); ctx.arc(s * 0.42, s * 0.56, s * 0.12, 0.3, 2.2); ctx.stroke();
    } else if (f.id === 'gimbap') {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(s * 0.5, s * 0.2); ctx.lineTo(s * 0.82, s * 0.74); ctx.lineTo(s * 0.18, s * 0.74);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2e2e34';
        ctx.fillRect(s * 0.3, s * 0.55, s * 0.4, s * 0.19);
    } else if (f.id === 'churros') {
        ctx.strokeStyle = '#b07840';
        ctx.lineWidth = s * 0.09;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s * 0.3, s * 0.82); ctx.lineTo(s * 0.62, s * 0.2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.48, s * 0.84); ctx.lineTo(s * 0.76, s * 0.3); ctx.stroke();
        ctx.fillStyle = 'rgba(255,240,200,0.9)';
        for (let i = 0; i < 8; i++) ctx.fillRect(Math.random() * s * 0.5 + s * 0.28, Math.random() * s * 0.5 + s * 0.24, 2.5, 2.5);
    } else {
        // cupcake
        ctx.fillStyle = '#b07840';
        ctx.beginPath();
        ctx.moveTo(s * 0.3, s * 0.55); ctx.lineTo(s * 0.7, s * 0.55);
        ctx.lineTo(s * 0.62, s * 0.84); ctx.lineTo(s * 0.38, s * 0.84);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f5a3bb';
        for (let i = 0; i < 3; i++) {
            ctx.beginPath(); ctx.ellipse(s * 0.5, s * (0.5 - i * 0.09), s * (0.22 - i * 0.06), s * 0.09, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#e8484f';
        ctx.beginPath(); ctx.arc(s * 0.5, s * 0.26, s * 0.05, 0, Math.PI * 2); ctx.fill();
    }
}
function makeFoodMesh(f) {
    const g = new THREE.Group();
    if (f.id === 'toast') {
        for (let i = 0; i < 2; i++) {
            const slice = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.016, 0.075, 2, 0.008), M(i ? 0xf2d9a0 : 0xe0b878));
            slice.position.set(i * 0.008, 0.012 + i * 0.018, i * -0.006);
            g.add(slice);
        }
        g.userData.topH = 0.05;
    } else if (f.id === 'omurice') {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.008, 16), M(0xf4f1ea));
        plate.position.y = 0.004;
        g.add(plate);
        const egg = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 10), M(0xffd54f));
        egg.scale.set(1, 0.5, 0.72);
        egg.position.y = 0.026;
        g.add(egg);
        const ketchup = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.006, 0.012, 1, 0.003), M(0xe8484f));
        ketchup.position.y = 0.047;
        g.add(ketchup);
        g.userData.topH = 0.05;
    } else if (f.id === 'burrito') {
        const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.085, 10), M(0xe8cf9e));
        roll.rotation.z = Math.PI / 2;
        roll.position.y = 0.02;
        g.add(roll);
        const filling = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 10), M(0x8fbf6a));
        filling.rotation.z = Math.PI / 2;
        filling.position.set(0.048, 0.02, 0);
        g.add(filling);
        g.userData.topH = 0.04;
    } else if (f.id === 'hotdog') {
        const bun = new THREE.Mesh(new RoundedBoxGeometry(0.032, 0.028, 0.085, 2, 0.013), M(0xe3b878));
        bun.position.y = 0.016;
        g.add(bun);
        const sausage = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.09, 8), M(0xd1584e));
        sausage.rotation.x = Math.PI / 2;
        sausage.position.y = 0.033;
        g.add(sausage);
        g.userData.topH = 0.045;
    } else if (f.id === 'donut') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.014, 8, 18), M(0xf5a3bb));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.015;
        g.add(ring);
        g.userData.topH = 0.03;
    } else if (f.id === 'bungeo') {
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), M(0xe3b878));
        body.scale.set(0.65, 0.4, 1);
        body.position.y = 0.02;
        g.add(body);
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.03, 8), M(0xe3b878));
        tail.rotation.x = -Math.PI / 2;
        tail.position.set(0, 0.02, 0.055);
        g.add(tail);
        g.userData.topH = 0.04;
    } else if (f.id === 'gimbap') {
        const tri = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.02, 3), M(0xffffff));
        tri.rotation.x = Math.PI / 2;
        tri.position.y = 0.035;
        g.add(tri);
        const nori = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.03, 0.024, 1, 0.004), M(0x2e2e34));
        nori.position.y = 0.016;
        g.add(nori);
        g.userData.topH = 0.07;
    } else if (f.id === 'churros') {
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6), M(0xb07840));
        stick.rotation.z = 0.25;
        stick.position.y = 0.05;
        g.add(stick);
        g.userData.topH = 0.095;
    } else {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.032, 12), M(0xb07840));
        cup.position.y = 0.016;
        g.add(cup);
        const swirl = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), M(0xf5a3bb));
        swirl.position.y = 0.045;
        g.add(swirl);
        const cherry = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), M(0xe8484f));
        cherry.position.y = 0.066;
        g.add(cherry);
        g.userData.topH = 0.07;
    }
    return g;
}

function drawDrinkIcon(cv, d) {
    const ctx = cv.getContext('2d');
    const s = cv.width;
    ctx.clearRect(0, 0, s, s);
    if (d.iced) {
        // clear cup + liquid + ice + straw
        ctx.fillStyle = 'rgba(215,235,245,0.55)';
        ctx.beginPath();
        ctx.moveTo(s * 0.28, s * 0.2); ctx.lineTo(s * 0.72, s * 0.2);
        ctx.lineTo(s * 0.66, s * 0.88); ctx.lineTo(s * 0.34, s * 0.88);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.moveTo(s * 0.3, s * 0.38); ctx.lineTo(s * 0.7, s * 0.38);
        ctx.lineTo(s * 0.655, s * 0.86); ctx.lineTo(s * 0.345, s * 0.86);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(s * 0.38, s * 0.42, s * 0.11, s * 0.11);
        ctx.fillRect(s * 0.52, s * 0.55, s * 0.11, s * 0.11);
        ctx.strokeStyle = '#ef8a8a';
        ctx.lineWidth = s * 0.05;
        ctx.beginPath(); ctx.moveTo(s * 0.56, s * 0.22); ctx.lineTo(s * 0.66, s * 0.02); ctx.stroke();
    } else if (d.small) {
        // espresso: little cup + saucer + handle
        ctx.fillStyle = '#f4f1ea';
        ctx.beginPath(); ctx.ellipse(s * 0.5, s * 0.82, s * 0.32, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(s * 0.32, s * 0.42); ctx.lineTo(s * 0.68, s * 0.42);
        ctx.lineTo(s * 0.62, s * 0.76); ctx.lineTo(s * 0.38, s * 0.76);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = s * 0.05;
        ctx.beginPath(); ctx.arc(s * 0.72, s * 0.56, s * 0.09, -1.2, 1.2); ctx.stroke();
        ctx.fillStyle = d.color;
        ctx.beginPath(); ctx.ellipse(s * 0.5, s * 0.45, s * 0.16, s * 0.05, 0, 0, Math.PI * 2); ctx.fill();
    } else {
        // paper cup + sleeve + lid (foam/cream variants tint the lid area)
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(s * 0.3, s * 0.26); ctx.lineTo(s * 0.7, s * 0.26);
        ctx.lineTo(s * 0.62, s * 0.9); ctx.lineTo(s * 0.38, s * 0.9);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.moveTo(s * 0.315, s * 0.42); ctx.lineTo(s * 0.685, s * 0.42);
        ctx.lineTo(s * 0.64, s * 0.72); ctx.lineTo(s * 0.36, s * 0.72);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = d.foam || d.cream ? (d.cream ? '#fff3e0' : '#fdf6ec') : '#e8e2d8';
        ctx.beginPath(); ctx.ellipse(s * 0.5, s * 0.24, s * 0.22, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
        if (d.cream) {
            ctx.beginPath(); ctx.arc(s * 0.5, s * 0.16, s * 0.08, 0, Math.PI * 2); ctx.fill();
        }
    }
}

function makeDrinkMesh(d) {
    const g = new THREE.Group();
    const colorNum = parseInt(d.color.slice(1), 16);
    g.userData.topH = d.iced ? 0.075 : d.small ? 0.04 : 0.08;   // rim height — the mouth meets the TOP
    if (d.iced) {
        const cup = new THREE.Mesh(
            new THREE.CylinderGeometry(0.028, 0.021, 0.075, 12),
            M(0xdfeef7, { transparent: true, opacity: 0.45 })
        );
        cup.position.y = 0.0375;
        g.add(cup);
        const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.019, 0.05, 12), M(colorNum));
        liquid.position.y = 0.028;
        g.add(liquid);
        const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 6), M(0xef8a8a));
        straw.position.set(0.008, 0.09, 0);
        straw.rotation.z = -0.25;
        g.add(straw);
    } else if (d.small) {
        const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 12), M(0xf4f1ea));
        saucer.position.y = 0.003;
        g.add(saucer);
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.032, 12), M(0xffffff));
        cup.position.y = 0.022;
        g.add(cup);
        const shot = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.008, 10), M(colorNum));
        shot.position.y = 0.036;
        g.add(shot);
    } else {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.019, 0.07, 12), M(0xffffff));
        cup.position.y = 0.035;
        g.add(cup);
        const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.0255, 0.023, 0.026, 12), M(0xb08a60));
        sleeve.position.y = 0.033;
        g.add(sleeve);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.0255, 0.0255, 0.01, 12), M(d.cream ? 0xfff3e0 : 0xe8e2d8));
        lid.position.y = 0.075;
        g.add(lid);
    }
    return g;
}

function removeHeldItem(p, key) {
    const it = p[key];
    if (!it) return;
    for (const m of [it.mesh, it.arm, it.paw]) {
        if (m && m.parent) m.parent.remove(m);
    }
    p[key] = null;
}
function removeDrink(p) { removeHeldItem(p, 'drink'); }
function removeFood(p) { removeHeldItem(p, 'food'); }
// Raycast the flank at item height to find the real fur surface on side `sideSign` (-1 = the
// drink hand, +1 = the snack hand). Returns the local x of the surface.
function flankX(p, sideSign, y, z) {
    const dims = p.pet.dims;
    p.pet.wrap.updateWorldMatrix(true, false);
    const originW = p.pet.wrap.localToWorld(new THREE.Vector3(sideSign * dims.x, y, z));
    const towardW = p.pet.wrap.localToWorld(new THREE.Vector3(0, y, z));
    const rc = new THREE.Raycaster(originW, towardW.sub(originW).normalize(), 0, dims.x * 1.5);
    const hits = rc.intersectObject(p.pet.root, true);
    if (hits.length) return p.pet.wrap.worldToLocal(hits[0].point.clone()).x;
    return sideSign * (dims.x / 2) * 0.8;
}
function giveDrink(p, d) {
    removeDrink(p);
    const mesh = makeDrinkMesh(d);
    p.pet.wrap.add(mesh);
    // Rest against the real fur surface (raycast) so the cup/arm attach on any body shape.
    const dims = p.pet.dims;
    const cupY = dims.y * 0.34;
    const cupZ = -dims.z * 0.12;                            // beside the flank, slightly forward
    const sideX = flankX(p, -1, cupY, cupZ);
    mesh.position.set(sideX - 0.045, cupY, cupZ);
    const drink = {
        def: d, mesh, gulps: 0, seq: null,
        rest: mesh.position.clone(),
        anchor: new THREE.Vector3(sideX + 0.025, cupY + 0.045, cupZ + 0.01),   // inside the fur
    };
    // 강아지 (no wings) gets a little arm + paw that stretch from the shoulder to the cup, so the
    // cup reads as held instead of floating.
    if (!p.pet.wings.length) {
        const furMat = M(0xe6cba6);
        drink.arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1, 8), furMat);
        drink.paw = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), furMat);
        p.pet.wrap.add(drink.arm);
        p.pet.wrap.add(drink.paw);
    }
    p.drink = drink;
    logWorldEvent(`${petKo(p)}가 커피 부스에서 ${d.name}를 받았다`);
    showToast(`☕ ${d.name} 나왔습니다!`);
}
function giveFood(p, f) {
    removeFood(p);
    const mesh = makeFoodMesh(f);
    p.pet.wrap.add(mesh);
    const dims = p.pet.dims;
    const itemY = dims.y * 0.34;
    const itemZ = -dims.z * 0.12;
    const sideX = flankX(p, 1, itemY, itemZ);               // the OTHER hand
    mesh.position.set(sideX + 0.045, itemY, itemZ);
    const food = {
        def: f, mesh, bites: 0, seq: null,
        rest: mesh.position.clone(),
        anchor: new THREE.Vector3(sideX - 0.025, itemY + 0.045, itemZ + 0.01),
    };
    if (!p.pet.wings.length) {
        const furMat = M(0xe6cba6);
        food.arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1, 8), furMat);
        food.paw = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), furMat);
        p.pet.wrap.add(food.arm);
        p.pet.wrap.add(food.paw);
    }
    p.food = food;
    logWorldEvent(`${petKo(p)}가 간식 부스에서 ${f.name}를 받았다`);
    showToast(`🍞 ${f.name} 나왔습니다!`);
}
// The cup's "mouth slot": read the pet's actual mouth node (beak for the chick, tongue for the
// puppy) every frame and hover the cup just in front of it — so drinking always meets the mouth
// no matter the pose, instead of sinking into the body.
const _mouthV = new THREE.Vector3();
function mouthLocal(p, out) {
    const node = p.pet.beak || p.pet.tongue;
    if (node) {
        node.getWorldPosition(out);
        p.pet.wrap.worldToLocal(out);
        out.z -= 0.05;            // just in front of the lips (model faces -Z in wrap space)
        out.y += 0.008;
    } else {
        out.set(0, p.height * 0.6, -0.2);
    }
    return out;
}
// Stretch a unit-height cylinder between two wrap-local points (the puppy's arm).
const _armDir = new THREE.Vector3();
const _armUp = new THREE.Vector3(0, 1, 0);
function stretchBetween(mesh, a, b) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    _armDir.subVectors(b, a);
    const len = Math.max(0.02, _armDir.length());
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(_armUp, _armDir.normalize());
}
// Carry pose overlay for BOTH hands (runs after the entity update, same slot as the swim pose).
// A consume sequence keeps the item at the mouth while the head tips rhythmically — 꿀꺽꿀꺽 for
// drinks, 우적우적 (with the snack shrinking per bite) for food.
const _cupTarget = new THREE.Vector3();
function updateHeldPose(p, key, delta) {
    const it = p[key];
    if (!it) return;
    const isDrink = key === 'drink';
    let raise = 0;
    if (it.seq) {
        const per = 0.55;
        const total = it.seq.count * per + 0.3;
        it.seq.t += delta;
        const idx = Math.min(it.seq.count - 1, Math.floor(it.seq.t / per));
        if (idx !== it.seq.played && it.seq.t < it.seq.count * per) {
            it.seq.played = idx;
            if (isDrink) {
                it.gulps += 1;
                playBuffer(sipBuf, { vol: 0.55, rate: 1.05 + Math.random() * 0.25, filterFreq: 620 });
            } else {
                it.bites += 1;
                it.mesh.scale.setScalar(Math.max(0.35, 1 - it.bites * 0.11));   // shrink per bite
                playBuffer(munchBuf, { vol: 0.55, rate: 0.85 + Math.random() * 0.3, filterFreq: 950 });
            }
        }
        raise = Math.min(1, it.seq.t / 0.25) * Math.min(1, Math.max(0, (total - it.seq.t) / 0.25));
        const phase = (it.seq.t % per) / per;
        p.pet.wrap.rotation.x += -0.16 * raise * (0.55 + 0.45 * Math.sin(phase * Math.PI));
        if (it.seq.t >= total) {
            it.seq = null;
            const finished = isDrink ? it.gulps >= 8 : it.bites >= 6;
            if (finished) {
                removeHeldItem(p, key);
                if (!p.pet.action) p.pet.action = { id: 'happy', t: 0 };
                showToast(isDrink ? '☕ 다 마셨다!' : '🍞 잘 먹었다!');
                return;
            }
        }
    }
    // rest ↔ mouth (mouth read from the live beak/tongue node). Drinks meet the RIM to the lips;
    // food goes center-to-mouth.
    mouthLocal(p, _cupTarget);
    const topH = it.mesh.userData.topH || 0.06;
    const mouthY = isDrink ? _cupTarget.y - topH + 0.005 : _cupTarget.y - topH * 0.5;
    it.mesh.position.set(
        THREE.MathUtils.lerp(it.rest.x, _cupTarget.x, raise),
        THREE.MathUtils.lerp(it.rest.y, mouthY, raise),
        THREE.MathUtils.lerp(it.rest.z, _cupTarget.z, raise)
    );
    if (it.arm) {
        // Short stub from the raycast fur anchor to wherever the item is — always rooted in the
        // body, wing-length at rest, stretching naturally toward the mouth.
        stretchBetween(it.arm, it.anchor, it.mesh.position);
        it.paw.position.copy(it.mesh.position);
        it.paw.position.y += 0.014;
        it.paw.position.x += key === 'drink' ? 0.012 : -0.012;
    }
}
function applyCarryPose(p, delta) {
    updateHeldPose(p, 'drink', delta);
    updateHeldPose(p, 'food', delta);
}

// ☕ order panel: 3×3 grid of drawn icons.
const coffeePanel = document.createElement('div');
coffeePanel.style.cssText = 'position:fixed; right:64px; bottom:calc(70px + env(safe-area-inset-bottom, 0px)); display:none; width:min(264px, calc(100vw - 90px)); background:rgba(30,32,40,0.94); border-radius:12px; padding:10px; z-index:110; box-shadow:0 6px 24px rgba(0,0,0,0.4); font-family:sans-serif;';
const coffeeHeader = document.createElement('div');
coffeeHeader.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;';
coffeeHeader.innerHTML = '<span style="color:#fff; font-size:13px; font-weight:700;">☕ 커피 테이크아웃</span>';
const coffeeClose = document.createElement('div');
coffeeClose.textContent = '✕';
coffeeClose.style.cssText = 'color:#aab; font-size:13px; cursor:pointer; padding:2px 6px;';
coffeeClose.onclick = () => { coffeePanel.style.display = 'none'; };
coffeeHeader.appendChild(coffeeClose);
coffeePanel.appendChild(coffeeHeader);
const coffeeGrid = document.createElement('div');
coffeeGrid.style.cssText = 'display:grid; grid-template-columns:repeat(3, 1fr); gap:6px;';
coffeePanel.appendChild(coffeeGrid);
for (const d of DRINKS) {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 2px; border-radius:9px; cursor:pointer;';
    const cv = document.createElement('canvas');
    cv.width = cv.height = 48;
    drawDrinkIcon(cv, d);
    cv.style.cssText = 'width:44px; height:44px;';
    const label = document.createElement('div');
    label.textContent = d.name;
    label.style.cssText = 'color:#fff; font-size:10.5px; text-align:center; line-height:1.2; word-break:keep-all;';
    item.appendChild(cv);
    item.appendChild(label);
    item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.1)'; };
    item.onmouseleave = () => { item.style.background = 'transparent'; };
    item.onclick = () => {
        ownerOrder('drink', d);
        coffeePanel.style.display = 'none';
    };
    coffeeGrid.appendChild(item);
}
document.body.appendChild(coffeePanel);
function toggleCoffeePanel() {
    coffeePanel.style.display = (coffeePanel.style.display === 'none' || !coffeePanel.style.display) ? 'block' : 'none';
}

// 🍞 snack order panel — same 3×3 layout as the coffee menu.
const foodPanel = document.createElement('div');
foodPanel.style.cssText = 'position:fixed; right:64px; bottom:calc(70px + env(safe-area-inset-bottom, 0px)); display:none; width:min(264px, calc(100vw - 90px)); background:rgba(30,32,40,0.94); border-radius:12px; padding:10px; z-index:110; box-shadow:0 6px 24px rgba(0,0,0,0.4); font-family:sans-serif;';
const foodHeader = document.createElement('div');
foodHeader.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;';
foodHeader.innerHTML = '<span style="color:#fff; font-size:13px; font-weight:700;">🍞 간식 부스</span>';
const foodClose = document.createElement('div');
foodClose.textContent = '✕';
foodClose.style.cssText = 'color:#aab; font-size:13px; cursor:pointer; padding:2px 6px;';
foodClose.onclick = () => { foodPanel.style.display = 'none'; };
foodHeader.appendChild(foodClose);
foodPanel.appendChild(foodHeader);
const foodGrid = document.createElement('div');
foodGrid.style.cssText = 'display:grid; grid-template-columns:repeat(3, 1fr); gap:6px;';
foodPanel.appendChild(foodGrid);
for (const f of FOODS) {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:3px; padding:6px 2px; border-radius:9px; cursor:pointer;';
    const cv = document.createElement('canvas');
    cv.width = cv.height = 48;
    drawFoodIcon(cv, f);
    cv.style.cssText = 'width:44px; height:44px;';
    const label = document.createElement('div');
    label.textContent = f.name;
    label.style.cssText = 'color:#fff; font-size:10.5px; text-align:center; line-height:1.2; word-break:keep-all;';
    item.appendChild(cv);
    item.appendChild(label);
    item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.1)'; };
    item.onmouseleave = () => { item.style.background = 'transparent'; };
    item.onclick = () => {
        ownerOrder('food', f);
        foodPanel.style.display = 'none';
    };
    foodGrid.appendChild(item);
}
document.body.appendChild(foodPanel);
function toggleFoodPanel() {
    foodPanel.style.display = (foodPanel.style.display === 'none' || !foodPanel.style.display) ? 'block' : 'none';
}
// 심즈式 대리 주문: 부스를 클릭해서 고르면 — 조종 중인 펫이 부스 옆에 있으면 그 펫이 바로 받고,
// 아니면 한가한 AI 펫이 부스까지 걸어가서 받아 온다 (⌘ 근접 주문은 예전 그대로).
async function ownerOrder(kind, def) {
    const boothType = kind === 'drink' ? 'coffee' : 'food';
    if (possessed && nearestPropDist(possessed, boothType) < 1.3) {
        (kind === 'drink' ? giveDrink : giveFood)(possessed, def);
        return;
    }
    const p = pets.find((q) => q !== possessed && !q.pet.sleeping && !q.bed && !q.dip
        && q.ai.state !== 'held' && q.ai.state !== 'busy' && q.ai.state !== 'goto');
    if (!p) { showToast(`${kind === 'drink' ? '☕' : '🍞'} 지금 주문을 받아올 펫이 없어요`); return; }
    showToast(`${petKo(p)}가 ${def.name} 받으러 가요`);
    const want = resolveGotoSpot(p, boothType === 'coffee' ? 'coffee' : 'snack');
    const spot = want && nearestOpenSpot(want.x, want.z);
    if (spot) await gotoAsync(p, spot.x, spot.z);
    (kind === 'drink' ? giveDrink : giveFood)(p, def);
    releaseAI(p);
}

// Right-click on the world → a tiny "먹기" popup (and never the browser context menu). Picking
// 먹기 runs a 2~3-gulp drinking sequence with the cup held to the mouth.
const sipMenu = document.createElement('div');
sipMenu.style.cssText = 'position:fixed; display:none; z-index:120; background:rgba(30,32,40,0.94); border-radius:10px; padding:5px; box-shadow:0 6px 24px rgba(0,0,0,0.4); font-family:sans-serif;';
document.body.appendChild(sipMenu);
function hideSipMenu() { sipMenu.style.display = 'none'; }
// Built per open: one entry per held item (both hands can be full at once).
// `above` anchors the menu's BOTTOM at y (used to stack it on top of the motion menu).
function showSipMenuAt(x, y, above = false) {
    sipMenu.innerHTML = '';
    const addItem = (label, fn) => {
        const item = document.createElement('div');
        item.textContent = label;
        item.style.cssText = `padding:${IS_TOUCH ? '12px 18px' : '8px 16px'}; font-size:${menuFont}px; color:#fff; border-radius:7px; cursor:pointer; white-space:nowrap;`;
        item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.14)'; };
        item.onmouseleave = () => { item.style.background = 'transparent'; };
        item.onclick = () => { hideMenu(); fn(); };   // hideMenu closes both panels
        sipMenu.appendChild(item);
    };
    const dr = possessed && possessed.drink;
    const fd = possessed && possessed.food;
    const busy = (dr && dr.seq) || (fd && fd.seq);
    if (dr && !busy) addItem(`🥤 ${dr.def.name} 마시기`, () => { dr.seq = { count: 2 + Math.round(Math.random()), t: 0, played: -1 }; });
    if (fd && !busy) addItem(`🍞 ${fd.def.name} 먹기`, () => { fd.seq = { count: 2 + Math.round(Math.random()), t: 0, played: -1 }; });
    if (!sipMenu.children.length) return;
    sipMenu.style.display = 'block';
    sipMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 175))}px`;
    const top = above ? Math.max(8, y - sipMenu.offsetHeight - 8) : Math.min(y, window.innerHeight - 80);
    sipMenu.style.top = `${top}px`;
}
// The popup itself is opened from the pointerup raycast (right-click ON the drink-holding pet) —
// this handler only suppresses the browser context menu, which on macOS fires on mouseDOWN and
// used to close the popup the instant it appeared.
renderer.domElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

function pickResponder(text) {
    if (/병아리|삐약|chick/i.test(text)) return pets.find((p) => p.name === 'chick') || pets[0] || null;
    if (/강아지|멍멍|댕댕|puppy/i.test(text)) return pets.find((p) => p.name === 'puppy') || pets[0] || null;
    // 이름을 안 부르면 직전 대화 상대가 이어받는다 (대화 연속성) — 첫 대화만 병아리.
    return responder || pets.find((p) => p.name === 'chick') || pets[0] || null;
}

// ---- P2 액션 태그: the reply may carry <motion=..> <goto=..> <mount=..> <drink=..> <snack=..>
// <hat=..> tags. They are whitelisted against what actually exists in the world, capped at 4,
// stripped from the bubble text and run strictly in order by runWorldActions below. ----
const ACTION_RE = /<\s*(motion|goto|mount|drink|snack|hat|swim|drive|game)\s*[=:]\s*([a-z0-9-]+)\s*\/?\s*>/gi;
const ACTION_IDS = {
    motion: new Set(GLB_MOTIONS.map((m) => m.id)),
    goto: new Set(['plaza', 'house', 'pond', 'bowl', 'coffee', 'snack', 'radio', 'swing', 'seesaw', 'sunbed', 'hammock', 'friend', 'monument', 'hugspot', 'pecktree', 'well', 'capsule', 'cave', 'lookout', 'digsite', 'garden', 'piano', 'mailbox', 'gym', 'library', 'fountain', 'flowerbasket']),
    mount: new Set(['swing', 'seesaw', 'sofa', 'sunbed', 'hammock', 'loftbed']),
    drink: new Set(DRINKS.map((d) => d.id)),
    snack: new Set(FOODS.map((f) => f.id)),
    hat: new Set([...GLB_ACCESSORIES.map((a) => a.id), 'off']),
    swim: new Set(['pond', 'sea']),
    drive: new Set(['car']),
    game: new Set(['hideseek', 'treasure']),
};
function parseWorldReply(raw) {
    const actions = [];
    const speech = raw.replace(ACTION_RE, (all, kind, id) => {
        kind = kind.toLowerCase();
        id = id.toLowerCase();
        if (actions.length < 4 && ACTION_IDS[kind] && ACTION_IDS[kind].has(id)) actions.push({ kind, id });
        return '';
    }).replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return { speech, actions };
}

// ---- P2 실행기: one action script at a time; a newer chat or taking manual control (조종)
// bumps scriptGen and the old script quietly stops between steps. Movement-class actions yield
// while the pet is player-driven or hand-held; everything reuses the existing systems (gotoAsync,
// mountBed, giveDrink/giveFood, worldHug/worldPlay) so 기존 안전장치들도 그대로 따라온다. ----
let scriptGen = 0;
function waitFor(cond, ms) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
            if (cond() || Date.now() - t0 > ms) { clearInterval(iv); resolve(); }
        }, 120);
    });
}
// 침대/물놀이/식사 대기 등 무엇을 하고 있었든 부드럽게 내려놓는다 (possessPet과 같은 순서).
async function freeForScript(p) {
    if (p.dip) endDip(p);
    if (p.bed && p.bedPhase === 'lying') {
        p.pet.sleeping = false;
        p.bedExit = true;
        await waitFor(() => !p.bed, 3500);
    }
    if (p.bed) forceEndBed(p);
    if (p.ai.onArrive) { const done = p.ai.onArrive; p.ai.onArrive = null; done(); }
    p.eatSpot = null;
    p.pet.sleeping = false;
    p.pet.autoSleeping = false;
}
const GOTO_PROP_TYPE = { pond: 'pond', bowl: 'bowl', coffee: 'coffee', snack: 'food', radio: 'radio', swing: 'swing', seesaw: 'seesaw', sunbed: 'sunbed', hammock: 'hammock', monument: 'monument', hugspot: 'hugspot', pecktree: 'pecktree', well: 'well', capsule: 'capsule', cave: 'cave', lookout: 'lookout', digsite: 'digsite', garden: 'garden', piano: 'piano', mailbox: 'mailbox', gym: 'gym', library: 'library', fountain: 'fountain', flowerbasket: 'flowerbasket' };
function resolveGotoSpot(p, id) {
    if (id === 'plaza') return { x: 0.4, z: 0.4 };
    if (id === 'house') { const w = houseWorld(0, 1.3); return { x: w.x, z: w.z }; }
    if (id === 'friend') {
        const q = pets.find((o) => o !== p);
        return q ? { x: q.mover.position.x + 0.45, z: q.mover.position.z } : null;
    }
    const prop = PROPS.find((q) => q.type === GOTO_PROP_TYPE[id]);
    if (!prop) return null;
    const dx = p.mover.position.x - prop.x, dz = p.mover.position.z - prop.z;
    const d = Math.hypot(dx, dz) || 1;
    const k = (prop.r + 0.4) / d;
    return { x: prop.x + dx * k, z: prop.z + dz * k };   // prop edge on the pet's side
}
function nearestOpenSpot(x, z) {
    if (!world.isBlocked(x, z)) return { x, z };
    for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2, r = 0.25 + i * 0.09;
        const nx = x + Math.sin(a) * r, nz = z + Math.cos(a) * r;
        if (!world.isBlocked(nx, nz)) return { x: nx, z: nz };
    }
    return null;
}
async function actGoto(p, id, gen) {
    const want = resolveGotoSpot(p, id);
    if (!want) return;
    const spot = nearestOpenSpot(want.x, want.z);
    if (!spot) return;
    await freeForScript(p);
    if (gen !== scriptGen || p === possessed) return;
    await Promise.race([gotoAsync(p, spot.x, spot.z), sleepMs(25000)]);
}
// <drive=car>: 차 옆까지 걸어가 올라타고, updateAutoDrive가 잠깐 몰다가 스스로 내린다.
async function actDrive(p, gen) {
    if (carDrive) return;                                        // 차는 한 대 — 이미 누가 타고 있다
    await freeForScript(p);
    if (gen !== scriptGen || p === possessed) return;
    const dx = p.mover.position.x - CAR.x, dz = p.mover.position.z - CAR.z;
    const k = 0.9 / (Math.hypot(dx, dz) || 1);
    await Promise.race([gotoAsync(p, CAR.x + dx * k, CAR.z + dz * k), sleepMs(25000)]);
    if (gen !== scriptGen || p === possessed || carDrive) return;
    releaseAI(p);
    p.ai.state = 'held';                                         // 드라이브 동안 배회 AI가 못 데려가게 주차
    carDrive = { driver: p, passenger: null, auto: { t: 11 + Math.random() * 6, steer: (Math.random() < 0.5 ? 1 : -1) * 0.55 } };
    startEngine();
    logWorldEvent(`${petKo(p)}가 스포츠카 드라이브를 시작했다`);
    await waitFor(() => !carDrive || !carDrive.auto, 30000);
}
async function runWorldActions(p, actions) {
    const gen = ++scriptGen;
    for (const a of actions) {
        if (gen !== scriptGen) return;                            // superseded by a newer script
        const moves = a.kind !== 'motion' && a.kind !== 'hat';
        if (moves && (p === possessed || p.ai.state === 'held')) continue;   // 주인이 잡고 있으면 이동류는 양보
        try {
            if (a.kind === 'motion') {
                if (a.id === 'hug') { if (!duoBusy && p !== possessed) await worldHug(p); }
                else if (a.id === 'play') { if (!duoBusy && p !== possessed) await worldPlay(p); }
                else if (a.id === 'holiday') { if (p !== possessed) await worldHoliday(p); }
                else if (a.id === 'sleep') {
                    if (!p.dip && p !== possessed) { p.pet.sleeping = true; logWorldEvent(`${petKo(p)}가 잠들었다`); }
                } else {
                    p.pet.sleeping = false;
                    await waitFor(() => !p.pet.action, 4000);      // let a running motion finish first
                    if (gen !== scriptGen) return;
                    if (a.id === 'wave') petVoice(p);     // 태그로 시킨 인사에도 목소리
                    p.pet.action = { id: a.id, t: 0 };
                    await waitFor(() => !p.pet.action, 7000);
                }
            } else if (a.kind === 'goto') {
                await actGoto(p, a.id, gen);
            } else if (a.kind === 'mount') {
                const bed = BEDS.find((b) => b.id === a.id && !b.occupant);
                if (!bed || (p.bed && p.bed.id === a.id)) continue;
                await freeForScript(p);
                if (gen !== scriptGen || p === possessed) continue;
                mountBed(p, bed);
                await waitFor(() => p.bedPhase === 'lying' || !p.bed, 25000);
            } else if (a.kind === 'swim') {
                if (p.dip) continue;
                await freeForScript(p);
                if (gen !== scriptGen || p === possessed) continue;
                startDip(p, a.id);
                await waitFor(() => !p.dip || p.dip.phase !== 'approach', 25000);
            } else if (a.kind === 'drive') {
                await actDrive(p, gen);
            } else if (a.kind === 'game') {
                if (a.id === 'hideseek' && !duoBusy && !hideSeekGame && !buildMode) {
                    worldHideSeek(p);   // 태그를 뱉은 펫이 술래 (주인이 조종 중이면 주인이 숨는다)
                    await waitFor(() => !hideSeekGame, 150000);
                } else if (a.id === 'treasure') {
                    refreshDigState();
                    const w = digSpotWorld();
                    if (w && digState && !digState.dug && !digDoing) {
                        await freeForScript(p);
                        if (gen !== scriptGen || p === possessed) continue;
                        await Promise.race([gotoAsync(p, w.x + 0.3, w.z + 0.2), sleepMs(30000)]);
                        if (gen !== scriptGen) continue;
                        p.ai.state = 'busy';
                        await startDig(p);
                        releaseAI(p);
                    }
                }
            } else if (a.kind === 'drink' || a.kind === 'snack') {
                await actGoto(p, a.kind === 'drink' ? 'coffee' : 'snack', gen);
                if (gen !== scriptGen || p === possessed) continue;
                if (a.kind === 'drink') { const d = DRINKS.find((x) => x.id === a.id); if (d) giveDrink(p, d); }
                else { const f = FOODS.find((x) => x.id === a.id); if (f) giveFood(p, f); }
                await sleepMs(600);
            } else if (a.kind === 'hat') {
                setGlbPetAccessory(p.pet, a.id === 'off' ? null : a.id);
                logWorldEvent(`${petKo(p)}가 산타모자를 ${a.id === 'off' ? '벗었다' : '썼다'}`);
                await sleepMs(400);
            }
        } catch (e) { console.error('[World] action failed', a, e); }
    }
    if (gen === scriptGen && !p.pet.action && !p.pet.sleeping && !p.bed && !p.dip && p !== possessed
        && (p.ai.state === 'goto' || p.ai.state === 'busy')) releaseAI(p, 1);
}

async function sendWorldChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    if (waitingReply) { showToast('아직 대답을 생각하는 중…'); return; }
    chatInput.value = '';
    const pet = pickResponder(text);
    if (!pet) return;
    pushChatLog('주인', text);
    const speech = await requestWorldChat(pet, text);
    if (speech) maybeFriendChime(pet, text, speech);
}

// 한 턴의 공통 파이프(주인 채팅·선제 대화·절친 거들기 공용): think 포즈 → /api/world_chat →
// 말풍선·로그·행동 태그 실행. 성공하면 말한 내용을 돌려준다.
async function requestWorldChat(pet, text) {
    responder = pet;
    startWaiting();
    let reply = null;
    try {
        const res = await fetch('/api/world_chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pet: pet.name,
                text,
                snapshot: buildWorldSnapshot(pet),
                events: recentEventsText(),
            }),
        });
        if (res.ok) reply = (await res.json()).reply;
        else console.error('[World] chat http', res.status, await res.text().catch(() => ''));
    } catch (e) { console.error('[World] chat failed', e); }
    if (!waitingReply) return null;                               // timed out / cancelled meanwhile
    if (!reply) {
        stopWaiting(false);
        showBubbleTyped('으엥, 대답이 안 나와… 메인 모델 설정을 확인해줘! 💦');
        return null;
    }
    const { speech, actions } = parseWorldReply(reply);
    stopWaiting(true, actions.length === 0);       // 행동이 이어지면 해피 홉 생략 — 행동이 곧 리액션이니까
    if (speech) {
        petVoice(pet);                                    // 말풍선과 함께 짹짹/멍멍
        showBubbleTyped(speech);
        pushChatLog(petKo(pet), speech);
    }
    if (actions.length) runWorldActions(pet, actions);
    return speech || null;
}

// ③ 절친 거들기: 둘 다 부르거나 무리로 부르면 반드시, 이름 없이 말하면 가끔(35%) 옆에서
// 한마디 얹는다. 첫 펫의 말풍선이 타자로 다 나올 즈음에 이어받는다.
function maybeFriendChime(first, ownerText, firstSpeech) {
    const friend = pets.find((q) => q !== first);
    if (!friend || friend.pet.sleeping) return;
    const bothNamed = /병아리|삐약|chick/i.test(ownerText) && /강아지|멍멍|댕댕|puppy/i.test(ownerText);
    const groupCall = /얘들아|애들아|둘\s*다|너희|같이|모두/.test(ownerText);
    if (!(bothNamed || groupCall) && Math.random() > 0.35) return;
    const delay = Math.min(7000, 1000 + firstSpeech.length * 45);
    setTimeout(() => {
        if (waitingReply || buildMode) return;
        requestWorldChat(friend, `(주인이 방금 "${ownerText}"라고 말했고, 절친 ${petKo(first)}가 "${firstSpeech}"라고 대답했다. 너도 옆에서 들었다는 듯 자연스럽게 짧게 한마디 거들어라.)`);
    }, delay);
}

// ② 선제 대화: 특별한 순간에 펫이 먼저 말을 건다. 8분 쿨다운 + 대화·공사 중이거나 창이
// 백그라운드면 건너뛴다 (호출 비용도 그래서 가볍다). cue는 서버 히스토리에 남아 기억도 된다.
let lastProactiveAt = 0;
function maybeProactive(pet, cue) {
    if (waitingReply || buildMode || !winFocused) return;
    if (Date.now() - lastProactiveAt < 8 * 60000) return;
    const p = pet || pets[Math.floor(Math.random() * pets.length)];
    if (!p || p.pet.sleeping) return;
    lastProactiveAt = Date.now();
    requestWorldChat(p, `(주인은 아직 아무 말도 하지 않았다. ${cue} 지금 상황에 맞게 네가 먼저 주인에게 한두 문장으로 말을 걸어라. 어울리면 행동 태그도 붙여라.)`);
}
// 오랜만에 돌아오면 반겨준다 — 3시간 이상 비웠다가 열었을 때, 씬·펫이 자리 잡은 뒤 한 번.
setTimeout(() => {
    const last = +localStorage.getItem('world-last-seen') || 0;
    if (last && Date.now() - last > 3 * 3600000) maybeProactive(null, '주인이 오랜만에 월드에 돌아왔다!');
    try { localStorage.setItem('world-last-seen', String(Date.now())); } catch (e) {}
}, 12000);
setInterval(() => { try { localStorage.setItem('world-last-seen', String(Date.now())); } catch (e) {} }, 60000);

function startWaiting() {
    waitingReply = true;
    if (responder) { responder.pet.sleeping = false; responder.pet.autoSleeping = false; }
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = setTimeout(() => stopWaiting(false), 60000);
    if (thinkTimer) clearInterval(thinkTimer);
    thinkTimer = setInterval(() => {
        if (!waitingReply || !responder) return;
        const free = !responder.pet.action && !responder.pet.sleeping
            && responder.ai.state !== 'goto' && responder.ai.state !== 'busy';
        if (free) responder.pet.action = { id: 'think', t: 0 };
    }, 400);
}

function stopWaiting(success, hop = success) {
    waitingReply = false;
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
    if (responder) {
        if (responder.pet.action && responder.pet.action.id === 'think') responder.pet.action = null;
        if (hop && !responder.pet.action) responder.pet.action = { id: 'happy', t: 0 };
    }
    if (!success) hideBubbleSoon();
}

// Camera-relative basis for the keyboard pet controller. (Camera moves are all mouse-driven now:
// drag = orbit, right-drag/two-finger = pan, wheel = the smoothed zoom above.)
const UP = new THREE.Vector3(0, 1, 0);

// ---- Player control (조종): pick 🎮 in a pet's menu, then the arrow keys move it relative to the
// camera (↑ pushes it away from you) and Space hops. The AI parks in a dedicated 'player' state and
// Esc / the menu releases it. The jump lives on the mover's Y, so the shared motions' bob stacks
// cleanly on top; ground height always comes from the world interface.
let possessed = null;
const heldKeys = new Set();
let jumpVy = 0;
let airborne = false;
let jumpsLeft = 2;   // 점프 소지 수 — 착지마다 2로 리셋. 점프로 떠나면 1 남고, 걸어서/뛰어내려서
                     // 떠나면 2 그대로라 높은 데서 내려올 때도 "점프+더블"이 온전히 된다 (시중 문법).
let running = false;    // Shift toggles 걷기 ↔ 달리기 (2×)

const selectRing = new THREE.Mesh(
    new THREE.RingGeometry(0.26, 0.34, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
);
selectRing.rotation.x = -Math.PI / 2;
selectRing.visible = false;
scene.add(selectRing);

const controlHint = document.createElement('div');
// 📱 터치에선 좌하단이 조이스틱 자리라 힌트를 좌상단으로 올린다.
controlHint.style.cssText = `position:fixed; left:14px; ${IS_TOUCH ? 'top:calc(14px + env(safe-area-inset-top, 0px));' : 'bottom:14px;'} display:none; z-index:90; background:rgba(30,32,40,0.85); color:#fff; font-size:12px; font-family:sans-serif; padding:8px 12px; border-radius:10px; box-shadow:0 3px 10px rgba(0,0,0,0.3); pointer-events:none;`;
document.body.appendChild(controlHint);

// 📱 마인크래프트 모바일식 조종 UI: 좌하단 가상 조이스틱(민 방향으로 이동, 70% 넘게 밀면
// 달리기) + 우하단 액션 버튼(🦘 점프 · ✋ 상호작용 · ✕ 해제). 터치 기기에서 조종 중일 때만
// 보인다. 조이스틱은 자기 엘리먼트에 setPointerCapture를 걸어 손가락이 원 밖으로 미끄러져도
// 놓치지 않고, 캔버스(카메라 드래그)와 이벤트가 섞이지 않는다 — 왼엄지 이동 + 오른엄지 시점
// 회전이 동시에 된다.
const touchMove = { x: 0, z: 0, mag: 0, active: false };
let touchUI = null;
let resetTouchStick = () => {};
if (IS_TOUCH) {
    touchUI = document.createElement('div');
    touchUI.id = 'world-touch-ui';
    touchUI.style.cssText = 'position:fixed; inset:0; display:none; z-index:94; pointer-events:none;';
    const stickBase = document.createElement('div');
    stickBase.style.cssText = 'position:absolute; left:20px; bottom:calc(88px + env(safe-area-inset-bottom, 0px)); width:124px; height:124px; border-radius:50%; background:rgba(30,32,40,0.35); border:2px solid rgba(255,255,255,0.4); pointer-events:auto; touch-action:none;';
    const stickKnob = document.createElement('div');
    stickKnob.style.cssText = 'position:absolute; left:50%; top:50%; width:54px; height:54px; border-radius:50%; background:rgba(255,255,255,0.78); box-shadow:0 2px 8px rgba(0,0,0,0.35); transform:translate(-50%,-50%);';
    stickBase.appendChild(stickKnob);
    touchUI.appendChild(stickBase);
    let stickId = null;
    const STICK_R = 44;                                           // 노브 이동 반경(px)
    const setStick = (e) => {
        const r = stickBase.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2);
        let dy = e.clientY - (r.top + r.height / 2);
        const len = Math.hypot(dx, dy);
        if (len > STICK_R) { dx *= STICK_R / len; dy *= STICK_R / len; }
        stickKnob.style.transform = `translate(calc(${Math.round(dx)}px - 50%), calc(${Math.round(dy)}px - 50%))`;
        const mag = Math.min(1, len / STICK_R);
        if (mag < 0.15) { touchMove.active = false; touchMove.x = touchMove.z = touchMove.mag = 0; return; }   // 데드존
        touchMove.active = true;
        touchMove.mag = mag;
        touchMove.x = dx / STICK_R;
        touchMove.z = -dy / STICK_R;                              // 화면 위쪽 = 카메라 기준 앞
    };
    resetTouchStick = () => {
        stickId = null;
        touchMove.active = false; touchMove.x = touchMove.z = touchMove.mag = 0;
        stickKnob.style.transform = 'translate(-50%,-50%)';
    };
    stickBase.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        stickId = e.pointerId;
        try { stickBase.setPointerCapture(e.pointerId); } catch (err) {}
        setStick(e);
    });
    stickBase.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) setStick(e); });
    const stickEnd = (e) => { if (e.pointerId === stickId) resetTouchStick(); };
    stickBase.addEventListener('pointerup', stickEnd);
    stickBase.addEventListener('pointercancel', stickEnd);
    stickBase.addEventListener('lostpointercapture', stickEnd);

    const btnCol = document.createElement('div');
    btnCol.style.cssText = 'position:absolute; right:78px; bottom:calc(88px + env(safe-area-inset-bottom, 0px)); display:flex; flex-direction:column; align-items:center; gap:14px;';
    const actionBtn = (label, size, onPress) => {
        const b = document.createElement('div');
        b.textContent = label;
        b.style.cssText = `width:${size}px; height:${size}px; display:flex; align-items:center; justify-content:center; border-radius:50%; background:rgba(30,32,40,0.55); border:2px solid rgba(255,255,255,0.4); color:#fff; font-size:${Math.round(size * 0.44)}px; pointer-events:auto; touch-action:none; user-select:none; -webkit-user-select:none;`;
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); onPress(); });
        btnCol.appendChild(b);
        return b;
    };
    actionBtn('✕', 44, () => escapeAction());                     // Esc
    actionBtn('🦘', 48, () => doJump());                          // Space
    actionBtn('✋', 48, () => doInteract());                      // Ctrl/⌘ — 독(📷) 버튼과 같은 크기
    touchUI.appendChild(btnCol);
    document.body.appendChild(touchUI);
}

function possessPet(p) {
    // 조종은 무조건 성공: whatever the pet was doing gets cleanly taken over. Bed/seat → instant
    // dismount; passenger seat → hop out; dips end themselves next frame (updateDips checks
    // possessed); any director awaiting this pet's arrival is resolved so it can never deadlock
    // (its later releaseAI calls no-op against the 'player' state).
    if (p.ai.state === 'held') releaseHandHold();                 // let go before switching drivers
    if (carDrive && carDrive.passenger === p) {
        const rX = Math.cos(CAR.heading), rZ = -Math.sin(CAR.heading);
        p.mover.position.x = CAR.x + rX * 0.85;
        p.mover.position.z = CAR.z + rZ * 0.85;
        p.mover.position.y = world.groundHeightAt(p.mover.position.x, p.mover.position.z);
        carDrive.passenger = null;
    }
    forceEndBed(p);
    if (p.ai.onArrive) {
        const done = p.ai.onArrive;
        p.ai.onArrive = null;
        done();
    }
    releasePossession();
    possessed = p;
    scriptGen++;                                                  // cancel any running action script
    logWorldEvent(`주인이 ${petKo(p)}를 직접 조종하기 시작했다`);
    p.pet.sleeping = false; p.pet.autoSleeping = false;
    p.ai.state = 'player';
    p.pet.walking = false;
    selectRing.visible = true;
    controlHint.textContent = IS_TOUCH
        ? `🎮 ${p.name === 'chick' ? '병아리' : '강아지'} 조종 중 — 조이스틱 이동(끝까지 밀면 달리기) · 🦘 점프 · ✋ 상호작용 · ✕ 해제`
        : `🎮 ${p.name === 'chick' ? '병아리' : '강아지'} 조종 중 — 방향키 이동 · Space 점프(공중 더블) · Esc 해제`;
    controlHint.style.display = 'block';
    if (touchUI) touchUI.style.display = 'block';
}
function releasePossession() {
    if (!possessed) return;
    const p = possessed;
    possessed = null;
    airborne = false; jumpVy = 0; jumpsLeft = 2;
    seaHop = null;
    if (carDrive) exitCar();
    if (boatRide) exitBoat(true);   // 강제 하선 — 거절 없이 (절친은 기슭 or 물에)
    if (planeRide) exitPlane(true); // 강제 하기 — 공중이면 비상 착륙 후 내려준다
    if (balloonRide && !balloonRide.isAI) exitBalloonForce(); // 라이더는 계류장으로, 빈 열기구는 자율 귀환
    if (ferryRide && !ferryRide.isAI && (ferryRide.p === p || ferryRide.friend === p)) exitFerryForce(); // 본섬 잔교로
    cancelPhoneCall();   // 통화 중이었으면 끊는다
    releaseHandHold();
    running = false;
    snapToLand(p);
    if (p.ai.state === 'player') { p.ai.state = 'idle'; releaseAI(p); }
    logWorldEvent(`주인이 ${petKo(p)} 조종을 마쳤다`);
    heldKeys.clear();
    resetTouchStick();
    selectRing.visible = false;
    controlHint.style.display = 'none';
    if (touchUI) touchUI.style.display = 'none';
}

const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
// 조종 액션 3종 — 키보드(Space·Ctrl/⌘·Esc)와 터치 버튼(🦘·✋·✕)이 같은 함수를 부른다.
function doJump() {
    if (!possessed) return;
    if (planeRide) return;   // 🛩️ 탑승 중 Space 무시 — 고도는 W/S
    if (balloonRide && (balloonRide.p === possessed || balloonRide.friend === possessed)) return;   // 🎈 바구니에서 점프 금지
    if (ferryRide && (ferryRide.p === possessed || ferryRide.friend === possessed)) return;   // ⛴️ 갑판에서 점프 금지
    if (fishing && (fishing.state === 'bite' || fishing.state === 'wait')) { fishingIntercept(); return; }   // Space도 챔질
    if (fishing && fishing.state !== 'idle') return;   // 시전·파이팅 중 점프 잠금
    if (jumpsLeft <= 0) return;
    const airPress = airborne;                                    // 공중 발동 = 폴짝 이펙트 대상
    const full = jumpsLeft === 2;                                 // 지상 점프를 아직 안 썼다 — 걸어서 떨어진 직후 포함
    jumpsLeft -= 1;
    airborne = true;
    // 첫 점프(지상 또는 낙하 중 첫 발동)는 풀파워 3.0(~0.64m), 두 번째는 2.7 — 정점에서 이으면
    // 합산 ~1.15m로 부스 지붕·우편함이 사다리 한 칸이 된다. 물에서는 첨벙 홉 1.7.
    jumpVy = full ? (possessed.swimming ? 1.7 : 3.0) : 2.7;
    if (!airPress) return;
    const p = possessed;                                          // 공기 폴짝 이펙트 — 발밑 글로우 링
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spr = glowSprite(0xffffff, 0.09 + Math.random() * 0.05, 0.8);
        spr.position.set(p.mover.position.x + Math.cos(a) * 0.09, p.mover.position.y + 0.03, p.mover.position.z + Math.sin(a) * 0.09);
        scene.add(spr);
        hugBurst.push({ spr, vx: Math.cos(a) * 0.5, vy: -0.15, vz: Math.sin(a) * 0.5, t: 0.35 });
    }
}
function escapeAction() {
    releasePossession();
    hideMenu();
    radioPanel.style.display = 'none';
    coffeePanel.style.display = 'none';
    foodPanel.style.display = 'none';
    hideSipMenu();
}
function doInteract() {
    // Interaction (Ctrl/⌘ or ✋): climb out of the sea near a cliff; take/release the friend's
    // hand; enter/exit the car; tuck into a bed; open the coffee/food/radio panels; or cycle a
    // streetlamp — in that priority order.
    if (!possessed) return;
    if (fishingIntercept()) return;   // 🎣 입질 챔질 / 성급 걷어들이기 / 연출 중 잠금
    if (ferryRide && (ferryRide.p === possessed || ferryRide.friend === possessed)) { requestFerryExit(); return; }
    if (balloonRide && (balloonRide.p === possessed || balloonRide.friend === possessed)) { requestBalloonExit(); return; }
    if (planeRide) {
        if (PLANE.mode === 'fly') { showToast('🛩️ 공중이에요 — S로 내려가 지면·수면에 닿으면 착륙!'); return; }
        exitPlane();
        return;
    }
    if (boatRide) { exitBoat(); return; }
    if (possessed.swimming === 'sea') {
        const pos = possessed.mover.position;
        if (Math.hypot(pos.x - BOAT.x, pos.z - BOAT.z) < 1.15) { enterBoat(); return; }   // 헤엄쳐 와서 승선
        if (Math.hypot(pos.x - PLANE.x, pos.z - PLANE.z) < 1.35 && PLANE.mode === 'parked') { enterPlane(); return; }   // 물에 뜬 비행기도 승선
        const spot = nearestClimbSpot(pos);
        if (spot && !seaHop) {
            seaHop = { fx: pos.x, fy: pos.y, fz: pos.z, tx: spot.tx, tz: spot.tz, ty: spot.ty, t: 0 };
            return;
        }
        if (handHold) releaseHandHold();
        return;
    }
    if (carDrive) { exitCar(); return; }
    if (Math.hypot(possessed.mover.position.x - CAR.x, possessed.mover.position.z - CAR.z) < 1.15) {
        enterCar();
        return;
    }
    if (Math.hypot(possessed.mover.position.x - BOAT.x, possessed.mover.position.z - BOAT.z) < 1.25) {
        enterBoat();   // 물가에 정박한 보트 — 뭍에서 폴짝 올라탄다
        return;
    }
    if (PLANE.mode === 'parked' && Math.hypot(possessed.mover.position.x - PLANE.x, possessed.mover.position.z - PLANE.z) < 1.4) {
        enterPlane();   // 🛩️ 주차된 경비행기 — 조종석으로
        return;
    }
    if (BALLOON.mode === 'docked' && !balloonRide
        && Math.hypot(possessed.mover.position.x - BALLOON.x, possessed.mover.position.z - BALLOON.z) < 1.35) {
        enterBalloon(possessed);   // 🎈 계류장 열기구 — 바구니로 (절친이 곁에 있으면 함께)
        return;
    }
    if ((FERRY.mode === 'docked' || FERRY.mode === 'dwell') && !(ferryRide && ferryRide.p && ferryRide.friend)
        && Math.hypot(possessed.mover.position.x - FERRY.x, possessed.mover.position.z - FERRY.z) < 1.7) {
        enterFerry(possessed);   // ⛴️ 정박 중 통통호 — 갑판으로 (본섬 출항 / 모래섬 합류)
        return;
    }
    {   // 🐚 조개 줍기 — 곁에 있으면 ⌘
        const sh = nearestShell(0.85);
        if (sh) { pickShell(sh); return; }
    }
    if (handHold) { releaseHandHold(); return; }
    if (tryGrabHand()) return;
    const bed = !possessed.bed && nearestFreeBed(possessed, 0.95);
    if (bed) { mountBed(possessed, bed); return; }
    if (digState && !digState.dug && !digDoing) {   // ⛏️ 보물: 반짝이는 자리 옆에서 ⌘ = 파기
        const w = digSpotWorld();
        if (w && Math.hypot(possessed.mover.position.x - w.x, possessed.mover.position.z - w.z) < 0.8) {
            startDig(possessed);
            return;
        }
    }
    if (nearestPropDist(possessed, 'piano') < 1.0) {   // 🎹 조종 펫이 직접 연주 (몸 동작 = ⌘)
        petPlayPiano(possessed);
        return;
    }
    if (nearestPropDist(possessed, 'gym') < 1.1) {   // 🧘 조종 펫이 직접 스트레칭 (몸 동작 = ⌘)
        petStretch(possessed);
        return;
    }
    if (nearestPropDist(possessed, 'library') < 1.1) {   // 📚 조종 펫이 직접 독서 (몸 동작 = ⌘)
        petRead(possessed);
        return;
    }
    if (nearestPropDist(possessed, 'coffee') < 1.1) {
        toggleCoffeePanel();
        return;
    }
    if (nearestPropDist(possessed, 'food') < 1.1) {
        toggleFoodPanel();
        return;
    }
    if (nearestPropDist(possessed, 'radio') < 1.0) {
        toggleRadioPanel();
        return;
    }
    if (nearestPropDist(possessed, 'lamp') < 1.0) {
        cycleLampBrightness();
    }
}
// Streetlamp brightness cycles in steps (persisted) — ⌘ at a lamp or a direct click both land here.
function cycleLampBrightness() {
    const steps = [0, 0.25, 0.5, 0.75, 1];
    const idx = steps.findIndex((s) => Math.abs(s - lampBrightness) < 0.125);
    lampBrightness = steps[(idx + 1) % steps.length];
    try { localStorage.setItem('worldLampBrightness', String(lampBrightness)); } catch (err) {}
    updateDayNight(true);
    showToast(`💡 가로등 밝기 ${Math.round(lampBrightness * 100)}%`);
}
window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;        // typing in the chat bar
    if (e.key === 'Escape') { if (constelMode) { endConstellationMode(); return; } if (buildMode) { setBuildMode(false); return; } escapeAction(); return; }   // 🔨 공사 중 Esc = 공사 종료(저장)
    if (!possessed) return;
    if (ARROW_KEYS.includes(e.key)) { heldKeys.add(e.key); e.preventDefault(); }
    else if (e.code === 'KeyW' || e.code === 'KeyS') { heldKeys.add(e.code); e.preventDefault(); }   // 🛩️ 비행 고도 (W=상승 S=하강, 한/영 무관 e.code)
    else if (e.code === 'Space') { e.preventDefault(); doJump(); }
    else if (e.key === 'Shift') {
        e.preventDefault();
        running = !running;                                       // 🚶 ↔ 🏃
    }
    else if (e.key === 'Control' || e.key === 'Meta') { e.preventDefault(); doInteract(); }
});
window.addEventListener('keyup', (e) => { heldKeys.delete(e.key); heldKeys.delete(e.code); });
window.addEventListener('blur', () => { heldKeys.clear(); resetTouchStick(); });   // 앱 전환 시 스틱도 초기화

// Swimming (조종 전용): the player pet may wade into the pond or dive off the rim into the sea —
// the wander AI never does (world.isBlocked still fences it). Support height decides the medium;
// in water the pet floats half-submerged with a gentle bob, leans forward and paddles.
const pondPropRef = PROPS.find((q) => q.type === 'pond');
const POND_WATER_Y = terrainHeight(pondPropRef.x, pondPropRef.z) + 0.06;
const SWIM_LEASH = 18;                           // 위성섬 + 휴양지 모래섬(중심 12.2, r 2.6)까지 수영 가능
let seaHop = null;                               // climb-back tween { fx,fy,fz, tx,ty,tz, t }

function playerBlocked(nx, nz) {
    if (Math.hypot(nx, nz) > SWIM_LEASH) return true;
    for (const q of PROPS) {
        if (q.type === 'pond') continue;                          // the pond is swimmable
        if (Math.hypot(nx - q.x, nz - q.z) < q.r) return true;
    }
    return false;                                                 // no rim fence — diving is allowed
}
// 마크식 등반: 발밑(+살짝 위)에서 아래로 쏜 레이가 맞는 소품 윗면의 y — "어떤 사물이든 위에 설 수
// 있다"의 지지면. 근처 소품의 원본 메시에만 쏜다(베이크로 숨겨져도 Raycaster는 visible 무시 —
// 병합 메시는 삼각형이 수만 개라 브루트포스 레이캐스트가 비싸서 절대 금지). 조종 펫 전용이라
// 프레임당 1~2회, 소품 몇 개 대상이면 공짜 수준.
const climbRay = new THREE.Raycaster();
const _climbO = new THREE.Vector3();
const _climbD = new THREE.Vector3(0, -1, 0);
function propTopAt(x, z, fromY) {
    _climbO.set(x, fromY, z);
    climbRay.set(_climbO, _climbD);
    climbRay.camera = camera;   // 서브트리에 Sprite가 있으면 Sprite.raycast가 camera를 읽는다 — 없으면 null.matrixWorld 크래시 (실제로 터졌음)
    climbRay.far = fromY + 2;
    let best = null;
    const take = (hits) => {
        for (const h of hits) {
            // 메시 윗면만 바닥이다 — Sprite(빌보드)·Points(꽃잎/낙엽 구름: 여름엔 invisible이어도
            // 레이캐스트엔 잡히고 threshold 1m라 허공을 바닥으로 만든다 → 나무 위 공중부양의 원인)
            if (!h.object.isMesh) continue;
            if (h.object.material === snowCapMat && !h.object.visible) continue;   // 꺼진 계절 눈모자(투명)도 바닥 아님
            const y = h.point.y;
            if (y <= fromY + 0.001 && y > 0.04 && (best === null || y > best)) best = y;   // 지면 데칼(블롭·리본)은 제외
        }
    };
    for (const q of PROPS) {
        if (!q.obj || q.type === 'pond' || q.type === 'hugspot') continue;   // 수영장·바닥 데칼은 못 올라선다
        const rr = (q.type === 'house' ? 2.2 : Math.max(q.r || 0, 0.5)) + 0.5;   // 차(carCollider)도 PROPS라 지붕 포함
        const dx = x - q.x, dz = z - q.z;
        if (dx * dx + dz * dz > rr * rr) continue;
        // 등반은 매 프레임 핫루프 — 특이한 자식 하나가 던져도 앱이 얼지 않게 소품 단위 가드 (1회 로그)
        try { take(climbRay.intersectObject(q.obj, true)); }
        catch (e) {
            if (!propTopAt._warned) { propTopAt._warned = true; reportClientError(`propTopAt(${q.type}): ${e && e.message}`); }
        }
    }
    return best;
}
function playerSupportY(p, x, z) {
    let base;
    if (Math.hypot(x - pondPropRef.x, z - pondPropRef.z) < 0.55) {
        base = { y: POND_WATER_Y - p.height * 0.45, medium: 'pond' };
    } else {
        const hf = houseFloorY(x, z);
        const hit = hf === null && onBridge(x, z);
        if (hf !== null) base = { y: hf, medium: 'land' };
        else if (hit) base = { y: bridgeDeckY(hit), medium: 'land' };
        else {
            base = { y: OCEAN_LEVEL + tideOffset() + 0.02 - p.height * 0.45, medium: 'sea' };   // 수영 높이도 조수를 탄다
            for (const s of ISLANDS) {
                if (Math.hypot(x - s.x, z - s.z) < s.r - 0.05) {
                    base = { y: terrainHeight(x, z), medium: 'land' };
                    break;
                }
            }
        }
    }
    // 발이 소품 윗면 이상일 때만 그 윗면이 지지면이 된다 — 아래에서 점프해 지붕을 "뚫고" 올라서는
    // 순간이동 방지 (fromY를 발높이 기준으로 좁게 잡는 것이 핵심).
    const top = propTopAt(x, z, p.mover.position.y + 0.06);
    if (top !== null && top > base.y + 0.02) return { y: top, medium: 'land' };
    return base;
}
// Closest climbable rim while swimming — works for every island in the archipelago.
function nearestClimbSpot(pos) {
    for (const s of ISLANDS) {
        const dx = pos.x - s.x, dz = pos.z - s.z;
        const rr = Math.hypot(dx, dz);
        if (rr >= s.r - 0.05 && rr < s.r + 0.6) {
            const k = (s.r - 0.5) / (rr || 1);
            const tx = s.x + dx * k, tz = s.z + dz * k;
            return { tx, tz, ty: terrainHeight(tx, tz) };
        }
    }
    return null;
}
function nearestPropDist(p, type) {
    let best = Infinity;
    for (const q of PROPS) {
        if (q.type !== type) continue;
        const d = Math.hypot(p.mover.position.x - q.x, p.mover.position.z - q.z);
        if (d < best) best = d;
    }
    return best;
}

function updatePlayer(delta) {
    if (!possessed) return;
    const p = possessed;
    if (p.ai.state !== 'player') { releasePossession(); return; }   // something reclaimed it — let go
    if (seaHop) {
        // Climbing back up the cliff: a short arc from the water onto the rim.
        seaHop.t += delta;
        const k = Math.min(1, seaHop.t / 0.55);
        const e = k * k * (3 - 2 * k);
        p.mover.position.x = THREE.MathUtils.lerp(seaHop.fx, seaHop.tx, e);
        p.mover.position.z = THREE.MathUtils.lerp(seaHop.fz, seaHop.tz, e);
        p.mover.position.y = THREE.MathUtils.lerp(seaHop.fy, seaHop.ty, e) + Math.sin(k * Math.PI) * 0.55;
        p.pet.walking = false;
        if (k >= 1) { seaHop = null; p.swimming = false; p.mover.rotation.x = 0; airborne = false; jumpVy = 0; jumpsLeft = 2; }
        return;
    }
    if (carDrive) {
        // Driving: ↑/↓ throttle & reverse, ←/→ steer (steering authority grows with speed).
        let acc = 0;
        if (heldKeys.has('ArrowUp')) acc += 3.4;
        if (heldKeys.has('ArrowDown')) acc -= 2.8;
        if (touchMove.active) acc += 3.4 * Math.max(0, touchMove.z) - 2.8 * Math.max(0, -touchMove.z);   // 📱 스틱 전후 = 가속·후진
        let steer = (heldKeys.has('ArrowLeft') ? 1 : 0) - (heldKeys.has('ArrowRight') ? 1 : 0);
        if (touchMove.active) steer = THREE.MathUtils.clamp(steer - touchMove.x, -1, 1);   // 📱 스틱 좌우 = 핸들
        stepCar(acc, steer, delta, p);
        const driveHint = IS_TOUCH
            ? `🚗 ${p.name === 'chick' ? '병아리' : '강아지'} 운전 중${carDrive.passenger ? ' 👥' : ''} — 스틱 가속·핸들 · ✋ 내리기 · ✕ 해제`
            : `🚗 ${p.name === 'chick' ? '병아리' : '강아지'} 운전 중${carDrive.passenger ? ' 👥' : ''} — ↑↓ 가속·후진 · ←→ 핸들 · Ctrl/⌘ 내리기 · Esc 해제`;
        if (controlHint.textContent !== driveHint) controlHint.textContent = driveHint;
        return;
    }
    if (ferryRide && (ferryRide.p === possessed || ferryRide.friend === possessed)) {
        const fHint = FERRY.mode === 'dwell'
            ? '⛴️ 모래섬 정박 중 — ⌘ 하차 · 잠시 후 출항'
            : FERRY.mode === 'docked' ? '⛴️ 본섬 잔교 — ⌘ 하차'
            : `⛴️ ${petKo(p)} 통통호 항해 중${ferryRide.friend ? ' 👥' : ''} — 자동 운항 · ⌘ 퐁당 하차 · Esc 해제`;
        if (controlHint.textContent !== fHint) controlHint.textContent = fHint;
        return;
    }
    if (balloonRide && (balloonRide.p === possessed || balloonRide.friend === possessed)) {
        const bHint = BALLOON.mode === 'land'
            ? '🎈 정거장으로 귀환 중 — 도착하면 내려요'
            : `🎈 ${petKo(p)} 하늘 산책 중${balloonRide.friend ? ' 👥' : ''} — 자동 운행 · Ctrl/⌘ 하차(저공 물 위 = 퐁당) · Esc 해제`;
        if (controlHint.textContent !== bHint) controlHint.textContent = bHint;
        return;
    }
    if (planeRide) {
        stepPlane(delta, p);
        const flyHint = PLANE.mode === 'fly'
            ? (IS_TOUCH ? `🛩️ ${petKo(p)} 비행 중${planeRide && planeRide.passenger ? ' 👥' : ''} — 스틱 상하 고도·좌우 방향 · ✕ 해제`
                : `🛩️ ${petKo(p)} 비행 중${planeRide && planeRide.passenger ? ' 👥' : ''} — W/S 고도 · ←→ 방향 · ↑↓ 속도 (내려앉으면 착륙)`)
            : (IS_TOUCH ? `🛩️ ${petKo(p)} 활주 중 — 스틱 가속·방향 (전속력=이륙!) · ✋ 내리기 · ✕ 해제`
                : `🛩️ ${petKo(p)} 활주 중 — ↑ 가속 (전속력=이륙!) · ←→ 방향 · Ctrl/⌘ 내리기 · Esc 해제`);
        if (controlHint.textContent !== flyHint) controlHint.textContent = flyHint;
        return;
    }
    if (boatRide) {
        // 노 젓기: ↑/↓ 전진·후진, ←/→ 방향 (차와 같은 키, 물의 관성)
        let acc = 0;
        if (heldKeys.has('ArrowUp')) acc += 1.9;
        if (heldKeys.has('ArrowDown')) acc -= 1.4;
        if (touchMove.active) acc += 1.9 * Math.max(0, touchMove.z) - 1.4 * Math.max(0, -touchMove.z);
        let steer = (heldKeys.has('ArrowLeft') ? 1 : 0) - (heldKeys.has('ArrowRight') ? 1 : 0);
        if (touchMove.active) steer = THREE.MathUtils.clamp(steer - touchMove.x, -1, 1);
        if (fishing && fishing.state !== 'idle' && (acc !== 0 || steer !== 0)) cancelFishing(true);   // 노 저으면 걷어들인다
        stepBoat(acc, steer, delta, p);
        const rowHint = IS_TOUCH
            ? `🚣 ${p.name === 'chick' ? '병아리' : '강아지'} 노 젓는 중${boatRide.passenger ? ' 👥' : ''} — 스틱 젓기·방향 · ✋ 내리기 · ✕ 해제`
            : `🚣 ${p.name === 'chick' ? '병아리' : '강아지'} 노 젓는 중${boatRide.passenger ? ' 👥' : ''} — ↑↓ 노 젓기·후진 · ←→ 방향 · Ctrl/⌘ 내리기(물로 퐁당) · Esc 해제`;
        if (controlHint.textContent !== rowHint) controlHint.textContent = rowHint;
        return;
    }
    // 🎣 낚시 입력 규칙: 대기·입질 중 이동 입력 = 조용히 걷어들이고 걷기 재개, 시전·파이팅·연출 중 = 입력 잠금
    if (fishing && fishing.p === p && fishing.state !== 'idle') {
        const moveInput = heldKeys.has('ArrowUp') || heldKeys.has('ArrowDown') || heldKeys.has('ArrowLeft') || heldKeys.has('ArrowRight') || touchMove.active;
        if (fishing.state === 'wait' || fishing.state === 'bite') {
            if (moveInput) cancelFishing(true);
        } else {
            p.pet.walking = false;
            return;
        }
    }
    let ix = 0, iz = 0;
    if (heldKeys.has('ArrowUp')) iz += 1;
    if (heldKeys.has('ArrowDown')) iz -= 1;
    if (heldKeys.has('ArrowLeft')) ix -= 1;
    if (heldKeys.has('ArrowRight')) ix += 1;
    if (touchMove.active) { ix = touchMove.x; iz = touchMove.z; }   // 📱 가상 조이스틱이 방향키를 대신한다
    if (ix !== 0 || iz !== 0) {
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd); fwd.y = 0;
        if (fwd.lengthSq() > 1e-6) {
            fwd.normalize();
            const right = new THREE.Vector3().crossVectors(fwd, UP);
            const dir = right.multiplyScalar(ix).add(fwd.multiplyScalar(iz)).normalize();
            const desired = Math.atan2(dir.x, dir.z);
            let diff = desired - p.mover.rotation.y;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            p.mover.rotation.y += THREE.MathUtils.clamp(diff, -delta * 7, delta * 7);
            const run = running || (touchMove.active && touchMove.mag > 0.7);   // 📱 스틱을 70% 넘게 밀면 달리기
            const step = p.speed * (p.swimming ? (run ? 2.6 : 1.4) : run ? 3.0 : 1.5) * delta;   // 달리기 = 걷기 ×2 · 수영도 Shift 스프린트 (1.05→1.4/2.6)
            const nx = p.mover.position.x + dir.x * step;
            const nz = p.mover.position.z + dir.z * step;
            if (!playerBlocked(nx, nz)) {
                const stepGy = world.groundHeightAt(nx, nz);
                const curGy = world.groundHeightAt(p.mover.position.x, p.mover.position.z);
                if (p.swimming || airborne || Math.abs(stepGy - curGy) <= 0.26) {   // ledges need the stairs
                    p.mover.position.x = nx;
                    p.mover.position.z = nz;
                }
            } else {
                // 마크식: 소품의 옆면은 벽(bonk), 윗면은 길 — 발이 그 윗면 높이 이상이면
                // 차단원 위로 지나간다. 표면이 아예 없는 칸(t=null)은 공중에서만 통과: 충돌원은
                // 소품 중심의 원이라 길쭉한 메시(선베드 등)의 짧은 쪽에선 경계와 메시 사이에
                // 빈 띠가 생기는데, 예전엔 그 띠에서 벽 판정이 나 "방향에 따라 못 올라가는" 원인.
                const t = propTopAt(nx, nz, p.mover.position.y + 0.06);
                if ((t !== null && p.mover.position.y >= t - 0.07) || (airborne && t === null)) {
                    p.mover.position.x = nx;
                    p.mover.position.z = nz;
                }
            }
            p.pet.walking = true;
        }
    } else {
        p.pet.walking = false;
    }
    // Vertical: land / pond / sea. Stepping past a drop (rim, pond edge) starts a fall; landing on
    // water splashes and switches to swimming. On the surface the pet bobs with the waves.
    const sup = playerSupportY(p, p.mover.position.x, p.mover.position.z);
    if (!airborne && p.mover.position.y > sup.y + 0.09) { airborne = true; jumpVy = Math.min(jumpVy, 0); }
    if (airborne) {
        jumpVy -= 7.0 * delta;
        p.mover.position.y += jumpVy * delta;
        if (p.mover.position.y <= sup.y && jumpVy < 0) {
            p.mover.position.y = sup.y;
            airborne = false; jumpVy = 0; jumpsLeft = 2;
            if (sup.medium !== 'land') {
                spawnSplash(p.mover.position.x, sup.y + p.height * 0.42, p.mover.position.z);
            } else {
                playStep(surfaceFor(p), 1.1);                     // landing thump
            }
            p.swimming = sup.medium === 'land' ? false : sup.medium;
        }
    } else {
        p.swimming = sup.medium === 'land' ? false : sup.medium;
        p.mover.position.y = sup.y + (p.swimming ? Math.sin(p.pet.t * 2.6) * 0.02 : 0);
    }
    p.mover.rotation.x = p.swimming ? 0.3 : 0;    // lean into the paddle (applySwimPose counters at the head)
    // Hint: swimming shows the climb-out key near the cliff; on land, the tuck-in key near a bed.
    const petName = p.name === 'chick' ? '병아리' : '강아지';
    const nearCliff = p.swimming === 'sea' && !!nearestClimbSpot(p.mover.position);
    const friend = pets.find((q) => q !== p);
    const friendNear = !handHold && !p.swimming && friend && !friend.bed && !friend.dip && !friend.pet.sleeping
        && (friend.ai.state === 'idle' || friend.ai.state === 'walk')
        && Math.hypot(friend.mover.position.x - p.mover.position.x, friend.mover.position.z - p.mover.position.z) < 0.95;
    const bedNear = !p.swimming && !handHold && !friendNear && !p.bed && nearestFreeBed(p, 0.95);
    const coffeeNear = !p.swimming && !handHold && !friendNear && !bedNear && nearestPropDist(p, 'coffee') < 1.1;
    const foodNear = !p.swimming && !handHold && !friendNear && !bedNear && !coffeeNear && nearestPropDist(p, 'food') < 1.1;
    const radioNear = !p.swimming && !handHold && !friendNear && !bedNear && !coffeeNear && !foodNear && nearestPropDist(p, 'radio') < 1.0;
    const lampNear = !p.swimming && !handHold && !friendNear && !bedNear && !coffeeNear && !foodNear && !radioNear && nearestPropDist(p, 'lamp') < 1.0;
    const carNear = !p.swimming && Math.hypot(p.mover.position.x - CAR.x, p.mover.position.z - CAR.z) < 1.15;
    // 📱 터치에선 키 이름 대신 화면 버튼 아이콘으로 안내한다.
    const IKEY = IS_TOUCH ? '✋' : 'Ctrl/⌘';
    const MOVEK = IS_TOUCH ? '조이스틱' : '방향키';
    const JUMPK = IS_TOUCH ? '🦘' : 'Space';
    const RELK = IS_TOUCH ? '✕' : 'Esc';
    const runNow = running || (touchMove.active && touchMove.mag > 0.7);
    const act = carNear ? ` · ${IKEY} 차 타기`
        : handHold ? ` · ${IKEY} 손 놓기`
        : friendNear ? ` · ${IKEY} 손잡기`
        : bedNear ? (bedNear.mode === 'swing' ? ` · ${IKEY} 그네 타기` : bedNear.mode === 'seesaw' ? ` · ${IKEY} 시소 타기` : bedNear.mode === 'sit' ? ` · ${IKEY} 앉기` : ` · ${IKEY} 눕기`)
        : coffeeNear ? ` · ${IKEY} 커피 주문`
        : foodNear ? ` · ${IKEY} 간식 주문`
        : radioNear ? ` · ${IKEY} 라디오`
        : lampNear ? ` · ${IKEY} 가로등 ${Math.round(lampBrightness * 100)}%` : '';
    const shiftSeg = IS_TOUCH ? '' : ` · Shift ${running ? '걷기' : '달리기'}`;
    const hint = p.swimming
        ? `🏊 ${petName} 수영 중${handHold ? ' 🤝' : ''} — ${MOVEK} 이동 · ${JUMPK} 물장구${nearCliff ? ` · ${IKEY} 섬으로 올라가기` : handHold ? ` · ${IKEY} 손 놓기` : ''} · ${RELK} 해제`
        : `${runNow ? '🏃' : '🎮'} ${petName} ${runNow ? '달리는 중' : '조종 중'}${handHold ? ' 🤝' : ''} — ${MOVEK} 이동${shiftSeg} · ${JUMPK} 점프${act} · ${RELK} 해제`;
    if (controlHint.textContent !== hint) controlHint.textContent = hint;
}

// Swim pose: applied AFTER the shared entity update each frame (same overwrite technique the
// module itself uses), so the pet windows stay untouched. Replaces the land waddle with a real
// paddle: deep alternating leg kicks, rowing wing sweeps (chick) / trailing ears + rudder tail
// (puppy), a stroke-synced roll and head held out of the water, plus a droplet wake while moving.
// Blinking from the shared idle logic is left alone. Menu motions still override (action wins).
function applySwimPose(p, delta) {
    const pet = p.pet;
    if (!p.swimming || pet.action) return;
    const moving = pet.walking;
    const amp = moving ? 1 : 0.45;                       // full strokes vs treading water
    const stroke = pet.t * (moving ? 5.2 : 3.4);
    pet.wrap.position.y = Math.sin(stroke) * 0.012 * amp;
    pet.wrap.rotation.x = -0.2 + Math.sin(stroke) * 0.035 * amp;   // counter the mover lean → head up
    pet.wrap.rotation.z = Math.sin(stroke * 0.5) * 0.06 * amp;     // gentle roll between strokes
    pet.feet.forEach((f, i) => {
        f.rotation.x = (f.userData._restRotX || 0) + Math.sin(stroke + (i % 2 === 0 ? 0 : Math.PI)) * 0.85 * amp;
    });
    pet.wings.forEach((wg, i) => {
        const side = (i % 2 === 0) ? 1 : -1;
        wg.rotation.z = (wg.userData._restRotZ || 0) - side * (0.35 + Math.max(0, Math.sin(stroke - 0.9)) * 0.5) * amp;
    });
    pet.ears.forEach((e2) => { e2.rotation.x = (e2.userData._restRotX || 0) + 0.3 + Math.sin(stroke) * 0.05; });
    if (pet.tail) pet.tail.rotation.y = Math.sin(stroke) * 0.3;    // rudder wag
    p.kickT = (p.kickT || 0) - delta;
    if (moving && p.kickT <= 0) {
        spawnKickDroplets(p);
        p.kickT = 0.32 + Math.random() * 0.2;
    }
}
function spawnKickDroplets(p) {
    const backX = -Math.sin(p.mover.rotation.y), backZ = -Math.cos(p.mover.rotation.y);
    for (let i = 0; i < 2; i++) {
        const m = new THREE.Mesh(crumbGeo, splashMat);
        m.position.set(
            p.mover.position.x + backX * 0.14 + (Math.random() - 0.5) * 0.08,
            p.mover.position.y + p.height * 0.18,
            p.mover.position.z + backZ * 0.14 + (Math.random() - 0.5) * 0.08
        );
        m.scale.setScalar(0.5 + Math.random() * 0.5);
        scene.add(m);
        crumbs.push({ m, vx: backX * 0.35 + (Math.random() - 0.5) * 0.3, vy: 0.55 + Math.random() * 0.4, vz: backZ * 0.35 + (Math.random() - 0.5) * 0.3, t: 0 });
    }
}

// ---- 물놀이 (AI dips): every few minutes an idle pet may fancy a swim — pond or sea — so the two
// can paddle together (player included). A dip director drives phases like the bed system: walk to
// the waterside, wade past the edge (the fall + splash + swim switch come from the shared support
// logic), cruise a few waypoints, then wade out of the pond or climb the cliff back up. Dipping
// pets are excluded from duo partnering; sleep/possession end a dip on the spot.
function dipSteer(p, target, delta, speedMul = 1) {
    // Same shortest-arc steering as land, but no collision fence and no ground snapping —
    // the dip's vertical resolver owns the Y axis.
    const dx = target.x - p.mover.position.x;
    const dz = target.z - p.mover.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) { p.pet.walking = false; return 'arrived'; }
    const desired = Math.atan2(dx, dz);
    let diff = desired - p.mover.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.mover.rotation.y += THREE.MathUtils.clamp(diff, -delta * 3.5, delta * 3.5);
    p.pet.walking = true;
    if (Math.abs(diff) < 0.6) {
        const step = Math.min(p.speed * speedMul * delta, dist);
        p.mover.position.x += Math.sin(p.mover.rotation.y) * step;
        p.mover.position.z += Math.cos(p.mover.rotation.y) * step;
    }
    return 'moving';
}
function dipVertical(p, delta) {
    const sup = playerSupportY(p, p.mover.position.x, p.mover.position.z);
    if (!p.dipAir && p.mover.position.y > sup.y + 0.09) { p.dipAir = true; p.dipVy = 0; }
    if (p.dipAir) {
        p.dipVy -= 7.0 * delta;
        p.mover.position.y += p.dipVy * delta;
        if (p.mover.position.y <= sup.y && p.dipVy < 0) {
            p.mover.position.y = sup.y;
            p.dipAir = false; p.dipVy = 0;
            if (sup.medium !== 'land') spawnSplash(p.mover.position.x, sup.y + p.height * 0.42, p.mover.position.z);
            p.swimming = sup.medium === 'land' ? false : sup.medium;
        }
    } else {
        p.swimming = sup.medium === 'land' ? false : sup.medium;
        p.mover.position.y = sup.y + (p.swimming ? Math.sin(p.pet.t * 2.6) * 0.02 : 0);
    }
    p.mover.rotation.x = p.swimming ? 0.3 : 0;
}
function pickDipWaypoint(p) {
    if (p.dip.kind === 'pond') {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.38;
        return { x: pondPropRef.x + Math.sin(a) * r, z: pondPropRef.z + Math.cos(a) * r };
    }
    const cur = Math.atan2(p.mover.position.x, p.mover.position.z);
    const a = cur + (Math.random() - 0.5) * 1.1;
    const r = ISLAND_R + 0.5 + Math.random() * 1.5;
    return { x: Math.sin(a) * r, z: Math.cos(a) * r };
}
async function startDip(p, want) {
    const kind = (want === 'pond' || want === 'sea') ? want : (Math.random() < 0.5 ? 'pond' : 'sea');   // <swim> 태그는 장소를 고른다
    let entry = null;
    for (let i = 0; i < 10 && !entry; i++) {
        const a = Math.random() * Math.PI * 2;
        const x = kind === 'pond' ? pondPropRef.x + Math.sin(a) * 0.85 : Math.sin(a) * (ISLAND_R - 0.55);
        const z = kind === 'pond' ? pondPropRef.z + Math.cos(a) * 0.85 : Math.cos(a) * (ISLAND_R - 0.55);
        if (!world.isBlocked(x, z)) entry = { x, z, a };
    }
    if (!entry) return;
    logWorldEvent(`${petKo(p)}가 ${kind === 'pond' ? '연못' : '바다'}로 물놀이를 하러 갔다`);
    p.dip = {
        kind, phase: 'approach', swimLeft: 9 + Math.random() * 9, waypoint: null,
        waterPt: kind === 'pond'
            ? { x: pondPropRef.x, z: pondPropRef.z }
            : { x: Math.sin(entry.a) * (ISLAND_R + 0.8), z: Math.cos(entry.a) * (ISLAND_R + 0.8) },
    };
    await gotoAsync(p, entry.x, entry.z);
    if (!p.dip) return;
    p.dip.phase = 'enter';
}
function endDip(p) {
    p.dip = null;
    p.swimming = false;
    p.dipAir = false; p.dipVy = 0;
    p.mover.rotation.x = 0;
    p.mover.position.y = world.groundHeightAt(p.mover.position.x, p.mover.position.z);
    releaseAI(p, 2);
}
function updateDips(delta) {
    for (const p of pets) {
        const dip = p.dip;
        if (!dip || dip.phase === 'approach') continue;
        if (p.bed || p.pet.sleeping || p === possessed) { endDip(p); continue; }
        if (dip.phase !== 'climb') dipVertical(p, delta);
        if (dip.phase === 'enter') {
            dipSteer(p, dip.waterPt, delta, 1);
            if (p.swimming) { dip.phase = 'swim'; dip.waypoint = pickDipWaypoint(p); }
        } else if (dip.phase === 'swim') {
            dip.swimLeft -= delta;
            if (!dip.waypoint || dipSteer(p, dip.waypoint, delta, 0.8) === 'arrived') dip.waypoint = pickDipWaypoint(p);
            if (dip.swimLeft <= 0) {
                if (dip.kind === 'pond') {
                    let exit = null;
                    for (let i = 0; i < 10 && !exit; i++) {
                        const a = Math.random() * Math.PI * 2;
                        const x = pondPropRef.x + Math.sin(a) * 0.85, z = pondPropRef.z + Math.cos(a) * 0.85;
                        if (!world.isBlocked(x, z)) exit = { x, z };
                    }
                    dip.exitPt = exit || { x: pondPropRef.x + 0.85, z: pondPropRef.z };
                } else {
                    const a = Math.atan2(p.mover.position.x, p.mover.position.z);
                    dip.exitPt = { x: Math.sin(a) * (ISLAND_R + 0.45), z: Math.cos(a) * (ISLAND_R + 0.45), a };
                }
                dip.phase = 'exitSwim';
            }
        } else if (dip.phase === 'exitSwim') {
            if (dipSteer(p, dip.exitPt, delta, 0.9) === 'arrived') {
                if (dip.kind === 'pond') {
                    endDip(p);
                } else {
                    let a = dip.exitPt.a, tx = 0, tz = 0;
                    for (let i = 0; i < 8; i++) {
                        tx = Math.sin(a) * (ISLAND_R - 0.55);
                        tz = Math.cos(a) * (ISLAND_R - 0.55);
                        if (!world.isBlocked(tx, tz)) break;
                        a += 0.35;
                    }
                    dip.hop = { fx: p.mover.position.x, fy: p.mover.position.y, fz: p.mover.position.z, tx, tz, ty: world.groundHeightAt(tx, tz), t: 0 };
                    dip.phase = 'climb';
                }
            }
        } else if (dip.phase === 'climb') {
            const h = dip.hop;
            h.t += delta;
            const k = Math.min(1, h.t / 0.55);
            const e = k * k * (3 - 2 * k);
            p.mover.position.x = THREE.MathUtils.lerp(h.fx, h.tx, e);
            p.mover.position.z = THREE.MathUtils.lerp(h.fz, h.tz, e);
            p.mover.position.y = THREE.MathUtils.lerp(h.fy, h.ty, e) + Math.sin(k * Math.PI) * 0.55;
            p.pet.walking = false;
            p.swimming = false;
            p.mover.rotation.x = 0;
            if (k >= 1) endDip(p);
        }
    }
}

function updateSelectRing() {
    if (!possessed) return;
    selectRing.position.set(
        possessed.mover.position.x,
        possessed.mover.position.y + 0.012,   // rides jumps and floats on water with the pet
        possessed.mover.position.z
    );
}

// Follow cam: while driving a pet, the orbit target glides after it (camera slides along by the
// same offset, so your chosen angle/zoom is preserved — drag/wheel still work mid-follow).
const _followDelta = new THREE.Vector3();
function updateFollowCam(delta) {
    if (!possessed) return;
    const p = possessed;
    _followDelta.set(
        p.mover.position.x,
        p.mover.position.y + p.height * 0.55,
        p.mover.position.z
    ).sub(controls.target).multiplyScalar(Math.min(1, delta * 5));
    controls.target.add(_followDelta);
    camera.position.add(_followDelta);
}

// Put a pet back on the nearest island's solid ground (used when a swim ends abruptly — releasing
// possession or letting go of a hand mid-water). Standing on a bridge deck counts as fine.
function snapToLand(p) {
    const pos = p.mover.position;
    if (p.swimming || (islandOf(pos.x, pos.z) < 0 && !onBridge(pos.x, pos.z))) {
        let best = ISLANDS[0], bd = Infinity;
        for (const s of ISLANDS) {
            const d = Math.hypot(pos.x - s.x, pos.z - s.z) - s.r;
            if (d < bd) { bd = d; best = s; }
        }
        const dx = pos.x - best.x, dz = pos.z - best.z;
        const rr = Math.hypot(dx, dz) || 1;
        const k = Math.min(rr, best.r - 0.6) / rr;
        pos.x = best.x + dx * k;
        pos.z = best.z + dz * k;
        if (world.isBlocked(pos.x, pos.z)) { pos.x = -0.5; pos.z = 0.2; }   // e.g. released in the pond
        p.swimming = false;
        p.mover.rotation.x = 0;
    }
    pos.y = world.groundHeightAt(pos.x, pos.z);
}

// ---- 🤝 손잡기 (hand-holding): grab the friend with Ctrl/⌘ and it walks, runs and even swims at
// your side, hand in hand. The side you grabbed from is kept; on narrow ground (bridge decks) the
// friend falls into single file just behind; little hearts drift up now and then. Press the key
// again (or Esc) to let go — mid-water releases snap the friend safely back onto land.
let handHold = null;    // { partner, side, heartT }
function tryGrabHand() {
    const q = pets.find((x) => x !== possessed);
    if (!q || q.bed || q.dip || q.pet.sleeping) return false;
    if (q.ai.state !== 'idle' && q.ai.state !== 'walk') return false;
    const d = Math.hypot(q.mover.position.x - possessed.mover.position.x, q.mover.position.z - possessed.mover.position.z);
    if (d > 0.95) return false;
    releaseAI(q);
    q.ai.state = 'held';
    q.pet.sleeping = false;
    const h = possessed.mover.rotation.y;
    const relX = q.mover.position.x - possessed.mover.position.x;
    const relZ = q.mover.position.z - possessed.mover.position.z;
    const side = (relX * Math.cos(h) - relZ * Math.sin(h)) >= 0 ? 1 : -1;   // which side it was grabbed on
    handHold = { partner: q, side, heartT: 0.6 };
    logWorldEvent(`주인이 조종하는 ${petKo(possessed)}가 ${petKo(q)}의 손을 잡았다`);
    return true;
}
// ---- 📞 친구 부르기: 조종 펫이 스마트폰을 꺼내 귀에 대고 통화(인사 목소리 + 부리 옹알이·
// 고개 기울임) → 통화가 끝나면 절친이 뭘 하고 있었든(잠·해먹·물놀이·낚시·탈것) 포르르
// 달려와 손을 잡고 옆에 서 있다. 📍 친구한테 가기: 반대로 내가 절친 곁으로 텔레포트(손은
// 안 잡음 — 친구 하던 일 방해 금지). 전용 안무 — 캔 모션 재활용 없음. ----
let phoneCall = null;   // { p, friend, t, mesh }
function makePhone() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.09, 0.011), M(0x2a2d33));
    g.add(body);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.078),
        new THREE.MeshBasicMaterial({ color: 0xcfe8ff }));
    screen.position.z = 0.0062;
    g.add(screen);
    return g;
}
function startPhoneCall() {
    const p = possessed;
    if (!p || phoneCall) return;
    if (carDrive || boatRide || planeRide || balloonRide || ferryRide) { showToast('📞 탈것에서 내린 뒤에 걸어요'); return; }
    const friend = pets.find((q) => q !== p);
    if (!friend) { showToast('👥 부를 친구가 없어요'); return; }
    if (fishing && fishing.state !== 'idle') cancelFishing(true);
    petVoice(p);   // 인사 모션의 그 목소리
    phoneCall = { p, friend, t: 0, mesh: makePhone() };
    scene.add(phoneCall.mesh);
    logWorldEvent(`${petKo(p)}가 스마트폰을 꺼내 ${petKo(friend)}에게 전화를 걸었다 📞`);
}
function cancelPhoneCall() {
    if (!phoneCall) return;
    scene.remove(phoneCall.mesh);
    phoneCall = null;
}
function yankFriendFree(friend) {   // 뭘 하든 데려온다 — 잠·침대·물놀이·자율 낚시/도보·탈것 좌석 전부 해제
    friend.pet.sleeping = false;
    friend.pet.autoSleeping = false;
    if (friend.bed) forceEndBed(friend);
    if (friend.dip) endDip(friend);
    if (aiFishing && aiFishing.p === friend) endAiFishing();
    if (aiBalloonWalk && aiBalloonWalk.p === friend) aiBalloonWalk = null;
    if (aiFerryWalk && aiFerryWalk.p === friend) aiFerryWalk = null;
    if (carDrive && carDrive.passenger === friend) carDrive.passenger = null;
    if (boatRide && boatRide.passenger === friend) boatRide.passenger = null;
    if (planeRide && planeRide.passenger === friend) planeRide.passenger = null;
    if (balloonRide) {
        if (balloonRide.friend === friend) balloonRide.friend = null;
        if (balloonRide.p === friend) {
            balloonRide.p = null;
            if (BALLOON.mode === 'docked') { balloonRide = null; balloonCollider.r = 0.5; balloonGroup.userData.moor.visible = true; }
            else { balloonRide.empty = true; BALLOON.mode = 'land'; }
        }
    }
    if (ferryRide) {
        if (ferryRide.friend === friend) ferryRide.friend = null;
        if (ferryRide.p === friend) { ferryRide.p = ferryRide.friend; ferryRide.friend = null; if (!ferryRide.p) ferryRide = null; }
    }
    friend.swimming = false;
    friend.mover.rotation.x = 0;
    friend.mover.rotation.z = 0;
    releaseAI(friend);
}
function updatePhoneCall(delta) {
    if (!phoneCall) return;
    const c = phoneCall;
    const p = c.p;
    if (p !== possessed) { cancelPhoneCall(); return; }   // 조종이 풀리면 끊는다
    c.t += delta;
    const m = p.mover;
    const fwdX = Math.sin(m.rotation.y), fwdZ = Math.cos(m.rotation.y);
    const rgX = Math.cos(m.rotation.y), rgZ = -Math.sin(m.rotation.y);
    // 3박자: 꺼내기(0~0.5) → 통화(0.5~2.8) → 내리기(2.8~3.3)
    const raise = c.t < 0.5 ? c.t / 0.5 : c.t < 2.8 ? 1 : Math.max(0, 1 - (c.t - 2.8) / 0.5);
    const e = raise * raise * (3 - 2 * raise);
    const earY = m.position.y + p.height * (0.42 + 0.36 * e);
    c.mesh.position.set(
        m.position.x + rgX * (0.1 + 0.06 * e) + fwdX * 0.09,
        earY,
        m.position.z + rgZ * (0.1 + 0.06 * e) + fwdZ * 0.09
    );
    c.mesh.rotation.set(0, m.rotation.y, -0.28 * e);   // 귀에 기대는 각도
    // 몸 연기: 폰 쪽으로 고개 기울임 + 날개 모음 + 통화 중 부리 옹알이 (엔티티 뒤 덮어쓰기)
    p.pet.wrap.rotation.z += -0.14 * e;
    for (const wg of p.pet.wings) wg.rotation.z = (wg.userData._restRotZ || 0) * (1 - 0.7 * e);
    if (c.t > 0.5 && c.t < 2.8) {
        if (p.pet.beak) p.pet.beak.rotation.x = (p.pet.beak.userData._restRotX || 0) + Math.max(0, Math.sin(c.t * 11)) * 0.16;
        if (p.pet.tail) p.pet.tail.rotation.y = Math.sin(c.t * 5) * 0.18;   // 강아지는 꼬리 살랑
    }
    if (c.t >= 3.3) {   // 통화 끝 — 절친 소환 + 손잡기
        const friend = c.friend;
        cancelPhoneCall();
        yankFriendFree(friend);
        const h = m.rotation.y;
        const sx = m.position.x + Math.cos(h) * 0.42, sz = m.position.z - Math.sin(h) * 0.42;
        const sup = playerSupportY(friend, sx, sz);
        friend.mover.position.set(sx, sup.y, sz);
        friend.mover.rotation.set(0, h, 0);
        friend.swimming = sup.medium === 'land' ? false : sup.medium;
        friend.ai.state = 'held';
        handHold = { partner: friend, side: 1, heartT: 0.6 };
        const spr = glowSprite(0xfff1cf, 0.16, 0.9);
        spr.position.set(sx, sup.y + friend.height * 0.6, sz);
        scene.add(spr);
        hugBurst.push({ spr, vx: 0, vy: 0.35, vz: 0, t: 0.4 });
        petVoice(friend);   // 달려온 절친의 대답
        showToast('📞 통화 끝 — 절친이 포르르 달려와 손을 잡았어요!');
        logWorldEvent(`${petKo(friend)}가 전화를 받자마자 포르르 달려와 ${petKo(p)}의 손을 잡았다`);
    }
}
function teleportToFriend() {
    const p = possessed;
    if (!p) return;
    if (carDrive || boatRide || planeRide || balloonRide || ferryRide) { showToast('📍 탈것에서 내린 뒤에 가요'); return; }
    const friend = pets.find((q) => q !== p);
    if (!friend) { showToast('👥 갈 친구가 없어요'); return; }
    if (fishing && fishing.state !== 'idle') cancelFishing(true);
    cancelPhoneCall();
    if (handHold) releaseHandHold();
    const fx = friend.mover.position.x, fz = friend.mover.position.z;
    let spot = null;
    for (let i = 0; i < 8; i++) {   // 친구 곁 0.7m — 막힌 방향이면 8방위 탐색
        const a = (i / 8) * Math.PI * 2;
        const nx = fx + Math.sin(a) * 0.7, nz = fz + Math.cos(a) * 0.7;
        const sup = playerSupportY(p, nx, nz);
        if (sup.medium === 'land' && world.isBlocked(nx, nz)) continue;
        spot = { nx, nz, sup };
        break;
    }
    if (!spot) { const sup = playerSupportY(p, fx + 0.7, fz); spot = { nx: fx + 0.7, nz: fz, sup }; }
    p.mover.position.set(spot.nx, spot.sup.y, spot.nz);
    p.swimming = spot.sup.medium === 'land' ? false : spot.sup.medium;
    p.mover.rotation.set(0, Math.atan2(fx - spot.nx, fz - spot.nz), 0);   // 친구를 바라본다 (손은 안 잡음)
    airborne = false; jumpVy = 0; jumpsLeft = 2;
    const spr = glowSprite(0x9be7ff, 0.16, 0.9);
    spr.position.set(spot.nx, spot.sup.y + p.height * 0.6, spot.nz);
    scene.add(spr);
    hugBurst.push({ spr, vx: 0, vy: 0.35, vz: 0, t: 0.4 });
    logWorldEvent(`${petKo(p)}가 ${petKo(friend)} 곁으로 포르르 순간이동했다 📍`);
}
function releaseHandHold() {
    if (!handHold) return;
    const q = handHold.partner;
    handHold = null;
    if (possessed) possessed.mover.rotation.z = 0;
    q.mover.rotation.z = 0;
    snapToLand(q);
    if (q.ai.state === 'held') releaseAI(q);
}

// 🚗 board / leave the sports car. A held (or standing-nearby) friend hops into the passenger seat.
function enterCar() {
    const driver = possessed;
    if (!driver) return;
    let passenger = null;
    const friend = pets.find((q) => q !== driver);
    const friendClose = friend && Math.hypot(friend.mover.position.x - CAR.x, friend.mover.position.z - CAR.z) < 1.4;
    if (friend && !friend.bed && !friend.dip && !friend.pet.sleeping
        && ((handHold && handHold.partner === friend) || (friendClose && (friend.ai.state === 'idle' || friend.ai.state === 'walk')))) {
        if (handHold) handHold = null;                 // hand → passenger seat, no snap needed
        releaseAI(friend);
        friend.ai.state = 'held';
        passenger = friend;
    }
    carDrive = { driver, passenger };
    running = false;
    logWorldEvent(`${petKo(driver)}가 스포츠카 드라이브를 시작했다${passenger ? ' (절친도 조수석에!)' : ''}`);
    startEngine();
}
function exitCar() {
    if (!carDrive) return;
    const { driver, passenger } = carDrive;
    carDrive = null;
    stopEngine();
    CAR.vel = 0;
    const rX = Math.cos(CAR.heading), rZ = -Math.sin(CAR.heading);
    const hopOut = (q, side) => {
        q.mover.position.x = CAR.x + rX * side * 0.85;
        q.mover.position.z = CAR.z + rZ * side * 0.85;
        q.mover.rotation.x = 0;
        q.mover.rotation.z = 0;
        q.swimming = false;
        snapToLand(q);
    };
    hopOut(driver, -1);
    if (passenger) {
        hopOut(passenger, 1);
        if (passenger.ai.state === 'held') releaseAI(passenger);
    }
}
// 차 물리 한 스텝 — 조종(updatePlayer)과 AI 드라이브(<drive> 태그, updateAutoDrive)가 공유한다.
function stepCar(acc, steer, delta, driver) {
    const maxV = driver.speed * 4.5;                   // 걷기(×1.5)의 정확히 3배
    CAR.vel += acc * delta;
    CAR.vel *= Math.pow(0.3, delta);                   // rolling friction
    CAR.vel = THREE.MathUtils.clamp(CAR.vel, -maxV * 0.4, maxV);
    CAR.heading += steer * delta * 2.4 * THREE.MathUtils.clamp(CAR.vel / maxV, -1, 1);
    const nx = CAR.x + Math.sin(CAR.heading) * CAR.vel * delta;
    const nz = CAR.z + Math.cos(CAR.heading) * CAR.vel * delta;
    if (!carBlocked(nx, nz)) { CAR.x = nx; CAR.z = nz; }
    else CAR.vel = 0;
    carCollider.x = CAR.x;
    carCollider.z = CAR.z;
    const cy = world.groundHeightAt(CAR.x, CAR.z);     // bridge decks lift the car over the arch
    carGroup.position.set(CAR.x, cy, CAR.z);
    carGroup.rotation.y = CAR.heading;
    for (const w of carWheels) w.rotation.x += CAR.vel * delta * 9;
    const rX = Math.cos(CAR.heading), rZ = -Math.sin(CAR.heading);
    const seatPet = (q, side) => {
        q.mover.position.set(
            CAR.x + rX * side * 0.17 - Math.sin(CAR.heading) * 0.06,
            cy + 0.22,
            CAR.z + rZ * side * 0.17 - Math.cos(CAR.heading) * 0.06
        );
        q.mover.rotation.y = CAR.heading;
        q.mover.rotation.x = 0;
        q.mover.rotation.z = 0;
        q.pet.walking = false;
        q.swimming = false;
    };
    seatPet(driver, -1);
    if (carDrive && carDrive.passenger) seatPet(carDrive.passenger, 1);
    engineUpdate();
}
// <drive> 태그의 자율 주행: 완만한 스티어에 사인 흔들림을 얹어 빙 돌고, 벽에 막히면 반대로
// 꺾는다. 시간이 다 되면 스스로 내린다 (주인이 조종을 넘겨받으면 auto만 조용히 떼어낸다).
function updateAutoDrive(delta) {
    if (!carDrive || !carDrive.auto) return;
    if (carDrive.driver === possessed) { carDrive.auto = null; return; }
    const d = carDrive.auto;
    d.t -= delta;
    d.w = (d.w || 0) + delta;
    if (CAR.vel === 0 && d.lastVel === 0) d.steer *= -1;   // 두 프레임 연속 정지 = 막힘 → 핸들 반대로
    d.lastVel = CAR.vel;
    stepCar(d.t > 1.3 ? 2.7 : -0.6, d.steer + Math.sin(d.w * 0.7) * 0.3, delta, carDrive.driver);
    if (d.t <= 0) {
        const driver = carDrive.driver;
        exitCar();
        if (driver.ai.state === 'held') releaseAI(driver, 2);
        logWorldEvent(`${petKo(driver)}가 드라이브를 마치고 내렸다`);
    }
}

// ---- 🚣 노 젓는 보트: 물 위의 스포츠카 — ⌘로 타고(절친이 곁에 있으면 뱃머리에 동승), ↑↓ 노
// 젓기·후진, ←→ 방향. 물 위 어디든 정박(위치는 boat-1로 저장), ⌘로 내리면 그 자리에서 수영
// 시작. 절친이 타고 있으면 기슭 근처에서만 하선(먼바다에 AI 혼자 띄우지 않기). ----
function tideOffset() {   // 밀물썰물 — ≈5분 주기 ±5.5cm (셰이더의 sin(uWxT*0.021)*0.055와 동일)
    return Math.sin(wxTime.value * 0.021) * 0.055;
}
function waveYAt(x, z) {
    // 오션 버텍스 셰이더와 동일 상수 (그 주석의 약속 — 바꾸면 셰이더와 함께) · fade는 근해 1로 본다
    const t = wxTime.value;
    const a1 = x * 0.9 + t * 0.9;
    const a2 = z * 1.15 - t * 0.75;
    const a3 = (x * 0.55 + z * 0.83) * 1.6 + t * 1.35;
    const a4 = x * 3.1 - z * 2.3 + t * 2.4;
    return OCEAN_LEVEL + tideOffset() + 0.045 * Math.sin(a1) + 0.038 * Math.sin(a2) + 0.028 * Math.sin(a3) + 0.012 * Math.sin(a4);
}
function boatBlocked(nx, nz) {
    if (Math.hypot(nx - FERRY.x, nz - FERRY.z) < 1.4) return true;   // ⛴️ 통통호 선체
    if (islandOf(nx, nz) >= 0) return true;               // 섬에 얹히지 않는다 (기슭까지는 접근)
    if (Math.hypot(nx, nz) > 18) return true;             // 수평선 평탄 구간 전까지 (SWIM_LEASH와 동일)
    return false;
}
function enterBoat() {
    const driver = possessed;
    if (!driver) return;
    let passenger = null;
    const friend = pets.find((q) => q !== driver);
    const friendClose = friend && Math.hypot(friend.mover.position.x - BOAT.x, friend.mover.position.z - BOAT.z) < 1.6;
    if (friend && !friend.bed && !friend.dip && !friend.pet.sleeping
        && ((handHold && handHold.partner === friend) || (friendClose && (friend.ai.state === 'idle' || friend.ai.state === 'walk')))) {
        if (handHold) handHold = null;
        releaseAI(friend);
        friend.ai.state = 'held';
        passenger = friend;
    }
    boatRide = { driver, passenger, row: 0, lastPh: 0 };
    running = false;
    driver.swimming = false;
    logWorldEvent(`${petKo(driver)}가 보트에 올라 노를 잡았다${passenger ? ' (절친도 뱃머리에!)' : ''}`);
}
function exitBoat(force = false) {
    if (!boatRide) return;
    const { driver, passenger } = boatRide;
    if (passenger) {
        // 절친 하선은 기슭 근처에서만 — 자리가 있으면 절친을 뭍에 올려주고 나서 조종 펫이 내린다
        const spot = nearestClimbSpot({ x: BOAT.x, z: BOAT.z });
        if (!spot && !force) { showToast('🚣 절친이 타고 있어요 — 뭍 가까이에서 내려요'); return; }
        if (spot) {
            passenger.mover.position.set(spot.tx, spot.ty, spot.tz);
            passenger.swimming = false;
        } else {
            passenger.mover.position.set(BOAT.x + 0.6, waveYAt(BOAT.x + 0.6, BOAT.z) + 0.02 - passenger.height * 0.45, BOAT.z);
            passenger.swimming = 'sea';   // 강제 해제(Esc) — 절친도 물에 퐁당 (둥둥 떠서 기다린다)
        }
        passenger.mover.rotation.x = 0;
        passenger.mover.rotation.z = 0;
        if (passenger.ai.state === 'held') releaseAI(passenger);
    }
    boatRide = null;
    BOAT.vel = 0;
    const rX = Math.cos(BOAT.heading), rZ = -Math.sin(BOAT.heading);
    const dx = BOAT.x - rX * 0.8, dz = BOAT.z - rZ * 0.8;   // 뱃전 옆 물로 퐁당
    driver.mover.position.set(dx, waveYAt(dx, dz) + 0.02 - driver.height * 0.45, dz);
    driver.mover.rotation.x = 0;
    driver.mover.rotation.z = 0;
    driver.swimming = 'sea';                                // 보트에서 내리면 어디서든 수영
    spawnSplash(dx, waveYAt(dx, dz) + driver.height * 0.42, dz);
    playSplashSound(dx, dz);
    logWorldEvent(`${petKo(driver)}가 보트에서 내려 바다에 퐁당 뛰어들었다`);
    saveLayout();                                           // 정박 위치 저장 — 물 위 어디든 주차
}
// 보트 물리 한 스텝 — 차보다 무겁고 미끄럽다 (관성 활공), 노는 속도에 맞춰 젓는다.
function stepBoat(acc, steer, delta, driver) {
    const maxV = driver.speed * 3.2;
    BOAT.vel += acc * delta;
    BOAT.vel *= Math.pow(0.5, delta);                      // 물 저항 — 놓으면 스르르 활공
    BOAT.vel = THREE.MathUtils.clamp(BOAT.vel, -maxV * 0.35, maxV);
    BOAT.heading += steer * delta * 1.7 * THREE.MathUtils.clamp(BOAT.vel / maxV, -1, 1);
    const nx = BOAT.x + Math.sin(BOAT.heading) * BOAT.vel * delta;
    const nz = BOAT.z + Math.cos(BOAT.heading) * BOAT.vel * delta;
    if (!boatBlocked(nx, nz)) { BOAT.x = nx; BOAT.z = nz; }
    else BOAT.vel = 0;                                     // 기슭에 닿으면 멈춘다 — 내려서 수영/상륙
    boatCollider.x = BOAT.x;
    boatCollider.z = BOAT.z;
    const by = waveYAt(BOAT.x, BOAT.z) + 0.02;
    boatGroup.position.set(BOAT.x, by, BOAT.z);
    boatGroup.rotation.set(Math.sin(wxTime.value * 1.1) * 0.02, BOAT.heading, steer * -0.05 + Math.sin(wxTime.value * 0.9) * 0.02);
    // 노 젓기 — 속도에 비례해 젓고, 스트로크가 넘어갈 때 물소리 한 번
    boatRide.row += Math.abs(BOAT.vel) * delta * 5 + (Math.abs(acc) > 0.1 ? delta * 2.2 : 0);
    const ph = Math.floor(boatRide.row / Math.PI);
    for (const oar of boatGroup.userData.oars) {
        oar.grp.rotation.x = Math.sin(boatRide.row) * 0.45;
        oar.grp.rotation.z = oar.base + Math.cos(boatRide.row) * 0.12 * oar.side;
    }
    if (ph !== boatRide.lastPh && Math.abs(BOAT.vel) > 0.25) {
        boatRide.lastPh = ph;
        playBuffer(swishBuf, { vol: 0.4 * attAtPoint(BOAT.x, BOAT.z), rate: 0.75 + Math.random() * 0.2, filterFreq: 900 });
    }
    const seatPet = (q, fwd, facing) => {
        q.mover.position.set(
            BOAT.x + Math.sin(BOAT.heading) * fwd,
            by + 0.14,
            BOAT.z + Math.cos(BOAT.heading) * fwd
        );
        q.mover.rotation.y = facing;
        q.mover.rotation.x = 0;
        q.mover.rotation.z = 0;
        q.pet.walking = false;
        q.swimming = false;
    };
    seatPet(driver, -0.08, BOAT.heading);
    if (boatRide.passenger) seatPet(boatRide.passenger, 0.36, BOAT.heading + Math.PI);   // 뱃머리 절친은 노잡이와 마주 본다
}
// 정박 중 보트: 파도 위에서 살랑살랑 (항해 중엔 stepBoat가 놓는다)
function updateBoatIdle() {
    if (boatRide) return;
    boatGroup.position.set(BOAT.x, waveYAt(BOAT.x, BOAT.z) + 0.02, BOAT.z);
    boatGroup.rotation.set(Math.sin(wxTime.value * 0.8) * 0.02, BOAT.heading, Math.sin(wxTime.value * 0.65 + 1.3) * 0.025);
}
// 🚣 보트 우클릭 메뉴 — 노 젓는 중에 배를 우클릭하면 "친구 태우기": 절친이 물가까지 걸어와
// 배에 오른다 (배가 기슭에서 멀면 못 닿는다고 알려준다).
const boatMenu = document.createElement('div');
boatMenu.id = 'world-boat-menu';
boatMenu.style.cssText = 'position:fixed; display:none; z-index:130; background:rgba(30,32,40,0.94); border-radius:10px; padding:6px; box-shadow:0 6px 18px rgba(0,0,0,0.35);';
const boatMenuBtn = document.createElement('button');
boatMenuBtn.textContent = '👥 친구 태우기';
boatMenuBtn.style.cssText = 'display:block; background:none; border:none; color:#fff; font-size:13px; padding:7px 12px; border-radius:7px; cursor:pointer; font-family:sans-serif;';
boatMenuBtn.onmouseenter = () => { boatMenuBtn.style.background = 'rgba(255,255,255,0.14)'; };
boatMenuBtn.onmouseleave = () => { boatMenuBtn.style.background = 'none'; };
boatMenuBtn.onclick = () => { hideBoatMenu(); summonPassenger(); };
boatMenu.appendChild(boatMenuBtn);
document.body.appendChild(boatMenu);
function showBoatMenu(x, y) {
    boatMenu.style.left = `${Math.min(x, window.innerWidth - 150)}px`;
    boatMenu.style.top = `${Math.min(y, window.innerHeight - 60)}px`;
    boatMenu.style.display = 'block';
}
function hideBoatMenu() { boatMenu.style.display = 'none'; }
let boatHop = null;   // { q, fx, fy, fz, t } — 절친이 물가에서 뱃머리로 그리는 승선 아크
function summonPassenger() {
    if (!boatRide || boatRide.passenger || boatHop) return;
    const friend = pets.find((q) => q !== boatRide.driver);
    if (!friend) { showToast('👥 부를 친구가 없어요'); return; }
    // 어디서 뭘 하고 있든 부르면 온다 — 자던 친구는 깨우고, 해먹·그네·시소·물놀이는 곱게 끝낸다.
    friend.pet.sleeping = false;
    friend.pet.autoSleeping = false;
    if (friend.bed) forceEndBed(friend);
    if (friend.dip) endDip(friend);
    releaseAI(friend);
    friend.ai.state = 'held';
    friend.swimming = false;
    // 걸어오면 멀고 장애물에 막힌다(실사용 확인) — 배에서 제일 가까운 물가로 순간이동 후 폴짝.
    let spot = null, best = Infinity;
    for (const s of ISLANDS) {
        const dx = BOAT.x - s.x, dz = BOAT.z - s.z;
        const d = Math.hypot(dx, dz) || 1;
        const k = (s.r - 0.5) / d;
        const tx = s.x + dx * k, tz = s.z + dz * k;
        const dd = Math.hypot(BOAT.x - tx, BOAT.z - tz);
        if (dd < best) { best = dd; spot = { tx, tz }; }
    }
    const fy = world.groundHeightAt(spot.tx, spot.tz);
    friend.mover.position.set(spot.tx, fy, spot.tz);
    friend.mover.rotation.x = 0;
    friend.mover.rotation.z = 0;
    boatHop = { q: friend, fx: spot.tx, fy, fz: spot.tz, t: 0 };
    showToast('👥 절친이 포르르 나타나 배로 폴짝!');
    logWorldEvent(`${petKo(friend)}가 보트 뱃머리로 폴짝 올라탔다`);
}
function updateBoatHop(delta) {
    if (!boatHop) return;
    boatHop.t += delta;
    const k = Math.min(1, boatHop.t / 0.6);
    const e = k * k * (3 - 2 * k);
    const q = boatHop.q;
    // 목표 = 뱃머리 좌석 — 배가 움직여도 따라잡는다
    const ty = waveYAt(BOAT.x, BOAT.z) + 0.16;
    const tx = BOAT.x + Math.sin(BOAT.heading) * 0.36, tz = BOAT.z + Math.cos(BOAT.heading) * 0.36;
    q.mover.position.set(
        THREE.MathUtils.lerp(boatHop.fx, tx, e),
        THREE.MathUtils.lerp(boatHop.fy, ty, e) + Math.sin(k * Math.PI) * 0.55,
        THREE.MathUtils.lerp(boatHop.fz, tz, e));
    q.mover.rotation.y = BOAT.heading + Math.PI;   // 착지하자마자 노잡이와 마주 본다
    q.pet.walking = false;
    if (k >= 1) {
        boatHop = null;
        if (boatRide && !boatRide.passenger) boatRide.passenger = q;
        else { q.swimming = false; releaseAI(q); snapToLand(q); }   // 그 사이 하선했으면 뭍으로
    }
}

// ---- 🛩️ 경비행기 (수륙양용 복엽기): 휴양지 모래섬 해변에 주차. 차·보트와 같은 탑승 문법 —
// ⌘ 근접 탑승, 우클릭 "친구 태우기"(뒷좌석 탠덤). 활주(뭍·물 모두, 물에선 물살 스프레이) →
// 전속력에서 자동 이륙 → 비행 중 W/S = 고도, ←→ = 방향, ↑↓ = 속도. 하강해 지면/수면에 닿으면
// 착륙. 상태는 PLANE.mode: parked → taxi ⇄ fly. 정박 저장 plane-1 (차 car-1·보트 boat-2 문법). ----
function makePlane() {
    const g = new THREE.Group();
    // 정적 파츠는 재질 버킷별로 지오메트리 병합 → 6드로우 (가동부: 프로펠러·디스크·바퀴만 분리)
    const grad = [], red = [], wood = [], metal = [], rims = [];
    // 동체: 통짜 Lathe 프로파일 (꼬리→기수) — 위 크림/아래 탠 그라디언트
    const pts = [
        new THREE.Vector2(0.015, 0), new THREE.Vector2(0.05, 0.17), new THREE.Vector2(0.095, 0.52),
        new THREE.Vector2(0.13, 0.9), new THREE.Vector2(0.148, 1.22), new THREE.Vector2(0.15, 1.4),
        new THREE.Vector2(0.125, 1.54), new THREE.Vector2(0.08, 1.62),
    ];   // 2인승 여유 동체 (1.3→1.62 연장)
    const fusGeo = new THREE.LatheGeometry(pts, 16);
    fusGeo.rotateX(Math.PI / 2);          // +y 프로파일 → +z (기수가 +Z)
    fusGeo.translate(0, 0.3, -0.79);      // 바퀴 위 동체 축 높이 0.3, 앞뒤 중심 정렬
    grad.push(bakeGrad(fusGeo, 0xf4e6c8, 0xcfa87a, { curve: 1.2 }));
    const bandGeo = new THREE.TorusGeometry(0.151, 0.012, 8, 20);
    bandGeo.translate(0, 0.3, 0.44);
    red.push(bandGeo);                     // 동체 레드 밴드
    const cowlGeo = new THREE.TorusGeometry(0.115, 0.038, 10, 20);
    cowlGeo.translate(0, 0.3, 0.83);
    red.push(cowlGeo);                     // 엔진 카울
    // 복엽 날개 (위·아래) + 빨간 윙팁 + 스트럿 4
    for (const [wy, wz, span] of [[0.78, 0.14, 1.52], [0.16, 0.18, 1.3]]) {   // 윗날개는 파라솔 높이 — 탑승 펫 머리가 림~날개 창에 들어온다
        const wingGeo = new THREE.BoxGeometry(span, 0.034, 0.34);
        wingGeo.translate(0, wy, wz);
        grad.push(bakeGrad(wingGeo, 0xf4e6c8, 0xd8bd92, { curve: 1 }));
        for (const sx of [-1, 1]) {
            const tipGeo = new THREE.BoxGeometry(0.09, 0.036, 0.34);
            tipGeo.translate(sx * (span / 2 - 0.045), wy, wz);
            red.push(tipGeo);
        }
    }
    for (const [sx, sz] of [[-0.52, 0.06], [-0.52, 0.26], [0.52, 0.06], [0.52, 0.26]]) {
        const strutGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.62, 6);
        strutGeo.translate(sx, 0.47, sz);
        wood.push(strutGeo);
    }
    // 오픈 콕핏 2자리 "시트 유닛" (앞=조종석, 뒤=절친석): ①어두운 내부(구멍 착시) +
    // ②가죽 시트백·헤드레스트 + ③패딩 림 + 미니 윈드실드 — 펫이 동체가 아니라 의자에 앉아 보이게
    const glassGeos = [];
    const dark = [];
    const pads = [];   // RoundedBox 파츠 (Torus와 속성 불일치 — 별도 병합)
    for (const cz of [0.28, -0.18]) {   // 앞뒤 좌석 간격 0.46 — 두 머리(반지름 합 ~0.36)가 안 겹치는 최소 + 아늑함
        const rimGeo = new THREE.TorusGeometry(0.085, 0.03, 10, 18).rotateX(Math.PI / 2);   // ③ 도톰한 가죽 패딩 림
        rimGeo.translate(0, 0.44, cz);
        rims.push(rimGeo);
        const holeGeo = new THREE.CircleGeometry(0.08, 14).rotateX(-Math.PI / 2);   // ① 콕핏 내부 — 어두운 구멍
        holeGeo.scale(1, 1, 1.15);
        holeGeo.translate(0, 0.428, cz);
        dark.push(holeGeo);
        const backGeo = new RoundedBoxGeometry(0.15, 0.15, 0.034, 2, 0.015);   // ② 시트백 (뒤로 살짝 기움)
        backGeo.rotateX(-0.16);
        backGeo.translate(0, 0.47, cz - 0.125);
        pads.push(backGeo);
        const headGeo = new RoundedBoxGeometry(0.075, 0.05, 0.03, 2, 0.012);   // ② 헤드레스트
        headGeo.rotateX(-0.16);
        headGeo.translate(0, 0.575, cz - 0.14);
        pads.push(headGeo);
        const shieldGeo = new THREE.PlaneGeometry(0.16, 0.085).rotateX(-0.35);
        shieldGeo.translate(0, 0.5, cz + 0.11);
        glassGeos.push(shieldGeo);
    }
    // ④ 조종간 (앞좌석): 앞으로 기운 스틱 + 빨간 노브 — 조종사 날개가 이걸 향해 모인다 (updatePlanePose)
    const stickGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.12, 6);
    stickGeo.rotateX(0.3);
    stickGeo.translate(0, 0.485, 0.345);
    wood.push(stickGeo);
    const knobGeo = new THREE.SphereGeometry(0.016, 8, 6);
    knobGeo.translate(0, 0.548, 0.364);
    red.push(knobGeo);
    // 꼬리: 수평 안정판 + 빨간 수직 핀·러더
    const hstabGeo = new THREE.BoxGeometry(0.56, 0.024, 0.2);
    hstabGeo.translate(0, 0.35, -0.7);
    grad.push(bakeGrad(hstabGeo, 0xf4e6c8, 0xd8bd92, { curve: 1 }));
    const finGeo = new THREE.BoxGeometry(0.024, 0.24, 0.18);
    finGeo.translate(0, 0.46, -0.72);
    grad.push(bakeGrad(finGeo, 0xe06a58, 0xb04a3c, { curve: 1 }));
    const rudderGeo = new THREE.BoxGeometry(0.02, 0.17, 0.09);
    rudderGeo.translate(0, 0.47, -0.84);
    red.push(rudderGeo);
    // 랜딩 기어 다리 2 + 꼬리 스키드 (동체 꼬리에 붙여서)
    for (const sx of [-1, 1]) {
        const legGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.22, 6);
        legGeo.rotateZ(sx * 0.35);
        legGeo.translate(sx * 0.26, 0.16, 0.26);
        metal.push(legGeo);
    }
    const skidGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.13, 6);
    skidGeo.rotateX(0.42);
    skidGeo.translate(0, 0.22, -0.7);   // 동체 꼬리 밑면에 밀착
    metal.push(skidGeo);
    // 버킷 → 병합 메시 6개
    g.add(new THREE.Mesh(mergeGeometries(grad, false), gradMat));
    g.add(new THREE.Mesh(mergeGeometries(red, false), M(0xd05a4a)));
    g.add(new THREE.Mesh(mergeGeometries(wood, false), M(0x8a6647, { map: woodTex })));
    g.add(new THREE.Mesh(mergeGeometries(metal, false), M(0x5a5f66)));
    g.add(new THREE.Mesh(mergeGeometries(rims, false), M(0x7d4a2e)));   // 가죽 패딩 림 (새들 브라운)
    g.add(new THREE.Mesh(mergeGeometries(pads, false), M(0x7d4a2e)));   // 가죽 시트백·헤드레스트 (같은 재질 공유)
    g.add(new THREE.Mesh(mergeGeometries(dark, false), M(0x2c241d)));   // 콕핏 내부 어둠
    g.add(new THREE.Mesh(mergeGeometries(glassGeos, false),
        new THREE.MeshStandardMaterial({ color: 0xbfe0ea, transparent: true, opacity: 0.45, roughness: 0.2, metalness: 0.1, side: THREE.DoubleSide })));
    // 가동부: 프로펠러(스피너+블레이드 한 메시+디스크), 바퀴 2 (타이어+허브 병합)
    const propGrp = new THREE.Group();
    propGrp.position.set(0, 0.3, 0.9);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.11, 10).rotateX(Math.PI / 2), M(0x8a6647));
    propGrp.add(spinner);
    const bladeGeos = [];
    for (const a of [0, Math.PI / 2]) {
        const bl = new THREE.BoxGeometry(0.035, 0.5, 0.014);
        bl.rotateZ(a);
        bladeGeos.push(bl);
    }
    const blades = new THREE.Mesh(mergeGeometries(bladeGeos, false), M(0x5a4634, { map: woodTex }));
    propGrp.add(blades);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.27, 20),
        new THREE.MeshBasicMaterial({ color: 0xcfc4ae, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    disc.visible = false;
    propGrp.add(disc);
    g.add(propGrp);
    const wheels = [];
    for (const sx of [-1, 1]) {
        const tire = new THREE.CylinderGeometry(0.085, 0.085, 0.05, 14).rotateZ(Math.PI / 2);
        const wheel = new THREE.Mesh(tire, M(0x3a3a40));
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.054, 10).rotateZ(Math.PI / 2), M(0xd05a4a));
        wheel.add(hub);
        wheel.position.set(sx * 0.3, 0.085, 0.26);
        g.add(wheel);
        wheels.push(wheel);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.userData = { prop: propGrp, blades, disc, wheels };
    return g;
}
const PLANE = { x: -3.2, z: 10.05, y: 0, heading: 3.14, vel: 0, mode: 'parked' };   // 모래섬 남쪽 마른 모래 경사(해수면 -0.45 실측 기준 건조), 기수는 열린 바다
{   // 🔨 저장된 주차 위치 (plane-1) — 수륙양용이라 뭍·물 어디든 유효, 월드 경계 밖만 무시
    const o = savedLayout['plane-1'];
    if (o && Number.isFinite(o.x) && Number.isFinite(o.z) && Math.hypot(o.x, o.z) <= 20.5
        && !window.__nearFerryPier(o.x, o.z, 1.5)) {
        PLANE.x = o.x; PLANE.z = o.z;
        if (Number.isFinite(o.rotY)) PLANE.heading = o.rotY;
    }
}
const planeCollider = { type: 'plane', layoutId: 'plane-1', x: PLANE.x, z: PLANE.z, rotY: 0, r: 0.55, def: { x: -3.2, z: 10.05, rotY: 3.14 } };
PROPS.push(planeCollider);
const planeGroup = makePlane();
planeCollider.obj = planeGroup;   // 호버 라벨 + propTopAt(날개 위 서기)용
stage.add(planeGroup);
let planeRide = null;    // { driver, passenger, liftT, sprayT, lastY } while someone is at the stick
let planeHop = null;     // 절친 뒷좌석 승선 아크
let planeEngine = null;  // { src, gain } 엔진 사운드 루프
function planeSupportY(x, z) {
    // 뭍/다리 = 지면(물밑으로 꺼진 해변 띠는 수면이 받친다), 그 밖 = 수면.
    // ⚠️ terrainHeight는 섬 밖에서 0을 반환(유령 선반 — 해수면 -0.45보다 높다!) — 섬 밖 지형 조회 금지.
    if (onBridge(x, z)) return world.groundHeightAt(x, z);
    if (islandOf(x, z) >= 0) return Math.max(world.groundHeightAt(x, z), waveYAt(x, z) + 0.03);
    return waveYAt(x, z) + 0.03;
}
PLANE.y = planeSupportY(PLANE.x, PLANE.z);
function planeBlocked(nx, nz) {
    // 보행 규칙(림 가드·물가 금지)은 수륙양용에 해당 없음 — 소품 원 + 집 벽 + 경계만 본다
    if (Math.hypot(nx, nz) > 20.5) return true;                    // 수평선 전 경계 (보트와 동일 사상)
    if (Math.hypot(nx - BOAT.x, nz - BOAT.z) < 1.1) return true;   // 정박 보트와 충돌
    if (Math.hypot(nx - FERRY.x, nz - FERRY.z) < 1.5) return true;  // 통통호 선체
    if (houseBlocked(nx, nz)) return true;                         // 집 벽 관통 방지
    for (const q of PROPS) {
        if (q === planeCollider || !(q.r > 0)) continue;
        if (Math.hypot(nx - q.x, nz - q.z) < q.r + 0.35) return true;   // 날개폭 여유
    }
    return false;
}
let _engineBuf = null;
function startPlaneEngine() {
    if (audioCtx.state !== 'running' || planeEngine) return;
    if (!_engineBuf) {   // 푸드덕 푸드덕 — 초당 26방 펄스 노이즈 (프로펠러 단발기)
        const sr = audioCtx.sampleRate, n = Math.floor(sr * 0.46);
        _engineBuf = audioCtx.createBuffer(1, n, sr);
        const d = _engineBuf.getChannelData(0);
        for (let i = 0; i < n; i++) {
            const t = i / sr;
            const putt = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 26)), 6);
            d[i] = (Math.random() * 2 - 1) * putt * 0.8;
        }
    }
    const src = audioCtx.createBufferSource();
    src.buffer = _engineBuf;
    src.loop = true;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 750;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.0001;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(sfxMaster);
    src.start();
    planeEngine = { src, gain };
}
function stopPlaneEngine() {
    if (!planeEngine) return;
    const e = planeEngine;
    planeEngine = null;
    try {
        e.gain.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.12);
        setTimeout(() => { try { e.src.stop(); } catch (err) {} }, 400);
    } catch (err) {}
}
function enterPlane() {
    const driver = possessed;
    if (!driver || planeRide) return;
    let passenger = null;
    const friend = pets.find((q) => q !== driver);
    const friendClose = friend && Math.hypot(friend.mover.position.x - PLANE.x, friend.mover.position.z - PLANE.z) < 1.8;
    if (friend && !friend.bed && !friend.dip && !friend.pet.sleeping
        && ((handHold && handHold.partner === friend) || (friendClose && (friend.ai.state === 'idle' || friend.ai.state === 'walk')))) {
        if (handHold) handHold = null;
        releaseAI(friend);
        friend.ai.state = 'held';
        passenger = friend;
    }
    if (aiFishing && aiFishing.p === passenger) endAiFishing();
    planeRide = { driver, passenger, liftT: 0, sprayT: 0, armed: true };   // armed = 이륙 무장 (착지 후 감속해야 재무장)
    running = false;
    driver.swimming = false;
    PLANE.mode = 'taxi';
    startPlaneEngine();
    logWorldEvent(`${petKo(driver)}가 경비행기 조종석에 올라 시동을 걸었다 🛩️${passenger ? ' (절친도 뒷좌석에!)' : ''}`);
}
function exitPlane(force = false) {
    if (!planeRide) return;
    if (PLANE.mode === 'fly' && !force) return;   // 공중 하차 금지 — doInteract가 토스트 안내
    if (PLANE.mode === 'fly') { PLANE.y = planeSupportY(PLANE.x, PLANE.z); PLANE.mode = 'taxi'; }   // 강제 해제(Esc) = 비상 착륙
    const { driver, passenger } = planeRide;
    const onLand = islandOf(PLANE.x, PLANE.z) >= 0;
    const rX = Math.cos(PLANE.heading), rZ = -Math.sin(PLANE.heading);
    const drop = (q, side) => {
        const dx = PLANE.x + rX * side, dz = PLANE.z + rZ * side;
        if (onLand) {
            q.mover.position.set(dx, world.groundHeightAt(dx, dz), dz);
            q.swimming = false;
        } else {
            const spot = nearestClimbSpot({ x: PLANE.x, z: PLANE.z });
            if (spot && q !== driver) {   // 절친은 가까운 뭍이 있으면 뭍으로
                q.mover.position.set(spot.tx, spot.ty, spot.tz);
                q.swimming = false;
            } else {
                q.mover.position.set(dx, waveYAt(dx, dz) + 0.02 - q.height * 0.45, dz);
                q.swimming = 'sea';
                spawnSplash(dx, waveYAt(dx, dz) + q.height * 0.42, dz);
            }
        }
        q.mover.rotation.x = 0;
        q.mover.rotation.z = 0;
    };
    if (passenger) {
        drop(passenger, 0.85);
        if (passenger.ai.state === 'held') releaseAI(passenger);
    }
    planeRide = null;
    PLANE.vel = 0;
    PLANE.mode = 'parked';
    stopPlaneEngine();
    drop(driver, -0.85);
    if (driver.swimming) playSplashSound(driver.mover.position.x, driver.mover.position.z);
    logWorldEvent(`${petKo(driver)}가 경비행기에서 내렸다${onLand ? '' : ' — 물에 퐁당'}`);
    saveLayout();   // 주차 위치 저장 — 뭍이든 물이든 그 자리에
}
// 비행기 한 스텝: 활주(taxi)는 차 문법 + 물이면 물살, 비행(fly)은 W/S 고도·↑↓ 속도·←→ 선회(뱅킹).
function stepPlane(delta, driver) {
    const r = planeRide;
    const onWater = islandOf(PLANE.x, PLANE.z) < 0 && !onBridge(PLANE.x, PLANE.z);
    let thr = 0;
    if (heldKeys.has('ArrowUp')) thr += 1;
    if (heldKeys.has('ArrowDown')) thr -= 1;
    let steer = (heldKeys.has('ArrowLeft') ? 1 : 0) - (heldKeys.has('ArrowRight') ? 1 : 0);
    if (touchMove.active) steer = THREE.MathUtils.clamp(steer - touchMove.x, -1, 1);
    const maxTaxi = 2.9, maxFly = 3.7;
    let pitch = 0, bank = 0;
    if (PLANE.mode === 'taxi') {
        if (touchMove.active) thr = THREE.MathUtils.clamp(thr + touchMove.z, -1, 1);
        PLANE.vel += thr * (thr > 0 ? 2.7 : 1.9) * delta;
        PLANE.vel *= Math.pow(onWater ? 0.45 : 0.3, delta);   // 물은 활공, 뭍은 구름 저항
        PLANE.vel = THREE.MathUtils.clamp(PLANE.vel, -1.0, maxTaxi);
        PLANE.heading += steer * delta * 1.6 * THREE.MathUtils.clamp(PLANE.vel / maxTaxi, -1, 1);
        const nx = PLANE.x + Math.sin(PLANE.heading) * PLANE.vel * delta;
        const nz = PLANE.z + Math.cos(PLANE.heading) * PLANE.vel * delta;
        // 절벽 턱은 "오르기"만 금지 — 내려가기(섬 림→바다)는 허용: 좁은 섬에선 바다로 활주해
        // 이륙해야 하므로, 가장자리를 넘으면 낙하해서 수면 활주로 이어진다 (아래 중력 낙하)
        const stepUp = planeSupportY(nx, nz) - planeSupportY(PLANE.x, PLANE.z) > 0.35;
        if (!stepUp && !planeBlocked(nx, nz)) { PLANE.x = nx; PLANE.z = nz; }
        else PLANE.vel = 0;
        const sup = planeSupportY(PLANE.x, PLANE.z);
        if (PLANE.y > sup + 0.05) {   // 턱을 넘었다 — 전진 관성 그대로 짧은 낙하 (동숲식 절벽 폴짝)
            r.fallVy = (r.fallVy || 0) - 7.0 * delta;
            PLANE.y = Math.max(sup, PLANE.y + r.fallVy * delta);
            pitch = THREE.MathUtils.clamp(r.fallVy * 0.12, -0.22, 0);
            if (PLANE.y === sup) {
                r.fallVy = 0;
                if (islandOf(PLANE.x, PLANE.z) < 0) {   // 물에 착수 — 첨벙
                    spawnSplash(PLANE.x, waveYAt(PLANE.x, PLANE.z) + 0.06, PLANE.z);
                    playSplashSound(PLANE.x, PLANE.z);
                } else playStep('road', 1.0);
            }
        } else {
            PLANE.y = sup;
            r.fallVy = 0;
        }
        for (const w of planeGroup.userData.wheels) w.rotation.x += PLANE.vel * delta * 11;   // 바퀴 구름
        if (onWater) {
            bank = Math.sin(wxTime.value * 1.2) * 0.02;   // 물 위 살랑임
            r.sprayT += Math.abs(PLANE.vel) * delta;
            if (Math.abs(PLANE.vel) > 0.9 && r.sprayT > 0.34) {   // 물살 가르기 — 기수 양옆 스프레이
                r.sprayT = 0;
                const sX = Math.cos(PLANE.heading), sZ = -Math.sin(PLANE.heading);
                const side = Math.random() < 0.5 ? 0.3 : -0.3;
                spawnSplash(PLANE.x + Math.sin(PLANE.heading) * 0.5 + sX * side, waveYAt(PLANE.x, PLANE.z) + 0.05, PLANE.z + Math.cos(PLANE.heading) * 0.5 + sZ * side);
            }
        }
        if (PLANE.vel < 2.0) r.armed = true;   // 감속하면 재이륙 무장 (터치다운 직후 튕겨 오르기 방지)
        if (r.armed && PLANE.vel > 2.55 && !(r.fallVy < 0)) {   // 전속력 → 자동 로테이트 (이륙!) — 낙하 중엔 착수 먼저
            PLANE.mode = 'fly';
            r.armed = false;
            r.liftT = 0;
            playBuffer(swishBuf, { vol: 0.5, rate: 0.6, filterFreq: 900 });
            logWorldEvent(`${petKo(driver)}의 경비행기가 ${onWater ? '물살을 가르며' : '초원을 달려'} 두둥실 떠올랐다! 🛫`);
        }
    } else if (PLANE.mode === 'fly') {
        r.liftT += delta;
        PLANE.vel += thr * 1.5 * delta;
        PLANE.vel = THREE.MathUtils.clamp(PLANE.vel, 2.0, maxFly);   // 실속 없음 — 최저 순항속도 보장
        PLANE.heading += steer * delta * 1.3;
        let climb = 0;
        if (heldKeys.has('KeyW')) climb += 1;   // W = 상승, S = 하강 (요청 매핑)
        if (heldKeys.has('KeyS')) climb -= 1;
        if (touchMove.active) climb = THREE.MathUtils.clamp(climb + touchMove.z, -1, 1);   // 📱 스틱 상하 = 고도
        if (r.liftT < 0.7) climb = Math.max(climb, 0.75);   // 이륙 직후 자동 상승 (로테이트)
        PLANE.y = Math.min(PLANE.y + climb * 2.1 * delta, 7.5);   // 천장 — 구름 밑
        const nx = PLANE.x + Math.sin(PLANE.heading) * PLANE.vel * delta;
        const nz = PLANE.z + Math.cos(PLANE.heading) * PLANE.vel * delta;
        const rr = Math.hypot(nx, nz);
        if (rr > 20.5) { PLANE.x = nx * (20.5 / rr); PLANE.z = nz * (20.5 / rr); }   // 경계 — 미끄러지듯 선회 유도
        else { PLANE.x = nx; PLANE.z = nz; }
        const sup = planeSupportY(PLANE.x, PLANE.z);
        if (PLANE.y <= sup + 0.1 && climb <= 0) {   // 터치다운
            PLANE.y = sup;
            PLANE.mode = 'taxi';
            PLANE.vel = Math.min(PLANE.vel, maxTaxi);
            const water = islandOf(PLANE.x, PLANE.z) < 0;
            if (water) {
                spawnSplash(PLANE.x, waveYAt(PLANE.x, PLANE.z) + 0.06, PLANE.z);
                playSplashSound(PLANE.x, PLANE.z);
            } else playStep('road', 1.2);
            logWorldEvent(`${petKo(driver)}의 경비행기가 ${water ? '수면에 사뿐히 착수했다' : '초원에 사뿐히 내려앉았다'} 🛬`);
        } else {
            PLANE.y = Math.max(PLANE.y, sup + 0.02);
            pitch = -climb * 0.24 - (r.liftT < 0.7 ? 0.1 : 0) + Math.sin(wxTime.value * 1.6) * 0.015;   // 기수 & 미세 부양
            bank = steer * 0.42;   // 선회 뱅킹
        }
    }
    planeCollider.x = PLANE.x;
    planeCollider.z = PLANE.z;
    planeGroup.position.set(PLANE.x, PLANE.y + (onWater && PLANE.mode === 'taxi' ? Math.sin(wxTime.value * 1.3) * 0.015 : 0), PLANE.z);
    planeGroup.rotation.set(pitch, PLANE.heading, bank);
    // 프로펠러: 회전 + 고rpm에선 모션블러 디스크
    const rpm = PLANE.mode === 'fly' ? 38 : 7 + Math.abs(PLANE.vel) * 9;
    planeGroup.userData.prop.rotation.z += rpm * delta;
    const fast = rpm > 26;
    planeGroup.userData.disc.visible = fast;
    planeGroup.userData.blades.visible = !fast;
    if (planeEngine) {   // 엔진음 — rpm 피치·속도 볼륨
        planeEngine.src.playbackRate.value = 0.72 + (rpm / 38) * 0.7;
        planeEngine.gain.gain.value = (0.045 + Math.min(0.1, Math.abs(PLANE.vel) * 0.028) + (PLANE.mode === 'fly' ? 0.03 : 0)) * attAtPoint(PLANE.x, PLANE.z);
    }
    // 좌석: 앞=조종사, 뒤=절친 (둘 다 전방 주시, 기체 피치 따라 몸도 기운다)
    const seatPet = (q, fwd) => {
        q.mover.position.set(
            PLANE.x + Math.sin(PLANE.heading) * fwd,
            planeGroup.position.y + 0.4 - q.height * 0.32,   // 몸은 콕핏 속, 부리·주둥이까지 림 위 (키 비례)
            PLANE.z + Math.cos(PLANE.heading) * fwd
        );
        q.mover.rotation.y = PLANE.heading;
        q.mover.rotation.x = pitch * 0.8;
        q.mover.rotation.z = bank * 0.5;
        q.pet.walking = false;
        q.swimming = false;
    };
    seatPet(driver, 0.28);
    if (r.passenger) seatPet(r.passenger, -0.18);
}
// 주차 중: 물 위면 파도 위 살랑, 뭍이면 정지 — 프로펠러도 멈춤 (프레임 비용 0에 수렴)
function updatePlaneIdle() {
    if (planeRide) return;
    const onWater = islandOf(PLANE.x, PLANE.z) < 0 && !onBridge(PLANE.x, PLANE.z);
    const y = planeSupportY(PLANE.x, PLANE.z);
    planeGroup.position.set(PLANE.x, y + (onWater ? Math.sin(wxTime.value * 0.7) * 0.015 : 0), PLANE.z);
    planeGroup.rotation.set(0, PLANE.heading, onWater ? Math.sin(wxTime.value * 0.6 + 0.8) * 0.02 : 0);
}
// 탑승 포즈: 조종사는 날개를 조종간 쪽으로 모으고(그립), 승객은 편안히 — 비행 중엔 맞바람에
// 귀가 뒤로 눕는다. 엔티티 업데이트 뒤 덮어쓰기 (자동 복원)
function updatePlanePose() {
    if (!planeRide) return;
    const wind = PLANE.mode === 'fly' ? Math.min(1, PLANE.vel / 3.2) : 0;
    const pose = (q, tuck) => {
        if (!q) return;
        for (const er of q.pet.ears) er.rotation.x = (er.userData._restRotX || 0) + 0.55 * wind;
        for (const wg of q.pet.wings) wg.rotation.z = (wg.userData._restRotZ || 0) * tuck;
    };
    pose(planeRide.driver, 0.28);      // 조종간 그립 — 날개 앞으로 모음
    pose(planeRide.passenger, 0.6);
}
// 🛩️ 우클릭 메뉴 — 활주/주차 탑승 중 "친구 태우기": 절친이 포르르 나타나 뒷좌석으로 폴짝
const planeMenu = document.createElement('div');
planeMenu.style.cssText = 'position:fixed; display:none; z-index:130; background:rgba(30,32,40,0.94); border-radius:10px; padding:6px; box-shadow:0 6px 18px rgba(0,0,0,0.35);';
const planeMenuBtn = document.createElement('button');
planeMenuBtn.textContent = '👥 친구 태우기';
planeMenuBtn.style.cssText = 'display:block; background:none; border:none; color:#fff; font-size:13px; padding:7px 12px; border-radius:7px; cursor:pointer; font-family:sans-serif;';
planeMenuBtn.onmouseenter = () => { planeMenuBtn.style.background = 'rgba(255,255,255,0.14)'; };
planeMenuBtn.onmouseleave = () => { planeMenuBtn.style.background = 'none'; };
planeMenuBtn.onclick = () => { planeMenu.style.display = 'none'; summonPlanePassenger(); };
planeMenu.appendChild(planeMenuBtn);
document.body.appendChild(planeMenu);
function showPlaneMenu(x, y) {
    planeMenu.style.left = `${Math.min(x, window.innerWidth - 150)}px`;
    planeMenu.style.top = `${Math.min(y, window.innerHeight - 60)}px`;
    planeMenu.style.display = 'block';
}
function summonPlanePassenger() {
    if (!planeRide || planeRide.passenger || planeHop || PLANE.mode === 'fly') return;
    const friend = pets.find((q) => q !== planeRide.driver);
    if (!friend) { showToast('👥 부를 친구가 없어요'); return; }
    friend.pet.sleeping = false;
    friend.pet.autoSleeping = false;
    if (friend.bed) forceEndBed(friend);
    if (friend.dip) endDip(friend);
    if (aiFishing && aiFishing.p === friend) endAiFishing();
    releaseAI(friend);
    friend.ai.state = 'held';
    friend.swimming = false;
    // 비행기 곁으로 순간이동 후 뒷좌석으로 폴짝 (보트 문법)
    const sx = PLANE.x - Math.sin(PLANE.heading) * 1.0, sz = PLANE.z - Math.cos(PLANE.heading) * 1.0;
    const fy = planeSupportY(sx, sz);
    friend.mover.position.set(sx, fy, sz);
    friend.mover.rotation.x = 0;
    friend.mover.rotation.z = 0;
    planeHop = { q: friend, fx: sx, fy, fz: sz, t: 0 };
    showToast('👥 절친이 포르르 나타나 뒷좌석으로 폴짝!');
    logWorldEvent(`${petKo(friend)}가 경비행기 뒷좌석에 폴짝 올라탔다`);
}
function updatePlaneHop(delta) {
    if (!planeHop) return;
    planeHop.t += delta;
    const k = Math.min(1, planeHop.t / 0.6);
    const e = k * k * (3 - 2 * k);
    const q = planeHop.q;
    const ty = planeSupportY(PLANE.x, PLANE.z) + 0.4 - q.height * 0.32;
    const tx = PLANE.x - Math.sin(PLANE.heading) * 0.18, tz = PLANE.z - Math.cos(PLANE.heading) * 0.18;
    q.mover.position.set(
        THREE.MathUtils.lerp(planeHop.fx, tx, e),
        THREE.MathUtils.lerp(planeHop.fy, ty, e) + Math.sin(k * Math.PI) * 0.5,
        THREE.MathUtils.lerp(planeHop.fz, tz, e)
    );
    q.mover.rotation.y = PLANE.heading;
    q.pet.walking = false;
    if (k >= 1) {
        planeHop = null;
        if (planeRide && !planeRide.passenger) planeRide.passenger = q;
        else { q.swimming = false; releaseAI(q); snapToLand(q); }
    }
}

// ---- 🎈 열기구 (자동 관광 라이드): NE 놀이터섬 동쪽 계류장. 타면 혼자 두둥실 떠올라 하늘
// 산책 — 실무 문법: 폐곡선 Catmull-Rom 스플라인, 위치=곡선(u)·방향=접선(u), 물리 0.
// 경유지 셔플(3~5곳) + 방향 코인플립 + 지터 = 매 바퀴 다른 경로 (순항 밴드 위라 전부 안전).
// 한 바퀴 ≈ 2분 15초, 안 내리면 무한 루프(바퀴마다 새 경로). ⌘ = 저공 물스침에선 바로 퐁당,
// 아니면 정거장 귀환 요청. 한가한 펫은 가끔 혼자 타러 간다 (자율 낚시 문법). ----
const BALLOON_HOME = { x: 13.05, z: 6.75 };
const BALLOON_CRUISE = [4.6, 6.0];   // 순항 고도 밴드 — 전망대 언덕(1.1+데크)·집 지붕 위
const BALLOON_POIS = [
    { x: 0, z: 0, ko: '광장 분수' },
    { x: 2.7, z: 2.05, ko: '우리 집' },
    { x: -2.6, z: -2.9, ko: '연못' },
    { x: -3.2, z: 11.8, ko: '휴양지 모래섬' },
    { x: 10.12, z: -7.17, ko: '모험의 섬' },
    { x: -10.72, z: -4.69, ko: '추억의 섬' },
    { x: 1.2, z: 7.4, ko: '북쪽 물가' },
    { x: -13.5, z: 2.5, ko: '서쪽 먼바다', low: true },   // 저공 물스침 구간 후보
    { x: 14.5, z: -1.5, ko: '동쪽 먼바다', low: true },
];
function makeBalloonRoute() {
    const pool = [...BALLOON_POIS];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const picks = pool.slice(0, 3 + Math.floor(Math.random() * 3));
    if (!picks.some((q) => q.low)) picks.push(BALLOON_POIS[7 + Math.floor(Math.random() * 2)]);   // 저공 구간 1곳 보장
    const order = [];   // 최근접 이웃 정렬 — 널뛰기 없는 한붓 루프
    let cur = BALLOON_HOME;
    const rest = [...picks];
    while (rest.length) {
        let bi = 0, bd = Infinity;
        rest.forEach((q, i) => { const d = Math.hypot(q.x - cur.x, q.z - cur.z); if (d < bd) { bd = d; bi = i; } });
        cur = rest.splice(bi, 1)[0];
        order.push(cur);
    }
    if (Math.random() < 0.5) order.reverse();   // 방향 코인플립
    const pts = [new THREE.Vector3(BALLOON_HOME.x, BALLOON_CRUISE[0], BALLOON_HOME.z)];
    const names = [];
    for (const q of order) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * 1.2;   // 제어점 지터
        const alt = q.low ? 1.7 : BALLOON_CRUISE[0] + Math.random() * (BALLOON_CRUISE[1] - BALLOON_CRUISE[0]);
        pts.push(new THREE.Vector3(q.x + Math.cos(a) * rr, alt, q.z + Math.sin(a) * rr));
        names.push({ ko: q.ko, low: !!q.low, idx: pts.length - 1 });
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const len = curve.getLength();
    return { curve, len, speed: len / 135, names, visited: new Set() };   // 한 바퀴 ≈ 2분 15초
}
function makeBalloon() {
    const g = new THREE.Group();
    // 봉투: 세로 8고어 스트라이프 (정점색) — 버너 펄스 때 은은히 밝아지는 유니크 재질
    const envPts = [
        new THREE.Vector2(0.2, 0), new THREE.Vector2(0.5, 0.22), new THREE.Vector2(0.71, 0.5),
        new THREE.Vector2(0.76, 0.85), new THREE.Vector2(0.7, 1.15), new THREE.Vector2(0.52, 1.38),
        new THREE.Vector2(0.24, 1.52), new THREE.Vector2(0.02, 1.58),
    ];
    const envGeo = new THREE.LatheGeometry(envPts, 24);
    const pos = envGeo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const cCream = new THREE.Color(0xf4e6c8), cRed = new THREE.Color(0xd05a4a);
    for (let i = 0; i < pos.count; i++) {
        const a = Math.atan2(pos.getX(i), pos.getZ(i));
        const gore = Math.floor(((a / (Math.PI * 2)) + 0.5) * 8 + 0.01);
        const c = (gore % 2 === 0) ? cCream : cRed;
        const shade = 0.85 + 0.15 * Math.min(1, pos.getY(i) / 1.3);
        cols[i * 3] = c.r * shade; cols[i * 3 + 1] = c.g * shade; cols[i * 3 + 2] = c.b * shade;
    }
    envGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    envGeo.translate(0, 1.12, 0);
    const envMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, emissive: new THREE.Color(0xff9a3c), emissiveIntensity: 0 });
    const envelope = new THREE.Mesh(envGeo, envMat);
    g.add(envelope);
    // 바구니(등나무) + 바닥 + 림 + 로프 4 + 버너 프레임 — 나무 버킷 병합
    const wood = [];
    const basketGeo = new THREE.CylinderGeometry(0.42, 0.35, 0.42, 10, 1, true);   // 2인승 곤돌라 폭
    basketGeo.translate(0, 0.21, 0);
    wood.push(basketGeo);
    const floorGeo = new THREE.CircleGeometry(0.36, 10).rotateX(-Math.PI / 2);
    floorGeo.translate(0, 0.03, 0);
    wood.push(floorGeo);
    const rimGeo = new THREE.TorusGeometry(0.42, 0.032, 8, 16).rotateX(Math.PI / 2);
    rimGeo.translate(0, 0.43, 0);
    wood.push(rimGeo);
    for (const a of [0.4, 1.97, 3.54, 5.11]) {
        const ropeGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.78, 5);
        ropeGeo.translate(0, 0.39, 0);
        ropeGeo.rotateZ(0.38);
        ropeGeo.rotateY(a);
        ropeGeo.translate(0, 0.42, 0);
        wood.push(ropeGeo);
    }
    for (const sx of [-1, 1]) {   // 버너 프레임 기둥 2
        const poleGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.42, 5);
        poleGeo.translate(sx * 0.16, 0.62, 0);
        wood.push(poleGeo);
    }
    g.add(new THREE.Mesh(mergeGeometries(wood, false), M(0x9a7048, { map: woodTex })));
    // 모래주머니 3 (캔버스 탠)
    const bags = [];
    for (const a of [0.7, 2.8, 4.9]) {
        const bagGeo = new THREE.SphereGeometry(0.062, 8, 7);
        bagGeo.scale(1, 1.35, 1);
        bagGeo.translate(Math.sin(a) * 0.46, 0.3, Math.cos(a) * 0.46);
        bags.push(bagGeo);
    }
    g.add(new THREE.Mesh(mergeGeometries(bags, false), M(0xd8c39a)));
    // 버너 (다크 메탈)
    const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.09, 8), M(0x5a5f66));
    burner.position.set(0, 0.86, 0);
    g.add(burner);
    // 계류 밧줄 — 정박 중에만 보임 (포스트 쪽으로 늘어짐)
    const moorGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 5);
    moorGeo.rotateZ(1.05);
    moorGeo.translate(0.62, 0.28, 0);
    const moor = new THREE.Mesh(moorGeo, M(0xc9b18a));
    g.add(moor);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.userData = { envMat, moor, burnerY: 0.9 };
    return g;
}
let balloonDockY = terrainHeight(BALLOON_HOME.x, BALLOON_HOME.z) + 0.06;
const BALLOON = { x: BALLOON_HOME.x, y: balloonDockY, z: BALLOON_HOME.z, heading: -2.1, mode: 'docked' };
const balloonCollider = { type: 'balloon', layoutId: 'balloon-1', x: BALLOON_HOME.x, z: BALLOON_HOME.z, rotY: 0, r: 0.5, def: { x: BALLOON_HOME.x, z: BALLOON_HOME.z, rotY: 0 } };
PROPS.push(balloonCollider);
const balloonGroup = makeBalloon();
balloonCollider.obj = balloonGroup;
balloonGroup.position.set(BALLOON.x, BALLOON.y, BALLOON.z);
balloonGroup.rotation.y = BALLOON.heading;
stage.add(balloonGroup);
let balloonStation = null;   // 🔨 공사모드 이동용 — 그룹 오프셋으로 통째 이사
{   // 계류장: 나무 데크 + 포스트 + 팻말 — 정적이라 월드 베이크에 편입
    const saved = savedLayout['balloon-1'];   // 저장된 계류장 위치 자기적용 (섬 위만)
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.z) && islandOf(saved.x, saved.z) >= 0) {
        BALLOON_HOME.x = saved.x; BALLOON_HOME.z = saved.z;
        BALLOON.x = saved.x; BALLOON.z = saved.z;
        balloonCollider.x = saved.x; balloonCollider.z = saved.z;
        balloonDockY = terrainHeight(saved.x, saved.z) + 0.06;
        BALLOON.y = balloonDockY;
    }
    const st = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.78, 0.06, 14), M(0xb08a60, { map: plankTex }));
    deck.position.set(BALLOON_HOME.x, balloonDockY - 0.05, BALLOON_HOME.z);
    st.add(deck);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.52, 8), M(0x8a6647, { map: woodTex }));
    post.position.set(BALLOON_HOME.x + 0.62, balloonDockY + 0.2, BALLOON_HOME.z);
    st.add(post);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.03), M(0xf4e6c8));
    sign.position.set(BALLOON_HOME.x + 0.62, balloonDockY + 0.52, BALLOON_HOME.z);
    sign.rotation.y = -2.1;
    st.add(sign);
    st.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    stage.add(st);
    WORLD_STATIC_ROOTS.push(st);
    st.userData.base = { x: BALLOON_HOME.x, z: BALLOON_HOME.z, y: balloonDockY };   // 이동 델타 기준
    balloonStation = st;
}
function moveBalloonHome(x, z) {   // 🔨 계류장 통째 이사 — 데크·포스트·팻말은 그룹 오프셋으로
    BALLOON_HOME.x = x; BALLOON_HOME.z = z;
    balloonDockY = terrainHeight(x, z) + 0.06;
    const b = balloonStation.userData.base;
    balloonStation.position.set(x - b.x, balloonDockY - b.y, z - b.z);
    if (BALLOON.mode === 'docked') { BALLOON.x = x; BALLOON.z = z; BALLOON.y = balloonDockY; }
    balloonCollider.x = x; balloonCollider.z = z;
}
let balloonRide = null;   // { p, friend, isAI, t, u, lap, route, burnerAt, burnerT, empty }
let aiBalloonWalk = null; // AI가 계류장으로 걸어가는 중 { p, ownArrive }
let balloonHop = null;    // 절친이 데크에서 바구니로 그리는 큰 승선 아크 { q, fx, fy, fz, t }
const balloonMenu = document.createElement('div');
balloonMenu.style.cssText = 'position:fixed; display:none; z-index:130; background:rgba(30,32,40,0.94); border-radius:10px; padding:6px; box-shadow:0 6px 18px rgba(0,0,0,0.35);';
const balloonMenuBtn = document.createElement('button');
balloonMenuBtn.textContent = '👥 친구 태우기';
balloonMenuBtn.style.cssText = 'display:block; background:none; border:none; color:#fff; font-size:13px; padding:7px 12px; border-radius:7px; cursor:pointer; font-family:sans-serif;';
balloonMenuBtn.onmouseenter = () => { balloonMenuBtn.style.background = 'rgba(255,255,255,0.14)'; };
balloonMenuBtn.onmouseleave = () => { balloonMenuBtn.style.background = 'none'; };
balloonMenuBtn.onclick = () => { balloonMenu.style.display = 'none'; summonBalloonFriend(); };
balloonMenu.appendChild(balloonMenuBtn);
document.body.appendChild(balloonMenu);
function showBalloonMenu(x, y) {
    balloonMenu.style.left = `${Math.min(x, window.innerWidth - 150)}px`;
    balloonMenu.style.top = `${Math.min(y, window.innerHeight - 60)}px`;
    balloonMenu.style.display = 'block';
}
function summonBalloonFriend() {
    const r = balloonRide;
    if (!r || r.friend || r.isAI || balloonHop || BALLOON.mode === 'land') return;
    if (r.t > 15) { showToast('🎈 너무 멀리 떠났어요 — 다음 탑승 때 함께 타요'); return; }
    const friend = pets.find((q) => q !== r.p);
    if (!friend) { showToast('👥 부를 친구가 없어요'); return; }
    friend.pet.sleeping = false;
    friend.pet.autoSleeping = false;
    if (friend.bed) forceEndBed(friend);
    if (friend.dip) endDip(friend);
    if (aiFishing && aiFishing.p === friend) endAiFishing();
    releaseAI(friend);
    friend.ai.state = 'held';
    friend.swimming = false;
    // 계류장 데크에 포르르 등장 → 바구니까지 큰 점프 아크 (움직이는 바구니를 따라잡는다)
    friend.mover.position.set(BALLOON_HOME.x - 0.6, balloonDockY, BALLOON_HOME.z - 0.3);
    friend.mover.rotation.x = 0;
    friend.mover.rotation.z = 0;
    balloonHop = { q: friend, fx: friend.mover.position.x, fy: balloonDockY, fz: friend.mover.position.z, t: 0 };
    showToast('👥 절친이 포르르 나타나 바구니로 크게 폴짝!');
    logWorldEvent(`${petKo(friend)}가 열기구 바구니로 폴짝 올라탔다`);
}
function updateBalloonHop(delta) {
    if (!balloonHop) return;
    balloonHop.t += delta;
    const k = Math.min(1, balloonHop.t / 0.9);
    const e = k * k * (3 - 2 * k);
    const q = balloonHop.q;
    const rgX = Math.cos(BALLOON.heading), rgZ = -Math.sin(BALLOON.heading);
    const tx = BALLOON.x - rgX * 0.19, ty = BALLOON.y + 0.24, tz = BALLOON.z - rgZ * 0.19;
    q.mover.position.set(
        THREE.MathUtils.lerp(balloonHop.fx, tx, e),
        THREE.MathUtils.lerp(balloonHop.fy, ty, e) + Math.sin(k * Math.PI) * (1.0 + (ty - balloonHop.fy) * 0.25),
        THREE.MathUtils.lerp(balloonHop.fz, tz, e)
    );
    q.mover.rotation.y = BALLOON.heading;
    q.pet.walking = false;
    if (k >= 1) {
        balloonHop = null;
        if (balloonRide && !balloonRide.friend && BALLOON.mode !== 'docked') balloonRide.friend = q;
        else { q.swimming = false; releaseAI(q); snapToLand(q); }
    }
}
function enterBalloon(rider, isAI = false) {
    if (balloonRide || BALLOON.mode !== 'docked' || !rider) return;
    let friend = null;
    if (!isAI) {
        const q = pets.find((o) => o !== rider);
        if (q && !q.bed && !q.dip && !q.pet.sleeping
            && Math.hypot(q.mover.position.x - BALLOON.x, q.mover.position.z - BALLOON.z) < 1.9
            && (q.ai.state === 'idle' || q.ai.state === 'walk' || (handHold && handHold.partner === q))) {
            if (handHold) handHold = null;
            if (aiFishing && aiFishing.p === q) endAiFishing();
            releaseAI(q);
            q.ai.state = 'held';
            friend = q;
        }
    }
    balloonRide = { p: rider, friend, isAI, t: 0, u: 0, lap: 0, route: null, burnerAt: 0.8, burnerT: 0 };
    rider.swimming = false;
    if (!isAI) running = false;
    BALLOON.mode = 'launch';
    balloonCollider.r = 0;
    balloonGroup.userData.moor.visible = false;
    playBuffer(swishBuf, { vol: 0.4, rate: 0.5, filterFreq: 700 });
    logWorldEvent(`${petKo(rider)}가 열기구 바구니에 올랐다 — 두둥실 하늘 산책${friend ? ' (절친도 함께!)' : ''} 🎈`);
    if (!isAI) showToast('🎈 두둥실… 경치를 즐겨요! (Ctrl/⌘ = 하차 · 저공 물 위에선 바로 퐁당)');
}
function balloonDismount() {
    const r = balloonRide;
    const out = (q, side) => {
        if (!q) return;
        const dx = BALLOON_HOME.x + side * 0.75, dz = BALLOON_HOME.z + side * 0.25;
        q.mover.position.set(dx, world.groundHeightAt(dx, dz), dz);
        q.mover.rotation.x = 0;
        q.mover.rotation.z = 0;
        q.swimming = false;
        if (q.ai.state === 'held') releaseAI(q);
    };
    out(r.p, -1);
    out(r.friend, 1);
    if (r.isAI && r.p) releaseAI(r.p, 2);
    balloonRide = null;
    BALLOON.mode = 'docked';
    BALLOON.x = BALLOON_HOME.x; BALLOON.z = BALLOON_HOME.z; BALLOON.y = balloonDockY;
    balloonCollider.x = BALLOON_HOME.x; balloonCollider.z = BALLOON_HOME.z;
    balloonCollider.r = 0.5;
    balloonGroup.userData.moor.visible = true;
    balloonGroup.userData.envMat.emissiveIntensity = 0;
}
function requestBalloonExit() {
    const r = balloonRide;
    if (!r || BALLOON.mode === 'docked') return;
    const overWater = islandOf(BALLOON.x, BALLOON.z) < 0 && !onBridge(BALLOON.x, BALLOON.z);
    if (overWater && BALLOON.y - waveYAt(BALLOON.x, BALLOON.z) < 2.4) {
        for (const [q, side] of [[r.p, -1], [r.friend, 1]]) {
            if (!q) continue;
            const dx = BALLOON.x + side * 0.5, dz = BALLOON.z;
            q.mover.position.set(dx, waveYAt(dx, dz) + 0.02 - q.height * 0.45, dz);
            q.swimming = 'sea';
            q.mover.rotation.x = 0;
            q.mover.rotation.z = 0;
            if (q.ai.state === 'held') releaseAI(q);
            spawnSplash(dx, waveYAt(dx, dz) + q.height * 0.42, dz);
        }
        playSplashSound(BALLOON.x, BALLOON.z);
        r.p = null; r.friend = null; r.empty = true;
        BALLOON.mode = 'land';
        showToast('🎈 첨벙! 빈 열기구는 혼자 정거장으로 돌아가요');
        logWorldEvent('열기구에서 바다로 풍덩 뛰어내렸다 — 빈 열기구는 집으로');
    } else if (BALLOON.mode !== 'land') {
        BALLOON.mode = 'land';
        showToast('🎈 정거장으로 돌아갑니다 — 도착하면 내려요');
    }
}
function exitBalloonForce() {   // Esc/빙의 해제 — 라이더는 계류장 데크로, 빈 열기구는 자율 귀환
    const r = balloonRide;
    if (!r) return;
    for (const [q, side] of [[r.p, -1], [r.friend, 1]]) {
        if (!q) continue;
        const dx = BALLOON_HOME.x + side * 0.75, dz = BALLOON_HOME.z + side * 0.25;
        q.mover.position.set(dx, world.groundHeightAt(dx, dz), dz);
        q.mover.rotation.x = 0;
        q.mover.rotation.z = 0;
        q.swimming = false;
        if (q.ai.state === 'held') releaseAI(q);
    }
    r.p = null; r.friend = null; r.empty = true;
    if (BALLOON.mode === 'launch' || BALLOON.y < balloonDockY + 0.5) balloonDismount();
    else BALLOON.mode = 'land';
}
function startAiBalloon(p) {
    if (balloonRide || aiBalloonWalk || BALLOON.mode !== 'docked') return;
    if (p === possessed || p.bed || p.dip || p.pet.sleeping) return;
    releaseAI(p);
    p.ai.state = 'goto';
    const tx = BALLOON_HOME.x - 0.9, tz = BALLOON_HOME.z - 0.35;
    p.ai.target = { x: tx, z: tz };
    p.ai.waypoints = buildRoute(p.mover.position, { x: tx, z: tz });
    p.ai.stall = 0;
    const walk = { p };
    walk.ownArrive = () => {
        if (aiBalloonWalk !== walk) return;
        aiBalloonWalk = null;
        if (balloonRide || BALLOON.mode !== 'docked' || p === possessed || p.bed || p.dip) { releaseAI(p); return; }
        enterBalloon(p, true);   // ai.state 'busy' 유지 — 소유권 표식
    };
    p.ai.onArrive = walk.ownArrive;
    aiBalloonWalk = walk;
    logWorldEvent(`${petKo(p)}가 열기구를 타러 계류장으로 나섰다 🎈`);
}
function updateBalloon(delta) {
    const g = balloonGroup;
    const ud = g.userData;
    // AI 도보 소유권: 다른 디렉터가 goto를 덮어쓰면 접는다
    if (aiBalloonWalk && (aiBalloonWalk.p.ai.onArrive !== aiBalloonWalk.ownArrive || aiBalloonWalk.p.ai.state !== 'goto')) aiBalloonWalk = null;
    if (BALLOON.mode === 'docked') {
        g.position.set(BALLOON.x, BALLOON.y + Math.sin(wxTime.value * 0.6) * 0.012, BALLOON.z);
        g.rotation.set(0, BALLOON.heading, Math.sin(wxTime.value * 0.5 + 1) * 0.012);
        return;
    }
    const r = balloonRide;
    if (!r) { BALLOON.mode = 'docked'; return; }
    // AI 라이더: 주인이 빙의하면 수동 라이드로 전환(하이재킹 = 기능), 디렉터가 뺏으면 빈 귀환
    if (r.isAI && r.p) {
        if (r.p === possessed) r.isAI = false;
        else if (r.p.ai.state !== 'busy') { r.p = null; r.empty = true; BALLOON.mode = 'land'; }
        else if (isSleepTime(currentHour()) && BALLOON.mode === 'tour') BALLOON.mode = 'land';
    }
    r.t += delta;
    // ---- 버너: 6~11초 간격 "푸쉬—" (사운드 + 글로우 + 봉투 은은한 발광 — 밤엔 더 밝게) ----
    r.burnerAt -= delta;
    if (r.burnerAt <= 0) {
        r.burnerAt = 6 + Math.random() * 5;
        r.burnerT = 0.8;
        playBuffer(swishBuf, { vol: 0.35 * attAtPoint(BALLOON.x, BALLOON.z), rate: 0.42, filterFreq: 500 });
        const spr = glowSprite(0xffb35c, 0.14, 0.95);
        spr.position.set(BALLOON.x, BALLOON.y + ud.burnerY, BALLOON.z);
        scene.add(spr);
        hugBurst.push({ spr, vx: 0, vy: 0.55, vz: 0, t: 0.45 });
    }
    if (r.burnerT > 0) {
        r.burnerT -= delta;
        const k = Math.sin(Math.PI * Math.max(0, 1 - r.burnerT / 0.8));
        const h = currentHour();
        ud.envMat.emissiveIntensity = k * ((h >= 19 || h < 6) ? 0.42 : 0.15);
    } else ud.envMat.emissiveIntensity = 0;
    let tilt = 0;
    if (BALLOON.mode === 'launch') {
        const k = Math.min(1, r.t / 3.5);
        const e = k * k * (3 - 2 * k);
        BALLOON.y = THREE.MathUtils.lerp(balloonDockY, BALLOON_CRUISE[0], e);
        if (k >= 1) {
            BALLOON.mode = 'tour';
            r.route = makeBalloonRoute();
            r.u = 0;
            if (!r.isAI) maybeProactive(null, '주인과 열기구를 타고 두둥실 떠올랐다! 하늘 산책 시작!');
        }
    } else if (BALLOON.mode === 'tour') {
        if (!r.route) r.route = makeBalloonRoute();
        r.u += (r.route.speed * delta) / r.route.len;
        if (r.u >= 1) {   // 한 바퀴 — AI는 귀환, 주인은 새 경로로 무한 루프
            r.u = 0;
            r.lap += 1;
            if (r.isAI) BALLOON.mode = 'land';
            else {
                r.route = makeBalloonRoute();
                showToast(`🎈 ${r.lap}바퀴째 — 새 경로로 계속 두둥실 (Ctrl/⌘ = 하차)`);
            }
        }
        const pt = r.route.curve.getPointAt(r.u);
        const tan = r.route.curve.getTangentAt(r.u);
        BALLOON.x = pt.x; BALLOON.y = pt.y; BALLOON.z = pt.z;
        const targetH = Math.atan2(tan.x, tan.z);
        let diff = targetH - BALLOON.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = THREE.MathUtils.clamp(diff, -delta * 0.9, delta * 0.9);
        BALLOON.heading += turn;
        tilt = THREE.MathUtils.clamp(turn * 6, -0.05, 0.05);
        // 경유지 통과 — 선제대화(주인 라이드) + 빼꼼 happy
        for (const nm of r.route.names) {
            if (r.route.visited.has(nm.idx)) continue;
            const cp = r.route.curve.points[nm.idx];
            if (Math.hypot(BALLOON.x - cp.x, BALLOON.z - cp.z) < 2.4) {
                r.route.visited.add(nm.idx);
                if (!r.isAI) {
                    if (Math.random() < 0.45) maybeProactive(null, `열기구를 타고 ${nm.ko} 상공을 지나는 중이다!`);
                    const peek = r.friend || r.p;
                    if (peek && Math.random() < 0.4 && !peek.pet.action) peek.pet.action = { id: 'happy', t: 0 };
                }
            }
        }
    } else if (BALLOON.mode === 'land') {
        // 귀환: 수평으로 계류장까지 → 하강 → 폭신 착지
        const dx = BALLOON_HOME.x - BALLOON.x, dz = BALLOON_HOME.z - BALLOON.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.15) {
            const step = Math.min(d, 2.3 * delta);
            BALLOON.x += (dx / d) * step;
            BALLOON.z += (dz / d) * step;
            BALLOON.y = Math.max(BALLOON.y - 0.25 * delta, BALLOON_CRUISE[0] * Math.min(1, d / 6) + 0.9);
            const targetH = Math.atan2(dx, dz);
            let diff = targetH - BALLOON.heading;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            BALLOON.heading += THREE.MathUtils.clamp(diff, -delta, delta);
        } else {
            BALLOON.y -= delta * (0.55 + (BALLOON.y - balloonDockY) * 0.35);
            if (BALLOON.y <= balloonDockY) {
                BALLOON.y = balloonDockY;
                playStep('wood', 1.1);
                if (r.p || r.friend) logWorldEvent('열기구가 계류장에 사뿐히 내려앉았다 🎈');
                balloonDismount();
                return;
            }
        }
    }
    balloonCollider.x = BALLOON.x;
    balloonCollider.z = BALLOON.z;
    g.position.set(BALLOON.x, BALLOON.y, BALLOON.z);
    g.rotation.set(
        Math.sin(wxTime.value * 0.7) * 0.015 + tilt,
        BALLOON.heading,
        Math.sin(wxTime.value * 0.55 + 0.8) * 0.018 - tilt * 0.6
    );
    // ---- 탑승석: 둘이 나란히 서서 앞을 보며 각자 두리번 — 얼굴이 림 위로 빼꼼 (난간 관광객) ----
    const rgX = Math.cos(BALLOON.heading), rgZ = -Math.sin(BALLOON.heading);
    const seat = (q, side, face) => {
        q.mover.position.set(
            BALLOON.x + rgX * side,
            BALLOON.y + 0.24,
            BALLOON.z + rgZ * side,
        );
        q.mover.rotation.y = face;
        q.mover.rotation.x = 0;
        q.mover.rotation.z = tilt * 0.5;
        q.pet.walking = false;
        q.swimming = false;
    };
    if (r.p) seat(r.p, r.friend ? 0.19 : 0, BALLOON.heading + Math.sin(r.t * 0.55) * 0.55);
    if (r.friend) seat(r.friend, -0.19, BALLOON.heading + Math.sin(r.t * 0.47 + 1.7) * 0.5);
}

// ---- ⛴️ 페리 "통통호" (자동 운항 대중교통): 본섬 북 잔교 ⇄ 휴양지 모래섬 동 잔교 + 외해 경치
// 링. 열기구의 스플라인 문법 + "바다의 3가지 차이": ① 항로는 생성 직후 샘플링 검증(섬·다리·
// 정박 보트/비행기 회피, 실패 시 리롤→폴백 링) ② 다리 밑 통과 불가라 외곽 링만 ③ 잔교는
// 다리 문법(onBridge) 재사용으로 펫이 걸어 나간다. 정차: 모래섬에서 ~20초 닻 내림(승하차),
// 본섬 복귀 시 전원 하선. 새 섬 추가 시 ISLANDS를 읽는 검증이 자동 회피 — 데이터 주도. ----
function ferryBerth(i) {   // 잔교 곁 선석: B 끝 오른쪽 0.6 옆, 잔교와 나란한 헤딩
    const pr = FERRY_PIERS[i];
    const dx = pr.B.x - pr.A.x, dz = pr.B.z - pr.A.z;
    const L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;
    return { x: pr.B.x + uz * 0.6, z: pr.B.z - ux * 0.6, heading: Math.atan2(ux, uz) };
}
const FERRY_BERTHS = [ferryBerth(0), ferryBerth(1)];
const FERRY = {
    x: FERRY_BERTHS[0].x, z: FERRY_BERTHS[0].z, y: 0, heading: FERRY_BERTHS[0].heading,
    mode: 'docked',   // docked(본섬 대기) | sail | dwell(모래섬 정박) — 서비스 상태는 배에, 승객은 ferryRide에
    u: 0, route: null, dwellT: 0, easeT: 0, smokeAt: 0, wakeAt: 0,
};
function makeFerryRoute() {
    // 링 셔플: 0~3개 스킵 + 지터 ±1.1 + 방향 코인플립 → 샘플링 검증 (실패 시 리롤, 25회 후 폴백)
    for (let attempt = 0; attempt < 25; attempt++) {
        const ring = FERRY_SEA_POINTS.map((q) => ({ ...q }));
        const skips = attempt < 20 ? Math.floor(Math.random() * 4) : 0;   // 다양성은 스킵+지터로 (방향 플립은 정박을 루트 끝으로 밀어 제거)
        for (let k = 0; k < skips; k++) ring.splice(Math.floor(Math.random() * ring.length), 1);
        const jit = attempt < 20 ? 1.1 : 0;   // 마지막 5회는 무지터·무스킵 = 스윕이 보장한 원본 링 (사실상 항상 성공)
        const pts = [
            new THREE.Vector3(FERRY_BERTHS[0].x, 0, FERRY_BERTHS[0].z),
            new THREE.Vector3(FERRY_BERTHS[1].x, 0, FERRY_BERTHS[1].z),
            ...ring.map((q) => new THREE.Vector3(q.x + (Math.random() - 0.5) * 2 * jit, 0, q.z + (Math.random() - 0.5) * 2 * jit)),
        ];
        const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
        let ok = true;
        for (let i = 0; i < 160 && ok; i++) {
            const pt = curve.getPointAt(i / 160);
            if (Math.hypot(pt.x, pt.z) > 19.6) ok = false;
            for (const isl of ISLANDS) if (Math.hypot(pt.x - isl.x, pt.z - isl.z) < isl.r + 0.6) ok = false;
            for (const br of BRIDGES) {   // 다리 밑 통과 불가 — 차선 1.25 회피
                const bdx = br.B.x - br.A.x, bdz = br.B.z - br.A.z;
                const len2 = bdx * bdx + bdz * bdz;
                const tt = Math.max(0, Math.min(1, ((pt.x - br.A.x) * bdx + (pt.z - br.A.z) * bdz) / len2));
                if (Math.hypot(br.A.x + bdx * tt - pt.x, br.A.z + bdz * tt - pt.z) < 1.25) ok = false;
            }
            if (Math.hypot(pt.x - BOAT.x, pt.z - BOAT.z) < 1.4) ok = false;          // 정박 보트
            if (PLANE.mode === 'parked' && Math.hypot(pt.x - PLANE.x, pt.z - PLANE.z) < 1.7) ok = false;   // 주차 비행기
        }
        if (!ok) continue;
        // 모래섬 선석의 u (정차 지점) — 한 번만 샘플로 근사
        let stopU = 0.35, bd = Infinity;
        for (let i = 0; i < 400; i++) {
            const pt = curve.getPointAt(i / 400);
            const d = Math.hypot(pt.x - FERRY_BERTHS[1].x, pt.z - FERRY_BERTHS[1].z);
            if (d < bd) { bd = d; stopU = i / 400; }
        }
        const len = curve.getLength();
        return { curve, len, speed: THREE.MathUtils.clamp(len / 135, 0.8, 2.0), stopU, stopped: false };
    }
    return null;   // 이론상 폴백(무지터 링)이 20~24회에서 통과 — null이면 호출측이 운항 보류
}
function makeFerry() {
    // 고급 모터요트 리디자인: 화이트 선체 + 네이비 흘수선/틴티드 윈도우 밴드, 캐빈 위 플라이
    // 브리지, 레이더 아치, 선수 레일, 애프트 선덱(네이비 쿠션 벤치) — 흰색 위주 팔레트
    const g = new THREE.Group();
    const hullGeo = new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    hullGeo.scale(0.8, 0.76, 2.05);
    hullGeo.translate(0, 0.36, 0);
    const hull = new THREE.Mesh(bakeGrad(hullGeo, 0xfaf7f0, 0xdfe3e8, { curve: 1.4 }), gradMatDS);
    g.add(hull);
    const navy = [];
    const lineGeo = new THREE.CylinderGeometry(0.502, 0.502, 0.045, 20, 1, true);   // 흘수선 스트라이프
    lineGeo.scale(0.8, 1, 2.05);
    lineGeo.translate(0, 0.185, 0);
    navy.push(lineGeo);
    const white = [];
    const deckGeo = new THREE.CircleGeometry(0.46, 18).rotateX(-Math.PI / 2);   // 갑판 (화이트 몰딩)
    deckGeo.scale(0.79, 1, 2.0);
    deckGeo.translate(0, 0.365, 0);
    white.push(deckGeo);
    const rimGeo = new THREE.TorusGeometry(0.465, 0.022, 8, 22).rotateX(Math.PI / 2);
    rimGeo.scale(0.79, 1, 2.0);
    rimGeo.translate(0, 0.375, 0);
    white.push(rimGeo);
    // 캐빈(중앙 전방) + 틴티드 윈도우 밴드 + 플라이브리지 + 슬랜트 윈드실드
    const whiteR = [];   // RoundedBox는 속성 불일치로 별도 병합 (비행기 시트백 선례)
    const cabinGeo = new RoundedBoxGeometry(0.52, 0.3, 0.85, 2, 0.05);
    cabinGeo.translate(0, 0.53, 0.22);
    whiteR.push(cabinGeo);
    const winGeo = new THREE.BoxGeometry(0.53, 0.1, 0.78);
    winGeo.translate(0, 0.57, 0.24);
    navy.push(winGeo);
    const bridgeGeo = new RoundedBoxGeometry(0.4, 0.16, 0.5, 2, 0.04);
    bridgeGeo.translate(0, 0.76, 0.16);
    whiteR.push(bridgeGeo);
    const shieldGeo = new THREE.BoxGeometry(0.36, 0.1, 0.03);
    shieldGeo.rotateX(-0.5);
    shieldGeo.translate(0, 0.84, 0.42);
    navy.push(shieldGeo);
    // 레이더 아치 (뒤로 기운 흰 문) + 안테나 — 벤치 뒤 선미 쪽 (승객 머리 관통 방지, 사용자 스샷 피드백)
    for (const sx of [-1, 1]) {
        const legGeo = new THREE.CylinderGeometry(0.02, 0.024, 0.4, 6);
        legGeo.rotateX(0.3);
        legGeo.translate(sx * 0.26, 0.58, -0.72);
        white.push(legGeo);
    }
    const archGeo = new THREE.BoxGeometry(0.56, 0.05, 0.09);
    archGeo.translate(0, 0.8, -0.66);    // 기운 다리(rotX 0.3) 꼭대기 = (y0.77, z-0.66) — 그 위에 정확히 얹는다
    white.push(archGeo);
    const antGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5);
    antGeo.translate(0, 0.9, -0.66);
    white.push(antGeo);
    // 선수 레일 (짧은 포스트 4 + 상단 레일 아치)
    for (const [px, pz] of [[-0.18, 0.98], [0.18, 0.98], [-0.3, 0.7], [0.3, 0.7]]) {
        const postGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.12, 5);
        postGeo.translate(px, 0.43, pz);
        white.push(postGeo);
    }
    const railGeo = new THREE.TorusGeometry(0.31, 0.012, 6, 14, Math.PI).rotateX(Math.PI / 2);
    railGeo.scale(1, 1, 1.35);
    railGeo.translate(0, 0.49, 0.66);
    white.push(railGeo);
    // 애프트 선덱: 티크 바닥 + 네이비 쿠션 벤치 2
    const teakGeo = new THREE.BoxGeometry(0.56, 0.025, 0.62);
    teakGeo.translate(0, 0.375, -0.45);
    const teak = new THREE.Mesh(teakGeo, M(0xb08a60, { map: plankTex }));
    g.add(teak);
    const navyR = [];
    for (const bx of [-0.21, 0.21]) {
        const benchGeo = new RoundedBoxGeometry(0.14, 0.05, 0.68, 2, 0.02);
        benchGeo.translate(bx, 0.42, -0.42);
        navyR.push(benchGeo);
    }
    const flagGeo = new THREE.PlaneGeometry(0.13, 0.085);
    flagGeo.translate(0.065, 0.55, -0.99);
    navy.push(flagGeo);
    const poleGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.2, 5);
    poleGeo.translate(0, 0.47, -0.99);
    white.push(poleGeo);
    const whiteMat = M(0xf6f3ec);
    g.add(new THREE.Mesh(mergeGeometries(white, false), whiteMat));
    g.add(new THREE.Mesh(mergeGeometries(whiteR, false), whiteMat));
    const navyMat = M(0x2e4a68, { unique: true });
    navyMat.side = THREE.DoubleSide;
    g.add(new THREE.Mesh(mergeGeometries(navy, false), navyMat));
    g.add(new THREE.Mesh(mergeGeometries(navyR, false), navyMat));
    // 구명튜브 (흰 바탕 그대로 — 좌현 캐빈 옆)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 8, 14), M(0xe06a58));
    ring.position.set(-0.38, 0.47, 0.05);
    ring.rotation.y = Math.PI / 2;
    g.add(ring);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
}
const ferryGroup = makeFerry();
stage.add(ferryGroup);
const ferryCollider = { type: 'ferry', layoutId: 'ferry-1', x: FERRY.x, z: FERRY.z, rotY: 0, r: 0.9, def: { x: FERRY.x, z: FERRY.z, rotY: 0 } };
PROPS.push(ferryCollider);
ferryCollider.obj = ferryGroup;
{   // 잔교 2곳: 플랭크 데크 + 말뚝 + 계류 기둥 + 종 — 정적이라 월드 베이크 편입
    for (const pr of FERRY_PIERS) {
        const st = new THREE.Group();
        const dx = pr.B.x - pr.A.x, dz = pr.B.z - pr.A.z;
        const L = Math.hypot(dx, dz);
        const ux = dx / L, uz = dz / L;
        const heading = Math.atan2(dx, dz);
        const N = Math.max(6, Math.round(L / 0.22));
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            const plk = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, (L / N) * 0.85), M(0xb08a60, { map: plankTex }));
            plk.position.set(pr.A.x + dx * t, 0.12, pr.A.z + dz * t);
            plk.rotation.y = heading;
            st.add(plk);
        }
        for (const t of [0.15, 0.5, 0.9]) {
            for (const side of [-1, 1]) {
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.62, 7), M(0x8a6647, { map: woodTex }));
                post.position.set(pr.A.x + dx * t + uz * side * 0.27, -0.12, pr.A.z + dz * t - ux * side * 0.27);
                st.add(post);
            }
        }
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.3, 8), M(0x6f5238));
        bollard.position.set(pr.B.x + uz * 0.24, 0.26, pr.B.z - ux * 0.24);
        st.add(bollard);
        const bellPost = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.5, 6), M(0x8a6647, { map: woodTex }));
        bellPost.position.set(pr.B.x - uz * 0.24, 0.36, pr.B.z + ux * 0.24);
        st.add(bellPost);
        const bell = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.07, 10), M(0xe8b04b));
        bell.position.set(pr.B.x - uz * 0.24, 0.63, pr.B.z + ux * 0.24);
        st.add(bell);
        st.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        stage.add(st);
        WORLD_STATIC_ROOTS.push(st);
    }
}
let ferryRide = null;    // { p, friend, isAI, t } — 승객 (서비스 상태는 FERRY에)
let aiFerryWalk = null;  // AI가 잔교로 걸어가는 중 { p, ownArrive }
let ferryHop = null;     // 절친 승선 아크
function ferryHorn() {   // 붕— (저음 2화음)
    if (audioCtx.state !== 'running') return;
    for (const [f, t0] of [[164, 0], [123, 0.05]]) {
        const o = audioCtx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        const gn = audioCtx.createGain();
        const at = audioCtx.currentTime + t0;
        gn.gain.setValueAtTime(0.0001, at);
        gn.gain.exponentialRampToValueAtTime(0.055 * attAtPoint(FERRY.x, FERRY.z), at + 0.08);
        gn.gain.exponentialRampToValueAtTime(0.0001, at + 0.85);
        const fl = audioCtx.createBiquadFilter();
        fl.type = 'lowpass';
        fl.frequency.value = 500;
        o.connect(fl); fl.connect(gn); gn.connect(sfxMaster);
        o.start(at); o.stop(at + 0.9);
    }
}
function ferryBell() {   // 딸랑딸랑 (정박)
    if (audioCtx.state !== 'running') return;
    for (const t0 of [0, 0.28]) {
        const o = audioCtx.createOscillator();
        o.type = 'sine';
        o.frequency.value = 1240;
        const gn = audioCtx.createGain();
        const at = audioCtx.currentTime + t0;
        gn.gain.setValueAtTime(0.0001, at);
        gn.gain.exponentialRampToValueAtTime(0.09 * attAtPoint(FERRY.x, FERRY.z), at + 0.015);
        gn.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
        o.connect(gn); gn.connect(sfxMaster);
        o.start(at); o.stop(at + 0.55);
    }
}
function ferryDeckY() { return FERRY.y + 0.36; }
function enterFerry(rider, isAI = false) {
    if (!rider) return;
    if (FERRY.mode !== 'docked' && FERRY.mode !== 'dwell') return;
    if (ferryRide && (ferryRide.p === rider || ferryRide.friend === rider)) return;
    if (!ferryRide) {
        let friend = null;
        if (!isAI) {
            const q = pets.find((o) => o !== rider);
            if (q && !q.bed && !q.dip && !q.pet.sleeping
                && Math.hypot(q.mover.position.x - FERRY.x, q.mover.position.z - FERRY.z) < 2.1
                && (q.ai.state === 'idle' || q.ai.state === 'walk' || (handHold && handHold.partner === q))) {
                if (handHold) handHold = null;
                if (aiFishing && aiFishing.p === q) endAiFishing();
                releaseAI(q);
                q.ai.state = 'held';
                friend = q;
            }
        }
        ferryRide = { p: rider, friend, isAI, t: 0 };
    } else if (!ferryRide.friend && ferryRide.p !== rider) {
        ferryRide.friend = rider;   // 정박 중 합류 (모래섬에서 태우기)
    }
    rider.swimming = false;
    if (!isAI) running = false;
    if (FERRY.mode === 'docked') {   // 본섬 출항
        const route = makeFerryRoute();
        if (!route) { showToast('⛴️ 물길이 막혀 있어요 — 잠시 후 다시'); ferryRide = null; return; }
        FERRY.route = route;
        FERRY.u = 0;
        FERRY.mode = 'sail';
        FERRY.easeT = 0;
        ferryHorn();
        logWorldEvent(`${petKo(rider)}가 통통호에 올랐다 — 붕— 출항!${ferryRide.friend ? ' (절친도 함께)' : ''} ⛴️`);
        if (!isAI) showToast('⛴️ 붕— 출항! 모래섬 잔교에 정박해요 (정박 중 ⌘ = 하차 · 항해 중 ⌘ = 퐁당)');
    } else logWorldEvent(`${petKo(rider)}가 모래섬 잔교에서 통통호에 올라탔다 ⛴️`);
}
function ferryDisembarkAt(pierIdx) {   // 잔교 데크로 하차
    const r = ferryRide;
    if (!r) return;
    const pr = FERRY_PIERS[pierIdx];
    const dx = pr.B.x - pr.A.x, dz = pr.B.z - pr.A.z;
    const L = Math.hypot(dx, dz);
    const out = (q, back) => {
        if (!q) return;
        const t = 1 - (0.35 + back * 0.28) / L;
        q.mover.position.set(pr.A.x + dx * t, 0.12, pr.A.z + dz * t);
        q.mover.rotation.x = 0;
        q.mover.rotation.z = 0;
        q.swimming = false;
        if (q.ai.state === 'held') releaseAI(q);
    };
    out(r.p, 0);
    out(r.friend, 1);
    if (r.isAI && r.p) releaseAI(r.p, 2);
    ferryRide = null;
}
function requestFerryExit() {
    const r = ferryRide;
    if (!r) return;
    if (FERRY.mode === 'docked') { ferryDisembarkAt(0); return; }
    if (FERRY.mode === 'dwell') { ferryDisembarkAt(1); showToast('⛴️ 모래섬 도착 — 즐거운 휴양!'); return; }
    // 항해 중 — 바다로 퐁당 (배는 노선을 계속 돈다)
    for (const [q, side] of [[r.p, -1], [r.friend, 1]]) {
        if (!q) continue;
        const dx = FERRY.x + Math.cos(FERRY.heading) * side * 0.8, dz = FERRY.z - Math.sin(FERRY.heading) * side * 0.8;
        q.mover.position.set(dx, waveYAt(dx, dz) + 0.02 - q.height * 0.45, dz);
        q.swimming = 'sea';
        q.mover.rotation.x = 0;
        q.mover.rotation.z = 0;
        if (q.ai.state === 'held') releaseAI(q);
        spawnSplash(dx, waveYAt(dx, dz) + q.height * 0.42, dz);
    }
    playSplashSound(FERRY.x, FERRY.z);
    ferryRide = null;
    showToast('⛴️ 첨벙! 통통호는 노선을 마저 돌아요');
    logWorldEvent('통통호에서 바다로 풍덩 — 배는 무심히 항해를 계속한다');
}
function exitFerryForce() {   // Esc — 본섬 잔교 데크로, 배는 빈 채로 노선 완주
    const r = ferryRide;
    if (!r) return;
    ferryDisembarkAt(0);
}
function startAiFerry(p) {
    if (ferryRide || aiFerryWalk || FERRY.mode !== 'docked') return;
    if (p === possessed || p.bed || p.dip || p.pet.sleeping) return;
    releaseAI(p);
    p.ai.state = 'goto';
    const pr = FERRY_PIERS[0];
    const tx = pr.A.x - 0.4, tz = pr.A.z - 0.5;
    p.ai.target = { x: tx, z: tz };
    p.ai.waypoints = buildRoute(p.mover.position, { x: tx, z: tz });
    p.ai.stall = 0;
    const walk = { p };
    walk.ownArrive = () => {
        if (aiFerryWalk !== walk) return;
        aiFerryWalk = null;
        if (ferryRide || FERRY.mode !== 'docked' || p === possessed || p.bed || p.dip) { releaseAI(p); return; }
        enterFerry(p, true);   // ai.state 'busy' 유지
    };
    p.ai.onArrive = walk.ownArrive;
    aiFerryWalk = walk;
    logWorldEvent(`${petKo(p)}가 통통호를 타러 잔교로 나섰다 ⛴️`);
}
const ferryMenu = document.createElement('div');
ferryMenu.style.cssText = 'position:fixed; display:none; z-index:130; background:rgba(30,32,40,0.94); border-radius:10px; padding:6px; box-shadow:0 6px 18px rgba(0,0,0,0.35);';
const ferryMenuBtn = document.createElement('button');
ferryMenuBtn.textContent = '👥 친구 태우기';
ferryMenuBtn.style.cssText = 'display:block; background:none; border:none; color:#fff; font-size:13px; padding:7px 12px; border-radius:7px; cursor:pointer; font-family:sans-serif;';
ferryMenuBtn.onmouseenter = () => { ferryMenuBtn.style.background = 'rgba(255,255,255,0.14)'; };
ferryMenuBtn.onmouseleave = () => { ferryMenuBtn.style.background = 'none'; };
ferryMenuBtn.onclick = () => { ferryMenu.style.display = 'none'; summonFerryFriend(); };
ferryMenu.appendChild(ferryMenuBtn);
document.body.appendChild(ferryMenu);
function showFerryMenu(x, y) {
    ferryMenu.style.left = `${Math.min(x, window.innerWidth - 150)}px`;
    ferryMenu.style.top = `${Math.min(y, window.innerHeight - 60)}px`;
    ferryMenu.style.display = 'block';
}
function summonFerryFriend() {
    const r = ferryRide;
    if (!r || r.friend || r.isAI || ferryHop) return;
    if (FERRY.mode === 'sail' && r.t > 15) { showToast('⛴️ 이미 먼바다예요 — 정박 중에 태워요'); return; }
    const friend = pets.find((q) => q !== r.p);
    if (!friend) { showToast('👥 부를 친구가 없어요'); return; }
    friend.pet.sleeping = false;
    friend.pet.autoSleeping = false;
    if (friend.bed) forceEndBed(friend);
    if (friend.dip) endDip(friend);
    if (aiFishing && aiFishing.p === friend) endAiFishing();
    releaseAI(friend);
    friend.ai.state = 'held';
    friend.swimming = false;
    const pr = FERRY_PIERS[FERRY.mode === 'dwell' ? 1 : 0];
    friend.mover.position.set(pr.B.x, 0.12, pr.B.z);
    friend.mover.rotation.x = 0;
    friend.mover.rotation.z = 0;
    ferryHop = { q: friend, fx: pr.B.x, fy: 0.12, fz: pr.B.z, t: 0 };
    showToast('👥 절친이 포르르 나타나 갑판으로 폴짝!');
    logWorldEvent(`${petKo(friend)}가 통통호 갑판에 폴짝 올라탔다`);
}
function updateFerryHop(delta) {
    if (!ferryHop) return;
    ferryHop.t += delta;
    const k = Math.min(1, ferryHop.t / 0.7);
    const e = k * k * (3 - 2 * k);
    const q = ferryHop.q;
    const rgX = Math.cos(FERRY.heading), rgZ = -Math.sin(FERRY.heading);
    const tx = FERRY.x - rgX * 0.21, ty = ferryDeckY() + 0.04, tz = FERRY.z + rgZ * 0.21;
    q.mover.position.set(
        THREE.MathUtils.lerp(ferryHop.fx, tx, e),
        THREE.MathUtils.lerp(ferryHop.fy, ty, e) + Math.sin(k * Math.PI) * 0.55,
        THREE.MathUtils.lerp(ferryHop.fz, tz, e)
    );
    q.mover.rotation.y = FERRY.heading;
    q.pet.walking = false;
    if (k >= 1) {
        ferryHop = null;
        if (ferryRide && !ferryRide.friend) ferryRide.friend = q;
        else { q.swimming = false; releaseAI(q); snapToLand(q); }
    }
}
function updateFerry(delta) {
    const g = ferryGroup;
    // AI 도보 소유권
    if (aiFerryWalk && (aiFerryWalk.p.ai.onArrive !== aiFerryWalk.ownArrive || aiFerryWalk.p.ai.state !== 'goto')) aiFerryWalk = null;
    const r = ferryRide;
    if (r) {
        r.t += delta;
        if (r.isAI && r.p) {
            if (r.p === possessed) r.isAI = false;   // 하이재킹 = 동승 전환
            else if (r.p.ai.state !== 'busy') { r.p = r.friend; r.friend = null; if (!r.p) ferryRide = null; }
        }
    }
    if (FERRY.mode === 'docked' || FERRY.mode === 'dwell') {
        const b = FERRY_BERTHS[FERRY.mode === 'docked' ? 0 : 1];
        FERRY.easeT = Math.min(1, FERRY.easeT + delta / 1.2);
        const e = FERRY.easeT * FERRY.easeT * (3 - 2 * FERRY.easeT);
        FERRY.x = THREE.MathUtils.lerp(FERRY.x, b.x, e);
        FERRY.z = THREE.MathUtils.lerp(FERRY.z, b.z, e);
        let dh = b.heading - FERRY.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        FERRY.heading += dh * Math.min(1, delta * 3);
        if (FERRY.mode === 'dwell') {
            FERRY.dwellT -= delta;
            if (FERRY.dwellT <= 0) {   // 출항 재개
                FERRY.mode = 'sail';
                FERRY.easeT = 0;
                ferryHorn();
                if (r && !r.isAI) showToast('⛴️ 붕— 본섬으로 돌아갑니다');
            }
        }
    } else if (FERRY.mode === 'sail') {
        const rt = FERRY.route;
        FERRY.u += (rt.speed * delta) / rt.len;
        if (!rt.stopped && FERRY.u >= rt.stopU) {   // 모래섬 정박
            rt.stopped = true;
            FERRY.mode = 'dwell';
            FERRY.dwellT = 20;
            FERRY.easeT = 0;
            ferryBell();
            spawnSplash(FERRY.x + Math.sin(FERRY.heading) * 0.8, waveYAt(FERRY.x, FERRY.z) + 0.05, FERRY.z + Math.cos(FERRY.heading) * 0.8);
            if (r && !r.isAI) showToast('⛴️ 딸랑딸랑 — 모래섬 잔교 정박 (20초, ⌘ = 하차)');
            logWorldEvent('통통호가 모래섬 잔교에 닻을 내렸다 ⚓');
        } else if (FERRY.u >= 1) {   // 본섬 복귀 — 종점, 전원 하선
            FERRY.u = 0;
            FERRY.mode = 'docked';
            FERRY.easeT = 0;
            FERRY.route = null;
            ferryBell();
            if (r) {
                if (!r.isAI) showToast('⛴️ 본섬 잔교 도착 — 수고하셨습니다!');
                logWorldEvent('통통호가 본섬 잔교로 돌아왔다 — 전원 하선 ⛴️');
                ferryDisembarkAt(0);
            }
        } else {
            const pt = rt.curve.getPointAt(FERRY.u);
            const tan = rt.curve.getTangentAt(FERRY.u);
            FERRY.x = pt.x;
            FERRY.z = pt.z;
            const targetH = Math.atan2(tan.x, tan.z);
            let dh = targetH - FERRY.heading;
            while (dh > Math.PI) dh -= Math.PI * 2;
            while (dh < -Math.PI) dh += Math.PI * 2;
            FERRY.heading += THREE.MathUtils.clamp(dh, -delta * 1.1, delta * 1.1);
            // 항적 + 굴뚝 연기 (스로틀)
            FERRY.wakeAt -= delta;
            if (FERRY.wakeAt <= 0) {
                FERRY.wakeAt = 0.38;
                const sx = FERRY.x - Math.sin(FERRY.heading) * 0.95, sz = FERRY.z - Math.cos(FERRY.heading) * 0.95;
                spawnSplash(sx, waveYAt(sx, sz) + 0.03, sz);
            }
        }
    }
    // 파도 타기: 선수/선미/좌우 4점 샘플 → 피치·롤
    const fwdX = Math.sin(FERRY.heading), fwdZ = Math.cos(FERRY.heading);
    const rgX = Math.cos(FERRY.heading), rgZ = -Math.sin(FERRY.heading);
    const bowY = waveYAt(FERRY.x + fwdX * 0.8, FERRY.z + fwdZ * 0.8);
    const sternY = waveYAt(FERRY.x - fwdX * 0.8, FERRY.z - fwdZ * 0.8);
    const portY = waveYAt(FERRY.x - rgX * 0.4, FERRY.z - rgZ * 0.4);
    const starY = waveYAt(FERRY.x + rgX * 0.4, FERRY.z + rgZ * 0.4);
    FERRY.y = (bowY + sternY) / 2 + 0.03;
    g.position.set(FERRY.x, FERRY.y, FERRY.z);
    g.rotation.set((sternY - bowY) * 0.5, FERRY.heading, (portY - starY) * 0.55);
    ferryCollider.x = FERRY.x;
    ferryCollider.z = FERRY.z;
    // 승객: 벤치에 앉아 두리번 (다리 접기는 updateFerryPose — 엔티티 뒤)
    if (r) {
        const seat = (q, side, phase) => {
            q.mover.position.set(
                FERRY.x + rgX * side - fwdX * 0.42,   // 애프트 선덱 벤치
                ferryDeckY() + 0.12 - 0.06,
                FERRY.z + rgZ * side - fwdZ * 0.42
            );
            q.mover.rotation.y = FERRY.heading + Math.sin((r.t + phase) * 0.5) * 0.5;
            q.mover.rotation.x = 0;
            q.mover.rotation.z = 0;
            q.pet.walking = false;
            q.swimming = false;
        };
        if (r.p) seat(r.p, 0.21, 0);
        if (r.friend) seat(r.friend, -0.21, 1.9);
    }
}
function updateFerryPose() {   // 벤치 앉기 — 다리 앞접기 (엔티티 리셋 뒤 덮어쓰기, 앉기 문법)
    if (!ferryRide) return;
    for (const q of [ferryRide.p, ferryRide.friend]) {
        if (!q) continue;
        for (const f of q.pet.feet) f.rotation.x = -1.35;
    }
}

// ---- 🐚 조개줍기: 휴양지 모래섬 마른 모래에 조개가 드물게 씻겨온다 — 동시 최대 3개,
// 스폰 롤 2~4분(65%)이라 평균 1~2개. 조종 펫이 곁에서 ⌘ = 줍기(둥실 떠오르며 반짝).
// 진주조개는 레어(가중 8) — 팡파르 + 선제대화. 컬렉션은 localStorage 'world-shells'. ----
const SHELL_TYPES = [
    { id: 'scallop', ko: '가리비',   w: 40, col: 0xf2d8b8 },
    { id: 'conch',   ko: '소라',     w: 30, col: 0xe8b090 },
    { id: 'clam',    ko: '분홍조개', w: 22, col: 0xf0c2cc },
    { id: 'pearl',   ko: '진주조개', w: 8,  col: 0xfaf4e8, rare: true },
];
let shells = [];        // { t, x, z, mesh }
let shellFly = [];      // 줍기 연출 (둥실 + 축소)
let shellNextAt = 50;   // 첫 시도 50초 후
let shellGlintAt = 7;
function shellCounts() {
    try { return JSON.parse(localStorage.getItem('world-shells') || '{}'); } catch (e) { return {}; }
}
function makeShellMesh(t) {
    const g = new THREE.Group();
    if (t.id === 'conch') {   // 소라: 통통한 몸 + 뾰족 나선 팁
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.045, 9, 7), M(t.col));
        body.scale.set(1, 0.75, 0.8);
        body.position.y = 0.032;
        g.add(body);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 8), M(0xc89070));
        tip.rotation.z = -1.25;
        tip.position.set(0.055, 0.035, 0);
        g.add(tip);
    } else if (t.id === 'pearl') {   // 진주조개: 벌어진 두 껍데기 + 진주알
        for (const [ry, py] of [[0, 0.012], [-2.5, 0.05]]) {
            const half = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(t.col));
            half.scale.set(1, 0.42, 0.9);
            half.rotation.x = ry;
            half.position.y = py;
            g.add(half);
        }
        const bead = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), M(0xffffff));
        bead.position.y = 0.032;
        g.add(bead);
    } else {   // 가리비/분홍조개: 눌린 부채 껍데기 (기울여 모래에 반쯤 얹힌 느낌)
        const shell = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 7), M(t.col));
        shell.scale.set(1, 0.3, 0.88);
        shell.position.y = 0.02;
        shell.rotation.z = 0.25;
        g.add(shell);
        const hinge = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), M(0xc89070));
        hinge.position.set(-0.045, 0.018, 0);
        g.add(hinge);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
}
function trySpawnShell(force = false) {
    if (shells.length >= 3) return false;
    if (!force && Math.random() > 0.65) return false;   // 빈손 롤 — 희귀감
    const SAND = ISLANDS[4];
    for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 0.9 + Math.random() * 1.05;   // 마른 모래 링 (물가선 ~2.05 안쪽)
        const x = SAND.x + Math.sin(a) * d, z = SAND.z + Math.cos(a) * d;
        if (terrainHeight(x, z) < -0.3) continue;                                    // 젖은 모래 제외
        if (Math.hypot(x - PLANE.x, z - PLANE.z) < 1.3) continue;                    // 주차 비행기
        if (shells.some((sh) => Math.hypot(x - sh.x, z - sh.z) < 0.7)) continue;
        let clear = true;
        for (const q of PROPS) {
            if (q.r > 0 && Math.hypot(x - q.x, z - q.z) < q.r + 0.35) { clear = false; break; }
        }
        if (!clear) continue;
        const roll = Math.random() * SHELL_TYPES.reduce((sum, t) => sum + t.w, 0);
        let acc = 0, type = SHELL_TYPES[0];
        for (const t of SHELL_TYPES) { acc += t.w; if (roll < acc) { type = t; break; } }
        const mesh = makeShellMesh(type);
        mesh.position.set(x, terrainHeight(x, z) + 0.005, z);
        mesh.rotation.y = Math.random() * Math.PI * 2;
        stage.add(mesh);
        shells.push({ t: type, x, z, mesh });
        return true;
    }
    return false;
}
function nearestShell(maxD) {
    if (!possessed) return null;
    let best = null, bd = maxD;
    for (const sh of shells) {
        const d = Math.hypot(sh.x - possessed.mover.position.x, sh.z - possessed.mover.position.z);
        if (d < bd) { bd = d; best = sh; }
    }
    return best;
}
function pickShell(sh) {
    shells.splice(shells.indexOf(sh), 1);
    shellFly.push({ mesh: sh.mesh, t: 0, x: sh.x, z: sh.z });
    const counts = shellCounts();
    counts[sh.t.id] = (counts[sh.t.id] || 0) + 1;
    try { localStorage.setItem('world-shells', JSON.stringify(counts)); } catch (e) {}
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const spr = glowSprite(sh.t.rare ? 0xfff1cf : 0x9be7ff, 0.14, 0.9);
    spr.position.set(sh.x, sh.mesh.position.y + 0.25, sh.z);
    scene.add(spr);
    hugBurst.push({ spr, vx: 0, vy: 0.4, vz: 0, t: 0.45 });
    if (sh.t.rare) {
        fishFanfare();
        showToast(`🐚✨ 진주조개다!! (컬렉션 ${total}개째)`);
        maybeProactive(null, '주인이 모래섬에서 진주조개를 주웠다! 반짝반짝하다!');
    } else {
        playBuffer(swishBuf, { vol: 0.3, rate: 1.7, filterFreq: 1600 });
        showToast(`🐚 ${sh.t.ko} 주웠다! (컬렉션 ${total}개째)`);
    }
    logWorldEvent(`모래섬에서 ${sh.t.ko}를 주웠다 🐚 (총 ${total}개)`);
}
function updateShells(delta) {
    shellNextAt -= delta;
    if (shellNextAt <= 0) {
        shellNextAt = 100 + Math.random() * 140;   // 다음 롤 2~4분
        trySpawnShell();
    }
    shellGlintAt -= delta;   // 은은한 발견 힌트 — 7초마다 아무 조개 하나 반짝
    if (shellGlintAt <= 0) {
        shellGlintAt = 7;
        if (shells.length) {
            const sh = shells[Math.floor(Math.random() * shells.length)];
            const spr = glowSprite(0xfff6dc, 0.07, 0.7);
            spr.position.set(sh.x, sh.mesh.position.y + 0.09, sh.z);
            scene.add(spr);
            hugBurst.push({ spr, vx: 0, vy: 0.12, vz: 0, t: 0.35 });
        }
    }
    for (let i = shellFly.length - 1; i >= 0; i--) {   // 줍기 연출: 둥실 + 축소 → 제거
        const f = shellFly[i];
        f.t += delta;
        const k = Math.min(1, f.t / 0.6);
        f.mesh.position.y += delta * 0.7;
        f.mesh.rotation.y += delta * 6;
        f.mesh.scale.setScalar(1 - k * 0.9);
        if (k >= 1) { stage.remove(f.mesh); shellFly.splice(i, 1); }
    }
}

// ---- 🎣 낚시 (동숲식 — 어떤 물가든): 독 🎣로 낚싯대를 들고, 물을 클릭해 캐스팅, 입질 타이밍에
// ⌘/클릭으로 챔질. 모든 동작은 이 파일의 전용 안무(아래 updateFishing) — 캔 모션 재활용 없음.
// 어종은 절차 생성(외부 에셋 0), 도감은 localStorage 'world-fishdex'. ----
// when: { night, rain, season } — 조건 어종은 그 조건에서만 풀에 들어온다 (동숲 문법). hint = 도감 힌트.
const FISH_SPECIES = [
    { id: 'crucian',  ko: '붕어',    water: 'pond', rarity: 1, len: [12, 24], body: 'oval',  back: 0x8fa06b, belly: 0xe2dcc0 },
    { id: 'goldfish', ko: '금붕어',  water: 'pond', rarity: 2, len: [6, 14],  body: 'oval',  back: 0xf0863c, belly: 0xffd9a8 },
    { id: 'koi',      ko: '잉어',    water: 'pond', rarity: 3, len: [30, 62], body: 'oval',  back: 0xe8e2d6, belly: 0xf2a48e },
    { id: 'frog',     ko: '개구리',  water: 'pond', rarity: 1, len: [7, 12],  body: 'frog',  back: 0x6fae4e, belly: 0xd8ecb0, when: { rain: true },  hint: '비 오는 연못' },
    { id: 'catfish',  ko: '메기',    water: 'pond', rarity: 2, len: [35, 70], body: 'sleek', back: 0x5a5f52, belly: 0xc9c2a8, whiskers: true, when: { night: true }, hint: '밤의 연못' },
    { id: 'smelt',    ko: '빙어',    water: 'pond', rarity: 2, len: [8, 14],  body: 'sleek', back: 0xaFC4d8, belly: 0xf0f6fa, when: { season: 'winter' }, hint: '겨울 연못' },
    { id: 'mackerel', ko: '고등어',  water: 'sea',  rarity: 1, len: [22, 38], body: 'sleek', back: 0x4f7fb5, belly: 0xdfe8ee },
    { id: 'puffer',   ko: '복어',    water: 'sea',  rarity: 2, len: [14, 26], body: 'round', back: 0xc9b26a, belly: 0xf5ecd2 },
    { id: 'ray',      ko: '가오리',  water: 'sea',  rarity: 3, len: [40, 85], body: 'flat',  back: 0x7a6f8e, belly: 0xd9d2e2 },
    { id: 'salmon',   ko: '연어',    water: 'sea',  rarity: 2, len: [45, 80], body: 'sleek', back: 0xd88a7a, belly: 0xf5d8c8, when: { rain: true },  hint: '비 오는 바다' },
    { id: 'angler',   ko: '아귀',    water: 'sea',  rarity: 3, len: [30, 55], body: 'round', lure: true, back: 0x4a4258, belly: 0x9a8fa8, when: { night: true }, hint: '깊은 밤바다' },
    { id: 'boot',     ko: '헌 장화', water: 'any',  rarity: 0, len: [26, 26], body: 'boot',  back: 0x8a6647, belly: 0x6f5234 },
    { id: 'bottle',   ko: '유리병',  water: 'any',  rarity: 0, len: [18, 18], body: 'bottle', back: 0xa8d8cf, belly: 0xd8f0ea },
];
// 지금 이 물에서 낚일 수 있는 풀 — 밤(19~06시)·비(wxF)·계절 조건을 실제 월드 상태로 판정
function fishConditionActive(sp) {
    if (!sp.when) return true;
    const h = currentHour();
    if (sp.when.night && !(h >= 19 || h < 6)) return false;
    if (sp.when.rain && wxF < 0.3) return false;
    if (sp.when.season && season !== sp.when.season) return false;
    return true;
}
function speciesPool(water) {
    return FISH_SPECIES.filter((s) => s.water === water && s.rarity > 0 && fishConditionActive(s));
}
function makeFishMesh(sp, sizeK) {
    const g = new THREE.Group();
    if (sp.body === 'boot') {
        const shaft = new THREE.Mesh(bakeGrad(new RoundedBoxGeometry(0.07, 0.13, 0.09, 2, 0.02), sp.back, sp.belly), gradMat);
        shaft.position.y = 0.05;
        g.add(shaft);
        const toe = new THREE.Mesh(bakeGrad(new RoundedBoxGeometry(0.07, 0.05, 0.09, 2, 0.02), sp.back, sp.belly), gradMat);
        toe.position.set(0, 0.005, 0.07);
        g.add(toe);
    } else if (sp.body === 'bottle') {
        const body = new THREE.Mesh(bakeGrad(new THREE.CylinderGeometry(0.035, 0.04, 0.14, 10), sp.back, sp.belly), gradMatDS);
        body.position.y = 0.07;
        g.add(body);
        const neck = new THREE.Mesh(bakeGrad(new THREE.CylinderGeometry(0.016, 0.022, 0.05, 8), sp.back, sp.belly), gradMatDS);
        neck.position.y = 0.16;
        g.add(neck);
        const cork = new THREE.Mesh(bakeGrad(new THREE.CylinderGeometry(0.017, 0.017, 0.022, 8), 0xc9a06a, 0x9a7448), gradMat);
        cork.position.y = 0.19;
        g.add(cork);
        const note = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 6), M(0xfdf3df));   // 돌돌 말린 편지
        note.position.y = 0.08;
        note.rotation.z = 0.18;
        g.add(note);
    } else if (sp.body === 'flat') {   // 가오리 — 납작 다이아 + 꼬리
        const disc = new THREE.Mesh(bakeGrad(new THREE.SphereGeometry(0.09, 10, 8), sp.back, sp.belly), gradMat);
        disc.scale.set(1.5, 0.28, 1.1);
        g.add(disc);
        for (const s of [-1, 1]) {   // 날개 끝 살짝 들림
            const tipW = new THREE.Mesh(bakeGrad(new THREE.ConeGeometry(0.035, 0.09, 6), sp.back, sp.belly), gradMat);
            tipW.rotation.z = s * 1.35;
            tipW.position.set(s * 0.15, 0.01, 0);
            g.add(tipW);
        }
        const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.011, 0.16, 6), gradMat);
        bakeGrad(tail.geometry, sp.back, sp.back);
        tail.rotation.x = Math.PI / 2 + 0.25;
        tail.position.set(0, 0.01, -0.15);
        g.add(tail);
    } else if (sp.body === 'frog') {   // 개구리 — 둥근 몸 + 눈두덩 + 뒷다리 스텁
        const body = new THREE.Mesh(bakeGrad(new THREE.SphereGeometry(0.07, 12, 9), sp.back, sp.belly), gradMat);
        body.scale.set(1.1, 0.8, 1.2);
        g.add(body);
        for (const s of [-1, 1]) {
            const eyeBump = new THREE.Mesh(bakeGrad(new THREE.SphereGeometry(0.024, 8, 6), sp.back, sp.back), gradMat);
            eyeBump.position.set(s * 0.035, 0.055, 0.05);
            g.add(eyeBump);
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), M(0x2b2b33));
            eye.position.set(s * 0.035, 0.065, 0.062);
            g.add(eye);
            const leg = new THREE.Mesh(bakeGrad(new THREE.SphereGeometry(0.03, 8, 6), sp.back, sp.belly), gradMat);
            leg.scale.set(0.8, 0.5, 1.4);
            leg.position.set(s * 0.07, -0.03, -0.05);
            g.add(leg);
        }
    } else {   // oval/sleek/round — lathe 몸통 + 꼬리·등지느러미 + 눈
        const prof = [];
        const L = sp.body === 'sleek' ? 0.24 : sp.body === 'round' ? 0.15 : 0.19;   // 반길이
        const W = sp.body === 'sleek' ? 0.05 : sp.body === 'round' ? 0.085 : 0.062; // 최대 반폭
        for (let i = 0; i <= 7; i++) {
            const t = i / 7;
            prof.push(new THREE.Vector2(Math.max(0.001, Math.sin(t * Math.PI) ** (sp.body === 'round' ? 0.75 : 1.15) * W), (t - 0.5) * 2 * L));
        }
        const bodyGeo = new THREE.LatheGeometry(prof, 12);
        bodyGeo.rotateX(Math.PI / 2);   // 머리 +z
        const body = new THREE.Mesh(bakeGrad(bodyGeo, sp.back, sp.belly), gradMat);
        body.scale.y = 0.82;            // 살짝 눌린 물고기 단면
        g.add(body);
        const tailGeo = new THREE.ConeGeometry(0.05, 0.09, 3);
        tailGeo.rotateX(-Math.PI / 2);
        tailGeo.scale(0.4, 1, 1);
        const tail = new THREE.Mesh(bakeGrad(tailGeo, sp.back, sp.back), gradMat);
        tail.position.set(0, 0, -L - 0.035);
        g.add(tail);
        const fin = new THREE.Mesh(bakeGrad(new THREE.ConeGeometry(0.04, 0.055, 3).scale(0.35, 1, 1), sp.back, sp.back), gradMat);
        fin.position.set(0, W * 0.82 + 0.015, 0.02);
        g.add(fin);
        if (sp.body === 'round' && !sp.lure) {   // 복어 가시
            for (let i = 0; i < 9; i++) {
                const a = (i / 9) * Math.PI * 2;
                const spike = new THREE.Mesh(bakeGrad(new THREE.ConeGeometry(0.012, 0.035, 5), sp.belly, sp.back), gradMat);
                spike.position.set(Math.cos(a) * W * 0.8, Math.sin(a) * W * 0.66, -0.01);
                spike.rotation.z = -a - Math.PI / 2;
                g.add(spike);
            }
        }
        if (sp.lure) {   // 아귀 초롱 — 밤바다 어종답게 은은히 빛난다 (lampGlobeMat: 밤에 발광)
            const stalk = new THREE.Mesh(bakeGrad(new THREE.CylinderGeometry(0.006, 0.008, 0.09, 6), sp.back, sp.back), gradMat);
            stalk.position.set(0, W * 0.9 + 0.03, L * 0.5);
            stalk.rotation.x = 0.55;
            g.add(stalk);
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), lampGlobeMat);
            bulb.position.set(0, W * 0.9 + 0.068, L * 0.5 + 0.045);
            g.add(bulb);
        }
        if (sp.whiskers) {   // 메기 수염 두 쌍
            for (const [sx, ang] of [[-1, 0.5], [1, -0.5], [-1, 1.1], [1, -1.1]]) {
                const wk = new THREE.Mesh(bakeGrad(new THREE.CylinderGeometry(0.003, 0.005, 0.09, 5), sp.belly, sp.belly), gradMat);
                wk.position.set(sx * W * 0.5, -0.005, L * 0.85);
                wk.rotation.z = ang;
                wk.rotation.x = 0.9;
                g.add(wk);
            }
        }
        const eyeM = M(0x2b2b33);
        for (const s of [-1, 1]) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyeM);
            eye.position.set(s * W * 0.62, 0.02, L * 0.62);
            g.add(eye);
        }
    }
    g.scale.setScalar(sizeK);
    return g;
}
// 도감 — { speciesId: { n, max } }
function fishdexRecord(sp, len) {
    let dex = {};
    try { dex = JSON.parse(localStorage.getItem('world-fishdex') || '{}'); } catch (e) {}
    const first = !dex[sp.id];
    const rec = dex[sp.id] || { n: 0, max: 0 };
    rec.n += 1;
    rec.max = Math.max(rec.max, len);
    dex[sp.id] = rec;
    try { localStorage.setItem('world-fishdex', JSON.stringify(dex)); } catch (e) {}
    return first;
}
function fishFanfare() {   // 잡았다! 차임 — 5도 상승 두 음
    if (audioCtx.state !== 'running') return;
    for (const [f, t0] of [[660, 0], [990, 0.11]]) {
        const o = audioCtx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const gn = audioCtx.createGain();
        gn.gain.setValueAtTime(0.0001, audioCtx.currentTime + t0);
        gn.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + t0 + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t0 + 0.22);
        o.connect(gn);
        gn.connect(sfxMaster);
        o.start(audioCtx.currentTime + t0);
        o.stop(audioCtx.currentTime + t0 + 0.25);
    }
}
// ---- 🐟 물고기 도감 패널: 실물 스냅샷 아이콘(첫 열람 때 1회 오프스크린 렌더 → dataURL 캐시
// 후 컨텍스트 즉시 폐기 — 발열 0). 못 잡은 종은 실루엣+???+힌트, 잡은 종은 이름·★·조과. ----
const dexUI = memorialPanel('🐟 물고기 도감');
let _dexIcons = null;
function fishdexIcons() {
    if (_dexIcons) return _dexIcons;
    _dexIcons = {};
    const rd = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    rd.setSize(96, 96);
    rd.setPixelRatio(1);
    const sc = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 10);
    cam.position.set(0.5, 0.32, 0.72);
    cam.lookAt(0, 0, 0);
    sc.add(new THREE.AmbientLight(0xffffff, 1.25));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.0);
    sun.position.set(1, 2, 1.5);
    sc.add(sun);
    const holder = new THREE.Group();
    sc.add(holder);
    const snap = (key, mesh) => {
        holder.add(mesh);
        const box = new THREE.Box3().setFromObject(holder);   // holder는 이 시점 스케일 1·원점
        const c = box.getCenter(new THREE.Vector3());
        const k = 0.34 / (box.getSize(new THREE.Vector3()).length() || 1);
        holder.scale.setScalar(k);
        holder.position.set(-c.x * k, -c.y * k, -c.z * k);
        rd.render(sc, cam);
        _dexIcons[key] = rd.domElement.toDataURL('image/png');
        holder.remove(mesh);
        holder.scale.setScalar(1);
        holder.position.set(0, 0, 0);
    };
    for (const sp of FISH_SPECIES) snap(sp.id, makeFishMesh(sp, (sp.len[0] + sp.len[1]) / 2));
    for (const t of SHELL_TYPES) snap(`shell:${t.id}`, makeShellMesh(t));   // 🐚 조개도 같은 세션에서
    rd.dispose();
    rd.forceContextLoss();
    return _dexIcons;
}
function renderFishdex() {
    const icons = fishdexIcons();
    let dex = {};
    try { dex = JSON.parse(localStorage.getItem('world-fishdex') || '{}'); } catch (e) {}
    dexUI.body.innerHTML = '';
    const real = FISH_SPECIES.filter((s) => s.rarity > 0);
    const got = real.filter((s) => dex[s.id]).length;
    const prog = document.createElement('div');
    prog.style.cssText = 'font-size:12px; font-weight:700; opacity:0.82;';
    prog.textContent = `잡은 어종 ${got} / ${real.length}${got >= real.length ? ' — 도감 완성! 🎉' : ''}`;
    dexUI.body.appendChild(prog);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns:repeat(3, 1fr); gap:7px;';
    for (const sp of FISH_SPECIES) {
        const rec = dex[sp.id];
        const cell = document.createElement('div');
        cell.style.cssText = 'background:rgba(120,90,50,0.09); border-radius:10px; padding:6px 4px 7px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:2px;';
        const img = document.createElement('img');
        img.src = icons[sp.id];
        img.style.cssText = `width:54px; height:54px;${rec ? '' : ' filter:brightness(0) opacity(0.5);'}`;
        cell.appendChild(img);
        const nm = document.createElement('div');
        nm.style.cssText = 'font-size:11.5px; font-weight:700;';
        nm.textContent = rec ? sp.ko : '???';
        cell.appendChild(nm);
        const sub = document.createElement('div');
        sub.style.cssText = 'font-size:9.5px; opacity:0.72; line-height:1.3; min-height:25px;';
        if (rec) sub.innerHTML = `${sp.rarity ? '★'.repeat(sp.rarity) : '잡동사니'}<br>${rec.n}마리 · 최대 ${rec.max}cm`;
        else sub.textContent = `힌트: ${sp.hint || (sp.water === 'pond' ? '연못' : sp.water === 'sea' ? '바다' : '아무 물가')}`;
        cell.appendChild(sub);
        grid.appendChild(cell);
    }
    dexUI.body.appendChild(grid);
    // ---- 🐚 조개 컬렉션 (모래섬 해변) ----
    const shellsHave = shellCounts();
    const gotShells = SHELL_TYPES.filter((t) => shellsHave[t.id]).length;
    const shHead = document.createElement('div');
    shHead.style.cssText = 'font-size:12px; font-weight:700; opacity:0.82; margin-top:6px; border-top:1px solid rgba(120,90,50,0.2); padding-top:8px;';
    shHead.textContent = `🐚 조개 컬렉션 ${gotShells} / ${SHELL_TYPES.length}${gotShells >= SHELL_TYPES.length ? ' — 완성! 🎉' : ''}`;
    dexUI.body.appendChild(shHead);
    const shGrid = document.createElement('div');
    shGrid.style.cssText = 'display:grid; grid-template-columns:repeat(4, 1fr); gap:7px;';
    for (const t of SHELL_TYPES) {
        const n = shellsHave[t.id] || 0;
        const cell = document.createElement('div');
        cell.style.cssText = 'background:rgba(120,90,50,0.09); border-radius:10px; padding:6px 3px 7px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:2px;';
        const img = document.createElement('img');
        img.src = icons[`shell:${t.id}`];
        img.style.cssText = `width:44px; height:44px;${n ? '' : ' filter:brightness(0) opacity(0.5);'}`;
        cell.appendChild(img);
        const nm = document.createElement('div');
        nm.style.cssText = 'font-size:10.5px; font-weight:700;';
        nm.textContent = n ? t.ko : '???';
        cell.appendChild(nm);
        const sub = document.createElement('div');
        sub.style.cssText = 'font-size:9px; opacity:0.72; line-height:1.25; min-height:12px;';
        sub.textContent = n ? `${t.rare ? '★ ' : ''}${n}개` : '해변에서';
        cell.appendChild(sub);
        shGrid.appendChild(cell);
    }
    dexUI.body.appendChild(shGrid);
}
function toggleFishdex() {
    if (dexUI.panel.style.display === 'flex') { dexUI.panel.style.display = 'none'; return; }
    renderFishdex();
    dexUI.panel.style.display = 'flex';
}
let fishing = null;   // { p, state, t, ...장비 refs } — 상태: idle→cast→wait→bite→hook→reel→land / miss
const _fishPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);   // 캐스팅 수면 교차용
const _fishHit = new THREE.Vector3();
function mkFishingGear() {
    const rod = new THREE.Group();
    const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.2, 7), M(0x8a6647, { map: woodTex }));
    butt.position.y = 0.1;
    rod.add(butt);
    const tipPivot = new THREE.Group();   // 릴링 때 여기만 굽힌다
    tipPivot.position.y = 0.2;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.22, 6), M(0xb08a60, { map: woodTex }));
    tip.position.y = 0.11;
    tipPivot.add(tip);
    rod.add(tipPivot);
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.016, 10).rotateZ(Math.PI / 2), M(0xe8c46f));
    reel.position.set(0.02, 0.07, 0);
    rod.add(reel);
    scene.add(rod);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 3), 3));
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf5f2e8, transparent: true, opacity: 0.85 }));
    line.frustumCulled = false;
    scene.add(line);
    const bobber = new THREE.Group();
    const bTop = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(0xf05a5a));
    const bBot = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M(0xfdf7e8));
    bobber.add(bTop, bBot);
    scene.add(bobber);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.09, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1d3048, transparent: true, opacity: 0.34, depthWrite: false }));
    shadow.scale.x = 1.7;
    scene.add(shadow);
    return { rod, tipPivot, line, lineGeo, bobber, shadow };
}
function equipFishing() {
    if (!pets.length) return;
    if (!possessed) possessPet(pets[0]);   // 조종 중이 아니면 병아리부터 잡고 낚싯대를 쥔다
    if (!possessed) return;
    if (fishing) { unequipFishing(); return; }   // 토글
    fishing = { p: possessed, state: 'equip', t: 0, ...getFishingGear('player'), boredT: 0, sitT: 0, alert: 0, droop: 0 };
    fishing.bobber.visible = false;
    fishing.line.visible = false;
    fishing.shadow.visible = false;
    const spr = glowSprite(0xfff1cf, 0.16, 0.9);   // 장비 반짝
    spr.position.copy(fishing.p.mover.position).y += fishing.p.height * 0.6;
    scene.add(spr);
    hugBurst.push({ spr, vx: 0, vy: 0.3, vz: 0, t: 0.4 });
    showToast('🎣 낚싯대를 들었어요 — 물을 클릭해 캐스팅! (다시 🎣 = 정리)');
}
function unequipFishing() {
    if (!fishing) return;
    hideGear(fishing);   // 리그는 캐시 — 씬에서 빼지 않고 숨긴다 (재장비 시 재생성 없음)
    if (fishing.fishMesh) scene.remove(fishing.fishMesh);
    fishing = null;   // 팔다리는 엔티티가 매 프레임 원위치 — 복원 코드 불필요 (앉기와 동일 원리)
}
function resetFishingInstance(f, quiet) {
    f.bobber.visible = false;
    f.line.visible = false;
    f.shadow.visible = false;
    if (f.fishMesh) { scene.remove(f.fishMesh); f.fishMesh = null; }
    f.state = 'idle';
    f.t = 0;
    if (!quiet) playBuffer(swishBuf, { vol: 0.2, rate: 1.6, filterFreq: 1400 });
}
function cancelFishing(quiet) { if (fishing) resetFishingInstance(fishing, quiet); }
// ---- 절친 자율 낚시: 한가한 낮에 혼자 물가로 걸어가 앉아 두세 판 낚시하고 온다.
// 같은 상태기계·안무를 그대로 타되(isAI) 입력 대신 반사신경 랜덤 + 85% 챔질 성공. ----
let aiFishing = null;
const _fishGear = {};   // 'player' | 'ai' — 리그는 한 번 만들어 보였다 숨겼다 (반복 토글 GC 없음)
function getFishingGear(kind) {
    if (!_fishGear[kind]) _fishGear[kind] = mkFishingGear();
    const g = _fishGear[kind];
    g.rod.visible = true;
    return g;
}
function hideGear(f) {
    f.rod.visible = false;
    f.line.visible = false;
    f.bobber.visible = false;
    f.shadow.visible = false;
}
function aiCastNow(f) {
    // 바라보는 방향부터 전방위 스캔(16각 × 2거리) — 도착이 어중간해도(막힘-도착) 근처 물을 찾아낸다
    const m = f.p.mover;
    for (let i = 0; i < 16; i++) {
        const ang = m.rotation.y + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
        for (const reach of [1.7, 2.4]) {
            const cx = m.position.x + Math.sin(ang) * reach, cz = m.position.z + Math.cos(ang) * reach;
            const water = Math.hypot(cx - pondPropRef.x, cz - pondPropRef.z) < 0.55 ? 'pond'
                : (islandOf(cx, cz) < 0 && Math.hypot(cx, cz) < 22 ? 'sea' : null);
            if (water) {
                m.rotation.y = ang;
                f.aiActed = false;
                f.aiHookAt = 0.15 + Math.random() * 0.4;
                startCast(f, { x: cx, z: cz, water });
                return;
            }
        }
    }
    endAiFishing();   // 정말 내륙에 갇혔을 때만
}
function aiAfterRound(f) {
    f.castsLeft -= 1;
    if (f.castsLeft <= 0) endAiFishing();   // 남았으면 idle에서 1.2초 숨 고르고 다시 던진다
}
function startAiFishing(p) {
    if (aiFishing || (fishing && fishing.p === p)) return;
    if (p === possessed || p.bed || p.dip || p.pet.sleeping) return;   // 자거나 놀이 중이면 다음 기회에
    const idx = islandOf(p.mover.position.x, p.mover.position.z);
    const isl = idx >= 0 ? ISLANDS[idx] : ISLANDS[0];
    // 물가 지점: 펫에서 가장 가까운 림 각도부터 좌우로 훑어 통행 가능한 첫 자리 (짧은 산책 + 막힘 최소)
    const a0 = Math.atan2(p.mover.position.z - isl.z, p.mover.position.x - isl.x);
    let sx = null, sz = null;
    for (let i = 0; i < 24; i++) {
        const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
        const x = isl.x + Math.cos(a) * (isl.r - 0.55), z = isl.z + Math.sin(a) * (isl.r - 0.55);
        if (!world.isBlocked(x, z)) { sx = x; sz = z; break; }
    }
    if (sx === null) return;
    releaseAI(p);
    p.ai.state = 'goto';
    p.ai.target = { x: sx, z: sz };
    p.ai.waypoints = buildRoute(p.mover.position, { x: sx, z: sz });
    p.ai.stall = 0;
    // 인스턴스는 출발부터 — 걷는 동안 idle 안무가 낚싯대를 어깨에 메 준다 (도착 전 캐스팅은 onArrive 게이트)
    aiFishing = { p, isAI: true, state: 'idle', t: 0, ...getFishingGear('ai'), boredT: 0, sitT: 0, alert: 0, droop: 0, castsLeft: 2 + Math.floor(Math.random() * 2) };
    aiFishing.bobber.visible = false;
    aiFishing.line.visible = false;
    aiFishing.shadow.visible = false;
    aiFishing.ownArrive = () => {   // 클로저 정체성 = 소유권 표식 — 다른 디렉터가 goto를 덮어쓰면 식별된다
        if (!aiFishing || aiFishing.p !== p) return;
        p.mover.rotation.y = Math.atan2(p.mover.position.x - isl.x, p.mover.position.z - isl.z);   // 물(바깥)을 본다
        aiFishing.began = true;
        aiFishing.t = 0;
        aiCastNow(aiFishing);
    };
    p.ai.onArrive = aiFishing.ownArrive;
    logWorldEvent(`${petKo(p)}가 낚싯대를 챙겨 물가로 나섰다 🎣`);
}
function endAiFishing() {
    if (!aiFishing) return;
    const f = aiFishing, p = f.p;
    if (f.fishMesh) { scene.remove(f.fishMesh); f.fishMesh = null; }
    hideGear(f);
    p.mover.position.y = world.groundHeightAt(p.mover.position.x, p.mover.position.z);   // 잔여 부양 정리 (endDip 문법)
    aiFishing = null;
    // 아직 우리가 소유 중일 때만 놓아준다 — 다른 디렉터가 데려갔으면 그쪽 연출을 건드리지 않는다
    const ours = (p.ai.state === 'goto' && p.ai.onArrive === f.ownArrive) || (p.ai.state === 'busy' && f.began);
    if (ours) releaseAI(p, 2);
    if (f.began) logWorldEvent(`${petKo(p)}가 낚시를 마치고 일어났다`);
}
// 캐스팅 시작 — target { x, z, water:'sea'|'pond' } (f = 플레이어 fishing 또는 aiFishing 인스턴스)
function startCast(f, target) {
    f.state = 'cast';
    f.t = 0;
    f.target = target;
    f.boredT = 0; f.sitT = 0; f.dip = 0; f.droop = 0;
    f.shown = false; f.bobberFlying = false;
    f.shadow.visible = false;
    f.p.mover.rotation.y = Math.atan2(target.x - f.p.mover.position.x, target.z - f.p.mover.position.z);
    f.nibblesLeft = 1 + Math.floor(Math.random() * 3);
    f.nextEventT = 1.6 + Math.random() * 2.6;   // 그림자 등장까지
    f.shadowPhase = 'approach';
    // 어종 미리 결정 (물별 풀 + 밤/비/계절 조건 + 희귀도 가중 + 꽝 10%). 조건 어종은 자기 조건이
    // 켜져 있을 때 가중 1.6배 — "밤에 낚시하러 나온 보람"이 확률로 느껴지게.
    const roll = Math.random();
    if (roll < 0.1) {
        f.species = FISH_SPECIES.find((s) => s.id === (Math.random() < 0.5 ? 'boot' : 'bottle'));
    } else {
        const pool = speciesPool(target.water);
        const w = pool.map((s) => (s.rarity === 1 ? 0.6 : s.rarity === 2 ? 0.3 : 0.1) * (s.when ? 1.6 : 1));
        let r2 = Math.random() * w.reduce((a, b) => a + b, 0);
        f.species = pool[0];
        for (let i = 0; i < pool.length; i++) { r2 -= w[i]; if (r2 <= 0) { f.species = pool[i]; break; } }
    }
    f.len = Math.round(f.species.len[0] + Math.random() * (f.species.len[1] - f.species.len[0]));
    f.big = f.len >= f.species.len[0] + (f.species.len[1] - f.species.len[0]) * 0.85 && f.species.rarity > 0;
    playBuffer(swishBuf, { vol: 0.4, rate: 1.25, filterFreq: 1600 });
}
function waterYFor(f) {
    return f.target.water === 'pond' ? POND_WATER_Y : waveYAt(f.target.x, f.target.z);
}
// 현재 raycaster 방향으로 캐스팅 시도 — 'cast'|'far'|'near'|'land' (pointerup과 진단 훅이 공유).
// 1차: 수면 평면과의 정밀 교차. 2차(게임식 관용 조준): 낮은 카메라에선 교차점이 "섬 안"이거나
// 순식간에 6m 밖으로 튀어 유효 밴드가 없다(실측) — 클릭 '방향'만 취해 펫 앞 2.2m 물에 던진다.
function tryCastAtScreen() {
    const mp = possessed.mover.position;
    const waterAt = (x, z) => {
        if (Math.hypot(x - pondPropRef.x, z - pondPropRef.z) < 0.55) return 'pond';
        if (islandOf(x, z) < 0 && Math.hypot(x, z) < 22) return 'sea';
        return null;
    };
    _fishPlane.constant = -POND_WATER_Y;
    let water = null;
    let pt = raycaster.ray.intersectPlane(_fishPlane, _fishHit);
    if (pt && Math.hypot(pt.x - pondPropRef.x, pt.z - pondPropRef.z) < 0.55) water = 'pond';
    else {
        _fishPlane.constant = -(OCEAN_LEVEL + tideOffset());
        pt = raycaster.ray.intersectPlane(_fishPlane, _fishHit);
        if (pt && islandOf(pt.x, pt.z) < 0 && Math.hypot(pt.x, pt.z) < 22) water = 'sea';
    }
    if (water) {
        const d = Math.hypot(pt.x - mp.x, pt.z - mp.z);
        if (d >= 0.45 && d <= 6.0) { startCast(fishing, { x: pt.x, z: pt.z, water }); return 'cast'; }
        if (d < 0.45) return 'near';
    }
    // 관용 조준: 클릭 방향(수평)으로 2.2m — 물가에서 물 쪽을 찍으면 각도와 무관하게 던져진다
    const dx = raycaster.ray.direction.x, dz = raycaster.ray.direction.z;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-4) {
        for (const reach of [2.2, 1.4, 3.2]) {
            const cx = mp.x + (dx / dl) * reach, cz = mp.z + (dz / dl) * reach;
            const w2 = waterAt(cx, cz);
            if (w2) { startCast(fishing, { x: cx, z: cz, water: w2 }); return 'cast'; }
        }
    }
    return water ? 'far' : 'land';
}
// ⌘/클릭 = 챔질 시도 (doInteract·pointerup에서 호출) — true를 돌려주면 입력을 삼킨다
function fishingIntercept() {
    if (!fishing) return false;
    const st = fishing.state;
    if (st === 'bite') {   // 성공! → 훅셋
        fishing.state = 'hook';
        fishing.t = 0;
        playSplashSound(fishing.target.x, fishing.target.z);
        return true;
    }
    if (st === 'wait') {   // 성급한 챔질 — 빈 찌만 걷힌다
        cancelFishing(false);
        showToast('🎣 앗, 아직인데! — 찌가 푹 잠길 때 챔질이에요');
        return true;
    }
    return st !== 'idle';   // 시전·파이팅·연출 중엔 다른 상호작용 잠금
}
function updateFishing(delta) {
    if (fishing) updateFishingInstance(fishing, delta);
    if (aiFishing) updateFishingInstance(aiFishing, delta);
}
function updateFishingInstance(f, delta) {
    const p = f.p;
    if (!f.isAI && p !== possessed) { unequipFishing(); return; }   // 조종이 풀리면 낚시도 정리
    if (f.isAI) {   // 소유권 확인: 물가로 걷는 중(우리 onArrive) 또는 자리 잡음(began) — 아니면 뺏긴 것
        const walking = p.ai.state === 'goto' && p.ai.onArrive === f.ownArrive;
        const parked = p.ai.state === 'busy' && f.began;
        if (p === possessed || (!walking && !parked) || isSleepTime(currentHour())) { endAiFishing(); return; }
    }
    f.t += delta;
    const m = p.mover;
    const fwdX = Math.sin(m.rotation.y), fwdZ = Math.cos(m.rotation.y);
    const rgtX = Math.cos(m.rotation.y), rgtZ = -Math.sin(m.rotation.y);
    const wrap = p.pet.wrap;
    // ---- 낚싯대 기본 부착점: 몸 오른쪽, 상태별 각도는 아래에서 ----
    const gripY = m.position.y + p.height * 0.34;
    let rodPitch = 0.6;    // 앞으로 기운 정도 (0 = 수직)
    let rodYaw = m.rotation.y;
    let rodSide = 0.3;     // 몸 중심에서 오른쪽으로
    let rodFwd = 0.3;      // 앞으로
    let tipBend = 0;
    let leanX = 0;         // 몸 기울기 (+ 앞으로)
    let twistY = 0;        // 몸 비틀기
    let hopY = 0;
    // ---- 상태기계 + 전용 안무 ----
    if (f.state === 'equip') {
        const k = Math.min(1, f.t / 0.5);
        rodPitch = 0.6 + Math.sin(k * Math.PI) * 0.5;
        rodYaw += Math.sin(k * Math.PI * 2) * 2.2 * (1 - k);   // 빙글 돌려 잡기
        if (k >= 1) {
            f.state = 'idle';
            f.t = 0;
            if (f.isAI) aiCastNow(f);   // 절친은 장비 빙글 끝나자마자 스스로 던진다
        }
    } else if (f.state === 'idle') {
        if (f.isAI && !p.ai.onArrive && f.t > 1.2) aiCastNow(f);   // 걷는 중(onArrive 대기)엔 메고만 간다 — 재캐스팅 숨 고르기
        // 걷는 중엔 어깨에 걸치고, 서 있으면 앞으로 든다
        rodPitch = p.pet.walking ? -0.5 : 0.55;
        rodSide = p.pet.walking ? 0.16 : 0.28;
    } else if (f.state === 'cast') {
        // ② 캐스팅 3박자: 백스윙(0~0.35) → 스윙(0.35~0.53) → 팔로스루(0.53~1.05)
        if (f.t < 0.35) {
            const k = f.t / 0.35;
            const e = k * k;
            twistY = -0.45 * e;
            rodPitch = 0.55 - 1.5 * e;   // 어깨 뒤로 넘어감
            leanX = -0.1 * e;
        } else if (f.t < 0.53) {
            const k = (f.t - 0.35) / 0.18;
            twistY = -0.45 + 0.75 * k;   // 앞으로 홱 (+0.3 오버슈트)
            rodPitch = -0.95 + 1.9 * k;
            leanX = -0.1 + 0.3 * k;
        } else {
            const k = Math.min(1, (f.t - 0.53) / 0.52);
            const wob = Math.exp(-k * 4) * Math.sin(k * 14);   // 감쇠 진동 팔로스루
            twistY = 0.3 * (1 - k) + wob * 0.06;
            rodPitch = 0.95 - 0.35 * k + wob * 0.08;
            leanX = 0.2 * (1 - k) + wob * 0.04;
            if (!f.bobberFlying && f.t >= 0.53) {   // 스윙 정점에서 찌 발사
                f.bobberFlying = true;
                f.bobber.visible = true;
                f.line.visible = true;
                f.castFrom = { x: m.position.x + fwdX * 0.4, y: gripY + 0.35, z: m.position.z + fwdZ * 0.4 };
            }
            if (f.bobberFlying) {
                const fk = Math.min(1, (f.t - 0.53) / 0.42);
                const wy = waterYFor(f);
                f.bobber.position.set(
                    THREE.MathUtils.lerp(f.castFrom.x, f.target.x, fk),
                    THREE.MathUtils.lerp(f.castFrom.y, wy, fk) + Math.sin(fk * Math.PI) * 0.55,
                    THREE.MathUtils.lerp(f.castFrom.z, f.target.z, fk));
                if (fk >= 1 && f.state === 'cast' && f.t >= 1.05) {
                    f.state = 'wait';
                    f.t = 0;
                    f.bobberFlying = false;
                    spawnSplash(f.target.x, wy + 0.03, f.target.z);
                    playBuffer(splashBuf, { vol: 0.25 * attAtPoint(f.target.x, f.target.z), rate: 1.5, filterFreq: 1200 });
                }
            }
        }
    } else if (f.state === 'wait') {
        // ③ 대기: 웅크려 찌 응시 + 지루함 배리에이션 + 20초 넘으면 앉기
        const wy = waterYFor(f);
        f.boredT += delta;
        leanX = 0.12;
        rodPitch = 0.75;
        if (f.boredT > 20) f.sitT = Math.min(1, f.sitT + delta * 2);   // 스르륵 앉는다
        if (f.sitT > 0) {
            for (const ft of p.pet.feet) ft.rotation.x = (ft.userData._restRotX || 0) - 1.35 * f.sitT;
            m.position.y = playerSupportY(p, m.position.x, m.position.z).y - 0.06 * f.sitT;
            leanX = 0.12 - 0.1 * f.sitT;
        }
        // 지루함: 갸웃(6s 주기) · 하품(12s 주기, 부리)
        const bored = f.boredT > 6 ? Math.sin(f.boredT * 0.5) * 0.06 : 0;
        wrap.rotation.z += bored;
        if (p.pet.beak && f.boredT % 12 > 10.6) p.pet.beak.rotation.x = (p.pet.beak.userData._restRotX || 0) + 0.3;
        // 찌: 파도 위 (니블 딥은 아래 이벤트가)
        f.bobber.position.set(f.target.x, wy + (f.dip || 0), f.target.z);
        if (f.dip) f.dip = Math.min(0, f.dip + delta * 0.25);
        // 그림자 이벤트 진행
        f.nextEventT -= delta;
        if (f.shadowPhase === 'approach' && f.nextEventT <= 0) {
            f.shadow.visible = true;
            const a = Math.random() * Math.PI * 2;
            f.shadow.position.set(f.target.x + Math.cos(a) * 1.1, wy - 0.03, f.target.z + Math.sin(a) * 1.1);
            f.shadowPhase = 'dart';
            f.nextEventT = 0.5 + Math.random() * 0.7;
        } else if (f.shadowPhase === 'dart' && f.nextEventT <= 0) {
            // 다트-멈칫 접근: 찌까지 절반씩 다가온다
            const dx = f.target.x - f.shadow.position.x, dz = f.target.z - f.shadow.position.z;
            const d = Math.hypot(dx, dz);
            if (d < 0.16) {
                if (f.nibblesLeft > 0) {   // ④ 니블
                    f.nibblesLeft -= 1;
                    f.dip = -0.035;
                    f.alert = 1;
                    playBuffer(swishBuf, { vol: 0.16, rate: 2.3, filterFreq: 2000 });
                    f.nextEventT = 0.7 + Math.random() * 1.1;
                } else {   // 진짜 바이트!
                    f.state = 'bite';
                    f.t = 0;
                    f.dip = -0.1;
                    f.alert = 1;
                    spawnSplash(f.target.x, wy + 0.02, f.target.z);
                    playBuffer(splashBuf, { vol: 0.5 * attAtPoint(f.target.x, f.target.z), rate: 1.1, filterFreq: 1400 });
                }
            } else {
                f.shadow.position.x += dx / d * Math.min(d * 0.55, 0.35);
                f.shadow.position.z += dz / d * Math.min(d * 0.55, 0.35);
                f.nextEventT = 0.4 + Math.random() * 0.8;
            }
        }
        f.shadow.rotation.y = Math.atan2(f.target.x - f.shadow.position.x, f.target.z - f.shadow.position.z);
        if (f.alert > 0) {   // 니블 알럿 — 몸이 확 숙고 눈 커짐
            leanX += 0.14 * f.alert;
            for (const ey of p.pet.eyes) ey.scale.y = (ey.userData._restScaleY || 1) * (1 + 0.18 * f.alert);
            f.alert = Math.max(0, f.alert - delta * 2.2);
        }
    } else if (f.state === 'bite') {
        // ⑤ 챔질 윈도우 0.65초 — 놓치면 miss. 절친(AI)은 반사신경 랜덤 + 85% 성공(가끔 놓쳐야 귀엽다)
        const wy = waterYFor(f);
        f.bobber.position.set(f.target.x, wy - 0.09 + Math.sin(f.t * 30) * 0.012, f.target.z);
        leanX = 0.22;
        for (const ey of p.pet.eyes) ey.scale.y = (ey.userData._restScaleY || 1) * 1.22;
        if (f.isAI && !f.aiActed && f.t >= (f.aiHookAt || 0.25)) {
            f.aiActed = true;
            if (Math.random() < 0.85) {
                f.state = 'hook';
                f.t = 0;
                playSplashSound(f.target.x, f.target.z);
            }
        }
        if (f.state === 'bite' && f.t > 0.65) {
            f.state = 'miss';
            f.t = 0;
            f.shadow.visible = false;
        }
    } else if (f.state === 'hook') {
        // ⑤ 훅셋 저크 0.15초 — 몸 홱 젖힘 + 스쿼시
        const k = Math.min(1, f.t / 0.15);
        leanX = 0.22 - 0.55 * k;
        rodPitch = 0.75 - 1.1 * k;
        wrap.scale.y = 1 - 0.14 * Math.sin(k * Math.PI);
        wrap.scale.x = 1 + 0.1 * Math.sin(k * Math.PI);
        if (k >= 1) {
            wrap.scale.set(1, 1, 1);
            f.state = 'reel';
            f.t = 0;
            f.reelDur = 0.9 + f.species.rarity * 0.55 + (f.big ? 0.5 : 0);
            f.dragDone = false;
        }
    } else if (f.state === 'reel') {
        // ⑥ 릴링 버둥: 뒤로 기대 + 좌우 흔들림 + (희귀) 끌려갔다 버티기
        const k = Math.min(1, f.t / f.reelDur);
        const fight = Math.sin(f.t * 7.5) * (1 - k * 0.55);
        leanX = -0.3 - 0.08 * Math.sin(f.t * 3);
        twistY = fight * 0.22;
        rodPitch = -0.15 + Math.abs(fight) * 0.18;
        tipBend = 0.7 + Math.abs(fight) * 0.4;   // 낚싯대 끝이 물 쪽으로 휜다
        const wy = waterYFor(f);
        f.bobber.position.set(
            f.target.x + Math.sin(f.t * 7.5) * 0.12,
            wy - 0.06,
            f.target.z + Math.cos(f.t * 6.1) * 0.12);
        if (Math.random() < delta * 3) spawnSplash(f.bobber.position.x, wy + 0.02, f.bobber.position.z);
        if ((f.species.rarity >= 3 || f.big) && !f.dragDone && k > 0.45) {   // 월척 — 한 번 끌려간다
            f.dragDone = true;
            m.position.x += fwdX * 0.1;
            m.position.z += fwdZ * 0.1;
            playBuffer(swishBuf, { vol: 0.35, rate: 0.8, filterFreq: 900 });
        }
        if (boatRide && boatRide.driver === p) boatGroup.rotation.z += fight * 0.02;   // 배가 같이 출렁
        if (k >= 1) {
            f.state = 'land';
            f.t = 0;
            f.shadow.visible = false;
            f.fishMesh = makeFishMesh(f.species, 0.55 + (f.len / f.species.len[1]) * 0.65);
            scene.add(f.fishMesh);
            spawnSplash(f.target.x, wy + 0.04, f.target.z);
            playSplashSound(f.target.x, f.target.z);
        }
    } else if (f.state === 'land') {
        // ⑦ 랜딩(0~0.5: 물고기 호) + 자랑(0.5~1.9: 한손 번쩍 / 월척은 만세+폴짝)
        const wy = waterYFor(f);
        if (f.t < 0.5) {
            const k = f.t / 0.5;
            const e = k * k * (3 - 2 * k);
            f.fishMesh.position.set(
                THREE.MathUtils.lerp(f.target.x, m.position.x + rgtX * 0.1, e),
                THREE.MathUtils.lerp(wy, m.position.y + p.height * 1.15, e) + Math.sin(k * Math.PI) * 0.5,
                THREE.MathUtils.lerp(f.target.z, m.position.z + rgtZ * 0.1, e));
            f.fishMesh.rotation.y += delta * 9;
            f.bobber.visible = false;
            f.line.visible = false;
        } else {
            if (!f.shown) {   // 자랑 시작 프레임: 도감·토스트·차임·반짝 링 (도감은 주인 조과만)
                f.shown = true;
                const first = !f.isAI && f.species.rarity > 0 && fishdexRecord(f.species, f.len);
                const label = f.isAI
                    ? (f.species.rarity === 0 ? `😅 절친이 ${f.species.ko}...를 건져 올렸다` : `🐟 절친이 ${f.species.ko}를 낚았다! (${f.len}cm)`)
                    : (f.species.rarity === 0 ? `😅 ${f.species.ko}...가 낚였다` : `🐟 ${f.species.ko}를 낚았다! (${f.len}cm)${f.big ? ' — 월척!!' : ''}${first ? ' · 처음 잡았다!' : ''}`);
                showToast(label);
                logWorldEvent(`${petKo(p)}가 낚시로 ${f.species.ko}${f.species.rarity === 0 ? '를 건져 올렸다' : `를 낚았다 (${f.len}cm)`}`);
                if (f.species.rarity > 0) {
                    fishFanfare();
                    if (!f.isAI) maybeProactive(null, `주인이 방금 낚시로 ${f.species.ko}(${f.len}cm)를 낚았다!${f.big ? ' 월척이다!' : ''}`);
                    for (let i = 0; i < 8; i++) {   // 반짝 링
                        const a = (i / 8) * Math.PI * 2;
                        const spr = glowSprite(0xfff1cf, 0.08, 0.9);
                        spr.position.set(m.position.x + Math.cos(a) * 0.22, m.position.y + p.height * 0.9, m.position.z + Math.sin(a) * 0.22);
                        scene.add(spr);
                        hugBurst.push({ spr, vx: Math.cos(a) * 0.4, vy: 0.25, vz: Math.sin(a) * 0.4, t: 0.45 });
                    }
                    const friend = pets.find((q) => q !== p);
                    if (friend && !friend.bed && !friend.dip && friend.ai.state !== 'held') friend.pet.action = { id: 'happy', t: 0 };
                } else {
                    playBuffer(swishBuf, { vol: 0.3, rate: 0.7, filterFreq: 800 });
                }
            }
            const k = (f.t - 0.5) / 1.4;
            if (f.species.rarity === 0) {   // 꽝 — 들고 갸웃하다 축 처짐
                f.fishMesh.position.set(m.position.x + fwdX * 0.22, m.position.y + p.height * (0.7 - 0.25 * Math.min(1, k * 1.6)), m.position.z + fwdZ * 0.22);
                wrap.rotation.z += Math.sin(Math.min(1, k * 2) * Math.PI) * 0.14;   // 갸웃
                f.droop = Math.min(1, Math.max(0, k * 2 - 0.7));
                leanX = 0.1 * f.droop;
            } else if (f.big) {   // 월척 — 양손 만세 + 폴짝×2
                hopY = Math.abs(Math.sin(Math.min(1, k) * Math.PI * 2)) * 0.09;
                f.fishMesh.position.set(m.position.x, m.position.y + hopY + p.height * 1.35, m.position.z);
                leanX = -0.18;
            } else {   // 한손 번쩍
                f.fishMesh.position.set(m.position.x + rgtX * 0.14, m.position.y + p.height * 1.18, m.position.z + rgtZ * 0.14);
                leanX = -0.12;
                rodSide = 0.1;
                rodPitch = 1.2;   // 낚싯대는 옆구리에
            }
            f.fishMesh.rotation.y += delta * 1.5;
            if (f.t > 1.9) {
                scene.remove(f.fishMesh);
                f.fishMesh = null;
                f.shown = false;
                resetFishingInstance(f, true);
                if (f.isAI) aiAfterRound(f);
            }
        }
    } else if (f.state === 'miss') {
        // ⑧ 놓침 — 앞으로 휘청 + 처짐
        const k = Math.min(1, f.t / 0.9);
        leanX = k < 0.25 ? 0.4 * (k / 0.25) : 0.4 * (1 - (k - 0.25) / 0.75) + 0.08;
        f.droop = Math.min(1, k * 1.4);
        f.bobber.visible = false;
        f.line.visible = false;
        if (k >= 1) {
            f.droop = 0;
            resetFishingInstance(f, true);
            if (f.isAI) aiAfterRound(f);
            else showToast('🎣 놓쳤다…! 다시 던져봐요');
        }
    }
    // ---- 공통 적용: 몸(wrap) + 날개/귀 + 낚싯대 + 낚싯줄 ----
    // x/z는 엔티티가 매 프레임 다시 쓰므로 +=가 "이번 프레임 값 위에 얹기"지만, y는 모션 종료
    // 때만 π로 리셋된다 — +=면 비틀기가 적분 누적돼 캐스팅마다 몸이 한쪽으로 감긴다. 절대값으로.
    wrap.rotation.x += leanX;
    wrap.rotation.y = Math.PI + twistY;
    if (f.isAI) {
        // AI 펫은 서포트 클램프가 없다 — 폴짝을 +=하면 잡을 때마다 하늘로 적분 누적되고,
        // 떠오른 뒤엔 steerToward 턱 규칙(0.26)에 막혀 걷지도 못한다 (사용자 버그 리포트).
        // 절대값: 지면 + 이번 프레임 폴짝. (조종 펫은 updatePossessed가 매 프레임 기준선 복원)
        m.position.y = playerSupportY(p, m.position.x, m.position.z).y + hopY;
    } else if (hopY) m.position.y += hopY;
    if (f.droop > 0) {   // 처짐: 날개·귀가 축
        for (const wg of p.pet.wings) wg.rotation.z = (wg.userData._restRotZ || 0) * (1 - f.droop * 0.5);
        for (const er of p.pet.ears) er.rotation.x = (er.userData._restRotX || 0) + 0.4 * f.droop;
    } else if (f.state !== 'idle' && f.state !== 'equip') {
        for (const wg of p.pet.wings) wg.rotation.z = (wg.userData._restRotZ || 0) * 0.35;   // 그립 — 날개 몸에 붙임
    }
    const rk = p.height / 0.85;   // 상태별 오프셋 상수는 키 0.85 기준 미터 — 펫 키에 비례 축소해 몸에 붙인다
    const grip = {
        x: m.position.x + (fwdX * rodFwd + rgtX * rodSide) * rk,
        y: gripY,
        z: m.position.z + (fwdZ * rodFwd + rgtZ * rodSide) * rk,
    };
    f.rod.position.set(grip.x, grip.y, grip.z);
    f.rod.rotation.set(rodPitch, rodYaw, 0, 'YXZ');
    f.tipPivot.rotation.x = tipBend;
    // 낚싯줄: 대 끝 → (처짐) → 찌, 8점 커브
    if (f.line.visible) {
        const tipW = new THREE.Vector3(0, 0.42, 0);
        f.tipPivot.localToWorld(tipW.set(0, 0.22, 0));
        const arr = f.lineGeo.attributes.position.array;
        for (let i = 0; i < 8; i++) {
            const t = i / 7;
            const sag = Math.sin(t * Math.PI) * (f.state === 'reel' ? 0.02 : 0.14);
            arr[i * 3] = THREE.MathUtils.lerp(tipW.x, f.bobber.position.x, t);
            arr[i * 3 + 1] = THREE.MathUtils.lerp(tipW.y, f.bobber.position.y, t) - sag;
            arr[i * 3 + 2] = THREE.MathUtils.lerp(tipW.z, f.bobber.position.z, t);
        }
        f.lineGeo.attributes.position.needsUpdate = true;
    }
}
function updateHandHold(delta) {
    if (!handHold) return;
    const leader = possessed;
    const q = handHold.partner;
    if (!leader || q.ai.state !== 'held') { releaseHandHold(); return; }
    const h = leader.mover.rotation.y;
    const fwdX = Math.sin(h), fwdZ = Math.cos(h);
    const rightX = Math.cos(h), rightZ = -Math.sin(h);
    let sx = leader.mover.position.x + rightX * handHold.side * 0.4;
    let sz = leader.mover.position.z + rightZ * handHold.side * 0.4;
    // Narrow ground (bridges): if the side slot hangs over open water while the leader is on
    // land, tuck into single file just behind instead.
    const leaderSup = playerSupportY(leader, leader.mover.position.x, leader.mover.position.z);
    let slotSup = playerSupportY(q, sx, sz);
    if (slotSup.medium === 'sea' && leaderSup.medium !== 'sea') {
        sx = leader.mover.position.x - fwdX * 0.42;
        sz = leader.mover.position.z - fwdZ * 0.42;
        slotSup = playerSupportY(q, sx, sz);
    }
    const beforeX = q.mover.position.x, beforeZ = q.mover.position.z;
    const k = Math.min(1, delta * 7);
    q.mover.position.x += (sx - q.mover.position.x) * k;
    q.mover.position.z += (sz - q.mover.position.z) * k;
    q.swimming = slotSup.medium === 'land' ? false : slotSup.medium;
    q.mover.position.y = slotSup.y + (q.swimming ? Math.sin(q.pet.t * 2.6) * 0.02 : 0);
    q.mover.rotation.x = q.swimming ? 0.3 : 0;
    let dh = h - q.mover.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    q.mover.rotation.y += dh * Math.min(1, delta * 8);
    // Lean gently into each other; the friend reads as walking whenever it actually moves.
    q.mover.rotation.z = -handHold.side * 0.05;
    leader.mover.rotation.z = handHold.side * 0.05;
    q.pet.walking = Math.hypot(q.mover.position.x - beforeX, q.mover.position.z - beforeZ) > delta * 0.12;
    handHold.heartT -= delta;
    if (handHold.heartT <= 0) {
        q.pet.spawnEmoji(Math.random() < 0.5 ? '💕' : '💗', { left: 50 - handHold.side * 10, top: 16, size: 18, dx: (Math.random() - 0.5) * 10, duration: 1200 });
        handHold.heartT = 3.5 + Math.random() * 2.5;
    }
}

// ---- 잠자리 & auto-sleep: at 22시 the pets head to bed (chick→hammock, puppy→sunbed), climb on,
// tip onto their backs and doze until 6시. Waking them (click/chat/motion) makes them hop off —
// during sleep hours they drowsily try again ~90s later. Beds are blocking props, so pets walk to
// an approach point and are then tweened onto the lying spot; the lean-back lives on the mover
// (rotation.x) so the shared sleep animation keeps breathing on top. The hammock rocks gently.
const BED_PREF = { chick: 'hammock', puppy: 'sunbed' };
function freeBedFor(p) {
    return BEDS.find((b) => b.id === BED_PREF[p.name] && !b.occupant)
        || BEDS.find((b) => !b.occupant && b.mode !== 'sit' && b.mode !== 'swing' && b.mode !== 'seesaw')   // sofas/rides aren't night beds
        || null;
}
function nearestFreeBed(p, maxDist) {
    let best = null, bestD = maxDist;
    for (const b of BEDS) {
        if (b.occupant) continue;
        const d = Math.hypot(p.mover.position.x - b.lie.x, p.mover.position.z - b.lie.z);
        if (d < bestD) { bestD = d; best = b; }
    }
    return best;
}
async function mountBed(p, bed) {
    if (buildMode || p.bed || bed.occupant) return;   // 🔨 공사 중엔 아무도 안 탄다 (이사 중인 침대에 눕기 방지)
    removeDrink(p);                                   // put the cup/snack down before climbing in
    removeFood(p);
    bed.occupant = p; p.bed = bed; p.bedPhase = 'approach';
    const bedKo = BED_KO[bed.id] || bed.id;
    logWorldEvent(bed.mode === 'swing' || bed.mode === 'seesaw' ? `${petKo(p)}가 ${bedKo}를 타러 갔다`
        : bed.mode === 'sit' ? `${petKo(p)}가 ${bedKo}에 앉으러 갔다` : `${petKo(p)}가 ${bedKo}에 누우러 갔다`);
    await gotoAsync(p, bed.approach.x, bed.approach.z);
    if (p.bed !== bed) return;
    p.bedPhase = 'mount'; p.bedT = 0;
    p.bedFrom = { x: p.mover.position.x, y: p.mover.position.y, z: p.mover.position.z, rotY: p.mover.rotation.y };
}
function dismountBed(p) {
    if (!p.bed) return;
    p.bedPhase = 'dismount'; p.bedT = 0;
    p.bedFrom = { x: p.mover.position.x, y: p.mover.position.y, z: p.mover.position.z, tilt: p.mover.rotation.x };
}
// Instant bed release (no tween) — used when the player forcibly takes a pet over mid-nap/seat.
function forceEndBed(p) {
    const bed = p.bed;
    if (!bed) return;
    bed.occupant = null;
    p.bed = null;
    p.bedPhase = null;
    p.bedExit = false;
    p.pet.sleeping = false;
    p.mover.rotation.x = 0;
    p.mover.rotation.z = 0;
    p.mover.position.x = bed.approach.x;
    p.mover.position.z = bed.approach.z;
    p.mover.position.y = world.groundHeightAt(bed.approach.x, bed.approach.z);
}
function updateBeds(delta) {
    for (const p of pets) {
        if (!p.bed) continue;
        const bed = p.bed, lie = bed.lie;
        if (p.bedPhase === 'mount') {
            p.bedT += delta;
            const k = Math.min(1, p.bedT / 0.7);
            const e = k * k * (3 - 2 * k);
            p.mover.position.x = THREE.MathUtils.lerp(p.bedFrom.x, lie.x, e);
            p.mover.position.z = THREE.MathUtils.lerp(p.bedFrom.z, lie.z, e);
            p.mover.position.y = THREE.MathUtils.lerp(p.bedFrom.y, lie.y, e) + Math.sin(k * Math.PI) * 0.14;
            let dr = lie.rotY - p.bedFrom.rotY;
            while (dr > Math.PI) dr -= Math.PI * 2;
            while (dr < -Math.PI) dr += Math.PI * 2;
            p.mover.rotation.y = p.bedFrom.rotY + dr * e;
            p.mover.rotation.x = lie.tilt * e;
            if (k >= 1) {
                p.bedPhase = 'lying'; p.bedT = 0;
                p.pet.sleeping = bed.mode !== 'sit' && bed.mode !== 'swing' && bed.mode !== 'seesaw';   // swings/seesaws sit awake
                p.ai.state = 'busy';
                if (bed.mode === 'swing') { bed.angle = 0; bed.vel = 1.9; bed.mountedAt = Date.now(); }  // first push
                else if (bed.mode === 'seesaw') { bed.mountedAt = Date.now(); bed.body.vel += -1.0 * bed.end; }  // dip the new rider's end
            }
        } else if (p.bedPhase === 'lying') {
            p.bedT += delta;
            if (bed.mode === 'swing' || bed.mode === 'seesaw') {
                if (p.bedExit) { p.bedExit = false; dismountBed(p); }   // pose owned by updateSwings / updateSeesaws
            } else {
                if (bed.sway) p.mover.rotation.z = Math.sin(p.bedT * 1.1) * 0.07;
                const wantOff = bed.mode === 'sit' ? p.bedExit : !p.pet.sleeping;
                if (wantOff) { p.bedExit = false; dismountBed(p); }  // clicked off / woken → hop off
            }
        } else if (p.bedPhase === 'dismount') {
            p.bedT += delta;
            const k = Math.min(1, p.bedT / 0.55);
            const e = k * k * (3 - 2 * k);
            const gx = bed.approach.x, gz = bed.approach.z;
            const gy = world.groundHeightAt(gx, gz);
            p.mover.position.x = THREE.MathUtils.lerp(p.bedFrom.x, gx, e);
            p.mover.position.z = THREE.MathUtils.lerp(p.bedFrom.z, gz, e);
            p.mover.position.y = THREE.MathUtils.lerp(p.bedFrom.y, gy, e) + Math.sin(k * Math.PI) * 0.12;
            p.mover.rotation.x = p.bedFrom.tilt * (1 - e);
            p.mover.rotation.z *= (1 - e);
            if (k >= 1) {
                p.mover.rotation.x = 0; p.mover.rotation.z = 0;
                bed.occupant = null; p.bed = null; p.bedPhase = null;
                releaseAI(p);
            }
        }
    }
}

// 그네 pendulum: drives every swing seat each frame. An occupied seat (rider fully 'lying') is a
// lightly-damped driven pendulum — gravity restoring + a small pump at the bottom sustains a gentle
// arc, and the rider is glued to the seat along that same arc; after 10분 it flags a hop-off. An empty
// seat eases back to rest. The visual seat group rotates with the angle so plank/ropes/rider stay locked.
const SWING_GL = 8.2;   // effective g/L — sets the ~2.2s period
function updateSwings(delta) {
    for (const s of SWINGS) {
        const rider = s.occupant;
        const active = rider && rider.bed === s && rider.bedPhase === 'lying';
        if (active) {
            s.vel += (-SWING_GL * Math.sin(s.angle) - 0.28 * s.vel) * delta;
            if (Math.abs(s.angle) < 0.16) s.vel += Math.sign(s.vel || 1) * 1.0 * delta;   // pump at the bottom
            s.angle += s.vel * delta;
            rider.mover.position.set(
                s.pivot.x + s.axis.x * s.L * Math.sin(s.angle),
                s.pivot.y - s.L * Math.cos(s.angle) + SWING.sitLift,
                s.pivot.z + s.axis.z * s.L * Math.sin(s.angle),
            );
            rider.mover.rotation.x = -s.angle;      // lean with the swing
            rider.mover.rotation.y = s.headY;        // face forward (perpendicular to the bar)
            rider.mover.rotation.z = 0;
            if (Date.now() - s.mountedAt > SWING.rideMs) rider.bedExit = true;   // 10분 → hop off (updateBeds tweens down)
        } else {
            s.vel += (-SWING_GL * Math.sin(s.angle) - 1.6 * s.vel) * delta;   // empty: settle to rest
            s.angle += s.vel * delta;
            if (Math.abs(s.angle) < 0.002 && Math.abs(s.vel) < 0.01) { s.angle = 0; s.vel = 0; }
        }
        if (s.seat) s.seat.rotation.x = -s.angle;
    }
}

// 시소 rock: one shared tilt per plank. With ≥1 rider it rocks (driven + pumped through level, lightly
// damped); empty it settles level. Both ends ride the same angle in opposite directions, and each
// rider hops off after 10분. The plank mesh tilts by -angle, carrying its seat meshes with the riders.
const SEESAW_K = 7;
function updateSeesaws(delta) {
    for (const b of SEESAW_BODIES) {
        const riders = b.seats.filter((s) => s.occupant && s.occupant.bed === s && s.occupant.bedPhase === 'lying');
        if (riders.length) {
            b.vel += (-SEESAW_K * b.angle - 0.5 * b.vel) * delta;
            if (Math.abs(b.angle) < 0.14) b.vel += Math.sign(b.vel || -riders[0].end) * 0.8 * delta;   // pump through level
            b.angle += b.vel * delta;
            for (const s of riders) {
                const e = s.end, c = Math.cos(b.angle), sn = Math.sin(b.angle);
                s.occupant.mover.position.set(
                    b.pivot.x + b.axis.x * e * b.armLen * c,
                    b.pivot.y + e * b.armLen * sn + SEESAW.lift,
                    b.pivot.z + b.axis.z * e * b.armLen * c,
                );
                s.occupant.mover.rotation.x = -b.angle;   // rigid plank → both riders share the tilt
                s.occupant.mover.rotation.y = s.headY;
                s.occupant.mover.rotation.z = 0;
                if (Date.now() - s.mountedAt > SWING.rideMs) s.occupant.bedExit = true;   // 10분 → hop off
            }
        } else {
            b.vel += (-SEESAW_K * b.angle - 2.2 * b.vel) * delta;   // empty: settle level
            b.angle += b.vel * delta;
            if (Math.abs(b.angle) < 0.002 && Math.abs(b.vel) < 0.01) { b.angle = 0; b.vel = 0; }
        }
        if (b.plank) b.plank.rotation.x = -b.angle;
    }
}

const SLEEP_START = 22, SLEEP_END = 6;   // 밤 10시 취침, 해 뜨는 6시 기상
function isSleepTime(h) { return h >= SLEEP_START || h < SLEEP_END; }
function updateAutoSleep() {
    const h = currentHour();
    const now = Date.now();
    const sleepy = isSleepTime(h);
    for (const p of pets) {
        // Note wake transitions so a night-time click doesn't get instantly re-tucked.
        if (p.wasSleeping && !p.pet.sleeping) p.nextAutoSleepAt = now + 90000;
        p.wasSleeping = p.pet.sleeping;
        if (!sleepy && p.pet.sleeping && p.autoSlept) {          // 6시 — morning wake (beds dismount above)
            p.pet.sleeping = false;
            p.autoSlept = false;
            logWorldEvent(`${petKo(p)}가 아침에 일어났다`);
            continue;
        }
        if (p.bed) continue;
        if (!sleepy) continue;
        if (p === possessed || p.pet.sleeping || p.pet.action) continue;
        if (p.ai.state !== 'idle' && p.ai.state !== 'walk') continue;
        if (now < (p.nextAutoSleepAt || 0)) continue;
        const bed = freeBedFor(p);
        p.autoSlept = true;
        if (bed) mountBed(p, bed);
        else { p.pet.sleeping = true; logWorldEvent(`${petKo(p)}가 풀밭에서 잠들었다`); }   // both beds taken — nap on the grass
    }
}

// ---- 밥때 (meal times): at 8시·12시·18시 the pets trot to the food bowl, each picking a random
// free spot around it, face the bowl and have a couple of helpings with the shared Eat motion,
// then wander off. A serving lasts 30 minutes and each pet eats once per serving. Meals can be
// interrupted — a hug invitation mid-bite simply wins (the meal is abandoned gracefully); only
// sleep/beds/possession block getting up for food in the first place.
const MEAL_TIMES = [8, 12, 18];
const MEAL_WINDOW = 0.5;
const bowlProp = PROPS.find((p) => p.type === 'bowl');
function pickEatSpot(p) {
    for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 0.4 + Math.random() * 0.12;
        const x = bowlProp.x + Math.sin(a) * d;
        const z = bowlProp.z + Math.cos(a) * d;
        if (world.isBlocked(x, z)) continue;
        if (pets.some((q) => q !== p && q.eatSpot && Math.hypot(q.eatSpot.x - x, q.eatSpot.z - z) < 0.3)) continue;
        return { x, z };
    }
    return { x: bowlProp.x + 0.42, z: bowlProp.z };
}
async function haveMeal(p) {
    await gotoAsync(p, p.eatSpot.x, p.eatSpot.z);
    if (p.bed || p.ai.state !== 'busy') { p.eatSpot = null; return; }   // hijacked en route (hug/bed)
    p.mover.rotation.y = Math.atan2(bowlProp.x - p.mover.position.x, bowlProp.z - p.mover.position.z);
    logWorldEvent(`${petKo(p)}가 밥그릇에서 밥을 먹었다`);
    for (let i = 0; i < 2; i++) {
        if (p.bed || p.pet.sleeping || p.ai.state !== 'busy') break;
        if (p.pet.action && p.pet.action.id !== 'eat') break;           // pulled into a hug mid-bite
        p.pet.action = { id: 'eat', t: 0 };
        await sleepMs(3350);
    }
    p.eatSpot = null;
    // Only hand the AI back if the meal still owns the pet (not mid-hug someone dragged it into).
    if (p.ai.state === 'busy' && (!p.pet.action || p.pet.action.id === 'eat')) releaseAI(p);
}
function updateMeals() {
    const h = currentHour();
    const meal = MEAL_TIMES.find((m) => h >= m && h < m + MEAL_WINDOW);
    if (meal === undefined) {
        for (const p of pets) p.eatSpot = null;    // sweep spots stranded by interrupted meals
        return;
    }
    const key = `${Math.floor(Date.now() / 86400000)}-${meal}`;    // one serving per meal per day
    for (const p of pets) {
        if (p.mealDone === key) continue;
        if (p === possessed || p.bed || p.pet.sleeping || p.pet.action) continue;
        if (p.ai.state !== 'idle' && p.ai.state !== 'walk') continue;
        p.eatSpot = pickEatSpot(p);
        p.mealDone = key;
        haveMeal(p);
    }
}

// ---- 3D eat FX (월드 전용): instead of the pet-window emoji, eating in the world shows a real
// ground prop per pet — a scattered grain patch for the chick, a little kibble bowl for the puppy
// (hidden when eating at the real bowl, which IS the food there) — and the nibble particles are
// tiny 3D morsels that pop from the mouth and fall to the grass.
function makeGrainPatch() {
    const g = new THREE.Group();
    const grain = M(0xe3c368);
    for (let i = 0; i < 10; i++) {
        const k = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 5), grain);
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.08;
        k.position.set(Math.cos(a) * r, 0.011, Math.sin(a) * r);
        k.scale.y = 0.65;
        g.add(k);
    }
    return g;
}
function makeMiniBowl() {
    const g = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.055, 0.045, 16), M(0x5b8def));
    bowl.position.y = 0.022;
    g.add(bowl);
    const food = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.02, 12), M(0x8d6e5c));
    food.position.y = 0.042;
    g.add(food);
    return g;
}
const crumbs = [];
const crumbGeo = new THREE.SphereGeometry(0.016, 6, 5);
const crumbMatChick = M(0xe3c368);
const crumbMatPuppy = M(0x8d6e5c);
function spawnFoodCrumb(p) {
    const m = new THREE.Mesh(crumbGeo, p.pet.wings.length ? crumbMatChick : crumbMatPuppy);
    m.position.set(
        p.mover.position.x + Math.sin(p.mover.rotation.y) * 0.16,
        p.mover.position.y + p.height * 0.28,
        p.mover.position.z + Math.cos(p.mover.rotation.y) * 0.16
    );
    m.scale.setScalar(0.7 + Math.random() * 0.7);
    scene.add(m);
    crumbs.push({ m, vx: (Math.random() - 0.5) * 0.5, vy: 0.7 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.5, t: 0 });
}
// Water splash shares the crumb particle system — a puff of pale-blue droplets on entry/hops.
const splashMat = M(0xaadcf2);
function spawnSplash(x, y, z) {
    playSplashSound(x, z);
    for (let i = 0; i < 9; i++) {
        const m = new THREE.Mesh(crumbGeo, splashMat);
        m.position.set(x + (Math.random() - 0.5) * 0.12, y, z + (Math.random() - 0.5) * 0.12);
        m.scale.setScalar(0.8 + Math.random() * 0.9);
        scene.add(m);
        crumbs.push({ m, vx: (Math.random() - 0.5) * 1.1, vy: 1.0 + Math.random() * 0.9, vz: (Math.random() - 0.5) * 1.1, t: 0 });
    }
}
function updateCrumbs(delta) {
    for (let i = crumbs.length - 1; i >= 0; i--) {
        const c = crumbs[i];
        c.t += delta;
        c.vy -= 4.5 * delta;
        c.m.position.x += c.vx * delta;
        c.m.position.y += c.vy * delta;
        c.m.position.z += c.vz * delta;
        // Particles die on the local surface: island terrain, bridge decks, or the open sea.
        const onGround = islandOf(c.m.position.x, c.m.position.z) >= 0 || onBridge(c.m.position.x, c.m.position.z);
        const floor = onGround ? world.groundHeightAt(c.m.position.x, c.m.position.z) : OCEAN_LEVEL;
        if (c.m.position.y <= floor + 0.008 || c.t > 1.2) {
            scene.remove(c.m);
            crumbs.splice(i, 1);
        }
    }
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyPixelRatio();   // dpr can change when the window moves between displays
});

const clock = new THREE.Clock();
let lastFrameMs = 0;
// 프레임 간격 티어 (동숲 원칙 — 균일한 낮은 fps가 출렁이는 60보다 부드럽다):
//   활동(포커스 + 최근 입력, 절전 아님)   15.5ms → 60fps
//   ⚡절전/배터리                          31ms   → 30fps (⚡ 버튼 안내 문구와 일치)
//   포커스 구경(입력 12초+)               31ms   → 30fps, 60초+ 지나면 65ms → 15fps
//   비포커스(옆에 띄워두고 딴 일)          65ms   → 15fps, 말풍선·토스트 동안만 31ms
// 임계값은 120Hz ProMotion(8.3ms)과 60Hz(16.7ms) 틱의 정수배 바로 아래 — 페이싱이 균일하다
// (65 < 8.3×8=66.4, 65 < 16.7×4=66.7).
function frameIntervalMs() {
    const now = performance.now();
    if (!winFocused) return now < softWakeUntil ? 31 : 65;
    if (ecoActive()) return 31;
    if (renderIdle()) return now - lastInputMs > 60000 ? 65 : 31;
    return 15.5;
}
function animate() {
    const nowMs = performance.now();
    if (nowMs - lastFrameMs < frameIntervalMs()) return;
    lastFrameMs = nowMs;
    const delta = Math.min(clock.getDelta(), 0.1);   // clamp huge deltas after the window was hidden
    for (const p of pets) {
        updateWander(p, delta);
        updateGlbPetEntity(p.pet, delta);
        applySwimPose(p, delta);
        applyCarryPose(p, delta);
        if (p.fxUpdate) p.fxUpdate();
    }
    updatePlayer(delta);
    updateHandHold(delta);
    updateBeds(delta);
    updateSwings(delta);
    updateSeesaws(delta);
    updateHideSeek(delta);
    updateHugSpot(delta);
    updateMemorialIsland(delta);
    updateHoverPrompt(delta);
    updatePianoKeys(delta);
    updateLibrary(delta);
    updateSandPlay(delta);                   // 모래성 곁 삽질·토닥임 (자리 점유 기반)
    updateFountain(delta);
    updateFireflies(delta);
    if (Date.now() > mailPollAt) { mailPollAt = Date.now() + 20000; updateMailFlag(); }
    // 텃밭 성장 티커: gardenStageHash는 만들어졌는데 비교하는 코드가 없었다 — 씨앗이 자라도
    // (다시 클릭하기 전엔) 화면에 안 나타나던 원인. 10초마다 단계 변화를 감지해 다시 그린다.
    if (Date.now() > gardenPollAt) {
        gardenPollAt = Date.now() + 10000;
        if (gardenGroups && gardenPlots.map((pl) => gardenStage(pl)).join('') !== gardenStageHash) refreshGardenVisuals();
    }
    if (Date.now() > petSaveAt) { petSaveAt = Date.now() + 8000; savePetState(); }   // 이어하기 — pagehide가 마지막 저장을 보강
    updateDips(delta);
    updateAutoDrive(delta);
    updateBoatIdle();                        // 정박 보트의 파도 위 살랑임 (항해 중엔 stepBoat 담당)
    updateBoatHop(delta);                    // 절친 승선 아크 — 물가에서 뱃머리로 폴짝
    updateFerry(delta);                      // ⛴️ 통통호 — 정박/항해/정차 서비스
    updateFerryHop(delta);                   // 절친 갑판 승선 아크
    updateShells(delta);                     // 🐚 조개 스폰/반짝/줍기 연출
    updateBalloon(delta);                    // 🎈 열기구 — 계류 살랑임/스플라인 투어/귀환
    updateBalloonHop(delta);                 // 절친 승선 큰 아크 — 데크에서 바구니로
    updatePlaneIdle();                       // 🛩️ 주차 비행기 (물 위면 살랑임, 프로펠러 정지)
    updatePlaneHop(delta);                   // 절친 뒷좌석 승선 아크
    updatePlanePose();                       // 비행 맞바람 — 귀·날개 눕기 (엔티티 뒤 덮어쓰기)
    updateFerryPose();                       // 페리 벤치 앉기 — 다리 접기 (엔티티 뒤 덮어쓰기)
    updatePhoneCall(delta);                  // 📞 전화 안무 — 폰 위치·고개 기울임·옹알이 (엔티티 뒤)
    updateFishing(delta);                    // 🎣 낚시 안무 — 엔티티 업데이트 뒤라 포즈 덮어쓰기 가능
    updateHeartFx(delta);
    updateFestiveFx(delta);
    updateAutoSleep();
    updateMeals();
    updateCrumbs(delta);
    updateSelectRing();
    updateSfx();
    updateChatBubble();
    cloudSpin.rotation.y += delta * 0.012;   // lazy cloud drift
    updateWeather(delta);                    // eases fronts, slides the drops, times the rainbow
    updateSeasonBlend(delta);                // 계절 크로스페이드 — 전환 중에만 일한다
    updateDayNight();                        // throttled inside (repaints ~2×/min)
    maybeAutoDiary();                        // 22시 이후 하루 한 번, 그날의 그림일기를 스스로 쓴다
    updateOcean();
    if (ballFlight) {
        ballFlight.t += delta;
        const k = Math.min(1, ballFlight.t / ballFlight.dur);
        ballMesh.position.lerpVectors(ballFlight.from, ballFlight.to, k);
        ballMesh.position.y += Math.sin(k * Math.PI) * ballFlight.arc;
        if (k >= 1) { const done = ballFlight.resolve; ballFlight = null; done(); }
    }
    updateFollowCam(delta);
    if (heldZoom) camZoom(Math.pow(heldZoom < 0 ? 0.35 : 2.8, delta));   // held zoom buttons glide
    // Glide the camera distance toward the wheel/button zoom target (exponential ease-out).
    const curDist = camera.position.distanceTo(controls.target);
    if (Math.abs(curDist - zoomTargetDist) > 0.001) {
        const eased = THREE.MathUtils.lerp(curDist, zoomTargetDist, Math.min(1, delta * 9));
        const off = camera.position.clone().sub(controls.target).setLength(eased);
        camera.position.copy(controls.target).add(off);
    }
    controls.update();
    renderFrame();
}
worldBake();   // 씬이 전부 지어진 뒤 첫 베이크 — 이후엔 공사모드 종료 때마다 재베이크
renderer.setAnimationLoop(animate);
