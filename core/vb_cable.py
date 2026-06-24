"""
VB-Cable integration for Nebula.
Detects, downloads, and installs VB-Cable virtual audio driver.
When active, all system audio can be routed through it for clean loopback capture.
"""
import sys
import os
import subprocess
import urllib.request
import zipfile
import tempfile
import ctypes
import re

# VB-Cable device identifiers
CABLE_INPUT_NAME = "CABLE Input (VB-Audio Virtual Cable)"
CABLE_OUTPUT_NAME = "CABLE Output (VB-Audio Virtual Cable)"
CABLE_INPUT_REGEX = r"CABLE Input.*VB-Audio"
CABLE_OUTPUT_REGEX = r"CABLE Output.*VB-Audio"

# Download URLs (October 2024)
VB_CABLE_URL = "https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip"
VB_CABLE_SITE = "https://vb-audio.com/Cable/"

def is_installed():
    """Check if VB-Cable is already installed by scanning audio devices."""
    try:
        # Check via soundcard
        try:
            import soundcard as sc
            mics = sc.all_microphones(include_loopback=True)
            for m in mics:
                if re.search(CABLE_OUTPUT_REGEX, m.name, re.IGNORECASE):
                    return True
        except:
            pass
        
        # Check via PyAudio
        import pyaudio
        p = pyaudio.PyAudio()
        try:
            for i in range(p.get_device_count()):
                try:
                    info = p.get_device_info_by_index(i)
                    name = info.get('name', '')
                    if re.search(CABLE_OUTPUT_REGEX, name, re.IGNORECASE) or \
                       re.search(CABLE_INPUT_REGEX, name, re.IGNORECASE):
                        return True
                except:
                    pass
        finally:
            p.terminate()
        
        return False
    except Exception as e:
        sys.stderr.write(f"DEBUG: VB-Cable check error: {e}\n")
        return False

def get_device_name():
    """Get the VB-Cable output device name for capture."""
    try:
        import soundcard as sc
        mics = sc.all_microphones(include_loopback=True)
        for m in mics:
            if re.search(CABLE_OUTPUT_REGEX, m.name, re.IGNORECASE):
                return m.name
    except:
        pass
    
    import pyaudio
    p = pyaudio.PyAudio()
    try:
        for i in range(p.get_device_count()):
            info = p.get_device_info_by_index(i)
            name = info.get('name', '')
            if re.search(CABLE_OUTPUT_REGEX, name, re.IGNORECASE):
                return name
    finally:
        p.terminate()
    
    return None

def download_installer(dest_dir=None):
    """Download the VB-Cable installer zip to the given directory."""
    if dest_dir is None:
        dest_dir = tempfile.gettempdir()
    
    zip_path = os.path.join(dest_dir, "VBCABLE_Driver_Pack43.zip")
    
    sys.stderr.write(f"DEBUG: Downloading VB-Cable from {VB_CABLE_URL}...\n")
    sys.stderr.flush()
    
    try:
        urllib.request.urlretrieve(VB_CABLE_URL, zip_path)
        sys.stderr.write(f"DEBUG: Downloaded to {zip_path}\n")
        sys.stderr.flush()
        return zip_path
    except Exception as e:
        sys.stderr.write(f"DEBUG: Download failed: {e}\n")
        sys.stderr.flush()
        return None

def extract_installer(zip_path, dest_dir=None):
    """Extract the VB-Cable installer from the zip."""
    if dest_dir is None:
        dest_dir = tempfile.gettempdir()
    
    extract_dir = os.path.join(dest_dir, "VBCABLE")
    os.makedirs(extract_dir, exist_ok=True)
    
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(extract_dir)
        
        # Find the installer executable
        for root, dirs, files in os.walk(extract_dir):
            for f in files:
                f_lower = f.lower()
                if f_lower.endswith('.exe') and ('setup' in f_lower or 'install' in f_lower):
                    return os.path.join(root, f)
        
        return extract_dir
    except Exception as e:
        sys.stderr.write(f"DEBUG: Extract failed: {e}\n")
        sys.stderr.flush()
        return None

def install_silent(installer_path):
    """Install VB-Cable silently (requires admin elevation)."""
    if not installer_path:
        return False
    
    try:
        sys.stderr.write(f"DEBUG: Installing VB-Cable from {installer_path}...\n")
        sys.stderr.flush()
        
        # Check if we need admin
        if not ctypes.windll.shell32.IsUserAnAdmin():
            sys.stderr.write("DEBUG: Admin elevation required for VB-Cable install\n")
            sys.stderr.flush()
            # Re-run with admin
            ctypes.windll.shell32.ShellExecuteW(
                None, "runas", installer_path, "/S /silent", None, 1
            )
            return True
        
        # Run installer silently
        result = subprocess.run(
            [installer_path, "/S", "/silent"],
            capture_output=True, text=True, timeout=60
        )
        sys.stderr.write(f"DEBUG: Installer exit code: {result.returncode}\n")
        sys.stderr.flush()
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        sys.stderr.write("DEBUG: Installer timed out\n")
        sys.stderr.flush()
        return False
    except Exception as e:
        sys.stderr.write(f"DEBUG: Install failed: {e}\n")
        sys.stderr.flush()
        return False

def auto_install():
    """Full auto-install flow: download → extract → install."""
    if is_installed():
        return True
    
    zip_path = download_installer()
    if not zip_path:
        return False
    
    installer = extract_installer(zip_path)
    if not installer:
        return False
    
    if os.path.isfile(installer):
        return install_silent(installer)
    
    # If extracted dir, look for setup
    for root, dirs, files in os.walk(installer):
        for f in files:
            if 'setup' in f.lower() and f.lower().endswith('.exe'):
                return install_silent(os.path.join(root, f))
    
    return False

def set_as_default():
    """Programmatically set CABLE Input as the default playback device.
    Uses Windows AudioDeviceCmdlets via PowerShell script file.
    Returns True if successful."""
    import subprocess
    import os
    import tempfile
    try:
        ps_code = """$dev = Get-AudioDevice -Playback | Where-Object { $_.Name -like '*CABLE Input*' }
if ($dev) {
    Set-AudioDevice -InputObject $dev
    Write-Host 'OK'
} else {
    Write-Host 'NOT_FOUND'
}"""
        # Write to Windows temp to avoid WSL path issues
        ps_path = os.environ.get('TEMP', 'C:\\Users\\prata\\AppData\\Local\\Temp')
        ps_file = os.path.join(ps_path, 'set_cable_default.ps1')
        with open(ps_file, 'w') as f:
            f.write(ps_code)
        
        result = subprocess.run(
            ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps_file],
            capture_output=True, text=True, timeout=15,
            cwd='C:\\'
        )
        output = result.stdout.strip()
        return 'OK' in output
    except Exception as e:
        sys.stderr.write(f"DEBUG: set_as_default error: {e}\n")
        sys.stderr.flush()
        return False
def auto_setup():
    """Full auto-setup: install VB-Cable, set as default, return device name.
    One-call function for 'just works' integration."""
    # Step 1: Install if needed
    if not is_installed():
        sys.stderr.write("DEBUG: VB-Cable not installed. Installing...\n")
        sys.stderr.flush()
        success = auto_install()
        if not success:
            return None
    
    # Step 2: Set CABLE Input as default playback device
    sys.stderr.write("DEBUG: Setting CABLE Input as default playback device...\n")
    sys.stderr.flush()
    set_as_default()
    
    # Step 3: Return the capture device name
    capture_dev = get_device_name()
    return capture_dev

# --- Integration into audio_service.py device listing ---

def get_vb_cable_devices():
    """Return device entries for VB-Cable output (capture side).
    Prefers WASAPI variant (works with loopback) over MME/DirectSound.
    """
    devices = []
    seen = {}  # name -> best entry so far
    
    try:
        import pyaudio
        p = pyaudio.PyAudio()
        try:
            for i in range(p.get_device_count()):
                try:
                    info = p.get_device_info_by_index(i)
                    name = info.get('name', '')
                    if re.search(CABLE_OUTPUT_REGEX, name, re.IGNORECASE):
                        api = p.get_host_api_info_by_index(info.get('hostApi')).get('name', '')
                        channels = int(info.get('maxInputChannels', 2))
                        rate = int(info.get('defaultSampleRate', 44100))
                        is_wasapi = 'wasapi' in api.lower()
                        
                        if name not in seen:
                            seen[name] = {
                                "name": name, "api": api, "channels": channels,
                                "rate": rate, "is_wasapi": is_wasapi, "pyaudio_index": i
                            }
                        elif is_wasapi and not seen[name]["is_wasapi"]:
                            # Prefer WASAPI over MME/DirectSound
                            seen[name] = {
                                "name": name, "api": api, "channels": channels,
                                "rate": rate, "is_wasapi": is_wasapi, "pyaudio_index": i
                            }
                except:
                    pass
        finally:
            p.terminate()
    except:
        pass
    
    for name, entry in seen.items():
        label = f"{name} [CABLE Loopback]"
        devices.append({
            "id": label,
            "name": label,
            "pyaudio_index": entry["pyaudio_index"],
            "api": entry["api"],
            "channels": entry["channels"],
            "rate": entry["rate"],
            "is_wasapi": entry["is_wasapi"]
        })
    
    # Also add soundcard entry if not redundant
    try:
        import soundcard as sc
        mics = sc.all_microphones(include_loopback=True)
        for m in mics:
            if re.search(CABLE_OUTPUT_REGEX, m.name, re.IGNORECASE):
                label = f"{m.name} [CABLE Loopback]"
                already_has_pyaudio = any(m.name == d.get("name", "").replace(" [CABLE Loopback]", "") for d in devices)
                if not already_has_pyaudio:
                    devices.append({"id": label, "name": label, "soundcard_name": m.name})
    except:
        pass
    
    return devices


if __name__ == '__main__':
    if is_installed():
        dev = get_device_name()
        print(f"VB-Cable is installed. Capture device: {dev}")
        print(set_as_default())
    else:
        print("VB-Cable is NOT installed.")
        ans = input("Download and install VB-Cable? (y/N): ")
        if ans.lower() == 'y':
            print("Downloading and installing...")
            success = auto_install()
            if success:
                print("Installation complete! Restart Nebula.")
            else:
                print(f"Auto-install failed. Please install manually from {VB_CABLE_SITE}")
