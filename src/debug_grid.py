from explorer import analyze_scene
import matplotlib.pyplot as plt

def main():
    scene = analyze_scene("web/ConferenceHall.ply", grid_res=256)
    grid = scene["grid"]

    plt.figure(figsize=(6,6))
    plt.imshow(grid, cmap='gray')
    plt.title("Occupancy Grid (0=free, 1=obstacle)")
    plt.show()

    print("Free cells:", (grid==0).sum())
    print("Obstacle cells:", (grid==1).sum())

if __name__ == "__main__":
    main()
