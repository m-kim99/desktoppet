// Pet world (월드): a small diorama scene where the GLB pets live together, opened from the tray.
// A floating grass-island stage with primitive props (data-driven so an asset kit can replace them),
// an orbit camera, and the `world` ground/blocking interface the pets query — they never assume
// flat/open ground, so later phases can swap in a heightmap (3rd-person) or voxels (sandbox).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
// Soft image-based ambient (RoomEnvironment) — gives every standard material a gentle studio
// sheen instead of dead-flat shading. Kept subtle; the sun/hemisphere still carry the scene.
{
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.4;
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
    sunLight.intensity = 0.62 + 1.1 * dayF;
    hemiLight.color.set(0x1d2b52).lerp(new THREE.Color(0xcfe6ff), dayF);
    hemiLight.groundColor.set(0x233524).lerp(new THREE.Color(0x8fca62), dayF);
    hemiLight.intensity = 0.4 + 0.45 * dayF;

    // Streetlamps fade up through dusk; the 💡 slider scales both the light and the globe glow.
    const lampGlow = (1 - dayF) * lampBrightness;
    lampGlobeMat.emissiveIntensity = 0.05 + 1.3 * lampGlow;
    for (const l of lamps) l.light.intensity = 6 * lampGlow;

    // Night dresses the clouds and reveals the stars.
    cloudMat.color.set(0x6c7ea6).lerp(new THREE.Color(0xffffff), dayF);
    cloudMat.emissiveIntensity = 0.12 + 0.23 * dayF;
    starMat.opacity = nightF * (0.35 + 0.55 * THREE.MathUtils.smoothstep(nightF, 0.6, 1));

    // The sea darkens after sunset and warms a touch at golden hour; foam dims with it.
    if (seaMat) {
        seaMat.color.set(0x16345c).lerp(new THREE.Color(0x3fa9d0), dayF).lerp(new THREE.Color(0x5a79b0), glow * 0.35);
        for (const foam of foamRings) {
            foam.material.color.set(0x9fb8d8).lerp(new THREE.Color(0xffffff), dayF);
        }
    }
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
function gradSphereGeo(r, topHex, bottomHex) {
    const g = new THREE.SphereGeometry(r, 18, 14);
    const pos = g.attributes.position;
    const cT = new THREE.Color(topHex), cB = new THREE.Color(bottomHex), c = new THREE.Color();
    const cols = [];
    for (let i = 0; i < pos.count; i++) {
        const t = THREE.MathUtils.clamp(pos.getY(i) / r * 0.5 + 0.5, 0, 1);
        c.copy(cB).lerp(cT, t);
        cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    return g;
}

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
    const positions = [], colors = [], uvs = [], indices = [];
    // Vertex colors are near-white multipliers over the grass texture: subtle sunny/mossy patches.
    const base = new THREE.Color(0.93, 0.95, 0.88), light = new THREE.Color(1.07, 1.1, 1.0);
    const c = new THREE.Color();
    for (let i = 0; i <= rings; i++) {
        const r = (i / rings) * ISLAND_R;
        for (let j = 0; j < segs; j++) {
            const a = (j / segs) * Math.PI * 2;
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            const y = terrainHeight(x, z);
            positions.push(x, y, z);
            uvs.push(x * 0.8, z * 0.8);                 // planar mapping — the triangle tile repeats ~1.25u
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
        new THREE.MeshStandardMaterial({ map: strataTex, roughness: 1, metalness: 0, flatShading: true })
    );
    cliff.castShadow = true;         // the island shades the sea at low sun
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
    { type: 'sunbed',  x:  2.35, z:  0.0,  rotY: -1.2, r: 0.42 },
    { type: 'hammock', x: -1.55, z: -1.95, rotY: 0.5,  r: 0.55 },
    { type: 'lamp', x:  0.94, z:  2.58, rotY: 0, r: 0.18 },
    { type: 'lamp', x:  1.65, z: -2.2,  rotY: 0, r: 0.18 },
    { type: 'lamp', x: -2.46, z: -1.23, rotY: 0, r: 0.18 },
    { type: 'lamp', x: -1.94, z:  1.95, rotY: 0, r: 0.18 },
];
const BEDS = [];   // filled during prop placement: where pets sleep at night / lie via Ctrl
const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, ...extra });
const leafMatGrad = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });

function makeTree(p) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.095, 0.46, 10), M(0x9a6a45, { map: woodTex }));
    trunk.position.y = 0.23;
    g.add(trunk);
    // Fluffy crown: overlapping spheres with a baked top-lit gradient; the big tree gets berries.
    const lobes = p && p.big
        ? [[0, 0.72, 0, 0.34, 0x7fd06c, 0x3f8f3a], [0.22, 0.6, 0.1, 0.26, 0x8fdc7a, 0x4da045], [-0.24, 0.62, -0.06, 0.27, 0x8fdc7a, 0x4da045], [0.02, 0.92, -0.02, 0.24, 0x8fdc7a, 0x4da045], [0.05, 0.55, 0.24, 0.22, 0x7fd06c, 0x3f8f3a]]
        : [[0, 0.62, 0, 0.28, 0x7fd06c, 0x3f8f3a], [0.18, 0.52, 0.08, 0.2, 0x8fdc7a, 0x4da045], [-0.18, 0.55, -0.05, 0.21, 0x8fdc7a, 0x4da045], [0, 0.78, 0, 0.18, 0x8fdc7a, 0x4da045]];
    for (const [x, y, z, r, top, bottom] of lobes) {
        const s = new THREE.Mesh(gradSphereGeo(r, top, bottom), leafMatGrad);
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
    const walls = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.62, 0.8, 4, 0.05), M(0xffffff, { map: plasterTex }));
    walls.position.y = 0.31;
    g.add(walls);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.84, 0.52, 4), M(0xffffff, { map: roofTex, flatShading: true }));
    roof.position.y = 0.88;
    roof.rotation.y = Math.PI / 4;       // align the 4-sided cone with the walls, eaves overhang
    g.add(roof);
    const chimney = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.24, 0.11, 3, 0.02), M(0xc97b6e));
    chimney.position.set(-0.24, 0.86, -0.16);
    g.add(chimney);
    const door = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.34, 0.05, 3, 0.02), M(0x9c6b4f, { map: woodTex }));
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

const PROP_BUILDERS = { tree: makeTree, house: makeHouse, bowl: makeBowl, fence: makeFence, pond: makePond, sunbed: makeSunbed, hammock: makeHammock, lamp: makeLamp };
for (const p of PROPS) {
    const obj = PROP_BUILDERS[p.type](p);
    obj.position.set(p.x, terrainHeight(p.x, p.z), p.z);
    obj.rotation.y = p.rotY || 0;
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    stage.add(obj);
    if (p.type === 'lamp') {
        const light = new THREE.PointLight(0xffd9a0, 0, 4.5, 2);
        light.position.set(p.x, terrainHeight(p.x, p.z) + 0.95, p.z);
        scene.add(light);
        lamps.push({ light });
    }
    // Beds register a lying spot (on the furniture, with a lean-back tilt + heading) and an
    // approach point just outside their collider that the pet walks to before climbing on.
    if (p.type === 'sunbed' || p.type === 'hammock') {
        const sy = Math.sin(p.rotY || 0), cy = Math.cos(p.rotY || 0);
        const baseY = terrainHeight(p.x, p.z);
        if (p.type === 'sunbed') {
            BEDS.push({
                id: 'sunbed', occupant: null, sway: 0,
                lie: { x: p.x + sy * 0.05, z: p.z + cy * 0.05, y: baseY + 0.18, rotY: p.rotY || 0, tilt: -1.05 },
                approach: { x: p.x + sy * 0.75, z: p.z + cy * 0.75 },
            });
        } else {
            BEDS.push({
                id: 'hammock', occupant: null, sway: 1,
                lie: { x: p.x, z: p.z, y: baseY + 0.4, rotY: (p.rotY || 0) + Math.PI / 2, tilt: -1.25 },
                approach: { x: p.x + sy * 0.7, z: p.z + cy * 0.7 },
            });
        }
    }
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
    const inner = 2.6, outer = 40, rings = 40, segs = 112;
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

    for (let i = 0; i < 2; i++) {
        const foam = new THREE.Mesh(
            new THREE.RingGeometry(2.62, 2.98, 72),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false })
        );
        foam.rotation.x = -Math.PI / 2;
        foam.position.y = OCEAN_LEVEL + 0.035;
        scene.add(foam);
        foamRings.push(foam);
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
            // Sometimes fancy a dip instead of a stroll (daytime only, on a cooldown) — so the
            // pets end up swimming together, player included.
            if (!isSleepTime(currentHour()) && Date.now() > (p.nextDipAt || 0) && Math.random() < 0.25) {
                p.nextDipAt = Date.now() + 150000 + Math.random() * 150000;
                startDip(p);
                return;
            }
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
    const overlays = [
        { el: zzzEl,   left: 58, top: 14, size: 44 },
        { el: thinkEl, left: 62, top: 10, size: 44 },
        { el: cheerEl, left: 50, top: 4,  size: 18 },
    ];
    p.pet.setZzz   = (on) => { zzzEl.style.opacity   = on ? '0.9' : '0'; };
    p.pet.setThink = (on) => { thinkEl.style.opacity = on ? '0.95' : '0'; };
    p.pet.setCheer = (on) => {
        if (on && cheerEl.style.opacity !== '1') {
            cheerEl.style.color = `hsl(${Math.floor(Math.random() * 360)}, 85%, 58%)`;
        }
        cheerEl.style.opacity = on ? '1' : '0';
    };
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
    const partner = pets.find((q) => q !== initiator && !q.pet.sleeping && q !== possessed && !q.bed && !q.dip);
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
    const partner = pets.find((q) => q !== initiator && !q.pet.sleeping && q !== possessed && !q.bed && !q.dip);
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

// ---- 💡 가로등 밝기 (bottom-right): scales the rim lamps at night; persists across sessions.
const lampUI = document.createElement('div');
lampUI.style.cssText = 'position:fixed; right:14px; bottom:14px; display:flex; align-items:center; gap:8px; z-index:90; background:rgba(30,32,40,0.85); padding:8px 12px; border-radius:12px; box-shadow:0 3px 10px rgba(0,0,0,0.3);';
const lampIcon = document.createElement('span');
lampIcon.textContent = '💡';
lampIcon.style.cssText = 'font-size:15px;';
const lampSlider = document.createElement('input');
lampSlider.type = 'range';
lampSlider.min = '0';
lampSlider.max = '100';
lampSlider.value = String(Math.round(lampBrightness * 100));
lampSlider.title = '가로등 밝기';
lampSlider.style.cssText = 'width:110px; accent-color:#ffd54f; cursor:pointer;';
lampSlider.addEventListener('input', () => {
    lampBrightness = Number(lampSlider.value) / 100;
    try { localStorage.setItem('worldLampBrightness', String(lampBrightness)); } catch (e) {}
    updateDayNight(true);
});
lampUI.appendChild(lampIcon);
lampUI.appendChild(lampSlider);
document.body.appendChild(lampUI);

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
    seaHop = null;
    // The AI only lives on land — if released while swimming (or mid-air past the rim), bring the
    // pet back to solid, unblocked ground first.
    if (p.swimming || Math.hypot(p.mover.position.x, p.mover.position.z) > ISLAND_R - 0.45) {
        const pos = p.mover.position;
        const rr = Math.hypot(pos.x, pos.z) || 1;
        if (rr > ISLAND_R - 0.5) {
            const k = (ISLAND_R - 0.6) / rr;
            pos.x *= k; pos.z *= k;
        }
        if (world.isBlocked(pos.x, pos.z)) { pos.x = -0.5; pos.z = 0.2; }   // e.g. released in the pond
        p.swimming = false;
        p.mover.rotation.x = 0;
    }
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
        if (!airborne) { airborne = true; jumpVy = possessed.swimming ? 1.7 : 2.5; }   // splash-hop in water
    }
    else if (e.key === 'Control' || e.key === 'Meta') {
        // Interaction key (Ctrl or ⌘): climb back onto the island while swimming near the cliff,
        // otherwise tuck into a nearby free bed. Possession auto-releases for the bed approach.
        e.preventDefault();
        if (possessed.swimming === 'sea') {
            const pos = possessed.mover.position;
            const rr = Math.hypot(pos.x, pos.z);
            if (rr < ISLAND_R + 0.6 && !seaHop) {
                const k = (ISLAND_R - 0.5) / (rr || 1);
                const tx = pos.x * k, tz = pos.z * k;
                seaHop = { fx: pos.x, fy: pos.y, fz: pos.z, tx, tz, ty: world.groundHeightAt(tx, tz), t: 0 };
            }
            return;
        }
        const bed = !possessed.bed && nearestFreeBed(possessed, 0.95);
        if (bed) mountBed(possessed, bed);
    }
});
window.addEventListener('keyup', (e) => { heldKeys.delete(e.key); });
window.addEventListener('blur', () => heldKeys.clear());

// Swimming (조종 전용): the player pet may wade into the pond or dive off the rim into the sea —
// the wander AI never does (world.isBlocked still fences it). Support height decides the medium;
// in water the pet floats half-submerged with a gentle bob, leans forward and paddles.
const pondPropRef = PROPS.find((q) => q.type === 'pond');
const POND_WATER_Y = terrainHeight(pondPropRef.x, pondPropRef.z) + 0.06;
const SWIM_LEASH = ISLAND_R + 4;                 // don't let the swimmer vanish into the fog
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
    if (Math.hypot(x, z) > ISLAND_R - 0.05) {
        return { y: OCEAN_LEVEL + 0.02 - p.height * 0.45, medium: 'sea' };
    }
    if (Math.hypot(x - pondPropRef.x, z - pondPropRef.z) < 0.55) {
        return { y: POND_WATER_Y - p.height * 0.45, medium: 'pond' };
    }
    return { y: world.groundHeightAt(x, z), medium: 'land' };
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
            const step = p.speed * (p.swimming ? 1.05 : 1.5) * delta;   // paddling is slower than trotting
            const nx = p.mover.position.x + dir.x * step;
            const nz = p.mover.position.z + dir.z * step;
            if (!playerBlocked(nx, nz)) { p.mover.position.x = nx; p.mover.position.z = nz; }
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
    const nearCliff = p.swimming === 'sea' && Math.hypot(p.mover.position.x, p.mover.position.z) < ISLAND_R + 0.6;
    const bedNear = !p.swimming && !p.bed && nearestFreeBed(p, 0.95);
    const hint = p.swimming
        ? `🏊 ${petName} 수영 중 — 방향키 이동 · Space 물장구${nearCliff ? ' · Ctrl/⌘ 섬으로 올라가기' : ''} · Esc 해제`
        : `🎮 ${petName} 조종 중 — 방향키 이동 · Space 점프${bedNear ? ' · Ctrl/⌘ 눕기' : ''} · Esc 해제`;
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
async function startDip(p) {
    const kind = Math.random() < 0.5 ? 'pond' : 'sea';
    let entry = null;
    for (let i = 0; i < 10 && !entry; i++) {
        const a = Math.random() * Math.PI * 2;
        const x = kind === 'pond' ? pondPropRef.x + Math.sin(a) * 0.85 : Math.sin(a) * (ISLAND_R - 0.55);
        const z = kind === 'pond' ? pondPropRef.z + Math.cos(a) * 0.85 : Math.cos(a) * (ISLAND_R - 0.55);
        if (!world.isBlocked(x, z)) entry = { x, z, a };
    }
    if (!entry) return;
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

// ---- 잠자리 & auto-sleep: at 22시 the pets head to bed (chick→hammock, puppy→sunbed), climb on,
// tip onto their backs and doze until 6시. Waking them (click/chat/motion) makes them hop off —
// during sleep hours they drowsily try again ~90s later. Beds are blocking props, so pets walk to
// an approach point and are then tweened onto the lying spot; the lean-back lives on the mover
// (rotation.x) so the shared sleep animation keeps breathing on top. The hammock rocks gently.
const BED_PREF = { chick: 'hammock', puppy: 'sunbed' };
function freeBedFor(p) {
    return BEDS.find((b) => b.id === BED_PREF[p.name] && !b.occupant) || BEDS.find((b) => !b.occupant) || null;
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
    if (p.bed || bed.occupant) return;
    bed.occupant = p; p.bed = bed; p.bedPhase = 'approach';
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
            if (k >= 1) { p.bedPhase = 'lying'; p.bedT = 0; p.pet.sleeping = true; p.ai.state = 'busy'; }
        } else if (p.bedPhase === 'lying') {
            p.bedT += delta;
            if (bed.sway) p.mover.rotation.z = Math.sin(p.bedT * 1.1) * 0.07;
            if (!p.pet.sleeping) dismountBed(p);                 // woken by anything → hop off
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
        else p.pet.sleeping = true;                              // both beds taken — nap on the grass
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
        // Particles die on the local surface: terrain on the island, the sea beyond the rim.
        const offIsland = Math.hypot(c.m.position.x, c.m.position.z) >= ISLAND_R;
        const floor = offIsland ? OCEAN_LEVEL : world.groundHeightAt(c.m.position.x, c.m.position.z);
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
});

const clock = new THREE.Clock();
function animate() {
    const delta = Math.min(clock.getDelta(), 0.1);   // clamp huge deltas after the window was hidden
    for (const p of pets) {
        updateWander(p, delta);
        updateGlbPetEntity(p.pet, delta);
        applySwimPose(p, delta);
        if (p.fxUpdate) p.fxUpdate();
    }
    updatePlayer(delta);
    updateBeds(delta);
    updateDips(delta);
    updateAutoSleep();
    updateMeals();
    updateCrumbs(delta);
    updateSelectRing();
    updateChatBubble();
    cloudSpin.rotation.y += delta * 0.012;   // lazy cloud drift
    updateDayNight();                        // throttled inside (repaints ~2×/min)
    updateOcean(delta);
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
