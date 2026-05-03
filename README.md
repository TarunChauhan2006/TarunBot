# 🤖 Tarun Bot

An advanced AI chatbot built using **FastAPI + React + LLM (Groq/Ollama)**.

---

## 🚀 Features
- 💬 Real-time AI chat
- 🧠 Conversation memory (SQLite)
- 🎙 Voice input support
- ⚡ FastAPI backend
- 🎨 Modern React UI (Vite)
- 🔌 API-based LLM integration (Groq)

---

## 🛠 Tech Stack
- **Backend:** FastAPI, Python  
- **Frontend:** React (Vite)  
- **Database:** SQLite  
- **AI:** Groq / Ollama (Llama3)

---

## 📂 Project Structure
```bash
Tarun-Bot/
├── backend/
│   └── app/
│       └── main.py
│
├── frontend/
│   └── src/
│       └── App.jsx

## ⚙️ Setup Instructions

### 🔹 Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
