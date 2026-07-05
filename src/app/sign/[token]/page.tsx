"use client";

// Intentionally outside (app)/ and outside middleware's protected-route
// allowlist -- the public e-signature page (Wave 86), mirroring
// /guest-chat/[token] and /vendor-portal/[token]'s tokenized-no-auth-
// session pattern. Never move this under (app)/.
import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { Loader2, PenLine, Type as TypeIcon, Check } from "lucide-react";

type SigningSession = {
  requestTitle: string; requestStatus: string;
  signerName: string; signerStatus: string; signerId: string; isMyTurn: boolean;
};

export default function SignPage() {
  const params = useParams<{ token: string }>();
  const [session, setSession] = useState<SigningSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [method, setMethod] = useState<"drawn" | "typed">("drawn");
  const [typedName, setTypedName] = useState("");
  const [hasDrawn, setHasDrawn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const [done, setDone] = useState<"signed" | "declined" | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/esignature/sign/${params.token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "This signing link is invalid or has expired");
      } else {
        setSession(await res.json());
        setError(null);
      }
    } catch {
      setError("This signing link is invalid or has expired");
    } finally {
      setLoading(false);
    }
  }, [params.token]);

  useEffect(() => { load(); }, [load]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1C2B3A";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };
  const endDraw = () => { drawingRef.current = false; };
  const clearCanvas = () => {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const submitSignature = async () => {
    setSubmitting(true);
    try {
      const signatureImageData = method === "drawn" ? canvasRef.current!.toDataURL("image/png") : typedName;
      const res = await fetch(`/api/esignature/sign/${params.token}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureImageData, signatureMethod: method }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to submit signature");
      setDone("signed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit signature");
    } finally {
      setSubmitting(false);
    }
  };

  const submitDecline = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/esignature/sign/${params.token}/decline`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: declineReason }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to decline");
      setDone("declined");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to decline");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="size-6 animate-spin text-ct-teal" /></div>;
  if (error) return <div className="flex items-center justify-center min-h-screen"><p className="text-sm text-ct-muted">{error}</p></div>;
  if (!session) return null;

  if (done === "signed") {
    return (
      <div className="min-h-screen bg-ct-cloud/30 flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-3">
          <Check className="size-10 text-ct-teal mx-auto" />
          <h1 className="text-xl font-heading text-ct-navy">Signed successfully</h1>
          <p className="text-sm text-ct-muted">Thank you, {session.signerName}. Your signature on &ldquo;{session.requestTitle}&rdquo; has been recorded with a timestamp and audit trail.</p>
        </div>
      </div>
    );
  }
  if (done === "declined" || session.signerStatus === "declined") {
    return (
      <div className="min-h-screen bg-ct-cloud/30 flex items-center justify-center px-4">
        <p className="text-sm text-ct-muted">You have declined to sign &ldquo;{session.requestTitle}&rdquo;.</p>
      </div>
    );
  }
  if (session.signerStatus === "signed") {
    return (
      <div className="min-h-screen bg-ct-cloud/30 flex items-center justify-center px-4">
        <p className="text-sm text-ct-muted">You already signed &ldquo;{session.requestTitle}&rdquo;.</p>
      </div>
    );
  }
  if (!session.isMyTurn) {
    return (
      <div className="min-h-screen bg-ct-cloud/30 flex items-center justify-center px-4">
        <p className="text-sm text-ct-muted">Waiting for an earlier signer to complete their signature before it's your turn.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ct-cloud/30 py-10 px-4">
      <div className="max-w-lg mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-heading text-ct-navy">{session.requestTitle}</h1>
          <p className="text-sm text-ct-muted">Please sign as {session.signerName}</p>
        </div>

        <div className="bg-white rounded-xl border border-ct-border p-4 space-y-3">
          <div className="flex gap-2">
            <button onClick={() => setMethod("drawn")} className={`flex-1 h-9 rounded-md text-sm font-medium flex items-center justify-center gap-1.5 ${method === "drawn" ? "bg-ct-teal text-white" : "border border-ct-border text-ct-navy"}`}>
              <PenLine className="size-4" /> Draw
            </button>
            <button onClick={() => setMethod("typed")} className={`flex-1 h-9 rounded-md text-sm font-medium flex items-center justify-center gap-1.5 ${method === "typed" ? "bg-ct-teal text-white" : "border border-ct-border text-ct-navy"}`}>
              <TypeIcon className="size-4" /> Type
            </button>
          </div>

          {method === "drawn" ? (
            <div className="space-y-2">
              <canvas
                ref={canvasRef} width={460} height={180}
                className="w-full border border-ct-border rounded-lg bg-white touch-none"
                onPointerDown={startDraw} onPointerMove={draw} onPointerUp={endDraw} onPointerLeave={endDraw}
              />
              <button onClick={clearCanvas} className="text-xs text-ct-muted hover:text-ct-navy">Clear</button>
            </div>
          ) : (
            <input
              className="w-full h-12 border border-ct-border rounded-lg px-3 text-2xl font-serif italic"
              placeholder="Type your full name"
              value={typedName} onChange={(e) => setTypedName(e.target.value)}
            />
          )}

          <button
            onClick={submitSignature}
            disabled={submitting || (method === "drawn" ? !hasDrawn : !typedName.trim())}
            className="w-full h-10 rounded-md bg-ct-saffron hover:bg-ct-saffron-hover text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />} Sign Document
          </button>

          {!showDecline ? (
            <button onClick={() => setShowDecline(true)} className="text-xs text-ct-muted hover:text-red-600 w-full text-center">I don't wish to sign this</button>
          ) : (
            <div className="space-y-2 border-t border-ct-border pt-3">
              <input className="w-full h-9 border border-ct-border rounded-md px-3 text-sm" placeholder="Reason (optional)" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
              <button onClick={submitDecline} disabled={submitting} className="w-full h-9 rounded-md border border-red-300 text-red-600 text-sm font-medium disabled:opacity-50">
                Confirm Decline
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-ct-muted text-center">Your IP address, device, and the exact time of signing are recorded as part of the legal audit trail.</p>
      </div>
    </div>
  );
}
