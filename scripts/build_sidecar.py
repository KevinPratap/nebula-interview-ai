#!/usr/bin/env python3
import os
import sys
import subprocess
import shutil

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOURCES_DIR = os.path.join(REPO_ROOT, "resources")
BUILD_DIR = os.path.join(REPO_ROOT, "build", "pyinstaller_build")
SPEC_DIR = os.path.join(REPO_ROOT, "build", "pyinstaller_spec")
ICON_PATH = os.path.join(REPO_ROOT, "public", "logo.ico")

def main():
    os.makedirs(RESOURCES_DIR, exist_ok=True)
    os.makedirs(BUILD_DIR, exist_ok=True)
    os.makedirs(SPEC_DIR, exist_ok=True)

    data_sep = ";" if sys.platform == "win32" else ":"
    core_dir = os.path.join(REPO_ROOT, "core")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name", "engine_sidecar",
        "--distpath", RESOURCES_DIR,
        "--workpath", BUILD_DIR,
        "--specpath", SPEC_DIR,
        "--exclude-module", "PyQt5",
        "--exclude-module", "PyQt6",
        "--exclude-module", "tkinter",
        f"--add-data={core_dir}{data_sep}core",
    ]

    if os.path.exists(ICON_PATH):
        cmd.extend(["--icon", ICON_PATH])

    cmd.append(os.path.join(REPO_ROOT, "engine_sidecar.py"))

    print(f"Building engine sidecar with command:\n{' '.join(cmd)}\n")
    result = subprocess.run(cmd, cwd=REPO_ROOT)
    
    if result.returncode != 0:
        print(f"\n[ERROR] PyInstaller build failed with exit code {result.returncode}")
        sys.exit(result.returncode)

    ext = ".exe" if sys.platform == "win32" else ""
    target_binary = os.path.join(RESOURCES_DIR, f"engine_sidecar{ext}")
    if os.path.exists(target_binary):
        size_mb = os.path.getsize(target_binary) / (1024 * 1024)
        print(f"\n[SUCCESS] Sidecar built: {target_binary} ({size_mb:.2f} MB)")
    else:
        print(f"\n[WARNING] Expected binary not found at: {target_binary}")

if __name__ == "__main__":
    main()
