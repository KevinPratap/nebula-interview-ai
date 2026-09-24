import json
import os
import threading

class SettingsManager:
    def __init__(self, filename="user_settings.json"):
        # Resolve to NEBULA_USER_DATA if passed by Electron, otherwise fallback to local CWD
        user_data = os.environ.get("NEBULA_USER_DATA", "")
        if user_data:
            self.filename = os.path.join(user_data, filename)
        else:
            self.filename = os.path.abspath(filename)
        self._lock = threading.Lock()
        self.settings = self.load_settings()

    def load_settings(self):
        if os.path.exists(self.filename):
            try:
                with open(self.filename, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # Normalize legacy *_key to *_api_key
                    key_mappings = {
                        "groq_key": "groq_api_key",
                        "gemini_key": "gemini_api_key",
                        "openai_key": "openai_api_key",
                        "anthropic_key": "anthropic_api_key",
                        "deepseek_key": "deepseek_api_key",
                        "openrouter_key": "openrouter_api_key"
                    }
                    for old_k, new_k in key_mappings.items():
                        if old_k in data and new_k not in data:
                            data[new_k] = data[old_k]
                    return data
            except Exception as e:
                print(f"Warning: Failed to load settings from {self.filename}: {e}")
                return self.defaults()
        return self.defaults()

    def defaults(self):
        return {
            "always_on_top": True,
            "stealth_mode": False,
            "interview_mode": True,
            "auto_answer": True,
            "opacity": 255,
            "theme": "Nebula Dark",
            "groq_api_key": os.environ.get("GROQ_API_KEY", ""),
            "gemini_api_key": os.environ.get("GEMINI_API_KEY", ""),
            "openai_api_key": os.environ.get("OPENAI_API_KEY", ""),
            "anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY", ""),
            "deepseek_api_key": os.environ.get("DEEPSEEK_API_KEY", ""),
            "openrouter_api_key": os.environ.get("OPENROUTER_API_KEY", ""),
            "text_size": 15,
            "save_transcripts": False,
            "low_credit_alert": True,
            "session_end_warning": True,
            "autoload_resume": False,
            "resume_path": "",
            "show_guide_startup": True,
            "light_mode": False,
            "hotkey": "F2",
            "expert_mode": "Standard assistant",
            "show_tooltips": True,
            "hotkey_screen": "Alt+X"
        }

    def save_settings(self):
        # Write-to-temp-then-rename with lock to prevent race conditions AND to avoid
        # leaving a truncated/corrupt settings.json if the process dies mid-write (a
        # direct open(..., 'w') truncates the file before any new bytes are written).
        with self._lock:
            try:
                dir_path = os.path.dirname(self.filename)
                if dir_path:
                    os.makedirs(dir_path, exist_ok=True)
                tmp_path = f"{self.filename}.tmp"
                with open(tmp_path, 'w', encoding='utf-8') as f:
                    json.dump(self.settings, f, indent=4)
                os.replace(tmp_path, self.filename)
            except Exception as e:
                print(f"Failed to save settings to {self.filename}: {e}")

    def get(self, key, default=None):
        with self._lock:
            # Check presence first — `defaults()` rebuilds a fresh dict (plus 6 os.environ
            # lookups) on every call, and this is polled every 100ms from the buffer
            # watchdog, so evaluating it as an eager fallback arg for an already-present
            # key was needless work on a hot path.
            if key in self.settings:
                return self.settings[key]
            return default if default is not None else self.defaults().get(key)

    def set(self, key, value):
        with self._lock:
            self.settings[key] = value
        self.save_settings()
