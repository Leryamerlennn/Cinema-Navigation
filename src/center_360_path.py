#!/usr/bin/env python
import argparse
import os
from typing import Optional

import numpy as np

from explorer import load_ply_xyz
from path_planner import look_at_three, save_path  # :contentReference[oaicite:0]{index=0}


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
    frames_per_loop: int = 360,
    loops: int = 2,
    slow_factor: float = 2.0,
    radius_factor: float = 0.05,
    fov: float = 60.0,
):
    """
    Строит camera_path.json с плавным 360°-облётом вокруг центра сцены.

    Особенности:
      - исходный path описывал 1 оборот за frames_per_loop кадров;
      - теперь:
          * общее количество оборотов задаётся параметром `loops` (по умолчанию 2);
          * движение замедляется во `slow_factor` раз (по умолчанию 2.0);
          * фактическое число кадров = frames_per_loop * loops * slow_factor.

    При воспроизведении с тем же FPS:
      - угол за кадр становится меньше (камера вращается медленнее);
      - полный путь содержит `loops` полных оборотов.

    Аргументы:
      ply_path      — путь к Supersplat/Gaussian-splat PLY.
      out_path      — путь к camera_path.json (по умолчанию рядом с PLY).
      frames_per_loop — базовое число кадров на один оборот (до замедления).
      loops         — сколько полных оборотов сделать (по умолчанию 2).
      slow_factor   — во сколько раз замедлить движение (по умолчанию 2.0).
      radius_factor — доля размера сцены по XZ, определяющая радиус окружности.
      fov           — поле зрения камеры в градусах.
    """
    # 1. Читаем PLY через настроенный загрузчик
    xs, ys, zs = load_ply_xyz(ply_path)

    # 2. Центр и размер сцены
    _bounds, center, size = compute_bounds(xs, ys, zs)

    # 3. Радиус для кругового движения камеры
    base_radius = max(size[0], size[2])
    if base_radius <= 0:
        raise ValueError("Нулевой размер сцены по XZ — проверьте PLY")

    radius = base_radius * radius_factor

    # На случай очень маленькой сцены — минимальный радиус
    scene_diag = float(np.linalg.norm(size))
    if radius < scene_diag * 1e-3:
        radius = scene_diag * 1e-3

    center = center.astype(float)

    # 4. Рассчитываем итоговое количество кадров и шаг по углу
    loops = max(1, int(loops))
    slow_factor = max(0.1, float(slow_factor))
    frames_per_loop = max(1, int(frames_per_loop))

    total_frames = int(frames_per_loop * loops * slow_factor)
    if total_frames <= 0:
        raise ValueError("total_frames <= 0 — проверьте frames_per_loop / loops / slow_factor")

    frames = []

    # Полный угол для всех оборотов
    total_angle = 2.0 * np.pi * loops

    for i in range(total_frames):
        # Угол в радианах от 0 до total_angle
        t = i / float(total_frames)
        angle = total_angle * t

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

    # 5. Куда сохранять camera_path.json
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
        "--frames-per-loop",
        type=int,
        default=360,
        help="Количество кадров на один оборот до замедления (по умолчанию 360).",
    )
    parser.add_argument(
        "--loops",
        type=int,
        default=2,
        help="Количество полных оборотов камеры (по умолчанию 2).",
    )
    parser.add_argument(
        "--slow-factor",
        type=float,
        default=2.0,
        help="Во сколько раз замедлить движение (по умолчанию 2.0).",
    )
    parser.add_argument(
        "--radius-factor",
        type=float,
        default=0.05,
        help="Доля размера сцены по XZ, определяющая радиус (по умолчанию 0.05).",
    )
    parser.add_argument(
        "--fov",
        type=float,
        default=60.0,
        help="Поле зрения камеры в градусах (по умолчанию 60).",
    )
    parser.add_argument(
        "--out",
        dest="out_path",
        default=None,
        help="Необязательный путь к camera_path.json (по умолчанию рядом с PLY).",
    )

    args = parser.parse_args()

    generate_center_360_path(
        ply_path=args.ply_path,
        out_path=args.out_path,
        frames_per_loop=args.frames_per_loop,
        loops=args.loops,
        slow_factor=args.slow_factor,
        radius_factor=args.radius_factor,
        fov=args.fov,
    )


if __name__ == "__main__":
    main()
