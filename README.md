# Cinema Navigation: Scene Rendering, 360° Coverage & Object Detection

This project implements a full pipeline for **cinematic navigation through a 3D scene** represented as a Gaussian Splatting PLY file:

1. A **Python pipeline** analyzes the PLY scene and generates a smooth 360° camera path around the scene center.
2. A **web client using Three.js + Spark** loads the PLY, plays back the camera path, and **records a 360 video** (WebM).
3. A **YOLO-based script** takes the recorded video, runs object detection on each frame, and saves a new video with visualized detections.

---

## Overview

High-level flow:

1. `ConferenceHall.ply` → Python → `camera_path.json`  
2. `ConferenceHall.ply` + `camera_path.json` → browser (Spark + Three.js) → `render_360.webm`  
3. `render_360.webm` → YOLO (Ultralytics) → `render_360_yolo.mp4`

---

## Repository Structure

Key directories and files:

- `src/`
  - `center_360_path.py` – Generates a 360° camera path around the scene center.
  - `explorer.py` – Reads custom Gaussian PLY and computes scene bounds.
  - `supersplat_reader.py` – Low-level parser for packed Supersplat positions.
  - `path_planner.py` – Camera math: `look_at_three`, creation of `camera_to_world` matrices and path serialization.
  - `waypoints.py` – Generates grid-based waypoints (used for more advanced navigation scenarios).
  - `main.py` – Example entry point for scene analysis and path generation (can be adapted as needed).

- `videos/`
  - Folder with all 4 scenes with 360-degree shooting and yolo detection

- `web/`
  - `camera_path.json` – Auto-generated camera path file.
  - `index_two_loops.html` – Fast 360° viewer (Two circles around itself for greater clarity).
  - `two_loop_record.js` – Renders the scene along the camera path and records a WebM video, with warmup frames and a 60-second delay before recording.

- Repository root:
  - `yolo_detect_video.py` – YOLO-based object detection on the recorded video.
  - `requirements.txt` – Python dependencies.

---

## 1. Python: Generating the 360° Camera Path

### 1.1. Install Python Dependencies

It is recommended to use a virtual environment:

```bash
python -m venv .venv
source .venv/bin/activate    # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 1.2. `center_360_path.py`

This script:

- Reads a Gaussian PLY file (e.g. `ConferenceHall.ply`) via `explorer.load_ply_xyz` (which understands the custom packed format).
- Computes:
  - Scene bounding box,
  - Center and extents.
- Builds a simple 360° circular path around the center at a reasonable radius and height.
- Creates a list of keyframes of the form:

  ```json
  {
    "camera_to_world": [[4x4 matrix]],
    "fov": 60.0
  }
  ```

- Saves them into `web/camera_path.json`.

Example run from the repository root:

add .PLY file into folder `web`

```bash
python src/center_360_path.py web/ConferenceHall.ply
```

Default behavior:

- Full revolution = 360 frames two times.
- Radius ≈ 5% of the scene size in the XZ plane.
- Camera height equal to the scene center height.

The generated `camera_path.json` is placed in the same directory as the PLY (here: `web/`).

---

## 2. Web: 360° Preview and Video Recording

You need a simple HTTP server to serve the `web` folder.

### 2.1. Option A: Node.js + `http-server`

```bash
cd web
npx http-server .
```

Open the printed URL (e.g. `http://localhost:8080`).

### 2.2. Option B: Python Built-in Server

```bash
cd web
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

---

In the browser, you must open `index_two_loop.html` to view the 360-degree render.

### 2.3. Recording a 360° Video (WebM)

Files:

- `web/index_two_loops.html` – simple UI with a “Start render” button.
- `web/two_loop_record.js` – rendering and recording logic.

- For recoding you need add path to file like `PLY_FILE = "./Theater.ply"`

`two_loop_record.js` flow:

1. Creates a `THREE.Scene`, a `PerspectiveCamera`, and a `WebGLRenderer`:
   - Renders at half resolution (width/2, height/2).
   - Uses `pixelRatio = 1`.
2. Loads `ConferenceHall.ply` via `SplatMesh` and rotates it around X.
3. Loads `camera_path.json`.
4. Performs a **warm-up pass**:
   - Renders the first `WARMUP_FRAMES` frames without recording.
5. Applies a **hard 60-second delay before recording**:
   - `START_DELAY_MS = 60000`.
   - Implemented using `await new Promise(resolve => setTimeout(resolve, START_DELAY_MS))`.
6. Resets animation state and starts:
   - A `MediaRecorder` on `renderer.domElement.captureStream(VIDEO_FPS)`.
   - An animation loop (`animate`) that:
     - Advances `frameIndex` according to `PATH_FPS`.
     - Applies `camera_to_world` from the path to the camera.
     - Renders the frame.
     - Feeds frames into `MediaRecorder`.

When the last frame in the path is rendered:

- `MediaRecorder` is stopped.
- All recorded chunks are joined into a `Blob`.
- A download link for `render_360.webm` is automatically triggered.

Usage:

1. Ensure `ConferenceHall.ply` and `camera_path.json` are present in `web/`.
2. Start the HTTP server in `web/`.
3. Open:

   ```text
   http://localhost:8080/index_two_loops.html
   ```

4. Wait for the scene to appear.
5. Click `Start render`:
   - The script will run warm-up frames,
   - Wait 60 seconds,
   - Start recording,
   - Automatically download `render_360.webm` when done.

---

## 3. YOLO: Object Detection on the 360° Video

File: `yolo_detect_video.py`

Purpose:

- Input: path to a video file (usually `render_360.webm`).
- Process:
  - Opens the video with OpenCV (`cv2.VideoCapture`).
  - Loads a YOLO model via Ultralytics (default: `yolov8n.pt` for speed).
  - Runs object detection on each frame.
  - Draws bounding boxes and labels on the frame.
- Output: a new video (by default `*_yolo.mp4`) with visualized detections.

### 3.1. Dependencies

From `requirements.txt`:

```txt
ultralytics==8.3.0
opencv-python==4.10.0.84
numpy==1.26.4
```

Install these if you have not already:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3.2. Running YOLO on the Recorded Video

Basic usage:

```bash
python yolo_detect_video.py render_360.webm
```

Result:

- `render_360_yolo.mp4` in the same directory, with bounding boxes drawn on all detectable objects.

Useful options:

- Select a different model (e.g., more accurate but slower):

  ```bash
  python yolo_detect_video.py render_360.webm --model yolov8m.pt
  ```

- Set a custom confidence threshold:

  ```bash
  python yolo_detect_video.py render_360.webm --confidence 0.4
  ```

- Explicitly specify the output video path:

  ```bash
  python yolo_detect_video.py render_360.webm --output out/detected_scene.mp4
  ```

---

## 4. Typical Workflow

1. **Generate camera path:**

   ```bash
   python src/center_360_path.py web/ConferenceHall.ply
   ```

   This creates `web/camera_path.json`.

2. **Check the 360° path (no recording):**

   - Start server in `web`:

     ```bash
     cd web
     npx http-server .
     # or: python3 -m http.server 8000
     ```

   - Open:

     ```text
     http://localhost:8080/index_fast_360.html
     ```

   - Confirm that the path and flythrough look correct.

3. **Record the 360° video:**

   - Open:

     ```text
     http://localhost:8080/index_two_loops.html
     ```

   - Click `Start render` (warmup + 60-second delay + recording).
   - Wait for `render_360.webm` to be downloaded automatically.

4. **Run YOLO object detection on the recorded video:**

   ```bash
   python yolo_detect_video.py render_360.webm
   ```

   You will get `render_360_yolo.mp4` as the final annotated video.

---

## 5. `camera_path.json` Format

`camera_path.json` is an array of keyframes:

```json
[
  {
    "camera_to_world": [
      [r00, r01, r02, tx],
      [r10, r11, r12, ty],
      [r20, r21, r22, tz],
      [0.0, 0.0, 0.0, 1.0]
    ],
    "fov": 60.0
  },
  ...
]
```

- `camera_to_world` – a 4×4 matrix in Three.js format (`Matrix4.fromArray`), mapping camera space to world space.
- `fov` – camera field of view in degrees (optional, but supported by the viewers).

Both `two_loop_record.js` and `fast_360_viewer.js`:

- Read each entry in sequence,
- Build a `THREE.Matrix4` from `camera_to_world`,
- Assign it to `camera.matrixWorld` and update `camera.matrixWorldInverse`.

---

## 6. Adapting to a Different Scene

To use a different PLY scene:

1. Put the new PLY into `web/`, e.g.:

   ```text
   web/MyScene.ply
   ```

2. Generate a camera path for it:

   ```bash
   python src/center_360_path.py web/MyScene.ply
   ```

   This will create `web/camera_path.json` for the new scene.

3. Update the paths in HTML files if needed:

   - `index_fast_360.html`:

     ```js
     const PLY_PATH = "./MyScene.ply";
     const CAMERA_PATH = "./camera_path.json";
     ```

   - `index_two_loops.html`:

     ```js
     const PLY_PATH = "./MyScene.ply";
     const CAMERA_PATH = "./camera_path.json";
     ```

4. Repeat the same flow: preview → record → YOLO detection.
