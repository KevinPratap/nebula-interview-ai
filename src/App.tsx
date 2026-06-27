import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Settings,
  User,
  Zap,
  Globe,
  Terminal,
  Copy,
  Check,
  X,
  Mic,
  Play,
  Pause,
  Upload,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Send,
  Monitor,
  Eye,
  EyeOff,
  ClipboardList,
  Minimize2,
  History
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import './App.css'
import Tooltip from './components/Tooltip'

declare global {
  interface Window {
    electron: any;
  }
}

type DrawerMode = 'response' | 'account' | 'settings' | 'strategy' | 'chat' | 'history' | 'notes';

const springGentle: any = { type: "spring", stiffness: 300, damping: 30 };

const pillVariants = {
  hidden: { opacity: 0, scale: 0.9, y: 10 },
  visible: {
    opacity: 1, scale: 1, y: 0,
    transition: springGentle
  },
  exit: { opacity: 0, scale: 0.9, y: 5, transition: { duration: 0.2 } }
};

interface StarContent {
  situation: string;
  task: string;
  action: string;
  result: string;
}

function parseStarResponse(text: string): StarContent {
  const getTag = (tag: string) => {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)(?:</${tag}>|$)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
  };
  return {
    situation: getTag('situation'),
    task: getTag('task'),
    action: getTag('action'),
    result: getTag('result')
  };
}

function BehavioralStarPanel({ text }: { text: string }) {
  const parsed = parseStarResponse(text);
  const [activeTab, setActiveTab] = useState<'S' | 'T' | 'A' | 'R'>('S');
  
  const steps = [
    { key: 'S' as const, label: 'SITUATION', content: parsed.situation, tips: 'Set the context: company, team, and problem.' },
    { key: 'T' as const, label: 'TASK', content: parsed.task, tips: 'State the challenge: expectations, goals, and responsibilities.' },
    { key: 'A' as const, label: 'ACTION', content: parsed.action, tips: 'Describe the details: what did you do, how, and why?' },
    { key: 'R' as const, label: 'RESULT', content: parsed.result, tips: 'Highlight the outcome: metrics, learnings, and success.' }
  ];

  const currentStep = steps.find(s => s.key === activeTab)!;

  useEffect(() => {
    if (parsed.result && activeTab !== 'R') {
      setActiveTab('R');
    } else if (parsed.action && !parsed.result && activeTab !== 'A') {
      setActiveTab('A');
    } else if (parsed.task && !parsed.action && activeTab !== 'T') {
      setActiveTab('T');
    } else if (parsed.situation && !parsed.task && activeTab !== 'S') {
      setActiveTab('S');
    }
  }, [parsed.situation, parsed.task, parsed.action, parsed.result]);

  return (
    <div className="star-panel no-drag">
      <nav className="star-progress-bar" aria-label="STAR steps">
        {steps.map(step => (
          <button 
            key={step.key} 
            className={`star-step-btn ${activeTab === step.key ? 'active' : ''} ${step.content ? 'has-content' : ''}`}
            onClick={() => setActiveTab(step.key)}
            type="button"
          >
            <span className="step-badge">{step.key}</span>
            <span className="step-label">{step.label}</span>
          </button>
        ))}
      </nav>
      
      <section className="star-content-card">
        <header className="star-header">
          <h4>{currentStep.label} PHASE</h4>
          <span className="star-tips">{currentStep.tips}</span>
        </header>
        <div className="star-body">
          {currentStep.content ? (
            <p className="star-text">{currentStep.content}</p>
          ) : (
            <div className="star-placeholder">Waiting for stream chunk...</div>
          )}
        </div>
      </section>
    </div>
  );
}

function CodingAssistantPanel({ responseText }: { responseText: string }) {
  const [selectedLang, setSelectedLang] = useState<'python' | 'javascript' | 'cpp'>('python');

  const codeBlocks: { lang: string; code: string }[] = [];
  const regex = /```(\w*)\n([\s\S]*?)(?:```|$)/g;
  let match;
  while ((match = regex.exec(responseText)) !== null) {
    codeBlocks.push({
      lang: match[1].toLowerCase(),
      code: match[2].trim()
    });
  }
  
  const getCodeForLang = (lang: string) => {
    const direct = codeBlocks.find(b => b.lang === lang || (lang === 'cpp' && b.lang === 'c++'));
    if (direct) return direct.code;
    if (codeBlocks.length > 0) return codeBlocks[0].code;
    return '';
  };

  const currentCode = getCodeForLang(selectedLang);
  const explanation = responseText.replace(/```[\s\S]*?```/g, '').trim();

  return (
    <div className="coding-assistant-panel no-drag">
      <div className="assistant-tabs-header no-drag">
        {(['python', 'javascript', 'cpp'] as const).map(lang => (
          <button 
            key={lang}
            className={`tab-btn no-drag ${selectedLang === lang ? 'active' : ''}`}
            onClick={() => setSelectedLang(lang)}
            type="button"
          >
            {lang === 'cpp' ? 'C++' : lang.charAt(0).toUpperCase() + lang.slice(1)}
          </button>
        ))}
      </div>

      <div className="code-display-section">
        {currentCode ? (
          <CodeBlock code={currentCode} lang={selectedLang} />
        ) : (
          <div className="code-placeholder">Generating code solution...</div>
        )}
      </div>

      {explanation && (
        <div className="explanation-section">
          <h3>Explanation</h3>
          <ResponseRenderer text={explanation} />
        </div>
      )}
    </div>
  );
}

function App() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('response')
  const [isLive, setIsLive] = useState(false)
  const [status, setStatus] = useState("v1.2.1 OSS")
  const [isError, setIsError] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [platform, setPlatform] = useState<string>('win32')

  const [transcript, setTranscript] = useState("")
  const [aiResponse, setAiResponse] = useState("")
  const [history, setHistory] = useState<{ id: number, q: string, a: string, strategy: string }[]>([])
  const [ossMode, setOssMode] = useState(false)
  const [contextText, setContextText] = useState("")
  const [detectedStrategy, setDetectedStrategy] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [audioDevices, setAudioDevices] = useState<{ id: string, name: string }[]>([])
  const [outputDevices, setOutputDevices] = useState<{ id: string, name: string }[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const [updateInfo, setUpdateInfo] = useState<any>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState("")
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [linkedFilesCount, setLinkedFilesCount] = useState(0)
  const [snapshotsCount, setSnapshotsCount] = useState(0)

  // Meeting Notes state
  const [sessionStatus, setSessionStatus] = useState<any>({ entries: 0, questions: 0, duration_seconds: 0, is_active: false, last_saved: '' })
  const [savedNotes, setSavedNotes] = useState<any[]>([])

  const [availableModels, setAvailableModels] = useState<{ [provider: string]: string[] }>({})
  const [modelSelections, setModelSelections] = useState<{ [provider: string]: string }>({})
  const [modelDefaults, setModelDefaults] = useState<{ [provider: string]: string }>({})

  const [settingsTab, setSettingsTab] = useState<'General' | 'Display' | 'Hotkeys' | 'Updates' | 'API Keys'>('General')

  const chatInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Toast notification system (v1.3.0)
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: 'error' | 'success' | 'info' }[]>([])
  const toastIdRef = useRef(0)
  const showToast = useCallback((msg: string, type: 'error' | 'success' | 'info' = 'info') => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, msg, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3500)
  }, [])

  // Sidecar connection health (v1.3.0)
  const [sidecarConnected, setSidecarConnected] = useState(true)
  const sidecarConnectedRef = useRef(true) // Ref to avoid stale closures
  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-focus Chat Input (v1.1.8)
  useEffect(() => {
    if (drawerOpen && drawerMode === 'chat') {
      // Small timeout to ensure AnimatePresence mount
      const t = setTimeout(() => {
        chatInputRef.current?.focus();
      }, 150);
      return () => clearTimeout(t);
    }
  }, [drawerOpen, drawerMode]);

  const [settings, setSettings] = useState<any>({
    stealth_mode: false,
    save_transcripts: false,
    text_size: 15,
    low_credit_alert: true,
    session_end_warning: true,
    autoload_resume: false,
    show_guide_startup: true,
    light_mode: false,
    opacity: 255,
    hotkey: 'F2',
    hotkey_manual: 'Alt+Z',
    hotkey_chat: 'Alt+C',
    hotkey_strategy: 'Alt+S',
    hotkey_settings: 'Alt+,',
    hotkey_history: 'Alt+H',
    hotkey_retry: 'Alt+R',
    expert_mode: 'Standard assistant',
    audio_device_id: null,
    output_device_id: null,
    show_tooltips: true,
    hotkey_screen: 'Alt+X',
    hotkey_close: 'Alt+W'
  })

  const [apiKeys, setApiKeys] = useState<{ groq: string; openai: string; gemini: string; anthropic: string; deepseek: string; openrouter: string }>({ groq: '', openai: '', gemini: '', anthropic: '', deepseek: '', openrouter: '' })
  const [visibleApiKeys, setVisibleApiKeys] = useState<{ groq: boolean; openai: boolean; gemini: boolean; anthropic: boolean; deepseek: boolean; openrouter: boolean }>({ groq: false, openai: false, gemini: false, anthropic: false, deepseek: false, openrouter: false })
  const apiKeyTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const isAuthorized = true;

  useEffect(() => {
    const subs: (() => void)[] = [];
    if (!window.electron) return;

    window.electron?.ipcRenderer.invoke('get-platform').then((p: string) => setPlatform(p));

    // Request initial context count (v51.53)
    window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'get-context-count' });
    setStatus("Connecting...");
    
    // Listen for sidecar ready event (v1.3.0)
    subs.push(window.electron?.ipcRenderer.on('ready-received', (p: any) => {
      console.log("UI: Sidecar Ready:", p);
      setStatus("Nebula Ready");
      setSidecarConnected(true);
      sidecarConnectedRef.current = true;
      showToast("Sidecar connected", 'success');
    }));

    subs.push(window.electron?.ipcRenderer.on('status-received', (s: any) => {
      console.log("UI: Status Message:", s.msg, "IsError:", s.is_error);
      if (s.msg) {
        setStatus(s.msg);
        if (s.is_error) {
          setIsError(true);
          setIsThinking(false);
        } else {
          setIsError(false);
        }
      }
    }));

    subs.push(window.electron?.ipcRenderer.on('error-received', (e: any) => {
      console.error("UI: Error Received:", e.msg);
      setIsThinking(false);
      setIsError(true);
      // Show toast for visible errors (v1.3.0)
      if (e.msg) {
        showToast(e.msg, 'error');
      }
      if (e.msg && (e.msg.includes("429") || e.msg.includes("Quota"))) {
        setStatus("QUOTA EXCEEDED (Wait 60s)");
      } else if (e.msg && e.msg.includes("Connection Lost")) {
        setStatus("CONNECTION LOST");
        setSidecarConnected(false);
      } else {
        setStatus(e.msg ? `ERROR: ${e.msg}` : "Error");
      }
    }));
    subs.push(window.electron?.ipcRenderer.on('transcript-received', (t: any) => {
      console.log("UI: Transcription Received:", t.text);
      if (t.text && t.text.trim() !== "") {
        setTranscript(t.text);
      }
    }));

    subs.push(window.electron?.ipcRenderer.on('live-transcript-received', (p: any) => {
      console.log("UI: Live Transcript Received:", p.text);
      if (p.text) {
        setLiveTranscript(prev => {
          const combined = (prev + " " + p.text).trim();
          // Keep only last 100 chars for the live bubble
          return combined.length > 100 ? "..." + combined.slice(-100) : combined;
        });

        // Auto-clear after 3 seconds of silence
        if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
        liveTimerRef.current = setTimeout(() => {
          setLiveTranscript("");
        }, 3000);
      }
    }));

    subs.push(window.electron?.ipcRenderer.on('context-update-received', (p: any) => {
      console.log("UI: Context Update received:", p.count);
      setSnapshotsCount(p.count);
    }));

    subs.push(window.electron?.ipcRenderer.on('context-count-received', (p: any) => {
      console.log("UI: Context Count received from Sidecar:", p.count);
      setLinkedFilesCount(p.count);
    }));

    subs.push(window.electron?.ipcRenderer.on('resume-parsed-received', (_: any) => {
      console.log("UI: Resume Parsed (Background Sync Complete)");
      // No longer updating contextText here to keep interview notes clean
    }));

    subs.push(window.electron?.ipcRenderer.on('context-fetched-received', (p: any) => {
      console.log("UI: Context Fetched Received (Length:", p.text?.length, ")");
      setContextText(p.text);
    }));

    subs.push(window.electron?.ipcRenderer.on('ai-response-received', (p: any) => {
      console.log("UI: AI Response Received (Length:", p.text?.length, ")");
      setAiResponse(p.text);
      setIsThinking(false);

      // Update History Stack FIRST (v20.0 Persistent Buttons)
      if (p.text && p.trigger_question) {
        setHistory(prev => {
          // Prevent exact duplicate questions stacking
          if (prev.length > 0 && prev[prev.length - 1].q === p.trigger_question) return prev;
          const newHistory = [...prev, { id: Date.now(), q: p.trigger_question, a: p.text, strategy: p.strategy || "Standard" }];
          console.log("UI: History Stack Updated. Size:", newHistory.length);
          return newHistory.slice(-50); // Keep maximum 50 pills
        });
      }

      // Clear transcript LAST to ensure seamless hand-off
      setTranscript("");

      if (p.strategy) {
        setDetectedStrategy(p.strategy);
        if (p.provider) setStatus(`AI: ${p.provider} OK`);
      }
      setDrawerMode('response');
      setDrawerOpen(true);
    }));

    subs.push(window.electron?.ipcRenderer.on('ai-chunk-received', (p: any) => {
      console.log("UI: AI Chunk Received:", p.text, "IsStart:", p.is_start);
      if (p.is_start) {
        setAiResponse(""); 
        setIsThinking(true);
      } else if (p.text) {
        setAiResponse(prev => prev + p.text);
        setIsThinking(false);
      }
      if (p.strategy) setDetectedStrategy(p.strategy);
      setDrawerOpen(true);
      setDrawerMode('response');
    }));



    // Global Debug Helper for User
    (window as any).nebulaTestAI = () => {
      console.log("UI: Executing Global console test...");
      window.electron?.ipcRenderer.send('send-to-sidecar', {
        action: 'fake-transcript',
        payload: 'Global Console Test: Respond with "HELLO FROM BRAIN".'
      });
    };
    subs.push(window.electron?.ipcRenderer.on('audio-devices-data-received', (p: any) => setAudioDevices(p)));
    subs.push(window.electron?.ipcRenderer.on('output-devices-data-received', (p: any) => setOutputDevices(p)));
    subs.push(window.electron?.ipcRenderer.on('output-device-updated-received', (p: any) => {
      console.log('Output device updated:', p?.name);
    }));
    subs.push(window.electron?.ipcRenderer.on('settings-data-received', (p: any) => {
      setSettings(p);
      // Extract model selections from settings
      const models: { [key: string]: string } = {};
      for (const key of Object.keys(p)) {
        if (key.startsWith('model_')) {
          models[key.replace('model_', '')] = p[key];
        }
      }
      if (Object.keys(models).length > 0) {
        setModelSelections(prev => ({ ...prev, ...models }));
      }
      window.electron?.ipcRenderer.send('update-stealth', p.stealth_mode);
      window.electron?.ipcRenderer.send('set-opacity', p.opacity);
      window.electron?.ipcRenderer.send('re-register-hotkey', p);
    }));
    subs.push(window.electron?.ipcRenderer.on('api-keys-received', (p: any) => {
      setApiKeys({ groq: p.groq || '', openai: p.openai || '', gemini: p.gemini || '', anthropic: p.anthropic || '', deepseek: p.deepseek || '', openrouter: p.openrouter || '' });
    }));
    subs.push(window.electron?.ipcRenderer.on('available-models-received', (p: any) => {
      if (p.models) {
        setAvailableModels(p.models);
      }
      if (p.defaults) {
        setModelDefaults(p.defaults);
        // Also initialize modelSelections from defaults if not already set
        setModelSelections(prev => {
          const next = { ...prev };
          for (const [prov, model] of Object.entries(p.defaults) as [string, string][]) {
            if (!next[prov]) next[prov] = model;
          }
          return next;
        });
      }
    }));
    subs.push(window.electron?.ipcRenderer.on('hotkey-triggered', () => {
      console.log("UI: [IPC] hotkey-triggered received");
      setIsLive(prev => {
        const ns = !prev;
        window.electron?.ipcRenderer.send('toggle-listening', ns);
        // Visual feedback on status
        setStatus(ns ? "NEBULA: LISTENING..." : "NEBULA: STANDBY");
        return ns;
      });
    }));

    subs.push(window.electron?.ipcRenderer.on('registration-report', (reports: any[]) => {
      console.log("UI: [DIAGNOSTIC] Hotkey Registration Report:", reports);
      const failed = reports.filter(r => !r.success);
      if (failed.length > 0) {
        console.error("UI: Failed hotkeys:", failed);
        setStatus(`REGISTRATION FAILED: ${failed[0].key}`);
        setIsError(true);
      } else {
        console.log("UI: All hotkeys registered successfully");
        setStatus("HOTKEYS SYNCED");
        setIsError(false);
      }
    }));

    window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'get-settings' });
    window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'get-audio-devices' });
    window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'get-output-devices' });
    window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'get-api-keys' });
    window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'get-available-models' });

    // Auto-update audio devices whenever OS recognizes hardware device changes (v51.92)
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      const handleDeviceChange = () => {
        console.log("UI: OS audio device configuration changed, refreshing sidecar list...");
        window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'get-audio-devices' });
        window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'get-output-devices' });
      };
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
      subs.push(() => {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      });
    }

    // Set initial ignore state: Pass transparency but keep tracking
    window.electron?.ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });

    // Sidecar health check — poll every 5 seconds (v1.3.0)
    let healthCheckCount = 0;
    const checkHealth = async () => {
      let cancelled = false;
      try {
        const health = await window.electron?.ipcRenderer.invoke('check-sidecar-health');
        if (cancelled) return;
        if (health && !health.alive) {
          setSidecarConnected(false);
          sidecarConnectedRef.current = false;
        } else if (health && health.alive) {
          if (!sidecarConnectedRef.current) {
            showToast('Sidecar reconnected', 'success');
          }
          setSidecarConnected(true);
          sidecarConnectedRef.current = true;
        }
        healthCheckCount = 0;
      } catch (e) {
        healthCheckCount++;
        if (healthCheckCount >= 3) {
          setSidecarConnected(false);
          sidecarConnectedRef.current = false;
        }
      }
    };
    healthCheckRef.current = setInterval(checkHealth, 5000);
    checkHealth(); // initial check
    // Also check on any status or error received
    subs.push(() => {
      if (healthCheckRef.current) clearInterval(healthCheckRef.current);
    });

    subs.push(window.electron?.ipcRenderer.on('toggle-stealth', (enabled: boolean) => {
      setSettings((prev: any) => ({ ...prev, stealth_mode: enabled }));
    }));

    // --- Update Callbacks (v51.35) ---
    subs.push(window.electron?.ipcRenderer.on('update-status', (msg: string) => {
      console.log("UI: Update Status:", msg);
      setUpdateStatus(msg);
    }));

    subs.push(window.electron?.ipcRenderer.on('update-available', (info: any) => {
      setUpdateInfo(info);
    }));

    subs.push(window.electron?.ipcRenderer.on('update-ready', () => {
      setUpdateReady(true);
      setUpdateStatus("RESTART REQUIRED");
    }));

    // Meeting Notes IPC listeners
    subs.push(window.electron?.ipcRenderer.on('session-status', (s: any) => {
      console.log("UI: Session status:", s);
      setSessionStatus(s);
    }));
    subs.push(window.electron?.ipcRenderer.on('saved-notes', (notes: any[]) => {
      console.log("UI: Saved notes:", notes?.length || 0);
      setSavedNotes(notes || []);
    }));
    subs.push(window.electron?.ipcRenderer.on('notes-ready', (result: any) => {
      console.log("UI: Meeting notes ready:", result);
      if (result?.path) {
        setStatus(`Notes saved: ${result.path.split(/[/\\]/).pop()}`);
      }
      window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'get-saved-notes' });
    }));

    subs.push(window.electron?.ipcRenderer.on('hotkey-action', (action: string) => {
      console.log(`UI: [IPC] hotkey-action received: ${action}`);
      switch (action) {
        case 'trigger-manual':
          toggleDrawer('response'); // Open to show response
          window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'trigger-ai' });
          setStatus("NEBULA: TRIGGERING MANUAL...");
          break;
        case 'toggle-chat':
          toggleDrawer('chat');
          break;
        case 'toggle-strategy':
          toggleDrawer('strategy');
          break;
        case 'toggle-settings':
          toggleDrawer('settings');
          break;
        case 'toggle-history':
          toggleDrawer('history');
          break;
        case 'trigger-retry':
          window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'trigger-ai' });
          setStatus("NEBULA: RETRYING...");
          toggleDrawer('response');
          break;
        case 'trigger-scan':
          handleScreenAnalysis();
          break;
        case 'trigger-close-drawer':
          setDrawerOpen(false);
          break;
      }
    }));

    // Local Escape listener for drawers
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
      }
      // Ctrl+C: copy last response when drawer is open
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && drawerOpen && aiResponse) {
        navigator.clipboard.writeText(aiResponse).catch(() => {});
      }
      if (e.altKey && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        handleScreenAnalysis();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      subs.forEach(s => s()); // Cleanup all IPC listeners v1.1.14
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.altKey) {
        e.preventDefault();
        setSettings((prev: any) => {
          const step = 15;
          let newOpacity = (prev.opacity || 255) - Math.sign(e.deltaY) * step;
          newOpacity = Math.max(25, Math.min(255, newOpacity));
          window.electron?.ipcRenderer.send('set-opacity', newOpacity);
          window.electron?.ipcRenderer.send('send-to-sidecar', {
            action: 'update-setting',
            payload: { key: 'opacity', val: newOpacity }
          });
          return { ...prev, opacity: newOpacity };
        });
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const updateSetting = (key: string, val: any) => {
    setSettings((prev: any) => {
      const next = { ...prev, [key]: val };
      window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'update-setting', payload: { key, val } });
      if (key === 'stealth_mode') window.electron?.ipcRenderer.send('update-stealth', val);
      if (key === 'opacity') window.electron?.ipcRenderer.send('set-opacity', val);
      if (key.startsWith('hotkey')) {
        console.log(`UI: Re-registering hotkeys with updated ${key}=${val}`);
        window.electron?.ipcRenderer.send('re-register-hotkey', next);
      }
      return next;
    });
  };
  const toggleDrawer = (mode: DrawerMode) => {
    if (drawerOpen && drawerMode === mode) {
      setDrawerOpen(false);
    } else {
      setDrawerMode(mode);
      setDrawerOpen(true);
    }
  };

  const handleManualTrigger = () => {
    if (!isAuthorized || !isLive || !transcript.trim()) return;
    window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'trigger-ai' });
    setStatus("NEBULA: TRIGGERING MANUAL...");
  };

  const handleScreenAnalysis = () => {
    if (!isAuthorized) {
      toggleDrawer('account');
      return;
    }
    // Open response drawer to show vision results
    setDrawerMode('response');
    setDrawerOpen(true);
    setIsThinking(true);
    setAiResponse('');
    window.electron?.ipcRenderer.send('send-to-sidecar', { 
      action: 'analyze-screen', 
      payload: { question: "Scan the provided screen(s) for a coding/technical problem. Provide a complete implementation, detailed explanation, and complexity analysis." } 
    });
    setStatus("AI: SCANNING SCREEN...");
  };


  const handleClearSnapshots = () => {
    window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'clear-snapshots' });
    setStatus("SNAPSHOTS CLEARED");
  };

  const handleMicClick = () => {
    const ns = !isLive;
    setIsLive(ns);
    window.electron?.ipcRenderer.send('toggle-listening', ns);
  };

  const handleLockedClick = (mode: DrawerMode) => {
    toggleDrawer(mode);
  };

  useEffect(() => {
    window.electron?.ipcRenderer.send('set-drawer-status', drawerOpen);
    // Explicitly report resize when drawer toggles — ensures the Electron
    // window resizes reliably even before the ResizeObserver fires the first time.
    requestAnimationFrame(() => {
      if (containerRef.current) {
        const h = Math.ceil(containerRef.current.getBoundingClientRect().height) + 120;
        window.electron?.ipcRenderer.send('resize-window', { height: h });
      }
    });
  }, [drawerOpen]);

  useEffect(() => {
    const isActive = !!(transcript || liveTranscript || history.length > 0);
    window.electron?.ipcRenderer.send('set-subpill-status', isActive);
  }, [transcript, liveTranscript, history]);

  // Dynamic Resizing Logic (v1.2.0)
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        // We add much larger buffer room (120px) for tooltips and safety (v1.2.7)
        const height = Math.ceil(entry.contentRect.height) + 120;
        window.electron?.ipcRenderer.send('resize-window', { height });
        window.electron?.ipcRenderer.send('sync-hit-zones', { height: entry.contentRect.height });
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [drawerOpen]);

  return (
    <div 
      ref={containerRef}
      className={`app-container platform-${platform === 'darwin' ? 'mac' : 'win'} ${settings.light_mode ? 'light-mode' : ''} ${settings.stealth_mode ? 'stealth-active' : ''}`}
    >

      {/* Sidecar disconnect banner (v1.3.0) */}
      <AnimatePresence>
        {!sidecarConnected && (
          <motion.div
            className="disconnect-banner"
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <div className="disconnect-banner-dot" />
            <span>BACKEND DISCONNECTED — Restarting Nebula or check Python sidecar</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast notification container (v1.3.0) */}
      <div className="toast-container">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              className={`toast-item toast-${t.type}`}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <div className={`toast-icon ${t.type}`}>
                {t.type === 'error' ? '!' : t.type === 'success' ? '✓' : 'i'}
              </div>
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Main Pill — always centered */}
      <motion.div
        layout
        className="floating-pill pill-active"
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={springGentle}
      >
        <div className="pill-content">
          <div className="pill-left">
            <Tooltip disabled={!settings.show_tooltips} label="About" description="Nebula Interview AI — Open Source Edition. No cloud account needed." position="bottom" delay={0.6}>
              <button className="icon-circle no-drag" onClick={() => toggleDrawer('account')}>
                <User size={18} />
              </button>
            </Tooltip>
            <div className={`status-indicator ${isError ? 'error' : (isLive ? 'pulse' : '')}`} />
            <div className="brand-title">
              NEBULA <span className={`brand-status ${isError ? 'error-text' : ''}`}>// {status}</span>
            </div>
          </div>

          <div className="pill-right">

            {/* Zone 1: Preparation (Contextual) */}
            <Tooltip disabled={!settings.show_tooltips} label="Intelligence Strategy" description="Adjust AI behavior, upload resumes, or provide custom job context." position="bottom" delay={0.2} shortcut={settings.hotkey_strategy}>
              <button
                className={`icon-circle no-drag ${drawerMode === 'strategy' && drawerOpen ? 'btn-accent' : ''}`}
                onClick={() => handleLockedClick('strategy')}
              >
                <Terminal size={18} />
              </button>
            </Tooltip>

            <Tooltip disabled={!settings.show_tooltips} label="History" description="Browse past questions and answers." position="bottom" delay={0.2} shortcut={settings.hotkey_history}>
              <button
                className={`icon-circle no-drag ${drawerMode === 'history' && drawerOpen ? 'btn-accent' : ''}`}
                onClick={() => handleLockedClick('history')}
              >
                <History size={18} />
              </button>
            </Tooltip>

            <Tooltip disabled={!settings.show_tooltips} label="Meeting Notes" description="View transcript, save sessions, and generate AI meeting summaries." position="bottom" delay={0.2}>
              <button
                className={`icon-circle no-drag ${drawerMode === 'notes' && drawerOpen ? 'btn-accent' : ''}`}
                onClick={() => {
                  window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'get-session-status' });
                  window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'get-saved-notes' });
                  toggleDrawer('notes');
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <line x1="10" y1="9" x2="8" y2="9"/>
                </svg>
              </button>
            </Tooltip>

            <Tooltip disabled={!settings.show_tooltips} label="Direct Chat" description="Open the chat interface to manually query Nebula or clarify previous responses." position="bottom" delay={0.2} shortcut={settings.hotkey_chat}>
              <button
                className={`icon-circle no-drag ${drawerMode === 'chat' && drawerOpen ? 'btn-accent' : ''}`}
                onClick={() => handleLockedClick('chat')}
              >
                <MessageSquare size={18} />
              </button>
            </Tooltip>

            <div className="pill-divider" />

            {/* Zone 2: Live Action (Primary Execution) */}
            <div className="snapshot-group no-drag">
              <Tooltip 
                disabled={!settings.show_tooltips} 
                label={snapshotsCount > 0 ? `Smart Scan (${snapshotsCount})` : "Screen Scan"} 
                description={snapshotsCount > 0 ? "Analyzing cumulative scrolling context. Click to refine." : "Capture and analyze current screen content."} 
                position="bottom" 
                delay={0.2} 
                shortcut={settings.hotkey_screen}
              >
                <button
                  className={`icon-circle ${snapshotsCount > 0 ? 'btn-accent' : ''}`}
                  onClick={handleScreenAnalysis}
                >
                  <div style={{ position: 'relative' }}>
                    <Monitor size={18} />
                    {snapshotsCount > 0 && <div className="snapshot-badge">{snapshotsCount}</div>}
                  </div>
                </button>
              </Tooltip>

              {snapshotsCount > 0 && (
                <Tooltip disabled={!settings.show_tooltips} label="Reset" description="Clear cumulative screen context and start fresh." position="bottom" delay={0.2}>
                  <button className="icon-circle btn-clear" onClick={handleClearSnapshots}>
                    <X size={14} />
                  </button>
                </Tooltip>
              )}
            </div>

            <Tooltip disabled={!settings.show_tooltips} label={isLive ? "Pause" : "Start"} description={isLive ? "Stop listening and deactivate Nebula." : "Activate Nebula to begin listening and analyzing."} position="bottom" delay={0.2} shortcut={settings.hotkey}>
              <button
                className={`icon-circle no-drag btn-master ${!isLive ? 'pulse-ready' : ''} ${isLive ? 'btn-accent' : ''}`}
                onClick={handleMicClick}
              >
                {isLive ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
              </button>
            </Tooltip>

            <Tooltip disabled={!settings.show_tooltips} label="MANUAL ANSWER" description="Force Nebula to generate a response based on the current context now." position="bottom" delay={0.2} shortcut={settings.hotkey_manual}>
              <button
                className="icon-circle no-drag answer-icon-btn"
                onClick={handleManualTrigger}
              >
                <Zap size={18} fill="currentColor" />
              </button>
            </Tooltip>

            <div className="pill-divider" />

            {/* Zone 3: App & System (Meta) */}
            <Tooltip disabled={!settings.show_tooltips} label="Settings" description="Configure screen protection, hotkeys, and display preferences." position="bottom" delay={0.2} shortcut={settings.hotkey_settings}>
              <button
                className={`icon-circle no-drag ${drawerMode === 'settings' && drawerOpen ? 'btn-accent' : ''}`}
                onClick={() => toggleDrawer('settings')}
              >
                <Settings size={18} />
              </button>
            </Tooltip>

            <Tooltip disabled={!settings.show_tooltips} label="Hide" description="Minimize Nebula to system tray. It keeps running in the background." position="bottom" delay={0.6}>
              <button className="icon-circle no-drag" onClick={() => window.electron?.ipcRenderer.send('minimize-window')}>
                <Minimize2 size={18} />
              </button>
            </Tooltip>
          </div>
        </div>
      </motion.div>

      {/* Multi-Pill Breadcrumbs (v19.0) */}
      <AnimatePresence>
        {(transcript || history.length > 0) && (
          <motion.div
            key="pill-stack-root"
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="sub-pill-stack"
            style={{ zIndex: 10 }}
          >
            {liveTranscript && (
              <motion.div
                key="live-transcript"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="sub-pill-item live-transcript-pill no-drag"
              >
                <div className="live-transcript-dot" />
                <span className="sub-pill-label">HEARING</span>
                <span className="sub-pill-text">{liveTranscript}</span>
              </motion.div>
            )}
            {history.slice(-1).map((item) => {
              // Extract core question for display (concise v20.9)
              const extractCoreQuestion = (text: string) => {
                if (!text) return "";
                // Filter out common filler words and keep only the core command/question
                let clean = text.replace(/NEW\s+/i, '').replace(/[?*]/g, '').trim();

                // For the button, show up to 5 words for better context v26.2
                const words = clean.split(/\s+/);
                if (words.length <= 5) return clean;
                return words.slice(0, 5).join(' ') + '...';
              };

              return (
                <motion.div
                    layout="position"
                    key={`hist-${item.id}`}
                  className="sub-pill-item breadcrumb no-drag"
                  style={{ cursor: 'default' }}
                  variants={pillVariants}
                  onClick={() => {
                    console.log("UI: History Pill Clicked. Opening Drawer.");
                    if (!isAuthorized) {
                      toggleDrawer('account');
                      return;
                    }
                    setAiResponse(item.a);
                    setDetectedStrategy(item.strategy);
                    setDrawerMode('response');
                    setDrawerOpen(true);
                  }}
                >
                  <div className="sub-pill-text">{extractCoreQuestion(item.q)}</div>
                </motion.div>
              );
            })}

            {transcript && (
              <motion.div
                layout
                key="active-transcript-pill"
                className="sub-pill-item active-transcript no-drag"
                style={{ cursor: 'default' }}
                variants={pillVariants}
                whileHover={{ scale: 1.02, backgroundColor: 'rgba(60, 60, 60, 0.5)', borderColor: 'var(--accent-primary)' }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  console.log("UI: Active Pill Clicked. Opening Drawer.");
                  if (!isAuthorized) {
                    toggleDrawer('account');
                    return;
                  }
                  setDrawerMode('response');
                  setDrawerOpen(true);
                }}
              >
                <div className="sub-pill-text">{transcript}</div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            key="drawer-panel-root"
            layout="position" /* 'position' only — prevents height animation jank during streaming */
            className="drawer-container"
            initial={{ y: -20, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -20, opacity: 0, scale: 0.98 }}
            transition={springGentle}
          >
            <Tooltip disabled={!settings.show_tooltips} label="Close Drawer" shortcut={settings.hotkey_close} position="bottom">
              <button
                className="drawer-close-btn no-drag"
                onClick={() => setDrawerOpen(false)}
              >
                <ChevronUp size={20} />
              </button>
            </Tooltip>
            <AnimatePresence mode="wait">
              {/* Account */}
              {drawerMode === 'account' && (
                <motion.div
                  key="account-view"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="view-content"
                >
                  <div className="view-header">
                    <h2><span className="header-slash">//</span> ABOUT</h2>
                  </div>
                  <div className="auth-panel" style={{ padding: '24px', textAlign: 'center' }}>
                    <p style={{ fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>
                      Nebula Interview AI — Open Source Edition
                    </p>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                      v1.2.1
                    </p>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                      MIT License
                    </p>
                    <p style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                      Works fully offline. Set API keys via environment variables (GROQ_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY).
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Strategy — gated */}
              {drawerMode === 'strategy' && (
                <motion.div
                  key="strategy-view"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="view-content"
                  style={{ maxHeight: '600px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                >
                  <div className="view-header">
                    <h2><span className="header-slash">//</span> STRATEGY</h2>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <Tooltip disabled={!settings.show_tooltips} label="Upload Resume" description="Parse your resume (PDF/Word) to provide the AI with your professional background." position="bottom" delay={0.3}>
                        <button className="btn-strategy-action" onClick={async () => {
                          const results = await window.electron?.ipcRenderer.invoke('open-file-dialog');
                          if (results && Array.isArray(results)) {
                            results.forEach(res => {
                              window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'parse-file', payload: res.path });
                            });
                          }
                        }}>
                          <Upload size={14} /> <span>Resume {linkedFilesCount > 0 ? `(${linkedFilesCount})` : ""}</span>
                        </button>
                      </Tooltip>
                      <Tooltip disabled={!settings.show_tooltips} label="Fetch URL" description="Provide a job description or company page URL for Nebula to analyze." position="bottom" delay={0.3}>
                        <button className="btn-strategy-action" onClick={() => {
                          console.log("UI: Strategy URL Button clicked");
                          const url = prompt("Website URL:");
                          console.log("UI: Prompt URL received:", url);
                          if (url) {
                            window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'fetch-context', payload: url });
                          }
                        }}>
                          <Globe size={14} /> <span>URL</span>
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '0 8px' }}>
                    <div>
                      <span className="card-label">Answer Style</span>
                      <SegmentedControl
                        options={['Auto', 'Standard', 'Coding', 'Systems', 'Behavioral']}
                        value={
                          settings.expert_mode === 'Auto' ? 'Auto' :
                            settings.expert_mode === 'Standard assistant' ? 'Standard' :
                              settings.expert_mode === 'Coding interview' ? 'Coding' :
                                settings.expert_mode === 'System design' ? 'Systems' : 'Behavioral'
                        }
                        onChange={(v) => {
                          const mapping: Record<string, string> = {
                            'Auto': 'Auto',
                            'Standard': 'Standard assistant',
                            'Coding': 'Coding interview',
                            'Systems': 'System design',
                            'Behavioral': 'Behavioral (Soft skills)'
                          };
                          updateSetting('expert_mode', mapping[v]);
                          if (v !== 'Auto') setDetectedStrategy(null);
                        }}
                      />
                      {settings.expert_mode === 'Auto' && detectedStrategy && (
                        <div className="auto-strategy-badge">
                          <span className="auto-strategy-dot" />
                          Auto-selected: <strong>{detectedStrategy}</strong>
                        </div>
                      )}
                    </div>
                    <textarea
                      className="context-textarea no-drag"
                      placeholder="Paste Job Description, Company Info, or your specific Interview Notes here... Nebula will prioritize this context for your answers."
                      value={contextText}
                      onChange={(e) => setContextText(e.target.value)}
                    />
                    <Tooltip disabled={!settings.show_tooltips} label="Sync Context" description="Apply the pasted text or uploaded files to the current AI session." position="bottom" delay={0.1}>
                      <button className="btn-strategy-sync no-drag" onClick={() => {
                        window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'update-context', payload: contextText });
                        setDrawerOpen(false); // Fix: Dismiss drawer on manual sync v30.5
                      }}>
                        Sync Interview Context
                      </button>
                    </Tooltip>
                  </div>
                </motion.div>
              )}

              {/* Settings */}
              {drawerMode === 'history' && (
                <motion.div
                  key="history-view"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="view-content"
                  style={{ maxHeight: '500px', display: 'flex', flexDirection: 'column' }}
                >
                  <div className="view-header" style={{ marginBottom: '16px' }}>
                    <h2><span className="header-slash">//</span> HISTORY</h2>
                  </div>
                  <div style={{ padding: '0 8px', flex: 1, overflowY: 'auto' }}>
                    {history.length === 0 ? (
                      <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0', fontSize: '13px' }}>
                        No conversation history yet. Questions and answers will appear here.
                      </div>
                    ) : (
                      [...history].reverse().map((item) => (
                        <div
                          key={item.id}
                          className="sub-pill-item breadcrumb no-drag"
                          style={{ cursor: 'pointer', marginBottom: '8px', padding: '12px' }}
                          onClick={() => {
                            setAiResponse(item.a);
                            setDetectedStrategy(item.strategy);
                            setDrawerMode('response');
                          }}
                        >
                          <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '4px', color: 'var(--accent-primary)' }}>
                            Q: {item.q.length > 80 ? item.q.slice(0, 80) + '...' : item.q}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', opacity: 0.8 }}>
                            {item.a.length > 120 ? item.a.slice(0, 120) + '...' : item.a}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-secondary)', opacity: 0.5, marginTop: '4px' }}>
                            {item.strategy} · {new Date(item.id).toLocaleTimeString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              )}

              {/* Meeting Notes */}
              {drawerMode === 'notes' && (
                <motion.div
                  key="notes-view"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="view-content"
                  style={{ maxHeight: '500px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                >
                  <div className="view-header">
                    <h2><span className="header-slash">//</span> MEETING NOTES</h2>
                  </div>

                  <div className="scroll-y" style={{ flex: 1, padding: '0 8px' }}>
                    {/* Session status bar */}
                    <div className="setting-card" style={{ marginBottom: '12px', padding: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>SESSION</span>
                        <span style={{ fontSize: '12px', color: sessionStatus.is_active ? 'var(--accent-primary)' : 'var(--text-dim)' }}>
                          {sessionStatus.is_active ? 'LIVE' : 'IDLE'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
                        <span><strong>{sessionStatus.entries}</strong> utterances</span>
                        <span><strong>{sessionStatus.questions}</strong> questions</span>
                        <span><strong>{Math.floor(sessionStatus.duration_seconds / 60)}m {sessionStatus.duration_seconds % 60}s</strong></span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      <button className="btn-strategy-action" style={{ flex: 1, justifyContent: 'center' }}
                        onClick={() => window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'start-session', payload: 'Live Session' })}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '4px' }}><circle cx="12" cy="12" r="8"/></svg> Start
                      </button>
                      <button className="btn-strategy-action" style={{ flex: 1, justifyContent: 'center' }}
                        onClick={() => window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'save-session' })}
                        disabled={!sessionStatus.entries}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save
                      </button>
                      <button className="btn-strategy-action" style={{ flex: 1, justifyContent: 'center' }}
                        onClick={() => {
                          const title = prompt('Session title:', 'Interview');
                          window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'generate-meeting-notes', payload: title || 'Session' });
                        }}
                        disabled={!sessionStatus.entries}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Notes
                      </button>
                    </div>

                    {/* Utility buttons */}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      <button className="btn-strategy-action" style={{ flex: 1, justifyContent: 'center', opacity: 0.6 }}
                        onClick={() => { if (confirm('Clear current transcript?')) window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'clear-transcript' }); }}
                        disabled={!sessionStatus.entries}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Clear
                      </button>
                      <button className="btn-strategy-action" style={{ flex: 1, justifyContent: 'center' }}
                        onClick={() => window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'get-saved-notes' })}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Refresh
                      </button>
                    </div>

                    {/* Saved notes list */}
                    <div className="settings-section">
                      <h3>SAVED NOTES</h3>
                      <div className="setting-card">
                        {savedNotes.length === 0 ? (
                          <div style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-dim)' }}>
                            No saved notes yet. Start a session and save it.
                          </div>
                        ) : (
                          savedNotes.slice(0, 10).map((note: any, idx: number) => (
                            <div key={idx} className="setting-row"
                              style={{ cursor: 'pointer', borderBottom: idx < savedNotes.length - 1 ? '1px solid var(--border-color)' : 'none' }}
                              onClick={() => setStatus(`Notes: ${note.filename}`)}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                                <span style={{ fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {note.filename}
                                </span>
                                <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
                                  {new Date(note.modified).toLocaleString()} · {(note.size / 1024).toFixed(1)}KB
                                </span>
                              </div>
                              {(note.filename.includes('summary') || note.filename.includes('enhanced')) && (
                                <span style={{ fontSize: '10px', color: 'var(--accent-primary)', marginLeft: '8px' }}>AI</span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {drawerMode === 'settings' && (
                <motion.div
                  key="settings-view"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="view-content"
                  style={{ maxHeight: '500px', display: 'flex', flexDirection: 'column' }}
                >
                  <div className="view-header" style={{ marginBottom: '16px' }}>
                    <h2><span className="header-slash">//</span> SETTINGS</h2>
                  </div>

                  <div style={{ padding: '0 8px 16px 8px' }}>
                    <SegmentedControl
                      options={['General', 'Display', 'Hotkeys', 'Updates', 'API Keys']}
                      value={settingsTab}
                      onChange={(v) => setSettingsTab(v)}
                    />
                  </div>

                  <div className="scroll-y" style={{ flex: 1, padding: '0 8px' }}>
                    <AnimatePresence mode="wait">
                      {settingsTab === 'General' && (
                        <motion.div
                          key="tab-general"
                          initial={{ opacity: 0, x: 5 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -5 }}
                          transition={{ duration: 0.15 }}
                        >
                          <div className="settings-section">
                            <h3>PRIVACY</h3>
                            <div className="setting-card">
                              <Tooltip disabled={!settings.show_tooltips} label="Screen Protection" description="Protect your privacy by hiding the Nebula window from screenshots and screen sharing." position="bottom" delay={0.3}>
                                <div className="setting-row" onClick={() => updateSetting('stealth_mode', !settings.stealth_mode)}>
                                  <span>Screen Protection</span>
                                  <Toggle checked={settings.stealth_mode} onChange={(v) => updateSetting('stealth_mode', v)} />
                                </div>
                              </Tooltip>
                              <Tooltip disabled={!settings.show_tooltips} label="Save Transcripts" description="Store your interview transcripts locally for future review and reference." position="bottom" delay={0.3}>
                                <div className="setting-row" onClick={() => updateSetting('save_transcripts', !settings.save_transcripts)}>
                                  <span>Save Transcripts</span>
                                  <Toggle checked={settings.save_transcripts} onChange={(v) => updateSetting('save_transcripts', v)} />
                                </div>
                              </Tooltip>
                              <Tooltip disabled={!settings.show_tooltips} label="Low Credit Alert" description="Receive a notification when your credit balance drops below 2 hours." position="bottom" delay={0.3}>
                                <div className="setting-row" onClick={() => updateSetting('low_credit_alert', !settings.low_credit_alert)}>
                                  <span>Low Credit Alert</span>
                                  <Toggle checked={settings.low_credit_alert} onChange={(v) => updateSetting('low_credit_alert', v)} />
                                </div>
                              </Tooltip>
                              <Tooltip disabled={!settings.show_tooltips} label="Session End Warning" description="Get a warning alert 5 minutes before your active session expires." position="bottom" delay={0.3}>
                                <div className="setting-row" onClick={() => updateSetting('session_end_warning', !settings.session_end_warning)}>
                                  <span>Session End Warning</span>
                                  <Toggle checked={settings.session_end_warning} onChange={(v) => updateSetting('session_end_warning', v)} />
                                </div>
                              </Tooltip>
                            </div>
                          </div>
                          

                          <div className="settings-section">
                            <h3>AUDIO</h3>
                            <div className="setting-card">
                              <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                                <span>Listen From</span>
                                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 4px 0', fontWeight: 600 }}>Select the device Nebula should listen to.</p>
                                <PremiumDropdown
                                  options={audioDevices}
                                  value={settings.audio_device_id}
                                  onChange={(v) => updateSetting('audio_device_id', v)}
                                  placeholder="Default (Auto-detect Loopback)"
                                />
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {settingsTab === 'Display' && (
                        <motion.div
                          key="tab-display"
                          initial={{ opacity: 0, x: 5 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -5 }}
                          transition={{ duration: 0.15 }}
                        >
                          <div className="settings-section">
                            <h3>VISUALS</h3>
                            <div className="setting-card">
                              <Tooltip disabled={!settings.show_tooltips} label="Font Size" description="Adjust the text size for better readability of AI responses." position="bottom" delay={0.3}>
                                <div className="setting-row">
                                  <span>Font Size</span>
                                    <PremiumStepper
                                      value={settings.text_size}
                                      onChange={(v) => updateSetting('text_size', v)}
                                      min={12}
                                      max={32}
                                      step={2}
                                      unit="px"
                                    />
                                </div>
                              </Tooltip>
                              <Tooltip disabled={!settings.show_tooltips} label="Opacity" description="Change the transparency level of the Nebula interface." position="bottom" delay={0.3}>
                                <div className="setting-row">
                                  <span>Opacity</span>
                                  <input
                                    type="range"
                                    className="no-drag"
                                    min="50" max="255"
                                    value={settings.opacity}
                                    onChange={(e) => updateSetting('opacity', parseInt(e.target.value))}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </div>
                              </Tooltip>
                              <Tooltip disabled={!settings.show_tooltips} label="Light Mode" description="Switch between dark and light themes for the interface." position="bottom" delay={0.3}>
                                <div className="setting-row" onClick={() => updateSetting('light_mode', !settings.light_mode)}>
                                  <span>Light Mode</span>
                                  <Toggle checked={settings.light_mode} onChange={(v) => updateSetting('light_mode', v)} />
                                </div>
                              </Tooltip>
                              <Tooltip disabled={!settings.show_tooltips} label="Show Tooltips" description="Enable or disable help tooltips across the application." position="bottom" delay={0.3}>
                                <div className="setting-row" onClick={() => updateSetting('show_tooltips', !settings.show_tooltips)}>
                                  <span>Show Tooltips</span>
                                  <Toggle checked={settings.show_tooltips} onChange={(v) => updateSetting('show_tooltips', v)} />
                                </div>
                              </Tooltip>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {settingsTab === 'Hotkeys' && (
                        <motion.div
                          key="tab-hotkeys"
                          initial={{ opacity: 0, x: 5 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -5 }}
                          transition={{ duration: 0.15 }}
                        >
                          <div className="settings-section">
                            <h3>SHORTCUTS</h3>
                            <div className="setting-card">
                              <div className="setting-row">
                                <span>Activation</span>
                                <HotkeyRecorder
                                  value={settings.hotkey}
                                  onChange={(v) => updateSetting('hotkey', v)}
                                />
                              </div>
                              <div className="setting-row">
                                <span>Manual Analyze</span>
                                <HotkeyRecorder
                                  value={settings.hotkey_manual}
                                  onChange={(v) => updateSetting('hotkey_manual', v)}
                                />
                              </div>
                              <div className="setting-row">
                                <span>Toggle Chat</span>
                                <HotkeyRecorder
                                  value={settings.hotkey_chat}
                                  onChange={(v) => updateSetting('hotkey_chat', v)}
                                />
                              </div>
                              <div className="setting-row">
                                <span>Toggle Strategy</span>
                                <HotkeyRecorder
                                  value={settings.hotkey_strategy}
                                  onChange={(v) => updateSetting('hotkey_strategy', v)}
                                />
                              </div>
                              <div className="setting-row">
                                <span>Scan Screen</span>
                                <HotkeyRecorder
                                  value={settings.hotkey_screen}
                                  onChange={(v) => updateSetting('hotkey_screen', v)}
                                />
                              </div>
                              <div className="setting-row">
                                <span>Toggle Settings</span>
                                <HotkeyRecorder
                                  value={settings.hotkey_settings}
                                  onChange={(v) => updateSetting('hotkey_settings', v)}
                                />
                              </div>
                              <div className="setting-row">
                                <span>Close Drawer</span>
                                <HotkeyRecorder
                                  value={settings.hotkey_close}
                                  onChange={(v) => updateSetting('hotkey_close', v)}
                                />
                              </div>
                              <div className="setting-row">
                                <span>Toggle History</span>
                                <HotkeyRecorder
                                  value={settings.hotkey_history}
                                  onChange={(v) => updateSetting('hotkey_history', v)}
                                />
                              </div>
                              <div className="setting-row">
                                <span>Retry Answer</span>
                                <HotkeyRecorder
                                  value={settings.hotkey_retry}
                                  onChange={(v) => updateSetting('hotkey_retry', v)}
                                />
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {settingsTab === 'Updates' && (
                        <motion.div
                          key="tab-updates"
                          initial={{ opacity: 0, x: 5 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -5 }}
                          transition={{ duration: 0.15 }}
                        >
                          <div className="settings-section">
                            <h3>UPDATE CENTER</h3>
                            <div className="setting-card">
                              <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                  <span>Software Version</span>
                                  <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>v1.2.0</span>
                                </div>
                                {updateStatus && (
                                  <p style={{ fontSize: '11px', color: 'var(--accent-primary)', margin: '4px 0 0 0', fontWeight: 700 }}>
                                    {updateStatus}
                                  </p>
                                )}
                                {updateInfo && !updateReady && (
                                  <div style={{ marginTop: '8px', width: '100%' }}>
                                    <button
                                      className="btn-premium btn-accent full-width no-drag"
                                      onClick={() => window.electron?.ipcRenderer.invoke('download-update')}
                                    >
                                      START DOWNLOAD (v{updateInfo.version})
                                    </button>
                                  </div>
                                )}
                                {updateReady && (
                                  <div style={{ marginTop: '8px', width: '100%' }}>
                                    <button
                                      className="btn-premium btn-accent full-width no-drag"
                                      onClick={() => window.electron?.ipcRenderer.send('quit-and-install')}
                                    >
                                      RESTART & INSTALL
                                    </button>
                                  </div>
                                )}
                                {!updateInfo && !updateReady && (
                                  <div style={{ marginTop: '8px', width: '100%' }}>
                                    <button
                                      className="btn-premium full-width no-drag"
                                      onClick={() => window.electron?.ipcRenderer.invoke('check-for-updates')}
                                    >
                                      CHECK FOR UPDATES
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {settingsTab === 'API Keys' && (
                        <motion.div
                          key="tab-api-keys"
                          initial={{ opacity: 0, x: 5 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -5 }}
                          transition={{ duration: 0.15 }}
                        >
                          <div className="settings-section">
                            <h3>PROVIDER KEYS</h3>
                            <div className="setting-card">
                              {([
                                { key: 'groq', label: 'Groq', placeholder: 'gsk_...' },
                                { key: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
                                { key: 'gemini', label: 'Gemini', placeholder: 'AI...' },
                                { key: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
                                { key: 'deepseek', label: 'DeepSeek', placeholder: 'sk-...' },
                                { key: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-...' },
                              ] as const).map(prov => (
                                <div key={prov.key}>
                                  <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                                    <span>{prov.label} API Key</span>
                                    <div style={{ display: 'flex', width: '100%', gap: '8px', alignItems: 'center' }}>
                                      <input
                                        type={visibleApiKeys[prov.key] ? 'text' : 'password'}
                                        className="api-key-input no-drag"
                                        placeholder={prov.placeholder}
                                        value={apiKeys[prov.key]}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setApiKeys(prev => ({ ...prev, [prov.key]: val }));
                                          // Debounce IPC send to avoid per-keystroke transmission (v1.3.0)
                                          if (apiKeyTimers.current[prov.key]) clearTimeout(apiKeyTimers.current[prov.key]);
                                          apiKeyTimers.current[prov.key] = setTimeout(() => {
                                            window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'update-api-keys', payload: { [prov.key]: val } });
                                          }, 400);
                                        }}
                                      />
                                      <button
                                        className="icon-circle no-drag"
                                        onClick={() => setVisibleApiKeys(prev => ({ ...prev, [prov.key]: !prev[prov.key] }))}
                                        style={{ flexShrink: 0 }}
                                        type="button"
                                      >
                                        {visibleApiKeys[prov.key] ? <EyeOff size={16} /> : <Eye size={16} />}
                                      </button>
                                    </div>
                                  </div>
                                  {(apiKeys as any)[prov.key] && (availableModels as any)[prov.key] && (availableModels as any)[prov.key].length > 0 && (
                                    <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px', paddingLeft: '8px', marginTop: '-4px', marginBottom: '8px' }}>
                                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Model</span>
                                      <select
                                        className="api-model-select no-drag"
                                        value={(modelSelections as any)[prov.key] || (modelDefaults as any)[prov.key] || ''}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setModelSelections(prev => ({ ...prev, [prov.key]: val }));
                                          window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'update-model', payload: { provider: prov.key, model: val } });
                                        }}
                                      >
                                        {(availableModels as any)[prov.key].map((m: string) => (
                                          <option key={m} value={m}>{m}</option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}

              {/* Direct Chat Input View (v1.1.7) */}
              {drawerMode === 'chat' && (
                <motion.div
                  key="chat-view"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="drawer-view-mask"
                >
                  <div className="view-content chat-drawer-content">
                    <div className="view-header">
                      <h2><span className="header-slash">//</span> NEBULA CHAT</h2>
                    </div>

                    <div className="chat-prompt-area centered-chat">
                      <div className="chat-luxury-header">
                        <h1>How can I help you?</h1>
                        <p>Assistant powered by Nebula Intelligence</p>
                      </div>
                    </div>

                    <div className={`chat-input-wrapper no-drag ${!isAuthorized ? 'locked' : ''}`}>
                      <input
                        type="text"
                        ref={chatInputRef}
                        className="chat-input"
                        placeholder="Type your question..."
                        value={chatInput}
                        disabled={!isAuthorized}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && chatInput.trim() && isAuthorized) {
                            setAiResponse('');
                            setDrawerMode('response'); // Transition to response view v1.1.7
                            window.electron?.ipcRenderer.send('send-to-sidecar', {
                              action: 'fake-transcript',
                              payload: chatInput.trim()
                            });
                            // v51.6: Manually trigger AI for Chat Enter even if auto_answer is off
                            window.electron?.ipcRenderer.send('send-to-sidecar', { action: 'trigger-ai' });
                            setIsThinking(true);
                            setChatInput('');
                          }
                        }}
                      />
                      <button
                        className="chat-send-btn"
                        disabled={!isAuthorized || !chatInput.trim()}
                        onClick={() => {
                          if (chatInput.trim() && isAuthorized) {
                            setAiResponse('');
                            setDrawerMode('response'); // Transition to response view v1.1.7
                            window.electron?.ipcRenderer.send('send-to-sidecar', {
                              action: 'fake-transcript',
                              payload: chatInput.trim()
                            });
                            setIsThinking(true);
                            setChatInput('');
                          }
                        }}
                      >
                        <Send size={16} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Response Stream (Answers Only v18.0) */}
              {drawerMode === 'response' && (
                <motion.div
                  key="response-view"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="drawer-view-mask"
                >
                  <div className="view-content response-drawer-content">
                    {/* Content Area */}
                    <div className="response-content-area">
                      {aiResponse ? (
                        <>
                          {detectedStrategy === 'Behavioral (Soft skills)' ? (
                            <BehavioralStarPanel text={aiResponse} />
                          ) : detectedStrategy === 'Coding interview' ? (
                            <CodingAssistantPanel responseText={aiResponse} />
                          ) : (
                            <ResponseRenderer text={aiResponse} />
                          )}
                          {/* Copy button at bottom of response — no clip with close button */}
                          <ResponseCopyActions text={aiResponse} />
                        </>
                      ) : isThinking ? (
                        <div className="thinking-placeholder">
                          <div className="thinking-dots">
                            <div className="thinking-dot" />
                            <div className="thinking-dot" />
                            <div className="thinking-dot" />
                          </div>
                          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.3px' }}>Nebula is responding...</span>
                        </div>
                      ) : (
                        <div className="thinking-placeholder" style={{ opacity: 0.5 }}>
                          <MessageSquare size={18} />
                          <span style={{ fontSize: '14px', fontWeight: 500 }}>Ask me anything...</span>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div >
        )
        }
      </AnimatePresence >

      {/* Onboarding */}
      <AnimatePresence>
        {
          showOnboarding && (
            <motion.div
              className="onboarding-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowOnboarding(false)}
            >
              <motion.div
                className="onboarding-content"
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
              >
                <img src="/logo.png" alt="Nebula Logo" style={{ width: '120px', height: '120px', marginBottom: '16px', filter: 'drop-shadow(0 0 20px var(--accent-primary))' }} />
                <h1>NEBULA</h1>
                <p style={{ fontSize: '16px', color: 'var(--text-secondary)' }}>Real-time AI interview intelligence.</p>
                <div className="guide-grid">
                  <div className="guide-item">
                    <Terminal size={28} color="var(--accent-primary)" />
                    <strong>STRATEGY</strong>
                    <span style={{ fontSize: '12px', opacity: 0.7 }}>Set your context for tailored answers.</span>
                  </div>
                  <div className="guide-item">
                    <Mic size={28} color="var(--accent-primary)" />
                    <strong>LISTEN</strong>
                    <span style={{ fontSize: '12px', opacity: 0.7 }}>Tap mic or press hotkey to start.</span>
                  </div>
                  <div className="guide-item">
                    <Zap size={28} color="var(--accent-primary)" />
                    <strong>ANSWER</strong>
                    <span style={{ fontSize: '12px', opacity: 0.7 }}>Nebula responds in real-time.</span>
                  </div>
                </div>
                <div className="dismiss-hint" style={{ marginTop: '40px' }}>TAP ANYWHERE TO CLOSE</div>
              </motion.div>
            </motion.div>
          )
        }
      </AnimatePresence >
    </div >
  )
}

// Response copy-all action bar (v1.3.0)
function ResponseCopyActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopyAll = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="response-actions-bar no-drag">
      <button
        className={`copy-all-btn ${copied ? 'copied' : ''}`}
        onClick={handleCopyAll}
        type="button"
      >
        {copied ? <Check size={12} /> : <ClipboardList size={12} />}
        {copied ? 'COPIED' : 'COPY ANSWER'}
      </button>
    </div>
  );
}

function CodeBlock({ code, lang }: { code: string, lang: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-container no-drag">
      <div className="code-header">
        <span className="code-lang">{lang || 'code'}</span>
        <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'COPIED' : 'COPY CODE'}
        </button>
      </div>
      <pre className="code-content">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ResponseRenderer({ text }: { text: string }) {
  // Split by code blocks first
  const blocks = text.split(/(```[\s\S]*?```)/g);

  const renderFormattedText = (line: string) => {
    // Bold parsing: **text**
    const parts = line.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} style={{ color: 'var(--accent-primary)', fontWeight: 900 }}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  const renderLine = (line: string, index: number) => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // 1. Headers (### Section)
    if (trimmed.startsWith('###')) {
      return (
        <h3 key={index} className="response-section-header">
          {renderFormattedText(trimmed.replace(/^###\s*/, ''))}
        </h3>
      );
    }

    // 2. Complexity Cards (detecting Time Complexity: O(N))
    if (trimmed.toLowerCase().includes('complexity:') || (trimmed.toLowerCase().includes('complexity') && trimmed.includes('O('))) {
      const title = trimmed.split(':')[0] || 'Complexity';
      const value = trimmed.split(':')[1] || trimmed;
      return (
        <div key={index} className="complexity-card">
          <span className="complexity-title">{title}</span>
          <span className="complexity-value">{renderFormattedText(value)}</span>
        </div>
      );
    }

    // 3. Lists (Bullets - item)
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      return (
        <div key={index} className="response-list-item">
          <span className="list-bullet">•</span>
          <span className="list-content">{renderFormattedText(trimmed.substring(2))}</span>
        </div>
      );
    }

    // 4. Numbered Lists (1. Item)
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      return (
        <div key={index} className="response-list-item">
          <span className="list-number">{numMatch[1]}</span>
          <span className="list-content">{renderFormattedText(numMatch[2])}</span>
        </div>
      );
    }

    // 5. Default Paragraph
    return (
      <p key={index} className="response-paragraph">
        {renderFormattedText(line)}
      </p>
    );
  };

  return (
    <div className="response-renderer">
      {blocks.map((block, i) => {
        if (block.startsWith('```')) {
          const match = block.match(/```(\w*)\n?([\s\S]*?)```/);
          if (match) {
            return <CodeBlock key={i} lang={match[1]} code={match[2].trim()} />;
          }
        }

        // Process non-code lines
        return (
          <div key={i} className="text-block">
            {block.split('\n').map((line, j) => renderLine(line, j))}
          </div>
        );
      })}
    </div>
  );
}

function PremiumStepper({ value, onChange, min, max, step = 1, unit = "" }: { value: number, onChange: (v: number) => void, min: number, max: number, step?: number, unit?: string }) {
  return (
    <div className="premium-stepper no-drag">
      <button 
        className="stepper-btn" 
        disabled={value <= min}
        onClick={(e) => { e.stopPropagation(); onChange(Math.max(min, value - step)); }}
      >
        <ChevronLeft size={16} />
      </button>
      <div className="stepper-value">
        {value}<span className="stepper-unit">{unit}</span>
      </div>
      <button 
        className="stepper-btn" 
        disabled={value >= max}
        onClick={(e) => { e.stopPropagation(); onChange(Math.min(max, value + step)); }}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function SegmentedControl({ options, value, onChange, className = "" }: { options: string[], value: any, onChange: (v: any) => void, className?: string }) {
  return (
    <div className={`segmented-control no-drag ${className}`}>
      {options.map(opt => (
        <div
          key={opt}
          className={`segment-item ${value === opt ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onChange(opt); }}
        >
          {opt}
        </div>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean, onChange: (v: boolean) => void }) {
  return (
    <div className={`switch ${checked ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(!checked); }}>
      <motion.div
        className="handle"
        layout
        transition={{ type: "spring", stiffness: 700, damping: 40 }}
      />
    </div>
  )
}

function HotkeyRecorder({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Skip lone modifiers
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('CmdOrCtrl');

      // Map special keys to Electron format
      let key = e.key;
      if (key.length === 1) {
        key = key.toUpperCase();
      } else {
        // Special mapping for Electron accelerators
        if (key === ' ') key = 'Space';
        else if (key === 'ArrowUp') key = 'Up';
        else if (key === 'ArrowDown') key = 'Down';
        else if (key === 'ArrowLeft') key = 'Left';
        else if (key === 'ArrowRight') key = 'Right';
        else if (key === 'Escape') {
          setIsRecording(false);
          return;
        } else if (key === 'Delete') key = 'Delete';
        else if (key === 'Backspace') key = 'Backspace';
      }

      parts.push(key);
      const accelerator = parts.join('+');
      console.log(`HotkeyRecorder: Result=${accelerator}`);
      onChange(accelerator);
      setIsRecording(false);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecording, onChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <div
        className={`hotkey-recorder no-drag ${isRecording ? 'recording' : ''}`}
        onClick={() => setIsRecording(!isRecording)}
      >
        {isRecording ? 'Recording...' : (value || 'NONE')}
      </div>
      {isRecording && <span className="recording-hint">Press keys or ESC to cancel</span>}
    </div>
  );
}

function PremiumDropdown({ options, value, onChange, placeholder }: { options: { id: string, name: string }[], value: any, onChange: (v: any) => void, placeholder: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find(o => o.id === value);

  return (
    <div className="premium-dropdown-container no-drag">
      <div className={`premium-dropdown-header ${isOpen ? 'open' : ''}`} 
           style={{ padding: '10px 14px', minHeight: '42px' }}
           onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}>
        <span className="dropdown-label" style={{ fontSize: '12px', fontWeight: 600 }}>{selected ? selected.name : placeholder}</span>
        <ChevronUp
          style={{
            transform: isOpen ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 0.08s cubic-bezier(0.23, 1, 0.32, 1)',
            opacity: 0.6
          }}
          size={16}
        />
      </div>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="premium-dropdown-list"
          >
            <div
              className={`premium-dropdown-item ${!value ? 'active' : ''}`}
              onClick={() => { onChange(null); setIsOpen(false); }}
            >
              Default (Auto)
            </div>
            {options.map(opt => (
              <div
                key={opt.id}
                className={`premium-dropdown-item ${value === opt.id ? 'active' : ''}`}
                onClick={() => { onChange(opt.id); setIsOpen(false); }}
              >
                {opt.name}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App
