import numpy as np
import struct


def load_ply_xyz(ply_path):
    

    with open(ply_path, "rb") as f:

        header_lines = []
        while True:
            line = f.readline().decode("ascii", errors="ignore")
            header_lines.append(line)
            if line.strip() == "end_header":
                break

        vertex_count = 0
        for h in header_lines:
            if h.startswith("element vertex"):
                vertex_count = int(h.split()[-1])
                break

        xs = np.zeros(vertex_count, dtype=np.float32)
        ys = np.zeros(vertex_count, dtype=np.float32)
        zs = np.zeros(vertex_count, dtype=np.float32)

        for i in range(vertex_count):

            raw = f.read(4)
            if not raw:
                break

            packed = struct.unpack("<I", raw)[0]

            x =  ( packed        & 1023 ) / 1024.0
            y = ((packed >> 10) & 1023 ) / 1024.0
            z = ((packed >> 20) & 1023 ) / 1024.0

            xs[i] = x
            ys[i] = y
            zs[i] = z

        return xs, ys, zs



def compute_scene_bounds(xs, ys, zs):
    
    bounds = {
        "min": np.array([xs.min(), ys.min(), zs.min()]),
        "max": np.array([xs.max(), ys.max(), zs.max()])
    }
    center = (bounds["min"] + bounds["max"]) / 2
    size   = bounds["max"] - bounds["min"]
    return bounds, center, size


def voxelize(xs, ys, zs, voxel_size=0.03):
    
    vox = set()
    for x, y, z in zip(xs, ys, zs):
        vx = int(x / voxel_size)
        vy = int(y / voxel_size)
        vz = int(z / voxel_size)
        vox.add((vx, vy, vz))
    return vox




def analyze_scene(ply_path):
    xs, ys, zs = load_ply_xyz(ply_path)
    bounds, center, size = compute_scene_bounds(xs, ys, zs)

    return {
        "raw_points": (xs, ys, zs),
        "center": center,
        "size": size,
        "bounds": bounds,

        "recommended_height": center[1] + size[1] * 0.2,
        "recommended_radius": max(size[0], size[2]) * 0.6
    }
