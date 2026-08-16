"use client";

import { useState, useRef, useEffect } from "react";
import { HelpCircle, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ChatMessage {
  question: string;
  answer: string;
  // AI Architecture / Explainability & Transparency gap-closure
  // (2026-07-18): "Explain Software Functionality" -- which KB pages (if
  // any) actually grounded this answer, so the user can tell a real,
  // documented answer apart from freeform generation.
  sources?: { id: string; title: string; slug: string }[];
}

export default function HelpWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const question = trimmed;
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/help/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          currentPath: window.location.pathname,
        }),
      });

      const data = await res.json();
      setMessages((prev) => [...prev, { question, answer: data.answer, sources: data.sources }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { question, answer: "Sorry, something went wrong. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating help button */}
      <Button
        size="icon"
        className={cn(
          "fixed bottom-6 right-6 z-50 size-12 rounded-full shadow-lg",
          "bg-[#0E7C6E] hover:bg-[#0E7C6E]/90 text-white",
          isOpen && "hidden"
        )}
        onClick={() => setIsOpen(true)}
        aria-label="Open help"
      >
        <HelpCircle className="size-5" />
      </Button>

      {/* Expanded chat panel */}
      {isOpen && (
        <Card className="fixed bottom-6 right-6 z-50 w-80 sm:w-96 shadow-xl border border-[#1C2B3A]/10">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base font-semibold text-[#1C2B3A]">
              VERIDIAN Help
            </CardTitle>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-[#1C2B3A]/60 hover:text-[#1C2B3A]"
              onClick={() => setIsOpen(false)}
              aria-label="Close help"
            >
              <X className="size-4" />
            </Button>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            {/* Messages list */}
            <ScrollArea className="h-72 w-full rounded-md border border-[#1C2B3A]/10 p-3">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-[#1C2B3A]/50">
                  Ask a question to get started
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg, i) => (
                    <div key={i} className="space-y-1.5">
                      <p className="text-sm font-medium text-[#F5820A]">
                        {msg.question}
                      </p>
                      <p className="text-sm leading-relaxed text-[#1C2B3A]">
                        {msg.answer}
                      </p>
                      {msg.sources && msg.sources.length > 0 && (
                        <p className="text-xs text-[#1C2B3A]/50">
                          Based on: {msg.sources.map((s) => s.title).join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Input row */}
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your question…"
                disabled={isLoading}
                className="h-9"
              />
              <Button
                size="icon"
                className="size-9 shrink-0 bg-[#0E7C6E] hover:bg-[#0E7C6E]/90 text-white"
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                aria-label="Send"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}