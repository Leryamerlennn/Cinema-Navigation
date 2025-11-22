import argparse
import os
from typing import Optional

import numpy as np

from explorer import load_ply_xyz
from path_planner import look_at_three, save_path


def compute_bounds(xs, ys, zs):
    xs = np.asarray(xs)
    ys = np.asarray(ys)
    zs = np.asarray(zs)

    if xs.size == 0:
        raise ValueError("PLY содержит 0 точек — невозможно вычислить центр сцены")

    min_x, max_x = xs.min(), xs.max()
    min_y, max_y = ys.min(), ys.max()
    min_z, max_z = zs.min(), zs.max()

    bounds = {
        "min": np.array([min_x, min_y, min_z], dtype=float),
        "max": np.array([max_x, max_y, max_z], dtype=float),
    }
    center = (bounds["min"] + bounds["max"]) * 0.5
    size = bounds["max"] - bounds["min"]
    return bounds, center, size


def generate_center_360_path(
    ply_path: str,
    out_path: Optional[str] = None,
    num_frames: int = 360,
    radius_factor: float = 0.05,
    fov: float = 60.0,
):
    """
    Строит camera_path.json, который делает плавный 360°-облёт
    вокруг центра сцены с небольшим радиусом (почти «из точки»).

    Обязательный аргумент: путь к PLY.
    Остальные параметры можно менять, но по умолчанию их трогать не нужно.
    """
    # 1. Читаем PLY через уже настроенный под ваш нестандартный формат загрузчик
    xs, ys, zs = load_ply_xyz(ply_path)

    # 2. Центр и размер сцены
    _bounds, center, size = compute_bounds(xs, ys, zs)

    # 3. Радиус для кругового движения камеры.
    #    Делаем его небольшим, чтобы камера находилась почти в центре помещения.
    base_radius = max(size[0], size[2])
    if base_radius <= 0:
        raise ValueError("Нулевой размер сцены по XZ — проверьте PLY")

    radius = base_radius * radius_factor

    # На случай очень маленькой сцены — минимальный радиус
    scene_diag = float(np.linalg.norm(size))
    if radius < scene_diag * 1e-3:
        radius = scene_diag * 1e-3

    center = center.astype(float)

    frames = []

    for i in range(num_frames):
        # Угол в радианах [0, 2π)
        angle = 2.0 * np.pi * (i / float(num_frames))

        # Смещение камеры в плоскости XZ (высоту оставляем как у центра)
        offset = np.array(
            [
                np.cos(angle) * radius,
                0.0,
                np.sin(angle) * radius,
            ],
            dtype=float,
        )
        camera_pos = center + offset
        target = center  # смотрим в геометрический центр

        # Матрица camera_to_world в формате Three.js
        M = look_at_three(camera_pos, target)

        frames.append(
            {
                "camera_to_world": M.tolist(),
                "fov": float(fov),
            }
        )

    # 4. Куда сохранять camera_path.json
    if out_path is None:
        base_dir = os.path.dirname(os.path.abspath(ply_path))
        out_path = os.path.join(base_dir, "camera_path.json")

    save_path(frames, out_path)


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Генерация camera_path.json для 360°-обзора из центра сцены "
            "по Supersplat/Gaussian-splat PLY."
        )
    )
    parser.add_argument(
        "ply_path",
        help="Путь к бинарному Supersplat/Gaussian-splat PLY-файлу",
    )
    parser.add_argument(
        "--frames",
        type=int,
        default=360,
        help="Количество кадров на полный оборот (по умолчанию 360)",
    )
    parser.add_argument(
        "--radius-factor",
        type=float,
        default=0.05,
        help="Доля размера сцены по XZ, определяющая радиус (по умолчанию 0.05)",
    )
    parser.add_argument(
        "--fov",
        type=float,
        default=60.0,
        help="Поле зрения камеры в градусах (по умолчанию 60)",
    )
    parser.add_argument(
        "--out",
        dest="out_path",
        default=None,
        help="Необязательный путь к camera_path.json (по умолчанию рядом с PLY)",
    )

    args = parser.parse_args()

    generate_center_360_path(
        ply_path=args.ply_path,
        out_path=args.out_path,
        num_frames=args.frames,
        radius_factor=args.radius_factor,
        fov=args.fov,
    )


if __name__ == "__main__":
    main()
