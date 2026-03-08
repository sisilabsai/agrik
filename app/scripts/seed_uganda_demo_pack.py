from pathlib import Path
import subprocess
import sys


ROOT_DIR = Path(__file__).resolve().parents[2]


def run_script(script_name: str) -> None:
    script_path = ROOT_DIR / "app" / "scripts" / script_name
    subprocess.run([sys.executable, str(script_path)], check=True, cwd=str(ROOT_DIR))


def main() -> None:
    run_script("seed_uganda_test_users.py")
    run_script("seed_uganda_market_activity.py")
    run_script("warm_uganda_district_centroids.py")
    print("UGANDA demo data pack seeded successfully.")


if __name__ == "__main__":
    main()
