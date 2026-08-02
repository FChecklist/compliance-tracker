"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Mic, Square, Upload, Loader2, FileAudio, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type VoiceMemo = {
  id: string;
  status: "uploaded" | "transcribing" | "extracting" | "transcribed" | "completed" | "failed";
  meetingId: string | null;
  transcript: string | null;
  aiSummary: string | null;
  aiSuggestedActionItems: { title: string; assignee: string | null; dueDateHint: string | null }[];
  errorMessage: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  uploaded: "Queued",
  transcribing: "Transcribing...",
  extracting: "Extracting action items...",
  transcribed: "Transcribed",
  completed: "Ready",
  failed: "Failed",
};

const IN_PROGRESS_STATUSES = new Set(["uploaded", "transcribing", "extracting"]);

function StatusBadge({ status }: { status: string }) {
  const variant = status === "failed" ? "destructive" : status === "completed" ? "secondary" : "outline";
  return <Badge variant={variant} className="text-[10px]">{STATUS_LABEL[status] ?? status}</Badge>;
}

export default function VoiceTicketsPage() {
  const [memos, setMemos] = useState<VoiceMemo[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [addingItem, setAddingItem] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/voice-tickets");
    const data = await res.json();
    setMemos(data.voiceMemos ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const hasInProgress = memos.some((m) => IN_PROGRESS_STATUSES.has(m.status));
    if (!hasInProgress) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [memos, load]);

  const uploadBlob = async (blob: Blob, filename: string, durationSeconds?: number) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", blob, filename);
      if (durationSeconds) formData.append("durationSeconds", String(Math.round(durationSeconds)));
      const res = await fetch("/api/voice-tickets", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Upload failed");
      }
      toast.success("Voice memo uploaded -- transcribing now");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload voice memo");
    } finally {
      setUploading(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      const startedAt = Date.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const durationSeconds = (Date.now() - startedAt) / 1000;
        await uploadBlob(blob, "voice-memo.webm", durationSeconds);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast.error("Microphone access denied or unavailable. Use Upload instead.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadBlob(file, file.name);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addAsTask = async (memoId: string, title: string) => {
    setAddingItem(memoId + title);
    try {
      const res = await fetch("/api/voice-tickets/" + memoId + "/action-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error();
      toast.success("Added as a task");
    } catch {
      toast.error("Failed to add task");
    } finally {
      setAddingItem(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">Voice Tickets</h1>
          <p className="text-sm text-ct-muted mt-1">
            Record or upload a quick voice memo -- it is transcribed and AI-extracted into suggested tasks automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {recording ? (
            <Button onClick={stopRecording} variant="destructive">
              <Square className="size-4 mr-2" />
              Stop Recording
            </Button>
          ) : (
            <Button onClick={startRecording} disabled={uploading} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
              <Mic className="size-4 mr-2" />
              Record
            </Button>
          )}
          <Button variant="outline" disabled={uploading || recording} onClick={() => fileInputRef.current?.click()}>
            {uploading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Upload className="size-4 mr-2" />}
            Upload
          </Button>
          <Input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileSelect} />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-ct-muted">Loading...</p>
      ) : memos.length === 0 ? (
        <Card className="rounded-xl shadow-card bg-white">
          <CardContent className="pt-10 pb-10 text-center space-y-2">
            <FileAudio className="size-10 text-ct-muted mx-auto" />
            <p className="text-sm text-ct-muted">No voice memos yet. Record or upload one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {memos.map((memo) => (
            <Card key={memo.id} className="rounded-xl shadow-card bg-white">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-ct-muted">
                    <FileAudio className="size-4" />
                    {new Date(memo.createdAt).toLocaleString()}
                    {memo.meetingId && <Badge variant="secondary" className="text-[10px]">Meeting-linked</Badge>}
                  </div>
                  <StatusBadge status={memo.status} />
                </div>

                {memo.status === "failed" && memo.errorMessage && (
                  <p className="text-sm text-red-600">{memo.errorMessage}</p>
                )}

                {IN_PROGRESS_STATUSES.has(memo.status) && (
                  <p className="text-sm text-ct-muted flex items-center gap-2">
                    <Loader2 className="size-3 animate-spin" />
                    {STATUS_LABEL[memo.status]}
                  </p>
                )}

                {memo.transcript && (
                  <div>
                    <p className="text-xs font-semibold text-ct-muted uppercase mb-1">Transcript</p>
                    <p className="text-sm text-ct-navy whitespace-pre-wrap">{memo.transcript}</p>
                  </div>
                )}

                {memo.aiSummary && (
                  <div>
                    <p className="text-xs font-semibold text-ct-muted uppercase mb-1">Summary</p>
                    <p className="text-sm text-ct-navy">{memo.aiSummary}</p>
                  </div>
                )}

                {memo.aiSuggestedActionItems?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-ct-muted uppercase mb-1">Suggested action items</p>
                    <div className="space-y-1.5">
                      {memo.aiSuggestedActionItems.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-2 rounded-lg border border-ct-border px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm text-ct-navy truncate">{item.title}</p>
                            {(item.assignee || item.dueDateHint) && (
                              <p className="text-xs text-ct-muted">
                                {[item.assignee, item.dueDateHint].filter(Boolean).join(" -- ")}
                              </p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={addingItem === memo.id + item.title}
                            onClick={() => addAsTask(memo.id, item.title)}
                          >
                            {addingItem === memo.id + item.title ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <span className="flex items-center">
                                <Plus className="size-3 mr-1" />
                                Add as task
                              </span>
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
