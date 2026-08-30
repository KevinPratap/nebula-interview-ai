import re

# Subtitle annotation pattern: [music], (applause), [silence], etc.
_SUBTITLE_ANNOTATION_RE = re.compile(
    r'^[\[\(]\s*(?:music|applause|laughter|noise|silence|audio|cheering|chuckle|gasp|sigh|groan|cough|throat clearing)\s*[\]\)]$',
    re.IGNORECASE
)

# Full-phrase junk: hallucinated YouTube/video credit phrases
_JUNK_PHRASES = [
    "thank you for watching", "thanks for watching", "please subscribe",
    "subscribe to our channel", "transcribed by", "all rights reserved",
    "english subtitle", "subtitles by", "subbed by", "ensure on-demand"
]


def is_junk(text: str) -> bool:
    """Return True if the transcribed text should be discarded as noise or hallucination."""
    text_clean = text.strip()
    text_lower = text_clean.lower()

    # Too short
    if len(text_clean) < 2:
        return True

    # Subtitle annotation tags (e.g. [music], (applause))
    if _SUBTITLE_ANNOTATION_RE.match(text_lower):
        return True

    # Hallucinated video credit phrases when fragment is short
    if any(p in text_lower for p in _JUNK_PHRASES) and len(text_clean) < 60:
        return True

    return False
