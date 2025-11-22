// web/record_main.js
import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

const CANVAS_ID = "renderCanvas";

// FPS для пути и для записываемого видео
const PATH_FPS = 15;
const VIDEO_FPS = 15;

// Сколько кадров прогреть без записи
const WARMUP_FRAMES = 60;

// Задержка перед началом записи (60 секунд)
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
 * Загрузка camera_path.json
 */
async function loadCameraPath(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Не удалось загрузить camera_path.json: ${res.status} ${res.statusText}`,
    );
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("camera_path.json пуст или имеет неверный формат");
  }
  path = data;
}

/**
 * Создание сцены и загрузка PLY
 */
async function loadScene(plyUrl) {
  const canvas = document.getElementById(CANVAS_ID);

  const fullWidth = canvas.clientWidth || window.innerWidth;
  const fullHeight = canvas.clientHeight || window.innerHeight;

  // режем разрешение пополам по каждой оси для ускорения
  const width = Math.floor(fullWidth / 2);
  const height = Math.floor(fullHeight / 2);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(60, width / height, 0.05, 500.0);
  camera.matrixAutoUpdate = false;

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });

  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);

  window.addEventListener("resize", () => {
    const fw = canvas.clientWidth || window.innerWidth;
    const fh = canvas.clientHeight || window.innerHeight;
    const w = Math.floor(fw / 2);
    const h = Math.floor(fh / 2);

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });

  const hall = new SplatMesh({ url: plyUrl });
  hall.rotation.x = Math.PI;
  scene.add(hall);

  renderer.render(scene, camera);
}

/**
 * Применение матрицы камеры из path[index]
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
    throw new Error(`Неверная матрица camera_to_world в кадре ${index}`);
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
 * Запуск MediaRecorder
 */
function startRecorder() {
  const stream = renderer.domElement.captureStream(VIDEO_FPS);

  recordedChunks = [];
  recorder = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp9",
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
 * Остановка MediaRecorder
 */
function stopRecorder() {
  if (recorder && recorder.state === "recording") {
    recorder.stop();
  }
}

/**
 * Основной цикл рендера/записи
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

  while (frameAccumulator >= frameDuration && frameIndex < path.length) {
    applyFrame(frameIndex);
    frameIndex += 1;
    frameAccumulator -= frameDuration;
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
 * Прогрев рендера: несколько кадров без записи
 */
async function warmupFrames(count = WARMUP_FRAMES) {
  const framesToUse = Math.min(count, path.length);
  for (let i = 0; i < framesToUse; i++) {
    applyFrame(i);
    renderer.render(scene, camera);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Публичная функция запуска рендера и записи
 * (вызывается из index_record.html)
 */
export async function startRender(plyUrl, cameraPathUrl) {
  if (!scene) {
    await loadScene(plyUrl);
  }
  if (!path || path.length === 0) {
    await loadCameraPath(cameraPathUrl);
  }

  // 1) Прогрев — рендерим N кадров без записи
  await warmupFrames(WARMUP_FRAMES);

  // 2) Жёсткая пауза 60 секунд перед стартом записи
  await new Promise((resolve) => setTimeout(resolve, START_DELAY_MS));

  // 3) Инициализация состояния анимации
  frameIndex = 0;
  frameAccumulator = 0;
  lastTime = null;
  isRendering = true;

  // 4) Первый кадр сразу, чтобы не было чёрного экрана
  applyFrame(0);
  renderer.render(scene, camera);

  // 5) Запуск записи и анимации
  startRecorder();
  requestAnimationFrame(animate);
}
