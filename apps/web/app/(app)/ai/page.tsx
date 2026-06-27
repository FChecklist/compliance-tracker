"use client";
import { useState, useRef, useEffect } from "react";
import { Button, Input } from "@compliance/ui";
import { Send, Bot, User, Sparkles, Loader2, Trash2 } from "lucide-react";

type Message = { id: string; role: "user" | "assistant"; content: string; timestamp: string };

const SUGGESTED_PROMPTS = [
  "What compliance items are overdue?",
  "Summarise this week's compliance activity",
  "What should I prioritise today?",
  "Generate a compliance checklist for IT security",
  "Which departments have the most pending items?",
];

export default function AIChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text?: string) => {
    const content = text || input.trim();
    if (!content || loading) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: content, context: "compliance_chat" }),
      });
      const data = await res.json();
      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: data.response ?? data.message ?? data.content ?? "I couldn't generate a response. Please try again.",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [...prev, {
        id: `e-${Date.now()}`,
        role: "assistant",
        content: "Sorry, I encountered an error. Please check your connection and try again.",
        timestamp: new Date().toISOString(),
      }]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#F5820A]" />
          <h1 className="text-2xl font-bold text-gray-900">AI Assistant</h1>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setMessages([])}>
            <Trash2 className="w-4 h-4 mr-1" /> Clear Chat
          </Button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-[#FFFDF9] border border-gray-200 flex items-center justify-center mb-4">
              <Bot className="w-8 h-8 text-[#F5820A]" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">ComplianceTrack AI</h3>
            <p className="text-sm text-gray-500 max-w-md mb-6">
              Ask me about your compliance items, get summaries, generate checklists, or get recommendations.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-left text-sm p-3 rounded-lg border border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-[#F5820A]/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-[#F5820A]" />
                </div>
              )}
              <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${msg.role === "user" ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-800"}`}>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                <p className={`text-[10px] mt-1.5 ${msg.role === "user" ? "text-blue-200" : "text-gray-400"}`}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
          ))
        )}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[#F5820A]/10 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-[#F5820A]" />
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Thinking...
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="mt-4 flex gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your compliance..."
          rows={1}
          className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 max-h-32"
          style={{ minHeight: "48px" }}
          onInput={(e) => { (e.target as HTMLTextAreaElement).style.height = "auto"; (e.target as HTMLTextAreaElement).style.height = Math.min((e.target as HTMLTextAreaElement).scrollHeight, 128) + "px"; }}
        />
        <Button onClick={() => sendMessage()} disabled={loading || !input.trim()} className="h-12 w-12 p-0 flex items-center justify-center rounded-xl">
          <Send className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}