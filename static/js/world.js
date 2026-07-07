// Pet world (월드): a small diorama scene where the GLB pets live together, opened from the tray.
// A floating grass-island stage with primitive props (data-driven so an asset kit can replace them),
// an orbit camera, and the `world` ground/blocking interface the pets query — they never assume
// flat/open ground, so later phases can swap in a heightmap (3rd-person) or voxels (sandbox).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createGlbPetEntity, updateGlbPetEntity, GLB_MOTIONS, GLB_ACCESSORIES, setGlbPetAccessory } from './glb-pet-entity.js';
import { ISLAND_R, ISLANDS, BRIDGES, HOUSE, FLAT_SPOTS, PROPS } from './world-layout.js';
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
const MOVABLE_TYPES = new Set(['tree', 'bowl', 'fence', 'sunbed', 'hammock', 'lamp', 'radio', 'coffee', 'food', 'swing', 'seesaw', 'house', 'monument', 'hugspot', 'pecktree', 'well', 'capsule']);
{
    const counts = {};
    for (const p of PROPS) {
        p.layoutId = `${p.type}-${counts[p.type] = (counts[p.type] || 0) + 1}`;
        p.def = { x: p.x, z: p.z, rotY: p.rotY || 0 };            // "전부 원위치"용 원본 좌표
        const o = MOVABLE_TYPES.has(p.type) ? savedLayout[p.layoutId] : null;
        if (o && Number.isFinite(o.x) && Number.isFinite(o.z)) {
            p.x = o.x; p.z = o.z;
            if (Number.isFinite(o.rotY)) p.rotY = o.rotY;
        }
    }
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
        new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    scene.add(sky);
}
// Sun & moon share one east→west arc (rise 6시 / set 18시 — the moon takes the night shift); both
// ignore fog so they glow through the haze. Stars sit on the upper dome, opacity driven at night.
const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd75e, fog: false })
);
scene.add(sunMesh);
const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xf2eede, fog: false })
);
scene.add(moonMesh);
let starMat = null;
{
    const pts = [];
    for (let i = 0; i < 240; i++) {
        const v = new THREE.Vector3().randomDirection();
        v.y = Math.abs(v.y) * 0.9 + 0.08;       // upper hemisphere only
        v.normalize().multiplyScalar(39);
        pts.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0, fog: false, depthWrite: false });
    scene.add(new THREE.Points(g, starMat));
}
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
    for (const d of defs) {
        const cloud = new THREE.Group();
        for (const [lx, ly, lz, lr] of [[0, 0, 0, 0.55], [0.5, 0.08, 0.1, 0.4], [-0.48, 0.05, -0.08, 0.42], [0.15, 0.3, 0, 0.35], [-0.2, 0.26, 0.12, 0.3]]) {
            const lobe = new THREE.Mesh(new THREE.SphereGeometry(lr, 18, 14), cloudMat);
            lobe.position.set(lx, ly, lz);
            lobe.scale.y = 0.62;           // squash into that puffy-flat cartoon cloud shape
            cloud.add(lobe);
        }
        cloud.position.set(Math.cos(d.a) * d.r, d.y, Math.sin(d.a) * d.r);
        cloud.scale.setScalar(d.s);
        cloudSpin.add(cloud);
    }
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

// ♡ laptop-friendly pacing: one forward pass is already cheap, so 절전 is now about *when* we
// draw, not how. Watched + plugged in → 60fps at full retina; window unfocused (the world usually
// sits beside real work) → 30fps; ⚡ eco (persisted) or on battery → 30fps at 1.5x pixels.
// 📱 폰/태블릿은 절전이 기본(30fps·1.5x — 발열·배터리). 사용자가 ⚡ 버튼으로 명시적으로 껐다면
// localStorage에 '0'이 남아 있으니 그 선택을 존중한다.
const savedEco = localStorage.getItem('world-eco');
let ecoMode = savedEco === null ? IS_TOUCH : savedEco === '1';
let onBattery = false;
let winFocused = document.hasFocus();
window.addEventListener('focus', () => { winFocused = true; });
window.addEventListener('blur', () => { winFocused = false; });
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
function renderFrame() {
    renderer.render(scene, camera);
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
const SKY_STOPS = [0, 0.45, 0.8, 1];
const SKY_DAY   = ['#4f9fe0', '#a5d5f5', '#e4f4ff', '#ffeef2'].map((c) => new THREE.Color(c));
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
    for (const l of lamps) { l.light.intensity = 6 * lampGlow; if (l.glow) l.glow.opacity = 0.9 * lampGlow; }   // the indoor reading lamp has no halo
    sunGlow.material.color.set(0xffdf8a).lerp(new THREE.Color(0xff9d5c), glow * 0.7);   // golden-hour halo
    sunGlow.material.opacity = 0.75 * (1 - 0.85 * wxF);

    // Night dresses the clouds and reveals the stars; overcast turns the clouds to slate and
    // hides the stars entirely.
    cloudMat.color.set(0x6c7ea6).lerp(new THREE.Color(0xffffff), dayF).lerp(new THREE.Color(0x66707c), wxF * 0.75);
    cloudMat.emissiveIntensity = (0.12 + 0.23 * dayF) * (1 - 0.5 * wxF);
    starMat.opacity = nightF * (0.35 + 0.55 * THREE.MathUtils.smoothstep(nightF, 0.6, 1)) * (1 - wxF);

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
const grassTex = canvasTex(128, 1, 1, (ctx, s) => {
    ctx.fillStyle = '#7cc351';
    ctx.fillRect(0, 0, s, s);
    const cell = s / 8;
    for (let r = 0; r < 8; r++) {
        for (let q = 0; q < 8; q++) {
            const x = q * cell + (r % 2 ? cell / 2 : 0);
            const y = r * cell;
            ctx.fillStyle = (r + q) % 3 ? 'rgba(255,255,255,0.10)' : 'rgba(25,75,15,0.10)';
            ctx.beginPath();
            ctx.moveTo(x + cell * 0.5, y + cell * 0.2);
            ctx.lineTo(x + cell * 0.8, y + cell * 0.64);
            ctx.lineTo(x + cell * 0.2, y + cell * 0.64);
            ctx.closePath();
            ctx.fill();
        }
    }
});
const snowGroundTex = canvasTex(128, 1, 1, (ctx, s) => {   // 겨울 설원 — grassTex와 같은 AC 삼각 패턴의 눈 팔레트판
    ctx.fillStyle = '#eef3fb';
    ctx.fillRect(0, 0, s, s);
    const cell = s / 8;
    for (let r = 0; r < 8; r++) {
        for (let q = 0; q < 8; q++) {
            const x = q * cell + (r % 2 ? cell / 2 : 0);
            const y = r * cell;
            ctx.fillStyle = (r + q) % 3 ? 'rgba(255,255,255,0.55)' : 'rgba(150,172,208,0.16)';
            ctx.beginPath();
            ctx.moveTo(x + cell * 0.5, y + cell * 0.2);
            ctx.lineTo(x + cell * 0.8, y + cell * 0.64);
            ctx.lineTo(x + cell * 0.2, y + cell * 0.64);
            ctx.closePath();
            ctx.fill();
        }
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
const plasterTex = canvasTex(64, 2, 2, (ctx, s) => {
    ctx.fillStyle = '#fff3e0';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '200,170,130' : '255,255,255'},0.10)`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5);
    }
});
const roofTex = canvasTex(64, 3, 2, (ctx, s) => {
    ctx.fillStyle = '#ef8a7a';
    ctx.fillRect(0, 0, s, s);
    const row = s / 4;
    for (let r = 0; r < 4; r++) {
        ctx.strokeStyle = 'rgba(120,40,30,0.22)';
        ctx.lineWidth = 2;
        for (let q = -1; q < 5; q++) {
            const x = q * (s / 4) + (r % 2 ? s / 8 : 0);
            ctx.beginPath();
            ctx.arc(x + s / 8, r * row, s / 8, 0, Math.PI);
            ctx.stroke();
        }
    }
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
function gradColors(g, top, bottom) {
    const pos = g.attributes.position, r = g.parameters.radius;
    const cT = new THREE.Color(top), cB = new THREE.Color(bottom), c = new THREE.Color();
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
        const t = THREE.MathUtils.clamp(pos.getY(i) / r * 0.5 + 0.5, 0, 1);
        c.copy(cB).lerp(cT, t);
        cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    return cols;
}
function gradSphereGeo(r, topHex, bottomHex) {
    const g = new THREE.SphereGeometry(r, 18, 14);
    g.setAttribute('color', new THREE.Float32BufferAttribute(gradColors(g, topHex, bottomHex), 3));
    return g;
}

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
    return null;
}
function bridgeDeckY(hit) {
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
function houseFloorY(x, z) {
    const { lx, lz } = houseLocal(x, z);
    if (Math.abs(lx) > HOUSE.hw || Math.abs(lz) > HOUSE.hd) return null;
    if (lz <= -0.25) return HOUSE.loftY;                                   // loft over the back half
    if (lx >= 0.62 && lz <= 0.55) {                                        // stair ramp along the right wall
        const k = THREE.MathUtils.clamp((0.55 - lz) / 0.8, 0, 1);
        return HOUSE.floorY + k * (HOUSE.loftY - HOUSE.floorY);
    }
    return HOUSE.floorY;
}
function houseBlocked(x, z) {
    const { lx, lz } = houseLocal(x, z);
    if (Math.abs(lx) > HOUSE.hw + 0.1 || Math.abs(lz) > HOUSE.hd + 0.1) return false;
    if (Math.abs(lx) > HOUSE.hw - 0.06) return true;                       // side walls
    if (lz < -(HOUSE.hd - 0.06)) return true;                              // back wall
    if (lz > -0.31 && lz < -0.19 && lx < 0.55) return true;                // loft railing / under-loft partition
    if (Math.hypot(lx - 0.8, lz - 0.74) < 0.09) return true;               // porch posts
    if (Math.hypot(lx + 0.8, lz - 0.74) < 0.09) return true;
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
        let h = 0.05 * Math.sin(x * 1.7 + 1.3) * Math.sin(z * 1.9 - 0.7)
              + 0.04 * Math.sin((x + z) * 1.1 + 2.1) + 0.045;
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
    const rings = Math.max(16, Math.round(isl.r * 6.5));
    const segs = Math.max(48, Math.round(isl.r * 18));
    const positions = [], colors = [], uvs = [], indices = [];
    const base = new THREE.Color(0.93, 0.95, 0.88), light = new THREE.Color(1.07, 1.1, 1.0);
    const c = new THREE.Color();
    for (let i = 0; i <= rings; i++) {
        const r = (i / rings) * isl.r;
        for (let j = 0; j < segs; j++) {
            const a = (j / segs) * Math.PI * 2;
            const x = isl.x + Math.cos(a) * r, z = isl.z + Math.sin(a) * r;
            const y = terrainHeight(x, z);
            positions.push(x, y, z);
            uvs.push(x * 0.8, z * 0.8);                 // planar world mapping — pattern flows across islands
            const patch = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
            c.copy(base).lerp(light, Math.min(1, patch * 0.45 + y * 2.2));
            colors.push(c.r, c.g, c.b);
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
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const grass = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: grassTex, vertexColors: true, roughness: 1, metalness: 0 }));
    grass.receiveShadow = true;
    stage.add(grass);
    seasonGrass.push(grass);   // the season system re-tints this (and snow-swaps its texture)

    const pts = [
        new THREE.Vector2(isl.r, 0.004),
        new THREE.Vector2(isl.r * 0.995, -0.12),
        new THREE.Vector2(isl.r * 0.93, -0.42),
        new THREE.Vector2(isl.r * 0.72, -0.78),
        new THREE.Vector2(isl.r * 0.42, -1.0),
        new THREE.Vector2(0.05, -1.14),
    ];
    const cliff = new THREE.Mesh(
        new THREE.LatheGeometry(pts, Math.max(48, Math.round(isl.r * 14))),
        new THREE.MeshStandardMaterial({ map: strataTex, roughness: 1, metalness: 0, flatShading: true })
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
const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, ...extra });
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

function makeHouse() {
    // Two-story dollhouse: the front stays open so the camera sees inside. Geometry matches the
    // walk-space helpers exactly — floor at 0.05, stair ramp along the right wall, loft at 0.62
    // over the back half with a railing (gap where the stairs land).
    const g = new THREE.Group();
    const plaster = M(0xffffff, { map: plasterTex });
    const wood = M(0xb08a60, { map: woodTex });
    const woodDark = M(0x8a6647, { map: woodTex });
    const wallH = 1.2;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 1.6), wood);
    floor.position.y = 0.02;
    g.add(floor);
    const porch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.24), M(0xcfcac0));
    porch.position.set(0, 0.025, 0.9);
    g.add(porch);
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(0.06, wallH, 1.6), plaster);
    wallL.position.set(-1.0, wallH / 2, 0);
    g.add(wallL);
    const wallR = wallL.clone();
    wallR.position.x = 1.0;
    g.add(wallR);
    const wallB = new THREE.Mesh(new THREE.BoxGeometry(2.06, wallH, 0.06), plaster);
    wallB.position.set(0, wallH / 2, -0.8);
    g.add(wallB);
    for (const px of [-0.8, 0.8]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, wallH, 10), wood);
        post.position.set(px, wallH / 2, 0.74);
        g.add(post);
    }
    for (const sx of [-1, 1]) {
        const frame = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.26, 0.26, 2, 0.02), M(0xffffff));
        frame.position.set(sx * 1.01, 0.62, 0.3);
        g.add(frame);
        const pane = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.2, 0.2), M(0xbfe3f2));
        pane.position.copy(frame.position);
        g.add(pane);
    }
    // loft slab (top at 0.62), stairs, railing, under-loft partition
    const loft = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.55), wood);
    loft.position.set(0, 0.59, -0.525);
    g.add(loft);
    const STEPS = 8;
    for (let i = 0; i < STEPS; i++) {
        const h = 0.05 + ((i + 1) / STEPS) * 0.57;
        const stp = new THREE.Mesh(new THREE.BoxGeometry(0.34, h, 0.1), woodDark);
        stp.position.set(0.78, h / 2, 0.55 - (i + 0.5) * 0.1);
        g.add(stp);
    }
    for (let i = 0; i <= 5; i++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.28, 8), wood);
        post.position.set(-0.95 + i * 0.3, 0.76, -0.25);
        g.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.04, 0.05), wood);
    rail.position.set(-0.2, 0.9, -0.25);
    g.add(rail);
    const partition = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.56, 0.05), plaster);
    partition.position.set(-0.22, 0.33, -0.25);
    g.add(partition);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.72, 0.72, 4), M(0xffffff, { map: roofTex, flatShading: true }));
    roof.position.y = wallH + 0.36;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    const roofSnow = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.46, 4), snowCapMat);   // 겨울 지붕 눈이불 — 지붕보다 완만한 경사라 어디서나 살짝 도드라진다
    roofSnow.position.y = wallH + 0.53;
    roofSnow.rotation.y = Math.PI / 4;
    roofSnow.visible = false;
    g.add(roofSnow);
    seasonSnowCaps.push(roofSnow);
    const chimney = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.34, 0.16, 3, 0.02), M(0xc97b6e));
    chimney.position.set(-0.55, wallH + 0.5, -0.35);
    g.add(chimney);
    // ---- floor-1 furniture: sofa (sit here!), low table + reading lamp, rug, bookshelf ----
    const sofa = new THREE.Group();
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.16, 0.6, 3, 0.04), M(0x8fb7e8));
    seat.position.y = 0.13;
    sofa.add(seat);
    const backRest = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.3, 0.6, 3, 0.04), M(0x7aa6dc));
    backRest.position.set(-0.12, 0.2, 0);
    sofa.add(backRest);
    for (const az of [-0.27, 0.27]) {
        const arm = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.1, 0.08, 2, 0.03), M(0x7aa6dc));
        arm.position.set(0, 0.22, az);
        sofa.add(arm);
    }
    sofa.position.set(-0.68, 0.05, 0.2);
    g.add(sofa);
    const table = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.035, 18), wood);
    top.position.y = 0.16;
    table.add(top);
    const legT = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.15, 10), woodDark);
    legT.position.y = 0.075;
    table.add(legT);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.1, 10), M(0x5a6a75));
    lampBase.position.y = 0.23;
    table.add(lampBase);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.08, 12, 1, true), lampGlobeMat);
    shade.position.y = 0.31;
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
    diaryBook.position.set(0.105, 0.185, 0.03);
    diaryBook.rotation.y = -0.5;
    table.add(diaryBook);
    table.position.set(0, 0.05, 0.15);
    g.add(table);
    const rug = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.012, 24), M(0xf6d7b0));
    rug.position.set(-0.15, 0.056, 0.22);
    g.add(rug);
    const shelf = new THREE.Group();
    const shelfBody = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.5, 0.34, 2, 0.02), woodDark);
    shelfBody.position.y = 0.25;
    shelf.add(shelfBody);
    const bookColors = [0xef8a8a, 0x8fb7e8, 0xffd54f, 0x9fd8c9, 0xb39ddb, 0xff8a65];
    for (let i = 0; i < 6; i++) {
        const book = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.035), M(bookColors[i]));
        book.position.set(0.055, 0.32 - (i % 2) * 0.14, -0.12 + (i % 3) * 0.1);
        shelf.add(book);
    }
    shelf.position.set(-0.78, 0.05, 0.52);
    g.add(shelf);
    // ---- loft furniture: bed (sleep here!) + nightstand ----
    const bed = new THREE.Group();
    const bedFrame = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.1, 0.66, 3, 0.03), woodDark);
    bedFrame.position.y = 0.07;
    bed.add(bedFrame);
    const mattress = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.08, 0.6, 3, 0.03), M(0xffffff));
    mattress.position.y = 0.14;
    bed.add(mattress);
    const blanket = new THREE.Mesh(new RoundedBoxGeometry(0.41, 0.05, 0.34, 3, 0.02), M(0xff8fb3));
    blanket.position.set(0, 0.17, 0.12);
    bed.add(blanket);
    const pillow = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.06, 0.14, 2, 0.025), M(0xfff3e0));
    pillow.position.set(0, 0.19, -0.2);
    bed.add(pillow);
    bed.position.set(-0.45, 0.62, -0.5);
    g.add(bed);
    const stand = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.16, 0.14, 2, 0.02), woodDark);
    stand.position.set(0.05, 0.7, -0.62);
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
        M(0x6ec6e8, { transparent: true, opacity: 0.68 })   // see the sandy basin + paddling feet
    );
    water.position.y = 0.038;
    g.add(water);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.014, 16), M(0x66bb6a));
    pad.position.set(0.16, 0.066, -0.12);
    g.add(pad);
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), M(0xff8fb3));
    bloom.position.set(0.16, 0.085, -0.12);
    g.add(bloom);
    const stoneM = M(0xb9b2a6);
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
// ---- 상호작용: 공용 양피지 다이얼로그 + 소원/캡슐 저장 (서버 config/*.json — 일기와 같은 방식) ----
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
const PROP_CLICKS = { pecktree: onPeckTreeClick, well: () => openWellPanel(), capsule: () => openCapsulePanel() };
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
fetchCapsules();   // 부팅 시 한 번 — 개봉 알림용

const PROP_BUILDERS = { tree: makeTree, rock: (p) => kitProp(p.variant || 'rock_largeA', { scale: p.kitScale || 0.6 }), house: makeHouse, bowl: makeBowl, fence: makeFence, pond: makePond, sunbed: makeSunbed, hammock: makeHammock, swing: makeSwing, seesaw: makeSeesaw, lamp: makeLamp, radio: makeRadio, coffee: makeCoffeeBooth, food: makeFoodBooth, monument: makeMonument, hugspot: makeHugSpot, pecktree: makePeckTree, well: makeWell, capsule: makeCapsule };
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
const BLOB_SIZE = { tree: 0.55, bowl: 0.42, sunbed: 0.85, hammock: 0.9, swing: 1.3, seesaw: 1.5, lamp: 0.3, radio: 0.42, coffee: 1.0, food: 1.0, monument: 0.62, pecktree: 0.55, well: 0.75, capsule: 0.5 };
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
for (const p of PROPS) {
    const obj = PROP_BUILDERS[p.type](p);
    p.obj = obj;                                     // 🔨 공사모드가 이 그룹을 집어 옮긴다
    obj.position.set(p.x, terrainHeight(p.x, p.z), p.z);
    obj.rotation.y = p.rotY || 0;
    if (p.scale) obj.scale.setScalar(p.scale);   // layout data may size a prop (kit variants etc.)
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    stage.add(obj);
    if (BLOB_SIZE[p.type] || p.type === 'house') {
        const blob = new THREE.Mesh(blobGeo, blobMat);
        if (p.type === 'house') blob.scale.set(2.4, 1, 2.0);   // shade peeking out around the slab rim
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
    fCol(-0.68, 0.2, 0.28);    // sofa
    fCol(0, 0.15, 0.24);       // table
    fCol(-0.78, 0.52, 0.17);   // bookshelf
    fCol(-0.45, -0.5, 0.3);    // loft bed
    fCol(0.05, -0.62, 0.11);   // nightstand
    const sofaW = houseWorld(-0.68, 0.2), sofaA = houseWorld(-0.28, 0.58);
    const sofa = {
        id: 'sofa', mode: 'sit', occupant: null, sway: 0,
        lie: { x: sofaW.x, z: sofaW.z, y: HOUSE.floorY + 0.17, rotY: HOUSE.rotY + Math.PI / 2, tilt: -0.35 },
        approach: { x: sofaA.x, z: sofaA.z },
    };
    BEDS.push(sofa);
    HOUSE_DERIVED.beds.push({ entry: sofa, lx: -0.68, lz: 0.2, alx: -0.28, alz: 0.58 });
    const bedW = houseWorld(-0.45, -0.5), bedA = houseWorld(0.3, -0.45);
    const loftbed = {
        id: 'loftbed', mode: 'sleep', occupant: null, sway: 0,
        lie: { x: bedW.x, z: bedW.z, y: HOUSE.loftY + 0.16, rotY: HOUSE.rotY, tilt: -1.2 },
        approach: { x: bedA.x, z: bedA.z },
    };
    BEDS.push(loftbed);
    HOUSE_DERIVED.beds.push({ entry: loftbed, lx: -0.45, lz: -0.5, alx: 0.3, alz: -0.45 });
    const lampW = houseWorld(0, 0.15);
    const indoor = new THREE.PointLight(0xffd9a0, 0, 2.4, 2);
    indoor.position.set(lampW.x, HOUSE.floorY + 0.42, lampW.z);
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
    const lampW = houseWorld(0, 0.15);
    HOUSE_DERIVED.light.position.set(lampW.x, HOUSE.floorY + 0.42, lampW.z);
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
    stage.add(buildRibbon(loopPts, ROAD_W, true));
    // Spokes from the plaza edge out just past the loop
    for (const a of SPOKE_ANGLES) {
        const dx = Math.sin(a), dz = Math.cos(a);
        const pts = [];
        for (let t = PLAZA_R - 0.15; t <= 3.4; t += 0.3) pts.push({ x: dx * t, z: dz * t });
        stage.add(buildRibbon(pts, ROAD_W * 0.85, false));
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
        const N = 10;
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

    const tufts = spots(380, 0.45);
    const tuftMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.022, 0.1, 5), M(0x5fae44), tufts.length);
    tufts.forEach((s, i) => {
        dummy.position.set(s.x, terrainHeight(s.x, s.z) + 0.04, s.z);
        dummy.rotation.set(rnd(-0.16, 0.16), rnd(0, Math.PI), rnd(-0.16, 0.16));
        dummy.scale.setScalar(rnd(0.7, 1.5));
        dummy.updateMatrix();
        tuftMesh.setMatrixAt(i, dummy.matrix);
    });
    tuftMesh.castShadow = true;
    stage.add(tuftMesh);

    const petals = [0xff8fb3, 0xffd54f, 0xffffff, 0xb39ddb, 0xff8a65];
    const blooms = spots(75, 0.5);
    const stemMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.01, 0.09, 6), M(0x4e9a3d), blooms.length);
    const headMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.028, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), blooms.length);
    blooms.forEach((s, i) => {
        const y = terrainHeight(s.x, s.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(rnd(0.8, 1.3));
        dummy.position.set(s.x, y + 0.045, s.z);
        dummy.updateMatrix();
        stemMesh.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s.x, y + 0.095, s.z);
        dummy.updateMatrix();
        headMesh.setMatrixAt(i, dummy.matrix);
        headMesh.setColorAt(i, new THREE.Color(petals[i % petals.length]));
    });
    headMesh.castShadow = true;
    stage.add(stemMesh);
    stage.add(headMesh);

    const pebbles = spots(46, 0.5);
    const pebbleMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.045, 0), M(0xbdb7ab), pebbles.length);
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
let oceanPos = null;         // live position attribute, y-animated every frame
let oceanXZ = null;          // per-vertex [x, z, horizonFade] — precomputed once
{
    const inner = ISLAND_R * 0.81, outer = 40, rings = 40, segs = 112;
    const positions = [], indices = [];
    oceanXZ = [];
    for (let i = 0; i <= rings; i++) {
        const r = inner * Math.pow(outer / inner, i / rings);
        for (let j = 0; j < segs; j++) {
            const a = (j / segs) * Math.PI * 2;
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            positions.push(x, OCEAN_LEVEL, z);
            oceanXZ.push(x, z, 1 - THREE.MathUtils.smoothstep(r, 24, 36));
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
    geo.setIndex(indices);
    geo.computeVertexNormals();
    seaMat = new THREE.MeshPhongMaterial({
        color: 0x3fa9d0, specular: 0x99ddff, shininess: 42,
        transparent: true, opacity: 0.85,     // glassy: the submerged cliff + swimmers show through
    });
    oceanMesh = new THREE.Mesh(geo, seaMat);
    oceanMesh.receiveShadow = true;
    scene.add(oceanMesh);
    oceanPos = geo.attributes.position;

    for (const isl of ISLANDS) {
        for (let i = 0; i < 2; i++) {
            const foam = new THREE.Mesh(
                new THREE.RingGeometry(isl.r * 0.82, isl.r * 0.93, 96),
                new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false })
            );
            foam.rotation.x = -Math.PI / 2;
            foam.position.set(isl.x, OCEAN_LEVEL + 0.035, isl.z);
            scene.add(foam);
            foamRings.push(foam);
        }
    }
    updateDayNight(true);            // tint the fresh sea/foam for the current hour
}

let oceanT = 0;
function updateOcean(delta) {
    if (!oceanPos) return;
    oceanT += delta;
    const t = oceanT;
    const arr = oceanPos.array;
    for (let v = 0, n = oceanXZ.length / 3; v < n; v++) {
        const fade = oceanXZ[v * 3 + 2];
        if (fade === 0) continue;                     // flat past the horizon fade — skip the math
        const x = oceanXZ[v * 3], z = oceanXZ[v * 3 + 1];
        arr[v * 3 + 1] = OCEAN_LEVEL + fade * (
            0.045 * Math.sin(x * 0.9 + t * 0.9)
          + 0.038 * Math.sin(z * 1.15 - t * 0.75)
          + 0.028 * Math.sin((x * 0.55 + z * 0.83) * 1.6 + t * 1.35)
          + 0.012 * Math.sin(x * 3.1 - z * 2.3 + t * 2.4)
        );
    }
    oceanPos.needsUpdate = true;
    oceanMesh.geometry.computeVertexNormals();
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
const WX_AREA_R = 12.5, WX_TOP = 8.5, WX_H = 9.5;   // drop cylinder: covers all three islands
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
scene.add(lightningLight);
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
    wxTime.value += delta;
    const rainy = wxKind === 'rain' || wxKind === 'storm';
    rainPts.visible = rainy && wxF > 0.02;
    snowPts.visible = wxKind === 'snow' && wxF > 0.02;
    rainPts.material.opacity = (0.55 + 0.25 * stormF) * wxF;   // 뇌우엔 빗발이 좀 더 굵다
    snowPts.material.opacity = 0.9 * wxF;
    setRainHiss(rainy ? (0.06 + 0.045 * stormF) * wxF : 0);
    updateLightning(delta);
    updateAurora(delta);
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

for (const def of PETS) {
    const mover = new THREE.Group();
    mover.position.set(def.spawn.x, world.groundHeightAt(def.spawn.x, def.spawn.z), def.spawn.z);
    scene.add(mover);
    createGlbPetEntity(def.url, { targetHeight: def.height, parent: mover }).then(pet => {
        mover.rotation.y = Math.random() * Math.PI * 2;      // face somewhere, after limb classification
        pet.action = { id: 'wave', t: 0 };                    // greet on moving in
        const entry = { name: def.name, speed: def.speed, height: def.height, pet, mover, ai: makeWanderAI() };
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
        if (ai.waypoints && ai.waypoints.length > 1) { ai.waypoints.shift(); return; }
        ai.state = 'idle'; ai.wait = 2 + Math.random() * 4;
        if (Math.random() < 0.22) pet.action = { id: Math.random() < 0.5 ? 'happy' : 'think', t: 0 };  // arrival flourish
    } else if (res === 'blocked') {
        ai.state = 'idle'; ai.wait = 0.5 + Math.random();              // grazed a prop en route — re-plan
    }
}

// Cross-island trips are routed through the right bridge (each satellite has exactly one), so a
// straight-line steer never tries to cross open water.
function buildRoute(from, to) {
    const a = islandOf(from.x, from.z), b = islandOf(to.x, to.z);
    if (a === b || a === -1 || b === -1) return [{ x: to.x, z: to.z }];
    const route = [];
    if (a !== 0) { const br = BRIDGES[a - 1]; route.push({ ...br.outer }, { ...br.inner }); }
    if (b !== 0) { const br = BRIDGES[b - 1]; route.push({ ...br.inner }, { ...br.outer }); }
    route.push({ x: to.x, z: to.z });
    return route;
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
        if (p) setGlbPetAccessory(p.pet, (p.pet.accessory && p.pet.accessory.id === a.id) ? null : a.id);
    };
    motionMenu.appendChild(item);
    accessoryItems.push({ el: item, acc: a });
}
function showMenu(x, y, p) {
    menuPet = p;
    controlItem.textContent = (p === possessed) ? '🎮 조종 해제 (Esc)' : '🎮 조종하기';
    for (const { el, acc } of accessoryItems) {
        el.textContent = (p.pet.accessory && p.pet.accessory.id === acc.id) ? `${acc.label} 벗기` : acc.label;
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
let buildMode = false;
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
    if (!pressAt) return;
    const moved = Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y);
    const held = performance.now() - pressAt.t;
    pressAt = null;
    const slop = e.pointerType === 'touch' ? 13 : 6;   // 손가락은 마우스보다 떨림이 커서 탭 판정을 넉넉히
    if (moved > slop || held > 400) return;
    if (buildMode) { buildSelect(null); return; }   // 🔨 빈 곳 탭 = 선택 해제 (사물은 pointerdown이 잡음) · 펫 메뉴는 잠금
    pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    for (const p of pets) {
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
    // 추억의 섬 소품 (쪼아쪼아나무·소원우물·타임캡슐): 클릭/탭으로 상호작용 — 드래그는 위의
    // slop 판정에서 이미 걸러졌으니 좌클릭 탭도 카메라와 안 싸운다.
    for (const pr of PROPS) {
        if (!PROP_CLICKS[pr.type] || !pr.obj) continue;
        if (raycaster.intersectObject(pr.obj, true).length) {
            PROP_CLICKS[pr.type](pr);
            return;
        }
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
    if (id === 'hug' || id === 'play') {
        if (p === possessed) releasePossession();          // hand the pet back to its AI for the duo
        (id === 'hug' ? worldHug : worldPlay)(p);
        return;
    }
    if (id === 'wave') petVoice(p);                       // 인사엔 목소리도 함께
    p.pet.action = { id, t: 0 };
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
const HIDE_OCCLUDERS = { tree: 0.42, house: 1.15, coffee: 0.5, food: 0.5, swing: 0.5, seesaw: 0.55, fence: 0.5, radio: 0.3, monument: 0.3, pecktree: 0.42, well: 0.42 };
const HIDE_STANDOFF  = { tree: 0.75, house: 1.6, coffee: 0.85, food: 0.85, swing: 0.85, seesaw: 0.9, fence: 0.8, radio: 0.55, monument: 0.62, pecktree: 0.75, well: 0.8 };
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
const PROP_KO = { tree: '나무', house: '집', bowl: '밥그릇', fence: '울타리', pond: '연못', sunbed: '선베드', hammock: '해먹', lamp: '가로등', radio: '라디오', coffee: '커피 부스', food: '간식 부스', swing: '그네', seesaw: '시소', monument: '베프 기념비', hugspot: '포옹 포인트', pecktree: '쪼아쪼아 나무', well: '소원 우물', capsule: '타임캡슐' };
function describeSpot(x, z) {
    const hf = houseFloorY(x, z);
    if (hf !== null) return hf > HOUSE.floorY + 0.3 ? '집 2층' : '집 안';
    if (onBridge(x, z)) return '다리 위';
    let best = null, bestD = Infinity;
    for (const q of PROPS) {
        const d = Math.hypot(x - q.x, z - q.z) - q.r;
        if (d < bestD) { bestD = d; best = q; }
    }
    if (best && bestD < 0.8) return `${PROP_KO[best.type] || best.type} 근처`;
    if (Math.hypot(x, z) < 1.8) return '중앙 광장';
    const idx = islandOf(x, z);
    if (idx === 0) return '본섬 풀밭';
    if (idx === 1) return '북동섬';
    if (idx === 2) return '남서섬';
    return '바다';
}
const BED_KO = { sunbed: '선베드', hammock: '해먹', swing: '그네', seesaw: '시소', sofa: '소파', loftbed: '2층 침대' };
function petStatusLine(p) {
    const pos = p.mover.position;
    const parts = [`위치: ${describeSpot(pos.x, pos.z)}`];
    if (carDrive && carDrive.driver === p) parts.push('스포츠카 운전 중');
    else if (carDrive && carDrive.passenger === p) parts.push('스포츠카 조수석에 타는 중');
    else if (p.bed && p.bedPhase === 'lying') {
        const ko = BED_KO[p.bed.id] || p.bed.id;
        parts.push(p.bed.mode === 'swing' || p.bed.mode === 'seesaw' ? `${ko} 타는 중`
            : p.bed.mode === 'sit' ? `${ko}에 앉아 있음` : `${ko}에 누워 있음`);
    }
    else if (p.swimming) parts.push(p.swimming === 'pond' ? '연못에서 수영 중' : '바다에서 수영 중');
    else if (p.dip) parts.push('물놀이 하러 가는 중');
    else if (p.eatSpot) parts.push('밥그릇에서 밥 먹는 중');
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
    // 섬 안(가장자리 여유 포함)이어야 하고 — 다리 위·바다는 불가
    if (!ISLANDS.some((isl) => Math.hypot(x - isl.x, z - isl.z) < isl.r - Math.min(pr * 0.6, 0.5) - 0.12)) return false;
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
        if (!q.obj || !(MOVABLE_TYPES.has(q.type) || q.type === 'car')) continue;
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
    const r = (buildSel.type === 'car' ? CAR.heading : (buildSel.rotY || 0)) + Math.PI / 4;
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
        buildSelect(null);
        buildBar.style.display = 'flex';
        showToast('🔨 사물을 끌어서 옮기세요 — 놓을 곳이 빨간 링이면 못 놓아요');
    } else {
        endBuildDrag(false);
        buildSelect(null);
        buildBar.style.display = 'none';
        saveLayout();
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
        if (!q.layoutId || !(MOVABLE_TYPES.has(q.type) || q.type === 'car')) continue;
        out[q.layoutId] = {
            x: +q.x.toFixed(3), z: +q.z.toFixed(3),
            rotY: +(((q.type === 'car' ? CAR.heading : q.rotY) || 0)).toFixed(3),
        };
    }
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
};
const stepBuffers = { grass: [], road: [], wood: [] };

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
            stepBuffers[key].push(synthNoiseBuffer(key === 'grass' ? 0.16 : 0.11, (t) => Math.pow(1 - t, key === 'road' ? 3 : 2)));
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
    const filt = surface === 'grass' ? 2600 : surface === 'wood' ? 2000 : 0;
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
        if (possessed) giveDrink(possessed, d);
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
        if (possessed) giveFood(possessed, f);
        foodPanel.style.display = 'none';
    };
    foodGrid.appendChild(item);
}
document.body.appendChild(foodPanel);
function toggleFoodPanel() {
    foodPanel.style.display = (foodPanel.style.display === 'none' || !foodPanel.style.display) ? 'block' : 'none';
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
    goto: new Set(['plaza', 'house', 'pond', 'bowl', 'coffee', 'snack', 'radio', 'swing', 'seesaw', 'sunbed', 'hammock', 'friend', 'monument', 'hugspot', 'pecktree', 'well', 'capsule']),
    mount: new Set(['swing', 'seesaw', 'sofa', 'sunbed', 'hammock', 'loftbed']),
    drink: new Set(DRINKS.map((d) => d.id)),
    snack: new Set(FOODS.map((f) => f.id)),
    hat: new Set([...GLB_ACCESSORIES.map((a) => a.id), 'off']),
    swim: new Set(['pond', 'sea']),
    drive: new Set(['car']),
    game: new Set(['hideseek']),
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
const GOTO_PROP_TYPE = { pond: 'pond', bowl: 'bowl', coffee: 'coffee', snack: 'food', radio: 'radio', swing: 'swing', seesaw: 'seesaw', sunbed: 'sunbed', hammock: 'hammock', monument: 'monument', hugspot: 'hugspot', pecktree: 'pecktree', well: 'well', capsule: 'capsule' };
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
    actionBtn('✋', 48, () => doInteract());                      // Ctrl/⌘ — 독(📷) 버튼과 같은 크기
    actionBtn('🦘', 48, () => doJump());                          // Space
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
        : `🎮 ${p.name === 'chick' ? '병아리' : '강아지'} 조종 중 — 방향키 이동 · Space 점프 · Esc 해제`;
    controlHint.style.display = 'block';
    if (touchUI) touchUI.style.display = 'block';
}
function releasePossession() {
    if (!possessed) return;
    const p = possessed;
    possessed = null;
    airborne = false; jumpVy = 0;
    seaHop = null;
    if (carDrive) exitCar();
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
    if (!possessed || airborne) return;
    airborne = true;
    jumpVy = possessed.swimming ? 1.7 : 2.5;                      // splash-hop in water
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
    if (possessed.swimming === 'sea') {
        const pos = possessed.mover.position;
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
    if (handHold) { releaseHandHold(); return; }
    if (tryGrabHand()) return;
    const bed = !possessed.bed && nearestFreeBed(possessed, 0.95);
    if (bed) { mountBed(possessed, bed); return; }
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
        // Streetlamp brightness now lives on the lamps: cycle it in steps at the lamp (persisted).
        const steps = [0, 0.25, 0.5, 0.75, 1];
        const idx = steps.findIndex((s) => Math.abs(s - lampBrightness) < 0.125);
        lampBrightness = steps[(idx + 1) % steps.length];
        try { localStorage.setItem('worldLampBrightness', String(lampBrightness)); } catch (err) {}
        updateDayNight(true);
    }
}
window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;        // typing in the chat bar
    if (e.key === 'Escape') { if (buildMode) { setBuildMode(false); return; } escapeAction(); return; }   // 🔨 공사 중 Esc = 공사 종료(저장)
    if (!possessed) return;
    if (ARROW_KEYS.includes(e.key)) { heldKeys.add(e.key); e.preventDefault(); }
    else if (e.code === 'Space') { e.preventDefault(); doJump(); }
    else if (e.key === 'Shift') {
        e.preventDefault();
        running = !running;                                       // 🚶 ↔ 🏃
    }
    else if (e.key === 'Control' || e.key === 'Meta') { e.preventDefault(); doInteract(); }
});
window.addEventListener('keyup', (e) => { heldKeys.delete(e.key); });
window.addEventListener('blur', () => { heldKeys.clear(); resetTouchStick(); });   // 앱 전환 시 스틱도 초기화

// Swimming (조종 전용): the player pet may wade into the pond or dive off the rim into the sea —
// the wander AI never does (world.isBlocked still fences it). Support height decides the medium;
// in water the pet floats half-submerged with a gentle bob, leans forward and paddles.
const pondPropRef = PROPS.find((q) => q.type === 'pond');
const POND_WATER_Y = terrainHeight(pondPropRef.x, pondPropRef.z) + 0.06;
const SWIM_LEASH = 13;                           // roomy enough to reach the satellite islands
let seaHop = null;                               // climb-back tween { fx,fy,fz, tx,ty,tz, t }

function playerBlocked(nx, nz) {
    if (Math.hypot(nx, nz) > SWIM_LEASH) return true;
    for (const q of PROPS) {
        if (q.type === 'pond') continue;                          // the pond is swimmable
        if (Math.hypot(nx - q.x, nz - q.z) < q.r) return true;
    }
    return false;                                                 // no rim fence — diving is allowed
}
function playerSupportY(p, x, z) {
    if (Math.hypot(x - pondPropRef.x, z - pondPropRef.z) < 0.55) {
        return { y: POND_WATER_Y - p.height * 0.45, medium: 'pond' };
    }
    const hf = houseFloorY(x, z);
    if (hf !== null) return { y: hf, medium: 'land' };
    const hit = onBridge(x, z);
    if (hit) return { y: bridgeDeckY(hit), medium: 'land' };
    for (const s of ISLANDS) {
        if (Math.hypot(x - s.x, z - s.z) < s.r - 0.05) {
            return { y: terrainHeight(x, z), medium: 'land' };
        }
    }
    return { y: OCEAN_LEVEL + 0.02 - p.height * 0.45, medium: 'sea' };
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
        if (k >= 1) { seaHop = null; p.swimming = false; p.mover.rotation.x = 0; airborne = false; jumpVy = 0; }
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
            const step = p.speed * (p.swimming ? 1.05 : run ? 3.0 : 1.5) * delta;   // 달리기 = 걷기 ×2
            const nx = p.mover.position.x + dir.x * step;
            const nz = p.mover.position.z + dir.z * step;
            if (!playerBlocked(nx, nz)) {
                const stepGy = world.groundHeightAt(nx, nz);
                const curGy = world.groundHeightAt(p.mover.position.x, p.mover.position.z);
                if (p.swimming || airborne || Math.abs(stepGy - curGy) <= 0.26) {   // ledges need the stairs
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
            airborne = false; jumpVy = 0;
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
function animate() {
    // Adaptive pacing: 60fps while watched (focused, on mains), 30fps ambient — unfocused beside
    // real work, ⚡ eco, or on battery. Thresholds sit safely under whole ticks of both 120Hz
    // ProMotion (8.3ms) and 60Hz (16.7ms) panels, so no panel skips more than intended.
    const nowMs = performance.now();
    if (nowMs - lastFrameMs < (winFocused && !ecoActive() ? 15.5 : 31)) return;
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
    updateDips(delta);
    updateAutoDrive(delta);
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
    updateOcean(delta);
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
renderer.setAnimationLoop(animate);
