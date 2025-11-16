import numpy as np
import struct


# ================================================================
#                 LOAD BINARY SUPERSPLAT PLY
# ================================================================
def load_ply_xyz(ply_path):
    """
    Чтение SuperSplat / Gaussian Splatting binary PLY:
      - format binary_little_endian 1.0
      - element vertex N
      - properties: packed_position (uint32)

    Возвращаем нормализованные координаты x,y,z в [0..1].

    Формат packed_position:
        packed = (z << 20) | (y << 10) | (x)
        где x,y,z — 10-битные числа 0..1023
    """

    with open(ply_path, "rb") as f:

        # ---------------- HEADER ----------------
        header_lines = []
        while True:
            line = f.readline().decode("ascii", errors="ignore")
            header_lines.append(line)
            if line.strip() == "end_header":
                break

        # ---------------- Ищем vertex_count ----------------
        vertex_count = 0
        for h in header_lines:
            if h.startswith("element vertex"):
                vertex_count = int(h.split()[-1])
                break

        # ---------------- Читаем бинарные вершины ----------------
        xs = np.zeros(vertex_count, dtype=np.float32)
        ys = np.zeros(vertex_count, dtype=np.float32)
        zs = np.zeros(vertex_count, dtype=np.float32)

        for i in range(vertex_count):

            # packed_position (uint32)
            raw = f.read(4)
            if not raw:
                break

            packed = struct.unpack("<I", raw)[0]

            # ====== Распаковка 10 бит на ось ======
            x =  ( packed        & 1023 ) / 1024.0
            y = ((packed >> 10) & 1023 ) / 1024.0
            z = ((packed >> 20) & 1023 ) / 1024.0

            xs[i] = x
            ys[i] = y
            zs[i] = z

        return xs, ys, zs



# ================================================================
#                           BOUNDS
# ================================================================
def compute_scene_bounds(xs, ys, zs):
    """
    Центр и размер нормализованной сцены
    """
    bounds = {
        "min": np.array([xs.min(), ys.min(), zs.min()]),
        "max": np.array([xs.max(), ys.max(), zs.max()])
    }
    center = (bounds["min"] + bounds["max"]) / 2
    size   = bounds["max"] - bounds["min"]
    return bounds, center, size



# ================================================================
#                        VOXELIZATION
# ================================================================
def voxelize(xs, ys, zs, voxel_size=0.03):
    """
    Вокселизация нормализованных координат.
    Для GS облака разумное voxel_size = 0.02–0.05.
    """
    vox = set()
    for x, y, z in zip(xs, ys, zs):
        vx = int(x / voxel_size)
        vy = int(y / voxel_size)
        vz = int(z / voxel_size)
        vox.add((vx, vy, vz))
    return vox



# ================================================================
#                        MAIN SCENE ANALYSIS
# ================================================================
def analyze_scene(ply_path):
    xs, ys, zs = load_ply_xyz(ply_path)
    bounds, center, size = compute_scene_bounds(xs, ys, zs)

    return {
        "raw_points": (xs, ys, zs),
        "center": center,
        "size": size,
        "bounds": bounds,

        # высота и радиус для панорамы в нормализованных координатах
        "recommended_height": center[1] + size[1] * 0.2,
        "recommended_radius": max(size[0], size[2]) * 0.6
    }
