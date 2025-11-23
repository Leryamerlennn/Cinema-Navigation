import numpy as np
import json
import os
import heapq


def look_at_three(camera_pos, target, up=np.array([0, 1, 0])):
    """
    Матрица camera_to_world для Three.js (камера смотрит вдоль -Z)
    """
    z_axis = camera_pos - target
    z_axis = z_axis / np.linalg.norm(z_axis)

    x_axis = np.cross(up, z_axis)
    x_axis = x_axis / np.linalg.norm(x_axis)

    y_axis = np.cross(z_axis, x_axis)

    M = np.eye(4)
    M[0, :3] = x_axis
    M[1, :3] = y_axis
    M[2, :3] = z_axis
    M[:3, 3] = camera_pos

    return M




def astar(start, goal, occupied):
    moves = [
        (1,0,0),(-1,0,0),
        (0,1,0),(0,-1,0),
        (0,0,1),(0,0,-1)
    ]

    open_set = [(0, start)]
    came = {start: None}
    g = {start: 0}

    def h(a, b):
        return abs(a[0]-b[0]) + abs(a[1]-b[1]) + abs(a[2]-b[2])

    while open_set:
        _, cur = heapq.heappop(open_set)

        if cur == goal:
            path = []
            while cur:
                path.append(cur)
                cur = came[cur]
            return path[::-1]

        for dx, dy, dz in moves:
            nxt = (cur[0]+dx, cur[1]+dy, cur[2]+dz)

            if nxt in occupied:
                continue

            cost = g[cur] + 1
            if nxt not in g or cost < g[nxt]:
                g[nxt] = cost
                f = cost + h(nxt, goal)
                heapq.heappush(open_set, (f, nxt))
                came[nxt] = cur

    return None



def generate_panorama_path(n_frames=900, fov=60, radius=4.0, height=1.6, center=np.array([0,0,0])):
    frames = []
    for i in range(n_frames):
        angle = 2 * np.pi * i / n_frames

        x = center[0] + radius * np.cos(angle)
        z = center[2] + radius * np.sin(angle)
        y = height

        cam = np.array([x, y, z])
        target = np.array([center[0], y, center[2]])

        M = look_at_three(cam, target)

        frames.append({
            "camera_to_world": M.tolist(),
            "fov": fov
        })
    return frames


def generate_safe_path(start_pos, end_pos, occupied, voxel_size=0.5, fov=60):
    start_vox = (
        int(start_pos[0] / voxel_size),
        int(start_pos[1] / voxel_size),
        int(start_pos[2] / voxel_size)
    )
    end_vox = (
        int(end_pos[0] / voxel_size),
        int(end_pos[1] / voxel_size),
        int(end_pos[2] / voxel_size)
    )

    vox_path = astar(start_vox, end_vox, occupied)

    if vox_path is None:
        raise RuntimeError("A* could not find a path!")

    frames = []
    for vx, vy, vz in vox_path:
        cam = np.array([
            vx * voxel_size,
            vy * voxel_size,
            vz * voxel_size
        ])

        target = np.array([0, cam[1], 0])

        M = look_at_three(cam, target)

        frames.append({
            "camera_to_world": M.tolist(),
            "fov": fov
        })

    return frames


def save_path(frames, out_path="web/camera_path.json"):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(frames, f, indent=2)
    print("Saved:", out_path)
