import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";


const PATH_FPS = 15;

const LOOPS_TO_RECORD = 1;


const PLY_FILE = "./Theater.ply";
const CAMERA_PATH_FILE = "./camera_path.json";


let scene;
let camera;
let renderer;
let path = [];

let frameIndex = 0;


let frameAccumulator = 0;

let lastTime = 0;
let loopsCompleted = 0;

let recorder;
let recordedChunks = [];
let recordingStarted = false;
let recordingStopped = false;

async function loadCameraPath() {
  const res = await fetch(CAMERA_PATH_FILE);
  if (!res.ok) {
    throw new Error(
      `Failed to load ${CAMERA_PATH_FILE}: ${res.status} ${res.statusText}`,
    );
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("camera_path.json is empty or invalid");
  }
  path = data;
  console.log(
    `[INFO] Loaded ${path.length} frames from ${CAMERA_PATH_FILE}`,
  );
}


function initScene() {
  scene = new THREE.Scene();

  const RES_SCALE = 0.5; 

  const width = Math.floor(window.innerWidth * RES_SCALE);
  const height = Math.floor(window.innerHeight * RES_SCALE);

  const fov = path[0].fov ?? 60;
  camera = new THREE.PerspectiveCamera(fov, width / height, 0.05, 500.0);
  camera.matrixAutoUpdate = false;

  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(1);          
  renderer.setSize(width, height, false);
  document.body.appendChild(renderer.domElement);

  window.addEventListener("resize", () => {
    const w = Math.floor(window.innerWidth * RES_SCALE);
    const h = Math.floor(window.innerHeight * RES_SCALE);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });

  const hall = new SplatMesh({ url: PLY_FILE });
  hall.rotation.x = Math.PI;
  hall.scale.setScalar(3.0);
  scene.add(hall);

  const stream = renderer.domElement.captureStream(PATH_FPS);
  recorder = new MediaRecorder(stream, {
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
    a.download = "spark_tour_two_loops.webm";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(
      `Video saved as spark_tour_two_loops.webm (\${blob.size} bytes)`,
    );
  };
}

/**
 * Apply the specified keyframe from the camera path to the Three.js camera.
 * @param {number} index Index into the path array
 */
function applyCameraFrame(index) {
  if (index < 0 || index >= path.length) return;
  const frame = path[index];
  if (typeof frame.fov === "number") {
    camera.fov = frame.fov;
    camera.updateProjectionMatrix();
  }
  const m = frame.camera_to_world;
  const mat = new THREE.Matrix4();
  mat.set(
    m[0][0], m[0][1], m[0][2], m[0][3],
    m[1][0], m[1][1], m[1][2], m[1][3],
    m[2][0], m[2][1], m[2][2], m[2][3],
    m[3][0], m[3][1], m[3][2], m[3][3],
  );
  camera.matrix.copy(mat);
  camera.matrixWorld.copy(mat);
  camera.matrixWorldInverse.copy(mat).invert();
  camera.position.setFromMatrixPosition(mat);
  camera.quaternion.setFromRotationMatrix(mat);
}

/**
 * The main animation loop.  It advances through the camera path at the
 * configured PATH_FPS, rendering each frame and feeding it to the
 * MediaRecorder.  When the desired number of loops is complete, the
 * recorder is stopped and the loop exits.
 *
 * @param {DOMHighResTimeStamp} time Timestamp provided by requestAnimationFrame
 */
function animate(time) {
  if (recordingStopped) {
    return;
  }
  if (!lastTime) {
    lastTime = time;
  }
  const dt = time - lastTime;
  lastTime = time;
  const frameDurationMs = 1000 / PATH_FPS;
  frameAccumulator += dt;
  while (frameAccumulator >= frameDurationMs) {
    frameAccumulator -= frameDurationMs;
    frameIndex += 1;
    if (frameIndex >= path.length) {
      frameIndex = 0;
      loopsCompleted += 1;
      console.log(
        `Completed loop ${loopsCompleted}/${LOOPS_TO_RECORD}`,
      );
      if (loopsCompleted >= LOOPS_TO_RECORD) {
        if (recordingStarted && !recordingStopped) {
          recorder.stop();
          recordingStopped = true;
          console.log("Recording stopped after completing all loops");
        }
        return;
      }
    }
  }
  applyCameraFrame(frameIndex);
  if (!recordingStarted) {
    recorder.start();
    recordingStarted = true;
    console.log("Recording started");
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}


async function main() {
  try {
    await loadCameraPath();
    initScene();
    requestAnimationFrame(animate);
  } catch (err) {
    console.error(err);
    alert("An error occurred: " + err.message);
  }
}

main();