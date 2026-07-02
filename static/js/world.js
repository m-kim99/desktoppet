// Pet world (월드): a small diorama scene where the GLB pets live together, opened from the tray.
// World-mode step 2 skeleton: renderer, sky, lights and the render loop. The stage (grass island +
// props + camera controls), the pets and their wandering arrive in the next steps of the plan.
import * as THREE from 'three';

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

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
    clock.getDelta();   // keep the clock warm; entities consume the delta from step 4 on
    renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);
