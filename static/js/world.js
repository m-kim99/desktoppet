// Pet world (월드): a small diorama scene where the GLB pets live together, opened from the tray.
// A floating grass-island stage with primitive props (data-driven so an asset kit can replace them),
// an orbit camera, and the `world` ground/blocking interface the pets query — they never assume
// flat/open ground, so later phases can swap in a heightmap (3rd-person) or voxels (sandbox).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGlbPetEntity, updateGlbPetEntity, GLB_MOTIONS } from './glb-pet-entity.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5e5);      // clear daytime sky
scene.fog = new THREE.Fog(0x87b5e5, 14, 30);       // soften the horizon so the island floats gently

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 2.4, 5.2);
camera.lookAt(0, 0.4, 0);

// Lights: hemisphere fill (sky blue above, grass green below) + a shadow-casting sun
const hemiLight = new THREE.HemisphereLight(0xbfdcff, 0x9ccc65, 0.9);
scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
sunLight.position.set(4, 7, 3);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -6;
sunLight.shadow.camera.right = 6;
sunLight.shadow.camera.top = 6;
sunLight.shadow.camera.bottom = -6;
scene.add(sunLight);

// Orbit camera: drag to circle the island, wheel to zoom; capped just above the horizon.
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.35, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2.2;
controls.maxDistance = 11;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

// ---- Stage: a small floating grass island (grass top sits at y=0, pets stand on it) ----
const ISLAND_R = 3.2;
const stage = new THREE.Group();
scene.add(stage);

const grass = new THREE.Mesh(
    new THREE.CylinderGeometry(ISLAND_R, ISLAND_R * 0.97, 0.22, 36),
    new THREE.MeshLambertMaterial({ color: 0x7cb342 })
);
grass.position.y = -0.11;
grass.receiveShadow = true;
stage.add(grass);

const dirt = new THREE.Mesh(
    new THREE.CylinderGeometry(ISLAND_R * 0.97, ISLAND_R * 0.55, 0.85, 36),
    new THREE.MeshLambertMaterial({ color: 0x8d6e63 })
);
dirt.position.y = -0.645;
stage.add(dirt);

// Props are a data list (type + position + blocking radius) so the primitive builders below can be
// swapped for a low-poly asset kit later without touching pet or world logic. `r` is the circle
// collider the pets steer around (world.isBlocked); the bowl doubles as the Eat-motion spot later.
const PROPS = [
    { type: 'tree',  x: -2.0, z: -1.1, rotY: 0.0,  r: 0.45 },
    { type: 'tree',  x:  2.1, z: -1.5, rotY: 2.1,  r: 0.45 },
    { type: 'house', x:  1.7, z:  1.3, rotY: -0.6, r: 0.95 },
    { type: 'bowl',  x: -1.0, z:  1.6, rotY: 0.0,  r: 0.28 },
    { type: 'fence', x: -2.5, z:  0.6, rotY: 1.05, r: 0.5 },
];

function makeTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.5, 8),
        new THREE.MeshLambertMaterial({ color: 0x795548 }));
    trunk.position.y = 0.25;
    g.add(trunk);
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x66bb6a });
    const leafLow = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.55, 8), leafMat);
    leafLow.position.y = 0.72;
    g.add(leafLow);
    const leafTop = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.45, 8), leafMat);
    leafTop.position.y = 1.04;
    g.add(leafTop);
    return g;
}

function makeHouse() {
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.62, 0.8),
        new THREE.MeshLambertMaterial({ color: 0xfff3e0 }));
    walls.position.y = 0.31;
    g.add(walls);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.5, 4),
        new THREE.MeshLambertMaterial({ color: 0xe57373 }));
    roof.position.y = 0.62 + 0.25;
    roof.rotation.y = Math.PI / 4;       // align the 4-sided cone with the box walls
    g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.32, 0.03),
        new THREE.MeshLambertMaterial({ color: 0x8d6e63 }));
    door.position.set(0, 0.16, 0.41);
    g.add(door);
    return g;
}

function makeBowl() {
    const g = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.08, 16),
        new THREE.MeshLambertMaterial({ color: 0xef5350 }));
    bowl.position.y = 0.04;
    g.add(bowl);
    const food = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 16),
        new THREE.MeshLambertMaterial({ color: 0xa1887f }));
    food.position.y = 0.075;
    g.add(food);
    return g;
}

function makeFence() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xbcaaa4 });
    for (let i = -1; i <= 1; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.06), mat);
        post.position.set(i * 0.34, 0.17, 0);
        g.add(post);
    }
    for (const y of [0.12, 0.26]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.045, 0.045), mat);
        rail.position.y = y;
        g.add(rail);
    }
    return g;
}

const PROP_BUILDERS = { tree: makeTree, house: makeHouse, bowl: makeBowl, fence: makeFence };
for (const p of PROPS) {
    const obj = PROP_BUILDERS[p.type]();
    obj.position.set(p.x, 0, p.z);
    obj.rotation.y = p.rotY || 0;
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    stage.add(obj);
}

// ---- World interface: the ONLY way pets sense the ground/space (keeps them portable) ----
const world = {
    islandRadius: ISLAND_R,
    groundHeightAt(x, z) { return 0; },                          // flat island for now
    isBlocked(x, z) {
        if (Math.hypot(x, z) > ISLAND_R - 0.35) return true;     // stay clear of the rim
        for (const p of PROPS) {
            if (Math.hypot(x - p.x, z - p.z) < p.r) return true; // circle collider around each prop
        }
        return false;
    },
};

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
for (const m of GLB_MOTIONS) {
    const item = document.createElement('div');
    item.textContent = m.label;
    item.style.cssText = 'padding:7px 12px; font-size:13px; color:#fff; border-radius:7px; cursor:pointer; white-space:nowrap;';
    item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.14)'; };
    item.onmouseleave = () => { item.style.background = 'transparent'; };
    item.onclick = () => { const p = menuPet; hideMenu(); if (p) playWorldMotion(p, m.id); };
    motionMenu.appendChild(item);
}
function showMenu(x, y, p) {
    menuPet = p;
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
    if (id === 'hug')  { worldHug(p);  return; }
    if (id === 'play') { worldPlay(p); return; }
    p.pet.action = { id, t: 0 };
}

async function worldHug(initiator) {
    const partner = pets.find((q) => q !== initiator && !q.pet.sleeping);
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
    const partner = pets.find((q) => q !== initiator && !q.pet.sleeping);
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
    updateChatBubble();
    if (ballFlight) {
        ballFlight.t += delta;
        const k = Math.min(1, ballFlight.t / ballFlight.dur);
        ballMesh.position.lerpVectors(ballFlight.from, ballFlight.to, k);
        ballMesh.position.y += Math.sin(k * Math.PI) * ballFlight.arc;
        if (k >= 1) { const done = ballFlight.resolve; ballFlight = null; done(); }
    }
    controls.update();
    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);
