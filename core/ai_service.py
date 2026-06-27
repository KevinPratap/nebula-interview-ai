import os
import sys
import io
import json
import base64
import requests
import threading
import PIL.Image
import pytesseract
from groq import Groq
try:
    from anthropic import Anthropic
except ImportError:
    Anthropic = None

# Per-provider model lists with sensible defaults
PROVIDER_MODEL_LISTS = {
    "groq": [
        "llama-3.3-70b-versatile",
        "llama-3.2-90b-vision-preview",
        "mixtral-8x7b-32768",
        "gemma2-9b-it",
        "llama-3.1-8b-instant",
    ],
    "gemini": [
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.0-flash",
    ],
    "openai": [
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4-turbo",
        "gpt-3.5-turbo",
    ],
    "anthropic": [
        "claude-sonnet-4-20250514",
        "claude-3-5-sonnet-latest",
        "claude-3-haiku-20240307",
    ],
    "deepseek": [
        "deepseek-chat",
        "deepseek-reasoner",
    ],
    "openrouter": [],  # Free-text input, any model ID
}

# Default model for each provider (first in the list or explicit)
PROVIDER_DEFAULT_MODELS = {
    "groq": "llama-3.3-70b-versatile",
    "gemini": "gemini-2.5-flash",
    "openai": "gpt-4o",
    "anthropic": "claude-sonnet-4-20250514",
    "deepseek": "deepseek-chat",
    "openrouter": "gpt-4o",
}

class AIService:
    """
    Manages AI Context and Generates Responses.
    Uses standard threading and callbacks for updates.
    v16.0: Added is_generating and interruption support.
    """
    def __init__(self):
        self.groq_key = os.environ.get('GROQ_API_KEY', '')
        self.gemini_key = os.environ.get('GEMINI_API_KEY', '')
        self.openai_key = os.environ.get('OPENAI_API_KEY', '')
        self.anthropic_key = os.environ.get('ANTHROPIC_API_KEY', '')
        self.deepseek_key = os.environ.get('DEEPSEEK_API_KEY', '')
        self.openrouter_key = os.environ.get('OPENROUTER_API_KEY', '')
        self.conversation_history = []
        self.resume_context = ""
        self.job_context = ""
        self.current_mode = "Auto"
        self._worker = None
        self.is_generating = False
        self.interview_mode = True # Enabled by default v30.2
        self.selected_models = {}  # Per-provider model selection override
        
        # Callbacks (Replaces Signals)
        self.on_response_callback = None # func(text, mode)
        self.on_chunk_callback = None    # func(token, mode)
        self.on_error_callback = None    # func(error_msg)

    def set_model(self, provider, model_name):
        """Set a model override for a given provider."""
        self.selected_models[provider] = model_name

    def get_model(self, provider, default=None):
        """Get selected model for a provider, or fall back to default."""
        return self.selected_models.get(provider, default or PROVIDER_DEFAULT_MODELS.get(provider, ""))

    def set_context(self, text, context_type="resume"):
        if context_type == "resume":
            self.resume_context = text
        elif context_type == "job":
            self.job_context = text

    def set_interview_mode(self, enabled):
        self.interview_mode = enabled

    def set_expert_mode(self, mode):
        """Allows switching between Technical, Architectural, Behavioral, and Auto modes"""
        valid_modes = ["Standard assistant", "Coding interview", "System design", "Behavioral (Soft skills)", "Auto"]
        if mode in valid_modes:
            self.current_mode = mode

    def cancel_generation(self):
        """Force stops the current AI worker"""
        if self._worker:
            sys.stderr.write("DEBUG: Interrupting active AI worker...\n")
            sys.stderr.flush()
            self._worker.stop()
            self._worker = None
        self.is_generating = False

    def _detect_mode_for_question(self, question: str) -> str:
        """Classify the interviewer's question to automatically select the best strategy."""
        q = question.lower()
        
        coding_keywords = ["code", "algorithm", "function", "write", "implement", "complexity", "array", "string", "tree", "graph"]
        systems_keywords = ["design", "system", "scale", "architecture", "database", "microservice", "api", "load balancer"]
        behavioral_keywords = ["tell me about", "describe a time", "example of", "situation where", "how do you handle", "challenge"]
        
        coding_score = sum(1 for kw in coding_keywords if kw in q)
        systems_score = sum(1 for kw in systems_keywords if kw in q)
        behavioral_score = sum(1 for kw in behavioral_keywords if kw in q)
        
        max_score = max(coding_score, systems_score, behavioral_score)
        if max_score == 0: return "Standard assistant"
        if max_score == coding_score: return "Coding interview"
        if max_score == systems_score: return "System design"
        return "Behavioral (Soft skills)"
    
    def _resize_image(self, img_bytes, max_size=1024):
        """Reduces image size for faster AI processing (v51.95)"""
        try:
            img = PIL.Image.open(io.BytesIO(img_bytes))
            # Convert to RGB if needed
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            
            w, h = img.size
            if w > max_size or h > max_size:
                ratio = max_size / max(w, h)
                img = img.resize((int(w * ratio), int(h * ratio)), PIL.Image.LANCZOS)
            
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=80)
            return out.getvalue()
        except Exception as e:
            sys.stderr.write(f"DEBUG: Resize failed: {e}\n")
            return img_bytes

    def generate_response(self, question, is_start=True, image_data=None, image_list=None):
        """Start async generation with structured message lists (v31.0: Multi-image support)"""
        from core.utils import log_debug
        log_debug(f"AIService.generate_response called (Vision: {bool(image_data or image_list)})")
        if self.is_generating or self._worker:
            self.cancel_generation()
            import time
            time.sleep(0.1) # Brief pause for cleanup

        self.is_generating = True
        
        # DEBUG: Trace context flow
        sys.stderr.write(f"DEBUG: Generating AI Response. Resume Context Len: {len(self.resume_context)}\n")
        if self.resume_context:
            sys.stderr.write(f"DEBUG: First 100 chars of context: {self.resume_context[:100].strip()}\n")
        sys.stderr.flush()

        effective_mode = self.current_mode
        if self.current_mode == "Auto":
            effective_mode = self._detect_mode_for_question(question)
        
        # Mode selective instructions
        mode_instructions = {
            "Coding interview": (
                "Focus on implementation, time/space complexity, and edge cases. "
                "CRITICAL: You MUST provide the code solution in Python, JavaScript, and C++ "
                "using separate code blocks (tagged with ```python, ```javascript, and ```cpp) "
                "so the user can switch between them using the UI tab selectors."
            ),
            "System design": "Focus on high-level architecture, scalability, and technical trade-offs.",
            "Behavioral (Soft skills)": (
                "You MUST structure your response strictly using the STAR method. "
                "Every behavioral answer must be divided into four sections wrapped in XML-style tags as follows:\n"
                "<situation>Explain the background, company setting, and problem context here.</situation>\n"
                "<task>Describe the specific challenge, requirements, and your responsibility here.</task>\n"
                "<action>Detail the step-by-step actions you took, technical tools used, and challenges overcome here.</action>\n"
                "<result>State the quantitative and qualitative outcomes, metrics improved, and lessons learned here.</result>\n"
                "Do not include any text outside of these tags."
            ),
        }
        mode_instruction = mode_instructions.get(effective_mode, "Style: Professional, natural, and helpful.")

        messages = []
        
        # 1. Base System Instruction (Premium Structural Enforcement)
        system_content = (
            f"You are a candidate in a {effective_mode} interview. {mode_instruction} "
            "CRITICAL: Structure your response for a premium dashboard. "
            "1. Use '###' for section headers (e.g., ### Implementation, ### Complexity) only when describing engineering or logic parts. "
            "2. Use bullet points or numbered lists for steps/details where appropriate. "
            "3. State 'Time Complexity: O(...)' and 'Space Complexity: O(...)' on their own lines ONLY if there is an algorithm or codebase being analyzed. "
            "4. STRICT RULE ON CODE BLOCKS: Do NOT generate or include any programming code block (e.g., python, javascript, cpp, SQL, html, css, bash, etc.) in your response unless: "
            "(a) the user's question explicitly asks for a code solution, or "
            "(b) the current mode is 'Coding interview' and a coding/algorithm solution is required. "
            "Otherwise, you MUST write your response entirely in plain text/prose or list format, and DO NOT use any markdown code blocks (```) whatsoever. "
            "5. FOCUS ON THE CORE QUESTION: Interviewers often set up scenarios, explain background context, or ask multiple sub-questions before arriving at their actual query at the end. You MUST identify and prioritize answering the final, actual question asked at the end of the transcript. Use the preceding text as context, but do not get distracted by introductory setup. "
            "Analyze all parts of the PROVIDED SCREEN(S) as a single continuous environment."
        )
        if image_list:
            system_content += (
                " You have been provided with MULTIPLE screenshots capturing different parts of the screen (likely due to scrolling). "
                "Synthesize the information across ALL images to provide a complete and accurate answer to the user's question."
            )

        messages.append({"role": "system", "content": system_content})

        # 2. Identity Priming
        if self.resume_context:
            messages.append({"role": "user", "content": f"Please memorize this resume and adopt it as YOUR OWN identity:\n\n{self.resume_context[:5000]}"})
            messages.append({"role": "assistant", "content": "Understood. I am acting as the candidate described in this resume."})
        
        if self.job_context:
            messages.append({"role": "user", "content": f"Interview context:\n\n{self.job_context}"})
            messages.append({"role": "assistant", "content": "Understood. I will use this context."})

        # 3. History
        for qa in self.conversation_history[-2:]:
             messages.append({"role": "user", "content": qa['q']})
             messages.append({"role": "assistant", "content": qa['a']})
        
        # 4. Final Question
        messages.append({"role": "user", "content": question})

        # v51.95: Pre-process and resize images for performance
        processed_images = []
        if image_list:
            for img in image_list:
                processed_images.append(self._resize_image(img))
        elif image_data:
            processed_images.append(self._resize_image(image_data))

        worker = AIWorker(self.groq_key, self.gemini_key, self.openai_key,
                         self.anthropic_key, self.deepseek_key, self.openrouter_key,
                         messages, image_list=processed_images, selected_models=self.selected_models)
        self._worker = worker
        
        def make_chunk_cb(w):
            return lambda txt: self._on_worker_chunk(w, txt)
        def make_finished_cb(w):
            return lambda res, err: self._on_worker_finished(w, res, err, question, effective_mode)
            
        worker.on_chunk = make_chunk_cb(worker)
        worker.on_finished = make_finished_cb(worker)
        
        if self.on_chunk_callback:
            self.on_chunk_callback("", is_start=True)
        
        threading.Thread(target=worker.run, daemon=True).start()
        
    def _on_worker_chunk(self, worker, chunk):
        if worker != self._worker:
            return
        if self.on_chunk_callback:
            self.on_chunk_callback(chunk, is_start=False)

    def _on_worker_finished(self, worker, result, error, question, effective_mode):
        if worker != self._worker:
            return
        self.is_generating = False
        self._worker = None
        try:
            if result:
                self.conversation_history.append({'q': question, 'a': result})
                if self.on_response_callback:
                    self.on_response_callback(result, effective_mode, question)
            elif error and not worker.stop_event.is_set():
                if self.on_error_callback:
                    self.on_error_callback(error)
        except Exception as e:
            sys.stderr.write(f"DEBUG: Error in worker finished callback: {e}\n")
            sys.stderr.flush()

def run_local_ocr_fallback(image_bytes):
    try:
        import PIL.Image
        import io
        img = PIL.Image.open(io.BytesIO(image_bytes))
        extracted_text = pytesseract.image_to_string(img)
        return extracted_text.strip()
    except Exception as e:
        sys.stderr.write(f"DEBUG: Local OCR Error: {e}\n")
        sys.stderr.flush()
        return ""

class AIWorker:
    def __init__(self, groq_key, gemini_key, openai_key, anthropic_key, deepseek_key, openrouter_key, messages, image_data=None, image_list=None, preferred_provider="Auto", selected_models=None):
        self.groq_key = groq_key
        self.gemini_key = gemini_key
        self.openai_key = openai_key
        self.anthropic_key = anthropic_key
        self.deepseek_key = deepseek_key
        self.openrouter_key = openrouter_key
        self.messages = messages
        self.stop_event = threading.Event()
        self.image_list = image_list if image_list else ([image_data] if image_data else [])
        self.selected_models = selected_models or {}
        self.on_chunk = None
        self.on_finished = None

    def stop(self):
        self.stop_event.set()

    def run(self):
        from core.utils import log_debug
        log_debug("AIWorker.run starting...")
        def has_key(k): return bool(k and str(k).strip())

        any_key = has_key(self.groq_key) or has_key(self.gemini_key) or has_key(self.openai_key) or has_key(self.anthropic_key) or has_key(self.deepseek_key) or has_key(self.openrouter_key)

        # Perform local OCR extraction if image_list is present AND no API keys are configured (fallback mode only)
        ocr_text = ""
        if self.image_list and not any_key:
            ocr_text_parts = []
            for img_bytes in self.image_list:
                text_part = run_local_ocr_fallback(img_bytes)
                if text_part:
                    ocr_text_parts.append(text_part)
            if ocr_text_parts:
                ocr_text = "\n\n--- EXTRACTED TEXT FROM SCREENSHOTS ---\n" + "\n\n".join(ocr_text_parts)
                last_msg = self.messages[-1]
                if isinstance(last_msg.get("content"), str):
                    last_msg["content"] = last_msg["content"] + "\n" + ocr_text

        # Auto-detect best provider based on task and keys
        providers = ["groq", "gemini", "openai", "anthropic", "deepseek", "openrouter"]

        sys.stderr.write(f"DEBUG: AI Selection - Providers: {providers} (Images: {len(self.image_list)})\n")
        sys.stderr.flush()

        if not any_key:
            if ocr_text:
                fallback_msg = (
                    "### Local OCR Scan Result (No API Keys Configured)\n\n"
                    "We scanned your screen locally using PyTesseract. To get AI solutions, please configure your API keys in Settings.\n\n"
                    "```text\n" + ocr_text.replace("--- EXTRACTED TEXT FROM SCREENSHOTS ---", "").strip() + "\n```"
                )
                if self.on_chunk:
                    for char in fallback_msg:
                        if self.stop_event.is_set(): return
                        self.on_chunk(char)
                if self.on_finished:
                    self.on_finished(fallback_msg, None)
                return

        for p in providers:
            if p == "groq" and has_key(self.groq_key) and not self.image_list:
                try:
                    msg = f"Attempting Groq (Vision: {len(self.image_list) > 0})"
                    from core.utils import log_debug
                    log_debug(msg)
                    client = Groq(api_key=self.groq_key)
                    
                    model_name = self.selected_models.get("groq", "llama-3.3-70b-versatile")
                    formatted_messages = self.messages

                    if self.image_list and "groq" not in self.selected_models:
                        model_name = "llama-3.2-90b-vision-preview"
                        content_list = [{"type": "text", "text": self.messages[-1]['content']}]
                        for img_bytes in self.image_list:
                            base64_image = base64.b64encode(img_bytes).decode('utf-8')
                            content_list.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}})
                        
                        new_msgs = self.messages[:-1]
                        new_msgs.append({"role": "user", "content": content_list})
                        formatted_messages = new_msgs

                    stream = client.chat.completions.create(
                        model=model_name,
                        messages=formatted_messages,
                        max_tokens=800,
                        stream=True
                    )
                    full_text = ""
                    for chunk in stream:
                        if self.stop_event.is_set(): return
                        if chunk.choices[0].delta.content:
                            token = chunk.choices[0].delta.content
                            full_text += token
                            if self.on_chunk: self.on_chunk(token)
                    if self.on_finished: self.on_finished(full_text, None)
                    return
                except Exception as e:
                    from core.utils import log_debug
                    log_debug(f"Groq failed: {str(e)}")

            elif p == "gemini" and has_key(self.gemini_key):
                if "gemini" in self.selected_models:
                    gemini_models_to_try = [self.selected_models["gemini"]]
                else:
                    gemini_models_to_try = ["gemini-2.5-flash", "gemini-2.5-pro"]
                last_err = None
                for gemini_model_name in gemini_models_to_try:
                    try:
                        from core.utils import log_debug
                        log_debug(f"Attempting Gemini with {gemini_model_name} (Vision: {len(self.image_list) > 0})")
                        import google.generativeai as genai
                        genai.configure(api_key=self.gemini_key)
                        
                        gemini_history = []
                        system_instruction = ""
                        
                        for m in self.messages:
                            if m['role'] == 'system':
                                system_instruction += m['content'] + "\n"
                            elif m['role'] == 'user':
                                gemini_history.append({"role": "user", "parts": [m['content']]})
                            elif m['role'] == 'assistant':
                                gemini_history.append({"role": "model", "parts": [m['content']]})
                        
                        model = genai.GenerativeModel(
                            model_name=gemini_model_name,
                            system_instruction=system_instruction.strip() if system_instruction else None
                        )

                        last_msg_content = gemini_history[-1]['parts'][0]
                        
                        if self.image_list:
                            # Vision analysis
                            import PIL.Image
                            parts = [last_msg_content]
                            for img_bytes in self.image_list:
                                parts.append(PIL.Image.open(io.BytesIO(img_bytes)))
                                
                            response = model.generate_content(parts, stream=True)
                            full_text = ""
                            for chunk in response:
                                if self.stop_event.is_set(): return
                                try:
                                    token = chunk.text
                                    if token:
                                        full_text += token
                                        if self.on_chunk: self.on_chunk(token)
                                except Exception:
                                    try:
                                        if chunk.candidates and chunk.candidates[0].content.parts:
                                            token = chunk.candidates[0].content.parts[0].text
                                            if token:
                                                full_text += token
                                                if self.on_chunk: self.on_chunk(token)
                                    except Exception:
                                        pass
                            if self.on_finished: self.on_finished(full_text, None)
                            return
                        else:
                            # Chat fallback
                            chat = model.start_chat(history=gemini_history[:-1])
                            response_stream = chat.send_message(last_msg_content, stream=True)
                            full_text = ""
                            for chunk in response_stream:
                                if self.stop_event.is_set(): return
                                try:
                                    token = chunk.text
                                    if token:
                                        full_text += token
                                        if self.on_chunk: self.on_chunk(token)
                                except Exception:
                                    try:
                                        if chunk.candidates and chunk.candidates[0].content.parts:
                                            token = chunk.candidates[0].content.parts[0].text
                                            if token:
                                                full_text += token
                                                if self.on_chunk: self.on_chunk(token)
                                    except Exception:
                                        pass
                            if self.on_finished: self.on_finished(full_text, None)
                            return
                    except Exception as e:
                        from core.utils import log_debug
                        log_debug(f"Gemini model {gemini_model_name} failed: {str(e)}")
                        last_err = e

            elif p == "openai" and has_key(self.openai_key):
                try:
                    from core.utils import log_debug
                    log_debug(f"Attempting OpenAI (Vision: {len(self.image_list) > 0})")
                    from openai import OpenAI
                    client = OpenAI(api_key=self.openai_key)
                    
                    formatted_messages = []
                    if self.image_list:
                        content_list = [{"type": "text", "text": self.messages[-1]['content']}]
                        for img_bytes in self.image_list:
                            base64_image = base64.b64encode(img_bytes).decode('utf-8')
                            content_list.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}})
                        
                        new_msgs = self.messages[:-1]
                        new_msgs.append({"role": "user", "content": content_list})
                        formatted_messages = new_msgs
                    else:
                        formatted_messages = self.messages

                    stream = client.chat.completions.create(
                        model=self.selected_models.get("openai", "gpt-4o"),
                        messages=formatted_messages,
                        max_tokens=800,
                        stream=True
                    )
                    full_text = ""
                    for chunk in stream:
                        if self.stop_event.is_set(): return
                        if chunk.choices[0].delta.content:
                            token = chunk.choices[0].delta.content
                            full_text += token
                            if self.on_chunk: self.on_chunk(token)
                    if self.on_finished: self.on_finished(full_text, None)
                    return
                except Exception as e:
                    from core.utils import log_debug
                    log_debug(f"OpenAI failed: {str(e)}")

            elif p == "anthropic" and has_key(self.anthropic_key):
                try:
                    from core.utils import log_debug
                    log_debug(f"Attempting Anthropic (Vision: {len(self.image_list) > 0})")
                    from anthropic import Anthropic
                    client = Anthropic(api_key=self.anthropic_key)

                    # Convert messages to Anthropic format
                    system_text = ""
                    anthropic_messages = []
                    for m in self.messages:
                        if m['role'] == 'system':
                            system_text += m['content'] + "\n"
                        elif m['role'] == 'user':
                            content_blocks = [{"type": "text", "text": m['content']}]
                            anthropic_messages.append({"role": "user", "content": content_blocks})
                        elif m['role'] == 'assistant':
                            anthropic_messages.append({"role": "assistant", "content": m['content']})

                    # Add images to the last user message
                    if self.image_list and anthropic_messages:
                        last_user_msg = anthropic_messages[-1]
                        if last_user_msg['role'] == 'user':
                            for img_bytes in self.image_list:
                                base64_image = base64.b64encode(img_bytes).decode('utf-8')
                                last_user_msg['content'].append({
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": "image/jpeg",
                                        "data": base64_image
                                    }
                                })

                    model_name = self.selected_models.get("anthropic", "claude-sonnet-4-20250514")
                    full_text = ""
                    with client.messages.stream(
                        model=model_name,
                        max_tokens=800,
                        system=system_text.strip() if system_text.strip() else None,
                        messages=anthropic_messages
                    ) as stream:
                        for text in stream.text_stream:
                            if self.stop_event.is_set(): return
                            if text:
                                full_text += text
                                if self.on_chunk: self.on_chunk(text)
                    if self.on_finished: self.on_finished(full_text, None)
                    return
                except Exception as e:
                    from core.utils import log_debug
                    log_debug(f"Anthropic failed: {str(e)}")

            elif p == "deepseek" and has_key(self.deepseek_key):
                try:
                    from core.utils import log_debug
                    log_debug(f"Attempting DeepSeek (Vision: {len(self.image_list) > 0})")
                    from openai import OpenAI
                    client = OpenAI(api_key=self.deepseek_key, base_url='https://api.deepseek.com')

                    formatted_messages = self.messages

                    stream = client.chat.completions.create(
                        model=self.selected_models.get("deepseek", "deepseek-chat"),
                        messages=formatted_messages,
                        max_tokens=800,
                        stream=True
                    )
                    full_text = ""
                    for chunk in stream:
                        if self.stop_event.is_set(): return
                        if chunk.choices[0].delta.content:
                            token = chunk.choices[0].delta.content
                            full_text += token
                            if self.on_chunk: self.on_chunk(token)
                    if self.on_finished: self.on_finished(full_text, None)
                    return
                except Exception as e:
                    from core.utils import log_debug
                    log_debug(f"DeepSeek failed: {str(e)}")

            elif p == "openrouter" and has_key(self.openrouter_key):
                try:
                    from core.utils import log_debug
                    log_debug(f"Attempting OpenRouter (Vision: {len(self.image_list) > 0})")
                    from openai import OpenAI
                    client = OpenAI(api_key=self.openrouter_key, base_url='https://openrouter.ai/api/v1')

                    formatted_messages = []
                    if self.image_list:
                        content_list = [{"type": "text", "text": self.messages[-1]['content']}]
                        for img_bytes in self.image_list:
                            base64_image = base64.b64encode(img_bytes).decode('utf-8')
                            content_list.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}})

                        new_msgs = self.messages[:-1]
                        new_msgs.append({"role": "user", "content": content_list})
                        formatted_messages = new_msgs
                    else:
                        formatted_messages = self.messages

                    stream = client.chat.completions.create(
                        model=self.selected_models.get("openrouter", "gpt-4o"),
                        messages=formatted_messages,
                        max_tokens=800,
                        stream=True
                    )
                    full_text = ""
                    for chunk in stream:
                        if self.stop_event.is_set(): return
                        if chunk.choices[0].delta.content:
                            token = chunk.choices[0].delta.content
                            full_text += token
                            if self.on_chunk: self.on_chunk(token)
                    if self.on_finished: self.on_finished(full_text, None)
                    return
                except Exception as e:
                    from core.utils import log_debug
                    log_debug(f"OpenRouter failed: {str(e)}")

        # --- FINAL FAIL ---
        if self.on_finished: 
            self.on_finished(None, "AI Request Failed - All Providers Down")
