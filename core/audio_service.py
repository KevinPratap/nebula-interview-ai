import numpy as np
import os
import sys
import queue
import threading
import time
import io
import soundfile as sf
import pyaudio
from groq import Groq

class AudioService:
    """
    STEREO-COMPATIBLE INTERNAL ENGINE (v15.2)
    Fixed channel mismatch by using native device settings.
    Specifically tuned for "Stereo Mix" (Realtek).
    """
    def __init__(self, sample_rate=16000, use_loopback=True, source_label="Internal Audio", device_index=None):
        self.target_rate = 16000 # AI preferred rate
        self.use_loopback = use_loopback 
        self.source_label = source_label
        self.device_index = device_index
        self.is_listening = False
        self.queue = queue.Queue(maxsize=100)
        self.current_volume = 0
        self.active_device_name = "Stereo Mix / Loopback"
        self._thread = None
        self.groq_key = None 
        
        # v17.0 Turbo Calibration
        self.energy_threshold = 0.001
        self.silence_timeout = 0.8
        self.p = pyaudio.PyAudio()
        
        # Callbacks
        self.on_transcript_callback = None 
        self.on_error_callback = None

    def _warn(self, msg):
        """Log error and fire user-facing callback."""
        sys.stderr.write(f"WARN: {msg}\n")
        sys.stderr.flush()
        if self.on_error_callback:
            try:
                self.on_error_callback(msg)
            except:
                pass

    def preload(self):
        """Warm up PyAudio for faster first recording start."""
        sys.stderr.write("DEBUG: Preloading audio engine...\n")
        sys.stderr.flush()
        try:
            # Warm up: enumerate all devices to trigger any lazy init
            for i in range(self.p.get_device_count()):
                self.p.get_device_info_by_index(i)
        except:
            pass

    def start(self):
        sys.stderr.write(f"DEBUG: Stereo-Compatible Engine (v15.2) starting...\n")
        sys.stderr.flush()
        if self._thread and self._thread.is_alive():
            return
        self.is_listening = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self.is_listening = False
        if self._thread:
            self._thread.join(timeout=1.0)

    def _run(self):
        record_thread = threading.Thread(target=self._record_loop, daemon=True)
        record_thread.start()
        self._process_loop()
        self.is_listening = False

    def _get_best_loopback_device(self):
        """Locates the loopback/stereo mix device or uses the manually selected one.
        
        All loopback recording goes through PyAudio Stereo Mix (soundcard WASAPI 
        loopback returns silence on this system). [System Loopback] device names
        from soundcard speakers are matched to their Stereo Mix counterparts.
        """
        try:
            device_str = str(self.device_index) if self.device_index is not None else "auto"
            
            # Route [System Loopback] devices to PyAudio Stereo Mix (v1.3.0)
            # Note: VB-Cable support was removed (user request June 24)
            if "[System Loopback]" in device_str:
                speaker_name = device_str.replace(" [System Loopback]", "").strip()
                # Extract manufacturer from parentheses: "Speaker (Realtek Audio)" → "Realtek Audio"
                import re
                mfr_match = re.search(r'\(([^)]+)\)', speaker_name)
                mfr = mfr_match.group(1) if mfr_match else ""
                
                for i in range(self.p.get_device_count()):
                    try:
                        info = self.p.get_device_info_by_index(i)
                        name = info.get('name', '')
                        if info.get('maxInputChannels', 0) > 0 and 'stereo mix' in name.lower():
                            # Match by manufacturer
                            dev_mfr_match = re.search(r'\(([^)]+)\)', name)
                            dev_mfr = dev_mfr_match.group(1) if dev_mfr_match else ""
                            if mfr and mfr.lower() == dev_mfr.lower():
                                # Prefer WASAPI (higher sample rate) over MME
                                best = {"index": i, "rate": int(info.get('defaultSampleRate', 48000)), "channels": int(info.get('maxInputChannels', 2))}
                                # Check if there's a WASAPI version with higher rate
                                for j in range(self.p.get_device_count()):
                                    try:
                                        j_info = self.p.get_device_info_by_index(j)
                                        j_name = j_info.get('name', '')
                                        j_api = self.p.get_host_api_info_by_index(j_info.get('hostApi')).get('name', '')
                                        if j_info.get('maxInputChannels', 0) > 0 and j_name == name and 'wasapi' in j_api.lower():
                                            j_rate = int(j_info.get('defaultSampleRate', 48000))
                                            if j_rate > best["rate"]:
                                                best = {"index": j, "rate": j_rate, "channels": int(j_info.get('maxInputChannels', 2))}
                                                break
                                    except: pass
                                sys.stderr.write(f"DEBUG: Matched Stereo Mix \"{name}\" (index {best['index']}, {best['rate']}Hz) for \"{speaker_name}\"\n")
                                sys.stderr.flush()
                                return best
                    except: pass
                
                # Fallback: any Stereo Mix device
                for i in range(self.p.get_device_count()):
                    try:
                        info = self.p.get_device_info_by_index(i)
                        if info.get('maxInputChannels', 0) > 0 and 'stereo mix' in info.get('name', '').lower():
                            sys.stderr.write(f"DEBUG: Fallback to Stereo Mix \"{info.get('name')}\" (index {i})\n")
                            sys.stderr.flush()
                            return {
                                "index": i,
                                "channels": int(info.get('maxInputChannels', 2)),
                                "rate": int(info.get('defaultSampleRate', 48000))
                            }
                    except: pass

            # Manual device by index
            if self.device_index is not None and str(self.device_index).isdigit():
                target_idx = int(str(self.device_index))
                try:
                    info = self.p.get_device_info_by_index(target_idx)
                    if info:
                        return {
                            "index": target_idx,
                            "channels": int(info.get('maxInputChannels', 2)),
                            "rate": int(info.get('defaultSampleRate', 48000))
                        }
                except: pass

            # Manual device by name (match PyAudio device exactly)
            if self.device_index is not None:
                device_str = str(self.device_index)
                for i in range(self.p.get_device_count()):
                    try:
                        info = self.p.get_device_info_by_index(i)
                        dev_name = info.get('name', '')
                        if info.get('maxInputChannels', 0) > 0 and device_str == dev_name:
                            return {
                                "index": i,
                                "channels": int(info.get('maxInputChannels', 2)),
                                "rate": int(info.get('defaultSampleRate', 48000))
                            }
                    except: pass

            # Auto-detect: find Stereo Mix or loopback device
            for i in range(self.p.get_device_count()):
                try:
                    info = self.p.get_device_info_by_index(i)
                    name = info.get('name', '').lower()
                    if info.get('maxInputChannels', 0) > 0 and ('stereo mix' in name or 'loopback' in name):
                        return {
                            "index": i,
                            "channels": int(info.get('maxInputChannels', 2)),
                            "rate": int(info.get('defaultSampleRate', 48000))
                        }
                except: pass

            # Fallback to default input
            try:
                default = self.p.get_default_input_device_info()
                return {
                    "index": default.get('index'),
                    "channels": int(default.get('maxInputChannels', 1)),
                    "rate": int(default.get('defaultSampleRate', 44100))
                }
            except:
                return None

        except Exception as e:
            sys.stderr.write(f"DEBUG: Device detection error: {e}\n")
            sys.stderr.flush()
            return None

    def _record_loop(self):
        while self.is_listening:
            stream = None
            try:
                config = self._get_best_loopback_device()
                if not config:
                    time.sleep(1)
                    continue

                sys.stderr.write(f"DEBUG: Opening Device {config['index']} ({config['channels']}ch @ {config['rate']}Hz)...\n")
                try:
                    dev_info = self.p.get_device_info_by_index(config['index'])
                    sys.stderr.write(f"DEBUG: Selected Device Name: {dev_info.get('name')}\n")
                except: pass
                sys.stderr.flush()
                
                stream = self.p.open(
                    format=pyaudio.paFloat32,
                    channels=config['channels'],
                    rate=config['rate'],
                    input=True,
                    input_device_index=config['index'],
                    frames_per_buffer=int(config['rate'] * 0.2)
                )

                while self.is_listening:
                    try:
                        raw_data = stream.read(int(config['rate'] * 0.2), exception_on_overflow=False)
                        audio_np = np.frombuffer(raw_data, dtype=np.float32)
                        
                        # Fix Channel Mismatch in software (v15.2)
                        if config['channels'] > 1:
                            audio_np = audio_np.reshape(-1, config['channels']).mean(axis=1)
                        
                        # Push to transcription processing queue
                        self.queue.put((audio_np, config['rate']))
                    except Exception as e:
                        sys.stderr.write(f"DEBUG: Record glitch: {e}\n")
                        break
            except Exception as e:
                sys.stderr.write(f"DEBUG: Record Loop Error: {e}\n")
                time.sleep(1)
            finally:
                if stream:
                    try: stream.close()
                    except: pass

    def _process_loop(self):
        frames = []
        current_rate = 16000
        silence_start = None
        block_counter = 0
        
        while self.is_listening:
            try:
                data, rate = self.queue.get(timeout=0.5)
                current_rate = rate
                data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)
                rms = np.sqrt(np.mean(data**2))
                if not np.isfinite(rms):
                    rms = 0.0
                
                # Update dynamic current volume mapping
                self.current_volume = min(100, int((rms / 0.05) * 100))
                
                # Debug logging every 10 blocks (~2 seconds) regardless of speech presence
                block_counter += 1
                if block_counter % 10 == 0:
                    sys.stderr.write(f"DEBUG: Audio Process loop... current RMS: {rms:.6f} vs threshold: {self.energy_threshold:.6f}\n")
                    sys.stderr.flush()

                if rms > self.energy_threshold:
                    frames.append(data)
                    silence_start = None
                else:
                    if frames:
                        if silence_start is None: silence_start = time.time()
                        if time.time() - silence_start > self.silence_timeout:
                            sys.stderr.write(f"DEBUG: Silence timeout reached. Transcribing {len(frames)} frames...\n")
                            sys.stderr.flush()
                            self._transcribe(frames, current_rate)
                            frames = []
                            silence_start = None
                
                if len(frames) > 15: # Faster delivery for long speech
                    sys.stderr.write(f"DEBUG: Frame limit reached. Transcribing {len(frames)} frames...\n")
                    sys.stderr.flush()
                    self._transcribe(frames, current_rate)
                    frames = []
            except: continue

    def _transcribe(self, frames, rate):
        if not frames: 
            return
        if not self.groq_key:
            self._warn("Missing Groq API key: transcription is disabled. Go to Settings to add your API key.")
            return

        try:
            audio_data = np.concatenate(frames)
            
            # Minimum duration check — reject very short buffers (v1.3.0)
            duration_sec = len(audio_data) / rate
            if duration_sec < 0.3:
                sys.stderr.write(f"DEBUG: Audio too short ({duration_sec:.2f}s), skipping\n")
                sys.stderr.flush()
                return

            # Normalize volume if there's actual signal
            peak = np.max(np.abs(audio_data))
            rms = np.sqrt(np.mean(audio_data**2))
            sys.stderr.write(f"DEBUG: Transcribing {duration_sec:.2f}s, RMS={rms:.6f}, peak={peak:.6f}\n")
            sys.stderr.flush()
            
            if peak > 0.005:
                audio_data = audio_data / peak * 0.9

            # 1. Resample to 16000Hz with antialiasing for better Whisper accuracy (v1.3.0)
            target_rate = 16000
            if rate != target_rate:
                try:
                    # For integer ratios (e.g., 48000→16000 = 3:1), use decimation with LPF
                    if rate % target_rate == 0:
                        decimation = rate // target_rate
                        # Simple moving average LPF before decimation
                        window = np.hanning(decimation * 2 + 1)
                        window = window / window.sum()
                        audio_data = np.convolve(audio_data, window, mode='same')
                        audio_data = audio_data[decimation//2::decimation]
                    else:
                        # Non-integer ratio: linear interpolation with LPF at half Nyquist
                        cutoff = target_rate / 2 / rate
                        size = int(rate * 0.005) | 1  # ~5ms filter, odd length
                        if size > 3:
                            sinc = np.sinc(2 * cutoff * (np.arange(size) - (size - 1) / 2))
                            window = np.hanning(size)
                            lpf = sinc * window
                            lpf = lpf / lpf.sum()
                            audio_data = np.convolve(audio_data, lpf, mode='same')
                        num_samples = int(len(audio_data) * target_rate / rate)
                        audio_data = np.interp(
                            np.linspace(0, len(audio_data) - 1, num_samples),
                            np.arange(len(audio_data)),
                            audio_data
                        ).astype(np.float32)
                    rate = target_rate
                except Exception as resample_err:
                    sys.stderr.write(f"DEBUG: Resampling warning: {resample_err}\n")
                    sys.stderr.flush()

            buffer = io.BytesIO()
            sf.write(buffer, audio_data, rate, format='WAV')
            buffer.seek(0)
            
            # 2. Context-guided prompt parameter to dramatically boost technical terminology accuracy (v51.99)
            interview_prompt = (
                "Transcribe this technical software engineering interview audio. "
                "Ensure accurate transcription of programming languages and technical terms such as: "
                "React, Python, JavaScript, SQL, API, REST, JSON, HTML, CSS, Git, Docker, Kubernetes, "
                "databases, microservices, AWS, cloud, frontend, backend, stack, OOP, algorithms, "
                "data structures, system design, threads, processes."
            )

            client = Groq(api_key=self.groq_key)
            text = client.audio.transcriptions.create(
                file=("speech.wav", buffer.read()),
                model="whisper-large-v3",
                response_format="text",
                prompt=interview_prompt,
                language="en"
            ).strip()

            if text and len(text) > 3:
                sys.stderr.write(f"DEBUG: [V15.2 CLOUD] \"{text}\"\n")
                sys.stderr.flush()
                if self.on_transcript_callback:
                    self.on_transcript_callback(text, self.source_label)
        except Exception as e:
            sys.stderr.write(f"DEBUG: STT Error: {e}\n")

    @staticmethod
    def get_input_devices(pyaudio_instance=None):
        """Get all input and loopback devices."""
        own_instance = False
        if pyaudio_instance is None:
            p = pyaudio.PyAudio()
            own_instance = True
        else:
            p = pyaudio_instance

        devices = []
        seen_names = set()

        try:
            # 1. Soundcard speakers → tagged [System Loopback] (for display/enumeration only)
            try:
                import ctypes
                try:
                    ctypes.windll.ole32.CoInitialize(None)
                except: pass
                import soundcard as sc
                for spk in sc.all_speakers():
                    # Skip CABLE devices (removed by user request June 24)
                    if 'cable' in spk.name.lower() and ('vb-audio' in spk.name.lower() or 'virtual' in spk.name.lower()):
                        continue
                    display_name = f"{spk.name} [System Loopback]"
                    if display_name not in seen_names:
                        devices.append({"id": display_name, "name": display_name})
                        seen_names.add(display_name)
            except Exception as e:
                sys.stderr.write(f"DEBUG: Error scanning soundcard speakers: {e}\n")
                sys.stderr.flush()

            # 3. PyAudio input devices → [Microphone] or [Stereo Mix]
            for i in range(p.get_device_count()):
                try:
                    info = p.get_device_info_by_index(i)
                    if info.get('maxInputChannels') == 0:
                        continue
                    name = info.get('name')
                    if "wdm-ks" in p.get_host_api_info_by_index(info.get('hostApi')).get('name', '').lower():
                        continue
                    # Skip CABLE devices (removed by user request June 24)
                    if 'cable' in name.lower():
                        continue
                    # Stereo Mix is loopback, not a microphone (v1.3.0)
                    if 'stereo mix' in name.lower():
                        tag = "Stereo Mix Loopback"
                    else:
                        tag = "Microphone"
                    mic_label = f"{name} [{tag}]"
                    if mic_label not in seen_names:
                        devices.append({"id": mic_label, "name": mic_label})
                        seen_names.add(mic_label)
                except Exception:
                    pass
        finally:
            if own_instance:
                p.terminate()

        return devices

    @staticmethod
    def get_output_devices():
        p = pyaudio.PyAudio()
        devices = [{"id": str(i), "name": p.get_device_info_by_index(i).get('name')} 
                   for i in range(p.get_device_count()) 
                   if p.get_device_info_by_index(i).get('maxOutputChannels') > 0]
        p.terminate()
        return devices
