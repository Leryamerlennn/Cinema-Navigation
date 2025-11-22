// web/fast_360_viewer.js
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const CANVAS_ID = "renderCanvas";

// Логический FPS для проигрывания camera_path.json
const PATH_FPS = 24;

let scene = null;
let camera = null;
let renderer = null;
let spark = null;
let splats = null;

let path = [];
let isPlaying = false;
let frameIndex = 0;
let lastTime = null;
let accumulator = 0;

/**
 * Инициализация THREE + SparkRenderer
 */
function initScene() {
  if (scene) return; // уже инициализировано

  const canvas = document.getElementById(CANVAS_ID);
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;

  // Лёгкий WebGLRenderer
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,              // важно для производительности со сплатами
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);       // без супер-высокого DPI
  renderer.setSize(width, height, false);

  // Сцена и камера
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, width / height, 0.05, 500.0);
  scene.add(camera);

  // Явный SparkRenderer с оптимизированным maxStdDev
  spark = new SparkRenderer({
    renderer,
    maxStdDev: Math.sqrt(5),       // меньше overdraw, быстрее рендер (дефолт sqrt(8)) 
  });

  // Для больших сцен рекомендуют вешать SparkRenderer на камеру 
  camera.add(spark);

  // Обновление при ресайзе окна
  window.addEventListener("resize", () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });
}

/**
 * Загрузка PLY как SplatMesh и ожидание полной инициализации
 */
async function loadSplats(plyUrl) {
  splats = new SplatMesh({
    url: plyUrl,
  });

  // Поворот как в исходном проекте
  splats.rotation.x = Math.PI;

  scene.add(splats);

  // КЛЮЧЕВОЕ: ждём полной инициализации сплатов
  await splats.initialized;

  // Один "пробный" рендер после готовности
  renderer.render(scene, camera);
}

/**
 * Загрузка camera_path.json
 */
async function loadCameraPath(pathUrl) {
  const res = await fetch(pathUrl);
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
 * Применение одного кадра из camera_path.json к камере
 */
function applyFrame(frame) {
  if (typeof frame.fov === "number") {
    camera.fov = frame.fov;
    camera.updateProjectionMatrix();
  }

  const M = frame.camera_to_world;
  if (!Array.isArray(M) || M.length !== 4 || !Array.isArray(M[0]) || M[0].length !== 4) {
    throw new Error("Неверная матрица camera_to_world в кадре");
  }

  const flat = [
    M[0][0], M[0][1], M[0][2], M[0][3],
    M[1][0], M[1][1], M[1][2], M[1][3],
    M[2][0], M[2][1], M[2][2], M[2][3],
    M[3][0], M[3][1], M[3][2], M[3][3],
  ];

  const mat = new THREE.Matrix4();
  mat.fromArray(flat);

  camera.matrixWorld.copy(mat);
  camera.matrixWorldInverse.copy(mat).invert();
}

/**
 * Анимационный цикл: проигрываем путь один раз
 */
function animate(timestamp) {
  if (!isPlaying) return;

  if (lastTime === null) {
    lastTime = timestamp;
  }

  const deltaSec = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  accumulator += deltaSec;

  const frameDuration = 1 / PATH_FPS;

  // Продвигаем индекс по пути с фиксированным FPS
  while (accumulator >= frameDuration && frameIndex < path.length) {
    const frame = path[frameIndex];
    applyFrame(frame);
    frameIndex += 1;
    accumulator -= frameDuration;
  }

  renderer.render(scene, camera);

  // Закончили путь — стоп
  if (frameIndex >= path.length) {
    isPlaying = false;
    return;
  }

  requestAnimationFrame(animate);
}

/**
 * Публичная функция, которую дергает HTML:
 * полностью загружает сцену и запускает 360-проигрывание
 */
export async function startFast360(plyUrl, cameraPathUrl) {
  initScene();

  // 1. Ждём полной загрузки сплатов (сцены)
  if (!splats) {
    await loadSplats(plyUrl);
  }

  // 2. Загружаем путь камеры
  if (!path || path.length === 0) {
    await loadCameraPath(cameraPathUrl);
  }

  // 3. Инициализация состояния проигрывания
  frameIndex = 0;
  accumulator = 0;
  lastTime = null;
  isPlaying = true;

  // Первый кадр сразу применяем, чтобы не было чёрного экрана
  applyFrame(path[0]);
  renderer.render(scene, camera);

  // 4. Запускаем анимационный цикл
  requestAnimationFrame(animate);
}
