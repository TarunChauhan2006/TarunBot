import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const MODEL_NAME = import.meta.env.VITE_MODEL_NAME || "llama-3.3-70b-versatile";

export default function App() {
  const [messages, setMessages] = useState(
    JSON.parse(localStorage.getItem("chat")) || []
  );
  const [history, setHistory] = useState(
    JSON.parse(localStorage.getItem("history")) || []
  );
  const [currentChatId, setCurrentChatId] = useState(
    localStorage.getItem("currentChatId") || Date.now().toString()
  );

  const [input, setInput] = useState("");
  const [dark, setDark] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [typing, setTyping] = useState(false);
  const [copiedMap, setCopiedMap] = useState({});
  const [editingChatId, setEditingChatId] = useState(null);
  const [editText, setEditText] = useState("");

  const [mode, setMode] = useState("auto");
  const [responseLength, setResponseLength] = useState("medium");
  const [safeMode, setSafeMode] = useState(true);

  const endRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("chat", JSON.stringify(messages));
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    localStorage.setItem("history", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem("currentChatId", currentChatId);
  }, [currentChatId]);

  const generateTitle = (text) => {
    const clean = text.trim();
    if (!clean) return "New Chat";
    return clean.length > 30 ? clean.slice(0, 30) + "..." : clean;
  };

  const speak = (text) => {
    if (!window.speechSynthesis || !text?.trim()) return;
    const msg = new SpeechSynthesisUtterance(text);
    speechSynthesis.cancel();
    speechSynthesis.speak(msg);
  };

  const copyCode = async (codeText, copyKey) => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopiedMap((prev) => ({ ...prev, [copyKey]: true }));

      setTimeout(() => {
        setCopiedMap((prev) => ({ ...prev, [copyKey]: false }));
      }, 1500);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const normalizeLang = (lang = "") => {
    const value = lang.toLowerCase().trim();

    if (["py", "python"].includes(value)) return "python";
    if (["java"].includes(value)) return "java";
    if (["c"].includes(value)) return "c";
    if (["cpp", "c++", "cc", "cxx"].includes(value)) return "cpp";
    if (["js", "javascript", "node"].includes(value)) return "javascript";

    return "";
  };

  const detectLanguageFromCode = (codeText, className = "") => {
    const text = `${className} ${codeText}`.toLowerCase().trim();

    if (
      text.includes("language-java") ||
      text.includes("public class") ||
      text.includes("system.out.print") ||
      text.includes("system.out.println")
    ) {
      return "java";
    }

    if (
      text.includes("language-cpp") ||
      text.includes("language-c++") ||
      text.includes("#include <iostream>") ||
      text.includes("std::") ||
      text.includes("using namespace std")
    ) {
      return "cpp";
    }

    if (
      text.includes("language-c") ||
      text.includes("#include <stdio.h>") ||
      text.includes("printf(")
    ) {
      return "c";
    }

    if (
      text.includes("language-javascript") ||
      text.includes("language-js") ||
      text.includes("console.log(") ||
      text.includes("function ") ||
      text.includes("let ") ||
      text.includes("const ") ||
      text.includes("var ")
    ) {
      return "javascript";
    }

    return "python";
  };

  const runCode = async (codeText, className = "") => {
    try {
      const language =
        normalizeLang(className.replace("language-", "")) ||
        detectLanguageFromCode(codeText, className);

      const res = await fetch(`${API_URL}/run-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code: codeText,
          language
        })
      });

      const data = await res.json();

      const resultText = data.error
        ? `Language: ${data.language}\n\nError:\n${data.error}`
        : `Language: ${data.language}\n\nOutput:\n${data.output || "(no output)"}`;

      setMessages((prev) => [
        ...prev,
        { role: "bot", text: `\`\`\`\n${resultText}\n\`\`\`` }
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: "```\nError running code.\n```" }
      ]);
    }
  };

  const saveConversationToHistory = (chatId, preview, updatedMessages) => {
    const conversation = {
      chatId,
      preview,
      messages: updatedMessages
    };

    setHistory((prev) => {
      const filtered = prev.filter((item) => item.chatId !== chatId);
      return [conversation, ...filtered];
    });
  };

  const sendMessage = async (customText) => {
    const finalText =
      typeof customText === "string" ? customText.trim() : input.trim();

    if (typing || !finalText) return;

    const activeChatId = currentChatId || Date.now().toString();

    if (!currentChatId) {
      setCurrentChatId(activeChatId);
    }

    const newMessages = [...messages, { role: "user", text: finalText }];

    setMessages(newMessages);
    setInput("");
    setTyping(true);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: finalText,
          chat_id: activeChatId,
          mode,
          response_length: responseLength,
          safe_mode: safeMode
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok || !res.body) {
        throw new Error("Server response failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let botText = "";

      setMessages((prev) => [...prev, { role: "bot", text: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        botText += chunk;

        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "bot", text: botText };
          return updated;
        });
      }

      setTyping(false);

      if (botText.trim()) {
        const updatedMessages = [...newMessages, { role: "bot", text: botText }];
        saveConversationToHistory(
          activeChatId,
          generateTitle(finalText),
          updatedMessages
        );
        speak(botText);
      }
    } catch (err) {
      console.error(err);
      setTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text:
            err.name === "AbortError"
              ? "Request timed out."
              : "Error connecting to server."
        }
      ]);
    }
  };

  const startVoice = () => {
    if (typing) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      setInput(e.results[0][0].transcript);
    };

    rec.start();
  };

  const loadHistory = (chatItem) => {
    if (typing) return;
    setMessages(chatItem.messages || []);
    setCurrentChatId(chatItem.chatId);
    setCopiedMap({});
  };

  const newChat = async () => {
    if (typing) return;

    const newId = Date.now().toString();
    setMessages([]);
    setCopiedMap({});
    setCurrentChatId(newId);
    setInput("");

    try {
      await fetch(`${API_URL}/reset?chat_id=${newId}`, {
        method: "POST"
      });
    } catch (err) {
      console.error("Reset failed:", err);
    }
  };

  const clearHistory = () => {
    if (typing) return;

    setHistory([]);
    setMessages([]);
    setCopiedMap({});
    const newId = Date.now().toString();
    setCurrentChatId(newId);
    localStorage.removeItem("history");
    localStorage.removeItem("chat");
  };

  const deleteChat = (chatId) => {
    setHistory((prev) => prev.filter((c) => c.chatId !== chatId));

    if (chatId === currentChatId) {
      setMessages([]);
      const newId = Date.now().toString();
      setCurrentChatId(newId);
    }
  };

  const renameChat = (chatId) => {
    if (!editText.trim()) {
      setEditingChatId(null);
      setEditText("");
      return;
    }

    setHistory((prev) =>
      prev.map((c) =>
        c.chatId === chatId ? { ...c, preview: editText.trim() } : c
      )
    );

    setEditingChatId(null);
    setEditText("");
  };

  const handleFileUpload = async (e) => {
    if (typing) return;

    const file = e.target.files[0];
    if (!file) return;

    const activeChatId = currentChatId || Date.now().toString();
    if (!currentChatId) setCurrentChatId(activeChatId);

    const newMessages = [...messages, { role: "user", text: `📎 ${file.name}` }];
    setMessages(newMessages);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_URL}/upload?chat_id=${activeChatId}`, {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      const botReply = data.message || "File uploaded successfully.";

      const updatedMessages = [...newMessages, { role: "bot", text: botReply }];
      setMessages(updatedMessages);

      saveConversationToHistory(
        activeChatId,
        `📎 ${generateTitle(file.name)}`,
        updatedMessages
      );
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: "File upload failed." }
      ]);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const filteredHistory = history.filter((item) =>
    (item.preview || "").toLowerCase().includes(searchText.toLowerCase())
  );

  const suggestions = [
    {
      title: "Explain Java simply",
      subtitle: "Beginner friendly explanation with examples.",
      prompt: "Explain Java in simple words"
    },
    {
      title: "Write Python code",
      subtitle: "Fast solutions, debug help, and clean code.",
      prompt: "Write factorial code in Python"
    },
    {
      title: "Summarize my notes",
      subtitle: "Turn long notes into short easy points.",
      prompt: "Summarize my notes in short"
    },
    {
      title: "Reply in Hindi",
      subtitle: "Hindi, Hinglish, or English support.",
      prompt: "Reply in Hindi"
    }
  ];

  return (
    <div className={dark ? "app dark" : "app"}>
      <aside className={`sidebar ${sidebarOpen ? "open" : "collapsed"}`}>
        <button
          className="collapseBtn"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? "☰" : "☰"}
        </button>

        {sidebarOpen && (
          <>
            <div className="sidebarTop">
              <h2>Tarun Bot</h2>
              <p className="sidebarSubtitle">Smart AI Assistant</p>

              <button onClick={newChat} disabled={typing}>
                + New Chat
              </button>

              <button onClick={() => setDark(!dark)} disabled={typing}>
                {dark ? "☀ Light Mode" : "🌙 Dark Mode"}
              </button>

              <button
                className="clearHistory"
                onClick={clearHistory}
                disabled={typing}
              >
                Clear History
              </button>
            </div>

            <div className="controlPanel">
              <div>
                <label>Mode</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  disabled={typing}
                >
                  <option value="auto">Auto</option>
                  <option value="chat">Chat</option>
                  <option value="coding">Coding</option>
                  <option value="explain">Explain</option>
                </select>
              </div>

              <div>
                <label>Response Length</label>
                <select
                  value={responseLength}
                  onChange={(e) => setResponseLength(e.target.value)}
                  disabled={typing}
                >
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                  <option value="long">Long</option>
                </select>
              </div>

              <label className="safeToggle">
                <input
                  type="checkbox"
                  checked={safeMode}
                  onChange={(e) => setSafeMode(e.target.checked)}
                  disabled={typing}
                />
                Safe Mode
              </label>
            </div>

            <div className="history">
              <h3>Recent Chats</h3>

              <input
                type="text"
                placeholder="Search chats..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="searchInput"
                disabled={typing}
              />

              {filteredHistory.length === 0 && (
                <p className="noHistory">No matching chats</p>
              )}

              {filteredHistory.map((item, i) => (
                <div
                  key={item.chatId || i}
                  className={`historyItem ${
                    item.chatId === currentChatId ? "active" : ""
                  }`}
                  data-tooltip={item.preview || "Chat"}
                >
                  {editingChatId === item.chatId ? (
                    <input
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onBlur={() => renameChat(item.chatId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameChat(item.chatId);
                      }}
                      autoFocus
                      className="renameInput"
                    />
                  ) : (
                    <span
                      className="historyText"
                      onClick={() => loadHistory(item)}
                      onDoubleClick={() => {
                        if (typing) return;
                        setEditingChatId(item.chatId);
                        setEditText(item.preview || "");
                      }}
                    >
                      {item.preview || "New Chat"}
                    </span>
                  )}

                  <div className="historyActions">
                    <button
                      onClick={() => {
                        if (typing) return;
                        setEditingChatId(item.chatId);
                        setEditText(item.preview || "");
                      }}
                      disabled={typing}
                      title="Rename"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => deleteChat(item.chatId)}
                      disabled={typing}
                      title="Delete"
                    >
                      ❌
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>

      <main className="main">
        <header className="header">
          <div className="headerLeft">
            <div className="botAvatar">🤖</div>

            <div className="headerTitleWrap">
              <div className="headerTitle">Tarun Bot</div>
              <div className="headerMeta">
                <span className="modelBadge">{MODEL_NAME}</span>
                <span className="statusBadge">
                  <span className="statusDot"></span>
                  Online
                </span>
              </div>
            </div>
          </div>

          <div className="headerActions">
            <button className="headerIconBtn" title="New chat" onClick={newChat}>
              +
            </button>
            <button
              className="headerIconBtn"
              title="Toggle theme"
              onClick={() => setDark(!dark)}
            >
              {dark ? "☀" : "🌙"}
            </button>
          </div>
        </header>

        <section className="chat">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcomeIcon">🤖</div>
              <h1>Hello Tarun 👋</h1>
              <p>
                I can help with coding, explanations, notes, translation, and smart
                AI chat. Start with a message or use one of the example prompts below.
              </p>

              <div className="suggestionGrid">
                {suggestions.map((item, index) => (
                  <div
                    key={index}
                    className="suggestionCard"
                    onClick={() => sendMessage(item.prompt)}
                  >
                    <h4>{item.title}</h4>
                    <span>{item.subtitle}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ inline, className, children, ...props }) {
                      const codeText = String(children).replace(/\n$/, "");
                      const copyKey = `${i}-${codeText.slice(0, 40)}`;
                      const detectedLanguage =
                        normalizeLang((className || "").replace("language-", "")) ||
                        detectLanguageFromCode(codeText, className || "");

                      if (inline) {
                        return (
                          <code className="inlineCode" {...props}>
                            {children}
                          </code>
                        );
                      }

                      return (
                        <div className="codeContainer">
                          <button
                            className="runBtn"
                            onClick={() => runCode(codeText, className || "")}
                            disabled={typing}
                            title={`Run ${detectedLanguage}`}
                          >
                            Run
                          </button>

                          <button
                            className="copyBtn"
                            onClick={() => copyCode(codeText, copyKey)}
                          >
                            {copiedMap[copyKey] ? "Copied!" : "Copy"}
                          </button>

                          <pre className="codeBlock">
                            <code className={className} {...props}>
                              {children}
                            </code>
                          </pre>
                        </div>
                      );
                    }
                  }}
                >
                  {m.text}
                </ReactMarkdown>
              </div>
            ))
          )}

          {typing && (
            <div className="msg bot typing">
              <div className="typingDots">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            </div>
          )}

          <div ref={endRef} />
        </section>

        <div className="inputBox">
          <div className="inputWrapper">
            <button
              className="fileBtn"
              onClick={() => fileInputRef.current?.click()}
              title="Upload File"
              disabled={typing}
            >
              📎
            </button>

            <input
              value={input}
              disabled={typing}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message Tarun Bot..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) sendMessage();
              }}
            />

            <button
              className="iconBtn"
              onClick={startVoice}
              title="Voice Input"
              disabled={typing}
            >
              🎤
            </button>
          </div>

          <button
            className="sendBtn"
            onClick={() => sendMessage()}
            title="Send"
            disabled={typing}
          >
            ➜
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            style={{ display: "none" }}
          />
        </div>
      </main>
    </div>
  );
}