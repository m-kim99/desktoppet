const urlParams = new URLSearchParams(window.location.search);
const isRenderMode = urlParams.get('mode') === 'render'; // Whether it's render mode (for OBS capture)
// --- Panoramic-rendering-specific variables ---
let cubeCamera, cubeRenderTarget, panoMesh, panoCamera, panoShaderMaterial;
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createGlbPetEntity, updateGlbPetEntity, disposeGlbPetEntity, GLB_MOTIONS, GLB_ACCESSORIES, setGlbPetAccessory } from './glb-pet-entity.js';
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
renderer.setPixelRatio(Math.min(Math.max(1, window.devicePixelRatio || 1), 2));   // cap 2x — 3x 패널에서도 레티나 이상은 낭비 (발열)
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
        console.log(data.VRMConfig);
        return data.VRMConfig;
    } catch (error) {
        console.error('Error fetching VRMConfig:', error);
        return   {
            name: 'default',
            enabledExpressions: false,
            enabledMotions: false,
            selectedModelId: 'chick', // 기본 펫: 병아리 (앨리스·밥 제거됨)
            defaultModels: [], // Store the default models
            userModels: [],     // Store user-uploaded models
            defaultMotions: [], // Store the default motions
            userMotions: [],     // Store user-uploaded motions
            selectedMotionIds: [],
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
            return `${window.location.protocol}//${window.location.host}/vrm/Chick.glb`;
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
            return 'Chick';
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
const light = new THREE.DirectionalLight( 0xffffff, 1.4 );  // key light (was 2.0; 0.6 moved to the fill light below to widen coverage at the same total brightness)
light.position.set( 1, 2.5, 2 ).normalize();   // broad top-front key light; y nudged slightly down (was 3) to lift the under-eye/mouth shadow
light.castShadow = true;                       // Key
light.shadow.mapSize.set( 2048, 2048 );        // Precision
light.shadow.radius = 8;                        // PCFSoft 블러 — 월드처럼 경계 흐린 은은한 그림자(얼굴 자기그림자 완화)
light.shadow.bias  = -0.0003;                   // 소프트 섀도 섀도우 액네 방지

// Make the shadow camera cover the area near the character (tune to your scene size)
const camSize = 4;
light.shadow.camera.left   = -camSize;
light.shadow.camera.right  =  camSize;
light.shadow.camera.top    =  camSize;
light.shadow.camera.bottom = -camSize;
light.shadow.camera.near   = 0.1;
light.shadow.camera.far    = 20;
scene.add( light );

// Fill light: ~30% of the key, from the opposite side (left-front, slightly lower) so the lit area
// is ~30% broader (both sides + lower face covered) while the total directional intensity stays 2.0
// (1.4 key + 0.6 fill) — wider coverage, same brightness. No shadow; only the key casts shadows.
const fillLight = new THREE.DirectionalLight( 0xffffff, 0.6 );
fillLight.position.set( -1, 1.8, 2.5 ).normalize();
scene.add( fillLight );

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



// lookat target
const lookAtTarget = new THREE.Object3D();
camera.add( lookAtTarget );

// Add ambient light to soften the overall look
const ambientLight = new THREE.AmbientLight( 0xffffff, 0.7 );  // 채움광 — 그림자를 옅고 은은하게(0.55→0.7, 월드 hemi 톤에 맞춤)
scene.add( ambientLight );

// gltf and vrm
let currentVrm = undefined;
let glbPet = null;                          // Non-VRM .glb "pet" model (no humanoid rig / morphs)
let currentGlbUrl = null;                   // 현재 로드된 .glb 펫 URL — 캐릭터 전환 시 갱신(채팅 라우팅용; vrmPath const는 초기값이라 stale)
let currentVrmWrapper = new THREE.Group(); // New: a group used to wrap the VRM
scene.add(currentVrmWrapper);              // New: add it to the scene from the start

let idleAnimationManager = null;   // VRM 유휴 애니 시스템 잔재 — 항상 null (가드 참조용, P3에서 정리)

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
        vrmWake();   // 말하는 동안(립싱크 재생 중)은 60fps 유지
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

        const incomingExpressions = data.expressions || [];

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
            vrmWake();   // 말하는 동안(립싱크 재생 중)은 60fps 유지
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
    disposeGlbPetEntity(glbPet);
    glbPet = null;
}

async function loadGlbPet(url) {
    // Clear any existing VRM/GLB so only one pet is active
    if (currentVrm) { try { currentVrmWrapper.remove(currentVrm.scene); } catch (e) {} currentVrm = undefined; }
    disposeGlbPet();
    currentGlbUrl = url;   // 전환 후에도 현재 펫(병아리/강아지)을 정확히 알 수 있게

    // On-screen size scales with the window's pixel height (fixed camera FOV), so the same model
    // looks bigger in a taller window. Normalize against a reference height so the main pet and a
    // shorter friend window render the character at the SAME on-screen size.
    const baseTargetH = 0.455;     // look at the reference height
    const REF_WIN_H = 726;         // friend window height — match everyone to this on-screen size
    const winH = window.innerHeight || REF_WIN_H;
    // 데탑 펫 크기: 강아지는 원래 크기 유지(×1.0), 병아리는 그 90%(×0.9)로 둔다. 월드 비율(0.8)로 하면
    // 병아리가 너무 작아서, 데탑에서만 살짝 크게 잡은 사용자 선호값 — 병아리:강아지 = 0.9. (world.js/월드와 별개.)
    const ratio = /chick/i.test(url) ? 0.9 : 1;
    const pet = await createGlbPetEntity(url, { targetHeight: baseTargetH * ratio * REF_WIN_H / winH, parent: currentVrmWrapper });

    // "💤" overlay shown above the head while sleeping (a floating CSS animation, hidden otherwise).
    let zzzEl = document.getElementById('glb-zzz');
    if (!zzzEl) {
        zzzEl = document.createElement('div');
        zzzEl.id = 'glb-zzz';
        zzzEl.textContent = '💤';
        zzzEl.style.cssText = 'position:fixed; left:58%; top:22%; font-size:44px; opacity:0; pointer-events:none; z-index:9998; transition:opacity 0.5s; animation:glbZzzFloat 2.4s ease-in-out infinite;';
        document.body.appendChild(zzzEl);
        const zstyle = document.createElement('style');
        zstyle.textContent = '@keyframes glbZzzFloat{0%{transform:translateY(0) scale(0.9);}50%{transform:translateY(-10px) scale(1.05);}100%{transform:translateY(-20px) scale(0.9);}}';
        document.head.appendChild(zstyle);
    }
    pet.setZzz = (on) => { zzzEl.style.opacity = on ? '0.9' : '0'; };

    // "💭" thought bubble shown above the head while the think motion plays.
    let thinkEl = document.getElementById('glb-think');
    if (!thinkEl) {
        thinkEl = document.createElement('div');
        thinkEl.id = 'glb-think';
        thinkEl.textContent = '💭';
        thinkEl.style.cssText = 'position:fixed; left:60%; top:18%; font-size:44px; opacity:0; pointer-events:none; z-index:9998; transition:opacity 0.3s; animation:glbThinkBob 1.6s ease-in-out infinite;';
        document.body.appendChild(thinkEl);
        const tstyle = document.createElement('style');
        tstyle.textContent = '@keyframes glbThinkBob{0%,100%{transform:translateY(0) scale(1);}50%{transform:translateY(-6px) scale(1.06);}}';
        document.head.appendChild(tstyle);
    }
    pet.setThink = (on) => { thinkEl.style.opacity = on ? '0.95' : '0'; };

    // "파이팅!" cheer text shown while the cheer motion plays (no bubble; color randomized each play).
    let cheerEl = document.getElementById('glb-cheer');
    if (!cheerEl) {
        cheerEl = document.createElement('div');
        cheerEl.id = 'glb-cheer';
        cheerEl.textContent = '파이팅!';
        cheerEl.style.cssText = 'position:fixed; left:50%; top:13%; transform:translateX(-50%); font-size:18px; font-weight:700; color:#ff5a5f; text-shadow:0 2px 5px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.5); opacity:0; pointer-events:none; z-index:9998; transition:opacity 0.2s; white-space:nowrap;';
        document.body.appendChild(cheerEl);
    }
    // Pick a fresh random color on each hidden→shown transition, i.e. each time the cheer motion plays.
    pet.setCheer = (on) => {
        if (on && cheerEl.style.opacity !== '1') {
            cheerEl.style.color = `hsl(${Math.floor(Math.random() * 360)}, 85%, 58%)`;
        }
        cheerEl.style.opacity = on ? '1' : '0';
    };

    // Food prop on the ground while the eat motion plays — 🌾 grain for the chick, 🥣 bowl for the puppy.
    let eatEl = document.getElementById('glb-eat');
    if (!eatEl) {
        eatEl = document.createElement('div');
        eatEl.id = 'glb-eat';
        eatEl.style.cssText = 'position:fixed; left:50%; top:70%; transform:translateX(-50%); font-size:40px; opacity:0; pointer-events:none; z-index:9998; transition:opacity 0.25s;';
        document.body.appendChild(eatEl);
    }
    eatEl.textContent = pet.wings.length ? '🌾' : '🥣';
    pet.setEat = (on) => { eatEl.style.opacity = on ? '1' : '0'; };

    glbPet = pet;
    glbPet.action = { id: 'wave', t: 0 };   // greet when the character appears / is summoned
    if (typeof hideModelSwitchingIndicator === 'function') { try { hideModelSwitchingIndicator(); } catch (e) {} }
}

// Play a motion. 'sleep' is a state (stays until the pet is clicked or starts walking); others are
// timed one-shots that updateGlbPetEntity drives via glbPet.action.
function playGlbMotion(id) {
    if (!glbPet) return;
    if (id === 'sleep') { glbPet.sleeping = true; return; }
    glbPet.sleeping = false; glbPet.autoSleeping = false;   // any other motion wakes the pet
    if (id === 'holiday') {
        // Holiday is duo-capable like hug: main slides the two pet windows side-by-side and cues
        // both halves (partner mirrored, half a beat behind). Solo carol steps when alone.
        if (window.electronAPI && window.electronAPI.vrmHoliday) {
            window.electronAPI.vrmHoliday().catch(() => { glbPet.action = { id: 'holiday', t: 0 }; });
        } else {
            glbPet.action = { id: 'holiday', t: 0 };
        }
        return;
    }
    if (id === 'hug') {
        // Hug is a two-pet motion: ask main to choreograph the windows; it echoes 'vrm-hug-play'
        // back to start the per-pet half here (and on the partner). Falls back to a solo air-hug.
        if (window.electronAPI && window.electronAPI.vrmHug) {
            window.electronAPI.vrmHug().catch(() => { glbPet.action = { id: 'hug', t: 0, role: 'solo', dir: 1 }; });
        } else {
            glbPet.action = { id: 'hug', t: 0, role: 'solo', dir: 1 };
        }
        return;
    }
    if (id === 'play') {
        // Play (catch) is also a two-pet motion choreographed by main (ball window + synced cues).
        if (window.electronAPI && window.electronAPI.vrmPlay) {
            window.electronAPI.vrmPlay().catch(() => { glbPet.action = { id: 'play', t: 0, role: 'solo', dir: 1, cue: 'ready', cueT: 0 }; });
        } else {
            glbPet.action = { id: 'play', t: 0, role: 'solo', dir: 1, cue: 'ready', cueT: 0 };
        }
        return;
    }
    glbPet.action = { id, t: 0 };
}

// Main signals both windows to start their hug halves in sync (or just this one for a solo air-hug).
if (window.electronAPI && window.electronAPI.onVrmHugPlay) {
    window.electronAPI.onVrmHugPlay(({ role, dir } = {}) => {
        if (!glbPet) return;
        glbPet.sleeping = false; glbPet.autoSleeping = false;
        glbPet.action = { id: 'hug', t: 0, role: role || 'solo', dir: dir || 1 };
    });
}

// Main cues both windows' holiday halves (partner mirrored + half a beat behind) — or a solo dance.
if (window.electronAPI && window.electronAPI.onVrmHolidayPlay) {
    window.electronAPI.onVrmHolidayPlay(({ dir, duoShift } = {}) => {
        if (!glbPet) return;
        glbPet.sleeping = false; glbPet.autoSleeping = false;
        glbPet.action = { id: 'holiday', t: 0, dir: dir || 1, duoShift: duoShift || 0 };
    });
}

// Play (catch): main starts both pets, then cues each to throw/catch/finish in sync with the ball.
if (window.electronAPI && window.electronAPI.onVrmPlayStart) {
    window.electronAPI.onVrmPlayStart(({ role, dir } = {}) => {
        if (!glbPet) return;
        glbPet.sleeping = false; glbPet.autoSleeping = false;
        glbPet.action = { id: 'play', t: 0, role: role || 'solo', dir: dir || 1, cue: 'ready', cueT: 0 };
    });
}
if (window.electronAPI && window.electronAPI.onVrmPlayCue) {
    window.electronAPI.onVrmPlayCue((data = {}) => {
        if (!glbPet || !glbPet.action || glbPet.action.id !== 'play') return;
        if (data.cue === 'end') { glbPet.action = null; return; }
        glbPet.action.cue = data.cue || 'ready';
        glbPet.action.cueT = 0;
    });
}
// 메인 펫이 캐릭터를 바꾸면 이 친구 창은 '반대' 펫으로 따라 전환한다 (메인은 무시).
if (window.electronAPI && window.electronAPI.onVrmFriendFollow) {
    window.electronAPI.onVrmFriendFollow(({ modelId } = {}) => {
        if (!modelId || windowName === 'default') return;
        const go = () => { const i = (allModels || []).findIndex(m => m.id === modelId); if (i >= 0) switchToModel(i); };
        if (typeof allModels !== 'undefined' && allModels.length) go();
        else getAllModels().then(go).catch(() => {});
    });
}

let VRMname = await getVRMname();
showModelSwitchingIndicator(VRMname);
const __isGlbPet = /\.(glb|gltf)(\?|#|$)/i.test(vrmPath);
if (__isGlbPet) {
    loadGlbPet(vrmPath).catch(e => console.error('[GlbPet] load failed', e));
} else
{
    console.warn('[VRM] 인간형 아바타는 제거됨 — GLB 펫만 지원:', vrmPath);
    hideModelSwitchingIndicator();
}

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
        top: 10%;
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


// animate
const clock = new THREE.Clock();
clock.start();

// ♡ 프레임 페이싱 (world.js와 같은 원칙): 데스크톱 펫 창은 하루 종일 떠 있는데, rAF를 그대로
// 두면 ProMotion 패널에서 120fps로 돈다. 활동 중(포인터·모션 재생·말하기·XR)에만 60fps,
// 활동 직후 idle은 30fps, 30초 넘게 조용하면 15fps — 작은 창의 숨쉬기·깜빡임은 15fps로도
// 충분히 읽히고, 하루 종일 떠 있는 창이라 이 바닥값이 상시 발열을 결정한다.
let vrmLastFrameMs = 0;
let vrmLastActiveMs = performance.now();
let vrmLastBusyMs = performance.now();   // vrmActive가 마지막으로 참이었던 시각 — 15fps 티어 판정
function vrmWake() { vrmLastActiveMs = performance.now(); }
for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) {
    window.addEventListener(ev, vrmWake, { passive: true, capture: true });
}
function vrmActive() {
    if (renderer.xr.isPresenting || isRenderMode) return true;   // XR·파노라마 캡처는 항상 풀 페이스
    if (glbPet && glbPet.action) return true;                    // GLB 펫 모션 재생 중 (춤·인사…)
    return performance.now() - vrmLastActiveMs < 4000;           // 입력·말하기 후 4초의 여운
}
function vrmFrameIntervalMs() {
    const now = performance.now();
    if (vrmActive()) { vrmLastBusyMs = now; return 15.5; }
    return now - vrmLastBusyMs > 30000 ? 65 : 31;   // 65 < 8.3×8=66.4 / 16.7×4=66.7 — 페이싱 균일
}
let currentLookYaw = 0;   // Left/right yaw (Y axis)
let currentLookPitch = 0; // Up/down pitch (X axis)

let isPreviewing360 = false;
let debugSphere, debugCamera, debugControls;

function animate() {
    requestAnimationFrame(animate);

    // 60/30/15fps 게이트 — 스킵한 시간은 다음 프레임 delta에 흡수되고, clamp가 오래 멈춘 뒤의
    // 물리 폭주를 막는다 (기존엔 클램프 없이도 매 프레임이라 문제가 없었을 뿐).
    const nowMs = performance.now();
    if (nowMs - vrmLastFrameMs < vrmFrameIntervalMs()) return;
    vrmLastFrameMs = nowMs;

    const deltaTime = Math.min(clock.getDelta(), 0.1);
    updatePointerLockMovement(deltaTime);
    const shouldSkipModelUpdate = isModelHiddenByHover && isAutoHideEnabled;
    // 호버 자동 숨김 중엔 캔버스가 CSS opacity 0 — 보이지 않는 프레임은 그리지도 않는다.
    // (렌더 모드·XR은 화면 밖 소비자가 있으니 예외.)
    if (shouldSkipModelUpdate && !isRenderMode && !renderer.xr.isPresenting) return;

    if (glbPet && !shouldSkipModelUpdate) updateGlbPetEntity(glbPet, deltaTime);

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

    let textReplyHideTimer = null;
    async function sendTextInputMessage() {
        const text = textInputField.value.trim();
        if (!text) return;
        // 데스크톱 GLB 펫(병아리/강아지)은 월드의 그 펫 두뇌(world_chat)로 직접 답한다 — TTS·메인앱
        // 중계 없이 자기 성격·기억으로 답하고 말풍선에 띄운다. 월드 장면이 없으니 '데스크톱 컨텍스트'를 준다.
        // (기억은 월드와 공유: pet 키가 곧 스토어 키. 나중에 분리하려면 이 키만 갈면 됨.)
        const petUrl = currentGlbUrl || vrmPath;   // 캐릭터 전환 반영(메인이 강아지일 수도 있음)
        const isGlbPet = !!glbPet && /chick|puppy/i.test(petUrl);
        if (isGlbPet) {
            textInputField.value = '';
            const petName = /puppy/i.test(petUrl) ? 'puppy' : 'chick';
            const n = new Date();
            const hhmm = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
            const deskCtx = `너는 지금 월드가 아니라 사용자의 데스크톱 화면 한켠에 있는 작은 동반자다. 현재 시각 ${hhmm}. 월드 활동(낚시·수영·요리 등)이나 행동 태그(<...>)는 지금 쓸 수 없다. 한두 문장으로 짧고 다정하게 답해라.`;
            const showBubble = (msg) => {
                if (!msg) return;
                renderSubtitleUI(msg);
                if (subtitleElement) subtitleElement.style.opacity = '1';
                vrmLastSpeakTs = Date.now();   // 혼잣말(idle talk)이 바로 덮어쓰지 않게 활동으로 기록
                clearTimeout(textReplyHideTimer);
                textReplyHideTimer = setTimeout(() => { if (subtitleElement) subtitleElement.style.opacity = '0'; }, Math.min(14000, 4000 + msg.length * 90));
            };
            try {
                const res = await fetch('/api/world_chat', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pet: petName, text, snapshot: deskCtx, events: '' }),
                });
                if (!res.ok) throw new Error(String(res.status));
                const reply = String((await res.json()).reply || '').replace(/<[^>]+>/g, '').trim();   // 월드 행동 태그 제거 후 표시
                showBubble(reply || '…');
            } catch (e) {
                showBubble('으엥, 대답이 안 나와… 메인 모델 설정을 확인해줘 💦');
            }
            return;
        }
        // (VRM 아바타 등) 기존 경로: 메인 앱 채팅 파이프라인에 위임
        if (pttMainWs && pttMainWs.readyState === WebSocket.OPEN) {
            pttMainWs.send(JSON.stringify({ type: "set_user_input", data: { text: text } }));
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
        flex-wrap: wrap;
        align-content: flex-start;
        max-height: calc(100vh - 20px);
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
            hideButton.title = hideDesc || '마우스를 올리면 자동 숨김';
            updateHideButtonState();
        }

        async function updateHideButtonState() {
            if (isAutoHideActive) {
                hideButton.innerHTML = '<i class="fas fa-eye-slash"></i>';
                hideButton.style.color = '#ffc107';
                hideButton.title = await t('AutoHideEnabled') || '자동 숨김 켜짐, 클릭하면 끄기';
            } else {
                hideButton.innerHTML = '<i class="fas fa-eye"></i>';
                hideButton.style.color = '#6c757d';
                hideButton.title = await t('AutoHideDescription') || '마우스를 올리면 자동 숨김, 클릭하면 켜기';
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
                moreButton.title = await t('collapse') || '패널 접기';
            } else {
                subPanel.style.opacity = '0';
                subPanel.style.visibility = 'hidden';
                subPanel.style.transform = 'translateX(10px) scale(1)';
                subPanel.style.pointerEvents = 'none';
                moreButton.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
                moreButton.style.color = '#333';
                moreButton.title = await t('MoreOptions') || '더보기';
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
            if (!moreButton.title) moreButton.title = await t('MoreOptions') || '더보기';
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
            const initialTitle = await t('EnableVoiceInput') || '음성 입력 켜기';
            voiceControlBtn.title = initialTitle;
            addHoverEffect(voiceControlBtn, initialTitle); // Call your existing tooltip-enhancement function
        })();

        // 3. Add dynamic title updates in the click event
        bindTapEvent(voiceControlBtn, async (e) => {
            pttVisible = !pttVisible;
            const fBtn = document.getElementById('ptt-floating-btn');
            
            // Get the new title text
            const activeTitle = pttVisible 
                ? (await t('DisableVoiceInput') || '음성 입력 끄기') 
                : (await t('EnableVoiceInput') || '음성 입력 켜기');

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
            const initialTitle = await t('EnableTextInput') || '텍스트 입력 켜기';
            textControlBtn.title = initialTitle;
            addHoverEffect(textControlBtn, initialTitle);
        })();

        bindTapEvent(textControlBtn, async (e) => {
            // Share the toggle logic to stay in sync with the global-shortcut state
            const visible = setVrmTextInputVisible();

            const activeTitle = visible
                ? (await t('DisableTextInput') || '텍스트 입력 끄기')
                : (await t('EnableTextInput') || '텍스트 입력 켜기');

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
                    const res = await fetch('/get_default_vrm_models');
                    const models = ((await res.json()).models) || [];
                    if (models.length === 0) return;
                    // 현재(전환 반영) 메인 펫 기준으로 '다른' 펫을 친구로 소환 — 영속 selectedModelId는
                    // 프론트 전환을 안 반영해 stale(메인=강아지인데 또 강아지 소환하던 버그).
                    const curId = /puppy/i.test(currentGlbUrl || '') ? 'puppy' : 'chick';
                    const friend = models.find(m => m.id !== curId) || models[0];
                    await window.electronAPI.summonFriend({ modelId: friend.id });
                } catch (e) { console.error('[SummonFriend] failed', e); }
            });
        }

        // Motion button (main pet): click to open a dropdown of on-demand motions and play one.
        // Walk/Idle are default states and are intentionally not in the list. The menu is built from
        // GLB_MOTIONS, so new motions appear automatically as they're added.
        const motionButton = document.createElement('div');
        motionButton.id = 'motion-handle';
        motionButton.innerHTML = '<i class="fas fa-person-running"></i>';
        motionButton.style.cssText = `
            position: relative;
            width: ${btn_width}px; height: ${btn_height}px; background: rgba(255,255,255,0.95);
            border: 2px solid rgba(0,0,0,0.1); border-radius: 50%; color: #333333; cursor: pointer;
            -webkit-app-region: no-drag; display: flex; align-items: center; justify-content: center;
            font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transform 0.2s;
            user-select: none; pointer-events: auto; backdrop-filter: blur(10px);
        `;
        motionButton.addEventListener('mouseenter', () => { motionButton.style.background = 'rgba(255,255,255,1)'; motionButton.style.transform = 'scale(1.1)'; motionButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)'; });
        motionButton.addEventListener('mouseleave', () => { motionButton.style.background = 'rgba(255,255,255,0.95)'; motionButton.style.transform = 'scale(1)'; motionButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; });
        (async () => { const title = await t('playMotion') || '모션'; motionButton.title = title; addHoverEffect(motionButton, title); })();

        // Dropdown menu, opens to the left so it stays on-screen in the narrow pet window.
        const motionMenu = document.createElement('div');
        motionMenu.id = 'motion-menu';
        motionMenu.style.cssText = `
            position: absolute; right: 100%; top: 0; margin-right: 8px;
            display: none; flex-direction: column; gap: 4px; padding: 6px; min-width: 120px;
            max-height: 104px; overflow-y: auto;
            background: rgba(255,255,255,0.97); border: 1px solid rgba(0,0,0,0.1); border-radius: 10px;
            box-shadow: 0 6px 18px rgba(0,0,0,0.2); z-index: 10000; -webkit-app-region: no-drag;
            backdrop-filter: blur(10px);
        `;
        motionButton.appendChild(motionMenu);
        let motionMenuOpen = false;
        const closeMotionMenu = () => { motionMenu.style.display = 'none'; motionMenuOpen = false; };
        const renderMotionMenu = () => {
            motionMenu.innerHTML = '';
            if (!GLB_MOTIONS.length) {
                const empty = document.createElement('div');
                empty.textContent = '곧 추가됩니다';
                empty.style.cssText = 'padding:6px 8px; font-size:12px; color:#999; text-align:center; user-select:none; white-space:nowrap;';
                motionMenu.appendChild(empty);
                return;
            }
            GLB_MOTIONS.forEach(m => {
                const item = document.createElement('div');
                item.textContent = m.label;
                item.style.cssText = 'flex-shrink:0; padding:6px 10px; font-size:13px; color:#333; cursor:pointer; border-radius:6px; white-space:nowrap; user-select:none;';
                item.addEventListener('mouseenter', () => item.style.background = 'rgba(0,0,0,0.06)');
                item.addEventListener('mouseleave', () => item.style.background = 'transparent');
                item.addEventListener('click', (e) => { e.stopPropagation(); playGlbMotion(m.id); closeMotionMenu(); });
                motionMenu.appendChild(item);
            });
            // 코디 items after the motions (divider above the first): click toggles wear/remove.
            GLB_ACCESSORIES.forEach((a, i) => {
                const worn = !!(glbPet && glbPet.accessory && glbPet.accessory.id === a.id);
                const item = document.createElement('div');
                item.textContent = worn ? `${a.label} 벗기` : a.label;
                item.style.cssText = 'flex-shrink:0; padding:6px 10px; font-size:13px; color:#333; cursor:pointer; border-radius:6px; white-space:nowrap; user-select:none;' + (i === 0 ? 'border-top:1px solid rgba(0,0,0,0.08); margin-top:4px;' : '');
                item.addEventListener('mouseenter', () => item.style.background = 'rgba(0,0,0,0.06)');
                item.addEventListener('mouseleave', () => item.style.background = 'transparent');
                item.addEventListener('click', (e) => { e.stopPropagation(); if (glbPet) setGlbPetAccessory(glbPet, worn ? null : a.id); closeMotionMenu(); });
                motionMenu.appendChild(item);
            });
        };
        bindTapEvent(motionButton, () => {
            if (motionMenuOpen) { closeMotionMenu(); }
            else { renderMotionMenu(); motionMenu.style.display = 'flex'; motionMenuOpen = true; }
        });
        // Close the menu when clicking anywhere outside the button.
        document.addEventListener('pointerdown', (e) => { if (motionMenuOpen && !motionButton.contains(e.target)) closeMotionMenu(); });

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
        controlPanel.appendChild(motionButton);        // Motion dropdown
        controlPanel.appendChild(moreButton);          // More button
        controlPanel.appendChild(refreshButton);       // Refresh
        controlPanel.appendChild(closeButton);         // Close


        // 2. Assemble the sub-panel (holding secondary buttons)
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
            motionButton,        // Motion dropdown button
            moreButton,          // Make the 'more' button subject to lock control
            refreshButton, 
            closeButton,
            // The following are sub-panel buttons; add them to the array too for consistent state
            subtitleButton, 
            switchCtrlBtn,
            moveModeBtn,
            wsStatusButton,
            xrAutoBtn
        );

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
        addHoverEffect(xrAutoBtn, await t('EnterXR') || 'Enter XR');
        addHoverEffect(switchCtrlBtn, pointerLocked ? await t('ExitFirstPerson') || 'Exit First-Person' : await t('EnterFirstPerson') || 'Enter First-Person');
        

        async function updateButtonTooltips() {
            addHoverEffect(lockButton, isMouseLocked ? await t('UnlockWindow') : await t('LockWindow'));
            addHoverEffect(hideButton, isAutoHideActive ? await t('AutoHideEnabled') : await t('AutoHideDescription'));
            addHoverEffect(wsStatusButton, wsConnected ? await t('WebSocketConnected') : await t('WebSocketDisconnected'));
            addHoverEffect(subtitleButton, isSubtitleEnabled ? await t('SubtitleEnabled') : await t('SubtitleDisabled'));
            addHoverEffect(switchCtrlBtn, pointerLocked ? await t('ExitFirstPerson') || 'Exit First-Person (WASD+QE)' : await t('EnterFirstPerson') || 'Enter First-Person (WASD+QE)');
            
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
            addHoverEffect(voiceControlBtn, vText || (pttVisible ? '음성 입력 끄기' : '음성 입력 켜기'));
            const tText = textInputVisible ? await t('DisableTextInput') : await t('EnableTextInput');
            addHoverEffect(textControlBtn, tText || (textInputVisible ? '텍스트 입력 끄기' : '텍스트 입력 켜기'));
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
    // Summoned "friend": mirror the main pet's interaction — mouse-drag on the model ROTATES it
    // (OrbitControls stays enabled, exactly like the main window). No control panel; only a close
    // button is shown on hover. (The friend repositions itself by wandering.)
    renderer.domElement.style.cursor = 'grab';   // hint the model can be dragged (to rotate)

    // --- close button: below the character's feet (camera looks at the feet ~vertical center) ---
    const fClose = document.createElement('div');
    fClose.innerHTML = '<i class="fas fa-times"></i>';
    fClose.style.cssText = `
        position: fixed; top: 8px; right: 8px; width: 26px; height: 26px;
        border-radius: 50%; background: rgba(255,255,255,0.92); border: 1px solid rgba(0,0,0,0.1);
        color: #333; display: flex; align-items: center; justify-content: center; cursor: pointer;
        font-size: 13px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); z-index: 999999; user-select: none;
        opacity: 0; pointer-events: none; transition: opacity 0.2s;
    `;
    try { t('closeWindow').then(v => { if (v) fClose.title = v; }).catch(() => {}); } catch (e) {}
    fClose.addEventListener('pointerdown', (e) => e.stopPropagation());
    fClose.addEventListener('click', (e) => { e.stopPropagation(); window.close(); });
    document.body.appendChild(fClose);

    // --- motion button: play a motion on this friend (the only control besides close) ---
    const fMotion = document.createElement('div');
    fMotion.innerHTML = '<i class="fas fa-person-running"></i>';
    fMotion.title = '모션';
    fMotion.style.cssText = `
        position: fixed; top: 40px; right: 8px; width: 26px; height: 26px;
        border-radius: 50%; background: rgba(255,255,255,0.92); border: 1px solid rgba(0,0,0,0.1);
        color: #333; display: flex; align-items: center; justify-content: center; cursor: pointer;
        font-size: 13px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); z-index: 999999; user-select: none;
        opacity: 0; pointer-events: none; transition: opacity 0.2s;
    `;
    const fMenu = document.createElement('div');
    fMenu.style.cssText = `
        position: fixed; top: 104px; right: 8px; display: none; flex-direction: column; gap: 4px;
        padding: 6px; min-width: 110px; max-height: 104px; overflow-y: auto; background: rgba(255,255,255,0.97);
        border: 1px solid rgba(0,0,0,0.1); border-radius: 10px; box-shadow: 0 6px 18px rgba(0,0,0,0.2);
        z-index: 1000000; user-select: none;
    `;
    let fMenuOpen = false;
    const fCloseMenu = () => { fMenu.style.display = 'none'; fMenuOpen = false; };
    const fRenderMenu = () => {
        fMenu.innerHTML = '';
        if (!GLB_MOTIONS.length) {
            const empty = document.createElement('div');
            empty.textContent = '곧 추가됩니다';
            empty.style.cssText = 'padding:6px 8px; font-size:12px; color:#999; text-align:center; white-space:nowrap;';
            fMenu.appendChild(empty);
            return;
        }
        GLB_MOTIONS.forEach(m => {
            const item = document.createElement('div');
            item.textContent = m.label;
            item.style.cssText = 'flex-shrink:0; padding:6px 10px; font-size:13px; color:#333; cursor:pointer; border-radius:6px; white-space:nowrap;';
            item.addEventListener('mouseenter', () => item.style.background = 'rgba(0,0,0,0.06)');
            item.addEventListener('mouseleave', () => item.style.background = 'transparent');
            item.addEventListener('pointerdown', (e) => e.stopPropagation());
            item.addEventListener('click', (e) => { e.stopPropagation(); playGlbMotion(m.id); fCloseMenu(); });
            fMenu.appendChild(item);
        });
        // 코디 items after the motions (divider above the first): click toggles wear/remove.
        GLB_ACCESSORIES.forEach((a, i) => {
            const worn = !!(glbPet && glbPet.accessory && glbPet.accessory.id === a.id);
            const item = document.createElement('div');
            item.textContent = worn ? `${a.label} 벗기` : a.label;
            item.style.cssText = 'flex-shrink:0; padding:6px 10px; font-size:13px; color:#333; cursor:pointer; border-radius:6px; white-space:nowrap;' + (i === 0 ? 'border-top:1px solid rgba(0,0,0,0.08); margin-top:4px;' : '');
            item.addEventListener('mouseenter', () => item.style.background = 'rgba(0,0,0,0.06)');
            item.addEventListener('mouseleave', () => item.style.background = 'transparent');
            item.addEventListener('pointerdown', (e) => e.stopPropagation());
            item.addEventListener('click', (e) => { e.stopPropagation(); if (glbPet) setGlbPetAccessory(glbPet, worn ? null : a.id); fCloseMenu(); });
            fMenu.appendChild(item);
        });
    };
    fMotion.addEventListener('pointerdown', (e) => e.stopPropagation());
    fMotion.addEventListener('click', (e) => {
        e.stopPropagation();
        if (fMenuOpen) { fCloseMenu(); }
        else { fRenderMenu(); fMenu.style.display = 'flex'; fMenuOpen = true; }
    });
    document.body.appendChild(fMotion);
    document.body.appendChild(fMenu);
    document.addEventListener('pointerdown', (e) => { if (fMenuOpen && !fMotion.contains(e.target) && !fMenu.contains(e.target)) fCloseMenu(); });

    // --- chat button: talk to THIS friend (its own text input; sendTextInputMessage routes to
    // world_chat with this window's pet = 강아지). 메인 펫과 대칭이 되도록 친구도 채팅 버튼을 가진다.
    const fChat = document.createElement('div');
    fChat.innerHTML = '<i class="fas fa-keyboard"></i>';
    fChat.style.cssText = `
        position: fixed; top: 72px; right: 8px; width: 26px; height: 26px;
        border-radius: 50%; background: rgba(255,255,255,0.92); border: 1px solid rgba(0,0,0,0.1);
        color: #333; display: flex; align-items: center; justify-content: center; cursor: pointer;
        font-size: 13px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); z-index: 999999; user-select: none;
        opacity: 0; pointer-events: none; transition: opacity 0.2s;
    `;
    try { t('EnableTextInput').then(v => { if (v) fChat.title = v; }).catch(() => {}); } catch (e) {}
    setupTextInteraction();   // 친구 창 전용 입력창 생성 (+ sendTextInputMessage = world_chat 직결, pet=이 창 모델)
    const fInput = document.getElementById('text-input-container');
    const fField = document.getElementById('text-input-field');
    let fChatOpen = false;
    const setFriendChat = (open) => {
        fChatOpen = open;
        if (!fInput) return;
        fInput.style.opacity = open ? '1' : '0';
        fInput.style.pointerEvents = open ? 'auto' : 'none';
        fInput.style.transform = open ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(20px)';
        if (open && fField) setTimeout(() => { try { fField.focus(); } catch (e) {} }, 50);
    };
    // 마우스 통과 잠금 상태에서도 입력창을 쓸 수 있게 (메인 창과 동일 처리)
    if (fInput && fField) {
        fInput.addEventListener('mouseenter', () => { if (isMouseLocked && window.electronAPI) window.electronAPI.setIgnoreMouseEvents(false); });
        fInput.addEventListener('mouseleave', () => { if (isMouseLocked && window.electronAPI && document.activeElement !== fField) window.electronAPI.setIgnoreMouseEvents(true, { forward: true }); });
        fField.addEventListener('focus', () => { if (isMouseLocked && window.electronAPI) window.electronAPI.setIgnoreMouseEvents(false); });
        fField.addEventListener('blur', () => { if (isMouseLocked && window.electronAPI && !fInput.matches(':hover')) window.electronAPI.setIgnoreMouseEvents(true, { forward: true }); });
    }
    fChat.addEventListener('pointerdown', (e) => e.stopPropagation());
    fChat.addEventListener('click', (e) => { e.stopPropagation(); setFriendChat(!fChatOpen); });
    document.body.appendChild(fChat);

    // Reveal the chat + motion + close buttons only while the mouse is over the friend; hide after a
    // short idle (but keep them up while the motion menu or the chat input is open).
    let _fHideTimer = null;
    const _revealFriendUI = () => {
        for (const el of [fClose, fMotion, fChat]) { el.style.opacity = '1'; el.style.pointerEvents = 'auto'; }
        if (_fHideTimer) clearTimeout(_fHideTimer);
        _fHideTimer = setTimeout(() => {
            if (fMenuOpen || fChatOpen) return;
            for (const el of [fClose, fMotion, fChat]) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; }
        }, 2000);
    };
    window.addEventListener('mousemove', _revealFriendUI);
    window.addEventListener('pointerdown', _revealFriendUI);
}

// ===== Drag to move the window; right-drag to rotate (standard desktop-pet behavior) =====
// For both the main pet and summoned friends: LEFT-drag on the model MOVES the whole pet across
// the desktop (window + character together), driven via IPC (getVrmWindowPos/setVrmWindowPos),
// which moves freely in every direction. ROTATION stays available on the RIGHT button (right-drag),
// so both gestures coexist. (Clicks on the control panel / close button still hit those elements,
// not the canvas, so they keep working.)
if (!isRenderMode && window.electronAPI && window.electronAPI.setVrmWindowPos) {
    const _moveCanvas = renderer.domElement;
    _moveCanvas.style.cursor = 'grab';
    // Left button = move the window (handled below); right button = rotate (OrbitControls).
    try {
        controls.enableRotate = true;
        controls.enablePan = false;
        controls.mouseButtons.LEFT = null;
        controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
        _moveCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
    } catch (e) {}
    let _wm = false, _wmX = 0, _wmY = 0, _wmSx = 0, _wmSy = 0;
    _moveCanvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (glbPet) { glbPet.sleeping = false; glbPet.autoSleeping = false; }   // clicking the pet wakes it up
        _wmSx = e.screenX; _wmSy = e.screenY; _moveCanvas.style.cursor = 'grabbing';
        try { _moveCanvas.setPointerCapture(e.pointerId); } catch (err) {}
        window.electronAPI.getVrmWindowPos().then((p) => { _wmX = p[0]; _wmY = p[1]; _wm = true; }).catch(() => {});
    });
    _moveCanvas.addEventListener('pointermove', (e) => {
        if (!_wm) return;
        window.electronAPI.setVrmWindowPos(_wmX + (e.screenX - _wmSx), _wmY + (e.screenY - _wmSy));
    });
    const _endWindowMove = (e) => { _wm = false; _moveCanvas.style.cursor = 'grab'; try { _moveCanvas.releasePointerCapture(e.pointerId); } catch (err) {} };
    _moveCanvas.addEventListener('pointerup', _endWindowMove);
    _moveCanvas.addEventListener('pointercancel', _endWindowMove);
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
// ===== Auto-sleep: doze off when the user is away (10 min idle), sooner at night (23:00–07:00) =====
// Uses the system-wide idle time (powerMonitor) so the pet sleeps when YOU step away, not merely
// when the pet isn't clicked. Auto-sleep is undone when activity resumes; a manual sleep (from the
// motion menu) is left alone — it only ends on a click.
(function setupAutoSleep() {
    if (!(window.electronAPI && typeof window.electronAPI.getSystemIdleTime === 'function')) return;
    const DAY_IDLE = 600;     // 10 min of no input
    const NIGHT_IDLE = 120;   // 2 min at night
    // Instant wake: the moment any input reaches the pet window, drop an auto-sleep without waiting
    // for the next poll. (Manual sleeps are left alone.)
    const wakeNow = () => { if (glbPet && glbPet.autoSleeping) { glbPet.sleeping = false; glbPet.autoSleeping = false; } };
    window.addEventListener('mousemove', wakeNow, { passive: true });
    window.addEventListener('pointerdown', wakeNow, { passive: true });
    window.addEventListener('keydown', wakeNow);
    // Poll system-wide idle on a short interval so returning from another app also wakes quickly.
    setInterval(async () => {
        if (!glbPet) return;
        let idle = 0;
        try { idle = await window.electronAPI.getSystemIdleTime(); } catch (e) { return; }
        const hour = new Date().getHours();
        const night = (hour >= 23 || hour < 7);
        const shouldSleep = idle >= (night ? NIGHT_IDLE : DAY_IDLE);
        if (shouldSleep && !glbPet.sleeping) {
            glbPet.sleeping = true; glbPet.autoSleeping = true;
        } else if (!shouldSleep && glbPet.sleeping && glbPet.autoSleeping) {
            glbPet.sleeping = false; glbPet.autoSleeping = false;   // user came back → wake (manual sleeps stay)
        }
    }, 2000);
})();

(function setupWander() {
    try {
        const cfg = modelConfig || {};
        if (!cfg.wanderEnabled) return;
        // Allow the main pet AND summoned friends to wander (each window moves itself,
        // clamped to the screen). Exclude OBS-render / voice-only windows.
        const canWander = (typeof windowName === 'undefined') || windowName === 'default'
            || (typeof windowName === 'string' && windowName.startsWith('friend_'));
        if (!canWander) return;
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
            // Only wander when idle: not already moving, input box closed, no recent speech, not asleep.
            if (!wandering && !inputOpen && !(glbPet && glbPet.sleeping) && !(glbPet && glbPet.action) && Date.now() - vrmLastSpeakTs >= baseMs) {
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
    // 메인 펫이 바뀌면 소환된 친구를 '반대' 펫으로 따라 바꾼다 — 둘은 항상 다른 펫(병아리↔강아지). 메인만 구동.
    if (windowName === 'default' && window.electronAPI && typeof window.electronAPI.vrmFriendFollow === 'function') {
        const comp = allModels.find(m => m.id !== selectedModel.id);
        if (comp) { try { window.electronAPI.vrmFriendFollow(comp.id); } catch (e) {} }
    }
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

        console.warn('[VRM] 인간형 아바타는 제거됨 — GLB 펫만 지원:', modelPath);
        hideModelSwitchingIndicator();

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