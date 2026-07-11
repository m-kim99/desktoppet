// ===== Plain .glb pet support (non-VRM): procedural foot/body "waddle", no rig/morphs =====
// Shared pet-entity module: the desktop pet window (vrm.js) and the world mode each create their
// own instances (the world holds two — chick + puppy). No window/DOM assumptions live in the
// loader/updater themselves: the caller supplies the target height in scene units, and the emoji
// FX hooks (setZzz/setThink/setCheer/setEat, spawnEmoji/burstEmoji) are per-entity and swappable —
// the pet window uses the fixed-DOM defaults below; the world overrides them with 3D-anchored ones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const glbLoader = new GLTFLoader();         // Plain loader for .glb pets (no VRM plugin)

// On-demand GLB pet motions listed in the control panel's motion dropdown. Walk and Idle are the
// pet's default states and are intentionally NOT listed here. This list is data-driven: as each
// motion is implemented (Happy, Wave, Think, ...), add an entry here and it shows up in the menu.
export const GLB_MOTIONS = [
    { id: 'wave',      label: '인사 (Wave)' },
    { id: 'happy',     label: '기쁨 (Happy)' },
    { id: 'dance',     label: '춤 (Dance)' },
    { id: 'cheer',     label: '응원 (Cheer)' },
    { id: 'celebrate', label: '축하 (Celebrate)' },
    { id: 'hug',       label: '포옹 (Hug)' },
    { id: 'heart',     label: '하트 (Heart)' },
    { id: 'play',      label: '놀이 (Play)' },
    { id: 'think',     label: '생각 (Think)' },
    { id: 'eat',       label: '먹기 (Eat)' },
    { id: 'dig',       label: '파기 (Dig)' },
    { id: 'stretch',   label: '스트레칭 (Stretch)' },
    { id: 'sleep',     label: '수면 (Sleep)' },
];

// Easing helpers (A) for snappier, more characterful motion: smooth in/out, overshoot, bounce.
export const Ease = {
    inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
    inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
    outBack:   (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
};

// Spawn a transient floating emoji particle (music notes, hearts, …) that drifts up and fades, then
// self-removes. Reusable across motions (uses the Web Animations API).
export function spawnFloatEmoji(ch, { left = 50, top = 28, size = 28, dx = 0, duration = 1400 } = {}) {
    const el = document.createElement('div');
    el.textContent = ch;
    el.style.cssText = `position:fixed; left:${left}%; top:${top}%; font-size:${size}px; opacity:0; pointer-events:none; z-index:9998; will-change:transform,opacity;`;
    document.body.appendChild(el);
    el.animate([
        { transform: 'translate(0,0) rotate(-10deg)', opacity: 0 },
        { opacity: 0.95, offset: 0.25 },
        { transform: `translate(${dx}px,-48px) rotate(10deg)`, opacity: 0 },
    ], { duration, easing: 'ease-out' }).onfinish = () => el.remove();
}

// Burst many emoji particles at once: they fly outward then fall (gravity) and fade. For confetti /
// celebration "pops" — visually distinct from the steady upward float of spawnFloatEmoji.
export function spawnBurstEmoji(chars, count = 14, { cx = 50, cy = 32 } = {}) {
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.textContent = chars[Math.floor(Math.random() * chars.length)];
        const size = 18 + Math.random() * 16;
        el.style.cssText = `position:fixed; left:${cx}%; top:${cy}%; font-size:${size}px; opacity:1; pointer-events:none; z-index:9998; will-change:transform,opacity;`;
        document.body.appendChild(el);
        const ang = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 90;
        const dx = Math.cos(ang) * dist;
        const upY = -Math.abs(Math.sin(ang)) * dist * 0.5 - 20;     // initial outward/up
        const fallY = 120 + Math.random() * 90;                      // then fall past start
        el.animate([
            { transform: 'translate(0,0) rotate(0deg)', opacity: 1, offset: 0 },
            { transform: `translate(${dx * 0.6}px, ${upY}px) rotate(${(Math.random() - 0.5) * 220}deg)`, opacity: 1, offset: 0.35 },
            { transform: `translate(${dx}px, ${fallY}px) rotate(${(Math.random() - 0.5) * 400}deg)`, opacity: 0, offset: 1 },
        ], { duration: 1100 + Math.random() * 800, easing: 'cubic-bezier(.2,.6,.3,1)' }).onfinish = () => el.remove();
    }
}

// ---- 코디 accessories: procedural wearable items (no external assets, same philosophy as the
// motions). Each builder takes a base radius and returns a group whose origin is the point that
// touches the head top; setGlbPetAccessory anchors it there. New items = builder + list entry. ----
export const GLB_ACCESSORIES = [
    { id: 'santa-hat', label: '🎅 산타모자' },
    { id: 'straw-hat', label: '👒 밀짚모자' },   // 보물찾기 1호 보상 (월드에서 발굴하면 열림)
    { id: 'ribbon',    label: '🎀 리본' },       // 보물찾기 2호 보상
];

// Classic floppy santa hat: white brim ring, red cone tilted at the tip, white pompom at the point.
function makeSantaHat(brimR) {
    const g = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xd6382e, roughness: 0.65 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf7f3ee, roughness: 0.95 });
    const brim = new THREE.Mesh(new THREE.TorusGeometry(brimR, brimR * 0.24, 12, 28), white);
    brim.rotation.x = Math.PI / 2;
    g.add(brim);
    const coneH = brimR * 1.8;
    const coneGeo = new THREE.ConeGeometry(brimR * 0.95, coneH, 24);
    coneGeo.translate(0, coneH / 2, 0);                    // origin at the base so the tilt pivots there
    const cone = new THREE.Mesh(coneGeo, red);
    const flop = -0.30;                                    // tip flops sideways
    cone.rotation.z = flop;
    g.add(cone);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(brimR * 0.30, 14, 12), white);
    pom.position.set(-Math.sin(flop) * coneH, Math.cos(flop) * coneH, 0);   // ride the tilted tip
    g.add(pom);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
}

// 밀짚모자: 넓은 챙 + 낮은 돔 + 산호빛 띠.
function makeStrawHat(brimR) {
    const g = new THREE.Group();
    const straw = new THREE.MeshStandardMaterial({ color: 0xe8c878, roughness: 0.9 });
    const band = new THREE.MeshStandardMaterial({ color: 0xd6604e, roughness: 0.7 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(brimR * 1.75, brimR * 1.85, brimR * 0.14, 24), straw);
    g.add(brim);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(brimR * 0.95, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), straw);
    dome.position.y = brimR * 0.05;
    dome.scale.y = 0.75;
    g.add(dome);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(brimR * 0.93, brimR * 0.09, 8, 24), band);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = brimR * 0.16;
    g.add(ring);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
}
// 리본: 정수리의 나비매듭 — 매듭 + 좌우 고리 + 늘어진 꼬리.
function makeRibbon(brimR) {
    const g = new THREE.Group();
    const pink = new THREE.MeshStandardMaterial({ color: 0xf27ba0, roughness: 0.6 });
    const knot = new THREE.Mesh(new THREE.SphereGeometry(brimR * 0.22, 12, 10), pink);
    g.add(knot);
    for (const side of [-1, 1]) {
        const loop = new THREE.Mesh(new THREE.SphereGeometry(brimR * 0.42, 12, 10), pink);
        loop.position.set(side * brimR * 0.48, brimR * 0.06, 0);
        loop.scale.set(1, 0.62, 0.45);
        loop.rotation.z = side * 0.35;
        g.add(loop);
        const tail = new THREE.Mesh(new THREE.ConeGeometry(brimR * 0.16, brimR * 0.5, 8), pink);
        tail.position.set(side * brimR * 0.3, -brimR * 0.3, 0.02);
        tail.rotation.z = side * 2.6;
        g.add(tail);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
}
const ACCESSORY_BUILDERS = { 'santa-hat': makeSantaHat, 'straw-hat': makeStrawHat, 'ribbon': makeRibbon };

// Wear a 코디 item (id) or take the current one off (id = null/undefined). The item is parented to
// `wrap`, so every motion (nod, spin, sleep droop, …) carries it naturally.
export function setGlbPetAccessory(pet, id) {
    if (!pet) return;
    if (pet.accessory) {
        try { pet.wrap.remove(pet.accessory.group); } catch (e) {}
        pet.accessory.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        pet.accessory = null;
    }
    if (!id) return;
    const build = ACCESSORY_BUILDERS[id];
    if (!build) return;
    const headR = Math.min(pet.dims.x, pet.dims.z) * 0.5;
    const group = build(headR * 0.62);                     // brim a bit narrower than the head (tunable)
    group.position.y = pet.dims.y * 0.97;                  // sit on the head top, slightly sunk in
    group.rotation.z = 0.12;                               // jaunty resting tilt
    pet.wrap.add(group);
    pet.accessory = { id, group };
}

// Load a .glb pet and return an entity object ready for updateGlbPetEntity. `targetHeight` is the
// desired model height in scene units (the pet window derives it from the window height so all
// windows show the same on-screen size; the world passes a fixed world-unit height). `parent`, when
// given, receives the wrapper before the screen-side limb classification (which needs world matrices).
export async function createGlbPetEntity(url, { targetHeight = 0.455, parent = null } = {}) {
    const gltf = await glbLoader.loadAsync(url);
    const root = gltf.scene;

    // Normalize: scale to a sensible height, center on XZ, feet on the ground (y=0)
    let box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3(); box.getSize(size);
    const s = size.y > 1e-4 ? targetHeight / size.y : 1;
    root.scale.setScalar(s);
    box = new THREE.Box3().setFromObject(root);
    const c = new THREE.Vector3(); box.getCenter(c);
    root.position.x -= c.x;
    root.position.z -= c.z;
    root.position.y -= box.min.y;   // ground the feet at y=0 (reverted)
    const dims = new THREE.Vector3(); box.getSize(dims);   // normalized size (accessory anchoring)

    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });

    // Wrapper carries the procedural bob/waddle so it never fights the model's own transforms
    const wrap = new THREE.Group();
    wrap.add(root);
    wrap.rotation.y = Math.PI;   // face the camera/light (model's front is -Z by default)
    if (parent) parent.add(wrap);

    const findAll = (re) => { const a = []; root.traverse(o => { if (re.test(o.name)) a.push(o); }); return a; };
    const findOne = (re) => { let r = null; root.traverse(o => { if (!r && re.test(o.name)) r = o; }); return r; };
    const feet = findAll(/foot|leg/i);
    feet.forEach(f => { f.userData._restRotX = f.rotation.x; });
    const tail = findOne(/tail/i);
    const ears = findAll(/ear/i);
    ears.forEach(e => { e.userData._restRotX = e.rotation.x; });
    const wings = findAll(/wing/i);                 // chick wings (flutter while idle)
    wings.forEach(wg => { wg.userData._restRotZ = wg.rotation.z; });
    const eyes = findAll(/eye|highlight/i);         // eyes + highlights (squash to blink)
    eyes.forEach(ey => { ey.userData._restScaleY = ey.scale.y; });
    const beak = findOne(/beak/i);                  // chick beak (opens while pecking)
    if (beak) beak.userData._restRotX = beak.rotation.x;
    const tongue = findOne(/tongue/i);              // puppy tongue (laps while eating)
    if (tongue) tongue.userData._restRotX = tongue.rotation.x;

    // Idle behaviors fire on randomized timers so "occasional" reads as natural, not metronomic.
    // Each has a countdown to the next occurrence (*Nx) and a remaining-duration of the current
    // pulse (*Ph, 0 = inactive).
    const idle = {
        blinkNx: 1.5 + Math.random() * 3, blinkPh: 0,
        nodNx:   3.0 + Math.random() * 5, nodPh:   0,
        flutNx:  2.5 + Math.random() * 4, flutPh:  0,
    };

    // Classify feet/wings by ON-SCREEN side. The wrap's 180° Y flip mirrors the model's left/right,
    // so we sort by world X (after a matrix update) to find the screen-left vs screen-right limbs —
    // the wave plants the screen-left foot and waves the screen-right wing/foot.
    wrap.updateWorldMatrix(true, true);
    const _wx = (o) => { const v = new THREE.Vector3(); o.getWorldPosition(v); return v.x; };
    const footPlant = feet.length ? feet.slice().sort((a, b) => _wx(a) - _wx(b))[0] : null;   // screen-left
    const footWave  = feet.length ? feet.slice().sort((a, b) => _wx(b) - _wx(a))[0] : null;   // screen-right
    const wingWave  = wings.length ? wings.slice().sort((a, b) => _wx(b) - _wx(a))[0] : null;  // screen-right

    // FX hooks: setZzz/…/setEat stay null until the host wires them (pet window = fixed DOM overlays,
    // world = 3D-anchored); the emoji spawners default to the DOM implementations above.
    const pet = { wrap, root, dims, feet, tail, ears, wings, eyes, beak, tongue, footPlant, footWave, wingWave, idle,
        setZzz: null, setThink: null, setCheer: null, setEat: null,
        spawnEmoji: spawnFloatEmoji, burstEmoji: spawnBurstEmoji, accessory: null,
        sleeping: false, autoSleeping: false, walking: false, walkAmt: 0, t: 0 };
    console.log('[GlbPet] loaded', url, '| feet:', feet.map(f => f.name), '| wings:', wings.length, '| eyes:', eyes.length, '| beak:', !!beak, '| tongue:', !!tongue);
    return pet;
}

export function updateGlbPetEntity(pet, delta) {
    if (!pet) return;
    pet.t += delta;
    const t = pet.t;

    // Sleep is a state that overrides idle/walk: eyes shut, slow deep breathing, head drooped with a
    // gentle doze-bob, lazy tail. Exits when the pet is clicked (canvas handler) or starts walking.
    if (pet.walking) pet.sleeping = false;
    if (pet.sleeping) {
        pet.walkAmt += (0 - pet.walkAmt) * Math.min(1, delta * 6);
        pet.wrap.position.y = Math.sin(t * 1.0) * 0.02 - 0.02;        // slow deep breaths, settled lower
        pet.wrap.rotation.z = Math.sin(t * 0.7) * 0.03;              // slow sway
        pet.wrap.rotation.x = 0.13 + Math.sin(t * 0.5) * 0.04;       // head drooped + gentle doze-bob
        pet.feet.forEach(f => { f.rotation.x = f.userData._restRotX || 0; });
        pet.ears.forEach(e => { e.rotation.x = e.userData._restRotX || 0; });
        pet.wings.forEach(wg => { wg.rotation.z = wg.userData._restRotZ || 0; });
        if (pet.tail) pet.tail.rotation.y = Math.sin(t * 1.5) * 0.08;   // slow lazy tail
        pet.eyes.forEach(ey => { ey.scale.y = ey.userData._restScaleY * 0.1; });   // closed
        if (pet.beak) pet.beak.rotation.x = pet.beak.userData._restRotX || 0;
        if (pet.tongue) pet.tongue.rotation.x = pet.tongue.userData._restRotX || 0;
        if (pet.setZzz) pet.setZzz(true);
        if (pet.setThink) pet.setThink(false);
        if (pet.setCheer) pet.setCheer(false);
        if (pet.setEat) pet.setEat(false);
        return;
    }
    if (pet.setZzz) pet.setZzz(false);
    if (pet.setThink) pet.setThink(false);
    if (pet.setCheer) pet.setCheer(false);
    if (pet.setEat) pet.setEat(false);

    // One-shot motions (from the motion menu / on summon). Plays for its duration, then clears and
    // falls through to idle. Each frame starts from rest so leftover idle pose doesn't bleed in.
    if (pet.action) {
        const DUR = { wave: 2.4, happy: 1.8, think: 2.8, dance: 4.5, cheer: 3.5, celebrate: 2.6, heart: 2.6, eat: 3.2, dig: 2.8, stretch: 3.6, hug: 3.0, play: 6.0 };
        const dur = DUR[pet.action.id] || 2.0;
        pet.action.t += delta;
        const p = pet.action.t / dur;
        if (p < 1) {
            // rest baseline
            pet.feet.forEach(f => { f.rotation.x = f.userData._restRotX || 0; });
            pet.ears.forEach(e => { e.rotation.x = e.userData._restRotX || 0; });
            pet.wings.forEach(wg => { wg.rotation.z = wg.userData._restRotZ || 0; });
            pet.eyes.forEach(ey => { ey.scale.y = ey.userData._restScaleY; });
            pet.wrap.position.y = 0;
            pet.wrap.rotation.x = 0;
            pet.wrap.rotation.z = 0;
            pet.wrap.scale.y = 1;   // squash&stretch 쓰는 모션(heart)이 중간에 끊겨도 원상복구
            if (pet.tail) pet.tail.rotation.y = 0;
            if (pet.beak) pet.beak.rotation.x = pet.beak.userData._restRotX || 0;
            if (pet.tongue) pet.tongue.rotation.x = pet.tongue.userData._restRotX || 0;

            if (pet.action.id === 'wave') {
                // Plant the screen-left foot, lean right, and wave the screen-right wing + foot.
                const raise = Math.sin(p * Math.PI);                 // rise → hold → lower
                const wv = Math.sin(p * Math.PI * 14) * raise;       // ~7 waves (2× faster shake)
                pet.wrap.position.y = Math.abs(Math.sin(p * Math.PI * 4)) * 0.03;   // happy bounce
                pet.wrap.rotation.x = raise * 0.07;                                  // slight bow
                pet.wrap.rotation.z = raise * -0.20;    // lean right
                // footPlant stays at rest (planted). Chick waves ONLY its wing; puppy (no wings)
                // waves its foot instead, plus a happy tail wag.
                if (pet.wingWave) {
                    pet.wingWave.rotation.z = (pet.wingWave.userData._restRotZ || 0) - (raise * 1.0 + wv * 0.5);   // wave the wing forward (was tilting back)
                } else {
                    if (pet.footWave) pet.footWave.rotation.x = (pet.footWave.userData._restRotX || 0) - (raise * 0.9 + wv * 0.5);
                    if (pet.tail) pet.tail.rotation.y = Math.sin(t * 12.0) * (0.2 + 0.3 * raise);
                }
            }
            if (pet.action.id === 'happy') {
                // Excited: energetic hops + a little wiggle. Chick flaps both wings fast; puppy spins
                // a full turn and wags its tail hard.
                const e = Math.sin(p * Math.PI);                                              // ease in/out
                pet.wrap.position.y = Math.abs(Math.sin(p * Math.PI * 6)) * 0.05 * (0.4 + 0.6 * e);   // ~3 hops
                pet.wrap.rotation.z = Math.sin(p * Math.PI * 8) * 0.06 * e;                            // wiggle
                if (pet.wings.length) {
                    pet.wings.forEach((wg, i) => {
                        const side = (i % 2 === 0) ? 1 : -1;
                        wg.rotation.z = (wg.userData._restRotZ || 0) - side * (0.3 + Math.abs(Math.sin(p * Math.PI * 16)) * 0.6 * e);
                    });
                } else {
                    pet.wrap.rotation.y = Math.PI + p * Math.PI * 2;   // one full happy spin
                    if (pet.tail) pet.tail.rotation.y = Math.sin(t * 18.0) * (0.3 + 0.3 * e);
                }
            }
            if (pet.action.id === 'think') {
                // Pondering, with the animation principles (B):
                //  - anticipation: a brief still beat before the head tilts,
                //  - head tilt 갸우뚱: ease to one side, hold, swing to the other,
                //  - follow-through: settle back with a small overshoot (outBack),
                //  - overlapping action: ears/tail lag behind the head (inertia).
                const a = pet.action;
                let tilt;
                if (p < 0.12)      tilt = 0;                                                        // anticipation
                else if (p < 0.55) tilt = Ease.inOutSine((p - 0.12) / 0.43) * 0.28;                 // tilt & hold
                else if (p < 0.85) tilt = 0.28 - Ease.inOutSine((p - 0.55) / 0.30) * 0.50;          // swing the other way
                else               tilt = -0.22 + Ease.outBack((p - 0.85) / 0.15) * 0.22;           // settle w/ overshoot
                const pres = Ease.inOutSine(Math.min(1, p * 1.2));                                   // overall presence
                pet.wrap.rotation.z = tilt;
                pet.wrap.rotation.x = 0.04 * pres;                                                // slight curious lean
                // Overlapping action: ears/tail chase the tilt with a delay (lag).
                a.lag = (a.lag ?? 0) + (tilt - (a.lag ?? 0)) * Math.min(1, delta * 6);
                pet.ears.forEach(eo => { eo.rotation.x = (eo.userData._restRotX || 0) + a.lag * 0.6; });
                if (pet.tail) pet.tail.rotation.y = a.lag * 0.8;
                // Gesture: chick scratches its head with the screen-right wing; puppy lifts a paw to its chin.
                const scratch = (p > 0.15 && p < 0.8) ? Math.sin(p * Math.PI * 12) * 0.14 : 0;
                if (pet.wingWave)      pet.wingWave.rotation.z = (pet.wingWave.userData._restRotZ || 0) - (pres * 0.5 + scratch);
                else if (pet.footWave) pet.footWave.rotation.x = (pet.footWave.userData._restRotX || 0) - (pres * 0.7 + scratch);
                if (pet.setThink) pet.setThink(true);
            }
            if (pet.action.id === 'dance') {
                // Rhythmic groove: beat-synced bounce, side-to-side sway with a twist, limbs on the
                // beat, and floating music notes. Eases in/out at the start and end (B).
                const a = pet.action;
                const env = Math.min(1, p * 4) * Math.min(1, (1 - p) * 4);   // ramp up first 25%, down last 25%
                const beat = pet.t * Math.PI * 4;                         // ~2 beats / sec
                const bounce = Math.pow(Math.abs(Math.sin(beat)), 0.6);      // punchy on-beat hop
                const sway = Math.sin(pet.t * Math.PI * 2);               // weight shift (half the beat)
                pet.wrap.position.y = bounce * 0.05 * env;
                pet.wrap.rotation.x = bounce * 0.04 * env;                // head bob
                pet.wrap.rotation.z = sway * 0.18 * env;                  // sway
                pet.wrap.rotation.y = Math.PI + sway * 0.25 * env;        // twist with the sway
                if (pet.wings.length) {
                    pet.wings.forEach((wg, i) => {
                        const side = (i % 2 === 0) ? 1 : -1;
                        wg.rotation.z = (wg.userData._restRotZ || 0) - side * (0.3 + bounce * 0.4) * env;
                    });
                }
                pet.ears.forEach((eo, i) => { eo.rotation.x = (eo.userData._restRotX || 0) + Math.sin(beat + i) * 0.2 * env; });
                if (pet.tail) pet.tail.rotation.y = Math.sin(beat) * (0.2 + 0.2 * env);
                a.noteT = (a.noteT ?? 0) - delta;
                if (a.noteT <= 0 && env > 0.25) {
                    pet.spawnEmoji(Math.random() < 0.5 ? '🎵' : '🎶', { left: 44 + Math.random() * 22, top: 20 + Math.random() * 10, size: 22 + Math.random() * 12, dx: (Math.random() - 0.5) * 44 });
                    a.noteT = 0.34;
                }
            }
            if (pet.action.id === 'cheer') {
                // Rooting for you: rhythmic up-pumps + bouncy beat, leaning toward the viewer; bubble.
                const a = pet.action;
                const env = Math.min(1, p * 5) * Math.min(1, (1 - p) * 5);
                const pump = Math.pow(Math.max(0, Math.sin(pet.t * Math.PI * 3)), 0.7);
                pet.wrap.position.y = pump * 0.05 * env;
                pet.wrap.rotation.x = -0.06 * env;
                pet.wrap.rotation.z = Math.sin(pet.t * Math.PI * 6) * 0.04 * env;
                if (pet.wings.length) {
                    pet.wings.forEach((wg, i) => {
                        const side = (i % 2 === 0) ? 1 : -1;
                        wg.rotation.z = (wg.userData._restRotZ || 0) - side * (0.4 + pump * 0.7) * env;
                    });
                } else {
                    pet.feet.forEach((f, i) => {
                        const ph = (i % 2 === 0) ? pump : (1 - pump);
                        f.rotation.x = (f.userData._restRotX || 0) - ph * 0.7 * env;
                    });
                    if (pet.tail) pet.tail.rotation.y = Math.sin(pet.t * 12) * 0.3 * env;
                }
                pet.ears.forEach((eo) => { eo.rotation.x = (eo.userData._restRotX || 0) + pump * 0.2 * env; });
                a.noteT = (a.noteT ?? 0) - delta;
                if (a.noteT <= 0 && env > 0.3) {
                    pet.spawnEmoji(Math.random() < 0.5 ? '✊' : '💪', { left: 42 + Math.random() * 26, top: 26 + Math.random() * 6, size: 24 + Math.random() * 8, dx: (Math.random() - 0.5) * 30 });
                    a.noteT = 0.5;
                }
                if (pet.setCheer) pet.setCheer(true);
            }
            if (pet.action.id === 'celebrate') {
                // One big burst: anticipation crouch -> leap + full spin -> settle; confetti at the peak.
                const a = pet.action;
                let y;
                if (p < 0.15) {
                    y = -0.03 * Ease.inOutSine(p / 0.15);
                } else if (p < 0.65) {
                    const k = (p - 0.15) / 0.50;
                    y = -0.03 * (1 - k) + Math.sin(k * Math.PI) * 0.14;
                } else {
                    const k = (p - 0.65) / 0.35;
                    y = Math.sin(k * Math.PI) * -0.015 * (1 - k);
                }
                pet.wrap.position.y = y;
                pet.wrap.rotation.y = Math.PI + Ease.inOutSine(Math.min(1, p / 0.7)) * Math.PI * 2;
                const spread = Math.sin(Math.min(1, Math.max(0, (p - 0.15) / 0.5)) * Math.PI);
                if (pet.wings.length) {
                    pet.wings.forEach((wg, i) => {
                        const side = (i % 2 === 0) ? 1 : -1;
                        wg.rotation.z = (wg.userData._restRotZ || 0) - side * spread * 0.9;
                    });
                }
                if (pet.tail) pet.tail.rotation.y = Math.sin(pet.t * 16) * 0.3;
                if (!a.burst && p >= 0.4) { a.burst = true; pet.burstEmoji(['🎉','🎊','✨','🎈'], 16, { cx: 50, cy: 30 }); }
            }
            if (pet.action.id === 'heart') {
                // 💗 사랑 고백: 움츠림(anticipation) → 갸웃·갸웃("너 좋아" 리듬, outBack) → 폴짝
                // 점프 + 정점에서 하트 팡 → 감쇠 진동 스쿼시로 착지. 병아리는 양 날개를 가슴 앞으로
                // 모으고(하트 모양), 강아지는 고개를 젖히며 꼬리 만개. 눈은 ^^ 스마일 스퀸트.
                // FX: 월드가 pet.heartFx(3D 하트 풀)를 꽂아주면 그걸, 아니면(펫 창) 이모지 버스트.
                const a = pet.action;
                let y = 0, tiltZ = 0, sq = 1;
                if (p < 0.14) {
                    const k = Ease.inOutSine(p / 0.14);
                    y = -0.025 * k; sq = 1 - 0.07 * k;
                } else if (p < 0.32) {
                    const k = (p - 0.14) / 0.18;
                    tiltZ = Ease.outBack(k) * 0.24;
                    sq = 0.93 + 0.07 * Ease.inOutSine(k);
                    y = -0.025 * (1 - k);
                } else if (p < 0.5) {
                    tiltZ = 0.24 - Ease.inOutSine((p - 0.32) / 0.18) * 0.46;
                } else if (p < 0.72) {
                    const k = (p - 0.5) / 0.22;
                    tiltZ = -0.22 * (1 - k);
                    y = Math.sin(k * Math.PI) * 0.17;
                    sq = 1 + 0.08 * Math.sin(k * Math.PI);              // 공중에서 살짝 늘어남
                } else {
                    const k = (p - 0.72) / 0.28;
                    sq = 1 - 0.09 * Math.exp(-k * 5) * Math.cos(k * 14);   // 착지 감쇠 진동
                }
                pet.wrap.position.y = y;
                pet.wrap.rotation.z = tiltZ;
                pet.wrap.scale.y = sq;
                const warm = Math.sin(Math.min(1, p / 0.9) * Math.PI);
                pet.eyes.forEach(ey => { ey.scale.y = ey.userData._restScaleY * (1 - 0.72 * warm); });   // ^^
                if (pet.wings.length) {
                    const inw = p < 0.72 ? Ease.inOutSine(Math.min(1, p / 0.3)) : 1 - Ease.inOutSine((p - 0.72) / 0.28);
                    const flap = (p >= 0.5 && p < 0.72) ? Math.abs(Math.sin((p - 0.5) / 0.22 * Math.PI * 3)) * 0.45 : 0;
                    pet.wings.forEach((wg, i) => {
                        const side = (i % 2 === 0) ? 1 : -1;
                        wg.rotation.z = (wg.userData._restRotZ || 0) - side * (inw * 0.75 + flap);
                    });
                } else {
                    pet.wrap.rotation.x = -0.18 * warm;                  // 고개 젖히기
                    if (pet.tail) pet.tail.rotation.y = Math.sin(pet.t * 20) * (0.25 + 0.35 * warm);
                }
                if (!a.burst && p >= 0.61) {                             // 점프 정점: 팡
                    a.burst = true;
                    if (pet.heartFx) pet.heartFx();
                    else pet.burstEmoji(['💗', '💕', '💖'], 10, { cx: 50, cy: 26 });
                }
                if (!a.last && p >= 0.86 && pet.floatEmoji) {            // 잔여 하트 한 개 톡
                    a.last = true;
                    pet.floatEmoji('💗', { top: 20, size: 26, duration: 1600 });
                }
            }
            if (pet.action.id === 'eat') {
                // Head-down feeding. Phases: A(0–.15) lean in, B(.15–.82) eat cycles, C(.82–1) look up
                // satisfied (outBack pop). Chick = sharp ground pecks + beak; puppy = deep bowl nibbles,
                // tongue laps, tail wags, ears flop. Drives the ground food prop + crumb/✨ particles.
                const a = pet.action;
                const eating = p >= 0.15 && p < 0.82;
                let down;                                       // head-lowered amount: 0 rest → 1 buried
                if (p < 0.15)    down = Ease.inOutSine(p / 0.15);
                else if (eating) down = 1;
                else             down = 1 - Ease.outBack(Math.min(1, (p - 0.82) / 0.18));   // pop back up
                if (pet.wings.length) {
                    // 🐤 chick: quick sharp pecks — head taps down hard, beak opens on contact, wings flick.
                    const peck = eating ? Math.pow(Math.max(0, Math.sin(pet.t * Math.PI * 5)), 0.5) : 0;
                    pet.wrap.rotation.x = 0.20 * down + peck * 0.42;
                    pet.wrap.position.y = -peck * 0.012;
                    if (pet.beak) pet.beak.rotation.x = (pet.beak.userData._restRotX || 0) - peck * 0.25;
                    pet.wings.forEach((wg, i) => {
                        const side = (i % 2 === 0) ? 1 : -1;
                        wg.rotation.z = (wg.userData._restRotZ || 0) - side * (peck * 0.20 + down * 0.10);
                    });
                    pet.ears.forEach(eo => { eo.rotation.x = (eo.userData._restRotX || 0) + peck * 0.10; });
                } else {
                    // 🐶 puppy: head buried in the bowl, fast little nibbles, tongue laps, tail wags, ears flop.
                    const chew = eating ? Math.sin(pet.t * Math.PI * 7) * 0.5 + 0.5 : 0;
                    pet.wrap.rotation.x = 0.30 * down + chew * 0.05 * down;
                    if (pet.tongue) pet.tongue.rotation.x = (pet.tongue.userData._restRotX || 0) - (Math.sin(pet.t * 16) * 0.5 + 0.5) * 0.30 * (eating ? 1 : 0);
                    if (pet.tail) pet.tail.rotation.y = Math.sin(pet.t * 18) * 0.40 * down;
                    pet.ears.forEach(eo => { eo.rotation.x = (eo.userData._restRotX || 0) + down * 0.45; });
                }
                pet.eyes.forEach(ey => { ey.scale.y = ey.userData._restScaleY * (1 - 0.45 * down); });   // content half-closed
                if (pet.setEat) pet.setEat(true);
                a.noteT = (a.noteT ?? 0) - delta;
                if (a.noteT <= 0 && eating) {
                    if (pet.wings.length) pet.spawnEmoji(Math.random() < 0.5 ? '🌾' : '✨', { left: 45 + Math.random() * 10, top: 60 + Math.random() * 6, size: 15 + Math.random() * 8, dx: (Math.random() - 0.5) * 24, duration: 1000 });
                    else pet.spawnEmoji(Math.random() < 0.25 ? '❤️' : '✨', { left: 45 + Math.random() * 10, top: 56 + Math.random() * 6, size: 18 + Math.random() * 8, dx: (Math.random() - 0.5) * 24, duration: 1100 });
                    a.noteT = 0.42;
                }
            }
            if (pet.action.id === 'dig') {
                // 땅 파기. Phases: A(0–.12) 웅크리기, B(.12–.85) 파기 사이클 — 좌우 번갈아 긁으며
                // 흙먼지가 튄다, C(.85–1) 만족스럽게 몸을 편다. 병아리 = 날개 갈퀴질 + 부리 콕콕,
                // 강아지 = 몸통 리듬 갈퀴질 + 신난 꼬리 + 펄럭이는 귀.
                const digging = p >= 0.12 && p < 0.85;
                let crouch;
                if (p < 0.12)    crouch = Ease.inOutSine(p / 0.12);
                else if (digging) crouch = 1;
                else             crouch = 1 - Ease.outBack(Math.min(1, (p - 0.85) / 0.15));
                const cyc = digging ? pet.t * Math.PI * 6 : 0;
                const scratchL = Math.max(0, Math.sin(cyc));
                const scratchR = Math.max(0, -Math.sin(cyc));
                pet.wrap.rotation.x = 0.34 * crouch + (digging ? Math.abs(Math.sin(cyc)) * 0.08 : 0);
                pet.wrap.position.y = -0.015 * crouch;
                if (pet.wings.length) {
                    pet.wings.forEach((wg, i) => {
                        const side = (i % 2 === 0) ? 1 : -1;
                        const s = side > 0 ? scratchL : scratchR;
                        wg.rotation.z = (wg.userData._restRotZ || 0) - side * (0.25 * crouch + s * 0.75);
                        wg.rotation.x = (wg.userData._restRotX || 0) + s * 0.5;
                    });
                    if (pet.beak) pet.beak.rotation.x = (pet.beak.userData._restRotX || 0) - scratchL * 0.15;
                } else {
                    pet.wrap.rotation.z = Math.sin(cyc) * 0.12 * crouch;
                    if (pet.tail) pet.tail.rotation.y = Math.sin(pet.t * 20) * 0.5 * crouch;
                    pet.ears.forEach(eo => { eo.rotation.x = (eo.userData._restRotX || 0) + crouch * 0.4 + scratchL * 0.12; });
                }
                pet.eyes.forEach(ey => { ey.scale.y = ey.userData._restScaleY * (1 - 0.3 * crouch); });
                const a = pet.action;
                a.dirtT = (a.dirtT ?? 0) - delta;
                if (a.dirtT <= 0 && digging) {
                    pet.spawnEmoji(Math.random() < 0.6 ? '💨' : '✨', { left: 42 + Math.random() * 16, top: 62 + Math.random() * 8, size: 14 + Math.random() * 8, dx: (Math.random() - 0.5) * 30, duration: 900 });
                    a.dirtT = 0.3;
                }
            }
            if (pet.action.id === 'stretch') {
                // 스트레칭 (운동 공간). Phases: A(0–.3) 위로 쭈욱 — 몸을 펴고 날개/귀를 하늘로,
                // B(.3–.55) 왼쪽으로 기울-이-기, C(.55–.8) 오른쪽으로, D(.8–1) 탈탈 털고 제자리.
                const up = p < 0.3 ? Ease.inOutSine(p / 0.3) : p < 0.8 ? 1 : 1 - Ease.inOutSine((p - 0.8) / 0.2);
                let lean = 0;
                if (p >= 0.3 && p < 0.55) lean = -Math.sin(((p - 0.3) / 0.25) * Math.PI) * 0.34;
                else if (p >= 0.55 && p < 0.8) lean = Math.sin(((p - 0.55) / 0.25) * Math.PI) * 0.34;
                const shake = p >= 0.8 ? Math.sin(pet.t * 34) * 0.06 * (1 - (p - 0.8) / 0.2) : 0;
                pet.wrap.rotation.z = lean + shake;
                pet.wrap.rotation.x = -0.12 * up;                    // 가슴 펴기
                pet.wrap.position.y = 0.02 * up;
                pet.wrap.scale.y = 1 + 0.05 * up;                    // 살짝 늘어나는 몸
                if (pet.wings.length) {
                    pet.wings.forEach((wg, i) => {
                        const side = (i % 2 === 0) ? 1 : -1;
                        wg.rotation.z = (wg.userData._restRotZ || 0) - side * (1.15 * up + lean * side * 0.4);
                    });
                    if (pet.beak) pet.beak.rotation.x = (pet.beak.userData._restRotX || 0) - 0.12 * up;   // 시원한 하품 낌새
                } else {
                    pet.ears.forEach(eo => { eo.rotation.x = (eo.userData._restRotX || 0) - 0.5 * up; });
                    if (pet.tail) pet.tail.rotation.y = Math.sin(pet.t * 6) * 0.25 * up;
                    if (pet.tongue) pet.tongue.rotation.x = (pet.tongue.userData._restRotX || 0) - 0.18 * up;
                }
                pet.eyes.forEach(ey => { ey.scale.y = ey.userData._restScaleY * (1 - 0.5 * up); });   // 지그시 감고 쭈욱
            }
            if (pet.action.id === 'hug') {
                // Two pets lean into each other (main slides the windows together). Phases: reach (0–.2),
                // embrace hold (.2–.8), release with an outBack bounce-apart (.8–1). `dir` (+1 = partner to
                // screen-right) leans this pet toward the partner; chick wraps wings, puppy reaches on paws
                // + wags; hearts rise between them. Plays solo gracefully if there is no partner.
                const a = pet.action;
                const dir = a.dir || 1;
                let embrace;
                if (p < 0.2)      embrace = Ease.inOutSine(p / 0.2);
                else if (p < 0.8) embrace = 1;
                else              embrace = 1 - Ease.outBack(Math.min(1, (p - 0.8) / 0.2));
                pet.wrap.rotation.z = dir * 0.18 * embrace;     // lean toward the partner (sign tunable)
                pet.wrap.rotation.x = 0.10 * embrace;           // slight nuzzle forward
                pet.wrap.position.y = 0.012 * embrace;          // rise a touch into the embrace
                if (pet.wings.length) {
                    pet.wings.forEach((wg, i) => {              // 🐤 bring both wings forward to wrap
                        const side = (i % 2 === 0) ? 1 : -1;
                        wg.rotation.z = (wg.userData._restRotZ || 0) - side * 0.80 * embrace;
                    });
                } else {
                    pet.feet.forEach(f => { f.rotation.x = (f.userData._restRotX || 0) - 0.35 * embrace; });  // 🐶 reach in on paws
                    if (pet.tail) pet.tail.rotation.y = Math.sin(pet.t * 16) * 0.35 * embrace;          // happy wag
                }
                pet.ears.forEach(eo => { eo.rotation.x = (eo.userData._restRotX || 0) + 0.30 * embrace; });
                pet.eyes.forEach(ey => { ey.scale.y = ey.userData._restScaleY * (1 - 0.50 * embrace); });     // content
                a.noteT = (a.noteT ?? 0) - delta;
                if (a.noteT <= 0 && embrace > 0.4) {
                    pet.spawnEmoji(['💕','💗','❤️'][Math.floor(Math.random() * 3)], { left: 50 + dir * (6 + Math.random() * 10), top: 20 + Math.random() * 8, size: 20 + Math.random() * 10, dx: dir * 10 + (Math.random() - 0.5) * 16, duration: 1300 });
                    a.noteT = 0.45;
                }
            }
            if (pet.action.id === 'play') {
                // Catch: a ball (its own window, driven by main) arcs between the two pets. Main cues this
                // pet to 'throw'/'catch'/'finish' via vrm-play-cue; between cues it bobs ready, angled
                // toward the partner (`dir` = partner side). Gesture numbers are visual-tunable.
                const a = pet.action;
                const dir = a.dir || 1;
                a.cueT = (a.cueT ?? 0) + delta;
                const ct = a.cueT;
                let roll = 0, pitch = 0, reach = 0, lift = 0;
                if (a.cue === 'throw') {
                    const k = Math.min(1, ct / 0.45);
                    const s = k < 0.35 ? -(k / 0.35) : (k - 0.35) / 0.65;     // windup(-1) -> release(+1)
                    roll = 0.22 * s; pitch = 0.10 * Math.max(0, s); reach = 0.6 * s;
                } else if (a.cue === 'catch') {
                    const k = Math.min(1, ct / 0.45);
                    reach = Math.sin(k * Math.PI) * 0.8;                       // reach out then recoil
                    roll = 0.12 * (k < 0.5 ? k / 0.5 : 1 - (k - 0.5) / 0.5);
                    lift = 0.02 * reach;
                } else if (a.cue === 'finish') {
                    const hop = Math.abs(Math.sin(ct * 11)) * Math.max(0, 1 - ct / 0.7);
                    lift = 0.05 * hop; reach = 0.4 * hop;
                } else {                                                       // ready: bob, angled at partner
                    const bob = Math.sin(pet.t * 7) * 0.5 + 0.5;
                    lift = 0.012 * bob; roll = 0.06; reach = 0.10;
                }
                pet.wrap.rotation.z = dir * roll;
                pet.wrap.rotation.x = pitch;
                pet.wrap.position.y = lift;
                if (pet.wings.length) {
                    pet.wings.forEach((wg, i) => { const side = (i % 2 === 0) ? 1 : -1; wg.rotation.z = (wg.userData._restRotZ || 0) - side * Math.abs(reach) - dir * reach * 0.3; });
                } else {
                    pet.feet.forEach(f => { f.rotation.x = (f.userData._restRotX || 0) - Math.max(0, reach) * 0.6; });
                    if (pet.tail) pet.tail.rotation.y = Math.sin(pet.t * 14) * 0.28;   // excited wag throughout
                }
                pet.ears.forEach(eo => { eo.rotation.x = (eo.userData._restRotX || 0) + Math.max(0, reach) * 0.25; });
                pet.eyes.forEach(ey => { ey.scale.y = ey.userData._restScaleY; });
            }
            return;
        }
        pet.action = null;   // done → fall through to idle
        pet.wrap.rotation.y = Math.PI;   // undo any spin (happy)
    }

    // Ease the walk intensity toward its target (1 while wandering, 0 while idle)
    const target = pet.walking ? 1 : 0;
    pet.walkAmt += (target - pet.walkAmt) * Math.min(1, delta * 6);
    const w = pet.walkAmt;
    const idle = 1 - w;        // idle-only motions fade out as the walk fades in
    const ix = pet.idle;

    // Occasional eased pulse on a randomized timer -> returns a smooth 0->1->0 envelope while active,
    // 0 otherwise. Keeps "sometimes blink / nod / flutter" from looking metronomic.
    const pulse = (key, minGap, maxGap, dur) => {
        if (ix[key + 'Ph'] > 0) {
            ix[key + 'Ph'] -= delta;
            if (ix[key + 'Ph'] <= 0) { ix[key + 'Ph'] = 0; ix[key + 'Nx'] = minGap + Math.random() * (maxGap - minGap); }
        } else {
            ix[key + 'Nx'] -= delta;
            if (ix[key + 'Nx'] <= 0) ix[key + 'Ph'] = dur;
        }
        if (ix[key + 'Ph'] <= 0) return 0;
        return Math.sin((1 - ix[key + 'Ph'] / dur) * Math.PI);   // ease in/out, peak mid-pulse
    };
    const blink   = pulse('blink', 2.5, 6.0, 0.14);          // eyes (runs even while walking)
    const nod     = pulse('nod',   5.0, 11.0, 0.7) * idle;   // gentle head bow
    const flutter = pulse('flut',  4.0, 9.0, 0.5) * idle;    // chick wing flutter / puppy ear twitch

    // Body: idle breathing bob + walk hop; idle gentle sway + walk waddle; occasional nod
    pet.wrap.position.y = Math.sin(t * 2.0) * 0.010 * idle + Math.abs(Math.sin(t * 8.0)) * 0.05 * w;
    pet.wrap.rotation.z = Math.sin(t * 8.0) * 0.10 * w + Math.sin(t * 0.8) * 0.02 * idle;
    pet.wrap.rotation.x = nod * 0.16;

    // Feet: alternate forward/back swing while walking (at rest when idle)
    const swing = Math.sin(t * 8.0) * 0.7 * w;
    pet.feet.forEach((f, i) => {
        f.rotation.x = (f.userData._restRotX || 0) + swing * ((i % 2 === 0) ? 1 : -1);
    });

    // Puppy tail wag (a little always, more while walking)
    if (pet.tail) pet.tail.rotation.y = Math.sin(t * 6.0) * (0.15 + 0.25 * w);

    // Ears: walk bounce + occasional idle twitch
    pet.ears.forEach((e, i) => {
        e.rotation.x = (e.userData._restRotX || 0) + Math.sin(t * 8.0 + i) * 0.12 * w + flutter * 0.30;
    });

    // Chick wings: occasional flutter — fast flaps enveloped by the pulse (mirrored L/R)
    pet.wings.forEach((wg, i) => {
        wg.rotation.z = (wg.userData._restRotZ || 0) + flutter * Math.sin(t * 40.0) * 0.35 * ((i % 2 === 0) ? 1 : -1);
    });

    // Eyes: occasional blink — squash vertically toward (almost) closed at the peak
    pet.eyes.forEach((ey) => {
        ey.scale.y = ey.userData._restScaleY * (1 - 0.9 * blink);
    });
}

// Remove the entity's wrapper from its parent and dispose geometry. The caller clears its own
// reference (the pet window nulls glbPet; the world drops the entity from its list).
export function disposeGlbPetEntity(pet) {
    if (pet && pet.wrap) {
        try { if (pet.wrap.parent) pet.wrap.parent.remove(pet.wrap); } catch (e) {}
        pet.wrap.traverse(o => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
    }
}
