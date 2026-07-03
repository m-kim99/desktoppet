// Pet world (월드): a small diorama scene where the GLB pets live together, opened from the tray.
// A floating grass-island stage with primitive props (data-driven so an asset kit can replace them),
// an orbit camera, and the `world` ground/blocking interface the pets query — they never assume
// flat/open ground, so later phases can swap in a heightmap (3rd-person) or voxels (sandbox).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createGlbPetEntity, updateGlbPetEntity, GLB_MOTIONS, GLB_ACCESSORIES, setGlbPetAccessory } from './glb-pet-entity.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // gentle filmic rolloff — pastels stay soft
renderer.toneMappingExposure = 1.12;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
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
camera.position.set(0, 2.4, 5.2);
camera.lookAt(0, 0.4, 0);

// Lights: hemisphere fill (sky blue above, grass green below) + a shadow-casting sun
const hemiLight = new THREE.HemisphereLight(0xcfe6ff, 0x8fca62, 0.85);
scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.7);   // warm afternoon sun
sunLight.position.set(4, 7, 3);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -6;
sunLight.shadow.camera.right = 6;
sunLight.shadow.camera.top = 6;
sunLight.shadow.camera.bottom = -6;
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

function currentHour() {
    if (!Number.isNaN(HOUR_OVERRIDE)) return ((HOUR_OVERRIDE % 24) + 24) % 24;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}
// 1 = full day, 0 = full night; ramps over 5→7시 (sunrise) and 17→19시 (sunset).
function dayFactor(h) {
    if (h < 5 || h >= 19) return 0;
    if (h < 7) return THREE.MathUtils.smoothstep(h, 5, 7);
    if (h < 17) return 1;
    return 1 - THREE.MathUtils.smoothstep(h, 17, 19);
}
// Golden-hour glow peaking exactly at 6시 and 18시.
function duskGlow(h) {
    return Math.min(1, Math.max(0, 1 - Math.abs(h - 6) / 1.3) + Math.max(0, 1 - Math.abs(h - 18) / 1.3));
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

    const h = currentHour();
    const dayF = dayFactor(h);
    const glow = duskGlow(h);
    const nightF = 1 - dayF;

    // Sky gradient; fog + background follow the blended horizon color.
    const grad = skyCtx.createLinearGradient(0, 0, 0, 256);
    for (let i = 0; i < SKY_STOPS.length; i++) {
        _skyStop.copy(SKY_NIGHT[i]).lerp(SKY_DAY[i], dayF).lerp(SKY_DUSK[i], glow * 0.8);
        grad.addColorStop(SKY_STOPS[i], `#${_skyStop.getHexString()}`);
    }
    skyCtx.fillStyle = grad;
    skyCtx.fillRect(0, 0, 1, 256);
    skyTex.needsUpdate = true;
    _skyStop.copy(SKY_NIGHT[3]).lerp(SKY_DAY[3], dayF).lerp(SKY_DUSK[3], glow * 0.8);
    scene.fog.color.copy(_skyStop);
    scene.background.copy(_skyStop);

    // Sun & moon ride their arcs; each only shows around its own shift.
    arcPos(THREE.MathUtils.clamp((h - 6) / 12, 0, 1), 11, sunMesh.position);
    arcPos(THREE.MathUtils.clamp(((h + 6) % 24) / 12, 0, 1), 9, moonMesh.position);
    sunMesh.visible = h > 5.4 && h < 18.6;
    moonMesh.visible = h > 17.4 || h < 6.6;

    // The one shadow light plays sun by day and moon by night.
    sunLight.position.copy(dayF >= 0.5 ? sunMesh.position : moonMesh.position);
    sunLight.color.copy(new THREE.Color(0x9db8e8).lerp(new THREE.Color(0xfff4e0), dayF).lerp(new THREE.Color(0xffb37a), glow * 0.55));
    sunLight.intensity = 0.5 + 1.2 * dayF;
    hemiLight.color.set(0x1d2b52).lerp(new THREE.Color(0xcfe6ff), dayF);
    hemiLight.groundColor.set(0x233524).lerp(new THREE.Color(0x8fca62), dayF);
    hemiLight.intensity = 0.32 + 0.53 * dayF;

    // Night dresses the clouds and reveals the stars.
    cloudMat.color.set(0x6c7ea6).lerp(new THREE.Color(0xffffff), dayF);
    cloudMat.emissiveIntensity = 0.12 + 0.23 * dayF;
    starMat.opacity = nightF * (0.35 + 0.55 * THREE.MathUtils.smoothstep(nightF, 0.6, 1));
}
updateDayNight(true);

// Orbit camera: drag to circle the island, wheel to zoom; capped just above the horizon.
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.35, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;          // lower = silkier glide after a drag
controls.rotateSpeed = 0.85;
controls.minDistance = 2.2;
controls.maxDistance = 11;
controls.maxPolarAngle = Math.PI * 0.49;
// Wheel zoom: OrbitControls dollies in hard steps per wheel tick, which feels stiff. Disable it and
// glide toward a target distance in animate() instead (the ＋/－ buttons steer the same target).
controls.enableZoom = false;
let zoomTargetDist = camera.position.distanceTo(controls.target);
renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1);   // lines/pages → px
    zoomTargetDist = THREE.MathUtils.clamp(
        zoomTargetDist * Math.pow(1.0015, dy),
        controls.minDistance, controls.maxDistance
    );
}, { passive: false });
controls.update();

// ---- Stage: a floating meadow island — gently rolling vertex-colored grass over a rounded dirt
// cliff, dressed with chubby pastel props. Pets still sense it ONLY through `world` below. ----
const ISLAND_R = 3.2;
const stage = new THREE.Group();
scene.add(stage);

// Terrain: soft rolling bumps that settle flat at the rim and under the house/pond pads. This ONE
// function feeds both the visible mesh and world.groundHeightAt, so feet, props, the select ring
// and the catch ball always agree with what you see.
const FLAT_SPOTS = [
    { x: 1.7, z: 1.3, r: 1.15 },    // house pad
    { x: 0.2, z: -2.2, r: 0.95 },   // pond basin
];
function terrainHeight(x, z) {
    const rr = Math.hypot(x, z);
    if (rr >= ISLAND_R) return 0;
    let h = 0.05 * Math.sin(x * 1.7 + 1.3) * Math.sin(z * 1.9 - 0.7)
          + 0.04 * Math.sin((x + z) * 1.1 + 2.1) + 0.045;
    h *= THREE.MathUtils.smoothstep(ISLAND_R - rr, 0, 0.9);
    for (const s of FLAT_SPOTS) {
        h *= THREE.MathUtils.smoothstep(Math.hypot(x - s.x, z - s.z), s.r * 0.55, s.r);
    }
    return h;
}

// Grass top: a polar grid (26 rings × 72 segments) displaced by terrainHeight, with subtle
// two-tone vertex-color patches so the meadow doesn't read as one flat green.
{
    const rings = 26, segs = 72;
    const positions = [], colors = [], indices = [];
    const base = new THREE.Color(0x77c34f), light = new THREE.Color(0x94d861);
    const c = new THREE.Color();
    for (let i = 0; i <= rings; i++) {
        const r = (i / rings) * ISLAND_R;
        for (let j = 0; j < segs; j++) {
            const a = (j / segs) * Math.PI * 2;
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            const y = terrainHeight(x, z);
            positions.push(x, y, z);
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
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const grass = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    grass.receiveShadow = true;
    stage.add(grass);
}

// Cliff: a lathed, faceted dirt underside tapering to a rounded tip (the floating-island look).
{
    const pts = [
        new THREE.Vector2(ISLAND_R, 0.004),
        new THREE.Vector2(ISLAND_R * 0.995, -0.12),
        new THREE.Vector2(ISLAND_R * 0.93, -0.42),
        new THREE.Vector2(ISLAND_R * 0.72, -0.78),
        new THREE.Vector2(ISLAND_R * 0.42, -1.0),
        new THREE.Vector2(0.05, -1.14),
    ];
    const cliff = new THREE.Mesh(
        new THREE.LatheGeometry(pts, 72),
        new THREE.MeshLambertMaterial({ color: 0x9a6b47, flatShading: true })
    );
    cliff.receiveShadow = true;
    stage.add(cliff);
}

// Props stay a data list (type + position + blocking radius) — same swap point as before, the
// builders are just far chubbier now. `r` is the circle collider pets steer around; the pond is
// blocking too (pets shouldn't wade). The bowl doubles as the Eat-motion spot later.
const PROPS = [
    { type: 'tree',  x: -2.0, z: -1.1, rotY: 0.0,  r: 0.45, big: true  },
    { type: 'tree',  x:  2.1, z: -1.5, rotY: 2.1,  r: 0.45, big: false },
    { type: 'house', x:  1.7, z:  1.3, rotY: -0.6, r: 0.95 },
    { type: 'bowl',  x: -1.0, z:  1.6, rotY: 0.0,  r: 0.28 },
    { type: 'fence', x: -2.5, z:  0.6, rotY: 1.05, r: 0.5 },
    { type: 'pond',  x:  0.2, z: -2.2, rotY: 0.0,  r: 0.72 },
];
const M = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

function makeTree(p) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.095, 0.46, 10), M(0x8a5a3b));
    trunk.position.y = 0.23;
    g.add(trunk);
    // Fluffy crown: overlapping spheres in two greens; the big tree gets berries.
    const leafA = M(0x5db357), leafB = M(0x74c96a);
    const lobes = p && p.big
        ? [[0, 0.72, 0, 0.34, leafA], [0.22, 0.6, 0.1, 0.26, leafB], [-0.24, 0.62, -0.06, 0.27, leafB], [0.02, 0.92, -0.02, 0.24, leafB], [0.05, 0.55, 0.24, 0.22, leafA]]
        : [[0, 0.62, 0, 0.28, leafA], [0.18, 0.52, 0.08, 0.2, leafB], [-0.18, 0.55, -0.05, 0.21, leafB], [0, 0.78, 0, 0.18, leafB]];
    for (const [x, y, z, r, m] of lobes) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), m);
        s.position.set(x, y, z);
        g.add(s);
    }
    if (p && p.big) {
        const berry = M(0xff6b6b);
        for (const [x, y, z] of [[0.2, 0.78, 0.18], [-0.25, 0.7, 0.14], [0.05, 0.98, 0.12], [0.3, 0.58, -0.1]]) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), berry);
            b.position.set(x, y, z);
            g.add(b);
        }
    }
    return g;
}

function makeHouse() {
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.62, 0.8, 4, 0.05), M(0xfff2dd));
    walls.position.y = 0.31;
    g.add(walls);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.84, 0.52, 4), M(0xef8a7a, { flatShading: true }));
    roof.position.y = 0.88;
    roof.rotation.y = Math.PI / 4;       // align the 4-sided cone with the walls, eaves overhang
    g.add(roof);
    const chimney = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.24, 0.11, 3, 0.02), M(0xc97b6e));
    chimney.position.set(-0.24, 0.86, -0.16);
    g.add(chimney);
    const door = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.34, 0.05, 3, 0.02), M(0x9c6b4f));
    door.position.set(0, 0.17, 0.41);
    g.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), M(0xffd54f));
    knob.position.set(0.055, 0.17, 0.445);
    g.add(knob);
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.2, 0.05, 3, 0.02), M(0xffffff));
    frame.position.set(0.3, 0.42, 0.41);
    g.add(frame);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.056), M(0xbfe3f2));
    pane.position.copy(frame.position);
    g.add(pane);
    const step = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 14), M(0xcfcac0));
    step.position.set(0, 0.025, 0.52);
    g.add(step);
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
    const wood = M(0xd7bfa8);
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
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.76, 0.05, 36), M(0xe8d8a8));
    sand.position.y = 0.012;
    g.add(sand);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.585, 0.585, 0.045, 36), M(0x6ec6e8));
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

const PROP_BUILDERS = { tree: makeTree, house: makeHouse, bowl: makeBowl, fence: makeFence, pond: makePond };
for (const p of PROPS) {
    const obj = PROP_BUILDERS[p.type](p);
    obj.position.set(p.x, terrainHeight(p.x, p.z), p.z);
    obj.rotation.y = p.rotY || 0;
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    stage.add(obj);
}

// ---- World interface: the ONLY way pets sense the ground/space (keeps them portable) ----
const world = {
    islandRadius: ISLAND_R,
    groundHeightAt(x, z) { return terrainHeight(x, z); },        // rolling meadow (was flat)
    isBlocked(x, z) {
        if (Math.hypot(x, z) > ISLAND_R - 0.35) return true;     // stay clear of the rim
        for (const p of PROPS) {
            if (Math.hypot(x - p.x, z - p.z) < p.r) return true; // circle collider around each prop
        }
        return false;
    },
};

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
            out.push({ x, z });
        }
        return out;
    };
    const dummy = new THREE.Object3D();

    const tufts = spots(170, 0.45);
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
    const blooms = spots(34, 0.5);
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

    const pebbles = spots(22, 0.5);
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
    // A handful of random mid-range hops so pets meander; give up quietly if boxed in.
    for (let i = 0; i < 12; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 0.7 + Math.random() * 1.6;
        const x = from.x + Math.cos(ang) * dist;
        const z = from.z + Math.sin(ang) * dist;
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
        mover.position.set(nx, world.groundHeightAt(nx, nz), nz);
    }
    return 'moving';
}

function updateWander(p, delta) {
    const { ai, mover, pet } = p;
    if (ai.state === 'player') return;                               // the keyboard controller owns it
    if (ai.state === 'busy') { pet.walking = false; return; }        // a duo director owns the pet
    if (ai.state === 'goto') {
        // Duo approach: keeps walking even while a one-shot lingers, and gives up gracefully
        // (arrive-anyway) when blocked or stalled so the duo director can never deadlock.
        ai.stall = (ai.stall || 0) + delta;
        const res = steerToward(p, ai.target, delta);
        if (res === 'arrived' || res === 'blocked' || ai.stall > 6) {
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
            const target = pickTarget(mover.position);
            if (target) { ai.target = target; ai.state = 'walk'; }
            else ai.wait = 1 + Math.random() * 2;
        }
        return;
    }
    const res = steerToward(p, ai.target, delta);
    if (res === 'arrived') {
        ai.state = 'idle'; ai.wait = 2 + Math.random() * 4;
        if (Math.random() < 0.22) pet.action = { id: Math.random() < 0.5 ? 'happy' : 'think', t: 0 };  // arrival flourish
    } else if (res === 'blocked') {
        ai.state = 'idle'; ai.wait = 0.5 + Math.random();              // grazed a prop en route — re-plan
    }
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
    const eatEl   = mk('eat', p.pet.wings.length ? '🌾' : '🥣');
    const overlays = [
        { el: zzzEl,   left: 58, top: 14, size: 44 },
        { el: thinkEl, left: 62, top: 10, size: 44 },
        { el: cheerEl, left: 50, top: 4,  size: 18 },
        { el: eatEl,   left: 50, top: 72, size: 40 },
    ];
    p.pet.setZzz   = (on) => { zzzEl.style.opacity   = on ? '0.9' : '0'; };
    p.pet.setThink = (on) => { thinkEl.style.opacity = on ? '0.95' : '0'; };
    p.pet.setCheer = (on) => {
        if (on && cheerEl.style.opacity !== '1') {
            cheerEl.style.color = `hsl(${Math.floor(Math.random() * 360)}, 85%, 58%)`;
        }
        cheerEl.style.opacity = on ? '1' : '0';
    };
    p.pet.setEat = (on) => { eatEl.style.opacity = on ? '1' : '0'; };
    p.pet.spawnEmoji = (ch, { left = 50, top = 28, size = 28, dx = 0, duration = 1400 } = {}) => {
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
motionMenu.style.cssText = 'position:fixed; display:none; z-index:100; background:rgba(30,32,40,0.92); border-radius:10px; padding:6px; box-shadow:0 6px 24px rgba(0,0,0,0.35); max-height:230px; overflow-y:auto; min-width:150px; font-family:sans-serif;';
document.body.appendChild(motionMenu);
let menuPet = null;
// 🎮 control entry pinned above the motions: possess this pet (or release it) for keyboard control.
const controlItem = document.createElement('div');
controlItem.style.cssText = 'padding:7px 12px; font-size:13px; color:#ffd54f; border-radius:7px; cursor:pointer; white-space:nowrap; border-bottom:1px solid rgba(255,255,255,0.12); margin-bottom:4px;';
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
    item.style.cssText = 'padding:7px 12px; font-size:13px; color:#fff; border-radius:7px; cursor:pointer; white-space:nowrap;';
    item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.14)'; };
    item.onmouseleave = () => { item.style.background = 'transparent'; };
    item.onclick = () => { const p = menuPet; hideMenu(); if (p) playWorldMotion(p, m.id); };
    motionMenu.appendChild(item);
}
// 코디 items below the motions (divider above the first); labels refresh per open in showMenu.
const accessoryItems = [];
for (let i = 0; i < GLB_ACCESSORIES.length; i++) {
    const a = GLB_ACCESSORIES[i];
    const item = document.createElement('div');
    item.style.cssText = 'padding:7px 12px; font-size:13px; color:#ffd7e0; border-radius:7px; cursor:pointer; white-space:nowrap;' + (i === 0 ? 'border-top:1px solid rgba(255,255,255,0.12); margin-top:4px;' : '');
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
    motionMenu.style.left = `${Math.min(x, window.innerWidth - 170)}px`;
    motionMenu.style.top = `${Math.min(y, window.innerHeight - 240)}px`;
}
function hideMenu() { motionMenu.style.display = 'none'; menuPet = null; }

// Click = short, unmoved pointer press (otherwise it was an orbit drag). Clicking a sleeping pet
// wakes it (like the pet window); clicking an awake pet opens the motion menu.
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let pressAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
    pressAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
renderer.domElement.addEventListener('pointerup', (e) => {
    hideMenu();
    if (!pressAt) return;
    const moved = Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y);
    const held = performance.now() - pressAt.t;
    pressAt = null;
    if (moved > 6 || held > 400) return;
    pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    for (const p of pets) {
        if (raycaster.intersectObject(p.mover, true).length) {
            if (p.pet.sleeping) { p.pet.sleeping = false; p.pet.autoSleeping = false; return; }
            showMenu(e.clientX, e.clientY, p);
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
    p.ai.state = 'idle'; p.ai.wait = wait + Math.random(); p.ai.target = null; p.ai.onArrive = null;
}
function gotoAsync(p, x, z) {
    return new Promise((resolve) => {
        p.pet.sleeping = false;
        p.ai.state = 'goto'; p.ai.target = { x, z }; p.ai.stall = 0; p.ai.onArrive = resolve;
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
    if (p.ai.state === 'goto' || p.ai.state === 'busy') return;   // mid-duo choreography — ignore
    if (id === 'sleep') { p.pet.sleeping = true; releaseAI(p, 4); return; }
    p.pet.sleeping = false; p.pet.autoSleeping = false;
    if (id === 'hug' || id === 'play') {
        if (p === possessed) releasePossession();          // hand the pet back to its AI for the duo
        (id === 'hug' ? worldHug : worldPlay)(p);
        return;
    }
    p.pet.action = { id, t: 0 };
}

async function worldHug(initiator) {
    const partner = pets.find((q) => q !== initiator && !q.pet.sleeping && q !== possessed);
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
        await sleepMs(3100);                                   // hug DUR is 3.0s
    } finally {
        duoBusy = false; releaseAI(initiator); releaseAI(partner);
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
    const partner = pets.find((q) => q !== initiator && !q.pet.sleeping && q !== possessed);
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
    } finally {
        ballMesh.visible = false; ballFlight = null;
        duoBusy = false; releaseAI(initiator); releaseAI(partner);
    }
}

// ---- Chat (채팅): the world talks through the same backend pipeline as the pet windows ----
// Outgoing: the control socket `/ws` (`set_user_input` then `trigger_send_message` drives the
// main-UI agent, exactly like the pet window's bubble input). Incoming: the `/ws/vrm` broadcast —
// ordered TTS chunks carrying their text (+audio blobs), silence chunks and started/stop commands.
// The world only consumes chunks while it is waiting on a conversation IT started, so chats typed
// in the main UI or spoken to a pet window don't echo here. The responder (the pet you name in the
// message, else the chick) ponders (Think) while the agent generates, then speaks via a bubble +
// audio above its head and finishes with a happy hop.
let chatWs = null;
function initChatWs() {
    if (chatWs && (chatWs.readyState === WebSocket.OPEN || chatWs.readyState === WebSocket.CONNECTING)) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    chatWs = new WebSocket(`${proto}//${window.location.host}/ws`);
    chatWs.onclose = () => setTimeout(initChatWs, 3000);
}
initChatWs();

let vrmWs = null;
function initVrmWs() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    vrmWs = new WebSocket(`${proto}//${window.location.host}/ws/vrm`);
    vrmWs.binaryType = 'arraybuffer';
    vrmWs.onmessage = onVrmWsMessage;
    vrmWs.onclose = () => setTimeout(initVrmWs, 3000);
}
initVrmWs();

// Reply state: a miniature of the pet window's sort buffer — chunks can arrive out of order, so
// they are sequenced by chunkIndex; a drain timer decides when the streamed reply is really over.
let responder = null;
let waitingReply = false;
let waitTimer = null;          // give up if the agent never answers
let thinkTimer = null;         // keeps re-posing Think while waiting
let finishTimer = null;        // queue stayed drained → the reply is over
let bubbleHideTimer = null;
const chunkBuffer = new Map();
let nextChunkIndex = 0;
const playQueue = [];
let playing = false;
let currentAudio = null;

const bubbleEl = document.createElement('div');
bubbleEl.id = 'world-chat-bubble';
bubbleEl.style.cssText = 'position:fixed; display:none; transform:translate(-50%,-100%); max-width:280px; background:rgba(255,255,255,0.96); color:#222; font-size:13px; line-height:1.45; font-family:sans-serif; padding:8px 12px; border-radius:12px; box-shadow:0 4px 16px rgba(0,0,0,0.25); z-index:80; pointer-events:none; white-space:pre-wrap; word-break:break-word;';
document.body.appendChild(bubbleEl);
function showBubble(text) {
    if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }
    bubbleEl.textContent = text;
    bubbleEl.style.display = 'block';
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
chatBar.style.cssText = 'position:fixed; left:50%; bottom:14px; transform:translateX(-50%); display:flex; gap:6px; z-index:90; width:min(480px, calc(100% - 32px));';
const chatInput = document.createElement('input');
chatInput.type = 'text';
chatInput.placeholder = '펫에게 말 걸기… (병아리/강아지를 부르면 그 펫이 대답해요)';
chatInput.style.cssText = 'flex:1; padding:10px 14px; border:none; border-radius:20px; background:rgba(30,32,40,0.85); color:#fff; font-size:13px; outline:none; box-shadow:0 4px 14px rgba(0,0,0,0.25);';
const chatSend = document.createElement('button');
chatSend.textContent = '보내기';
chatSend.style.cssText = 'padding:10px 16px; border:none; border-radius:20px; background:#5b8def; color:#fff; font-size:13px; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,0.25);';
chatBar.appendChild(chatInput);
chatBar.appendChild(chatSend);
document.body.appendChild(chatBar);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendWorldChat(); e.stopPropagation(); });
chatBar.addEventListener('pointerdown', (e) => e.stopPropagation());
chatSend.addEventListener('click', sendWorldChat);

function pickResponder(text) {
    if (/병아리|삐약|chick/i.test(text)) return pets.find((p) => p.name === 'chick') || pets[0] || null;
    if (/강아지|멍멍|댕댕|puppy/i.test(text)) return pets.find((p) => p.name === 'puppy') || pets[0] || null;
    return pets.find((p) => p.name === 'chick') || pets[0] || null;
}

function sendWorldChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    if (!chatWs || chatWs.readyState !== WebSocket.OPEN) { initChatWs(); return; }
    chatWs.send(JSON.stringify({ type: 'set_user_input', data: { text } }));
    setTimeout(() => { try { chatWs.send(JSON.stringify({ type: 'trigger_send_message', data: {} })); } catch (e) {} }, 300);
    chatInput.value = '';
    responder = pickResponder(text);
    startWaiting();
}

function startWaiting() {
    resetReplyQueue();
    waitingReply = true;
    if (responder) { responder.pet.sleeping = false; responder.pet.autoSleeping = false; }
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = setTimeout(() => stopWaiting(false), 45000);
    if (thinkTimer) clearInterval(thinkTimer);
    thinkTimer = setInterval(() => {
        if (!waitingReply || playing || !responder) return;
        const free = !responder.pet.action && !responder.pet.sleeping
            && responder.ai.state !== 'goto' && responder.ai.state !== 'busy';
        if (free) responder.pet.action = { id: 'think', t: 0 };
    }, 400);
}

function stopWaiting(success) {
    waitingReply = false;
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
    if (finishTimer) { clearTimeout(finishTimer); finishTimer = null; }
    if (responder) {
        if (responder.pet.action && responder.pet.action.id === 'think') responder.pet.action = null;
        if (success && !responder.pet.action) responder.pet.action = { id: 'happy', t: 0 };
    }
    hideBubbleSoon();
}

function resetReplyQueue() {
    chunkBuffer.clear();
    playQueue.length = 0;
    nextChunkIndex = 0;
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} currentAudio = null; }
    playing = false;
    if (finishTimer) { clearTimeout(finishTimer); finishTimer = null; }
}

function enqueueChunk(task) {
    if (finishTimer) { clearTimeout(finishTimer); finishTimer = null; }
    chunkBuffer.set(task.chunkIndex, task);
    while (chunkBuffer.has(nextChunkIndex)) {
        playQueue.push(chunkBuffer.get(nextChunkIndex));
        chunkBuffer.delete(nextChunkIndex);
        nextChunkIndex++;
    }
    if (!playing && playQueue.length > 0) processReplyQueue();
}

function playAudio(url) {
    return new Promise((resolve) => {
        const a = new Audio(url);
        currentAudio = a;
        a.onended = resolve;
        a.onerror = resolve;
        a.play().catch(resolve);
    });
}

async function processReplyQueue() {
    if (playQueue.length === 0) {
        playing = false;
        // Drained — if nothing new arrives shortly, the streamed reply is over.
        if (waitingReply && !finishTimer) finishTimer = setTimeout(() => stopWaiting(true), 2500);
        return;
    }
    playing = true;
    // Reply is speaking: stop pondering and stand still while talking.
    if (responder) {
        if (responder.pet.action && responder.pet.action.id === 'think') responder.pet.action = null;
        if (responder.ai.state !== 'goto' && responder.ai.state !== 'busy') releaseAI(responder, 6);
    }
    const task = playQueue.shift();
    if (task.text) showBubble(task.text);
    if (task.silence) {
        await sleepMs(600);
    } else if (task.url) {
        await playAudio(task.url);
        URL.revokeObjectURL(task.url);
        currentAudio = null;
    }
    processReplyQueue();
}

function onVrmWsMessage(event) {
    if (event.data instanceof ArrayBuffer) {
        if (!waitingReply) return;                     // not a conversation the world started
        try {
            const view = new DataView(event.data);
            const jsonLen = view.getUint32(0, true);
            const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(event.data, 4, jsonLen)));
            const audioBytes = new Uint8Array(event.data, 4 + jsonLen);
            if (metadata.type === 'audio_chunk') {
                enqueueChunk({
                    chunkIndex: metadata.chunkIndex,
                    text: metadata.text,
                    url: URL.createObjectURL(new Blob([audioBytes], { type: metadata.mimeType })),
                });
            } else if (metadata.type === 'omni_chunk') {
                // Omni streams raw PCM tuned for the pet-window pipeline; the world shows the
                // streamed text and lets the drain timer close the reply.
                if (metadata.text) showBubble(metadata.text);
                if (finishTimer) clearTimeout(finishTimer);
                finishTimer = setTimeout(() => stopWaiting(true), 1800);
            }
        } catch (e) { console.error('[World] vrm chunk parse failed', e); }
        return;
    }
    try {
        const msg = JSON.parse(event.data);
        if (!waitingReply) return;
        if (msg.type === 'ttsStarted') {
            resetReplyQueue();
        } else if (msg.type === 'stopSpeaking') {
            resetReplyQueue();
            stopWaiting(false);
        } else if (msg.type === 'startSpeaking' && msg.data && msg.data.voice === 'silence') {
            enqueueChunk({ chunkIndex: msg.data.chunkIndex, text: msg.data.text, silence: true });
        }
    } catch (e) { /* non-JSON command — ignore */ }
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

const selectRing = new THREE.Mesh(
    new THREE.RingGeometry(0.26, 0.34, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
);
selectRing.rotation.x = -Math.PI / 2;
selectRing.visible = false;
scene.add(selectRing);

const controlHint = document.createElement('div');
controlHint.style.cssText = 'position:fixed; left:14px; bottom:14px; display:none; z-index:90; background:rgba(30,32,40,0.85); color:#fff; font-size:12px; font-family:sans-serif; padding:8px 12px; border-radius:10px; box-shadow:0 3px 10px rgba(0,0,0,0.3); pointer-events:none;';
document.body.appendChild(controlHint);

function possessPet(p) {
    if (p.ai.state === 'goto' || p.ai.state === 'busy') return;   // mid-duo — let it finish first
    releasePossession();
    possessed = p;
    p.pet.sleeping = false; p.pet.autoSleeping = false;
    p.ai.state = 'player';
    p.pet.walking = false;
    selectRing.visible = true;
    controlHint.textContent = `🎮 ${p.name === 'chick' ? '병아리' : '강아지'} 조종 중 — 방향키 이동 · Space 점프 · Esc 해제`;
    controlHint.style.display = 'block';
}
function releasePossession() {
    if (!possessed) return;
    const p = possessed;
    possessed = null;
    airborne = false; jumpVy = 0;
    p.mover.position.y = world.groundHeightAt(p.mover.position.x, p.mover.position.z);
    if (p.ai.state === 'player') releaseAI(p);
    heldKeys.clear();
    selectRing.visible = false;
    controlHint.style.display = 'none';
}

const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;        // typing in the chat bar
    if (e.key === 'Escape') { releasePossession(); hideMenu(); return; }
    if (!possessed) return;
    if (ARROW_KEYS.includes(e.key)) { heldKeys.add(e.key); e.preventDefault(); }
    else if (e.code === 'Space') {
        e.preventDefault();
        if (!airborne) { airborne = true; jumpVy = 2.5; }
    }
});
window.addEventListener('keyup', (e) => { heldKeys.delete(e.key); });
window.addEventListener('blur', () => heldKeys.clear());

function updatePlayer(delta) {
    if (!possessed) return;
    const p = possessed;
    if (p.ai.state !== 'player') { releasePossession(); return; }   // something reclaimed it — let go
    let ix = 0, iz = 0;
    if (heldKeys.has('ArrowUp')) iz += 1;
    if (heldKeys.has('ArrowDown')) iz -= 1;
    if (heldKeys.has('ArrowLeft')) ix -= 1;
    if (heldKeys.has('ArrowRight')) ix += 1;
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
            const step = p.speed * 1.5 * delta;                    // player pace: brisker than wandering
            const nx = p.mover.position.x + dir.x * step;
            const nz = p.mover.position.z + dir.z * step;
            if (!world.isBlocked(nx, nz)) { p.mover.position.x = nx; p.mover.position.z = nz; }
            p.pet.walking = true;
        }
    } else {
        p.pet.walking = false;
    }
    const groundY = world.groundHeightAt(p.mover.position.x, p.mover.position.z);
    if (airborne) {
        jumpVy -= 7.0 * delta;
        p.mover.position.y += jumpVy * delta;
        if (p.mover.position.y <= groundY && jumpVy < 0) {
            p.mover.position.y = groundY; airborne = false; jumpVy = 0;
        }
    } else {
        p.mover.position.y = groundY;
    }
}

function updateSelectRing() {
    if (!possessed) return;
    selectRing.position.set(
        possessed.mover.position.x,
        world.groundHeightAt(possessed.mover.position.x, possessed.mover.position.z) + 0.012,
        possessed.mover.position.z
    );
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
    const delta = Math.min(clock.getDelta(), 0.1);   // clamp huge deltas after the window was hidden
    for (const p of pets) {
        updateWander(p, delta);
        updateGlbPetEntity(p.pet, delta);
        if (p.fxUpdate) p.fxUpdate();
    }
    updatePlayer(delta);
    updateSelectRing();
    updateChatBubble();
    cloudSpin.rotation.y += delta * 0.012;   // lazy cloud drift
    updateDayNight();                        // throttled inside (repaints ~2×/min)
    if (ballFlight) {
        ballFlight.t += delta;
        const k = Math.min(1, ballFlight.t / ballFlight.dur);
        ballMesh.position.lerpVectors(ballFlight.from, ballFlight.to, k);
        ballMesh.position.y += Math.sin(k * Math.PI) * ballFlight.arc;
        if (k >= 1) { const done = ballFlight.resolve; ballFlight = null; done(); }
    }
    // Glide the camera distance toward the wheel/button zoom target (exponential ease-out).
    const curDist = camera.position.distanceTo(controls.target);
    if (Math.abs(curDist - zoomTargetDist) > 0.001) {
        const eased = THREE.MathUtils.lerp(curDist, zoomTargetDist, Math.min(1, delta * 9));
        const off = camera.position.clone().sub(controls.target).setLength(eased);
        camera.position.copy(controls.target).add(off);
    }
    controls.update();
    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);
