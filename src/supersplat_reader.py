import numpy as np
from plyfile import PlyData

def unpack_xyz(packed):
    mask = (1 << 10) - 1  
    x =  packed        & mask
    y = (packed >> 10) & mask
    z = (packed >> 20) & mask

    return x / 1023.0, y / 1023.0, z / 1023.0


def load_supersplat_positions(ply_path):
    ply = PlyData.read(ply_path)

    chunks = ply["chunk"].data
    verts  = ply["vertex"].data

    world_xyz = []

    chunk_count = len(chunks)
    chunk_size  = len(verts) // chunk_count  

    for i, c in enumerate(chunks):
        min_xyz = np.array([c["min_x"], c["min_y"], c["min_z"]])
        max_xyz = np.array([c["max_x"], c["max_y"], c["max_z"]])

        start = i * chunk_size
        end   = (i + 1) * chunk_size if i < chunk_count - 1 else len(verts)

        for v in verts[start:end]:
            px, py, pz = unpack_xyz(v["packed_position"])
            pos = min_xyz + np.array([px, py, pz]) * (max_xyz - min_xyz)
            world_xyz.append(pos)

    return np.array(world_xyz)
