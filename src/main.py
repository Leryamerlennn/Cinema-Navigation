from explorer import analyze_scene, voxelize
from path_planner import (
    generate_panorama_path,
    generate_safe_path,
    save_path
)
import numpy as np


def main():

    # ---------- 1. Анализ модели ----------
    info = analyze_scene("web/ConferenceHall.ply")


    center = info["center"]
    xs, ys, zs = info["raw_points"]
    size = info["size"]

    print("Scene center:", center)
    print("Scene size:", size)

    # ---------- 2. Строим вокселизацию ----------
    occupied = voxelize(xs, ys, zs, voxel_size=0.5)
    print("Voxels occupied:", len(occupied))

    # ---------- 3. ВЫБЕРИ ОДИН ИЗ РЕЖИМОВ ----------

    MODE = "SAFE"        # "PANORAMA" or "SAFE"

    if MODE == "PANORAMA":
        frames = generate_panorama_path(
            n_frames=900,
            radius=info["recommended_radius"],
            height=info["recommended_height"],
            center=center
        )
        print("Generated PANORAMA path.")

    elif MODE == "SAFE":
        start = np.array([center[0], center[1], center[2]-5])
        end   = np.array([center[0]+10, center[1], center[2]+10])

        frames = generate_safe_path(
            start_pos=start,
            end_pos=end,
            occupied=occupied,
            voxel_size=0.5
        )
        print("Generated SAFE A* path.")

    # ---------- 4. Сохраняем ----------
    save_path(frames, "web/camera_path.json")


if __name__ == "__main__":
    main()
