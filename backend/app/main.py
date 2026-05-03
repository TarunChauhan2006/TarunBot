from fastapi import FastAPI, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, PlainTextResponse
from langdetect import detect
from pypdf import PdfReader
from groq import Groq
from dotenv import load_dotenv
from app.schemas import ChatRequest, CodeRunRequest

import os
import re
import sqlite3
import subprocess
import tempfile
import shutil
from pathlib import Path

load_dotenv()

app = FastAPI(title="Tarun Bot Advanced API", version="4.1")

MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
FRONTEND_URLS = os.getenv(
    "FRONTEND_URLS",
    "http://localhost:5173,http://127.0.0.1:5173"
)

ALLOWED_ORIGINS = [url.strip() for url in FRONTEND_URLS.split(",") if url.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

DB_PATH = "chat.db"
UPLOAD_DIR = "uploads"
uploaded_docs = {}


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT,
            role TEXT,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


init_db()


def save_message(chat_id: str, role: str, content: str):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO messages(chat_id, role, content) VALUES (?, ?, ?)",
        (chat_id, role, content),
    )
    conn.commit()
    conn.close()


def load_messages(chat_id: str, limit: int = 16):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "SELECT role, content FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT ?",
        (chat_id, limit),
    )
    rows = cur.fetchall()
    conn.close()
    rows.reverse()
    return [{"role": role, "content": content[:3500]} for role, content in rows]


def reset_messages(chat_id: str):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("DELETE FROM messages WHERE chat_id=?", (chat_id,))
    conn.commit()
    conn.close()


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def detect_reply_language(text: str) -> str:
    t = text.lower().strip()

    hinglish_words = [
        "kya", "hai", "kaise", "kyu", "mujhe", "mera", "meri",
        "batao", "samjhao", "karna", "nhi", "haan", "bhai",
        "isme", "iska", "iske", "abb", "aapna", "karo", "do"
    ]

    if any(word in t.split() for word in hinglish_words):
        return "Hinglish / Roman Hindi"

    try:
        lang = detect(text)
        lang_map = {
            "hi": "Hindi",
            "en": "English",
            "ur": "Urdu",
            "ar": "Arabic",
            "fr": "French",
            "de": "German",
            "es": "Spanish",
            "it": "Italian",
            "pt": "Portuguese",
            "ru": "Russian",
            "ja": "Japanese",
            "ko": "Korean",
            "zh-cn": "Chinese",
            "zh-tw": "Chinese",
            "bn": "Bengali",
            "ta": "Tamil",
            "te": "Telugu",
            "mr": "Marathi",
            "gu": "Gujarati",
            "pa": "Punjabi",
        }
        return lang_map.get(lang, "the same language as the user")
    except Exception:
        return "the same language as the user"


def detect_intent(text: str) -> str:
    t = normalize_text(text)

    if any(word in t for word in [
        "code", "python", "java", "javascript", "react", "fastapi",
        "bug", "error", "fix", "api", "html", "css", "sql",
        "program", "function", "algorithm", "final code"
    ]):
        return "coding"

    if any(word in t for word in [
        "explain", "define", "what is", "meaning", "samjhao",
        "notes", "exam", "answer", "syllabus", "numerical",
        "important questions", "difference"
    ]):
        return "study"

    if any(word in t for word in [
        "project", "backend", "frontend", "deploy", "vercel",
        "render", "github", "database", "structure"
    ]):
        return "project"

    return "general"


def build_advanced_messages(user_text: str, req: ChatRequest, memory: list, doc_context: str = ""):
    reply_language = detect_reply_language(user_text)
    intent = detect_intent(user_text)

    length_rule = {
        "short": "Keep the answer short, direct, and useful.",
        "medium": "Give a clear, complete, well-structured answer.",
        "long": "Give a detailed answer with examples, but keep it natural."
    }.get(req.response_length, "Give a clear, complete answer.")

    system_prompt = f"""
You are Tarun Bot, an advanced AI assistant like ChatGPT + Jarvis.

Your main goal:
- Give natural, human-like answers.
- Sound like a smart friend explaining clearly.
- Avoid robotic or textbook-style answers.
- Be helpful, practical, and engaging.

Language:
- Reply in: {reply_language}
- If user writes Hinglish, reply in natural Hinglish.
- If user writes English, reply in natural English.
- If user writes any other language, reply in that same language.
- Do not randomly switch language.

Style:
- Start directly with the answer.
- No filler like "Sure", "Certainly", or "Here is".
- Use simple words.
- Explain like you are teaching a beginner.
- Use examples only when useful.
- Keep the flow smooth like ChatGPT.
- Do not repeat the same points again and again.

Quality:
- If user asks study topic, give exam-ready explanation.
- If user asks coding, give complete runnable code.
- If user shares error/log, give exact reason and fix commands.
- If user asks project help, give step-by-step practical solution.
- If user asks final code, give only clean final code with file names.

Formatting:
- Use clean headings.
- Use bullets only when helpful.
- Use markdown code blocks for code.
- Keep response readable.

Current mode: {req.mode}
Detected intent: {intent}
Response length: {req.response_length}
Safe mode: {req.safe_mode}

{length_rule}
""".strip()

    messages = [{"role": "system", "content": system_prompt}]

    if doc_context:
        messages.append({
            "role": "system",
            "content": f"Use this uploaded document only when relevant:\n\n{doc_context}"
        })

    messages.extend(memory)
    messages.append({"role": "user", "content": user_text})

    return messages


def polish_output(text: str) -> str:
    text = text.strip()

    for prefix in ["Sure!", "Sure.", "Certainly!", "Certainly.", "Here is", "Here's", "Below is"]:
        if text.startswith(prefix):
            text = text[len(prefix):].strip(" :\n-")

    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_pdf_text(file_path: str) -> str:
    reader = PdfReader(file_path)
    chunks = []

    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            chunks.append(page_text)

    return "\n".join(chunks).strip()


def is_rate_limit_error(error: Exception) -> bool:
    err = str(error).lower()
    return "429" in err or "rate limit" in err or "rate_limit" in err or "tokens per day" in err


def get_groq_stream(messages, temperature):
    models = []

    if MODEL:
        models.append(MODEL)

    for model_name in ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"]:
        if model_name not in models:
            models.append(model_name)

    last_error = None

    for model_name in models:
        try:
            return client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=temperature,
                top_p=0.9,
                max_completion_tokens=1000,
                stream=True,
            )
        except Exception as e:
            last_error = e
            if is_rate_limit_error(e):
                continue
            raise e

    raise last_error or Exception("Groq request failed.")


@app.get("/")
def home():
    return {
        "message": "Tarun Bot backend is running",
        "provider": "Groq",
        "model": MODEL,
        "api_key_loaded": bool(GROQ_API_KEY),
        "allowed_origins": ALLOWED_ORIGINS,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat")
def chat(req: ChatRequest):
    user_text = req.message.strip()

    if not user_text:
        return PlainTextResponse("Please type something.", status_code=400)

    if not client:
        return PlainTextResponse("GROQ_API_KEY missing hai. .env me key add karo.", status_code=500)

    chat_id = req.chat_id
    normalized = normalize_text(user_text)

    if normalized in ["reset", "new chat", "reset chat", "clear chat", "start over"]:
        reset_messages(chat_id)
        uploaded_docs.pop(chat_id, None)
        return PlainTextResponse("Chat reset ho gayi.")

    memory = load_messages(chat_id, limit=16)

    doc_context = ""
    if chat_id in uploaded_docs:
        doc_context = uploaded_docs[chat_id]["content"][:15000]

    messages = build_advanced_messages(user_text, req, memory, doc_context)

    intent = detect_intent(user_text)
    temperature = 0.4 if intent == "coding" else 0.7

    save_message(chat_id, "user", user_text)

    def generate():
        assistant_reply = ""

        try:
            stream = get_groq_stream(messages, temperature)

            for chunk in stream:
                delta = ""
                if chunk.choices and chunk.choices[0].delta:
                    delta = chunk.choices[0].delta.content or ""

                if delta:
                    assistant_reply += delta
                    yield delta

            final_reply = polish_output(assistant_reply)
            save_message(chat_id, "assistant", final_reply)

        except Exception as e:
            if is_rate_limit_error(e):
                yield (
                    "Groq token limit reach ho gayi hai. "
                    "20–30 minutes baad try karo ya .env me "
                    "GROQ_MODEL=llama-3.1-8b-instant set karke server restart karo."
                )
            else:
                yield f"Server error: {str(e)}"

    return StreamingResponse(generate(), media_type="text/plain")


@app.post("/upload")
async def upload_file(file: UploadFile = File(...), chat_id: str = Query("default")):
    try:
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        file_path = os.path.join(UPLOAD_DIR, file.filename)

        with open(file_path, "wb") as f:
            f.write(await file.read())

        filename = file.filename.lower()

        if filename.endswith(".pdf"):
            text = extract_pdf_text(file_path)
            uploaded_docs[chat_id] = {
                "filename": file.filename,
                "content": text[:18000]
            }
            return JSONResponse({
                "message": f"PDF '{file.filename}' uploaded successfully. Ab is PDF se question pooch sakte ho."
            })

        if filename.endswith(".txt"):
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()

            uploaded_docs[chat_id] = {
                "filename": file.filename,
                "content": text[:18000]
            }
            return JSONResponse({
                "message": f"TXT file '{file.filename}' uploaded successfully."
            })

        return JSONResponse({"message": "Only PDF and TXT files supported right now."}, status_code=400)

    except Exception as e:
        return JSONResponse({"message": f"File upload failed: {str(e)}"}, status_code=500)


@app.post("/reset")
def reset_chat(chat_id: str = Query(...)):
    reset_messages(chat_id)
    uploaded_docs.pop(chat_id, None)
    return {"message": "Memory reset successful"}


def detect_code_language(code: str, hint: str | None = None) -> str:
    if hint:
        h = hint.strip().lower()
        alias_map = {
            "py": "python",
            "python": "python",
            "java": "java",
            "c": "c",
            "cpp": "cpp",
            "c++": "cpp",
            "javascript": "javascript",
            "js": "javascript",
            "node": "javascript",
        }
        if h in alias_map:
            return alias_map[h]

    text = code.lower()

    if "public class" in text or "system.out.println" in text:
        return "java"
    if "#include <iostream>" in text or "using namespace std" in text:
        return "cpp"
    if "#include <stdio.h>" in text or "printf(" in text:
        return "c"
    if "console.log" in text or "function " in text or "const " in text or "let " in text:
        return "javascript"

    return "python"


def run_subprocess(command, cwd, timeout=5):
    return subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=timeout)


@app.post("/run-code")
def run_code(req: CodeRunRequest):
    language = detect_code_language(req.code, req.language)

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)

            if language == "python":
                file_path = tmp_path / "main.py"
                file_path.write_text(req.code, encoding="utf-8")
                result = run_subprocess(["python3", str(file_path)], tmpdir)

            elif language == "javascript":
                if not shutil.which("node"):
                    return {"language": language, "output": "", "error": "Node.js is not installed."}

                file_path = tmp_path / "main.js"
                file_path.write_text(req.code, encoding="utf-8")
                result = run_subprocess(["node", str(file_path)], tmpdir)

            elif language == "java":
                if not shutil.which("javac") or not shutil.which("java"):
                    return {"language": language, "output": "", "error": "Java is not installed."}

                class_name = "Main"
                match = re.search(r"public\s+class\s+([A-Za-z_][A-Za-z0-9_]*)", req.code)

                if match:
                    class_name = match.group(1)

                file_path = tmp_path / f"{class_name}.java"
                file_path.write_text(req.code, encoding="utf-8")

                compile_result = run_subprocess(["javac", str(file_path)], tmpdir)

                if compile_result.returncode != 0:
                    return {
                        "language": language,
                        "output": compile_result.stdout.strip(),
                        "error": compile_result.stderr.strip()
                    }

                result = run_subprocess(["java", class_name], tmpdir)

            elif language == "c":
                if not shutil.which("gcc"):
                    return {"language": language, "output": "", "error": "gcc is not installed."}

                file_path = tmp_path / "main.c"
                exe_path = tmp_path / "main"
                file_path.write_text(req.code, encoding="utf-8")

                compile_result = run_subprocess(["gcc", str(file_path), "-o", str(exe_path)], tmpdir)

                if compile_result.returncode != 0:
                    return {
                        "language": language,
                        "output": compile_result.stdout.strip(),
                        "error": compile_result.stderr.strip()
                    }

                result = run_subprocess([str(exe_path)], tmpdir)

            elif language == "cpp":
                if not shutil.which("g++"):
                    return {"language": language, "output": "", "error": "g++ is not installed."}

                file_path = tmp_path / "main.cpp"
                exe_path = tmp_path / "main"
                file_path.write_text(req.code, encoding="utf-8")

                compile_result = run_subprocess(["g++", str(file_path), "-o", str(exe_path)], tmpdir)

                if compile_result.returncode != 0:
                    return {
                        "language": language,
                        "output": compile_result.stdout.strip(),
                        "error": compile_result.stderr.strip()
                    }

                result = run_subprocess([str(exe_path)], tmpdir)

            else:
                return {"language": language, "output": "", "error": "Unsupported language."}

            return {
                "language": language,
                "output": result.stdout.strip(),
                "error": result.stderr.strip()
            }

    except subprocess.TimeoutExpired:
        return {"language": language, "output": "", "error": "Code execution timed out."}

    except Exception as e:
        return {"language": language, "output": "", "error": str(e)}