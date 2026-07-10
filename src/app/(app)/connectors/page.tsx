"use client";

export const dynamic = "force-dynamic";

// VERI CONNECT -- one-click OAuth connectors (Gmail, Google Drive, Google
// Calendar) via Composio. Deliberately no manual client-id/secret entry
// anywhere in this UI: Composio's composio-managed auth configs mean the
// user only ever sees a single "Connect" button and Google's own consent
// screen, per the founder's "idiot proof, one button" requirement.
import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Mail, HardDrive, Calendar, Check, Loader2,
  MailOpen, Cloud, Share2, Users, Slack, FileText, Github, Package, Box, BookOpen,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ToolkitStatus = {
  toolkit: string;
  label: string;
  connected: boolean;
  status: string;
  connectedEmail: string | null;
};

const TOOLKIT_ICONS: Record<string, React.ElementType> = {
  gmail: Mail,
  googledrive: HardDrive,
  googlecalendar: Calendar,
  outlook: MailOpen,
  one_drive: Cloud,
  share_point: Share2,
  microsoft_teams: Users,
  slack: Slack,
  notion: FileText,
  github: Github,
  dropbox: Package,
  box: Box,
  confluence: BookOpen,
};

export default function ConnectorsPage() {
  const [toolkits, setToolkits] = useState<ToolkitStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/connectors");
    const data = await res.json();
    setToolkits(data.toolkits ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, [load]);

  async function connect(toolkit: string) {
    setConnecting(toolkit);
    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start connection");

      const popup = window.open(data.redirectUrl, "veri-connect", "width=520,height=680");
      if (!popup) toast.error("Popup blocked -- allow popups for this site and try again.");

      // Composio doesn't push a webhook here -- poll status every 3s for up
      // to 2 minutes, same window a user would realistically take to finish
      // Google's consent screen.
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        const syncRes = await fetch(`/api/connectors/${toolkit}/sync`, { method: "POST" });
        const syncData = await syncRes.json();
        if (syncData.status === "ACTIVE") {
          if (pollRef.current) clearInterval(pollRef.current);
          setConnecting(null);
          toast.success(`${toolkit} connected.`);
          load();
        } else if (attempts >= 40) {
          if (pollRef.current) clearInterval(pollRef.current);
          setConnecting(null);
          toast.error("Connection timed out -- try again.");
        }
      }, 3000);
    } catch (error) {
      setConnecting(null);
      toast.error(error instanceof Error ? error.message : "Failed to start connection");
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-serif mb-1">VERI Connect</h1>
      <p className="text-muted-foreground mb-6">Connect your everyday tools so VERI can work inside them for you. One click, nothing to configure.</p>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {toolkits.map((t) => {
            const Icon = TOOLKIT_ICONS[t.toolkit] ?? Mail;
            const isConnecting = connecting === t.toolkit;
            return (
              <Card key={t.toolkit}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3">
                    <Icon className="h-6 w-6 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{t.label}</div>
                      {t.connectedEmail && <div className="text-sm text-muted-foreground">{t.connectedEmail}</div>}
                    </div>
                  </div>
                  {t.connected ? (
                    <Badge className="bg-teal-600 text-white gap-1"><Check className="h-3 w-3" /> Connected</Badge>
                  ) : (
                    <Button size="sm" disabled={isConnecting} onClick={() => connect(t.toolkit)}>
                      {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
