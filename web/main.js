import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

// === глобальные переменные ===
let scene, camera, renderer;
let path = [];

const PATH_FPS = 30;              // с какой частотой «проигрываем» keyframe’ы
let frameIndex = 0;
let frameAccumulator = 0;
let lastTime = 0;

// для записи видео
let startTime = 0;
let recordDurationSec = 0;
let recorder = null;
let chunks = [];
let recordingStarted = false;
let recordingStopped = false;

// === 1. Загрузка camera_path.json ===
async function loadCameraPath() {
  const res = await fetch("./camera_path.json");
  if (!res.ok) {
    throw new Error("Не удалось загрузить camera_path.json");
  }
  path = await res.json();
  if (!Array.isArray(path) || path.length === 0) {
    throw new Error("camera_path.json пустой или неверного формата");
  }

  // длина тура, если считаем, что путь рассчитан под PATH_FPS
  recordDurationSec = path.length / PATH_FPS;
  console.log("Кадров в пути:", path.length, "длительность тура, сек:", recordDurationSec);
}

// === 2. Инициализация THREE + Spark ===
function initScene() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  scene = new THREE.Scene();

  const fov = path[0].fov ?? 60;
  camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 1000);
  camera.matrixAutoUpdate = false;

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  document.body.appendChild(renderer.domElement);

  window.addEventListener("resize", () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  // Загружаем оригинальный Gaussian Splatting PLY через Spark
  // Spark поддерживает .ply / .spz / .splat / .ksplat / .sogs
  const splatUrl = "./ConferenceHall.ply";   // при необходимости поменяй путь/расширение
  const hall = new SplatMesh({ url: splatUrl });
  hall.rotation.x = Math.PI; 
  scene.add(hall);
  hall.scale.setScalar(3.0)

  // Настройка MediaRecorder для записи тура
  const stream = renderer.domElement.captureStream(PATH_FPS);
  recorder = new MediaRecorder(stream, { mimeType: "video/webm" });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spark_tour.webm";
    a.click();
    URL.revokeObjectURL(url);
    console.log("Видео сохранено как spark_tour.webm");
  };
}

// === 3. Применение матрицы camera_to_world к THREE-камере ===
function setCameraFromFrame(frame) {
  const m = frame.camera_to_world;  // 4x4

  const mat = new THREE.Matrix4();
  mat.set(
    m[0][0], m[0][1], m[0][2], m[0][3],
    m[1][0], m[1][1], m[1][2], m[1][3],
    m[2][0], m[2][1], m[2][2], m[2][3],
    m[3][0], m[3][1], m[3][2], m[3][3]
  );

  camera.matrix.copy(mat);
  camera.matrixWorld.copy(mat);
  camera.matrixWorldInverse.copy(mat).invert();
  camera.position.setFromMatrixPosition(mat);
  camera.quaternion.setFromRotationMatrix(mat);
}

// === 4. Анимация + запись ===
function animate(time) {
  if (!lastTime) {
    lastTime = time;
    startTime = time;
  }
  const dt = time - lastTime;
  lastTime = time;

  // продвигаемся по маршруту с частотой PATH_FPS
  const frameDurationMs = 1000 / PATH_FPS;
  frameAccumulator += dt;
  while (frameAccumulator >= frameDurationMs) {
    frameAccumulator -= frameDurationMs;
    frameIndex = (frameIndex + 1) % path.length;
  }

  setCameraFromFrame(path[frameIndex]);

  // запуск и остановка записи
  const elapsedSec = (time - startTime) / 1000;

  if (!recordingStarted && recorder) {
    recorder.start();
    recordingStarted = true;
    console.log("Запись видео начата");
  }

  // останавливаем запись после одного полного прохода по маршруту
  if (recordingStarted && !recordingStopped && elapsedSec >= recordDurationSec) {
    recorder.stop();
    recordingStopped = true;
    console.log("Запись видео остановлена");
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// === 5. Точка входа ===
async function main() {
  try {
    await loadCameraPath();
    initScene();
    requestAnimationFrame(animate);
  } catch (e) {
    console.error(e);
  }
}

main();
