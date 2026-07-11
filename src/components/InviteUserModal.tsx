"use client";

// Shared "Invite a team member" modal (U-D28 / U-D27). Extracted from the
// /users page's inline invite modal so the persistent "+" control in
// AppTopbar (visible on every authenticated screen) and the dedicated
// /users page both drive the exact same invite mechanisms. Two tabs, two
// real backends:
//   - "Direct Add": POST /api/users (Path B: Master-Admin-direct-add) --
//     the original, only, mechanism before this change.
//   - "Shareable Link": POST /api/invite-links (area 15/18's Secure Invite
//     Link, see src/lib/invite-link-service.ts) -- generates a link an
//     admin can send via WhatsApp/email to anyone, who joins this org at
//     the chosen role on redemption. Second invitation path, not a
//     replacement for direct-add.

import { useState } from "react";
import { X, Copy, Check, Link2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function ShareableLinkTab() {
  const [linkRole, setLinkRole] = useState("member");
  const [generating, setGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generateLink = async () => {
    setGenerating(true);
    setGeneratedUrl(null);
    try {
      const res = await fetch("/api/invite-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: linkRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to create invite link");
        return;
      }
      setGeneratedUrl(data.url);
    } catch {
      toast.error("Failed to create invite link");
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy -- select and copy the link manually");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-ct-muted uppercase">Role for anyone who joins</Label>
        <Select value={linkRole} onValueChange={setLinkRole}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="manager">Manager</SelectItem>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="viewer">Viewer (read-only)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {generatedUrl ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-ct-border bg-ct-cloud/40 p-2.5">
            <Link2 className="size-4 text-ct-muted shrink-0" />
            <span className="text-xs text-ct-navy truncate flex-1">{generatedUrl}</span>
            <button onClick={copyLink} className="text-ct-muted hover:text-ct-navy shrink-0" title="Copy link">
              {copied ? <Check className="size-4 text-ct-teal" /> : <Copy className="size-4" />}
            </button>
          </div>
          <p className="text-xs text-ct-muted">
            Valid for 7 days. Anyone with this link can join as {linkRole}. Share it via WhatsApp, email, or wherever your team already talks.
          </p>
          <Button variant="outline" onClick={generateLink} disabled={generating} className="w-full">
            Generate a new link
          </Button>
        </div>
      ) : (
        <Button onClick={generateLink} disabled={generating} className="w-full bg-ct-saffron hover:bg-ct-saffron-hover text-white">
          {generating ? "Generating..." : "Generate Shareable Link"}
        </Button>
      )}
    </div>
  );
}

export function InviteUserModal({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited?: () => void;
}) {
  const [tab, setTab] = useState<"direct" | "link">("direct");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);

  if (!open) return null;

  const close = () => {
    onOpenChange(false);
    setTab("direct");
    setInviteName("");
    setInviteEmail("");
    setInviteRole("member");
  };

  const sendInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      toast.error("Name and email are required");
      return;
    }
    setInviting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: inviteName.trim(), email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to invite");
        return;
      }
      toast.success(`Invite sent to ${inviteEmail}`);
      close();
      onInvited?.();
    } catch {
      toast.error("Failed to invite user");
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <Card className="rounded-xl bg-white w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-ct-border">
          <h2 className="font-heading text-lg text-ct-navy">Invite Team Member</h2>
          <button onClick={close} className="text-ct-muted hover:text-ct-navy">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex border-b border-ct-border px-5">
          <button
            onClick={() => setTab("direct")}
            className={cn(
              "px-1 py-2.5 mr-5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === "direct" ? "border-ct-saffron text-ct-navy" : "border-transparent text-ct-muted hover:text-ct-navy"
            )}
          >
            Direct Add
          </button>
          <button
            onClick={() => setTab("link")}
            className={cn(
              "px-1 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === "link" ? "border-ct-saffron text-ct-navy" : "border-transparent text-ct-muted hover:text-ct-navy"
            )}
          >
            Shareable Link
          </button>
        </div>
        <div className="p-5 space-y-4">
          {tab === "direct" ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Full Name</Label>
                <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Priya Sharma" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Email Address</Label>
                <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="priya@company.com" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="viewer">Viewer (read-only)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={sendInvite} disabled={inviting} className="flex-1 bg-ct-saffron hover:bg-ct-saffron-hover text-white">
                  {inviting ? "Sending..." : "Send Invite"}
                </Button>
                <Button variant="outline" onClick={close} className="flex-1">
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <ShareableLinkTab />
          )}
        </div>
      </Card>
    </div>
  );
}
