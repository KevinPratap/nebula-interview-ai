"""
Audio Duplication Pump for Nebula.
Reads audio from CABLE Output (VB-Cable) and simultaneously:
  1. Plays through a Bluetooth device so the user can hear it
  2. Pushes to the Nebula transcription pipeline

Architecture:
  App → CABLE Input → CABLE Output → [Pump] → Bluetooth Headphones
                                       └→ Nebula Pipeline (AI)
"""
import sys
import time
import threading
import queue
import numpy as np
import pyaudio


class AudioPump:
    """Reads audio blocks pushed externally and plays through Bluetooth.
    
    Does NOT open its own capture stream — relies on audio_service or another
    source to push audio blocks via push_audio(). This avoids the dual-capture
    conflict when both the service and pump try to open the same WASAPI endpoint.
    """

    def __init__(self, samplerate=48000, channels=2):
        self.samplerate = samplerate
        self.channels = channels

        self.bt_name = None                  # Soundcard speaker name for Bluetooth
        self.bt_samplerate = 48000
        self.bt_channels = 2

        self._running = False
        self._bt_player = None
        self._speaker = None                 # Cached soundcard speaker object
        self._lock = threading.Lock()

    def set_bluetooth(self, speaker_name, samplerate=48000, channels=2):
        """Set the Bluetooth playback device."""
        self.bt_name = speaker_name
        self.bt_samplerate = samplerate
        self.bt_channels = channels

    def detect_bluetooth(self):
        """Auto-detect a Bluetooth playback device from soundcard speakers.
        Returns the speaker name or None."""
        try:
            import soundcard as sc
            bt_keywords = ['bluetooth', 'headphone', 'headset', 'ear', 'bud',
                           'echo', 'rockerz', 'oneplus', 'boat', 'sounddrum']
            for s in sc.all_speakers():
                name_lower = s.name.lower()
                # Skip non-Bluetooth devices
                if any(k in name_lower for k in ['cable', 'realtek', 'steam',
                                                  'nvidia', 'omen', 'vb-audio']):
                    continue
                if any(k in name_lower for k in bt_keywords):
                    return s.name
            # If no explicit match, return the first non-cable non-realtek speaker
            for s in sc.all_speakers():
                name_lower = s.name.lower()
                if not any(k in name_lower for k in ['cable', 'realtek', 'vb-audio']):
                    return s.name
        except Exception as e:
            sys.stderr.write(f"DEBUG: Bluetooth detect error: {e}\n")
            sys.stderr.flush()
        return None

    def start(self):
        """Start the pump — continuous playback thread."""
        if self._running:
            return

        if self.bt_name is None:
            self.bt_name = self.detect_bluetooth()
            if self.bt_name:
                sys.stderr.write(f"DEBUG: AudioPump auto-detected Bluetooth: \"{self.bt_name}\"\n")
                sys.stderr.flush()
            else:
                sys.stderr.write("DEBUG: AudioPump: no Bluetooth device found\n")
                sys.stderr.flush()
                return

        # Find and cache the BT speaker
        try:
            import soundcard as sc
            for s in sc.all_speakers():
                if s.name == self.bt_name or self.bt_name.lower() in s.name.lower():
                    self._speaker = s
                    break
            if self._speaker is None:
                sys.stderr.write(f"DEBUG: AudioPump: BT speaker \"{self.bt_name}\" not found\n")
                sys.stderr.flush()
                return
        except Exception as e:
            sys.stderr.write(f"DEBUG: AudioPump: speaker lookup failed: {e}\n")
            sys.stderr.flush()
            return

        self._running = True
        self._play_queue = queue.Queue(maxsize=60)  # 60 blocks = 12s buffer
        self._play_thread = threading.Thread(target=self._play_loop, daemon=True)
        self._play_thread.start()
        # Wait a moment for the player to open
        time.sleep(0.3)
        sys.stderr.write(f"DEBUG: AudioPump started — continuous playback to \"{self.bt_name}\"\n")
        sys.stderr.flush()

    def _play_loop(self):
        """Background loop: keeps BT player open and plays queued blocks."""
        try:
            import ctypes
            ctypes.windll.ole32.CoInitialize(None)
        except:
            pass
        
        try:
            with self._speaker.player(samplerate=self.bt_samplerate, channels=self.bt_channels) as player:
                sys.stderr.write(f"DEBUG: AudioPump: BT player opened ({self.bt_samplerate}Hz, {self.bt_channels}ch)\n")
                sys.stderr.flush()
                
                while self._running or not self._play_queue.empty():
                    try:
                        audio_data = self._play_queue.get(timeout=0.5)
                        player.play(audio_data)
                    except queue.Empty:
                        continue
        except Exception as e:
            sys.stderr.write(f"DEBUG: AudioPump: player error: {e}\n")
            sys.stderr.flush()

    def push_audio(self, audio_data, samplerate):
        """Push an audio block to be played through Bluetooth.
        
        Args:
            audio_data: numpy array, mono or stereo float32
            samplerate: sample rate of the audio
        """
        if not self._running:
            return
        
        try:
            # Convert mono to stereo if needed
            if audio_data.ndim == 1 and self.bt_channels == 2:
                audio_data = np.column_stack([audio_data, audio_data])
            
            # Resample if needed
            if samplerate != self.bt_samplerate:
                audio_data = self._resample(audio_data, samplerate, self.bt_samplerate)
            
            # Push to play queue (non-blocking, drop if full)
            try:
                self._play_queue.put_nowait(audio_data)
            except queue.Full:
                pass  # Drop block if queue is full
        except Exception as e:
            sys.stderr.write(f"DEBUG: AudioPump BT glitch: {e}\n")
            sys.stderr.flush()

    def stop(self):
        """Stop the pump."""
        self._running = False
        if self._play_thread:
            self._play_thread.join(timeout=2.0)
        self._speaker = None
        self._play_thread = None
        self._play_queue = None
        sys.stderr.write("DEBUG: AudioPump stopped\n")
        sys.stderr.flush()

    def _resample(self, audio, src_rate, dst_rate):
        """Simple resample (linear interpolation)."""
        if src_rate == dst_rate:
            return audio
        num_samples = int(len(audio) * dst_rate / src_rate)
        return np.interp(
            np.linspace(0, len(audio) - 1, num_samples),
            np.arange(len(audio)),
            audio
        ).astype(np.float32)


# --- Integration helper ---
def auto_start_pump(audio_service, bluetooth_name=None):
    """Detect CABLE Output and Bluetooth, then start the audio pump.
    
    The pump does NOT open its own capture stream — audio_service's
    _record_loop feeds blocks to it via push_audio(). This avoids the
    dual-capture conflict on WASAPI endpoints.
    
    Args:
        audio_service: AudioService instance (for pipeline callback + BT feed)
        bluetooth_name: Optional Bluetooth speaker name (None = auto-detect)
    
    Returns:
        AudioPump instance if started, None otherwise
    """
    pump = AudioPump(samplerate=48000, channels=2)

    if bluetooth_name:
        pump.set_bluetooth(bluetooth_name)
    else:
        bt = pump.detect_bluetooth()
        if bt:
            pump.set_bluetooth(bt)
        else:
            sys.stderr.write("DEBUG: AudioPump: no Bluetooth device found\n")
            sys.stderr.flush()
            return None

    pump.start()
    if not pump._running:
        return None

    # Wire up the pipeline: audio_service pushes blocks to pump
    if audio_service:
        def bt_callback(audio_block, sample_rate):
            """Called from audio_service for each captured block — pushes to Bluetooth."""
            pump.push_audio(audio_block, sample_rate)
        
        audio_service._pump_callback = bt_callback
        sys.stderr.write(f"DEBUG: AudioPump wired to audio_service callback\n")
        sys.stderr.flush()

    sys.stderr.write(f"DEBUG: AudioPump started — BT=\"{pump.bt_name}\"\n")
    sys.stderr.flush()
    return pump
