import json
import os

class SettingsManager:
    def __init__(self, filename="user_settings.json"):
        # v51.40: Use absolute path to avoid CWD issues
        self.filename = os.path.abspath(filename)
        self.settings = self.load_settings()

    def load_settings(self):
        if os.path.exists(self.filename):
            try:
                with open(self.filename, 'r') as f:
                    return json.load(f)
            except:
                return self.defaults()
        return self.defaults()

    def defaults(self):
        return {
            "always_on_top": True,
            "stealth_mode": False,
            "interview_mode": True,
            "opacity": 255,
            "theme": "Nebula Dark",
            "groq_key": os.environ.get("GROQ_API_KEY", ""),
            "gemini_key": os.environ.get("GEMINI_API_KEY", ""),
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
        # Direct write to prevent sharing violations and WinError 32/5 lock conflicts on Windows (v51.99)
        try:
            with open(self.filename, 'w') as f:
                json.dump(self.settings, f, indent=4)
        except Exception as e:
            print(f"Failed to save settings: {e}")

    def get(self, key, default=None):
        return self.settings.get(key, default if default is not None else self.defaults().get(key))

    def set(self, key, value):
        self.settings[key] = value
        self.save_settings()
