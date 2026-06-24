<p align="center">
  <img src="public/logo.png" width="120" height="120" alt="Nebula Logo" style="border-radius: 24px;">
</p>

<h1 align="center">Nebula Interview AI</h1>

<p align="center">
  <b>Real-time AI interview copilot that listens, transcribes, and helps you answer.</b><br>
  100% offline · Open Source · No subscription · Your own API keys
</p>

<p align="center">
  <a href="https://github.com/KevinPratap/nebula-interview-ai/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License">
  </a>
  <img src="https://img.shields.io/badge/AI_Providers-6-brightgreen" alt="6 AI Providers">
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey" alt="Windows">
  <img src="https://img.shields.io/github/stars/KevinPratap/nebula-interview-ai?style=social" alt="Stars">
</p>

---

## ✨ What is Nebula?

Nebula is a **privacy-first, offline AI interview assistant** that sits as a sleek floating overlay on your screen. It:

- **🎤 Listens** to your interview (via system audio loopback)
- **📝 Transcribes** in real-time using Groq Whisper
- **🧠 Generates answers** via 6 AI providers
- **🔒 Never phones home** — all AI runs through YOUR API keys
- **🪟 Stays on top** — frameless, transparent overlay that doesn't get in your way

> **No subscriptions. No cloud dependency. No data leaving your machine.**

---

## 🚀 Quick Start

### Prerequisites
- **[Node.js](https://nodejs.org/)** 18+
- **Python 3.10+** (for the audio engine sidecar)
- **Windows** (Stereo Mix loopback required for audio capture)

### One-command setup

```bash
git clone https://github.com/KevinPratap/nebula-interview-ai.git
cd nebula-interview-ai
npm install
python -m venv .venv && .venv\Scripts\pip install -r requirements-sidecar.txt
npm run dev
```

### Set your API keys

Nebula needs at least one AI provider key. Set as environment variables:

```bash
set GROQ_API_KEY=gsk_your_key_here    # Best for transcription + fast responses
set GEMINI_API_KEY=AIza...             # Google's Gemini (free tier available)
set OPENAI_API_KEY=sk-...              # OpenAI GPT-4
set ANTHROPIC_API_KEY=sk-ant-...       # Claude Sonnet 4 (pip install anthropic)
set DEEPSEEK_API_KEY=sk-...            # DeepSeek Chat
set OPENROUTER_API_KEY=sk-or-...       # OpenRouter gateway
```

Or set them **inside the app** via **Settings > API Keys** with show/hide toggles.

---

## 🧠 AI Providers

Nebula auto-falls through providers if one fails:

| # | Provider | Model Options | Key Required |
|---|----------|--------------|--------------|
| 1 | **Groq** | llama-3.3-70b, mixtral, gemma2 | `GROQ_API_KEY` |
| 2 | **Gemini** | gemini-2.5-flash, gemini-2.5-pro | `GEMINI_API_KEY` |
| 3 | **OpenAI** | gpt-4o, gpt-4o-mini, gpt-4-turbo | `OPENAI_API_KEY` |
| 4 | **Claude** | claude-sonnet-4, claude-3-haiku | `ANTHROPIC_API_KEY` |
| 5 | **DeepSeek** | deepseek-chat, deepseek-reasoner | `DEEPSEEK_API_KEY` |
| 6 | **OpenRouter** | Any model ID (free-text) | `OPENROUTER_API_KEY` |

You can **select which model** to use for each provider directly from the settings panel.

---

## 🎯 Features

| Feature | Status |
|---------|--------|
| 🎙️ Real-time audio transcription (Whisper) | ✅ |
| 🤖 AI answer generation (6 providers) | ✅ |
| 🖥️ Screen analysis for coding problems | ✅ |
| 📄 Resume parsing + job context | ✅ |
| 🔑 In-app API key management | ✅ |
| 🎨 Model selection per provider | ✅ |
| 🧩 Strategy profiles (Auto/Standard/Coding/Systems/Behavioral) | ✅ |
| 🔇 Stealth mode (screen protection) | ✅ |
| ⌨️ Fully customizable hotkeys | ✅ |
| 🌙 Dark/Light theme | ✅ |
| 💾 Local transcript saving | ✅ |

---

## 🏗️ Architecture

```
┌──────────────────────┐     WebSocket      ┌──────────────────────┐
│   Electron (UI)      │ ◄────────────────► │  Python Sidecar      │
│   React + TypeScript │     ws://8765      │  Audio → Whisper → AI│
│   Frameless Overlay  │                    │  Settings Manager    │
└──────────────────────┘                    └──────────────────────┘
```

- **Frontend**: React/TypeScript, frameless Electron window, always-on-top overlay
- **Backend**: Python sidecar with system audio loopback capture
- **Communication**: Local WebSocket on `127.0.0.1:8765`
- **Storage**: Local JSON settings (no database, no cloud)

---

## 📸 Screenshots

<!-- Add screenshots here -->
<details>
<summary>Click to see the UI</summary>

*The floating pill overlay — compact, always-on-top, transparent*<br>
*(Add a screenshot image here)*

*The settings drawer with API key management*<br>
*(Add a screenshot image here)*
</details>

---

## 🆚 Nebula OSS vs Nebula Pro

| Feature | OSS (this repo) | Pro |
|---------|----------------|-----|
| Price | **Free** | Commercial |
| License | **MIT** | MIT |
| AI Providers | **6** | 6+ |
| Offline mode | ✅ | ✅ |
| Cloud sync | ❌ | ✅ |
| Team features | ❌ | ✅ |
| Priority support | ❌ | ✅ |
| Auto-updates | ❌ | ✅ |

**→ [Nebula Pro](https://github.com/KevinPratap/nebula-pro) for cloud sync + priority support**

---

## 🛠️ Development

```bash
# Start Vite dev server
npx vite

# In another terminal, start Electron (loads from Vite in dev mode)
npx electron .

# Build production dist
npx vite build
npx electron .

# Package for distribution
npx electron-builder --win
```

---

## 🤝 Contributing

PRs welcome! Big things on the roadmap:

- [ ] macOS/Linux audio support
- [ ] Local LLM support (Ollama/Llama.cpp)
- [ ] Multi-language transcription
- [ ] Interview question bank
- [ ] Voice activity detection improvements

---

## 📬 Contact

Built by [Kevin Pratap Sidhu](https://github.com/KevinPratap)

- **Questions?** Open a GitHub issue
- **Contributions?** Fork + PR
- **Business inquiries?** Regarding Nebula Pro

---

<p align="center">
  <sub>Built with ❤️ for developers who interview. MIT Licensed.</sub>
</p>
