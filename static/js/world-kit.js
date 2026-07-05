// CC0 asset-kit prop loader — the hook for piloting model packs (Kenney/Quaternius etc.).
// Vendor GLBs under static/models/world-kit/ and reference them from world-layout.js entries
// via `variant` + `kitScale`. (The 2026-07 Kenney Nature Kit pilot was reverted — the angular
// kit look didn't match the chubby pastel world — so no GLBs ship right now.)
// kitProp() is builder-compatible with world.js PROP_BUILDERS: it returns a Group immediately
// and fills it when the GLB arrives — colliders and placement never wait on the network. If a
// model is missing or fails, the optional procedural fallback builder keeps the world whole.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();   // model name -> Promise<source scene>

function kitModel(name) {
    if (!cache.has(name)) {
        cache.set(name, loader.loadAsync(`/models/world-kit/${name}.glb`).then((gltf) => {
            gltf.scene.traverse((o) => {
                if (o.isMesh && o.material) {
                    o.material.roughness = 1;   // match the world's chalky non-metal look
                    o.material.metalness = 0;
                }
            });
            return gltf.scene;
        }));
    }
    return cache.get(name);
}

export function kitProp(name, { scale = 1, fallback = null } = {}) {
    const g = new THREE.Group();
    kitModel(name).then((src) => {
        const inst = src.clone(true);   // clones share geometry + materials — cheap per placement
        inst.scale.setScalar(scale);
        inst.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        g.add(inst);
    }).catch((e) => {
        console.warn(`[world-kit] ${name} 로드 실패 — 프로시저럴 폴백 사용:`, e.message || e);
        if (fallback) g.add(fallback());
    });
    return g;
}
