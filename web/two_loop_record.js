import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

/*
 * This module renders a Gaussian Splatting scene using a PLY file and a
 * sequence of camera poses defined in camera_path.json.  It plays through
 * the entire path twice to create a two‑loop 360° tour, capturing the
 * rendered frames into a WebM video.  When the second loop completes,
 * recording stops and the video is offered as a download.
 */

// ========================
// Configuration constants
// ========================

// The desired playback rate for stepping through the camera path (frames per
// second).  This should match the logical frame rate used when generating
// camera_path.json.
const PATH_FPS = 15;

// How many complete passes through the camera path should be recorded.  The
// specification calls for exactly two revolutions.
const LOOPS_TO_RECORD = 1;

// File names for the PLY model and camera path.  These are relative to the
// HTML file that includes this script.
const PLY_FILE = "./Theater.ply";
const CAMERA_PATH_FILE = "./camera_path.json";

// ========================
// State variables
// ========================

let scene;
let camera;
let renderer;
let path = [];

// Index of the current frame in the camera path
let frameIndex = 0;

// Accumulator used to advance frames at the target PATH_FPS regardless of
// variations in actual rendering frame rate
let frameAccumulator = 0;

// Timestamp of the previous call to animate()
let lastTime = 0;

// Count how many complete loops have been traversed
let loopsCompleted = 0;

// MediaRecorder and associated data chunks
let recorder;
let recordedChunks = [];
let recordingStarted = false;
let recordingStopped = false;

// ========================
// Utility functions
// ========================

/**
 * Load the camera path from CAMERA_PATH_FILE.  The JSON file must contain
 * an array of keyframes, each with a "camera_to_world" 4×4 matrix and an
 * optional "fov".  Throws if the file cannot be fetched or parsed.
 */
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

/**
 * Initialise the Three.js scene, camera and renderer.  Also sets up a
 * MediaRecorder on the renderer's canvas so that rendered frames can be
 * captured to a video file.  The PLY model is loaded via Spark's
 * SplatMesh and added to the scene.
 */
function initScene() {
  // Create the scene and camera
  scene = new THREE.Scene();

  const RES_SCALE = 0.5; // 0.5 или даже 0.25 для сильного ускорения

  const width = Math.floor(window.innerWidth * RES_SCALE);
  const height = Math.floor(window.innerHeight * RES_SCALE);

  const fov = path[0].fov ?? 60;
  camera = new THREE.PerspectiveCamera(fov, width / height, 0.05, 500.0);
  camera.matrixAutoUpdate = false;

  // Create the WebGL renderer and attach its canvas to the document
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(1);          // важно зафиксировать pixelRatio
  renderer.setSize(width, height, false);
  document.body.appendChild(renderer.domElement);

  // Update camera and renderer when the window is resized
  window.addEventListener("resize", () => {
    const w = Math.floor(window.innerWidth * RES_SCALE);
    const h = Math.floor(window.innerHeight * RES_SCALE);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });

  // Load the Gaussian Splatting model via Spark.  Rotating it 180° around
  // the X axis aligns its coordinate system with Three.js.  Scaling can
  // optionally be adjusted to better fit the camera path.
  const hall = new SplatMesh({ url: PLY_FILE });
  hall.rotation.x = Math.PI;
  hall.scale.setScalar(3.0);
  scene.add(hall);

  // Set up MediaRecorder on the renderer's canvas
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
    // Assemble the recorded chunks into a Blob and trigger download
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
  // Update FOV if present
  if (typeof frame.fov === "number") {
    camera.fov = frame.fov;
    camera.updateProjectionMatrix();
  }
  // Flatten the 4×4 matrix into 16 elements for Matrix4
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
    // If recording has finished, no further frames are rendered
    return;
  }
  if (!lastTime) {
    lastTime = time;
  }
  const dt = time - lastTime;
  lastTime = time;
  // Advance the frame accumulator by the elapsed time
  const frameDurationMs = 1000 / PATH_FPS;
  frameAccumulator += dt;
  // Process as many logical frames as elapsed time permits (max 1 per frame)
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
        // All desired loops are done; stop recording and end animation
        if (recordingStarted && !recordingStopped) {
          recorder.stop();
          recordingStopped = true;
          console.log("Recording stopped after completing all loops");
        }
        return;
      }
    }
  }
  // Apply the current frame to the camera
  applyCameraFrame(frameIndex);
  // Start recording on the first animation frame
  if (!recordingStarted) {
    recorder.start();
    recordingStarted = true;
    console.log("Recording started");
  }
  // Render the scene
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

/**
 * Entry point for the module.  Loads the camera path, initialises the
 * scene and starts the animation loop.  Errors are caught and logged to
 * the console.
 */
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

// Kick off the application
main();