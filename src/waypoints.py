import numpy as np

def generate_grid_waypoints(center, size, height, nx=6, nz=5):
   
    min_x = center[0] - size[0] / 2
    max_x = center[0] + size[0] / 2

    min_z = center[2] - size[2] / 2
    max_z = center[2] + size[2] / 2

    xs = np.linspace(min_x + 2, max_x - 2, nx)
    zs = np.linspace(min_z + 2, max_z - 2, nz)

    waypoints = []
    for x in xs:
        for z in zs:
            waypoints.append(np.array([x, height, z]))

    return waypoints
