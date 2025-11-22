// web/record_main.js
import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

const CANVAS_ID = "renderCanvas";

// Logical path FPS (how fast we step through camera_path.json)
// With the single-step animate() this is a target; on lag the camera just moves slower.
const PATH_FPS = 10;

// Recorded video FPS
const VIDEO_FPS = 10;

// Internal resolution scale (relative to window)
// 0.25 = quarter resolution in each dimension (strong performance win)
const RES_SCALE = 0.25;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

// Warmup frames rendered BEFORE recording
const WARMUP_FRAMES = 100;

// Hard delay before recording (ms)
const START_DELAY_MS = 60_000;

let scene = null;
let camera = null;
let renderer = null;

let path = [];
let frameIndex = 0;
let frameAccumulator = 0;
let lastTime = null;
let isRendering = false;

let recorder = null;
let recordedChunks = [];

/**
 * Load camera_path.json
 * Assumes the JSON encodes the full desired path (e.g. 2 loops, slower motion)
 */
async function loadCameraPath(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to load camera_path.json: ${res.status} ${res.statusText}`,
    );
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("camera_path.json is empty or invalid");
  }

  path = data;

  console.log(
    `[INFO] camera_path.json loaded: ${path.length} frames (full path from Python)`,
  );
}

/**
 * Create scene and load PLY via SplatMesh
 */
async function loadScene(plyUrl) {
  const canvas = document.getElementById(CANVAS_ID);

  const fullWidth = canvas.clientWidth || window.innerWidth;
  const fullHeight = canvas.clientHeight || window.innerHeight;

  const width = Math.max(MIN_WIDTH, Math.floor(fullWidth * RES_SCALE));
  const height = Math.max(MIN_HEIGHT, Math.floor(fullHeight * RES_SCALE));

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(60, width / height, 0.05, 500.0);
  camera.matrixAutoUpdate = false;

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // important for performance with splats
    alpha: false,
    powerPreference: "high-performance",
  });

  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);

  window.addEventListener("resize", () => {
    const fw = canvas.clientWidth || window.innerWidth;
    const fh = canvas.clientHeight || window.innerHeight;
    const w = Math.max(MIN_WIDTH, Math.floor(fw * RES_SCALE));
    const h = Math.max(MIN_HEIGHT, Math.floor(fh * RES_SCALE));

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });

  const hall = new SplatMesh({ url: plyUrl });
  hall.rotation.x = Math.PI;
  scene.add(hall);

  // Initial render
  renderer.render(scene, camera);
}

/**
 * Apply camera pose from path[index]
 */
function applyFrame(index) {
  if (index < 0 || index >= path.length) return;

  const frame = path[index];

  if (typeof frame.fov === "number") {
    camera.fov = frame.fov;
    camera.updateProjectionMatrix();
  }

  const M = frame.camera_to_world;
  if (
    !Array.isArray(M) ||
    M.length !== 4 ||
    !Array.isArray(M[0]) ||
    M[0].length !== 4
  ) {
    throw new Error(`Invalid camera_to_world matrix at frame ${index}`);
  }

  const flat = [
    M[0][0], M[0][1], M[0][2], M[0][3],
    M[1][0], M[1][1], M[1][2], M[1][3],
    M[2][0], M[2][1], M[2][2], M[2][3],
    M[3][0], M[3][1], M[3][2], M[3][3],
  ];

  const m = new THREE.Matrix4();
  m.fromArray(flat);

  camera.matrixWorld.copy(m);
  camera.matrixWorldInverse.copy(m).invert();
}

/**
 * Start MediaRecorder on the canvas stream
 */
function startRecorder() {
  const stream = renderer.domElement.captureStream(VIDEO_FPS);

  recordedChunks = [];
  recorder = new MediaRecorder(stream, {
    // VP8 is cheaper than VP9
    mimeType: "video/webm;codecs=vp8",
  });

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "render_360.webm";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  recorder.start();
}

/**
 * Stop MediaRecorder
 */
function stopRecorder() {
  if (recorder && recorder.state === "recording") {
    recorder.stop();
  }
}

/**
 * Main render/record loop
 *
 * IMPORTANT:
 * We advance at most ONE step in the path per rAF.
 * If a frame lags, we don't "catch up" by jumping many steps at once.
 * This prevents path from being eaten too quickly when rendering stutters.
 */
function animate(timestamp) {
  if (!isRendering) return;

  if (lastTime === null) {
    lastTime = timestamp;
  }

  const deltaSec = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  frameAccumulator += deltaSec;

  const frameDuration = 1 / PATH_FPS;

  // Single-step advancement: at most one path frame per rAF
  if (frameAccumulator >= frameDuration && frameIndex < path.length) {
    frameAccumulator -= frameDuration;
    applyFrame(frameIndex);
    frameIndex += 1;
  }

  renderer.render(scene, camera);

  if (frameIndex >= path.length) {
    isRendering = false;
    stopRecorder();
    return;
  }

  requestAnimationFrame(animate);
}

/**
 * Warm up rendering: render several frames without recording
 */
async function warmupFrames(count = WARMUP_FRAMES) {
  const framesToUse = Math.min(count, path.length);
  for (let i = 0; i < framesToUse; i++) {
    applyFrame(i);
    renderer.render(scene, camera);
    // Small pause to let GPU/CPU breathe
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Public entry point called from index_record.html
 */
export async function startRender(plyUrl, cameraPathUrl) {
  if (!scene) {
    await loadScene(plyUrl);
  }
  if (!path || path.length === 0) {
    await loadCameraPath(cameraPathUrl);
  }

  // 1) Warmup — render N frames without recording
  await warmupFrames(WARMUP_FRAMES);

  // 2) Hard delay before recording
  await new Promise((resolve) => setTimeout(resolve, START_DELAY_MS));

  // 3) Reset animation state
  frameIndex = 0;
  frameAccumulator = 0;
  lastTime = null;
  isRendering = true;

  // 4) First frame immediately (avoid black first frame)
  applyFrame(0);
  renderer.render(scene, camera);

  // 5) Start recording and animation loop
  startRecorder();
  requestAnimationFrame(animate);
}
