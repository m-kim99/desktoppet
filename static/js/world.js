// Pet world (월드): a small diorama scene where the GLB pets live together, opened from the tray.
// A floating grass-island stage with primitive props (data-driven so an asset kit can replace them),
// an orbit camera, and the `world` ground/blocking interface the pets query — they never assume
// flat/open ground, so later phases can swap in a heightmap (3rd-person) or voxels (sandbox).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGlbPetEntity, updateGlbPetEntity } from './glb-pet-entity.js';

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
        pets.push({ name: def.name, speed: def.speed, pet, mover, ai: makeWanderAI() });
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

function updateWander(p, delta) {
    const { ai, mover, pet } = p;
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
    const dx = ai.target.x - mover.position.x;
    const dz = ai.target.z - mover.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.08) {
        ai.state = 'idle'; ai.wait = 2 + Math.random() * 4; pet.walking = false;
        return;
    }
    // Turn toward the target along the shortest arc; only stride once roughly facing it,
    // so departures read as "turn, then walk" instead of strafing.
    const desired = Math.atan2(dx, dz);                      // rotation.y=0 faces +Z; forward = (sin, cos)
    let diff = desired - mover.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    mover.rotation.y += THREE.MathUtils.clamp(diff, -delta * 3.5, delta * 3.5);
    pet.walking = true;
    if (Math.abs(diff) < 0.5) {
        const step = Math.min(p.speed * delta, dist);
        const nx = mover.position.x + Math.sin(mover.rotation.y) * step;
        const nz = mover.position.z + Math.cos(mover.rotation.y) * step;
        if (world.isBlocked(nx, nz)) {                        // grazed a prop en route — re-plan
            ai.state = 'idle'; ai.wait = 0.5 + Math.random(); pet.walking = false;
            return;
        }
        mover.position.set(nx, world.groundHeightAt(nx, nz), nz);
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
    }
    controls.update();
    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);
