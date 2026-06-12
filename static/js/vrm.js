const urlParams = new URLSearchParams(window.location.search);
const isRenderMode = urlParams.get('mode') === 'render'; // Whether it's render mode (for OBS capture)
// --- Panoramic-rendering-specific variables ---
let cubeCamera, cubeRenderTarget, panoMesh, panoCamera, panoShaderMaterial;
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { SplatMesh } from '@sparkjsdev/spark';
let isVRM1 = true;
let currentMixer = null;
let idleAction = null;
let breathAction = null;
let blinkAction = null;

// Variables related to auto-hiding the model on mouse hover
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let isAutoHideEnabled = false;           // Auto-hide feature toggle
let isModelHiddenByHover = false;        // Whether the model is currently hidden due to hovering
let hoverCheckTimeout = null;            // Debounce timer
let mixerTimeScaleBeforeHide = 1;        // The animation speed before hiding
let animationsPausedForHide = false;     // Flag whether the animation is paused due to hiding
const HOVER_CHECK_INTERVAL = 33;         // Detection interval (ms), about 30fps
const FADE_DURATION = 120;               // Fade-animation duration (ms), shortened to reduce ghosting
let hideTransitionTimer = null;          // Record the hide timer to avoid overlapping

// Pause/resume animation playback while hidden, to avoid wasting resources
function pauseModelAnimationsForHide() {
    if (!animationsPausedForHide && currentMixer) {
        mixerTimeScaleBeforeHide = currentMixer.timeScale ?? 1;
        currentMixer.timeScale = 0;
        animationsPausedForHide = true;
    }
}

function resumeModelAnimationsAfterHide() {
    if (animationsPausedForHide && currentMixer) {
        currentMixer.timeScale = mixerTimeScaleBeforeHide || 1;
    }
    animationsPausedForHide = false;
}

// renderer
// Detect the runtime environment
const isElectron = typeof require !== 'undefined' || navigator.userAgent.includes('Electron');

// Add a class based on the environment
document.body.classList.add(isElectron ? 'electron' : 'web');

// Optimize the renderer settings
const renderer = new THREE.WebGLRenderer();
// Add performance-optimization settings
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.max(1, window.devicePixelRatio));
renderer.setClearColor(0x00000000, 0);
renderer.xr.enabled = true;
// Use fetch to query the value of /cur_language
async function fetchLanguage() {
    try {
        const http_protocol = window.location.protocol;
        const HOST = window.location.host;
        let res = await fetch(`${http_protocol}//${HOST}/cur_language`);
        const data = await res.json();
        return data.language;
    } catch (error) {
        console.error('Error fetching language:', error);
        return 'zh-CN';
    }
}
async function t(key) {
    const currentLanguage = await fetchLanguage();
    return translations[currentLanguage][key] || key;
}
// Use fetch to query the value of /cur_language
async function fetchVRMConfig() {
    try {
        const http_protocol = window.location.protocol;
        const HOST = window.location.host;
        let res = await fetch(`${http_protocol}//${HOST}/vrm_config`);
        const data = await res.json();
        if(data.VRMConfig.name != 'default'){
            data.VRMConfig.selectedModelId = data.VRMConfig.selectedNewModelId;
            data.VRMConfig.selectedMotionIds = data.VRMConfig.selectedNewMotionIds;
        }
        if (data.VRMConfig.selectedGaussSceneId == ''){
            data.VRMConfig.selectedGaussSceneId = 'transparent';
        }
        console.log(data.VRMConfig);
        return data.VRMConfig;
    } catch (error) {
        console.error('Error fetching VRMConfig:', error);
        return   {
            name: 'default',
            enabledExpressions: false,
            enabledMotions: false,
            selectedModelId: 'alice', // Select the Alice model by default
            defaultModels: [], // Store the default models
            userModels: [],     // Store user-uploaded models
            defaultMotions: [], // Store the default motions
            userMotions: [],     // Store user-uploaded motions
            selectedMotionIds: [],
            gaussDefaultScenes: [],   // GAUSS
            gaussUserScenes: [],      // GAUSS
            selectedGaussSceneId: 'transparent',
        };
    }
}
// A summoned "friend" window carries its model id via ?model=... — it loads that model
// instead of the configured one and is treated as a non-main pet (no wander/idle-talk).
const friendModelId = new URLSearchParams(window.location.search).get('model');
const modelConfig = await fetchVRMConfig();

// ==========================================
// NEW: Initialize Motion Map for ID Lookup
// ==========================================
const motionUrlMap = new Map();

function initMotionMap(config) {
    motionUrlMap.clear();
    const allMotions = [...(config.defaultMotions || []), ...(config.userMotions || [])];
    
    allMotions.forEach(motion => {
        if (motion.path) {
            try {
                let motionUrl = new URL(motion.path, window.location.origin);
                motionUrl.protocol = window.location.protocol;
                motionUrl.host = window.location.host;
                const finalUrl = motionUrl.toString();

                // 1. Bind by ID (ensures uniqueness, for internal system logic)
                if (motion.id) {
                    motionUrlMap.set(motion.id, finalUrl);
                }

                // 2. Key: bind by display name (for the AI's semantic invocation)
                // This way, if the AI says "nod", as long as display_name is "nod", it matches
                if (motion.name) {
                    // If the name has spaces or special characters, the AI may handle it inconsistently; consider lowercasing or removing spaces
                    motionUrlMap.set(motion.name, finalUrl);
                    
                    // Extra compatibility: a name without the extension (in case the AI includes the .vrma suffix)
                    const nameWithoutExt = motion.name.replace(/\.[^/.]+$/, "");
                    if (nameWithoutExt !== motion.name) {
                        motionUrlMap.set(nameWithoutExt, finalUrl);
                    }
                }
            } catch (e) {
                console.warn(`[MotionMap] 解析路径失败: ${motion.name}`, e);
            }
        }
    });
    console.log("Motion ID & Name Map Initialized. ", motionUrlMap);
}
initMotionMap(modelConfig);
// ==========================================

const windowName = friendModelId ? ('friend_' + friendModelId) : modelConfig.name;
async function getVRMpath() {
    const vrmConfig = await fetchVRMConfig();
    const modelId = friendModelId || vrmConfig.selectedModelId;
    const defaultModel = vrmConfig.defaultModels.find(model => model.id === modelId) || vrmConfig.userModels.find(model => model.id === modelId);
    if (defaultModel) {
        // Replace the protocol and host in defaultModel.path
        let defaultModelURL = new URL(defaultModel.path);
        defaultModelURL.protocol = window.location.protocol;
        defaultModelURL.host = window.location.host;
        return defaultModelURL.toString();
    } else {
        const userModel = vrmConfig.userModels.find(model => model.id === modelId);
        if (userModel) {
            // Replace the protocol and host in userModel.path
            let userModelURL = new URL(userModel.path);
            userModelURL.protocol = window.location.protocol;
            userModelURL.host = window.location.host;
            return userModelURL.toString();
        }
        else {
            return `${window.location.protocol}//${window.location.host}/vrm/Alice.vrm`;
        }
    }
}

async function getVRMname() {
    const vrmConfig = await fetchVRMConfig();
    const modelId = friendModelId || vrmConfig.selectedModelId;
    const defaultModel = vrmConfig.defaultModels.find(model => model.id === modelId) || vrmConfig.userModels.find(model => model.id === modelId);
    if (defaultModel) {
        return defaultModel.name;
    } else {
        const userModel = vrmConfig.userModels.find(model => model.id === modelId);
        if (userModel) {
            return userModel.name;
        }
        else {
            return 'Alice';
        }
    }
}

const vrmPath = await getVRMpath();
console.log(vrmPath);
// Enable shadows (if needed)
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

document.body.appendChild( renderer.domElement );

// camera
let camera;
if (isRenderMode) {
    // Panoramic mode: a base camera is still needed to drive the renderer, but the core is the CubeCamera
    camera = new THREE.PerspectiveCamera(30.0, window.innerWidth / window.innerHeight, 0.1, 20.0);
    
    // Initialize the cube render target (2048 resolution recommended for panoramic clarity)
    cubeRenderTarget = new THREE.WebGLCubeRenderTarget(2048, {
        format: THREE.RGBAFormat,
        generateMipmaps: true,
        magFilter: THREE.LinearFilter
    });
    cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeRenderTarget);
    // Set the camera at head height (~1.5m), slightly forward (1m) for the best view
    cubeCamera.position.set(0, 1.5, 1);

    // Panoramic-conversion shader material: map the 6 cube faces to a 2:1 plane
    panoShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tCube: { value: cubeRenderTarget.texture }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,

        fragmentShader: `
            varying vec2 vUv;
            uniform samplerCube tCube;
            #define PI 3.141592653589793

            void main() {
                // --- 关键修改：将 UV.x 映射从 [0, 1] 改变偏移量 ---
                // 原来是: vUv.x * 2.0 * PI - PI
                // 修改为直接乘 2PI，这样 0.5 (中心) 对应的就是 PI (正前方 -Z)
                float longitude = vUv.x * 2.0 * PI; 
                
                float latitude = vUv.y * PI - PI / 2.0;

                vec3 dir;
                dir.x = cos(latitude) * sin(longitude);
                dir.y = sin(latitude);
                dir.z = cos(latitude) * cos(longitude);

                gl_FragColor = textureCube(tCube, dir);
            }
        `,
        side: THREE.DoubleSide
    });

    // Create a full-screen overlay plane and an orthographic camera
    panoMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), panoShaderMaterial);
    panoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
} else {
    // Normal mode: keep the original code
    camera = new THREE.PerspectiveCamera(30.0, window.innerWidth / window.innerHeight, 0.1, 20.0);
}

camera.position.set( 0.0, 1.0, 4.0 );
camera.far = 1000; 
camera.updateProjectionMatrix();

// camera controls
const controls = new OrbitControls( camera, renderer.domElement );
let controlsEnabledBeforeAutoHide = true;   
controls.screenSpacePanning = true;
controls.target.set( 0.0, 1.0, 0.0 );
controls.update();

// scene
const scene = new THREE.Scene();

// light
const light = new THREE.DirectionalLight( 0xffffff, 2.0 );  // lowered from Math.PI to reduce contrast
light.position.set( 1, 3, 2 ).normalize();
light.castShadow = true;                       // Key
light.shadow.mapSize.set( 2048, 2048 );        // Precision

// Make the shadow camera cover the area near the character (tune to your scene size)
const camSize = 4;
light.shadow.camera.left   = -camSize;
light.shadow.camera.right  =  camSize;
light.shadow.camera.top    =  camSize;
light.shadow.camera.bottom = -camSize;
light.shadow.camera.near   = 0.1;
light.shadow.camera.far    = 20;
scene.add( light );

const transformControl = new TransformControls( camera, renderer.domElement );
transformControl.addEventListener('change', () => {
    const obj = transformControl.object;
    if (transformControl.getMode() === 'scale' && obj) {
        
        // Get the axis the user is currently dragging (X, Y, Z)
        const axis = transformControl.axis; 
        
        // If the user clicks the center point or a plane, axis may be 'XYZ', 'XY', etc.
        // We only handle single-axis dragging to enforce uniform scaling
        let s = obj.scale.x; // Default value

        if (axis === 'X') {
            s = obj.scale.x;
        } else if (axis === 'Y') {
            s = obj.scale.y;
        } else if (axis === 'Z') {
            s = obj.scale.z;
        } else {
            // For center scaling (XYZ), it's already uniform, so no handling needed
            return;
        }

        // Check whether they're already equal, to avoid redundant assignments
        if (obj.scale.y !== s || obj.scale.z !== s || obj.scale.x !== s) {
            obj.scale.set(s, s, s);
        }
    }
});
// While the user drags the model, disable OrbitControls to keep the camera from spinning
transformControl.addEventListener( 'dragging-changed', function ( event ) {
    controls.enabled = ! event.value;
});

// Default to 'translate' (move mode); can also be 'rotate' or 'scale'
transformControl.setMode('translate'); 

scene.add( transformControl.getHelper() ); // Add the gizmo/helper

let currentSceneGroup = null;          // The current scene root node, for unloading it all at once

/* One config fetch is enough; the outer code already awaited fetchVRMConfig(), so reuse it */
async function loadGaussScene() {
    /* ---------- 1. Read the config ---------- */
    const cfg        = await fetchVRMConfig();
    const sceneId    = cfg.selectedGaussSceneId;
    const defaultArr = cfg.gaussDefaultScenes || [];
    const userArr    = cfg.gaussUserScenes    || [];

    /* ---------- 2. Build the URL ---------- */
    let sceneURL = null;
    if (sceneId === 'transparent') {
        /* Transparent scene -> don't download the spz */
        sceneURL = 'transparent';
    } else {
        const hit = [...defaultArr, ...userArr].find(s => s.id === sceneId);
        if (!hit) {
            console.warn(`[SceneLoader] 找不到 id=${sceneId} 的场景，回退到 transparent`);
            sceneURL = 'transparent';
        } else {
            // Build the absolute address from the relative path
            const url = new URL(hit.path);
            url.protocol = window.location.protocol;
            url.host     = window.location.host;
            sceneURL     = url.toString();
        }
    }

    /* ---------- 3. Unload the old scene ---------- */
    if (currentSceneGroup) {
        scene.remove(currentSceneGroup);
        currentSceneGroup.traverse(o => {
            if (o.dispose) o.dispose();      // SplatMesh has its own dispose
        });
        currentSceneGroup = null;
    }

    /* ---------- 4. Build the new scene ---------- */
    const group = new THREE.Group();
    group.name = `gaussScene_${sceneId}`;

    if (sceneURL === 'transparent') {
        /* ------ 4.1 Transparent shadow ground ------ */
        const groundGeo = new THREE.PlaneGeometry(20, 20);
        const shadowMat = new THREE.ShadowMaterial({ opacity: 0.4 });
        const ground    = new THREE.Mesh(groundGeo, shadowMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        group.add(ground);
    } else {
        /* ------ 4.2 Load the .spz ------ */
        const splat = new SplatMesh({ url: sceneURL });
        let splat_height = 0;
        let splat_scale = 2;
        if (sceneId === 'space') {
            splat_height = 1.55;
        }else if (sceneId === 'home') {
            splat_height = 1.6;
        }else if (sceneId === 'sea') {
            splat_height = 2.4;
            splat_scale = 4;
        }
        // First scale/translate to center at the feet; tune the exact values per model
        splat.quaternion.set(1, 0, 0, 0);
        splat.position.set(0, splat_height, 2);
        splat.scale.set(splat_scale, splat_scale, splat_scale);
        splat.receiveShadow = true;
        group.add(splat);
    }

    /* ---------- 5. Attach to the scene ---------- */
    scene.add(group);
    currentSceneGroup = group;
    console.log(`[SceneLoader] 场景 ${sceneId} 加载完成`);
}

/* ------------------------------------------------------------------ */
/* Call once during initialization                                                    */
/* ------------------------------------------------------------------ */
await loadGaussScene();


// lookat target
const lookAtTarget = new THREE.Object3D();
camera.add( lookAtTarget );

// Add ambient light to soften the overall look
const ambientLight = new THREE.AmbientLight( 0xffffff, 0.55 );  // raised from 0.1 to soften contrast (fill light)
scene.add( ambientLight );

// gltf and vrm
let currentVrm = undefined;
let glbPet = null;                          // Non-VRM .glb "pet" model (no humanoid rig / morphs)
const glbLoader = new GLTFLoader();         // Plain loader for .glb pets (no VRM plugin)
let currentVrmWrapper = new THREE.Group(); // New: a group used to wrap the VRM
scene.add(currentVrmWrapper);              // New: add it to the scene from the start
const loader = new GLTFLoader();
loader.crossOrigin = 'anonymous';

// ---------------- New: fix parsing crashes caused by some models' non-standard SpringBone config ----------------
loader.register((parser) => {
    return {
        name: 'VRMSpringBoneBugFixPlugin',
        beforeRoot: () => {
            const json = parser.json;
            if (!json || !json.extensions) return;

            // Fix VRM 1.0 SpringBone
            if (json.extensions.VRMC_springBone) {
                const sb = json.extensions.VRMC_springBone;
                if (!sb.springs) sb.springs = [];
                if (!sb.colliders) sb.colliders = [];
                if (!sb.colliderGroups) sb.colliderGroups = [];
                
                sb.springs.forEach(spring => {
                    if (spring) {
                        if (!spring.joints) spring.joints = [];
                        if (!spring.colliderGroups) spring.colliderGroups = [];
                    }
                });
                
                sb.colliderGroups.forEach(group => {
                    if (group && !group.colliders) group.colliders = [];
                });
            }

            // Fix VRM 0.0 spring bones (SecondaryAnimation)
            if (json.extensions.VRM && json.extensions.VRM.secondaryAnimation) {
                const sa = json.extensions.VRM.secondaryAnimation;
                if (!sa.boneGroups) sa.boneGroups = [];
                if (!sa.colliderGroups) sa.colliderGroups = [];
                
                sa.boneGroups.forEach(group => {
                    if (group) {
                        if (!group.bones) group.bones = [];
                        if (!group.colliderGroups) group.colliderGroups = [];
                    }
                });
                
                sa.colliderGroups.forEach(group => {
                    if (group && !group.colliders) group.colliders = [];
                });
            }
        }
    };
});
// -----------------------------------------------------------------------------------------

loader.register( ( parser ) => {

    return new VRMLoaderPlugin(parser); 

} );

loader.register( ( parser ) => {
    return new VRMAnimationLoaderPlugin( parser );
} );

// Function to set a natural pose
function setNaturalPose(vrm) {
    if (!vrm.humanoid) return;
    let v = 1;
    if (!isVRM1){
        v = -1;
    }
    // 1. Adjust the arms: change 0.4 to 0.45 to bring them closer to the body, and add x-axis to tilt them slightly forward for a more relaxed look
    const leftArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
    if (leftArm) {
        leftArm.rotation.z = -0.45 * Math.PI * v; 
        leftArm.rotation.x = 0.05; // Arms tilt slightly forward
    }

    const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
    if (rightArm) {
        rightArm.rotation.z = 0.45 * Math.PI * v;
        rightArm.rotation.x = 0.05; // Arms tilt slightly forward
    }
    
    // Keep the original wrist logic
    const leftHand = vrm.humanoid.getNormalizedBoneNode('leftHand');
    if (leftHand) {
        leftHand.rotation.z = 0.1 * v; // Wrists bend naturally
        leftHand.rotation.x = 0.05;
    }
    const rightHand = vrm.humanoid.getNormalizedBoneNode('rightHand');
    if (rightHand) {
        rightHand.rotation.z = -0.1 * v; // Wrists bend naturally
        rightHand.rotation.x = 0.05;
    }

    // Add natural finger curl (if the model supports it)
    const fingerBones = [
        'leftThumbProximal', 'leftThumbIntermediate', 'leftThumbDistal',
        'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
        'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
        'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
        'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
        'rightThumbProximal', 'rightThumbIntermediate', 'rightThumbDistal',
        'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
        'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
        'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
        'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'
    ];

    fingerBones.forEach(boneName => {
        const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
        if (bone) {
            // Set different curl amounts per finger part
            if (boneName.includes('Thumb')) {
                // Thumb slightly inward
                bone.rotation.y = boneName.includes('left') ? 0.35 : -0.35;
            } else if (boneName.includes('Proximal')) {
                // Proximal phalanx bends slightly
                bone.rotation.z = boneName.includes('left') ? -0.35 * v : 0.35 * v;
            } else if (boneName.includes('Intermediate')) {
                // Middle phalanx bends slightly
                bone.rotation.z = boneName.includes('left') ? -0.45 * v : 0.45 * v;
            } else if (boneName.includes('Distal')) {
                // Distal phalanx bends slightly
                bone.rotation.z = boneName.includes('left') ? -0.3 * v : 0.3 * v;
            }
        }
    });
}

// Time offsets for idle motions, so they don't sync up
const idleOffsets = {
    body: Math.random() * Math.PI * 2,
    leftArm: Math.random() * Math.PI * 2,
    rightArm: Math.random() * Math.PI * 2,
    head: Math.random() * Math.PI * 2,
    spine: Math.random() * Math.PI * 2
};

// Added in the global-variable area - improved idle-animation management
let idleAnimations = [];
let currentIdleAnimationIndex = 0;
let idleAnimationAction = null;
let isLoadingAnimations = false;
let idleAnimationManager = null; // The new idle-animation manager
let defaultPoseAction = null; // Default-pose action
let useVRMAIdleAnimations = true; // Whether to use VRM-A's idle animations
let isIdleAnimationModeChanging = false; // Prevent repeated switching


// The complete idle-animation manager class - fixed version
class IdleAnimationManager {
    constructor(vrm, mixer) {
        this.vrm = vrm;
        this.mixer = mixer;
        
        // Core action references
        this.currentIdleAction = null;      // VRMA idle action
        this.defaultPoseAction = null;      // Default T-pose/A-pose reset action
        this.proceduralIdleAction = null;   // Procedural breathing/micro-motion action
        this.currentOneShotAction = null;   // The one-shot action currently playing (new)

        // State flags
        this.isTransitioning = false;
        this.animationQueue = [];
        this.currentIndex = 0;
        
        // Parameter config
        this.transitionDuration = 0.5; // Standard transition time
        this.pauseBetweenAnimations = 1.5;
        this.idleWeight = 1.0; 
        this.isActive = false;
        this.currentMode = 'none'; // 'vrma', 'procedural', 'none'
        
        // Listener reference, used to remove the old listener on conflict
        this._onOneShotFinished = null; 

        // Initialize the base actions
        this.createDefaultPoseAction();
        this.createProceduralIdleAction();
        
        console.log('IdleAnimationManager initialized (Conflict Fix Version)');
    }

    createDefaultPoseAction() {
        try {
            const defaultPoseClip = this.createDefaultPoseClip();
            this.defaultPoseAction = this.mixer.clipAction(defaultPoseClip);
            this.defaultPoseAction.setLoop(THREE.LoopOnce);
            this.defaultPoseAction.clampWhenFinished = true;
            this.defaultPoseAction.setEffectiveWeight(0);
        } catch (error) {
            console.error('Error creating default pose action:', error);
        }
    }

    createProceduralIdleAction() {
        try {
            const idleClip = createIdleClip(this.vrm);
            if (!idleClip) return;
            this.proceduralIdleAction = this.mixer.clipAction(idleClip);
            this.proceduralIdleAction.setLoop(THREE.LoopRepeat);
            this.proceduralIdleAction.setEffectiveWeight(0); 
        } catch (error) {
            console.error('Error creating procedural idle action:', error);
        }
    }
    
    createDefaultPoseClip() { return super.createDefaultPoseClip ? super.createDefaultPoseClip() : this._createDefaultPoseClipImpl(); }
    _createDefaultPoseClipImpl() {
         const tracks = [];
        const duration = 1.0;
        const fps = 30;
        const frameCount = duration * fps;
        const times = [];
        for (let i = 0; i <= frameCount; i++) times.push(i / fps);

        const bonesToReset = ['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot']; 
        
        bonesToReset.forEach(boneName => {
            const bone = this.vrm.humanoid.getNormalizedBoneNode(boneName);
            if (!bone) return;
            const naturalRotation = this.getNaturalRotation(boneName);
            const values = [];
            times.forEach((time, index) => {
                if (index === 0) values.push(...bone.quaternion.toArray());
                else {
                    const progress = time / duration;
                    const easedProgress = this.easeInOutCubic(progress);
                    const currentQuat = new THREE.Quaternion().fromArray(values.slice((index - 1) * 4, index * 4));
                    const interpolatedQuat = currentQuat.clone().slerp(naturalRotation, easedProgress);
                    values.push(...interpolatedQuat.toArray());
                }
            });
            tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', times, values));
        });
        return new THREE.AnimationClip('defaultPose', duration, tracks);
    }
    
    easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    
    getNaturalRotation(boneName) { 
         const euler = new THREE.Euler(0, 0, 0);
         const v = isVRM1 ? 1 : -1;
         
         if(boneName === 'leftUpperArm') {
             euler.set(0.05, 0, -0.45 * Math.PI * v);
         }
         else if(boneName === 'rightUpperArm') {
             euler.set(0.05, 0, 0.45 * Math.PI * v);
         }
         else if(boneName === 'leftHand') {
             euler.set(0.05, 0, 0.1 * v);
         }
         else if(boneName === 'rightHand') {
             euler.set(0.05, 0, -0.1 * v);
         }
         else if(boneName === 'leftUpperLeg') {
             euler.set(0, 0.05 * v, 0.04 * v);
         }
         else if(boneName === 'rightUpperLeg') {
             euler.set(0, -0.05 * v, -0.04 * v);
         }

         const q = new THREE.Quaternion();
         q.setFromEuler(euler);
         return q;
    }
    
    setAnimationQueue(animations) {
        this.animationQueue = [...animations];
        this.currentIndex = 0;
    }

    startIdleLoop() {
        if (this.currentOneShotAction && this.currentOneShotAction.isRunning()) return;
        
        if (this.animationQueue.length === 0) {
            this.switchToProceduralMode();
            return;
        }
        
        this.currentMode = 'vrma';
        this.isActive = true;
        this.playNextVRMAAnimation();
    }
    
    playNextVRMAAnimation() {
        if (!this.isActive || this.currentMode !== 'vrma' || this.animationQueue.length === 0) return;
        if (this.currentOneShotAction && this.currentOneShotAction.isRunning()) return;
        if (this.isTransitioning) return;

        const animation = this.animationQueue[this.currentIndex];
        this.playVRMAAnimation(animation);
        
        const previousIndex = this.currentIndex;
        if (this.animationQueue.length > 1) {
            let newIndex;
            do { newIndex = Math.floor(Math.random() * this.animationQueue.length); } 
            while (newIndex === previousIndex);
            this.currentIndex = newIndex;
        }
    }
    
    playVRMAAnimation(animationData) {
        if (!animationData || !animationData.animation) {
            this.scheduleNextVRMAAnimation();
            return;
        }

        try {
            const clip = createVRMAnimationClip(animationData.animation, this.vrm);
            if (!clip) return;

            if (this.currentIdleAction) {
                this.currentIdleAction.stop();
            }

            this.currentIdleAction = this.mixer.clipAction(clip);
            this.currentIdleAction.setLoop(THREE.LoopOnce);
            this.currentIdleAction.clampWhenFinished = true;
            this.currentIdleAction.reset();
            this.currentIdleAction.setEffectiveWeight(1.0); 
            this.currentIdleAction.play();
            this.currentIdleAction.fadeIn(0.5);

            const onFinished = (event) => {
                if (event.action === this.currentIdleAction) {
                    this.mixer.removeEventListener('finished', onFinished);
                    if (this.currentMode === 'vrma' && !this.currentOneShotAction) {
                        this.onVRMAAnimationFinished();
                    }
                }
            };
            this.mixer.addEventListener('finished', onFinished);

        } catch (error) {
            console.error('Error playing VRMA:', error);
            this.scheduleNextVRMAAnimation();
        }
    }

    onVRMAAnimationFinished() {
        if (this.currentOneShotAction) return; 

        this.isTransitioning = true;
        
        if (this.currentIdleAction) this.currentIdleAction.fadeOut(1.0);
        
        if (this.defaultPoseAction) {
            this.defaultPoseAction.reset().setEffectiveWeight(1.0).play();
            this.defaultPoseAction.fadeIn(0.5);
        }

        setTimeout(() => {
            if (this.currentOneShotAction) { this.isTransitioning = false; return; }
            
            if (this.defaultPoseAction) this.defaultPoseAction.fadeOut(0.5);
            this.isTransitioning = false;
            
            setTimeout(() => {
                if (!this.currentOneShotAction && this.currentMode === 'vrma') {
                    this.playNextVRMAAnimation();
                }
            }, 300);
        }, 1500);
    }

    scheduleNextVRMAAnimation() {
        setTimeout(() => {
            if (!this.currentOneShotAction && this.currentMode === 'vrma') this.playNextVRMAAnimation();
        }, 1000);
    }

    async playOneShotAnimation(url) {
        if (!url) return;
        console.log(`[IdleManager] Requesting One-Shot: ${url}`);

        if (this.currentOneShotAction) {
            if (this._onOneShotFinished) {
                this.mixer.removeEventListener('finished', this._onOneShotFinished);
                this._onOneShotFinished = null;
            }
            this.currentOneShotAction.stop();
            this.currentOneShotAction = null;
        }

        const fadeDuration = 0.3; 
        
        if (this.currentMode === 'vrma' && this.currentIdleAction) {
            this.currentIdleAction.fadeOut(fadeDuration);
        }
        if (this.currentMode === 'procedural' && this.proceduralIdleAction) {
            this.proceduralIdleAction.fadeOut(fadeDuration);
        }
        if (this.defaultPoseAction) {
            this.defaultPoseAction.fadeOut(fadeDuration);
        }

        try {
            const gltf = await new Promise((resolve, reject) => {
                loader.load(url, resolve, undefined, reject);
            });
            const vrmAnimations = gltf.userData.vrmAnimations;
            if (!vrmAnimations || vrmAnimations.length === 0) throw new Error('No VRMA found');
            
            const clip = createVRMAnimationClip(vrmAnimations[0], this.vrm);
            if (!clip) throw new Error('Failed to create clip');

            const action = this.mixer.clipAction(clip);
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
            action.reset();
            action.setEffectiveWeight(1.0);
            action.play();
            action.fadeIn(fadeDuration);

            this.currentOneShotAction = action;

            this._onOneShotFinished = (e) => {
                if (e.action === action) {
                    console.log(`[IdleManager] One-Shot finished: ${url}`);
                    this.mixer.removeEventListener('finished', this._onOneShotFinished);
                    this._onOneShotFinished = null;
                    
                    this.resetToIdle();
                }
            };
            this.mixer.addEventListener('finished', this._onOneShotFinished);

        } catch (err) {
            console.error('[IdleManager] Failed to play one-shot:', err);
            this.resetToIdle(); 
        }
    }

    resetToIdle() {
        console.log('[IdleManager] Resetting to Idle state...');
        const fadeDuration = 0.5;

        if (this.currentOneShotAction) {
            this.currentOneShotAction.fadeOut(fadeDuration);
            const oldAction = this.currentOneShotAction;
            setTimeout(() => {
                oldAction.stop(); 
                if (this.currentOneShotAction === oldAction) {
                    this.currentOneShotAction = null;
                }
            }, fadeDuration * 1000);
        }

        if (useVRMAIdleAnimations) {
            this.switchToVRMAMode(fadeDuration);
        } else {
            this.switchToProceduralMode(fadeDuration);
        }
    }

    switchToVRMAMode(fadeInTime = 0.5) {
        this.stopProceduralAnimations();
        this.currentMode = 'vrma';
        this.isActive = true;

        if (this.animationQueue.length > 0) {
            if (!this.currentIdleAction || !this.currentIdleAction.isRunning()) {
                this.playNextVRMAAnimation();
            } else {
                this.currentIdleAction.enabled = true;
                this.currentIdleAction.setEffectiveWeight(1.0);
                this.currentIdleAction.fadeIn(fadeInTime);
            }
        } else {
            this.switchToProceduralMode();
        }
    }

    switchToProceduralMode(fadeInTime = 0.5) {
        this.stopVRMAAnimations();
        this.currentMode = 'procedural';
        this.isActive = true;

        if (this.proceduralIdleAction) {
            this.proceduralIdleAction.enabled = true;
            this.proceduralIdleAction.reset();
            this.proceduralIdleAction.play();
            this.proceduralIdleAction.setEffectiveWeight(1.0); 
            this.proceduralIdleAction.fadeIn(fadeInTime);
        } else {
            this.createProceduralIdleAction();
            if (this.proceduralIdleAction) this.proceduralIdleAction.play();
        }
    }

    stopVRMAAnimations() {
        if (this.currentIdleAction) this.currentIdleAction.fadeOut(0.5);
        if (this.defaultPoseAction) this.defaultPoseAction.fadeOut(0.5);
    }

    stopProceduralAnimations() {
        if (this.proceduralIdleAction) this.proceduralIdleAction.fadeOut(0.5);
    }

    stopAllAnimations() {
        console.log('Stopping all animations...');
        this.isActive = false;
        if (this.currentIdleAction) this.currentIdleAction.stop();
        if (this.proceduralIdleAction) this.proceduralIdleAction.stop();
        if (this.defaultPoseAction) this.defaultPoseAction.stop();
        if (this.currentOneShotAction) this.currentOneShotAction.stop();
        this.currentMode = 'none';
    }
}

// Switch the idle-animation mode
async function toggleIdleAnimationMode() {
    if (isIdleAnimationModeChanging || !idleAnimationManager) {
        return;
    }
    
    isIdleAnimationModeChanging = true;
    useVRMAIdleAnimations = !useVRMAIdleAnimations;
    
    console.log(`Switching idle animation mode to: ${useVRMAIdleAnimations ? 'VRMA' : 'Procedural'}`);
    
    try {
        if (useVRMAIdleAnimations) {
            // Switch to VRMA animations
            if (idleAnimations.length === 0) {
                console.log('Loading VRMA animations...');
                await loadIdleAnimations();
            }
            
            if (idleAnimationManager) {
                idleAnimationManager.setAnimationQueue(idleAnimations);
                idleAnimationManager.switchToVRMAMode();
            }
        } else {
            // Switch to procedural animations
            if (idleAnimationManager) {
                idleAnimationManager.switchToProceduralMode();
            }
        }
        
        // Update the button state
        updateIdleAnimationButton();
        
    } catch (error) {
        console.error('Error switching idle animation mode:', error);
        // Roll back the state on error
        useVRMAIdleAnimations = !useVRMAIdleAnimations;
    } finally {
        isIdleAnimationModeChanging = false;
    }
}

// Update the idle-animation button state
async function updateIdleAnimationButton() {
    const button = document.getElementById('idle-animation-handle');
    if (button) {
        button.style.color = useVRMAIdleAnimations ?  '#ff6b35': '#28a745';
        button.innerHTML = useVRMAIdleAnimations ? 
            '<i class="fas fa-stop"></i>' : 
            '<i class="fas fa-play"></i>';
        button.title = useVRMAIdleAnimations ? 
            await t('UsingVRMAAnimations') || 'Using VRMA Animations' : 
            await t('UsingProceduralAnimations') || 'Using Procedural Animations';
    }
}

// Get all VRMA files in the animation directory
async function getAnimationFiles() {
  try {
    const cfg = await fetchVRMConfig();
    const motionPool = [...(cfg.defaultMotions || []), ...(cfg.userMotions || [])];

    // Take the selected motions
    const urls = (cfg.selectedMotionIds || [])
      .map(id => motionPool.find(m => m.id === id))
      .filter(Boolean)
      .map(item => {
        try {
          // Core fix: pass window.location.origin to handle relative paths
          const urlObj = new URL(item.path, window.location.origin);
          urlObj.protocol = window.location.protocol;
          urlObj.host     = window.location.host;
          return urlObj.toString();
        } catch (e) {
          console.error(`[AnimationFiles] 无法构造有效URL: ${item.path}`, e);
          return null;
        }
      })
      .filter(u => u !== null); // Remove invalid URLs

    // If nothing is selected, return the default fallback animation
    if (urls.length === 0) {
      const base = `${window.location.protocol}//${window.location.host}/vrm/animations/`;
      const fallback = [
        "greeting.vrma", "akimbo.vrma", "play_fingers.vrma", "scratch_head.vrma",
        "stretch.vrma", "shoot.vrma", "peace_sign.vrma", "show_full_body.vrma",
        "squat.vrma", "model_pose.vrma", "spin.vrma"
      ].map(file => base + file);
      
      console.warn('没有选中任何有效动作，使用默认目录下的兜底动画');
      return fallback;
    }

    return urls;

  } catch (err) {
    console.error('获取动画列表失败：', err);
    return [`${window.location.protocol}//${window.location.host}/vrm/animations/greeting.vrma`];
  }
}

// Load the VRMA animation file
async function loadVRMAAnimation(url) {
    return new Promise((resolve, reject) => {
        loader.load(
            url,
            (gltf) => {
                const vrmAnimations = gltf.userData.vrmAnimations;
                if (vrmAnimations && vrmAnimations.length > 0) {
                    resolve(vrmAnimations[0]);
                } else {
                    reject(new Error('No VRM animation found in file'));
                }
            },
            (progress) => {
                console.log(`Loading animation ${url}...`, 100.0 * (progress.loaded / progress.total), '%');
            },
            (error) => {
                console.error(`Error loading animation ${url}:`, error);
                reject(error);
            }
        );
    });
}

// Load all idle animations
async function loadIdleAnimations() {
    if (isLoadingAnimations) return;
    isLoadingAnimations = true;
    
    console.log('Loading idle animations...');
    
    try {
        const animationFiles = await getAnimationFiles();
        idleAnimations = [];
        
        for (const file of animationFiles) {
            try {
                const animation = await loadVRMAAnimation(file);
                idleAnimations.push({
                    animation: animation,
                    file: file,
                    name: file.split('/').pop().replace('.vrma', '')
                });
                console.log(`Loaded animation: ${file}`);
            } catch (error) {
                console.warn(`Failed to load animation: ${file}`, error);
            }
        }
        
        console.log(`Successfully loaded ${idleAnimations.length} idle animations`);
        
    } catch (error) {
        console.error('Error loading idle animations:', error);
    } finally {
        isLoadingAnimations = false;
    }
}

async function startIdleAnimationLoop() {
    if (!idleAnimationManager) {
        console.error('Idle animation manager not available');
        return;
    }
    
    console.log(`Starting idle animation with mode: ${useVRMAIdleAnimations ? 'VRMA' : 'Procedural'}`);
    
    if (useVRMAIdleAnimations) {
        // Use VRMA animations
        if (idleAnimations.length === 0) {
            console.log('Loading VRMA animations...');
            await loadIdleAnimations();
        }
        
        if (idleAnimations.length > 0) {
            idleAnimationManager.setAnimationQueue(idleAnimations);
            idleAnimationManager.switchToVRMAMode();
        } else {
            console.warn('No VRMA animations available, falling back to procedural');
            idleAnimationManager.switchToProceduralMode();
        }
    } else {
        // Use procedural animations
        idleAnimationManager.switchToProceduralMode();
    }
}

// Procedural idle animation (as a fallback)
function useProceduralIdleAnimation() {
    if (!currentVrm) return;
    
    const idleClip = createIdleClip(currentVrm);
    idleAction = currentMixer.clipAction(idleClip);
    idleAction.setLoop(THREE.LoopRepeat);
    idleAction.play();
}

// Generate the idle-animation clip - fixed version
function createIdleClip(vrm) {
    const tracks = [];
    const fps = 30;
    const duration = 600;
    const frameCount = duration * fps;
    
    // Generate the time array
    const times = [];
    for (let i = 0; i <= frameCount; i++) {
        times.push(i / fps);
    }
    
    // VRM-version detection
    const v = (vrm.meta.metaVersion === '1') ? 1 : -1;
    
    // List of bones to animate
    const animatedBones = [
        'spine', 'chest', 'neck', 'head',
        'leftUpperArm', 'leftLowerArm', 'leftHand', 'leftShoulder',
        'rightUpperArm', 'rightLowerArm', 'rightHand', 'rightShoulder'
    ];
    
    animatedBones.forEach(boneName => {
        const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
        if (!bone) return;
        
        const values = [];
        
        // Compute the rotation value for each time point
        times.forEach(time => {
            let euler = new THREE.Euler(0, 0, 0);
            
            // Use a periodic function so the value is the same at t=0 and t=duration
            const cycleTime = (time / duration) * 200 * Math.PI; // 0 to 2π
            
            switch (boneName) {
                case 'spine':
                    euler.set(
                        Math.sin(cycleTime * 0.6 + idleOffsets.body) * 0.02,     
                        0,                                                    
                        Math.cos(cycleTime * 0.5 + idleOffsets.body) * 0.015    
                    );
                    break;
                    
                case 'chest':
                    euler.set(
                        Math.sin(cycleTime * 0.6 + idleOffsets.body) * 0.01,     
                        0,                                                    
                        Math.cos(cycleTime * 0.5 + idleOffsets.body) * 0.0075   
                    );
                    break;
                    
                case 'neck':
                    euler.set(
                        Math.cos(cycleTime * 1.2 + idleOffsets.head) * 0.01,     
                        Math.sin(cycleTime * 1.5 + idleOffsets.head) * 0.02,     
                        0                                                     
                    );
                    break;
                    
                case 'head':
                    euler.set(
                        Math.sin(cycleTime * 1.0 + idleOffsets.head) * 0.02,     
                        Math.sin(cycleTime * 1.5 + idleOffsets.head) * 0.03,     
                        Math.cos(cycleTime * 0.8 + idleOffsets.head) * 0.01      
                    );
                    break;
                    
                case 'leftUpperArm':
                    euler.set(
                        Math.cos(cycleTime * 0.7 + idleOffsets.leftArm) * 0.03, 
                        Math.sin(cycleTime * 0.6 + idleOffsets.leftArm) * 0.02,  
                        -0.4 * Math.PI * v + Math.sin(cycleTime * 1.5 + idleOffsets.leftArm) * 0.03
                    );
                    break;
                    
                case 'leftLowerArm':
                    euler.set(
                        0,                                                   
                        0,                                                   
                        -Math.sin(cycleTime * 1.5 + idleOffsets.leftArm) * 0.02 
                    );
                    break;
                    
                case 'leftHand':
                    euler.set(
                        0.05,                                                
                        0,                                                   
                        0.1 * v + Math.sin(cycleTime * 1.2 + idleOffsets.leftArm) * 0.015 
                    );
                    break;
                    
                case 'leftShoulder':
                    euler.set(
                        0,                                                   
                        0,                                                   
                        Math.sin(cycleTime * 0.7 + idleOffsets.leftArm) * 0.02 
                    );
                    break;
                    
                case 'rightUpperArm':
                    euler.set(
                        Math.cos(cycleTime * 0.8 + idleOffsets.rightArm) * 0.03,  
                        Math.sin(cycleTime * 0.64 + idleOffsets.rightArm) * 0.02, 
                        0.4 * Math.PI * v + Math.sin(cycleTime * 1.5 + idleOffsets.rightArm) * 0.03 
                    );
                    break;
                    
                case 'rightLowerArm':
                    euler.set(
                        0,                                                    
                        0,                                                    
                        Math.sin(cycleTime * 1.5 + idleOffsets.rightArm) * 0.02 
                    );
                    break;
                    
                case 'rightHand':
                    euler.set(
                        0.05,                                                 
                        0,                                                    
                        -0.1 * v + Math.sin(cycleTime * 1.2 + idleOffsets.rightArm) * 0.015 
                    );
                    break;
                    
                case 'rightShoulder':
                    euler.set(
                        0,                                                    
                        0,                                                    
                        Math.sin(cycleTime * 0.8 + idleOffsets.rightArm) * 0.02  
                    );
                    break;
                    
                default:
                    euler.set(0, 0, 0);
                    break;
            }
            
            // Convert Euler angles to a quaternion and add to the value array
            const quaternion = new THREE.Quaternion();
            quaternion.setFromEuler(euler);
            values.push(...quaternion.toArray());
        });
        
        // Create the quaternion keyframe track
        const track = new THREE.QuaternionKeyframeTrack(
            bone.name + '.quaternion',
            times,
            values
        );
        
        tracks.push(track);
    });
    
    // Create and return the animation clip
    return new THREE.AnimationClip('idle', duration, tracks);
}


function createBreathClip(vrm) {
    const tracks = [];
    const duration = 4; // One breathing cycle every 4 seconds
    const fps = 30;
    const frameCount = duration * fps;
    
    const times = [];
    for (let i = 0; i <= frameCount; i++) {
        times.push(i / fps);
    }
    
    // Breathing scale animation
    const scaleValues = [];
    times.forEach(time => {
        const breathScale = 1 + Math.sin(time * Math.PI / 2) * 0.006; // A more natural breathing rhythm
        scaleValues.push(breathScale, breathScale, breathScale);
    });
    
    const scaleTrack = new THREE.VectorKeyframeTrack(
        vrm.scene.name + '.scale',
        times,
        scaleValues
    );
    
    tracks.push(scaleTrack);
    return new THREE.AnimationClip('breath', duration, tracks);
}

function createBlinkClip(vrm) {
    if (!vrm.expressionManager) return null;
    
    const tracks = [];
    const duration = 6; // 6-second cycle, including a random interval
    const fps = 30;
    const frameCount = duration * fps;
    
    const times = [];
    for (let i = 0; i <= frameCount; i++) {
        times.push(i / fps);
    }
    
    // Create a blink pattern: blink at random time points
    const blinkValues = [];
    times.forEach(time => {
        let blinkValue = 0;
        
        // A single blink at 1.5s
        if (time >= 1.5 && time <= 1.6) {
            const progress = (time - 1.5) / 0.2;
            blinkValue = Math.sin(progress * Math.PI);
        }
        // A double blink at 4s
        else if (time >= 3.8 && time <= 4.4) {
            const localTime = time - 3.8;
            if (localTime < 0.15) {
                blinkValue = Math.sin((localTime / 0.15) * Math.PI);
            } else if (localTime > 0.25 && localTime < 0.4) {
                blinkValue = Math.sin(((localTime - 0.25) / 0.15) * Math.PI);
            }
        }
        
        blinkValues.push(blinkValue);
    });
    
    const blinkTrack = new THREE.NumberKeyframeTrack(
        vrm.expressionManager.getExpressionTrackName('blink'),
        times,
        blinkValues
    );
    
    tracks.push(blinkTrack);
    return new THREE.AnimationClip('blink', duration, tracks);
}

/**
 * Stop the animation and audio of the specified voice chunk
 * @param {string|number} chunkId the voice chunk's ID
 */
function stopChunkAnimation(chunkId) {
    const chunkState = chunkAnimations.get(chunkId);
    if (!chunkState) return;

    console.log(`正在停止 Chunk ${chunkId} 的动画和音频`);

    if (chunkState.animationId) {
        cancelAnimationFrame(chunkState.animationId);
    }
    if (chunkState.audio) {
        chunkState.audio.pause();
        chunkState.audio.removeAttribute('src'); // Fully release the resources
        chunkState.audio.load();
    }
    if (chunkState.audioSource) {
        chunkState.audioSource.disconnect();
    }

    chunkAnimations.delete(chunkId);

    // If all voice chunks have ended, reset the expression
    if (chunkAnimations.size === 0 && currentVrm && currentVrm.expressionManager) {
        console.log('所有语音块播放完毕，重置表情。');
        currentVrm.expressionManager.resetValues();
        currentVrm.expressionManager.setValue('neutral', 1.0);
    }
}

/**
 * Stop all currently playing voice animations
 */
function stopAllChunkAnimations() {
    console.log('正在停止所有的口型同步动画。');
    for (const chunkId of chunkAnimations.keys()) {
        stopChunkAnimation(chunkId);
    }
    chunkAnimations.clear();
    if (currentVrm && currentVrm.expressionManager) {
        currentVrm.expressionManager.resetValues();
        currentVrm.expressionManager.setValue('neutral', 1.0);
    }
}

/**
 * Final fixed version: scientific lip-sync based on formants (F1/F2)
 * Determines the mouth shape by finding where the two main energy peaks (F1, F2) sit in the vowel triangle
 */
function startChunkAnimation(chunkId, chunkState) {
    if (!chunkState || !chunkState.isPlaying || !chunkState.analyser) {
        return;
    }

    const analyser = chunkState.analyser;
    // Increase FFT precision; formant detection needs higher frequency resolution
    analyser.fftSize = 1024; // It was 256 before, too small to distinguish F1/F2
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const sampleRate = currentAudioContext.sampleRate;
    
    // Smoothing-interpolation variables
    let currentBlends = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    
    // Sensitivity setting (adjust to mic/TTS volume)
    const SENSITIVITY = 1.0; // If the mouth barely moves, increase this number
    const NOISE_GATE = 15;   // Noise-floor threshold

    function getFormant(minFreq, maxFreq) {
        // Convert a frequency to an array index
        const nyquist = sampleRate / 2;
        const startIndex = Math.floor((minFreq / nyquist) * bufferLength);
        const endIndex = Math.floor((maxFreq / nyquist) * bufferLength);
        
        let maxAmp = -Infinity;
        let maxIndex = -1;
        
        // Find the strongest peak within the given frequency range
        for (let i = startIndex; i <= endIndex; i++) {
            if (dataArray[i] > maxAmp) {
                maxAmp = dataArray[i];
                maxIndex = i;
            }
        }
        
        // Return the peak's frequency and intensity
        return {
            freq: (maxIndex / bufferLength) * nyquist,
            amp: maxAmp
        };
    }

    function animateChunk() {
        const currentState = chunkAnimations.get(chunkId);
        if (!currentState || !currentState.isPlaying) {
            // Zero it out when stopped
            if (currentVrm && currentVrm.expressionManager) {
                ['aa', 'ih', 'ou', 'ee', 'oh'].forEach(v => currentVrm.expressionManager.setValue(v, 0));
            }
            return;
        }

        currentState.animationId = requestAnimationFrame(animateChunk);

        // 1. Get the frequency-domain data
        analyser.getByteFrequencyData(dataArray);

        // 2. Detect the formants
        // F1 range: 200Hz - 1000Hz (determines mouth openness)
        // F2 range: 1000Hz - 3000Hz (determines tongue front/back position)
        const f1 = getFormant(200, 1000);
        const f2 = getFormant(1000, 3000);

        // 3. Compute the total volume (to control the mouth-opening amount)
        // Only compute the average energy of the main vocal band (200-4000Hz)
        let vocalEnergy = 0;
        const startBin = Math.floor((200 / (sampleRate/2)) * bufferLength);
        const endBin = Math.floor((4000 / (sampleRate/2)) * bufferLength);
        for(let i=startBin; i<endBin; i++) vocalEnergy += dataArray[i];
        const avgVol = vocalEnergy / (endBin - startBin);

        // 4. Mapping logic (the vowel triangle)
        let target = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
        
        if (avgVol > NOISE_GATE) {
            // Normalize the intensity
            const intensity = Math.min(1.0, (avgVol / 255) * SENSITIVITY);
            
            // --- Core algorithm: determine the vowel from the F1/F2 coordinates ---
            // The values are based on general vocal statistics and may need tuning
            
            if (f1.freq > 600) {
                // High F1 -> wide-open mouth -> A (aa)
                // Like "ah"
                target.aa = intensity;
            } 
            else if (f1.freq < 450 && f2.freq > 1800) {
                // Low F1 (closed mouth), high F2 (tongue front) -> I (ih)
                // Like "ee"
                target.ih = intensity;
                // The I sound usually carries a bit of E too
                target.ee = intensity * 0.3; 
            }
            else if (f1.freq < 450 && f2.freq < 1100) {
                // Low F1 (closed mouth), low F2 (tongue back) -> U (ou)
                // Like "oo"
                target.ou = intensity;
            }
            else if (f2.freq > 1600) {
                // The remaining high F2 -> E (ee)
                // Like "eh"
                target.ee = intensity;
                target.ih = intensity * 0.2;
            }
            else {
                // The rest -> O (oh) or a neutral sound
                // Like "oh"
                target.oh = intensity;
                target.ou = intensity * 0.3;
            }
        }

        // 5. Apply to the VRM
        if (currentVrm && currentVrm.expressionManager) {
            // Expression-suppression logic
            const expression = chunkState.expression;
            let limit = 1.0;
            if (expression && ['happy', 'surprised'].includes(expression)) {
                limit = 0.5; 
            }

            if (expression) {
                // Common emotion list (excludes blink to avoid interfering with auto-blinking, unless explicitly needed)
                const EMOTIONS = ['surprised', 'happy', 'angry', 'sad', 'neutral', 'relaxed'];
                
                // If the current command is an emotion expression, set it to 1.0 and the others to 0.0 (to prevent a blended grimace)
                if (EMOTIONS.includes(expression)) {
                    EMOTIONS.forEach(exp => {
                        currentVrm.expressionManager.setValue(exp, exp === expression ? 1.0 : 0.0);
                    });
                } else {
                    // For specific expressions like blink, apply directly
                    currentVrm.expressionManager.setValue(expression, 1.0);
                }
            }

            ['aa', 'ih', 'ou', 'ee', 'oh'].forEach(v => {
                const t = target[v] * limit;
                const c = currentBlends[v];
                // Dynamic smoothing: open the mouth fast (0.5), close it slow (0.1)
                const smooth = t > c ? 0.5 : 0.1; 
                currentBlends[v] = c + (t - c) * smooth;
                
                currentVrm.expressionManager.setValue(v, currentBlends[v]);
            });
        }
    }

    console.log(`Chunk ${chunkId}: 启动共振峰口型同步`);
    chunkState.animationId = requestAnimationFrame(animateChunk);
}

/**
 * Full version: a lip-sync playback function based on formants (F1/F2)
 * Adapted to the Promise-queue logic to ensure playback order while keeping all core algorithms
 */
async function startLipSyncForChunk(data) {
    return new Promise(async (resolve) => {
        const chunkId = data.chunkIndex;

        // 1. Initialize the Web Audio environment
        if (!currentAudioContext) {
            currentAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (currentAudioContext.state === 'suspended') {
            await currentAudioContext.resume();
        }

        // 2. Check the motion ID
        const incomingExpressions = data.expressions || [];
        if (idleAnimationManager) {
            const foundMotionId = incomingExpressions.find(exp => motionUrlMap.has(exp));
            if (foundMotionId) {
                const motionUrl = motionUrlMap.get(foundMotionId);
                if (motionUrl) {
                    console.log(`[LipSync] 触发动作: ${foundMotionId}`);
                    idleAnimationManager.playOneShotAnimation(motionUrl);
                }
            }
        }

        // 3. Handle the expression logic (blend shapes)
        const ALLOW_EXPS = ['surprised','happy','angry','sad','neutral','relaxed','blink','blinkLeft','blinkRight'];
        const hitExpression = incomingExpressions.find(e => ALLOW_EXPS.includes(e));

        // 4. Create the playback state
        const chunkState = {
            isPlaying: true,
            animationId: null,
            audio: new Audio(data.audioDataUrl),
            audioSource: null,
            analyser: currentAudioContext.createAnalyser(),
            expression: hitExpression,
        };
        chunkAnimations.set(chunkId, chunkState);

        const { audio, analyser } = chunkState;
        
        // 5. Set the analyzer precision (optimized for F1/F2)
        analyser.fftSize = 1024; 
        analyser.smoothingTimeConstant = 0.3;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const sampleRate = currentAudioContext.sampleRate;

        // 6. Audio connection
        audio.crossOrigin = 'anonymous';
        const audioSource = currentAudioContext.createMediaElementSource(audio);
        audioSource.connect(analyser);
        analyser.connect(currentAudioContext.destination);
        chunkState.audioSource = audioSource;

        // 7. Inner function: find the formants
        function getFormant(minFreq, maxFreq) {
            const nyquist = sampleRate / 2;
            const startIndex = Math.floor((minFreq / nyquist) * bufferLength);
            const endIndex = Math.floor((maxFreq / nyquist) * bufferLength);
            let maxAmp = -Infinity;
            let maxIndex = -1;
            for (let i = startIndex; i <= endIndex; i++) {
                if (dataArray[i] > maxAmp) {
                    maxAmp = dataArray[i];
                    maxIndex = i;
                }
            }
            return { freq: (maxIndex / bufferLength) * nyquist, amp: maxAmp };
        }

        // 8. Inner variables: smoothing interpolation
        let currentBlends = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
        const SENSITIVITY = 1.0; 
        const NOISE_GATE = 15;

        // 9. Animation loop (the core algorithm)
        function animateChunk() {
            const currentState = chunkAnimations.get(chunkId);
            if (!currentState || !currentState.isPlaying) {
                if (currentVrm && currentVrm.expressionManager) {
                    ['aa', 'ih', 'ou', 'ee', 'oh'].forEach(v => currentVrm.expressionManager.setValue(v, 0));
                }
                return;
            }

            currentState.animationId = requestAnimationFrame(animateChunk);
            analyser.getByteFrequencyData(dataArray);

            const f1 = getFormant(200, 1000);
            const f2 = getFormant(1000, 3000);

            let vocalEnergy = 0;
            const startBin = Math.floor((200 / (sampleRate/2)) * bufferLength);
            const endBin = Math.floor((4000 / (sampleRate/2)) * bufferLength);
            for(let i=startBin; i<endBin; i++) vocalEnergy += dataArray[i];
            const avgVol = vocalEnergy / (endBin - startBin);

            let target = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
            
            if (avgVol > NOISE_GATE) {
                const intensity = Math.min(1.0, (avgVol / 255) * SENSITIVITY);
                if (f1.freq > 600) {
                    target.aa = intensity;
                } else if (f1.freq < 450 && f2.freq > 1800) {
                    target.ih = intensity;
                    target.ee = intensity * 0.3; 
                } else if (f1.freq < 450 && f2.freq < 1100) {
                    target.ou = intensity;
                } else if (f2.freq > 1600) {
                    target.ee = intensity;
                    target.ih = intensity * 0.2;
                } else {
                    target.oh = intensity;
                    target.ou = intensity * 0.3;
                }
            }

            if (currentVrm && currentVrm.expressionManager) {
                // Expression limiting
                const expression = currentState.expression;
                let limit = (expression && ['happy', 'surprised'].includes(expression)) ? 0.5 : 1.0;

                if (expression) {
                    const EMOTIONS = ['surprised', 'happy', 'angry', 'sad', 'neutral', 'relaxed'];
                    if (EMOTIONS.includes(expression)) {
                        EMOTIONS.forEach(exp => {
                            currentVrm.expressionManager.setValue(exp, exp === expression ? 1.0 : 0.0);
                        });
                    } else {
                        currentVrm.expressionManager.setValue(expression, 1.0);
                    }
                }

                ['aa', 'ih', 'ou', 'ee', 'oh'].forEach(v => {
                    const t = target[v] * limit;
                    const c = currentBlends[v];
                    const smooth = t > c ? 0.5 : 0.1; 
                    currentBlends[v] = c + (t - c) * smooth;
                    currentVrm.expressionManager.setValue(v, currentBlends[v]);
                });
            }
        }

        // 10. Bind audio events
        audio.onended = () => {
            stopChunkAnimation(chunkId);
            resolve(); // On playback end, resolve the Promise so the queue moves to the next item
        };

        audio.onerror = (err) => {
            console.error(`Chunk ${chunkId} 播放错误:`, err);
            stopChunkAnimation(chunkId);
            resolve(); // Must resolve on error too, or the queue will deadlock
        };

        // 11. Start playback and animation
        try {
            await audio.play();
            chunkState.animationId = requestAnimationFrame(animateChunk);
        } catch (error) {
            console.error("Audio.play 失败:", error);
            stopChunkAnimation(chunkId);
            resolve();
        }
    });
}

// ===== Plain .glb pet support (non-VRM): procedural foot/body "waddle", no rig/morphs =====
function disposeGlbPet() {
    if (glbPet && glbPet.wrap) {
        try { currentVrmWrapper.remove(glbPet.wrap); } catch (e) {}
        glbPet.wrap.traverse(o => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
    }
    glbPet = null;
}

async function loadGlbPet(url) {
    // Clear any existing VRM/GLB so only one pet is active
    if (currentVrm) { try { currentVrmWrapper.remove(currentVrm.scene); } catch (e) {} currentVrm = undefined; }
    disposeGlbPet();

    const gltf = await glbLoader.loadAsync(url);
    const root = gltf.scene;

    // Normalize: scale to a sensible height, center on XZ, feet on the ground (y=0)
    let box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3(); box.getSize(size);
    const targetH = 0.455;  // 0.65 reduced by a further 30%
    const s = size.y > 1e-4 ? targetH / size.y : 1;
    root.scale.setScalar(s);
    box = new THREE.Box3().setFromObject(root);
    const c = new THREE.Vector3(); box.getCenter(c);
    root.position.x -= c.x;
    root.position.z -= c.z;
    root.position.y -= box.min.y;

    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });

    // Wrapper carries the procedural bob/waddle so it never fights the model's own transforms
    const wrap = new THREE.Group();
    wrap.add(root);
    wrap.rotation.y = Math.PI;   // face the camera/light (model's front is -Z by default)
    currentVrmWrapper.add(wrap);

    const findAll = (re) => { const a = []; root.traverse(o => { if (re.test(o.name)) a.push(o); }); return a; };
    const findOne = (re) => { let r = null; root.traverse(o => { if (!r && re.test(o.name)) r = o; }); return r; };
    const feet = findAll(/foot|leg/i);
    feet.forEach(f => { f.userData._restRotX = f.rotation.x; });
    const tail = findOne(/tail/i);
    const ears = findAll(/ear/i);
    ears.forEach(e => { e.userData._restRotX = e.rotation.x; });

    glbPet = { wrap, root, feet, tail, ears, walking: false, walkAmt: 0, t: 0 };
    console.log('[GlbPet] loaded', url, '| feet:', feet.map(f => f.name));
    if (typeof hideModelSwitchingIndicator === 'function') { try { hideModelSwitchingIndicator(); } catch (e) {} }
}

function updateGlbPet(delta) {
    if (!glbPet) return;
    glbPet.t += delta;
    // Ease the walk intensity toward its target (1 while wandering, 0 while idle)
    const target = glbPet.walking ? 1 : 0;
    glbPet.walkAmt += (target - glbPet.walkAmt) * Math.min(1, delta * 6);
    const w = glbPet.walkAmt;
    const t = glbPet.t;

    // Body: gentle idle breathing bob + stronger hop while walking + side-to-side waddle lean
    const bob = Math.sin(t * 2.0) * 0.008 + Math.abs(Math.sin(t * 8.0)) * 0.05 * w;
    glbPet.wrap.position.y = bob;
    glbPet.wrap.rotation.z = Math.sin(t * 8.0) * 0.10 * w;          // waddle

    // Feet: alternate forward/back swing (no bones needed — they're separate nodes)
    const swing = Math.sin(t * 8.0) * 0.7 * w;
    glbPet.feet.forEach((f, i) => {
        const phase = (i % 2 === 0) ? 1 : -1;
        f.rotation.x = (f.userData._restRotX || 0) + swing * phase;
    });

    // Puppy tail wag (always a little, more while walking); ears bounce while walking
    if (glbPet.tail) glbPet.tail.rotation.y = Math.sin(t * 6.0) * (0.15 + 0.25 * w);
    glbPet.ears.forEach((e, i) => { e.rotation.x = (e.userData._restRotX || 0) + Math.sin(t * 8.0 + i) * 0.12 * w; });
}

let VRMname = await getVRMname();
showModelSwitchingIndicator(VRMname);
const __isGlbPet = /\.(glb|gltf)(\?|#|$)/i.test(vrmPath);
if (__isGlbPet) {
    loadGlbPet(vrmPath).catch(e => console.error('[GlbPet] load failed', e));
} else
loader.load(

    // URL of the VRM you want to load
    vrmPath,

    // called when the resource is loaded
    ( gltf ) => {

        const vrm = gltf.userData.vrm;
        currentMixer = new THREE.AnimationMixer(vrm.scene); // Create the animation mixer
        isVRM1 = vrm.meta.metaVersion === '1';
        VRMUtils.rotateVRM0(vrm); // Rotate the VRM to face straight forward
        // calling these functions greatly improves the performance
        // VRMUtils.removeUnnecessaryVertices( gltf.scene );

        // Add material fixes
        // gltf.scene.traverse((obj) => {
        // if (obj.isMesh && obj.material) {
        //     // fix the black-edge issue with transparent materials
        //     if (obj.material.transparent) {
        //         obj.material.alphaTest = 0.01;
        //         obj.material.depthWrite = true;
        //         obj.material.needsUpdate = true;
        //     }
            
        //     // ensure the correct blend mode
        //     obj.material.blending = THREE.NormalBlending;
        //     obj.material.premultipliedAlpha = false;
            
        //     // set the render order
        //     obj.renderOrder = obj.material.transparent ? 1 : 0;
        // }
        // });

        // VRMUtils.combineSkeletons( gltf.scene );
        // VRMUtils.combineMorphs( vrm );

        // Enable Spring Bone physics simulation
        if (vrm.springBoneManager) {
            console.log('Spring Bone Manager found:', vrm.springBoneManager);
            // Spring Bone updates automatically inside vrm.update()
        }


        // Disable frustum culling
        vrm.scene.traverse( ( obj ) => {

            obj.frustumCulled = false;

        } );

        vrm.lookAt.target = camera;

        if (vrm.lookAt.applier) {
            vrm.lookAt.applier.yawLimit = 60.0;   // Max 60 degrees of left/right head turn
            vrm.lookAt.applier.pitchLimit = 30.0; // Max 30 degrees of up/down head tilt
        }

        currentVrm = vrm;
        console.log( vrm );
        currentVrmWrapper.add(vrm.scene); 
        
        // Make the model cast shadows
        vrm.scene.traverse((obj) => {
            if (obj.isMesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;   // Keep this if you also want the model itself to receive shadows
            }
        });
        // Set the natural pose
        setNaturalPose(vrm);

        if (vrm.expressionManager) {
            vrm.expressionManager.setValue('neutral', 1.0);
        }

        const breathClip = createBreathClip(vrm);
        breathAction = currentMixer.clipAction(breathClip);
        breathAction.setLoop(THREE.LoopRepeat);
        breathAction.play();

        const blinkClip = createBlinkClip(vrm);
        blinkAction = currentMixer.clipAction(blinkClip);
        blinkAction.setLoop(THREE.LoopRepeat);
        blinkAction.play();

        // Create the idle-animation manager
        idleAnimationManager = new IdleAnimationManager(vrm, currentMixer);

        // Start the idle-animation loop
        startIdleAnimationLoop();

        hideModelSwitchingIndicator();
    },

    (progress) => {
        console.log('Loading model...', 100.0 * (progress.loaded / progress.total), '%');
        // You can update the loading progress here
        updateModelLoadingProgress(progress.loaded / progress.total);
    },

    (error) => {
        console.error('Error loading model:', error);
        hideModelSwitchingIndicator();
        
        // If loading fails, try reverting to the previous model
        if (allModels.length > 1) {
            console.log('Attempting to load fallback model...');
            // Try loading the first model as a fallback
            if (currentModelIndex !== 0) {
                switchToModel(0);
            }
        }
    }

);

// Add subtitle-related variables in the global-variable area
let subtitleElement = null;
let currentSubtitleChunkIndex = -1;
let subtitleTimeout = null;
let isSubtitleEnabled = true; // Subtitles are on by default
let isDraggingSubtitle = false;
let subtitleOffsetX = 0;
let subtitleOffsetY = 0;

// Modify the subtitle-element initialization
function initSubtitleElement() {
    subtitleElement = document.createElement('div');
    subtitleElement.id = 'subtitle-container';
    subtitleElement.style.cssText = `
        position: fixed;
        top: 50%;  
        left: 50%;
        width: auto;
        max-width: 80%;
        transform: translateX(-50%);
        padding: 12px 24px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        border-radius: 8px;
        font-family: 'Arial', sans-serif;
        font-size: 1.2em;
        text-align: center;
        backdrop-filter: blur(10px);
        opacity: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
        z-index: 9998;
        white-space: pre-wrap;
        line-height: 1.5;
        cursor: move;
        user-select: none;
        min-width: 100px;
        max-width: 80%;
        width: max-content;
    `;

    // Add drag event listeners
    subtitleElement.addEventListener('mousedown', startDragSubtitle);
    document.addEventListener('mousemove', dragSubtitle);
    document.addEventListener('mouseup', endDragSubtitle);

    document.body.appendChild(subtitleElement);
}

// Improve the drag feature
function startDragSubtitle(e) {
    if (!isSubtitleEnabled) return;
    
    isDraggingSubtitle = true;
    
    // Get the subtitle element's initial position
    const rect = subtitleElement.getBoundingClientRect();
    
    // Compute the mouse's offset relative to the subtitle's center point
    subtitleOffsetX = e.clientX - (rect.left + rect.width / 2);
    subtitleOffsetY = e.clientY - rect.top;
    
    // Disable the transition effect
    subtitleElement.style.transition = 'none';
}

function dragSubtitle(e) {
    if (isDraggingSubtitle) {
        // Compute the target position of the subtitle's center point
        const centerX = e.clientX - subtitleOffsetX;
        const centerY = e.clientY - subtitleOffsetY;
        
        // Constrain within the window, keeping it horizontally centered
        const halfWidth = subtitleElement.offsetWidth / 2;
        const clampedX = Math.max(halfWidth, Math.min(centerX, window.innerWidth - halfWidth));
        
        // Keep it horizontally centered when setting the position
        subtitleElement.style.left = `${clampedX}px`;
        subtitleElement.style.transform = 'translateX(-50%)'; // Horizontally centered
        
        // Keep the vertical position unchanged
        const maxY = window.innerHeight - subtitleElement.offsetHeight;
        const clampedY = Math.max(0, Math.min(centerY, maxY));
        
        subtitleElement.style.top = `${clampedY}px`;
        subtitleElement.style.bottom = 'auto'; // Cancel the bottom positioning
    }
}

function endDragSubtitle() {
    if (isDraggingSubtitle) {
        isDraggingSubtitle = false;
        subtitleElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    }
}

// Modify the subtitle show/hide feature
function toggleSubtitle(enable) {
    isSubtitleEnabled = enable;
    if (subtitleElement) {
        subtitleElement.style.display = enable ? 'block' : 'none';
    }
}

/**
 * Extracted size-adjustment logic
 */
function adjustSubtitleSize() {
    if (!subtitleElement) return;
    const maxWidth = window.innerWidth * 0.8;
    subtitleElement.style.width = 'max-content';
    subtitleElement.style.minWidth = '100px';
    
    const rect = subtitleElement.getBoundingClientRect();
    if (rect.width > maxWidth) {
        subtitleElement.style.width = `${maxWidth}px`;
    }
}


let vmcLastSent = 0;
const VMC_SEND_INTERVAL = 1000 / 30;          // 30 fps
const VMC_BONES = [                           // VMC standard bone list
  'hips','spine','chest','upperChest','neck','head',
  'leftShoulder','leftUpperArm','leftLowerArm','leftHand',
  'rightShoulder','rightUpperArm','rightLowerArm','rightHand',
  'leftUpperLeg','leftLowerLeg','leftFoot','leftToes',
  'rightUpperLeg','rightLowerLeg','rightFoot','rightToes',
  // Fingers (optional)
  'leftThumbProximal','leftThumbIntermediate','leftThumbDistal',
  'leftIndexProximal','leftIndexIntermediate','leftIndexDistal',
  'leftMiddleProximal','leftMiddleIntermediate','leftMiddleDistal',
  'leftRingProximal','leftRingIntermediate','leftRingDistal',
  'leftLittleProximal','leftLittleIntermediate','leftLittleDistal',
  'rightThumbProximal','rightThumbIntermediate','rightThumbDistal',
  'rightIndexProximal','rightIndexIntermediate','rightIndexDistal',
  'rightMiddleProximal','rightMiddleIntermediate','rightMiddleDistal',
  'rightRingProximal','rightRingIntermediate','rightRingDistal',
  'rightLittleProximal','rightLittleIntermediate','rightLittleDistal'
];

function getVMCBoneData() {
  if (!currentVrm?.humanoid) return [];

  const boneData = [];
  
  // The VMC receiver usually expects the Hips position to be an absolute height relative to the ground
  // We need to get the Hips' world coordinates
  const hipsNode = currentVrm.humanoid.getNormalizedBoneNode('hips');
  let rootY = 0;
  if (hipsNode) {
      const worldPos = new THREE.Vector3();
      hipsNode.getWorldPosition(worldPos);
      // If the model was scaled, or the scene is offset, use world coordinates here
  }

  for (const name of VMC_BONES) {
    const node = currentVrm.humanoid.getNormalizedBoneNode(name);
    if (!node) continue;

    // Get the rotation relative to the parent (local rotation), since VMC transmits local rotation
    // Note: Hips needs special handling; it usually transmits world position
    
    // 1. Position handling
    // Only Hips needs to send a position; other bone positions are determined by bone length (the VMC receiver ignores non-Hips positions, or uses them for scaling)
    // For compatibility, we only send a real position for Hips and 0 for others (node.position would also work, but mind the conversion)
    
    let x = node.position.x;
    let y = node.position.y;
    let z = node.position.z;

    // Key coordinate-system conversion: ThreeJS (right-handed) -> Unity (left-handed)
    // Position: negate X
    const vmcPos = { x: -x, y: y, z: z };

    // 2. Rotation handling
    // ThreeJS: x, y, z, w
    // Unity:   x, -y, -z, w (the usual conversion formula)
    
    let qx = node.quaternion.x;
    let qy = node.quaternion.y;
    let qz = node.quaternion.z;
    let qw = node.quaternion.w;

    if (!isVRM1) {
        qx = -qx;
        qz = -qz;
    }

    const vmcRot = { 
        x: qx, 
        y: -qy, 
        z: -qz, 
        w: qw 
    };

    boneData.push({
        name: name,
        pos: vmcPos,
        rot: vmcRot
    });
  }
  return boneData;
}

// VRM1 -> VRM0 (the de-facto VMC standard)
const VRM1_TO_VMC0 = {
  happy:  'Joy',
  angry:  'Angry',
  sad:    'Sorrow',
  relaxed:'Fun',
  aa:     'A',
  ih:     'I',
  ou:     'U',
  ee:     'E',
  oh:     'O',
  blinkLeft:  'Blink_L',
  blinkRight: 'Blink_R',
  blink:      'Blink',
  surprised:  'Surprised',
  neutral:    'Neutral',
  lookDown:   'LookDown',
  lookUp:     'LookUp',
  lookLeft:   'LookLeft',
  lookRight:  'LookRight'
};

// Expressions to sync (trim as needed)
const VMC_BLEND_SHAPES = [
  // The five vowels
  'aa','ee','ih','oh','ou',
  'blink', 'blinkLeft', 'blinkRight',
  'surprised','happy','angry', 'sad', 'neutral', 'relaxed',
  'lookDown','lookUp','lookLeft','lookRight'
];

let lastBlendWeights = {}; // Throttle: only send when changed



function getVMCBlendData() {
  if (!currentVrm?.expressionManager) return [];
  
  const blendData = [];
  const mgr = currentVrm.expressionManager;

  for (const vrmName of VMC_BLEND_SHAPES) {
    const weight = mgr.getValue(vrmName);
    if (weight === undefined) continue;

    const vmcName = VRM1_TO_VMC0[vrmName];
    if (!vmcName) continue;
    
    // For data completeness, Warudo recommends sending every frame, or at least on change
    // You can throttle to save bandwidth, but it's best to send in a batch
    blendData.push({
        name: vmcName,
        weight: weight
    });
  }
  return blendData;
}
const vmcToVrmBone = {
  LeftIndexIntermediate: 'leftIndexIntermediate',
  RightIndexIntermediate:'rightIndexIntermediate',
  LeftMiddleIntermediate:'leftMiddleIntermediate',
  RightMiddleIntermediate:'rightMiddleIntermediate',
  LeftRingIntermediate:  'leftRingIntermediate',
  RightRingIntermediate: 'rightRingIntermediate',
  LeftLittleIntermediate:'leftLittleIntermediate',
  RightLittleIntermediate:'rightLittleIntermediate',
  LeftThumbIntermediate: 'leftThumbIntermediate',
  RightThumbIntermediate:'rightThumbIntermediate',
  LeftUpperArm:  'leftUpperArm',
  LeftLowerArm:  'leftLowerArm',
  LeftHand:      'leftHand',
  RightUpperArm: 'rightUpperArm',
  RightLowerArm: 'rightLowerArm',
  RightHand:     'rightHand',
  UpperChest:    'upperChest',
  Chest:         'chest',
  Spine:         'spine',
  Hips:          'hips',
  Neck:          'neck',
  Head:          'head',
};

// animate
const clock = new THREE.Clock();
clock.start();
let currentLookYaw = 0;   // Left/right yaw (Y axis)
let currentLookPitch = 0; // Up/down pitch (X axis)

let isPreviewing360 = false;
let debugSphere, debugCamera, debugControls;

function animate() {
    requestAnimationFrame(animate);
    
    const deltaTime = clock.getDelta();
    updatePointerLockMovement(deltaTime);
    const shouldSkipModelUpdate = isModelHiddenByHover && isAutoHideEnabled;

    if (glbPet && !shouldSkipModelUpdate) updateGlbPet(deltaTime);

    if (currentVrm && !shouldSkipModelUpdate) {
        // 1. Mixer update
        if (currentMixer) {
            currentMixer.update(deltaTime);
        }

        // 2. VMC receive update
        if (vmcReceiveEnabled) {
            for (const [vmcName, data] of vmcBoneBuffer) {
                let boneName = vmcToVrmBone[vmcName] ??
                            vmcName.charAt(0).toLowerCase() + vmcName.slice(1);
                
                if (boneName === 'neck' || boneName === 'head') continue;

                const node = currentVrm.humanoid.getNormalizedBoneNode(boneName);
                if (!node) continue;
                if (isVRM1) {
                    node.position.copy(data.position);
                    node.quaternion.copy(data.rotation);
                } else {
                    node.position.copy(data.position);
                    node.quaternion.set(-data.rotation.x, data.rotation.y, -data.rotation.z, data.rotation.w);
                }
            }
        } 

        // 3. Biomimetic gaze tracking (fully fixes the VRM 0.x coordinate-system orientation issue)
        const neck = currentVrm.humanoid.getNormalizedBoneNode('neck');
        const head = currentVrm.humanoid.getNormalizedBoneNode('head');

        if (neck && neck.parent) {
            const parent = neck.parent;
            const targetWorldPos = camera.position.clone();
            
            const localCameraPos = parent.worldToLocal(targetWorldPos.clone());
            const neckLocalPos = neck.position.clone();
            const viewVector = localCameraPos.sub(neckLocalPos);

            if (!isVRM1) {
                viewVector.z = -viewVector.z; 
                viewVector.x = -viewVector.x; 
            }

            const rawTargetYaw = Math.atan2(viewVector.x, viewVector.z);
            const horizontalDist = Math.sqrt(viewVector.x**2 + viewVector.z**2);
            const rawTargetPitch = Math.atan2(viewVector.y, horizontalDist);

            let targetYaw = rawTargetYaw * 0.6;
            let targetPitch = rawTargetPitch * 0.6;

            const yawLimit = THREE.MathUtils.degToRad(45);  
            const pitchUpLimit = THREE.MathUtils.degToRad(40);
            const pitchDownLimit = THREE.MathUtils.degToRad(20);
            const behindLimit = THREE.MathUtils.degToRad(110);

            if (Math.abs(rawTargetYaw) > behindLimit) {
                targetYaw = 0;
                targetPitch = 0;
            } else {
                targetYaw = THREE.MathUtils.clamp(targetYaw, -yawLimit, yawLimit);
                targetPitch = THREE.MathUtils.clamp(targetPitch, -pitchDownLimit, pitchUpLimit);
            }

            const lerpSpeed = 2.0 * deltaTime;
            currentLookYaw = THREE.MathUtils.lerp(currentLookYaw, targetYaw, lerpSpeed);
            currentLookPitch = THREE.MathUtils.lerp(currentLookPitch, targetPitch, lerpSpeed);

            let applyYaw = currentLookYaw;
            let applyPitch = -currentLookPitch; 

            if (!isVRM1) {
                applyYaw = currentLookYaw; 
                applyPitch = currentLookPitch; 
            }

            const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), applyYaw);
            const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), applyPitch);
            qYaw.multiply(qPitch);
            neck.quaternion.copy(qYaw);

            if (head) {
                const qHeadYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), applyYaw * 0.5);
                const qHeadPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), applyPitch * 0.5);
                qHeadYaw.multiply(qHeadPitch);
                head.quaternion.copy(qHeadYaw);
            }
        }

        // 4. VRM final update
        currentVrm.update(deltaTime);
    }

    // --- Render-logic branch (the core of panoramic rendering) ---
    if (isRenderMode) {
        if (isPreviewing360 && debugCamera) {
            // A. 360 preview mode: use the debug camera to rotate and look inside the sphere
            renderer.render(scene, debugCamera);
        } else {
            // B. Standard panoramic mode (2:1 unwrapped view)
            if (cubeCamera) {
                // Hide the panoramic projection plane before rendering, so it doesn't block the cube camera
                if (panoMesh) panoMesh.visible = false;
                
                // Let the cube camera capture the 360-degree scene
                cubeCamera.update(renderer, scene);
                
                // Restore the projection plane and render to the screen
                if (panoMesh) {
                    panoMesh.visible = true;
                    renderer.render(panoMesh, panoCamera);
                }
            }
        }
    } else {
        // C. Normal mode
        renderer.render(scene, camera);
    }
    
    // 5. VMC send logic
    const now = performance.now();
    if (window.vmcAPI && (now - vmcLastSent >= VMC_SEND_INTERVAL)) {
        vmcLastSent = now;
        const bones = getVMCBoneData();
        const blends = getVMCBlendData();
        if (bones.length > 0) {
            window.vmcAPI.sendVMCFrame({
                bones: bones,
                blends: blends
            });
        }
    }

    // 6. UI subtitle maintenance
    if (subtitleElement && !isDraggingSubtitle) {
        const rect = subtitleElement.getBoundingClientRect();
        if (rect.bottom > window.innerHeight || rect.right > window.innerWidth) {
            subtitleElement.style.left = '50%';
            subtitleElement.style.bottom = '30%';
            subtitleElement.style.top = 'auto';
            subtitleElement.style.transform = 'translateX(-50%)';
        }
    }
}

// --- Panoramic-preview toggle logic: fully height-aligned version ---

window.addEventListener('keydown', (e) => {
    // Only respond to the V key in render mode
    if (e.key.toLowerCase() === 'v' && isRenderMode) {
        if (!isPreviewing360) {
            // 1. Create the panoramic debug sphere
            // Set the radius to 5; not too big, not too small
            const geometry = new THREE.SphereGeometry(5, 60, 40);
            geometry.scale(-1, 1, 1); // Flip the sphere to look from inside out
            
            const material = new THREE.MeshBasicMaterial({
                map: cubeRenderTarget.texture, // Sample the panoramic camera's content in real time
                side: THREE.BackSide // Ensure only the inside is rendered
            });
            
            debugSphere = new THREE.Mesh(geometry, material);
            
            // --- Key sync: the sphere center must also be at 1.5m ---
            debugSphere.position.set(0, 1.5, 1);
            scene.add(debugSphere);
            
            // 2. Create the debug camera for preview
            debugCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
            
            // --- Key sync: keep the camera position exactly the same as cubeCamera ---
            debugCamera.position.set(0, 1.5, 1); 
            
            // 3. Initialize the controls
            debugControls = new OrbitControls(debugCamera, renderer.domElement);
            
            // --- Core fix: set the target at 1.5m for an eye-level view ---
            debugControls.target.set(0, 1.5, 0); 
            
            debugControls.enableZoom = false; // Disable zoom to simulate a fixed-point view
            debugControls.enablePan = false;  // Disable panning to prevent leaving the sphere
            debugControls.update(); // Must be called, otherwise the target doesn't take effect
            
            isPreviewing360 = true;
            console.log("进入 360 预览模式：已同步至 1.5m 平视高度");
        } else {
            // Exit preview mode
            if (debugSphere) {
                scene.remove(debugSphere);
                if (debugSphere.geometry) debugSphere.geometry.dispose();
                if (debugSphere.material) debugSphere.material.dispose();
            }
            if (debugControls) {
                debugControls.dispose();
            }
            isPreviewing360 = false;
            console.log("退出预览，恢复 2:1 平面图输出");
        }
    }
});

async function setVMCReceive (enable, syncExpr = false) {
  if (vmcReceiveEnabled!= enable){
    if (enable) {
      // Enter VMC mode: stop all local animation
      if (idleAnimationManager) idleAnimationManager.stopAllAnimations();
      if (breathAction) breathAction.stop();
      if (blinkAction)  blinkAction.stop();
      if (currentMixer) currentMixer.stopAllAction();
      // Clear the cache to prevent old data from 'jumping'
      vmcBoneBuffer.clear();
      vmcBlendBuffer.clear();

      // Enable procedural breathing and blinking
      currentMixer = new THREE.AnimationMixer(currentVrm.scene);
      const breathClip = createBreathClip(currentVrm);
      breathAction = currentMixer.clipAction(breathClip);
      breathAction.setLoop(THREE.LoopRepeat);
      breathAction.play();

      const blinkClip = createBlinkClip(currentVrm);
      blinkAction = currentMixer.clipAction(blinkClip);
      blinkAction.setLoop(THREE.LoopRepeat);
      blinkAction.play();


    } else {
      switchToModel(currentModelIndex, true);
    }
  };

  vmcReceiveEnabled = enable;
  vmcSyncExpression = syncExpr;
	console.log(`VMC receive enabled: ${enable}, sync expression: ${syncExpr}`);


};
let pointerLocked = false;          // Whether we're currently in PointerLock mode
let orbitControlsSaved = null;      // Store the OrbitControls instance
let pointerLockControls = null;     // PointerLockControls instance
const keyState = {};               // Key-press record
const moveSpeed = 5;               // Movement speed per second (m/s)

// Listen for key presses
function onKeyDown(e) {
    keyState[e.code] = true;
}
function onKeyUp(e) {
    keyState[e.code] = false;
}

// Update the camera position every frame
function updatePointerLockMovement(delta) {
    if (!pointerLocked || !pointerLockControls) return;

    const direction = new THREE.Vector3();
    const head = pointerLockControls.getObject();   // Camera container

    // Forward/back
    if (keyState['KeyW']) direction.z -= 1;
    if (keyState['KeyS']) direction.z += 1;
    // Left/right
    if (keyState['KeyA']) direction.x -= 1;
    if (keyState['KeyD']) direction.x += 1;
    // Up/down
    if (keyState['KeyQ']) direction.y -= 1;
    if (keyState['KeyE']) direction.y += 1;

    if (direction.lengthSq() === 0) return;

    direction.normalize().applyQuaternion(head.quaternion); // Convert to world direction
    head.position.addScaledVector(direction, moveSpeed * delta);
}

// Bind events on entering PointerLock
function enablePointerLockMovement() {
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
}

// Clean up on exiting PointerLock
function disablePointerLockMovement() {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    // Clear the key-press buffer
    for (const k in keyState) delete keyState[k];
}

const pttStyle = document.createElement('style');
pttStyle.textContent = `
    #ptt-floating-btn {
        position: fixed;
        bottom: 80px; /* 抬高一点防底部小白条 */
        left: 50%;
        transform: translateX(-50%) scale(0);
        width: 80px;   /* 增大尺寸，符合触控 */
        height: 80px;  /* 增大尺寸 */
        background: linear-gradient(135deg, #ff6b35, #ff8c5a);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 6px 16px rgba(255, 107, 53, 0.4); 
        cursor: pointer;
        z-index: 10002;
        transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s;
        user-select: none;
        touch-action: none; /* 必须，防止滑动页面 */
        -webkit-touch-callout: none; /* 防止长按弹出菜单 */
        opacity: 0;
        pointer-events: none;
    }
    #ptt-floating-btn.visible { 
        transform: translateX(-50%) scale(1); 
        opacity: 1;
        pointer-events: auto;
    }
    #ptt-floating-btn:active, #ptt-floating-btn.active { 
        transform: translateX(-50%) scale(0.9); 
        background: #e65c2b; 
    }
    #ptt-floating-btn i { 
        color: white; 
        font-size: 36px; /* 图标放大 */
    }
    .ptt-recording-pulse {
        position: absolute;
        width: 100%; height: 100%;
        border-radius: 50%;
        background: rgba(255, 107, 53, 0.5);
        animation: ptt-pulse-ring 1.2s infinite;
        z-index: -1;
    }
    @keyframes ptt-pulse-ring {
        0% { transform: scale(1); opacity: 0.5; }
        100% { transform: scale(2.2); opacity: 0; }
    }
`;
document.head.appendChild(pttStyle);

// Global state
let pttMainWs = null;
let pttAsrWs = null;
let pttMediaRecorder = null;
let pttAudioChunks = [];
let isPttActive = false;
let pttVisible = false;
// Initialize the control WS to the main UI
function initPttMainWs() {
    if (pttMainWs && pttMainWs.readyState === WebSocket.OPEN) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    pttMainWs = new WebSocket(`${protocol}//${window.location.host}/ws`);
    pttMainWs.onclose = () => setTimeout(initPttMainWs, 3000);
}

// Initialize the ASR WS
async function initPttAsrWs() {
    if (pttAsrWs && pttAsrWs.readyState === WebSocket.OPEN) return pttAsrWs;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    pttAsrWs = new WebSocket(`${protocol}//${window.location.host}/ws/asr`);
    
    return new Promise((resolve) => {
        pttAsrWs.onopen = () => {
            pttAsrWs.send(JSON.stringify({ type: "init" }));
            resolve(pttAsrWs);
        };
        pttAsrWs.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === "transcription" && msg.text && msg.is_final) {
                // On successful recognition, send to the main UI via the control WS
                if (pttMainWs && pttMainWs.readyState === WebSocket.OPEN) {
                    pttMainWs.send(JSON.stringify({ type: "set_user_input", data: { text: msg.text } }));
                    setTimeout(() => {
                        pttMainWs.send(JSON.stringify({ type: "trigger_send_message", data: {} }));
                    }, 300);
                }
            }
        };
    });
}

// Core transcode: WebM -> 16kHz WAV (Sherpa-specific)
async function pttEncodeWav(blob) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    
    const wavBuffer = new ArrayBuffer(44 + channelData.length * 2);
    const view = new DataView(wavBuffer);
    
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + channelData.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 16000 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, channelData.length * 2, true);

    for (let i = 0; i < channelData.length; i++) {
        const s = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([view], { type: 'audio/wav' });
}

// Initialize the PTT button and recording logic
// Initialize the PTT button and recording logic (supports long-press, mis-tap prevention, XR raycast)
function setupPttInteraction() {
    const floatingBtn = document.createElement('div');
    floatingBtn.id = 'ptt-floating-btn';
    floatingBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    document.body.appendChild(floatingBtn);

    let isRecordingRequested = false; // Prevent async bugs from ultra-fast clicking

    const startRecording = async (e) => {
        if (e.cancelable) e.preventDefault();
        if (isPttActive) return;
        isPttActive = true;
        isRecordingRequested = true;
        pttAudioChunks = [];
        
        floatingBtn.classList.add('active'); // Visual feedback
        floatingBtn.innerHTML = '<i class="fa-solid fa-microphone"></i><div class="ptt-recording-pulse"></div>';

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // If the user releases too fast, clean up right after permission is granted and don't start recording
            if (!isRecordingRequested) {
                stream.getTracks().forEach(t => t.stop());
                isPttActive = false;
                floatingBtn.classList.remove('active');
                floatingBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
                return;
            }

            pttMediaRecorder = new MediaRecorder(stream);
            pttMediaRecorder.ondataavailable = (ev) => pttAudioChunks.push(ev.data);
            pttMediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                
                // Only send if data was recorded (prevents sending an empty packet on an instant release)
                if (pttAudioChunks.length > 0) {
                    const webmBlob = new Blob(pttAudioChunks, { type: 'audio/webm' });
                    const wavBlob = await pttEncodeWav(webmBlob);
                    
                    const ws = await initPttAsrWs();
                    const reader = new FileReader();
                    reader.readAsDataURL(wavBlob);
                    reader.onloadend = () => {
                        ws.send(JSON.stringify({
                            type: 'audio_complete',
                            audio: reader.result.split(',')[1],
                            format: 'wav'
                        }));
                    };
                }
            };
            pttMediaRecorder.start();
        } catch (err) {
            console.error("Mic error:", err);
            isPttActive = false;
            floatingBtn.classList.remove('active');
            floatingBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        }
    };

    const stopRecording = (e) => {
        if (e && e.cancelable) e.preventDefault();
        isRecordingRequested = false;
        if (!isPttActive) return;
        isPttActive = false;
        
        floatingBtn.classList.remove('active');
        floatingBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        
        if (pttMediaRecorder && pttMediaRecorder.state === 'recording') {
            pttMediaRecorder.stop();
        }
    };

    // Use Pointer Events to perfectly handle mouse, touchscreen, and XR raycast
    floatingBtn.addEventListener('pointerdown', startRecording);
    floatingBtn.addEventListener('pointerup', stopRecording);
    floatingBtn.addEventListener('pointercancel', stopRecording);
    // Listen globally so releasing outside the button area still stops it
    window.addEventListener('pointerup', stopRecording);
    
    initPttMainWs();
}

let isTextInputReady = false;
function setupTextInteraction() {
    if (isTextInputReady) return;
    isTextInputReady = true;

    const textInputContainer = document.createElement('div');
    textInputContainer.id = 'text-input-container';
    textInputContainer.style.cssText = `
        position: fixed;
        bottom: 20px; /* 错开在橙色 PTT 按钮下方 */
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        display: flex;
        align-items: center;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(10px);
        padding: 8px 16px;
        border-radius: 24px;
        z-index: 10001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        width: 80%;
        max-width: 500px;
        transition: opacity 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        opacity: 0;
        pointer-events: none;
    `;

    const textInputField = document.createElement('input');
    textInputField.id = 'text-input-field';
    textInputField.type = 'text';
    textInputField.placeholder = '...';
    // Localize the placeholder to the current language
    t('vrmTextInputPlaceholder').then(v => { if (v) textInputField.placeholder = v; }).catch(() => {});
    textInputField.style.cssText = `
        flex: 1;
        background: transparent;
        border: none;
        color: white;
        font-size: 15px;
        outline: none;
        padding: 8px 4px;
    `;

    // Isolate events: prevent typing in the input box from triggering 3D-scene navigation shortcuts (e.g. W, A, S, D, T, R)
    ['keydown', 'keyup', 'keypress'].forEach(evt => {
        textInputField.addEventListener(evt, (e) => {
            e.stopPropagation();
            if (evt === 'keydown' && e.key === 'Enter') {
                e.preventDefault();
                sendTextInputMessage();
            }
        });
    });

    const textSendBtn = document.createElement('button');
    textSendBtn.id = 'text-send-btn';
    textSendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
    textSendBtn.style.cssText = `
        background: #ff6b35;
        color: white;
        border: none;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        margin-left: 8px;
        transition: transform 0.2s, background 0.2s;
        outline: none;
    `;
    textSendBtn.addEventListener('mouseenter', () => { textSendBtn.style.transform = 'scale(1.1)'; textSendBtn.style.background = '#e65c2b'; });
    textSendBtn.addEventListener('mouseleave', () => { textSendBtn.style.transform = 'scale(1)'; textSendBtn.style.background = '#ff6b35'; });
    textSendBtn.addEventListener('click', sendTextInputMessage);

    textInputContainer.appendChild(textInputField);
    textInputContainer.appendChild(textSendBtn);
    document.body.appendChild(textInputContainer);

    function sendTextInputMessage() {
        const text = textInputField.value.trim();
        if (!text) return;
        if (pttMainWs && pttMainWs.readyState === WebSocket.OPEN) {
            // 1. Send the user's input text
            pttMainWs.send(JSON.stringify({ type: "set_user_input", data: { text: text } }));
            // 2. Delay slightly to ensure the main program registers it, then trigger the conversation-generation command
            setTimeout(() => {
                pttMainWs.send(JSON.stringify({ type: "trigger_send_message", data: {} }));
            }, 300);
            textInputField.value = ''; 
        } else {
            console.warn("WS 未连接，尝试重连...");
            initPttMainWs();
        }
    }
    
    // Prevent clicking the panel from triggering the parent's interaction-collapse event, etc.
    textInputContainer.addEventListener('mousedown', (e) => e.stopPropagation());
    textInputContainer.addEventListener('touchstart', (e) => e.stopPropagation(), {passive: true});
}

// Show/hide the text-input box (shared by the control-panel button and the global shortcut).
// The state is derived from the container's current opacity, so the button and shortcut never get out of sync.
// Pass forceState to force a specific state; omit it to toggle. Returns the final visibility.
function setVrmTextInputVisible(forceState) {
    const container = document.getElementById('text-input-container');
    if (!container) return false;
    const isVisible = container.style.opacity === '1';
    const next = (typeof forceState === 'boolean') ? forceState : !isVisible;
    if (next) {
        container.style.opacity = '1';
        container.style.pointerEvents = 'auto';
        container.style.transform = 'translateX(-50%) translateY(0)';
        setTimeout(() => {
            const f = document.getElementById('text-input-field');
            if (f) f.focus();
        }, 300);
    } else {
        container.style.opacity = '0';
        container.style.pointerEvents = 'none';
        container.style.transform = 'translateX(-50%) translateY(20px)';
        const f = document.getElementById('text-input-field');
        if (f) f.blur();
    }
    // If the control panel's text button exists, sync its color state
    const btn = document.getElementById('text-toggle-handle');
    if (btn) btn.style.color = next ? '#007bff' : '#333333';
    return next;
}

const btn_width = 28;
const btn_height = 28;

function addcontrolPanel() {
    if (isRenderMode) {
        console.log('全景渲染模式：已跳过控制面板生成');
        return;
    }

    // Wait a short while to ensure the page is fully loaded
    setTimeout(async () => {
        // Create the control-panel container
        const controlPanel = document.createElement('div');
        controlPanel.id = 'control-panel';
        controlPanel.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 9999;
        opacity: 0;
        visibility: hidden;
        transform: translateX(20px);
        transition: opacity 0.3s ease, transform 0.3s ease, visibility 0.3s;
        pointer-events: none;
        `;

        // Inject global CSS to clear the mobile tap-highlight box
        const globalStyle = document.createElement('style');
        globalStyle.textContent = `
            #control-panel div, #sub-control-panel div {
                -webkit-tap-highlight-color: transparent;
            }
        `;
        document.head.appendChild(globalStyle);

        // ==========================================
        // ======= Create the left sub-panel (to hold extra buttons) =======
        // ==========================================
        const subPanel = document.createElement('div');
        subPanel.id = 'sub-control-panel';
        subPanel.style.cssText = `
            position: absolute;
            right: 100%;
            top: 0;
            margin-right: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            opacity: 0;
            visibility: hidden;
            /* 修复点 1: 将 0 改为具体的 translateX，并加上 scale(1) 锁定比例 */
            transform: translateX(10px) scale(1); 
            /* 修复点 2: 明确指定过渡属性，绝对不要用 all */
            transition: opacity 0.3s ease, transform 0.3s ease; 
            /* 修复点 3: 锁定变形原点在右侧，这样它展开时是向左伸展，而不是中心放大 */
            transform-origin: right center; 
            pointer-events: none;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            backdrop-filter: none !important;
        `;

        // Create the tooltip container
        const tooltipContainer = document.createElement('div');
        tooltipContainer.id = 'control-tooltip-container';
        tooltipContainer.style.cssText = `
            position: fixed;
            z-index: 10000;
            pointer-events: none;
            opacity: 0;
            transform: translateX(-10px);
            transition: all 0.3s ease;
        `;
        
        const tooltip = document.createElement('div');
        tooltip.id = 'control-tooltip';
        tooltip.style.cssText = `
            background: rgba(0, 0, 0, 0.85);
            color: white;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            white-space: nowrap;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            backdrop-filter: blur(8px);
        `;
        
        tooltipContainer.appendChild(tooltip);
        document.body.appendChild(tooltipContainer);
        
        // Tooltip display function - shown on the left
        function showTooltip(button, text) {
            const rect = button.getBoundingClientRect();
            tooltip.textContent = text;
            const topPosition = rect.top + (rect.height - tooltip.offsetHeight) / 2;
            tooltipContainer.style.left = `${rect.left - tooltip.offsetWidth - 15}px`;
            tooltipContainer.style.top = `${topPosition}px`;
            tooltipContainer.style.opacity = '1';
            tooltipContainer.style.transform = 'translateX(0)';
        }
        
        function hideTooltip() {
            tooltipContainer.style.opacity = '0';
            tooltipContainer.style.transform = 'translateX(-10px)';
        }
        
        const addHoverEffect = (button, text) => {
            button.addEventListener('mouseenter', (e) => {
                showTooltip(button, text);
            });
            button.addEventListener('mousemove', (e) => {
                const rect = button.getBoundingClientRect();
                const topPosition = rect.top + (rect.height - tooltip.offsetHeight) / 2;
                tooltipContainer.style.left = `${rect.left - tooltip.offsetWidth - 15}px`;
                tooltipContainer.style.top = `${topPosition}px`;
            });
            button.addEventListener('mouseleave', () => {
                hideTooltip();
            });
        };

        // [New] bind click and touch events to fix unresponsive or double-tap-required clicks on mobile
        function bindTapEvent(element, callback) {
            let touchMoved = false;
            element.addEventListener('touchstart', () => { touchMoved = false; }, { passive: true });
            element.addEventListener('touchmove', () => { touchMoved = true; }, { passive: true });
            element.addEventListener('touchend', (e) => {
                if (!touchMoved) {
                    e.preventDefault();
                    e.stopPropagation();
                    callback(e);
                }
            }, { passive: false });
            element.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                callback(e);
            });
        }

        // 1. Drag button
        const dragButton = document.createElement('div');
        dragButton.id = 'drag-handle';
        dragButton.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px;
            background: rgba(255,255,255,0.95); border: 2px solid rgba(0,0,0,0.1);
            border-radius: 50%; color: #333; cursor: pointer; -webkit-app-region: drag;
            display: flex; align-items: center; justify-content: center;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            transform 0.2s; user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
        `;
        const dragArea = document.createElement('div');
        dragArea.style.cssText = `position: absolute; top: 0; left: 0; width: 100%; height: 100%; -webkit-app-region: drag; z-index: 1;`;
        const iconContainer = document.createElement('div');
        iconContainer.innerHTML = '<i class="fa-solid fa-arrows-up-down-left-right"></i>';
        iconContainer.style.cssText = `position: relative; z-index: 2; pointer-events: none; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; -webkit-app-region: drag;`;
        dragButton.appendChild(dragArea);
        dragButton.appendChild(iconContainer);

        // 2. Lock-button logic
        const lockButton = document.createElement('div');
        lockButton.id = 'lock-handle';
        let isMouseLocked = false;
        const controlButtons = []; // Store all the buttons that need to be hidden

        async function initLockButton() {
            lockButton.innerHTML = '<i class="fas fa-lock-open"></i>';
            lockButton.style.cssText = `
                width: ${btn_width}px; height: ${btn_height}px;
                background: rgba(255,255,255,0.95); border: 2px solid rgba(0,0,0,0.1);
                border-radius: 50%; color: #28a745; cursor: pointer; -webkit-app-region: no-drag;
                display: flex; align-items: center; justify-content: center; font-size: 14px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
                user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
            `;
            lockButton.title = await t('UnlockWindow');
            updateLockButtonState();
        }

        async function updateLockButtonState() {
            if (isMouseLocked) {
                lockButton.innerHTML = '<i class="fas fa-lock"></i>';
                lockButton.style.color = '#dc3545';
                lockButton.title = await t('UnlockWindow');
            } else {
                lockButton.innerHTML = '<i class="fas fa-lock-open"></i>';
                lockButton.style.color = '#28a745';
                lockButton.title = await t('LockWindow');
            }
        }

        function hideOtherButtons() {
            // If the sub-panel is open, force it closed
            if (isSubPanelOpen) {
                isSubPanelOpen = false;
                updateMoreButtonState();
            }
            controlButtons.forEach(button => {
                if (button && button !== lockButton) {
                    button.style.display = 'none'; // Hide directly, letting the layout shrink naturally
                }
            });
            lockButton.style.marginBottom = '0';
            lockButton.style.marginTop = 'auto';
        }

        function showAllButtons() {
            controlButtons.forEach(button => {
                if (button && button !== lockButton) {
                    button.style.display = 'flex';
                    button.style.opacity = '1';
                    button.style.visibility = 'visible';
                    button.style.transform = 'scale(1)';
                }
            });
            lockButton.style.marginBottom = '';
            lockButton.style.marginTop = '';
        }

        lockButton.addEventListener('mouseenter', () => {
            lockButton.style.background = 'rgba(255,255,255,1)';
            lockButton.style.transform = 'scale(1.1)';
            lockButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
        });
        lockButton.addEventListener('mouseleave', () => {
            lockButton.style.background = 'rgba(255,255,255,0.95)';
            lockButton.style.transform = 'scale(1)';
            lockButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        });
        
        bindTapEvent(lockButton, (e) => {
            toggleMouseLock();
        });

        async function toggleMouseLock() {
            isMouseLocked = !isMouseLocked;
            if (isMouseLocked) {
                window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
                hideOtherButtons();
            } else {
                window.electronAPI.setIgnoreMouseEvents(false);
                showAllButtons();
            }
            updateLockButtonState();
            sendToMain('mouseLockStatus', { locked: isMouseLocked });
            updateButtonTooltips();
        }
        await initLockButton();

        // 3. Auto-hide button
        const hideButton = document.createElement('div');
        hideButton.id = 'hide-handle';
        let isAutoHideActive = false; 
        let autoHideDisabledByPointerLock = false; 

        async function initHideButton() {
            hideButton.innerHTML = '<i class="fas fa-eye"></i>';
            hideButton.style.cssText = `
                width: ${btn_width}px; height: ${btn_height}px;
                background: rgba(255,255,255,0.95); border: 2px solid rgba(0,0,0,0.1);
                border-radius: 50%; color: #6c757d; cursor: pointer; -webkit-app-region: no-drag;
                display: flex; align-items: center; justify-content: center; font-size: 14px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
                user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
            `;
            const hideDesc = await t('AutoHideDescription');
            hideButton.title = hideDesc || '鼠标悬停自动隐藏';
            updateHideButtonState();
        }

        async function updateHideButtonState() {
            if (isAutoHideActive) {
                hideButton.innerHTML = '<i class="fas fa-eye-slash"></i>';
                hideButton.style.color = '#ffc107';
                hideButton.title = await t('AutoHideEnabled') || '自动隐藏已启用，点击关闭';
            } else {
                hideButton.innerHTML = '<i class="fas fa-eye"></i>';
                hideButton.style.color = '#6c757d';
                hideButton.title = await t('AutoHideDescription') || '鼠标悬停自动隐藏，点击启用';
            }
        }

        async function toggleAutoHide() {
            if (pointerLocked && !isAutoHideActive) {
                console.warn('Auto hide is disabled in first-person mode');
                return;
            }
            isAutoHideActive = !isAutoHideActive;
            if (isAutoHideActive) enableAutoHide();
            else disableAutoHide();
            updateHideButtonState();
            sendToMain('autoHideStatus', { enabled: isAutoHideActive });
        }

        hideButton.addEventListener('mouseenter', () => {
            hideButton.style.background = 'rgba(255,255,255,1)';
            hideButton.style.transform = 'scale(1.1)';
            hideButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
        });
        hideButton.addEventListener('mouseleave', () => {
            hideButton.style.background = 'rgba(255,255,255,0.95)';
            hideButton.style.transform = 'scale(1)';
            hideButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        });

        bindTapEvent(hideButton, (e) => {
            toggleAutoHide();
        });

        await initHideButton();

        function handleModelHoverDetection(event) {
            if (!currentVrm || !isAutoHideEnabled || pointerLocked) return;
            if (hoverCheckTimeout) clearTimeout(hoverCheckTimeout);
            hoverCheckTimeout = setTimeout(() => {
                mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
                mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObject(currentVrm.scene, true);
                const nowHovered = intersects.length > 0;
                if (nowHovered !== isModelHiddenByHover) {
                    isModelHiddenByHover = nowHovered;
                    if (nowHovered) hideModelWithTransition();
                    else showModelWithTransition();
                }
            }, HOVER_CHECK_INTERVAL);
        }

        function handleMouseLeaveWindow(event) {
            if (!event.relatedTarget && isAutoHideEnabled) {
                isModelHiddenByHover = false;
                showModelWithTransition();
            }
        }

        function hideModelWithTransition() {
            if (!renderer || !renderer.domElement) return;
            const canvas = renderer.domElement;
            canvas.style.transition = `opacity ${FADE_DURATION}ms ease`;
            pauseModelAnimationsForHide();
            if (hideTransitionTimer) { clearTimeout(hideTransitionTimer); hideTransitionTimer = null; }
            requestAnimationFrame(() => { canvas.style.opacity = '0'; });
            hideTransitionTimer = setTimeout(() => {
                canvas.style.pointerEvents = 'none';
                if (currentVrm) currentVrm.scene.visible = false;
                if (isElectron && !isMouseLocked && window.electronAPI?.setIgnoreMouseEvents) {
                    window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
                }
                hideTransitionTimer = null;
            }, FADE_DURATION + 10);
        }

        function showModelWithTransition() {
            if (!renderer || !renderer.domElement) return;
            const canvas = renderer.domElement;
            canvas.style.transition = `opacity ${FADE_DURATION}ms ease`;
            canvas.style.pointerEvents = 'auto';
            canvas.style.opacity = '0'; 
            if (currentVrm) currentVrm.scene.visible = true;
            resumeModelAnimationsAfterHide();
            if (hideTransitionTimer) { clearTimeout(hideTransitionTimer); hideTransitionTimer = null; }
            requestAnimationFrame(() => { canvas.style.opacity = '1'; });
            setTimeout(() => {
                canvas.style.pointerEvents = 'auto';
                if (isElectron && !isMouseLocked && window.electronAPI?.setIgnoreMouseEvents) {
                    window.electronAPI.setIgnoreMouseEvents(false);
                }
            }, FADE_DURATION + 10);
        }

        function enableAutoHide() {
            if (isAutoHideEnabled) return;
            isAutoHideEnabled = true;
            isModelHiddenByHover = false;
            controlsEnabledBeforeAutoHide = controls.enabled;
            controls.enabled = false;
            document.addEventListener('mousemove', handleModelHoverDetection);
            document.addEventListener('mouseleave', handleMouseLeaveWindow);
        }

        function disableAutoHide() {
            if (!isAutoHideEnabled) return;
            isAutoHideEnabled = false;
            isModelHiddenByHover = false;
            controls.enabled = controlsEnabledBeforeAutoHide;
            document.removeEventListener('mousemove', handleModelHoverDetection);
            document.removeEventListener('mouseleave', handleMouseLeaveWindow);
            if (hoverCheckTimeout) { clearTimeout(hoverCheckTimeout); hoverCheckTimeout = null; }
            showModelWithTransition();
        }

        // 4. Switch-model buttons
        await getAllModels();
        const prevModelButton = document.createElement('div');
        prevModelButton.id = 'prev-model-handle';
        prevModelButton.innerHTML = '<i class="fas fa-chevron-up"></i>';
        prevModelButton.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333; cursor: pointer;
            -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
        `;
        
        const nextModelButton = document.createElement('div');
        nextModelButton.id = 'next-model-handle';
        nextModelButton.innerHTML = '<i class="fas fa-chevron-down"></i>';
        nextModelButton.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333; cursor: pointer;
            -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
        `;

        prevModelButton.addEventListener('mouseenter', async () => {
            prevModelButton.style.background = 'rgba(255,255,255,1)';
            prevModelButton.style.transform = 'scale(1.1)';
            prevModelButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
            const prevModel = getPrevModelInfo();
            if (prevModel) prevModelButton.title = `${await t('Previous')}: ${prevModel.name}`;
        });
        prevModelButton.addEventListener('mouseleave', () => {
            prevModelButton.style.background = 'rgba(255,255,255,0.95)';
            prevModelButton.style.transform = 'scale(1)';
            prevModelButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        });
        nextModelButton.addEventListener('mouseenter', async () => {
            nextModelButton.style.background = 'rgba(255,255,255,1)';
            nextModelButton.style.transform = 'scale(1.1)';
            nextModelButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
            const nextModel = getNextModelInfo();
            if (nextModel) nextModelButton.title = `${await t('Next')}: ${nextModel.name}`;
        });
        nextModelButton.addEventListener('mouseleave', () => {
            nextModelButton.style.background = 'rgba(255,255,255,0.95)';
            nextModelButton.style.transform = 'scale(1)';
            nextModelButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        });

        bindTapEvent(prevModelButton, (e) => { 
            if (allModels.length > 1) switchToModel(currentModelIndex - 1); 
        });
        bindTapEvent(nextModelButton, (e) => { 
            if (allModels.length > 1) switchToModel(currentModelIndex + 1); 
        });

        async function initModelButtons() {
            if (allModels.length <= 1) {
                prevModelButton.style.opacity = '0.5'; prevModelButton.style.cursor = 'not-allowed'; prevModelButton.title = 'No other models available';
                nextModelButton.style.opacity = '0.5'; nextModelButton.style.cursor = 'not-allowed'; nextModelButton.title = 'No other models available';
            } else {
                const prevModel = getPrevModelInfo();
                const nextModel = getNextModelInfo();
                prevModelButton.title = prevModel ? `Previous: ${prevModel.name}` : 'Previous Model';
                nextModelButton.title = nextModel ? `Next: ${nextModel.name}` : 'Next Model';
            }
        }
        initModelButtons();

        // 5. The new 'more features' button
        const moreButton = document.createElement('div');
        moreButton.id = 'more-handle';
        let isSubPanelOpen = false;
        moreButton.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
        moreButton.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333; cursor: pointer;
            -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
        `;

        async function updateMoreButtonState() {
            if (isSubPanelOpen) {
                subPanel.style.opacity = '1';
                subPanel.style.visibility = 'visible';
                subPanel.style.transform = 'translateX(0) scale(1)'; 
                subPanel.style.pointerEvents = 'auto';
                moreButton.innerHTML = '<i class="fas fa-caret-right"></i>';
                moreButton.style.color = '#007bff';
                moreButton.title = await t('collapse') || '收起面板';
            } else {
                subPanel.style.opacity = '0';
                subPanel.style.visibility = 'hidden';
                subPanel.style.transform = 'translateX(10px) scale(1)';
                subPanel.style.pointerEvents = 'none';
                moreButton.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
                moreButton.style.color = '#333';
                moreButton.title = await t('MoreOptions') || '更多功能';
            }
            showTooltip(moreButton, moreButton.title);
        }

        bindTapEvent(moreButton, async (e) => {
            isSubPanelOpen = !isSubPanelOpen;
            updateMoreButtonState();
        });

        moreButton.addEventListener('mouseenter', async () => {
            moreButton.style.background = 'rgba(255,255,255,1)';
            moreButton.style.transform = 'scale(1.1)';
            moreButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
            if (!moreButton.title) moreButton.title = await t('MoreOptions') || '更多功能';
            showTooltip(moreButton, moreButton.title);
        });
        moreButton.addEventListener('mouseleave', () => {
            moreButton.style.background = 'rgba(255,255,255,0.95)';
            moreButton.style.transform = 'scale(1)';
            moreButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            hideTooltip();
        });

        const subtitleButton = document.createElement('div');
        subtitleButton.id = 'subtitle-handle';
        subtitleButton.innerHTML = '<i class="fas fa-closed-captioning"></i>';
        subtitleButton.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333; cursor: pointer;
            -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
            color: ${isSubtitleEnabled ? '#28a745' : '#dc3545'};
        `;
        subtitleButton.addEventListener('mouseenter', () => { subtitleButton.style.background = 'rgba(255,255,255,1)'; subtitleButton.style.transform = 'scale(1.1)'; subtitleButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)'; });
        subtitleButton.addEventListener('mouseleave', () => { subtitleButton.style.background = 'rgba(255,255,255,0.95)'; subtitleButton.style.transform = 'scale(1)'; subtitleButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; });
        
        bindTapEvent(subtitleButton, async (e) => {
            isSubtitleEnabled = !isSubtitleEnabled;
            toggleSubtitle(isSubtitleEnabled);
            subtitleButton.style.color = isSubtitleEnabled ? '#28a745' : '#dc3545';
            subtitleButton.title = isSubtitleEnabled ? await t('SubtitleEnabled') : await t('SubtitleDisabled');
        });

        // 6. Refresh and close buttons
        const refreshButton = document.createElement('div');
        refreshButton.id = 'refresh-handle';
        refreshButton.innerHTML = '<i class="fas fa-redo-alt"></i>';
        refreshButton.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333; cursor: pointer;
            -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
        `;
        refreshButton.addEventListener('mouseenter', () => {
            refreshButton.style.background = 'rgba(255,255,255,1)'; refreshButton.style.transform = 'scale(1.1)'; refreshButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
        });
        refreshButton.addEventListener('mouseleave', () => {
            refreshButton.style.background = 'rgba(255,255,255,0.95)'; refreshButton.style.transform = 'scale(1)'; refreshButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        });
        bindTapEvent(refreshButton, (e) => { window.location.reload(); });

        const closeButton = document.createElement('div');
        closeButton.id = 'close-handle';
        closeButton.innerHTML = '<i class="fas fa-times"></i>';
        closeButton.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333; cursor: pointer;
            -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
        `;
        closeButton.addEventListener('mouseenter', () => {
            closeButton.style.background = 'rgba(255,255,255,1)'; closeButton.style.transform = 'scale(1.1)'; closeButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
        });
        closeButton.addEventListener('mouseleave', () => {
            closeButton.style.background = 'rgba(255,255,255,0.95)'; closeButton.style.transform = 'scale(1)'; closeButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        });
        bindTapEvent(closeButton, (e) => { window.close(); });

        // ======= The following are buttons stored in the sub-panel =======

        // Sub 1. Adjust-mode button
        const moveModeBtn = document.createElement('div');
        moveModeBtn.id = 'move-mode-handle';
        let transformState = 0; 
        moveModeBtn.innerHTML = '<i class="fa-solid fa-cube"></i>'; 
        moveModeBtn.title = await t('ModeOff') || 'Mode: Off'; 
        moveModeBtn.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333; cursor: pointer; 
            -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center; 
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
        `;
        bindTapEvent(moveModeBtn, async (e) => {
            if (!currentVrm) return;
            transformState = (transformState + 1) % 4;
            updateTransformState();
        });
        async function updateTransformState() {
            if (typeof transformControl === 'undefined') return;
            if (transformState !== 0 && currentVrmWrapper) transformControl.attach(currentVrmWrapper);
            switch (transformState) {
                case 0: transformControl.detach(); moveModeBtn.style.color = '#333'; moveModeBtn.style.background = 'rgba(255,255,255,0.95)'; moveModeBtn.innerHTML = '<i class="fa-solid fa-cube"></i>'; moveModeBtn.title = await t('ModeOff') || 'Mode: Off'; break;
                case 1: transformControl.setMode('translate'); transformControl.setSpace('world'); moveModeBtn.style.color = '#ff6b35'; moveModeBtn.style.background = 'rgba(255,255,255,1)'; moveModeBtn.innerHTML = '<i class="fa-solid fa-arrows-left-right-to-line"></i>'; moveModeBtn.title = await t('ModeMove') || 'Move Mode'; break;
                case 2: transformControl.setMode('rotate'); transformControl.setSpace('local'); moveModeBtn.style.color = '#007bff'; moveModeBtn.style.background = 'rgba(255,255,255,1)'; moveModeBtn.innerHTML = '<i class="fas fa-sync-alt"></i>'; moveModeBtn.title = await t('ModeRotate') || 'Rotate Mode'; break;
                case 3: transformControl.setMode('scale'); transformControl.setSpace('local'); moveModeBtn.style.color = '#e83e8c'; moveModeBtn.style.background = 'rgba(255,255,255,1)'; moveModeBtn.innerHTML = '<i class="fas fa-compress-arrows-alt"></i>'; moveModeBtn.title = await t('ModeScale') || 'Scale Mode'; break;
            }
        }
        moveModeBtn.addEventListener('mouseenter', () => { moveModeBtn.style.transform = 'scale(1.1)'; moveModeBtn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)'; showTooltip(moveModeBtn, moveModeBtn.title); });
        moveModeBtn.addEventListener('mouseleave', () => { moveModeBtn.style.transform = 'scale(1)'; moveModeBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; hideTooltip(); });
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (!currentVrm || typeof transformControl === 'undefined') return;
            if (e.code === 'Escape') { transformState = 0; updateTransformState(); return; }
            if (transformState !== 0) {
                switch(e.code) { case 'KeyT': transformState = 1; updateTransformState(); break; case 'KeyR': transformState = 2; updateTransformState(); break; case 'KeyS': transformState = 3; updateTransformState(); break; }
            }
        });

        // Sub 2. WS status
        const wsStatusButton = document.createElement('div');
        wsStatusButton.id = 'ws-status-handle';
        wsStatusButton.innerHTML = '<i class="fas fa-wifi"></i>';
        wsStatusButton.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333; cursor: pointer;
            -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
            color: ${wsConnected ? '#28a745' : '#dc3545'};
        `;
        bindTapEvent(wsStatusButton, (e) => {
            if (wsConnected) { if (ttsWebSocket) ttsWebSocket.close(); } else { initTTSWebSocket(); }
        });
        wsStatusButton.addEventListener('mouseenter', () => { wsStatusButton.style.background = 'rgba(255,255,255,1)'; wsStatusButton.style.transform = 'scale(1.1)'; wsStatusButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)'; });
        wsStatusButton.addEventListener('mouseleave', () => { wsStatusButton.style.background = 'rgba(255,255,255,0.95)'; wsStatusButton.style.transform = 'scale(1)'; wsStatusButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; });
        async function updateWSStatus() { wsStatusButton.style.color = wsConnected ? '#28a745' : '#dc3545'; wsStatusButton.title = wsConnected ? await t('WebSocketConnected') : await t('WebSocketDisconnected'); }
        setInterval(updateWSStatus, 1000);

        // Sub 4. Idle-animation button
        const idleAnimationButton = document.createElement('div');
        idleAnimationButton.id = 'idle-animation-handle';
        idleAnimationButton.innerHTML = useVRMAIdleAnimations ? '<i class="fas fa-stop"></i>' : '<i class="fas fa-play"></i>';
        idleAnimationButton.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: ${useVRMAIdleAnimations ? '#ff6b35' : '#28a745'};
            cursor: pointer; -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
        `;
        idleAnimationButton.addEventListener('mouseenter', () => { idleAnimationButton.style.background = 'rgba(255,255,255,1)'; idleAnimationButton.style.transform = 'scale(1.1)'; idleAnimationButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)'; });
        idleAnimationButton.addEventListener('mouseleave', () => { idleAnimationButton.style.background = 'rgba(255,255,255,0.95)'; idleAnimationButton.style.transform = 'scale(1)'; idleAnimationButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; });
        
        bindTapEvent(idleAnimationButton, async (e) => {
            if (isIdleAnimationModeChanging) return;
            await toggleIdleAnimationMode();
        });

        // Sub 5. XR button
        const xrAutoBtn = document.createElement('div');
        xrAutoBtn.id = 'xr-auto-btn';
        xrAutoBtn.innerHTML = '<i class="fa-solid fa-vr-cardboard"></i>';
        xrAutoBtn.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333; cursor: pointer; 
            -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center; 
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px); display: none;`;
        let canAR = false, canVR = false;
        Promise.all([
            navigator.xr.isSessionSupported('immersive-ar').then(yes=>{ canAR=yes; }),
            navigator.xr.isSessionSupported('immersive-vr').then(yes=>{ canVR=yes; })
        ]).then(()=>{ xrAutoBtn.style.display = (canAR || canVR) ? 'flex' : 'none'; });
        let xrSession = null;
        let xrRefSpace = null;
        
        // Make sure to use the native click event
        xrAutoBtn.addEventListener('click', async (e) => {
            if (renderer.xr.isPresenting) {
                await renderer.xr.getSession().end();
                return;
            }

            // Auto-detect mode (AR preferred)
            const mode = canAR ? 'immersive-ar' : 'immersive-vr';
            let session;

            try {
                // Attempt 1: full-feature mode with UI passthrough (dom-overlay) and plane detection (hit-test)
                session = await navigator.xr.requestSession(mode, {
                    optionalFeatures: ['local-floor', 'hit-test', 'dom-overlay'],
                    domOverlay: { root: document.body } 
                });
                console.log("进入 XR：全功能模式");

            } catch (err1) {
                console.warn('全功能 XR 启动失败，尝试降级启动...', err1);
                try {
                    // Attempt 2: drop dom-overlay (many Android browsers fail with body as the root)
                    session = await navigator.xr.requestSession(mode, {
                        optionalFeatures: ['local-floor', 'hit-test']
                    });
                    console.log("进入 XR：无 UI 穿透模式");

                } catch (err2) {
                    console.warn('降级模式 1 失败，尝试基础模式...', err2);
                    try {
                        // Attempt 3: the most basic XR mode (works as long as the phone supports ARCore/VR)
                        session = await navigator.xr.requestSession(mode);
                        console.log("进入 XR：最基础模式");

                    } catch (err3) {
                        // Completely unsupported
                        alert((await t('xrNotSupported') || 'Your browser does not support any XR configuration. Please try the latest version of Chrome.') + '\n' + (await t('errorLabel') || 'Error') + ': ' + err3.message);
                        return;
                    }
                }
            }

            // ========== Handling after successfully getting a session ==========
            renderer.xr.setSession(session);
            xrSession = session;

            renderer.setAnimationLoop(xrAnimate);
            
            // Hide the control panel
            const ctrlPanel = document.getElementById('control-panel');
            if (ctrlPanel) ctrlPanel.style.display = 'none'; 
            
            const pttBtn = document.getElementById('ptt-floating-btn');
            if (pttBtn) pttBtn.classList.add('visible');

            if (currentVrm) {
                // In VR/AR, push the model a bit farther away to avoid it being in your face
                currentVrm.scene.position.set(0, 0, -1.5);
            }

            // Handle XR controller or screen-tap input
            session.addEventListener('select', (event) => {
                console.log('XR 屏幕/手柄点击');
            });
        });

        renderer.xr.addEventListener('sessionend', () => { 
            renderer.setAnimationLoop(null); 
            animate(); 
            xrSession = null; 
            
            // === Restore the UI on exiting XR ===
            document.getElementById('control-panel').style.display = 'flex';
            // If voice wasn't on before entering XR, hide it again after exiting
            if (!pttVisible) {
                document.getElementById('ptt-floating-btn').classList.remove('visible');
            }
        });
        function xrAnimate(time, frame) {
          const delta = clock.getDelta();
          if (currentVrm) currentVrm.update(delta);
          if (currentMixer) currentMixer.update(delta);
          renderer.render(scene, camera);
        }

        // Sub 6. VMC button
        const vmcButton = document.createElement('div');
        vmcButton.id = 'vmc-handle';
        vmcButton.innerHTML = '<i class="fas fa-broadcast-tower"></i>';
        vmcButton.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333;
            cursor: pointer; -webkit-app-region: no-drag; display: flex;
            align-items: center; justify-content: center; font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);`;
        let vmcApp = null;
        let vmcWrapper = null;
        
        bindTapEvent(vmcButton, async (e) => {
            if (vmcApp) {
                vmcApp.unmount(); document.body.removeChild(vmcWrapper); vmcApp = null; vmcWrapper = null; return;
            }
            const cfg = await window.electronAPI.getVMCConfig();
            const { ElDialog, ElForm, ElFormItem, ElInput, ElSwitch, ElButton, ElInputNumber } = ElementPlus;
            vmcWrapper = document.createElement('div');
            document.body.appendChild(vmcWrapper);
            vmcApp = Vue.createApp({
                data() {
                    return {
                        dialogVisible: true,
                        form: {
                            receive: { enable: cfg.receive.enable, port: cfg.receive.port, syncExpression: cfg.receive.syncExpression },
                            send: { enable: cfg.send.enable, host: cfg.send.host, port: cfg.send.port }
                        },
                        translations: { title: '', receiveEnable: '', receivePort: '', sendEnable: '', sendHost: '', sendPort: '', cancelButton: '', saveButton: '' }
                    }
                },
                async mounted() {
                    this.translations.title = await t('vmcSettings'); this.translations.receiveEnable = await t('vmcReceiveEnable'); this.translations.receivePort = await t('vmcReceivePort');
                    this.translations.sendEnable = await t('vmcSendEnable'); this.translations.sendHost = await t('vmcSendHost'); this.translations.sendPort = await t('vmcSendPort');
                    this.translations.cancelButton = await t('cancel'); this.translations.saveButton = await t('save'); this.translations.syncExpression = await t('syncExpression');
                },
                methods: {
                    async saveConfig() {
                        await window.electronAPI.setVMCConfig({
                            receive: { enable: this.form.receive.enable, port: this.form.receive.port, syncExpression: this.form.receive.syncExpression },
                            send: { enable: this.form.send.enable, host: this.form.send.host, port: this.form.send.port }
                        });
                        setVMCReceive(this.form.receive.enable, this.form.receive.syncExpression);
                        this.close();
                    },
                    cancel() { this.close(); },
                    close() { this.dialogVisible = false; vmcApp.unmount(); document.body.removeChild(vmcWrapper); vmcApp = null; vmcWrapper = null; }
                },
                template: `
                    <el-dialog v-model="dialogVisible" :title="translations.title" width="420px" :modal="false" :close-on-click-modal="false" append-to-body custom-class="vmc-dialog" @close="close" style="background: rgba(255, 255, 255, 0.25) !important;backdrop-filter: blur(20px);border-radius: 20px !important;">
                        <div style="padding: 0 10px;">
                            <div style="margin-bottom: 20px; padding: 15px; background: rgba(245, 247, 250, 0.75)!important; border-radius: 20px;">
                                <div style="display: flex; align-items: center; margin-bottom: 15px;"><el-switch v-model="form.receive.enable"></el-switch><span style="margin-left: 10px; font-weight: 500;">{{ translations.receiveEnable }}</span></div>
                                <div style="display:flex;align-items:center;margin-top:8px;"><el-switch v-model="form.receive.syncExpression"></el-switch><span style="margin-left:10px;font-size:14px;">{{ translations.syncExpression }}</span></div>
                                <div style="display: flex; align-items: center; gap: 10px;"><span style="width: 100px;margin-right:30px; font-size: 14px;">{{ translations.receivePort }}:</span><el-input-number v-model="form.receive.port" :min="1024" :max="65535" controls-position="right" style="width: 200px;"></el-input-number></div>
                            </div>
                            <div style="margin-bottom: 20px; padding: 15px; background: rgba(245, 247, 250, 0.75)!important; border-radius: 20px;">
                                <div style="display: flex; align-items: center; margin-bottom: 15px;"><el-switch v-model="form.send.enable"></el-switch><span style="margin-left: 10px;margin-right:30px; font-weight: 500;">{{ translations.sendEnable }}</span></div>
                                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;"><span style="width: 100px; margin-right:30px;font-size: 14px;">{{ translations.sendHost }}:</span><el-input v-model="form.send.host" style="width: 200px;"></el-input></div>
                                <div style="display: flex; align-items: center; gap: 10px;"><span style="width: 100px;margin-right:30px; font-size: 14px;">{{ translations.sendPort }}:</span><el-input-number v-model="form.send.port" :min="1024" :max="65535" controls-position="right" style="width: 200px;"></el-input-number></div>
                            </div>
                        </div>
                        <template #footer><div style="text-align: right;"><el-button @click="cancel" style="margin-right: 10px;">{{ translations.cancelButton }}</el-button><el-button type="primary" @click="saveConfig">{{ translations.saveButton }}</el-button></div></template>
                    </el-dialog>
                `
            });
            vmcApp.use(ElementPlus); vmcApp.mount(vmcWrapper);
        });

        // Sub 7. First-person-view button
        const switchCtrlBtn = document.createElement('div');
        switchCtrlBtn.id = 'switch-controls-handle';
        switchCtrlBtn.innerHTML = '<i class="fas fa-gamepad"></i>';
        switchCtrlBtn.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333; cursor: pointer; -webkit-app-region: no-drag;
            display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            transform 0.2s; user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
        `;
        function createPointerLockControls() {
            pointerLockControls = new PointerLockControls(camera, renderer.domElement);
            scene.add(pointerLockControls.getObject());
        }
        function toggleControls() {
            if (!pointerLockControls) createPointerLockControls();
            if (!pointerLocked) {
                orbitControlsSaved = controls; orbitControlsSaved.enabled = false;
                pointerLockControls.lock(); enablePointerLockMovement(); pointerLocked = true;
                if (isAutoHideActive) { disableAutoHide(); isAutoHideActive = false; autoHideDisabledByPointerLock = true; updateHideButtonState(); }
                switchCtrlBtn.style.color = '#ffc73bff';
            } else {
                pointerLockControls.unlock(); disablePointerLockMovement(); pointerLocked = false;
                if (autoHideDisabledByPointerLock) { enableAutoHide(); isAutoHideActive = true; autoHideDisabledByPointerLock = false; updateHideButtonState(); }
                switchCtrlBtn.style.color = '#333';
                if (orbitControlsSaved) orbitControlsSaved.enabled = true;
            }
        }
        
        bindTapEvent(switchCtrlBtn, (e) => { toggleControls(); });

        switchCtrlBtn.addEventListener('mouseenter', async () => {
            switchCtrlBtn.style.background = 'rgba(255,255,255,1)'; switchCtrlBtn.style.transform = 'scale(1.1)'; switchCtrlBtn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
            switchCtrlBtn.title = pointerLocked ? await t('ExitFirstPerson') || 'Exit First-Person' : await t('EnterFirstPerson') || 'Enter First-Person';
        });
        switchCtrlBtn.addEventListener('mouseleave', () => { switchCtrlBtn.style.background = 'rgba(255,255,255,0.95)'; switchCtrlBtn.style.transform = 'scale(1)'; switchCtrlBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; });
        document.addEventListener('pointerlockchange', () => {
            if (document.pointerLockElement !== renderer.domElement && pointerLocked) toggleControls();
        });

        // 1. Create the button and set its initial properties
        const voiceControlBtn = document.createElement('div');
        voiceControlBtn.id = 'voice-toggle-handle';
        voiceControlBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        voiceControlBtn.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #000000; cursor: pointer;
            -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
        `;

        // 2. Initial hover tooltip (uses the t translation function in your code)
        (async () => {
            const initialTitle = await t('EnableVoiceInput') || '开启语音输入';
            voiceControlBtn.title = initialTitle;
            addHoverEffect(voiceControlBtn, initialTitle); // Call your existing tooltip-enhancement function
        })();

        // 3. Add dynamic title updates in the click event
        bindTapEvent(voiceControlBtn, async (e) => {
            pttVisible = !pttVisible;
            const fBtn = document.getElementById('ptt-floating-btn');
            
            // Get the new title text
            const activeTitle = pttVisible 
                ? (await t('DisableVoiceInput') || '关闭语音输入') 
                : (await t('EnableVoiceInput') || '开启语音输入');

           if (pttVisible) {
                fBtn.classList.add('visible');
                voiceControlBtn.style.background = '#ff6b35';
                voiceControlBtn.style.color = '#ff6b35';
            } else {
                fBtn.classList.remove('visible');
                voiceControlBtn.style.background = '#000000';
                voiceControlBtn.style.color = '#000000';
            }

            // Update the native title and the custom tooltip
            voiceControlBtn.title = activeTitle;
            showTooltip(voiceControlBtn, activeTitle); // Immediately update the currently shown black bubble
        });

        // 1. Create the text-control button
        const textControlBtn = document.createElement('div');
        textControlBtn.id = 'text-toggle-handle';
        textControlBtn.innerHTML = '<i class="fas fa-keyboard"></i>'; // Use fas consistently
        textControlBtn.style.cssText = `
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333333; cursor: pointer;
            -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
        `;

        // Add a hover effect consistent with the other buttons, to avoid color conflicts on hover
        textControlBtn.addEventListener('mouseenter', () => { 
            textControlBtn.style.background = 'rgba(255,255,255,1)'; 
            textControlBtn.style.transform = 'scale(1.1)'; 
            textControlBtn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)'; 
        });
        textControlBtn.addEventListener('mouseleave', () => { 
            textControlBtn.style.background = 'rgba(255,255,255,0.95)'; 
            textControlBtn.style.transform = 'scale(1)'; 
            textControlBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; 
        });

        (async () => {
            const initialTitle = await t('EnableTextInput') || '开启文字输入';
            textControlBtn.title = initialTitle;
            addHoverEffect(textControlBtn, initialTitle);
        })();

        bindTapEvent(textControlBtn, async (e) => {
            // Share the toggle logic to stay in sync with the global-shortcut state
            const visible = setVrmTextInputVisible();

            const activeTitle = visible
                ? (await t('DisableTextInput') || '关闭文字输入')
                : (await t('EnableTextInput') || '开启文字输入');

            textControlBtn.title = activeTitle;
            showTooltip(textControlBtn, activeTitle);
        });

        // Summon-friend button (main pet only): opens another pet beside this one,
        // loading the next model in the list as the "friend" (e.g. chick -> puppy).
        let summonFriendBtn = null;
        if (windowName === 'default' && window.electronAPI && typeof window.electronAPI.summonFriend === 'function') {
            summonFriendBtn = document.createElement('div');
            summonFriendBtn.id = 'summon-friend-handle';
            summonFriendBtn.innerHTML = '<i class="fas fa-user-plus"></i>';
            summonFriendBtn.style.cssText = `
                width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
                border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333333; cursor: pointer;
                -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center;
                font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
                user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
            `;
            summonFriendBtn.addEventListener('mouseenter', () => {
                summonFriendBtn.style.background = 'rgba(255,255,255,1)';
                summonFriendBtn.style.transform = 'scale(1.1)';
                summonFriendBtn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
            });
            summonFriendBtn.addEventListener('mouseleave', () => {
                summonFriendBtn.style.background = 'rgba(255,255,255,0.95)';
                summonFriendBtn.style.transform = 'scale(1)';
                summonFriendBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            });
            (async () => {
                const title = await t('summonFriend') || '친구 소환';
                summonFriendBtn.title = title;
                addHoverEffect(summonFriendBtn, title);
            })();
            bindTapEvent(summonFriendBtn, async () => {
                try {
                    const [cfg, res] = await Promise.all([fetchVRMConfig(), fetch('/get_default_vrm_models')]);
                    const models = ((await res.json()).models) || [];
                    if (models.length === 0) return;
                    const curId = friendModelId || cfg.selectedModelId;
                    const idx = models.findIndex(m => m.id === curId);
                    const friend = models[(idx + 1 + models.length) % models.length] || models[0];
                    await window.electronAPI.summonFriend({ modelId: friend.id });
                } catch (e) { console.error('[SummonFriend] failed', e); }
            });
        }

        // ==========================================
        // ======= Assemble all panels and buttons ===================
        // ==========================================
        
        // 1. Assemble the main panel (in order)
        controlPanel.appendChild(dragButton);          // Drag
        controlPanel.appendChild(lockButton);          // Lock passthrough
        controlPanel.appendChild(hideButton);          // Model non-occluding
        controlPanel.appendChild(prevModelButton);     // Previous model
        controlPanel.appendChild(nextModelButton);     // Next model
        controlPanel.appendChild(subtitleButton);          // Subtitle toggle
        controlPanel.appendChild(voiceControlBtn);        // Voice control
        controlPanel.appendChild(textControlBtn);
        if (summonFriendBtn) controlPanel.appendChild(summonFriendBtn);   // Summon friend (below text input)
        controlPanel.appendChild(moreButton);          // More button
        controlPanel.appendChild(refreshButton);       // Refresh
        controlPanel.appendChild(closeButton);         // Close


        // 2. Assemble the sub-panel (holding secondary buttons)
        if (isElectron) {
            subPanel.appendChild(vmcButton);           // VMC settings
        }
        subPanel.appendChild(idleAnimationButton);     // Idle animation
        subPanel.appendChild(switchCtrlBtn);           // First person
        subPanel.appendChild(moveModeBtn);             // Object translate/scale
        subPanel.appendChild(wsStatusButton);          // WS status
        subPanel.appendChild(xrAutoBtn);               // XR

        // 3. Mount the sub-panel inside the main panel
        controlPanel.appendChild(subPanel);
        
        // 4. Put all buttons that the 'lock' action should hide into an array
        controlButtons.push(
            dragButton,
            hideButton,
            prevModelButton, 
            nextModelButton, 
            voiceControlBtn,
            textControlBtn,
            moreButton,          // Make the 'more' button subject to lock control
            refreshButton, 
            closeButton,
            // The following are sub-panel buttons; add them to the array too for consistent state
            subtitleButton, 
            idleAnimationButton, 
            switchCtrlBtn,
            moveModeBtn,
            wsStatusButton,
            xrAutoBtn
        );
        if (isElectron) controlButtons.push(vmcButton);

        // 5. Add to the page
        document.body.appendChild(controlPanel);

        // Initialize all tooltip text
        dragButton.title = await t('dragWindow');
        refreshButton.title = await t('refreshWindow');
        closeButton.title = await t('closeWindow');
        
        addHoverEffect(dragButton, await t('dragWindow'));
        addHoverEffect(lockButton, isMouseLocked ? await t('UnlockWindow') : await t('LockWindow'));
        addHoverEffect(hideButton, isAutoHideActive ? await t('AutoHideEnabled') : await t('AutoHideDescription'));
        addHoverEffect(refreshButton, await t('refreshWindow'));
        addHoverEffect(closeButton, await t('closeWindow'));
        
        addHoverEffect(wsStatusButton, wsConnected ? await t('WebSocketConnected') : await t('WebSocketDisconnected'));
        addHoverEffect(subtitleButton, isSubtitleEnabled ? await t('SubtitleEnabled') : await t('SubtitleDisabled'));
        addHoverEffect(idleAnimationButton, useVRMAIdleAnimations ? await t('UsingVRMAAnimations') : await t('UsingProceduralAnimations'));
        addHoverEffect(xrAutoBtn, await t('EnterXR') || 'Enter XR');
        addHoverEffect(switchCtrlBtn, pointerLocked ? await t('ExitFirstPerson') || 'Exit First-Person' : await t('EnterFirstPerson') || 'Enter First-Person');
        
        if (isElectron) {
            addHoverEffect(vmcButton, await t('vmcSettings') || 'VMC Settings');
        }

        async function updateButtonTooltips() {
            addHoverEffect(lockButton, isMouseLocked ? await t('UnlockWindow') : await t('LockWindow'));
            addHoverEffect(hideButton, isAutoHideActive ? await t('AutoHideEnabled') : await t('AutoHideDescription'));
            addHoverEffect(wsStatusButton, wsConnected ? await t('WebSocketConnected') : await t('WebSocketDisconnected'));
            addHoverEffect(subtitleButton, isSubtitleEnabled ? await t('SubtitleEnabled') : await t('SubtitleDisabled'));
            addHoverEffect(switchCtrlBtn, pointerLocked ? await t('ExitFirstPerson') || 'Exit First-Person (WASD+QE)' : await t('EnterFirstPerson') || 'Enter First-Person (WASD+QE)');
            addHoverEffect(idleAnimationButton, useVRMAIdleAnimations ? await t('UsingVRMAAnimations') : await t('UsingProceduralAnimations'));
            
            const prevModel = getPrevModelInfo();
            const nextModel = getNextModelInfo();
            addHoverEffect(prevModelButton, prevModel ? `${await t('Previous')}: ${prevModel.name}` : await t('NoPreviousModel'));
            addHoverEffect(nextModelButton, nextModel ? `${await t('Next')}: ${nextModel.name}` : await t('NoNextModel'));
            switch (transformState) {
                case 0: moveModeBtn.title = await t('ModeOff') || 'Mode: Off'; break;
                case 1: moveModeBtn.title = await t('ModeMove') || 'Move Mode'; break;
                case 2: moveModeBtn.title = await t('ModeRotate') || 'Rotate Mode'; break;
                case 3: moveModeBtn.title = await t('ModeScale') || 'Scale Mode'; break;
            }
            const vText = pttVisible ? await t('DisableVoiceInput') : await t('EnableVoiceInput');
            addHoverEffect(voiceControlBtn, vText || (pttVisible ? '关闭语音输入' : '开启语音输入'));
            const tText = textInputVisible ? await t('DisableTextInput') : await t('EnableTextInput');
            addHoverEffect(textControlBtn, tText || (textInputVisible ? '关闭文字输入' : '开启文字输入'));
        }
        setInterval(updateButtonTooltips, 1000);

        // ======= Show/hide control logic (the whole panel's auto-fade) =======
        let hideTimeout;
        let isControlPanelHovered = false;
        
        function showControlPanel() {
            clearTimeout(hideTimeout);
            controlPanel.style.opacity = '1';
            controlPanel.style.visibility = 'visible';
            controlPanel.style.transform = 'translateX(0)';
            controlPanel.style.pointerEvents = 'auto';
        }
        
        function hideControlPanel() {
            if (!isControlPanelHovered) {
                // If the mouse is idle, auto-collapse the sub-panel
                if (isSubPanelOpen) {
                    isSubPanelOpen = false;
                    updateMoreButtonState();
                }
                controlPanel.style.opacity = '0';
                controlPanel.style.visibility = 'hidden';
                controlPanel.style.transform = 'translateX(20px)';
                controlPanel.style.pointerEvents = 'none';
            }
        }
        
        function scheduleHide() {
            clearTimeout(hideTimeout);
            hideTimeout = setTimeout(hideControlPanel, 3000); // On mobile, extending this to 3 seconds is more convenient
        }
        
        document.body.addEventListener('mouseenter', () => { showControlPanel(); });
        document.body.addEventListener('mousemove', () => { showControlPanel(); scheduleHide(); });
        document.body.addEventListener('mouseleave', () => { if (!isControlPanelHovered) scheduleHide(); });

        // [New mobile optimization] tap the screen to bring up the control panel and hide the tooltip
        document.body.addEventListener('touchstart', (e) => {
            hideTooltip();
            // If the click was on an element inside the control panel, don't handle it; let the panel handle it
            if (controlPanel.contains(e.target)) return;
            showControlPanel(); 
            scheduleHide(); 
        }, { passive: true });
        
        controlPanel.addEventListener('mouseenter', () => {
            if (renderer.xr.isPresenting) return; 
            isControlPanelHovered = true;
            clearTimeout(hideTimeout);
            showControlPanel();
            if (isMouseLocked && window.electronAPI) window.electronAPI.setIgnoreMouseEvents(false);
        });
        
        controlPanel.addEventListener('mouseleave', () => {
            isControlPanelHovered = false;
            scheduleHide();
            if (isMouseLocked && window.electronAPI) window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
        });

        // [New mobile optimization] keep the panel visible while touching it
        controlPanel.addEventListener('touchstart', () => {
            if (renderer.xr.isPresenting) return; 
            isControlPanelHovered = true;
            clearTimeout(hideTimeout);
            showControlPanel();
            if (isMouseLocked && window.electronAPI) window.electronAPI.setIgnoreMouseEvents(false);
        }, { passive: true });

        controlPanel.addEventListener('touchend', () => {
            isControlPanelHovered = false;
            scheduleHide();
            if (isMouseLocked && window.electronAPI) window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
        }, { passive: true });
        
        let mouseStopTimeout;
        document.body.addEventListener('mousemove', () => {
            clearTimeout(mouseStopTimeout);
            mouseStopTimeout = setTimeout(() => {
                if (!isControlPanelHovered) hideControlPanel();
            }, 3000); 
        });
        
        scheduleHide();
        setupPttInteraction();
        setupTextInteraction();

        // ======= [New] in locked state, allow mouse passthrough for the bottom interactive components =======
        const pttBtn = document.getElementById('ptt-floating-btn');
        if (pttBtn) {
            pttBtn.addEventListener('mouseenter', () => {
                if (isMouseLocked && window.electronAPI) window.electronAPI.setIgnoreMouseEvents(false);
            });
            pttBtn.addEventListener('mouseleave', () => {
                if (isMouseLocked && window.electronAPI) window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
            });
        }

        const textInputContainer = document.getElementById('text-input-container');
        const textInputField = document.getElementById('text-input-field');
        if (textInputContainer && textInputField) {
            textInputContainer.addEventListener('mouseenter', () => {
                if (isMouseLocked && window.electronAPI) window.electronAPI.setIgnoreMouseEvents(false);
            });
            textInputContainer.addEventListener('mouseleave', () => {
                // Only restore mouse passthrough if the mouse left and the input box isn't focused
                if (isMouseLocked && window.electronAPI && document.activeElement !== textInputField) {
                    window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
                }
            });
            textInputField.addEventListener('blur', () => {
                // When the input box loses focus, restore passthrough if the mouse is no longer inside the container
                if (isMouseLocked && window.electronAPI && !textInputContainer.matches(':hover')) {
                    window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
                }
            });
            textInputField.addEventListener('focus', () => {
                // When the input box is focused, force passthrough off, so the keyboard doesn't lose focus if the mouse jitters mid-typing
                if (isMouseLocked && window.electronAPI) window.electronAPI.setIgnoreMouseEvents(false);
            });
        }
        // ==============================================================

        console.log('控制面板已加载，更多功能折叠完毕。');

    }, 1000);
}

if (windowName === 'default') {
    addcontrolPanel();
} else {
    // Summoned "friend": hide the control buttons for now, but keep the whole window
    // draggable so it can still be repositioned.
    document.body.style.webkitAppRegion = 'drag';
}

// ===== VRM text input: global-shortcut toggle (default F13, configurable in settings) =====
// Only registered for the main pet (non-OBS-render); pressing the shortcut toggles the bottom input box.
if (windowName === 'default' && !isRenderMode && window.electronAPI && window.electronAPI.registerVrmInputShortcut) {
    const vrmInputHotkey = (modelConfig && modelConfig.textInputHotkey) || 'F13';
    window.electronAPI.registerVrmInputShortcut(vrmInputHotkey)
        .then((ok) => { if (!ok) console.warn(`[VRM] text-input hotkey ${vrmInputHotkey} failed to register`); })
        .catch(() => {});
    if (window.electronAPI.onVrmInputToggleTriggered) {
        window.electronAPI.onVrmInputToggleTriggered(() => { setVrmTextInputVisible(); });
    }
    // Unregister on window close, so the shortcut isn't held after the pet is closed
    window.addEventListener('beforeunload', () => {
        try { window.electronAPI.unregisterVrmInputShortcut(); } catch (e) {}
    });
}

// ===== Idle talk: spontaneous preset remarks in the speech bubble =====
(function setupIdleTalk() {
    try {
        const cfg = modelConfig || {};
        if (!cfg.idleTalkEnabled) return;
        if (typeof windowName !== 'undefined' && windowName !== 'default') return; // only the main pet window
        const lines = String(cfg.idleTalkLines || '')
            .split('\n').map(s => s.trim()).filter(Boolean);
        if (lines.length === 0) return;
        const baseMs = Math.max(5, Number(cfg.idleTalkInterval) || 60) * 1000;
        let hideTimer = null;

        function speakIdle() {
            // Suppressed while the user is typing in the bubble input box.
            const inputBox = document.getElementById('text-input-container');
            const inputOpen = !!inputBox && inputBox.style.opacity === '1';
            // Only speak when idle: input box closed AND no real utterance within the base interval.
            if (!inputOpen && Date.now() - vrmLastSpeakTs >= baseMs) {
                const line = lines[Math.floor(Math.random() * lines.length)];
                renderSubtitleUI(line);
                if (subtitleElement) subtitleElement.style.opacity = '1';
                vrmLastSpeakTs = Date.now(); // count this as activity so it won't repeat immediately
                if (hideTimer) clearTimeout(hideTimer);
                hideTimer = setTimeout(() => {
                    if (subtitleElement) subtitleElement.style.opacity = '0';
                }, 6000);
            }
            scheduleNext();
        }
        function scheduleNext() {
            const jitter = 0.7 + Math.random() * 0.8; // 0.7x ~ 1.5x → feels spontaneous
            setTimeout(speakIdle, baseMs * jitter);
        }
        scheduleNext();
    } catch (e) {
        console.error('[IdleTalk] setup failed', e);
    }
})();

// ===== Idle wander: the pet window drifts to a nearby spot when idle (with walk motion) =====
(function setupWander() {
    try {
        const cfg = modelConfig || {};
        if (!cfg.wanderEnabled) return;
        if (typeof windowName !== 'undefined' && windowName !== 'default') return; // only the main pet window
        if (!(window.electronAPI && window.electronAPI.vrmWander)) return;          // Electron only
        const baseMs = Math.max(10, Number(cfg.wanderInterval) || 90) * 1000;
        const range = Math.max(20, Number(cfg.wanderRange) || 250);
        const duration = 1500;
        let wandering = false;

        function findWalkMotion() {
            try {
                for (const [key, url] of motionUrlMap.entries()) {
                    if (/walk|run|move|走|步|歩/i.test(String(key))) return url;
                }
            } catch (e) {}
            return null;
        }

        async function wanderOnce() {
            const inputBox = document.getElementById('text-input-container');
            const inputOpen = !!inputBox && inputBox.style.opacity === '1';
            // Only wander when idle: not already moving, input box closed, no recent speech.
            if (!wandering && !inputOpen && Date.now() - vrmLastSpeakTs >= baseMs) {
                wandering = true;
                const walkUrl = findWalkMotion();
                if (walkUrl && idleAnimationManager) {
                    try { idleAnimationManager.playOneShotAnimation(walkUrl); } catch (e) {}
                }
                if (glbPet) glbPet.walking = true;   // procedural foot/waddle while the window slides
                try { await window.electronAPI.vrmWander({ range, duration }); } catch (e) {}
                if (glbPet) glbPet.walking = false;
                vrmLastSpeakTs = Date.now(); // count as activity so talk/wander won't fire immediately after
                wandering = false;
            }
            scheduleNext();
        }
        function scheduleNext() {
            const jitter = 0.7 + Math.random() * 0.8;
            setTimeout(wanderOnce, baseMs * jitter);
        }
        scheduleNext();
    } catch (e) {
        console.error('[Wander] setup failed', e);
    }
})();

// Add in the global-variable area
let ttsWebSocket = null;
let wsConnected = false;
let currentAudioContext = null; // Used to manage audio processing
const chunkAnimations = new Map(); // Used to store the animation state of each voice chunk
let vrmAudioQueue = [];            // The sorted pending-playback queue
let vrmReceiveBuffer = new Map();   // The sorting buffer
let nextExpectedIndex = 0;         // The expected next index
let isVrmPlaying = false;          // Playback-state lock

function initTTSWebSocket() {
    const http_protocol = window.location.protocol;
    const ws_protocol = http_protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${ws_protocol}//${window.location.host}/ws/vrm`;
    
    ttsWebSocket = new WebSocket(wsUrl);
    ttsWebSocket.binaryType = 'arraybuffer'; // Required!

    ttsWebSocket.onopen = () => { wsConnected = true; console.log('VRM Binary Connected'); };

    ttsWebSocket.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
            // 1. Parse the binary
            const buffer = event.data;
            const view = new DataView(buffer);
            const jsonLen = view.getUint32(0, true);
            const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, jsonLen)));
            const audioDataBytes = new Uint8Array(buffer, 4 + jsonLen);

            if (metadata.type === 'omni_chunk') {
                isOmniMode = true;
                isAudioStreaming = true;
                if (metadata.text) fullTargetText = metadata.text;
                
                const b64 = btoa(String.fromCharCode.apply(null, audioDataBytes));
                processOmniStreaming({
                    audioData: b64,
                    sampleRate: metadata.sampleRate
                });
                
                startTypewriterLoop();
            } else if (metadata.type === 'audio_chunk') {
                const audioUrl = URL.createObjectURL(new Blob([audioDataBytes], { type: metadata.mimeType }));
                addToVrmSortBuffer({
                    audioDataUrl: audioUrl, chunkIndex: metadata.chunkIndex,
                    expressions: metadata.expressions, text: metadata.text, isBinary: true
                });
            }
        } else {
            // Handle the command (JSON)
            try {
                const message = JSON.parse(event.data);
                // Ensure both command handlers run
                handleVrmCoreLogic(message);
                handleTTSMessage(message); 
            } catch (e) {
                console.error("解析 JSON 失败: ", e);
            }
        }
    };
    ttsWebSocket.onclose = () => { wsConnected = false; setTimeout(initTTSWebSocket, 3000); };
}

// --- Command-handling function ---
function handleVrmCoreLogic(message) {
    const { type, data } = message;
    
    // [Core fix] when a conversation starts or stops, reset all your typewriter variables
    if (type === 'ttsStarted' || type === 'stopSpeaking') {
        // 1. Reset the typewriter variables you wrote
        isOmniMode = false;
        isAudioStreaming = false;
        fullTargetText = "";
        currentVisibleCount = 0;
        displayStartIndex = 0;
        stopTypewriterLoop(); // Call your stop function
        clearSubtitle();     // Call your cleanup function

        // 2. Reset the standard TTS queue
        vrmAudioQueue = [];
        vrmReceiveBuffer.clear();
        nextExpectedIndex = 0;
        isVrmPlaying = false;
        haltCurrentAudio();
    }
    
    // Handle silence-chunk commands
    if (type === 'startSpeaking' && data.voice === 'silence') {
        addToVrmSortBuffer({ ...data, isSilence: true });
    }
}

// --- Standard TTS sorting function (full version) ---
function addToVrmSortBuffer(task) {
    vrmReceiveBuffer.set(task.chunkIndex, task);
    while (vrmReceiveBuffer.has(nextExpectedIndex)) {
        const nextTask = vrmReceiveBuffer.get(nextExpectedIndex);
        vrmAudioQueue.push(nextTask);
        vrmReceiveBuffer.delete(nextExpectedIndex);
        nextExpectedIndex++;
    }
    if (!isVrmPlaying && vrmAudioQueue.length > 0) processVrmQueue();
}

// --- Standard TTS playback queue (full version) ---
async function processVrmQueue() {
    if (vrmAudioQueue.length === 0) { isVrmPlaying = false; return; }
    isVrmPlaying = true;
    const task = vrmAudioQueue.shift();

    // Reuse your subtitle rendering
    if (task.text) renderSubtitleUI(task.text);

    if (task.isSilence) {
        await new Promise(r => setTimeout(r, 600));
    } else {
        await startLipSyncForChunk(task); // Call that F1/F2 algorithm function of yours
    }

    if (task.isBinary && task.audioDataUrl) URL.revokeObjectURL(task.audioDataUrl);
    processVrmQueue();
}

initTTSWebSocket();

const VMCToVRMBlend = {
  Joy:      'happy',
  Angry:    'angry',
  Sorrow:   'sad',
  Fun:      'relaxed',
  A:        'aa',
  I:        'ih',
  U:        'ou',
  E:        'ee',
  O:        'oh',
  Blink:    'blink',
  Blink_L:  'blinkLeft',
  Blink_R:  'blinkRight',
  Surprised:'surprised',
  LookDown:   'lookDown',
  LookUp:     'lookUp',
  LookLeft:   'lookLeft',
  LookRight:  'lookRight'
};
let vmcReceiveEnabled = false;   // Whether we're in VMC receive mode
let vmcSyncExpression = false;   // Whether to sync expressions (panel toggle)
let vmcBoneBuffer = new Map();   // Cache the latest bone data
let vmcBlendBuffer = new Map();  // Cache the latest expression data

/* ========== VMC receive: bones + expressions, full version at once ========== */
if (window.vmcAPI) {
  window.vmcAPI.onVMCOscRaw((oscMsg) => {
    if (!vmcReceiveEnabled) return;          // Master switch

    const { address, args } = oscMsg;

    /* -------- 1. Bones /VMC/Ext/Bone/Pos -------- */
    if (address === '/VMC/Ext/Bone/Pos') {
      // Handle the two common osc-library formats: {type,value} or the raw value directly
      const boneName = args[0].value ?? args[0];
      const x   = args[1].value ?? args[1];
      const y   = args[2].value ?? args[2];
      const z   = args[3].value ?? args[3];
      const qx  = args[4].value ?? args[4];
      const qy  = - args[5].value ?? args[5];
      const qz  = - args[6].value ?? args[6];
      const qw  = args[7].value ?? args[7];

      vmcBoneBuffer.set(boneName, {
        position: new THREE.Vector3(x, y, z),
        rotation: new THREE.Quaternion(qx, qy, qz, qw)
      });
      return;
    }

    /* -------- 2. Expressions /VMC/Ext/Blend/Val -------- */
    if (address === '/VMC/Ext/Blend/Val') {
      const blendName = args[0].value ?? args[0];
      const weight  = args[1].value ?? args[1];
      vmcBlendBuffer.set(blendName, weight);
      return;
    }

    /* -------- 3. Expression apply -------- */
    if (address === '/VMC/Ext/Blend/Apply') {
      if (!currentVrm?.expressionManager || !vmcSyncExpression) return;
      for (const [vmcName, w] of vmcBlendBuffer) {
        const vrmName = VMCToVRMBlend[vmcName];   // Official expression mapping table
        if (vrmName) currentVrm.expressionManager.setValue(vrmName, w);
      }
    }
  });
}



// Send a message to the main UI
function sendToMain(type, data) {
    if (ttsWebSocket && wsConnected) {
        ttsWebSocket.send(JSON.stringify({
            type,
            data,
            timestamp: Date.now()
        }));
    }
}

let fullTargetText = "";          // Record all the text received in the current conversation
let currentVisibleCount = 0;      // The number of characters currently displayed
let displayStartIndex = 0; // New: lock the current display's start position
const MAX_WINDOW_SIZE = 60;  // At most ~40 characters per screen (depending on UI width)
const OVERLAP_SIZE = 30;     // Characters kept on page turn (i.e. a 'half-page' overlap)
const SAFE_PUNC_LIST = /[，。！？；：、“”（）《》,.!?;:()]/; // Define the punctuation marks safe to split on

let typewriterTimer = null;       // Typewriter timer
let isAudioStreaming = false;
let isOmniMode = false;           // Whether we're in Omni-stream mode
let omniNextStartTime = 0;        // The estimated audio-stream end time
let omniTotalAudioDuration = 0;   // The total audio duration received for the current sentence
let omniPlaybackStartTime = 0;    // The absolute time this sentence's audio started playing
/**
 * Force-stop all audio playback and reset the audio context
 * Fixes the overlap where 'the next sentence starts before the previous one finishes'
 */
async function haltCurrentAudio() {
    // 1. Stop the audio context (the most critical step)
    if (currentAudioContext) {
        try {
            // suspend() immediately stops audio output
            await currentAudioContext.suspend();
            // close() releases hardware resources, forcing a new context next time to avoid timestamp confusion
            await currentAudioContext.close();
        } catch (e) {
            console.warn("AudioContext cleanup warning:", e);
        }
        currentAudioContext = null; // Null it out so processOmniStreaming recreates it next time
    }

    // 2. Reset the audio-stream timestamps
    omniNextStartTime = 0;
    
    // 3. Stop all animations and analyzer connections
    stopAllChunkAnimations();
    chunkAnimations.clear(); // Clear the Map to prevent lingering state
}

// Timestamp of the last real utterance — idle talk uses it to avoid interrupting speech.
let vrmLastSpeakTs = Date.now();

function handleTTSMessage(message) {
    const { type, data } = message;

    if (type === 'ttsStarted' || type === 'omniStreaming' || type === 'startSpeaking') {
        vrmLastSpeakTs = Date.now();
    }

    switch (type) {
        case 'ttsStarted':
            isOmniMode = false;
            fullTargetText = "";
            currentVisibleCount = 0;
            displayStartIndex = 0;
            isAudioStreaming = false;
            omniNextStartTime = 0;
            omniTotalAudioDuration = 0;
            omniPlaybackStartTime = 0;
            stopTypewriterLoop();
            stopAllChunkAnimations();
            clearSubtitle();
            break;

        case 'omniStreaming':
            if (windowName === 'default') {
                if (!isOmniMode || (data.text && data.text.length < fullTargetText.length)) {
                    fullTargetText = "";
                    currentVisibleCount = 0;
                    displayStartIndex = 0;
                    omniNextStartTime = 0;
                    stopTypewriterLoop();
                    clearSubtitle();
                }

                isOmniMode = true;
                isAudioStreaming = true; // Mark that we're receiving the data stream
                if (data.text) fullTargetText = data.text;
                
                // Expression and motion triggers in text-only mode
                if (data.expressions && data.expressions.length > 0) {
                    const ALLOW_EXPS = ['surprised','happy','angry','sad','neutral','relaxed','blink','blinkLeft','blinkRight'];
                    if (idleAnimationManager) {
                        const foundMotionId = data.expressions.find(exp => motionUrlMap.has(exp));
                        if (foundMotionId) {
                            const motionUrl = motionUrlMap.get(foundMotionId);
                            if (motionUrl) {
                                console.log(`[OmniTextOnly] 触发动作: ${foundMotionId}`);
                                idleAnimationManager.playOneShotAnimation(motionUrl);
                            }
                        }
                    }
                    const hitExpression = data.expressions.find(e => ALLOW_EXPS.includes(e));
                    if (hitExpression && currentVrm && currentVrm.expressionManager) {
                        const EMOTIONS = ['surprised', 'happy', 'angry', 'sad', 'neutral', 'relaxed'];
                        if (EMOTIONS.includes(hitExpression)) {
                            EMOTIONS.forEach(exp => {
                                currentVrm.expressionManager.setValue(exp, exp === hitExpression ? 1.0 : 0.0);
                            });
                        } else {
                            currentVrm.expressionManager.setValue(hitExpression, 1.0);
                        }
                    }
                }

                if (data.audioData) processOmniStreaming(data);
                startTypewriterLoop();
            }
            break;

        case 'startSpeaking':
            if (windowName === 'default' || windowName === data.voice) {
                isOmniMode = false;
                startLipSyncForChunk(data); 
                if (data.text) {
                    updateSubtitle(data.text, data.chunkIndex);
                }
            }
            break;

        case 'stopSpeaking':
            // Force-interrupt: clear the state directly, leaving no trace
            isOmniMode = false;
            isAudioStreaming = false;
            stopTypewriterLoop();
            haltCurrentAudio(); 
            finalizeSpeech(true); 
            break;

        case 'allChunksCompleted':
            // Core change: only mark the end of AI data input. The typewriter will finish printing on its own.
            isAudioStreaming = false; 
            
            // If the subtitle already finished printing early, just wrap up
            if (currentVisibleCount >= fullTargetText.length) {
                isOmniMode = false;
                finalizeSpeech(false);
            }
            break;
            
        case 'chunkEnded':
            if (currentSubtitleChunkIndex === data.chunkIndex && !isOmniMode) {
                clearSubtitle();
            }
            break;
    }
}

// ==========================================
// 3. Dynamic typewriter logic
// ==========================================
/**
 * Full improved typewriter loop
 * Supports: dynamic speed, half-page overlap paging, safe punctuation splitting, visual feedback
 */
// Extracted helper for reusing subtitle rendering and scrolling
function updateSubtitleAndRoll() {
    const currentDisplayLength = currentVisibleCount - displayStartIndex;
    if (currentDisplayLength > MAX_WINDOW_SIZE) {
        let targetStartIndex = currentVisibleCount - OVERLAP_SIZE;
        const lookbackRange = Math.floor(MAX_WINDOW_SIZE * 0.6); 
        const searchText = fullTargetText.slice(currentVisibleCount - lookbackRange, currentVisibleCount);
        let lastPuncIndex = -1;
        for (let i = searchText.length - 1; i >= 0; i--) {
            if (SAFE_PUNC_LIST.test(searchText[i])) {
                lastPuncIndex = i;
                break;
            }
        }
        if (lastPuncIndex !== -1) {
            const foundIndex = (currentVisibleCount - lookbackRange) + lastPuncIndex + 1;
            const newOverlap = currentVisibleCount - foundIndex;
            if (newOverlap >= 5 && newOverlap <= MAX_WINDOW_SIZE * 0.8) {
                targetStartIndex = foundIndex;
            }
        }
        displayStartIndex = targetStartIndex;
    }

    const displayText = fullTargetText.slice(displayStartIndex, currentVisibleCount);
    const prefix = displayStartIndex > 0 ? "..." : "";
    renderSubtitleUI(prefix + displayText);
}

// An adaptive typewriter loop that also handles the 'text-only, no audio' case
function startTypewriterLoop() {
    if (typewriterTimer) return; // Prevent duplicate starts

    // Detect whether we're in text-only mode (no audio output or no audio node started)
    const isTextOnlyMode = !currentAudioContext || !chunkAnimations.has('omni_live_stream');

    if (isTextOnlyMode) {
        let lastUpdateTime = performance.now();
        const CHARS_PER_SECOND = 8; // Slow down the speed: set to 8 CJK characters per second for a more natural, comfortable read

        function typeTextOnly() {
            // If something forcibly interrupted (e.g. stopSpeaking), exit immediately
            if (!isOmniMode) {
                typewriterTimer = null;
                return;
            }

            const now = performance.now();
            const elapsed = now - lastUpdateTime;
            const interval = 1000 / CHARS_PER_SECOND;
            
            if (elapsed >= interval) {
                // Type smoothly, one character at a time, never skipping or flickering
                if (currentVisibleCount < fullTargetText.length) {
                    currentVisibleCount++;
                    updateSubtitleAndRoll();
                }
                // Subtract the remainder to keep the typing interval high-precision and even
                lastUpdateTime = now - (elapsed % interval);
            }

            // Only safely close the typewriter and wrap up once all text is printed and the AI stream has fully stopped
            if (currentVisibleCount >= fullTargetText.length && !isAudioStreaming) {
                typewriterTimer = null;
                isOmniMode = false; // Printing is fully done; release the state
                finalizeSpeech(false);
            } else {
                typewriterTimer = requestAnimationFrame(typeTextOnly);
            }
        }
        typewriterTimer = requestAnimationFrame(typeTextOnly);
        return;
    }

    // Standard audio-synced typing logic (original)
    function syncTextToAudio() {
        if (!isOmniMode || !currentAudioContext) {
            typewriterTimer = null;
            return;
        }

        const now = currentAudioContext.currentTime;
        const totalChars = fullTargetText.length;

        if (totalChars > 0 && omniTotalAudioDuration > 0) {
            const playedTime = Math.max(0, now - omniPlaybackStartTime);
            let progress = (playedTime / omniTotalAudioDuration) * 1.05; 
            progress = Math.min(1.0, progress); 

            let targetCharCount = Math.floor(progress * totalChars);

            if (!isAudioStreaming && now >= omniNextStartTime) {
                targetCharCount = totalChars;
            }

            if (targetCharCount > currentVisibleCount) {
                currentVisibleCount = targetCharCount;
                updateSubtitleAndRoll();
            }
        }

        if (!isOmniMode || (!isAudioStreaming && currentVisibleCount >= totalChars)) {
            typewriterTimer = null;
            if (!isOmniMode) finalizeSpeech(false);
        } else {
            typewriterTimer = requestAnimationFrame(syncTextToAudio);
        }
    }

    typewriterTimer = requestAnimationFrame(syncTextToAudio);
}


function stopTypewriterLoop() {
    if (typewriterTimer) {
        clearTimeout(typewriterTimer);
        typewriterTimer = null;
    }
}

// ==========================================
// 4. Audio-stream handling (Omni mode)
// ==========================================
async function processOmniStreaming(data) {
    const chunkId = 'omni_live_stream';
    
    try {
        if (!currentAudioContext) {
            currentAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (currentAudioContext.state === 'suspended') await currentAudioContext.resume();

        let state = chunkAnimations.get(chunkId);
        if (!state) {
            state = { 
                isPlaying: true, 
                analyser: currentAudioContext.createAnalyser(), 
                expression: 'neutral' 
            };
            state.analyser.fftSize = 256;
            state.analyser.connect(currentAudioContext.destination);
            chunkAnimations.set(chunkId, state);
            startChunkAnimation(chunkId, state);
            omniNextStartTime = currentAudioContext.currentTime;
        }

        const raw = atob(data.audioData);
        const pcm16 = new Int16Array(raw.length / 2);
        for (let i = 0; i < raw.length; i += 2) {
            pcm16[i >> 1] = raw.charCodeAt(i) | (raw.charCodeAt(i + 1) << 8);
        }
        
        const buffer = currentAudioContext.createBuffer(1, pcm16.length, data.sampleRate || 24000);
        const floatData = buffer.getChannelData(0);
        for (let i = 0; i < pcm16.length; i++) {
            floatData[i] = pcm16[i] / 32768;
        }

        const source = currentAudioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(state.analyser);

        const now = currentAudioContext.currentTime;

        if (omniNextStartTime === 0 || omniPlaybackStartTime === 0) {
            omniPlaybackStartTime = Math.max(now, omniNextStartTime);
        }

        if (omniNextStartTime < now) omniNextStartTime = now;
        
        source.start(omniNextStartTime);

        omniTotalAudioDuration += buffer.duration;
        omniNextStartTime += buffer.duration;
    } catch (e) {
        console.error('Omni Streaming Error:', e);
    }
}

// ==========================================
// 5. Subtitle rendering and cleanup
// ==========================================
function renderSubtitleUI(text) {
    if (!isSubtitleEnabled) return;
    if (!subtitleElement) initSubtitleElement();
    subtitleElement.textContent = text;
    subtitleElement.style.opacity = '1';
    if (typeof adjustSubtitleSize === 'function') adjustSubtitleSize();
}

function updateSubtitle(text, chunkIndex) {
    // Handle the subtitle display for traditional TTS
    if (!isSubtitleEnabled || !text.trim()) return;
    renderSubtitleUI(text);
    currentSubtitleChunkIndex = chunkIndex;
}

function clearSubtitle() {
    if (subtitleElement) {
        subtitleElement.style.transition = 'opacity 0.5s ease';
        subtitleElement.style.opacity = '0';
    }
}

function finalizeSpeech(immediate = false) {
    // Stop driving the animation
    stopAllChunkAnimations();
    if (chunkAnimations.has('omni_live_stream')) {
        stopChunkAnimation('omni_live_stream');
        chunkAnimations.delete('omni_live_stream');
    }

    if (immediate) {
        clearSubtitle();
        fullTargetText = "";
        currentVisibleCount = 0;
        displayStartIndex = 0;
    } else {
        // --- Optimization: after all text is printed, leave 2.5s of 'static reading time' ---
        if (subtitleTimeout) clearTimeout(subtitleTimeout);
        subtitleTimeout = setTimeout(() => {
            // Ensure no new conversation started during this time
            if (!isOmniMode && !typewriterTimer) {
                clearSubtitle();
                fullTargetText = "";
                currentVisibleCount = 0;
                displayStartIndex = 0;
            }
        }, 2000); 
    }
}


// Initialize the WebSocket after the page finishes loading
document.addEventListener('DOMContentLoaded', () => {
    // Delay initialization to ensure other components are ready
    setTimeout(() => {
        initTTSWebSocket();
    }, 2000);
});

if (isElectron) {
  // Disable Chromium's autoplay restriction
  const disableAutoplayPolicy = () => {
    if (window.chrome && chrome.webview) {
      chrome.webview.setAutoplayPolicy('no-user-gesture-required');
    }
  };
  
  // Run after user interaction
  document.addEventListener('click', () => {
    disableAutoplayPolicy();
    if (currentAudioContext) {
      currentAudioContext.resume();
    }
  });
}

// Add model-switching variables in the global-variable area
let currentModelIndex = 0;
let allModels = [];
let modelsInitialized = false;

// Function to get all available models (runs only once)
async function getAllModels() {
    if (modelsInitialized) {
        return allModels;
    }
    
    const vrmConfig = await fetchVRMConfig();
    const defaultModels = vrmConfig.defaultModels || [];
    const userModels = vrmConfig.userModels || [];
    allModels = [...defaultModels, ...userModels];
    
    // Find the index of the currently selected model
    const selectedModelId = vrmConfig.selectedModelId;
    currentModelIndex = Math.max(0, allModels.findIndex(model => model.id === selectedModelId));
    
    modelsInitialized = true;
    console.log(`Models initialized: ${allModels.length} models available, current index: ${currentModelIndex}`);
    
    return allModels;
}

// Switch to the model at the given index (frontend-only switch)
async function switchToModel(index,isRefresh = false) {
    if (!modelsInitialized) {
        await getAllModels();
    }
    
    if (allModels.length === 0) {
        console.error('No models available');
        return;
    }
    
    // Ensure the index stays in range (wrap around)
    const newIndex = ((index % allModels.length) + allModels.length) % allModels.length;
    
    // If it's the same model, no switch needed
    if (newIndex === currentModelIndex && !isRefresh) {
        console.log('Same model selected, no need to switch');
        return;
    }
    
    currentModelIndex = newIndex;
    const selectedModel = allModels[currentModelIndex];
    // Replace the protocol and host in userModel.path
    let userModelURL = new URL(selectedModel.path);
    userModelURL.protocol = window.location.protocol;
    userModelURL.host = window.location.host;
    selectedModel.path = userModelURL.href;
    console.log(`Switching to model: ${selectedModel.name} (${selectedModel.id}) - Index: ${currentModelIndex}`);
    // Before switching models, ensure the canvas and interaction are restored to visible
    isModelHiddenByHover = false;
    resumeModelAnimationsAfterHide();
    if (renderer?.domElement) {
        const canvas = renderer.domElement;
        canvas.style.opacity = '1';
        canvas.style.pointerEvents = 'auto';
        canvas.style.transition = '';
        if (currentVrm) currentVrm.scene.visible = true;
    }
    
    try {
        // Show a loading hint (optional)
        showModelSwitchingIndicator(selectedModel.name);
        // Added: stop the current idle animation
        if (idleAnimationManager) {
            idleAnimationManager.stopAllAnimations();
        }
        
        // Added: reset the idle-animation manager
        idleAnimationManager = null;

        // Remove the current VRM model
        if (currentVrm) {
            if (typeof transformControl !== 'undefined') {
                transformControl.detach();
            }
            // scene.remove(currentVrm.scene); <-- remove this line
            currentVrmWrapper.remove(currentVrm.scene); // Remove from the wrapper
            currentVrm = undefined;
        }
        disposeGlbPet();

        // Load the new model
        const modelPath = selectedModel.path;

        // Non-VRM .glb pet: use the lightweight loader and skip the VRM path
        if (/\.(glb|gltf)(\?|#|$)/i.test(modelPath)) {
            await loadGlbPet(modelPath).catch(e => console.error('[GlbPet] switch load failed', e));
            return;
        }

        loader.load(
            modelPath,
            (gltf) => {
                const vrm = gltf.userData.vrm;
                currentMixer = new THREE.AnimationMixer(vrm.scene); // Create the animation mixer
                isVRM1 = vrm.meta.metaVersion === '1';
                VRMUtils.rotateVRM0(vrm); // Rotate the VRM to face straight forward
                // Optimize performance
                // VRMUtils.removeUnnecessaryVertices(gltf.scene);
                // Add material fixes
                // gltf.scene.traverse((obj) => {
                // if (obj.isMesh && obj.material) {
                //     // fix the black-edge issue with transparent materials
                //     if (obj.material.transparent) {
                //         obj.material.alphaTest = 0.01;
                //         obj.material.depthWrite = true;
                //         obj.material.needsUpdate = true;
                //     }
                    
                //     // ensure the correct blend mode
                //     obj.material.blending = THREE.NormalBlending;
                //     obj.material.premultipliedAlpha = false;
                    
                //     // set the render order
                //     obj.renderOrder = obj.material.transparent ? 1 : 0;
                // }
                // });

                // VRMUtils.combineSkeletons(gltf.scene);
                // VRMUtils.combineMorphs(vrm);
                
                // Enable Spring Bone physics simulation
                if (vrm.springBoneManager) {
                    console.log('Spring Bone Manager found:', vrm.springBoneManager);
                }
                
                // Disable frustum culling
                vrm.scene.traverse((obj) => {
                    obj.frustumCulled = false;
                });
                
                vrm.lookAt.target = camera;

                if (vrm.lookAt.applier) {
                    vrm.lookAt.applier.yawLimit = 60.0;   // Max 60 degrees of left/right head turn
                    vrm.lookAt.applier.pitchLimit = 30.0; // Max 30 degrees of up/down head tilt
                }

                currentVrm = vrm;
                console.log('New VRM loaded:', vrm);
                currentVrmWrapper.add(vrm.scene);
                // Make the model cast shadows
                vrm.scene.traverse((obj) => {
                    if (obj.isMesh) {
                        obj.castShadow = true;
                        obj.receiveShadow = true;   // Keep this if you also want the model itself to receive shadows
                    }
                });
                // Set the natural pose
                setNaturalPose(vrm);

                if (vrm.expressionManager) {
                    vrm.expressionManager.setValue('neutral', 1.0);
                }

                const breathClip = createBreathClip(vrm);
                breathAction = currentMixer.clipAction(breathClip);
                breathAction.setLoop(THREE.LoopRepeat);
                breathAction.play();

                const blinkClip = createBlinkClip(vrm);
                blinkAction = currentMixer.clipAction(blinkClip);
                blinkAction.setLoop(THREE.LoopRepeat);
                blinkAction.play();
                
                // Key fix: recreate the idle-animation manager and reset the animation queue
                idleAnimationManager = new IdleAnimationManager(vrm, currentMixer);
                
                // Important: reset the VRMA animation queue (if it was loaded before)
                if (useVRMAIdleAnimations && idleAnimations.length > 0) {
                    idleAnimationManager.setAnimationQueue(idleAnimations);
                }
                
                // Restart the idle-animation loop
                startIdleAnimationLoop();

                // Hide the loading hint
                hideModelSwitchingIndicator();
                
                if (typeof transformControl !== 'undefined' && transformControl.object) {
                    transformControl.attach(currentVrmWrapper);
                }

                console.log(`Successfully switched to model: ${selectedModel.name}`);
            },
            (progress) => {
                console.log('Loading model...', 100.0 * (progress.loaded / progress.total), '%');
                // You can update the loading progress here
                updateModelLoadingProgress(progress.loaded / progress.total);
            },
            (error) => {
                console.error('Error loading model:', error);
                hideModelSwitchingIndicator();
                
                // If loading fails, try reverting to the previous model
                if (allModels.length > 1) {
                    console.log('Attempting to load fallback model...');
                    // Try loading the first model as a fallback
                    if (currentModelIndex !== 0) {
                        switchToModel(0);
                    }
                }
            }
        );
        
    } catch (error) {
        console.error('Error switching model:', error);
        hideModelSwitchingIndicator();
    }
}

// Show the model-switch indicator (optional feature)
function showModelSwitchingIndicator(modelName) {
    // Create or show the loading hint
    let indicator = document.getElementById('model-switching-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'model-switching-indicator';
        indicator.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 20px;
            border-radius: 10px;
            font-size: 16px;
            z-index: 10000;
            text-align: center;
            backdrop-filter: blur(10px);
            transition: opacity 0.3s ease;
        `;
        document.body.appendChild(indicator);
    }
    
    indicator.innerHTML = `
        <div style="margin-bottom: 10px;">
            <i class="fas fa-sync-alt fa-spin"></i>
        </div>
        <div>Loading ${modelName}...</div>
        <div id="loading-progress" style="margin-top: 10px; font-size: 14px; opacity: 0.8;"></div>
    `;
    indicator.style.display = 'block';
    indicator.style.opacity = '1';
}

// Update the loading progress
function updateModelLoadingProgress(progress) {
    const progressElement = document.getElementById('loading-progress');
    if (progressElement) {
        progressElement.textContent = `${Math.round(progress * 100)}%`;
    }
}

// Hide the model-switch indicator
function hideModelSwitchingIndicator() {
    const indicator = document.getElementById('model-switching-indicator');
    if (indicator) {
        indicator.style.opacity = '0';
        setTimeout(() => {
            indicator.style.display = 'none';
        }, 300);
    }
}

// Get the current model info
function getCurrentModelInfo() {
    if (allModels.length > 0 && currentModelIndex >= 0 && currentModelIndex < allModels.length) {
        return allModels[currentModelIndex];
    }
    return null;
}

// Get the next model's info (for preview)
function getNextModelInfo() {
    if (allModels.length === 0) return null;
    const nextIndex = ((currentModelIndex + 1) % allModels.length + allModels.length) % allModels.length;
    return allModels[nextIndex];
}

// Get the previous model's info (for preview)
function getPrevModelInfo() {
    if (allModels.length === 0) return null;
    const prevIndex = ((currentModelIndex - 1) % allModels.length + allModels.length) % allModels.length;
    return allModels[prevIndex];
}

animate();