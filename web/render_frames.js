// web/render_frames.js
import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

const CANVAS_ID = "renderCanvas";

// Внутреннее разрешение (делитель от реального)
const RESOLUTION_DIVISOR = 4;

// Пауза между кадрами (мс) — можно увеличить до 100–200 при необходимости
const FRAME_DELAY_MS = 50;

let scene = null;
let camera = null;
let renderer = null;
let splatHall = null;

let path = [];
let totalFrames = 0;
let currentFrameIndex = 0;
let isRendering = false;

/**
 * Загружаем camera_path.json
 */
async function loadCameraPath(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Не удалось загрузить camera_path.json: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
        throw new Error("camera_path.json пуст или имеет неверный формат");
    }
    path = data;
    totalFrames = path.length;
}

/**
 * Создаём сцену и загружаем PLY через Spark SplatMesh
 */
async function initScene(plyUrl) {
    if (scene) {
        // Уже инициализировано
        return;
    }

    scene = new THREE.Scene();

    const canvas = document.getElementById(CANVAS_ID);
    const fullWidth = canvas.clientWidth || window.innerWidth;
    const fullHeight = canvas.clientHeight || window.innerHeight;

    // Уменьшаем внутреннее разрешение для ускорения
    const width = Math.max(256, Math.floor(fullWidth / RESOLUTION_DIVISOR));
    const height = Math.max(256, Math.floor(fullHeight / RESOLUTION_DIVISOR));

    camera = new THREE.PerspectiveCamera(60, width / height, 0.05, 500.0);
    camera.matrixAutoUpdate = false;

    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        preserveDrawingBuffer: true, // обязательно для toDataURL()
        powerPreference: "high-performance",
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);

    // При ресайзе можно оставить всё как есть, чтобы не ломать рендер кадров
    window.addEventListener("resize", () => {
        // Ничего не делаем — рендер всегда в фиксированном low-res
    });

    // Загружаем PLY как сплаты
    splatHall = new SplatMesh({ url: plyUrl });
    // Как в исходном проекте — переворот по X
    splatHall.rotation.x = Math.PI;
    scene.add(splatHall);

    // Первый тестовый рендер (камера пока в (0,0,0))
    renderer.render(scene, camera);
}

/**
 * Применяем матрицу камеры из кадра path[index]
 */
function applyFrame(index) {
    if (index < 0 || index >= path.length) return;

    const frame = path[index];

    // FOV, если указан в JSON
    if (typeof frame.fov === "number") {
        camera.fov = frame.fov;
        camera.updateProjectionMatrix();
    }

    const M = frame.camera_to_world;
    if (!Array.isArray(M) || M.length !== 4 || !Array.isArray(M[0]) || M[0].length !== 4) {
        throw new Error(`Неверная матрица camera_to_world в кадре ${index}`);
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
 * Сохраняем текущий кадр как PNG через DataURL
 */
function saveCurrentFrame(index) {
    const canvas = renderer.domElement;
    const dataUrl = canvas.toDataURL("image/png");

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `frame_${String(index).padStart(6, "0")}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/**
 * Рекурсивный рендер следующего кадра с задержкой
 */
function renderNextFrame() {
    if (!isRendering) return;

    if (currentFrameIndex >= totalFrames) {
        isRendering = false;
        alert("Готово: все кадры сохранены (файлы frame_******.png).");
        return;
    }

    applyFrame(currentFrameIndex);
    renderer.render(scene, camera);
    saveCurrentFrame(currentFrameIndex);

    currentFrameIndex += 1;

    // Делаем паузу, чтобы не блокировать браузер полностью
    setTimeout(renderNextFrame, FRAME_DELAY_MS);
}

/**
 * Основная функция, которую дергает HTML-кнопка
 */
export async function startRenderFrames(plyUrl, cameraPathUrl) {
    if (!scene) {
        await initScene(plyUrl);
    }
    if (!path || path.length === 0) {
        await loadCameraPath(cameraPathUrl);
    }

    // ВАЖНО: подожди после загрузки страницы пару секунд,
    // чтобы сплаты успели подгрузиться, и только потом жми кнопку в интерфейсе.

    currentFrameIndex = 0;
    isRendering = true;

    renderNextFrame();
}
