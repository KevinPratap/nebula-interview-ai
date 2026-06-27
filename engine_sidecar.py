import os
import sys
import io
import json
import threading
import time
import numpy as np
import traceback
import re
import webbrowser
import mss

# Stability Fixes for Windows
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1" 

try:
    import pypdf
    from docx import Document
except ImportError:
    pypdf = None
    Document = None

if sys.stdout: sys.stdout.reconfigure(line_buffering=True)
if sys.stdin: sys.stdin.reconfigure(line_buffering=True)

from core.audio_service import AudioService
from core.ai_service import AIService, PROVIDER_MODEL_LISTS, PROVIDER_DEFAULT_MODELS
from core.settings_manager import SettingsManager
from core.transcript_manager import TranscriptManager
from core.utils import log_debug

log_debug("Sidecar Starting...")

class SidecarEngine:
    def __init__(self):
        sys.stderr.write("DEBUG: SidecarEngine OSS Edition START\n")
        sys.stderr.flush()
        
        self.settings = SettingsManager()
        self.ai = AIService()
        
        device_id = self.settings.get("audio_device_id")
        self.audio = AudioService(use_loopback=True, source_label="Internal Audio", device_index=device_id)
        
        # v16.0 Intelligence State
        self.transcript_buffer = [] 
        self.last_transcript_time = 0
        self.current_query = "" 
        self.last_trigger_time = 0      # v26.0 Joining logic
        self.last_trigger_text = ""      # v26.0 Joining logic
        self.linked_files = {}           # v51.52: Tracking file count
        self.vision_buffer = []          # v51.80: Vision analysis buffer
        self.audio_pump = None           # v1.3.0: Bluetooth audio duplication pump
        self.transcript = TranscriptManager()  # Meeting notes backbone
        
        self.audio.on_transcript_callback = self.on_transcript
        self.ai.on_response_callback = self.on_ai_response
        self.ai.on_chunk_callback = self.on_ai_chunk
        self.ai.on_error_callback = self.on_ai_error

        # Load API keys from environment variables (OSS: no cloud sync)
        self.ai.groq_key = os.environ.get('GROQ_API_KEY') or ''
        self.ai.gemini_key = os.environ.get('GEMINI_API_KEY') or ''
        self.ai.openai_key = os.environ.get('OPENAI_API_KEY') or ''
        self.ai.anthropic_key = os.environ.get('ANTHROPIC_API_KEY') or ''
        self.ai.deepseek_key = os.environ.get('DEEPSEEK_API_KEY') or ''
        self.ai.openrouter_key = os.environ.get('OPENROUTER_API_KEY') or ''

        # Override with settings values if present (settings > env vars > empty)
        if self.settings.get('groq_api_key'):
            self.ai.groq_key = self.settings.get('groq_api_key')
        if self.settings.get('gemini_api_key'):
            self.ai.gemini_key = self.settings.get('gemini_api_key')
        if self.settings.get('openai_api_key'):
            self.ai.openai_key = self.settings.get('openai_api_key')
        if self.settings.get('anthropic_api_key'):
            self.ai.anthropic_key = self.settings.get('anthropic_api_key')
        if self.settings.get('deepseek_api_key'):
            self.ai.deepseek_key = self.settings.get('deepseek_api_key')
        if self.settings.get('openrouter_api_key'):
            self.ai.openrouter_key = self.settings.get('openrouter_api_key')

        self.audio.groq_key = self.ai.groq_key
        mk = lambda k: f"{k[:4]}...{k[-4:]}" if k else 'NONE'
        log_debug(f"Local API Keys - Groq: {mk(self.ai.groq_key)}, OpenAI: {mk(self.ai.openai_key)}, Gemini: {mk(self.ai.gemini_key)}, Anthropic: {mk(self.ai.anthropic_key)}, DeepSeek: {mk(self.ai.deepseek_key)}, OpenRouter: {mk(self.ai.openrouter_key)}")

        # Load model selections from settings
        for provider in ['groq', 'openai', 'gemini', 'anthropic', 'deepseek', 'openrouter']:
            model = self.settings.get(f'model_{provider}')
            if model:
                self.ai.set_model(provider, model)
                log_debug(f"Model loaded for {provider}: {model}")

        
        # Preload and Start Threads
        self.audio.preload()
        threading.Thread(target=self.stream_volume, daemon=True).start()
        threading.Thread(target=self._buffer_watchdog, daemon=True).start()

        sys.stderr.write("DEBUG: SidecarEngine ready.\n")
        sys.stderr.flush()
        
        # Signal ready to the frontend
        self.send_to_electron("ready", {"version": "1.3.0", "status": "sidecar_started"})
        
        # Broadcast devices to UI on startup
        self.handle_command({"action": "get-audio-devices"})

        # No VB-Cable auto-setup — removed by user request (June 24)

    def send_to_electron(self, msg_type, payload):
        try:
            msg = json.dumps({"type": msg_type, "payload": payload})
            print(msg)
            sys.stdout.flush()
        except Exception as e:
            # Log but don't crash — we may lose messages if stdout is broken
            sys.stderr.write(f"DEBUG: send_to_electron failed ({msg_type}): {e}\n")
            sys.stderr.flush()

    def on_transcript(self, text, source):
        if text.startswith("@SYSTEM:"):
            self.send_to_electron("status", {"msg": text.replace("@SYSTEM: ", "")})
            return

        junk = ["[", "(", "music", "noise", "silence", "thank you", "thanks", "watching", "youtube", "subscribe", "subscribing", "transcribed by", "copyright", "all rights reserved", "english sub", "subtitle", "subbed by", "ensure on-demand"]
        if any(m in text.lower() for m in junk) and len(text) < 50: return

        sys.stderr.write(f"DEBUG: Heard fragment: \"{text}\"\n")
        sys.stderr.flush()
        
        self.transcript_buffer.append(text)
        self.last_transcript_time = time.time()

        # Feed to transcript manager for meeting notes
        self.transcript.add_entry(text, source)

        if self.ai.is_generating:
            sys.stderr.write("DEBUG: Interruption detected! Merging context...\n")
            sys.stderr.flush()
        
        self.send_to_electron("transcript", {"text": text, "source": source, "buffered": True})

    def _clean_stutters(self, text):
        if not text: return ""
        # Deduplicate adjacent identical words/phrases (v26.0)
        text = re.sub(r'\b(\w+)(?:\s+\1\b)+', r'\1', text, flags=re.IGNORECASE)
        text = re.sub(r'\b(\w+\s+\w+)(?:\s+\1\b)+', r'\1', text, flags=re.IGNORECASE)
        return text

    def _is_fragment(self, text):
        t = text.strip().lower()
        if not t: return True
        # Ends in a preposition or connecting word
        if t.split()[-1] in ["the", "a", "an", "is", "are", "of", "to", "in", "with", "and", "or", "for", "from", "at", "by"]:
            return True
        # Very short and no question word
        words = t.split()
        if len(words) < 3 and not any(kw in t for kw in ["what", "how", "why", "who", "when", "?", "explain"]):
            return True
        return False

    def _buffer_watchdog(self):
        while True:
            try:
                time.sleep(0.1) 
                if not self.transcript_buffer: continue
                
                now = time.time()
                time_since_last = now - self.last_transcript_time
                combined_text = " ".join(self.transcript_buffer).strip()
                
                is_question = any(q in combined_text.lower() for q in ["?", "what", "how", "why", "when", "can you", "could you", "tell me", "explain", "describe"])
                
                auto_answer = self.settings.get("auto_answer")
                should_trigger = False
                # Determine threshold
                threshold = 1.0 if is_question else 3.0
                if self._is_fragment(combined_text):
                    threshold *= 2.0 # Wait longer for fragments (v26.0)

                if auto_answer:
                    if time_since_last > threshold:
                        should_trigger = True
                    
                if should_trigger:
                    combined_text = self._clean_stutters(combined_text)
                    
                    if self.ai.is_generating:
                        # Only interrupt if the new speech is a meaningful addition (not a fragment)
                        if self._is_fragment(combined_text):
                            continue
                            
                        sys.stderr.write(f"DEBUG: Interviewer spoke over active generation. Merging query...\n")
                        sys.stderr.write(f"Active Query: {self.last_trigger_text}\n")
                        sys.stderr.write(f"New Speech: {combined_text}\n")
                        sys.stderr.flush()
                        
                        # Merge the queries and trigger refinement
                        self.current_query = (self.last_trigger_text + " " + combined_text).strip()
                        self.current_query = self._clean_stutters(self.current_query)
                        self.last_trigger_text = self.current_query
                        self.last_trigger_time = now
                        
                        self.send_to_electron("status", {"msg": "Nebula: Refining Answer..."})
                        self.ai.generate_response(self.current_query, is_start=True)
                        self.transcript_buffer = []
                    else:
                        # Contextual Coalescing (v26.0)
                        first_word = combined_text.strip().split()[0].lower() if combined_text.strip().split() else ""
                        is_continuation = (
                            (now - self.last_trigger_time < 10.0) or
                            self._is_fragment(combined_text) or
                            first_word in ["and", "or", "but", "so", "then", "also", "actually"]
                        )
                        
                        if is_continuation and self.last_trigger_text:
                            sys.stderr.write(f"DEBUG: Coalescing with last trigger: {self.last_trigger_text}\n")
                            self.current_query = (self.last_trigger_text + " " + combined_text).strip()
                        else:
                            self.current_query = combined_text
                        
                        self.current_query = self._clean_stutters(self.current_query)
                        self.last_trigger_time = now
                        self.last_trigger_text = self.current_query

                        sys.stderr.write(f"DEBUG: Triggering AI: \"{self.current_query}\"\n")
                        sys.stderr.flush()
                        trigger_q = self.current_query
                        
                        # V51.41: Enforce session expiry strictly in the trigger loop
                        self.send_to_electron("status", {"msg": "Nebula: Thinking..."})
                        self.ai.generate_response(trigger_q, is_start=True)
                        # Clear buffer immediately to prevent re-triggering (v51.52)
                        self.transcript_buffer = []
            except Exception as e:
                sys.stderr.write(f"ERROR: Watchdog crash: {e}\n")
                sys.stderr.write(traceback.format_exc())
                sys.stderr.flush()
                time.sleep(1) # Backoff

    def on_ai_response(self, response, mode="", question=""):
        self.send_to_electron("ai-response", {
            "text": response, 
            "provider": "Groq", 
            "strategy": mode,
            "trigger_question": question or self.current_query
        })
        self.send_to_electron("status", {"msg": "Nebula Ready"})
        self.current_query = ""

    def on_ai_chunk(self, chunk, is_start=False):
        self.send_to_electron("ai-chunk", {
            "text": chunk, 
            "is_start": is_start,
            "strategy": "Auto" if self.settings.get("expert_mode") == "Auto" else self.settings.get("expert_mode")
        })

    def on_ai_error(self, error):
        self.send_to_electron("error", {"msg": f"AI Error: {error}"})
        self.send_to_electron("status", {"msg": "Nebula Ready"})

    def stream_volume(self):
        while True:
            vol = getattr(self.audio, 'current_volume', 0) if self.audio.is_listening else 0
            self.send_to_electron("volume", {"level": vol})
            time.sleep(0.2)

    def listen_for_commands(self):
        while True:
            try:
                line = sys.stdin.readline()
                if not line: break
                self.handle_command(json.loads(line))
            except: pass

    def handle_command(self, cmd):
        threading.Thread(target=self._handle_command_impl, args=(cmd,), daemon=True).start()

    def _handle_command_impl(self, cmd):
        action, payload = cmd.get("action"), cmd.get("payload")
        log_debug(f"Action Received: {action}")
        
        if action == "toggle-listening":
            if bool(payload): self.audio.start()
            else: self.audio.stop()
        
        elif action == "open-url":
            self.send_to_electron("open-external-url", payload)
            self.send_to_electron("status", {"msg": "Opening Portal..."})

        elif action == "update-context":
            if payload:
                self.ai.job_context = payload
                sys.stderr.write(f"DEBUG: Interview Context updated ({len(payload)} chars)\n")
            else:
                sys.stderr.write("DEBUG: Ignored empty context update\n")
                sys.stderr.write("DEBUG: Ignored empty context update (keep existing)\n")
            sys.stderr.flush()

        elif action == "parse-file":
            path = payload
            filename = os.path.basename(path)
            text = self._extract_text_from_file(path)
            if text:
                self.linked_files[filename] = text
                # Aggregate all linked files into one context
                all_text = "\n\n".join(self.linked_files.values())
                self.ai.resume_context = all_text
                self.send_to_electron("resume-parsed", {"text": all_text})
                self.send_to_electron("context-count", {"count": len(self.linked_files)})
            else:
                self.send_to_electron("error", {"msg": "Failed to parse file format"})

        elif action == "get-context-count":
            self.send_to_electron("context-count", {"count": len(self.linked_files)})

        elif action == "fetch-context":
            # URL Scraping logic (v30.0)
            url = payload
            threading.Thread(target=self._scrape_url, args=(url,), daemon=True).start()

        elif action == "analyze-screen":
            # Vision analysis (v51.60)
            threading.Thread(target=self._analyze_screen, args=(payload,), daemon=True).start()

        elif action == "capture-snapshot": # v51.80: Multi-shot Support
            threading.Thread(target=self._capture_snapshot, args=(payload,), daemon=True).start()

        elif action == "clear-snapshots": # v51.80: Multi-shot Support
            threading.Thread(target=self._clear_snapshots, args=(payload,), daemon=True).start()

        # --- Meeting Notes Commands ---
        elif action == "start-session":
            self.transcript.start_session(payload or "")
            self.send_to_electron("status", {"msg": "Session recording started"})
            self.send_to_electron("session-status", self.transcript.get_stats())

        elif action == "end-session":
            path = self.transcript.end_session()
            if path:
                self.send_to_electron("status", {"msg": f"Session saved: {os.path.basename(path)}"})
            else:
                self.send_to_electron("status", {"msg": "No transcript to save"})
            self.send_to_electron("session-status", self.transcript.get_stats())

        elif action == "save-session":
            title = payload or ""
            path = self.transcript.save_session(title)
            if path:
                self.send_to_electron("status", {"msg": f"Transcript saved: {os.path.basename(path)}"})
            else:
                self.send_to_electron("error", {"msg": "No transcript to save"})

        elif action == "generate-meeting-notes":
            title = payload or ""
            path = self.transcript.end_session()
            if not path:
                self.send_to_electron("error", {"msg": "No transcript to process"})
                return
            groq_key = self.ai.groq_key
            result = self.transcript.generate_meeting_notes(groq_key=groq_key, title=title)
            if "error" in result and result["error"]:
                self.send_to_electron("error", {"msg": f"Notes generation: {result['error']}"})
            else:
                self.send_to_electron("status", {"msg": "Meeting notes ready"})
                self.send_to_electron("notes-ready", result)

        elif action == "get-session-status":
            self.send_to_electron("session-status", self.transcript.get_stats())

        elif action == "get-saved-notes":
            notes = self.transcript.get_saved_notes()
            self.send_to_electron("saved-notes", notes)

        elif action == "clear-transcript":
            self.transcript.clear()
            self.send_to_electron("status", {"msg": "Transcript cleared"})
            self.send_to_electron("session-status", self.transcript.get_stats())

        elif action == "get-settings":
            self.send_to_electron("settings-data", self.settings.settings)

        elif action == "get-available-models":
            self.send_to_electron("available-models", {
                "models": PROVIDER_MODEL_LISTS,
                "defaults": PROVIDER_DEFAULT_MODELS
            })

        elif action == "update-model":
            provider = payload.get("provider")
            model_name = payload.get("model")
            if provider and model_name:
                self.settings.set(f"model_{provider}", model_name)
                self.ai.set_model(provider, model_name)
                log_debug(f"Model updated for {provider}: {model_name}")

        elif action == "update-setting":
            key, val = payload.get("key"), payload.get("val")
            self.settings.set(key, val)
            if key == "expert_mode":
                self.ai.set_expert_mode(val)
            elif key == "audio_device_id":
                sys.stderr.write(f"DEBUG: Switching audio device to {val}\n")
                sys.stderr.flush()
                was_listening = self.audio.is_listening
                if was_listening: self.audio.stop()
                self.audio.device_index = val
                if was_listening: self.audio.start()
            elif key.startswith('model_'):
                provider = key.replace('model_', '', 1)
                self.ai.set_model(provider, val)
                log_debug(f"Model updated via setting for {provider}: {val}")

        elif action == "get-audio-devices":
            devices = AudioService.get_input_devices(pyaudio_instance=self.audio.p)
            cleaned = []
            seen = set()
            for d in devices:
                name = d['name'].strip()
                if name in seen: continue
                seen.add(name)
                cleaned.append(d)
            self.send_to_electron("audio-devices-data", cleaned)

        elif action == "get-output-devices":
            output_devices = []
            seen = set()
            try:
                p = self.audio.p  # Reuse existing PyAudio instance
                for i in range(p.get_device_count()):
                    try:
                        info = p.get_device_info_by_index(i)
                        if info.get('maxOutputChannels', 0) > 0:
                            name = info.get('name', '').strip()
                            if name and name not in seen:
                                seen.add(name)
                                output_devices.append({"id": name, "name": name})
                    except:
                        pass
            except:
                # Fallback: create temporary instance
                import pyaudio as pa
                p = pa.PyAudio()
                try:
                    for i in range(p.get_device_count()):
                        try:
                            info = p.get_device_info_by_index(i)
                            if info.get('maxOutputChannels', 0) > 0:
                                name = info.get('name', '').strip()
                                if name and name not in seen:
                                    seen.add(name)
                                    output_devices.append({"id": name, "name": name})
                        except:
                            pass
                finally:
                    p.terminate()
            self.send_to_electron("output-devices-data", output_devices)

        elif action == "select-output-device":
            """User selected an output device — update AudioPump target."""
            device_name = payload
            if device_name and self.audio_pump:
                self.audio_pump.set_bluetooth(device_name)
                sys.stderr.write(f"DEBUG: Output device set to \"{device_name}\"\n")
                sys.stderr.flush()
                self.settings.set("output_device_id", device_name)
                self.send_to_electron("output-device-updated", {"name": device_name})

        elif action == "fake-transcript":
            self.on_transcript(payload, "Manual")

        elif action == "trigger-ai":
            log_debug("Triggering AI (Manual)...")
            if self.transcript_buffer:
                combined_text = " ".join(self.transcript_buffer).strip()
                combined_text = self._clean_stutters(combined_text)
                
                # Use same joining logic as watchdog (v26.0)
                now = time.time()
                if now - self.last_trigger_time < 4.0:
                    self.current_query = (self.last_trigger_text + " " + combined_text).strip()
                else:
                    self.current_query = combined_text
                
                self.current_query = self._clean_stutters(self.current_query)
                self.last_trigger_time = now
                self.last_trigger_text = self.current_query
                
                self.transcript_buffer = []
                self.send_to_electron("status", {"msg": "Thinking (Manual)..."})
                self.ai.generate_response(self.current_query)
                sys.stderr.write(f"DEBUG: Manual Trigger: {self.current_query}\n")
                sys.stderr.flush()
            else:
                self.send_to_electron("status", {"msg": "No question detected yet"})

        elif action == "update-api-keys":
            payload = cmd.get("payload", {})
            mk = lambda k: f"{k[:4]}...{k[-4:]}" if k else 'NONE'
            for payload_key, settings_key in [("groq_key", "groq_api_key"), ("openai_key", "openai_api_key"), ("gemini_key", "gemini_api_key"), ("anthropic_key", "anthropic_api_key"), ("deepseek_key", "deepseek_api_key"), ("openrouter_key", "openrouter_api_key")]:
                val = payload.get(payload_key)
                if val:
                    self.settings.set(settings_key, val)
                    if payload_key == "groq_key":
                        self.ai.groq_key = val
                    elif payload_key == "openai_key":
                        self.ai.openai_key = val
                    elif payload_key == "gemini_key":
                        self.ai.gemini_key = val
                    elif payload_key == "anthropic_key":
                        self.ai.anthropic_key = val
                    elif payload_key == "deepseek_key":
                        self.ai.deepseek_key = val
                    elif payload_key == "openrouter_key":
                        self.ai.openrouter_key = val
            self.audio.groq_key = self.ai.groq_key
            log_debug(f"API Keys updated - Groq: {mk(self.ai.groq_key)}, OpenAI: {mk(self.ai.openai_key)}, Gemini: {mk(self.ai.gemini_key)}, Anthropic: {mk(self.ai.anthropic_key)}, DeepSeek: {mk(self.ai.deepseek_key)}, OpenRouter: {mk(self.ai.openrouter_key)}")
            self.send_to_electron("api-keys-updated", {"status": "ok"})

        elif action == "get-api-keys":
            mk = lambda k: f"{k[:4]}...{k[-4:]}" if k else ''
            self.send_to_electron("api-keys", {
                "groq_key": mk(self.ai.groq_key),
                "openai_key": mk(self.ai.openai_key),
                "gemini_key": mk(self.ai.gemini_key),
                "anthropic_key": mk(self.ai.anthropic_key),
                "deepseek_key": mk(self.ai.deepseek_key),
                "openrouter_key": mk(self.ai.openrouter_key)
            })

        else:
            self.send_to_electron("error", {"msg": f"Unknown command: {action}"})
            log_debug(f"Unknown action: {action}")

    def _extract_text_from_file(self, path):
        sys.stderr.write(f"DEBUG: Extracting text from: {path}\n")
        sys.stderr.flush()
        try:
            ext = os.path.splitext(path)[1].lower()
            sys.stderr.write(f"DEBUG: Extension detected: {ext}\n")
            sys.stderr.flush()
            if ext == '.txt':
                with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                    return f.read()
            elif ext == '.pdf':
                if pypdf:
                    reader = pypdf.PdfReader(path)
                    text = ""
                    for page in reader.pages:
                        extracted = page.extract_text()
                        if extracted:
                            text += extracted + "\n"
                    sys.stderr.write(f"DEBUG: PDF Extraction complete. Chars: {len(text)}\n")
                    sys.stderr.flush()
                    return text
                sys.stderr.write("DEBUG: pypdf library NOT AVAILABLE\n")
                sys.stderr.flush()
                return "PDF library not available"
            elif ext in ['.doc', '.docx']:
                if Document:
                    doc = Document(path)
                    text = "\n".join([para.text for para in doc.paragraphs])
                    sys.stderr.write(f"DEBUG: Word Extraction complete. Chars: {len(text)}\n")
                    sys.stderr.flush()
                    return text
                sys.stderr.write("DEBUG: python-docx library NOT AVAILABLE\n")
                sys.stderr.flush()
                return "Word library not available"
            return None
        except Exception as e:
            sys.stderr.write(f"ERROR parsing file {path}: {str(e)}\n")
            sys.stderr.flush()
            return None

    def _scrape_url(self, url):
        try:
            import re
            resp = requests.get(url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
            if resp.status_code == 200:
                # Remove script/style tags
                text = re.sub(r'<(script|style).*?>.*?</\1>', '', resp.text, flags=re.I|re.S)
                # Pull visible text
                text = re.sub(r'<.*?>', ' ', text)
                text = re.sub(r'\s+', ' ', text).strip()
                # Safeguard length
                text = text[:5000]
                self.send_to_electron("context-fetched", {"text": text, "url": url})
                # Auto-sync it to job_context (v51.53 Decoupled)
                self.ai.job_context = text
                sys.stderr.write(f"DEBUG: URL Context scraped and synced ({len(text)} chars)\n")
                sys.stderr.flush()
            else:
                self.send_to_electron("error", {"msg": f"URL Load Failed: {resp.status_code}"})
        except Exception as e:
            self.send_to_electron("error", {"msg": f"Scrape Error: {str(e)}"})

    def _analyze_screen(self, payload):
        """Captures the screenshot, appends to buffer, and triggers analysis (v51.90: Unified Smart Scan)"""
        try:
            display_info = payload.get("display_info")
            sys.stderr.write("DEBUG: Unified Smart Scan Triggered...\n")
            
            # 1. Capture and append
            img_bytes = self._grab_screen_robust(display_info)
            if img_bytes:
                self.vision_buffer.append(img_bytes)
                sys.stderr.write(f"DEBUG: Snapshot appended. Total Context: {len(self.vision_buffer)}\n")
            
            if not self.vision_buffer:
                raise Exception("Unable to capture screen content.")

            # 2. Update UI Count
            self.send_to_electron("context-update", {"count": len(self.vision_buffer)})

            # 3. Analyze all parts together
            question = payload.get("question", "Analyze all provided screenshots as a single continuous screen (e.g., a scrolled code editor or document). Provide the full implementation, explanation, and complexity analysis for any problem visible.")
            self.send_to_electron("status", {"msg": "AI Analyzing Context..."})
            
            # Live refinement: Cancellation is handled inside AI Service (is_generating check)
            self.ai.generate_response(question, image_list=self.vision_buffer)
            
        except Exception as e:
            sys.stderr.write(f"ERROR: Unified Scan Failed: {traceback.format_exc()}\n")
            self.send_to_electron("error", {"msg": f"Vision Error: {str(e)}"})

    def _capture_snapshot(self, payload):
        """Captures a snapshot and appends to vision buffer (v51.80)"""
        try:
            display_info = payload.get("display_info")
            sys.stderr.write("DEBUG: Capturing Snapshot...\n")
            
            img_bytes = self._grab_screen_robust(display_info)
            if img_bytes:
                self.vision_buffer.append(img_bytes)
                sys.stderr.write(f"DEBUG: Snapshot captured. Total: {len(self.vision_buffer)}\n")
                self.send_to_electron("context-update", {"count": len(self.vision_buffer)})
        except Exception as e:
            sys.stderr.write(f"ERROR: Snapshot Failed: {str(e)}\n")

    def _clear_snapshots(self, payload):
        """Resets the vision buffer"""
        self.vision_buffer = []
        sys.stderr.write("DEBUG: Snapshots cleared.\n")
        self.send_to_electron("context-update", {"count": 0})

    def _grab_screen_robust(self, display_info):
        """Internal helper for robust multi-monitor capture"""
        with mss.mss() as sct:
            monitor = sct.monitors[1] # Default
            if display_info:
                app_x = display_info.get("x", 0)
                app_y = display_info.get("y", 0)
                app_w = display_info.get("width", 1920)
                app_h = display_info.get("height", 1080)
                
                best_monitor = None
                max_overlap = -1
                for m in sct.monitors[1:]:
                    dx = min(app_x + app_w, m["left"] + m["width"]) - max(app_x, m["left"])
                    dy = min(app_y + app_h, m["top"] + m["height"]) - max(app_y, m["top"])
                    if dx > 0 and dy > 0:
                        overlap = dx * dy
                        if overlap > max_overlap:
                            max_overlap = overlap
                            best_monitor = m
                if best_monitor: monitor = best_monitor
            
            sct_img = sct.grab(monitor)
            return mss.tools.to_png(sct_img.rgb, sct_img.size)

    def listen_for_commands(self):
        """Continuously listen for JSON commands on stdin."""
        for line in sys.stdin:
            if not line.strip(): continue
            try:
                cmd = json.loads(line)
                self.handle_command(cmd)
            except Exception as e:
                sys.stderr.write(f"DEBUG: Error handling command: {e}\n")
                sys.stderr.flush()

if __name__ == "__main__":
    engine = SidecarEngine()
    engine.listen_for_commands()
