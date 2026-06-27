import re
import os
import time
import sys

# V51.71: Shared DEBUG logging
USER_DATA = os.environ.get('NEBULA_USER_DATA')
if USER_DATA:
    DEBUG_FILE = os.path.join(USER_DATA, "nebula_sidecar_debug.log")
else:
    DEBUG_FILE = os.path.join(os.environ.get('TEMP', '/tmp'), "nebula_sidecar_debug.log")

def log_debug(msg):
    try:
        with open(DEBUG_FILE, "a") as f:
            f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")
    except: pass
    sys.stderr.write(f"DEBUG: {msg}\n")
    sys.stderr.flush()

class TechnicalFixer:
    """Corrects common speech recognition errors for technical jargon"""
    
    PHRASE_MAP = {
        "f idf": "TF-IDF", "tf idf": "TF-IDF", "ci cd": "CI/CD",
        "see eye see dee": "CI/CD", "auto ml": "AutoML",
        "sci kit learn": "Scikit-learn", "pi torch": "PyTorch",
        "low code": "Low-code", "no code": "No-code"
    }
    
    WORD_MAP = {
        "gf": "TF-IDF", "tfidf": "TF-IDF", "sql": "SQL", "sequel": "SQL",
        "nlp": "NLP", "aws": "AWS", "ml": "ML", "ai": "AI",
        "xgboost": "XGBoost", "pytorch": "PyTorch", "scikit": "Scikit-learn",
        "api": "API", "json": "JSON", "rest": "REST", "crud": "CRUD", "git": "Git"
    }

    @classmethod
    def fix(cls, text):
        if not text: return text
        fixed_text = text
        
        # Phrases
        for phrase in sorted(cls.PHRASE_MAP.keys(), key=len, reverse=True):
            replacement = cls.PHRASE_MAP[phrase]
            pattern = re.compile(r'\b' + re.escape(phrase) + r'\b', re.IGNORECASE)
            fixed_text = pattern.sub(replacement, fixed_text)
            
        # Words
        words = fixed_text.split()
        final_words = []
        for word in words:
            clean_word = word.lower().strip(",.!?")
            if clean_word in cls.WORD_MAP:
                punctuation = word[len(clean_word):] if len(word) > len(clean_word) else ""
                final_words.append(cls.WORD_MAP[clean_word] + punctuation)
            else:
                final_words.append(word)
                
        return " ".join(final_words)
