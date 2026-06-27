import os
import time
import json
import threading
from datetime import datetime
from core.utils import log_debug

class TranscriptEntry:
    """A single transcribed utterance with metadata."""
    def __init__(self, text: str, source: str, timestamp: float):
        self.text = text
        self.source = source
        self.timestamp = timestamp
        self.is_question = any(q in text.lower() for q in [
            "?", "what", "how", "why", "when", "can you", "could you",
            "tell me", "explain", "describe"
        ])

    def to_dict(self):
        return {
            "text": self.text,
            "source": self.source,
            "timestamp": self.timestamp,
            "is_question": self.is_question
        }

    @staticmethod
    def from_dict(d):
        e = TranscriptEntry(d["text"], d["source"], d["timestamp"])
        e.is_question = d.get("is_question", False)
        return e


class TranscriptManager:
    """
    Accumulates a running transcript with timestamps during a listening session.
    Can save to markdown files and generate structured meeting notes.
    
    Usage:
        tm = TranscriptManager()
        tm.add_entry("What is your experience?", "Internal Audio")
        tm.add_entry("I've been working with React for 3 years.", "Internal Audio")
        path = tm.save_session("Interview - Google SDE")
        notes_path = tm.generate_meeting_notes(groq_key="...")
    """

    def __init__(self, notes_dir: str = ""):
        if not notes_dir:
            notes_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "meeting_notes")
        self.notes_dir = notes_dir
        self.entries: list[TranscriptEntry] = []
        self.start_time: float = 0.0
        self.end_time: float = 0.0
        self.session_active = False
        self._lock = threading.Lock()
        self._last_saved_path = None

        os.makedirs(self.notes_dir, exist_ok=True)
        log_debug(f"TranscriptManager: notes dir = {self.notes_dir}")

    def start_session(self, title: str = ""):
        """Begin a new transcript session."""
        with self._lock:
            self.entries = []
            self.start_time = time.time()
            self.end_time = 0.0
            self.session_active = True
            self._last_saved_path = None
            log_debug(f"TranscriptManager: session started ({title or 'untitled'})")

    def end_session(self):
        """End the current session. Returns path if auto-saved, None otherwise."""
        with self._lock:
            if not self.session_active:
                return None
            self.end_time = time.time()
            self.session_active = False
            log_debug(f"TranscriptManager: session ended. {len(self.entries)} entries.")
            if self.entries:
                path = self._write_markdown()
                self._last_saved_path = path
                return path
            return None

    def add_entry(self, text: str, source: str = "Internal Audio"):
        """Add a transcribed utterance to the running session."""
        if not text or len(text.strip()) < 2:
            return
        with self._lock:
            if not self.session_active:
                # Auto-start if not active
                self.start_time = time.time()
                self.session_active = True
            self.entries.append(TranscriptEntry(text, source, time.time()))

    def save_session(self, title: str = "") -> str:
        """Save current transcript as markdown without ending the session."""
        with self._lock:
            if not self.entries:
                log_debug("TranscriptManager: nothing to save")
                return ""
            path = self._write_markdown(title)
            self._last_saved_path = path
            return path

    def clear(self):
        """Reset the transcript buffer."""
        with self._lock:
            self.entries = []
            self.start_time = 0.0
            self.end_time = 0.0
            self.session_active = False

    def get_stats(self) -> dict:
        """Return session stats for UI display."""
        with self._lock:
            q_count = sum(1 for e in self.entries if e.is_question)
            duration = 0.0
            if self.start_time:
                end = self.end_time if self.end_time > 0 else time.time()
                duration = round(end - self.start_time)
            return {
                "entries": len(self.entries),
                "questions": q_count,
                "duration_seconds": duration,
                "is_active": self.session_active,
                "last_saved": self._last_saved_path or ""
            }

    def get_transcript_text(self) -> str:
        """Return the full transcript as plain text."""
        with self._lock:
            if not self.entries:
                return ""
            parts = []
            start = self.entries[0].timestamp if self.entries else time.time()
            for entry in self.entries:
                offset = entry.timestamp - start
                mins = int(offset // 60)
                secs = int(offset % 60)
                q_mark = " ❓" if entry.is_question else ""
                parts.append(f"[{mins:02d}:{secs:02d}]{q_mark} {entry.text}")
            return "\n".join(parts)

    def get_saved_notes(self) -> list[dict]:
        """List all saved meeting note files."""
        files = []
        if not os.path.isdir(self.notes_dir):
            return files
        for f in sorted(os.listdir(self.notes_dir), reverse=True):
            if f.endswith(".md"):
                path = os.path.join(self.notes_dir, f)
                try:
                    size = os.path.getsize(path)
                    mtime = os.path.getmtime(path)
                    files.append({
                        "filename": f,
                        "path": path,
                        "size": size,
                        "modified": datetime.fromtimestamp(mtime).isoformat()
                    })
                except OSError:
                    continue
        return files

    def generate_meeting_notes(self, groq_key: str = "", title: str = "") -> dict:
        """
        Save the transcript and generate AI-structured meeting notes.
        Returns dict with {path, summary, error} or {error: ...}.
        
        The AI summary includes: key topics, decisions, action items.
        Falls back to markdown-only if no Groq key available.
        """
        # 1. Save raw transcript
        path = self.save_session(title)
        if not path:
            return {"error": "No transcript to save"}

        transcript_text = self.get_transcript_text()
        if not transcript_text:
            return {"path": path, "summary": "", "error": "Empty transcript"}

        # 2. Try AI summary if key is available
        if not groq_key:
            return {"path": path, "summary": ""}

        try:
            from groq import Groq
            client = Groq(api_key=groq_key)

            prompt = (
                "You are a meeting notes assistant. Given the following transcript, "
                "produce structured meeting notes with these sections:\n\n"
                "## Summary\nOne paragraph summarizing what was discussed.\n\n"
                "## Key Topics\n- Topic 1\n- Topic 2\n\n"
                "## Decisions\n- Decision made A\n- Decision made B\n\n"
                "## Action Items\n- [ ] Owner: Task description\n\n"
                "Keep it concise and factual. Transcript:\n\n"
                f"{transcript_text}"
            )

            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": "You are a precise meeting notes assistant. Output structured markdown only."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=1500,
                temperature=0.3,
                stream=False
            )

            summary = response.choices[0].message.content.strip() if response.choices else ""

            if summary:
                # Write enhanced notes file
                notes_content = self._build_enhanced_notes(transcript_text, summary, title)
                enhanced_path = path.replace(".md", "_summary.md")
                with open(enhanced_path, "w", encoding="utf-8") as f:
                    f.write(notes_content)
                log_debug(f"TranscriptManager: enhanced notes saved to {enhanced_path}")
                return {"path": enhanced_path, "summary": summary}

        except ImportError:
            log_debug("TranscriptManager: groq library not available for AI summary")
        except Exception as e:
            log_debug(f"TranscriptManager: AI summary failed: {e}")

        return {"path": path, "summary": ""}

    def _write_markdown(self, title: str = "") -> str:
        """Internal: write the raw transcript to a markdown file."""
        if not self.entries:
            return ""

        start_ts = self.entries[0].timestamp
        end_ts = self.entries[-1].timestamp
        duration_secs = int(end_ts - start_ts) if end_ts > start_ts else 0
        duration_str = f"{duration_secs // 60}m {duration_secs % 60}s"
        q_count = sum(1 for e in self.entries if e.is_question)

        safe_title = title.strip() if title.strip() else "Session"
        safe_timestamp = datetime.fromtimestamp(start_ts).strftime("%Y%m%d_%H%M%S")
        filename = f"nebula_{safe_timestamp}.md"

        lines = [
            f"# {safe_title}",
            "",
            f"**Date:** {datetime.fromtimestamp(start_ts).strftime('%Y-%m-%d %H:%M:%S')}",
            f"**Duration:** {duration_str}",
            f"**Utterances:** {len(self.entries)}",
            f"**Questions:** {q_count}",
            "",
            "---",
            "",
            "## Transcript",
            "",
        ]

        start = self.entries[0].timestamp
        for entry in self.entries:
            offset = entry.timestamp - start
            mins = int(offset // 60)
            secs = int(offset % 60)
            source_tag = f" [{entry.source}]" if entry.source != "Internal Audio" else ""
            q_mark = " ❓" if entry.is_question else ""
            lines.append(f"**[{mins:02d}:{secs:02d}]{q_mark}{source_tag}** {entry.text}")
            lines.append("")

        lines.append("---")
        lines.append(f"*Generated by Nebula Interview AI v1.2.1 OSS*")
        lines.append("")

        path = os.path.join(self.notes_dir, filename)
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

        log_debug(f"TranscriptManager: saved {path} ({len(self.entries)} entries)")
        return path

    def _build_enhanced_notes(self, transcript_text: str, ai_summary: str, title: str = "") -> str:
        """Combine raw transcript with AI-generated summary into one file."""
        start_ts = self.entries[0].timestamp if self.entries else time.time()
        safe_timestamp = datetime.fromtimestamp(start_ts).strftime("%Y%m%d_%H%M%S")
        safe_title = title.strip() if title.strip() else "Session"
        filename = f"nebula_{safe_timestamp}_enhanced.md"

        lines = [
            f"# {safe_title} — Meeting Notes",
            "",
            f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            "---",
            "",
            ai_summary,
            "",
            "---",
            "",
            "## Full Transcript",
            "",
            transcript_text,
            "",
            "---",
            f"*Generated by Nebula Interview AI v1.2.1 OSS*",
            "",
        ]

        path = os.path.join(self.notes_dir, filename)
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        return path
