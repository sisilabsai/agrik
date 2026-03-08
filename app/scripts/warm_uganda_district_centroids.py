from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.services.uganda_locations import list_districts
from app.services.uganda_map import CACHE_PATH, get_district_centroids


def main() -> None:
    district_names = [item.name for item in list_districts()]
    centroids = get_district_centroids(district_names, max_refresh=10000)
    print(f"Districts requested: {len(district_names)}")
    print(f"Districts resolved: {len(centroids)}")
    print(f"Cache path: {CACHE_PATH}")


if __name__ == "__main__":
    main()
