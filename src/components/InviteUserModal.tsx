"use client";

// Shared "Invite a team member" modal (U-D28 / U-D27). Extracted from the
// /users page's inline invite modal so the persistent "+" control in
// AppTopbar (visible on every authenticated screen) and the dedicated
// /users page both drive the exact same invite mechanisms. Three tabs,
// three real backends:
//   - "Direct Add": POST /api/users (Path B: Master-Admin-direct-add) --
//     the original mechanism, admin/manager only (server-enforced; also
//     hidden client-side here for non-privileged users, see below).
//   - "Shareable Link": POST /api/invite-links (area 15/18's Secure Invite
//     Link, see src/lib/invite-link-service.ts) -- admin/manager only,
//     same gating as Direct Add.
//   - "Join Code": POST /api/join-codes (Path C admin-code + Path D
//     peer-code, see src/lib/org-join-code-service.ts) -- the one tab
//     every authenticated org member can use, not just admin/manager. The
//     role choice offered is capped server-side to the current user's own
//     ROLE_RANK or below (isPrivilegedMinter/resolveAllowedMintRoles) --
//     this component mirrors that ceiling client-side (via /api/me's
//     `role`) purely for UX; the server call is the actual gate.
//
// Direct Add and Shareable Link are hidden entirely for a non-privileged
// (peer) user rather than shown-and-then-403'd -- before this change, the
// AppTopbar "+" control was visible to every role (U-D28: "must appear on
// every screen"), but a member/viewer clicking it landed on two tabs that
// always failed server-side. Join Code is the one that actually works for
// them, so it's what they see.

import { useEffect, useState } from "react";
import { X, Copy, Check, Link2, KeyRound } from "lucide-react";
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

type JoinCodeSummary = {
  id: string;
  role: string;
  codePrefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  member: "Member",
  viewer: "Viewer (read-only)",
};

// Path C (admin-minted, no forced expiry/cap) + Path D (peer-minted,
// forced expiry + PEER_MAX_ACTIVE_CODES cap -- mirrored below as the
// literal "3" for display only, same convention ShareableLinkTab already
// uses for its own hardcoded "Valid for 7 days" text; the server
// (org-join-code-service.ts) is the actual source of truth for both numbers.
function JoinCodeTab({ privileged, allowedRoles }: { privileged: boolean; allowedRoles: string[] }) {
  const [codeRole, setCodeRole] = useState(
    allowedRoles.includes("member") ? "member" : allowedRoles[allowedRoles.length - 1] ?? "member"
  );
  const [expiryDays, setExpiryDays] = useState(14);
  const [generating, setGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeCodes, setActiveCodes] = useState<JoinCodeSummary[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(true);

  const loadCodes = () => {
    setLoadingCodes(true);
    fetch("/api/join-codes")
      .then((r) => r.json())
      .then((d) => {
        const now = Date.now();
        const codes: JoinCodeSummary[] = d.codes ?? [];
        setActiveCodes(codes.filter((c) => !c.revokedAt && (!c.expiresAt || new Date(c.expiresAt).getTime() > now)));
      })
      .catch(() => {})
      .finally(() => setLoadingCodes(false));
  };

  useEffect(() => {
    loadCodes();
  }, []);

  const atLimit = !privileged && activeCodes.length >= 3;

  const generate = async () => {
    setGenerating(true);
    setGeneratedCode(null);
    try {
      const body: { role: string; expiresInDays?: number } = { role: codeRole };
      // Privileged omits expiresInDays entirely when left at the default UI
      // value to preserve Path C's "no forced expiry" behavior; a peer
      // always sends one (server clamps/defaults it either way).
      if (!privileged || expiryDays !== 14) body.expiresInDays = expiryDays;
      const res = await fetch("/api/join-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to create join code");
        return;
      }
      setGeneratedCode(data.code);
      loadCodes();
    } catch {
      toast.error("Failed to create join code");
    } finally {
      setGenerating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      const res = await fetch(`/api/join-codes/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to revoke join code");
        return;
      }
      loadCodes();
    } catch {
      toast.error("Failed to revoke join code");
    }
  };

  const copyCode = async () => {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy -- select and copy the code manually");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-ct-muted uppercase">Role for anyone who joins</Label>
        <Select value={codeRole} onValueChange={setCodeRole}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowedRoles.map((r) => (
              <SelectItem key={r} value={r}>{ROLE_LABEL[r] ?? r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!privileged && (
          <p className="text-xs text-ct-muted">
            You can only invite people at your own level or below -- admin/manager roles still require an admin or manager to grant.
          </p>
        )}
      </div>

      {!privileged && (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-ct-muted uppercase">Expires in (days, max 30)</Label>
          <Input
            type="number"
            min={1}
            max={30}
            value={expiryDays}
            onChange={(e) => setExpiryDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
            className="h-9"
          />
        </div>
      )}

      {generatedCode ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-ct-border bg-ct-cloud/40 p-2.5">
            <KeyRound className="size-4 text-ct-muted shrink-0" />
            <span className="text-xs text-ct-navy truncate flex-1 font-mono">{generatedCode}</span>
            <button onClick={copyCode} className="text-ct-muted hover:text-ct-navy shrink-0" title="Copy code">
              {copied ? <Check className="size-4 text-ct-teal" /> : <Copy className="size-4" />}
            </button>
          </div>
          <p className="text-xs text-ct-muted">
            Share this however you'd normally reach them -- they type it in on the sign-up page to join as {ROLE_LABEL[codeRole] ?? codeRole}.
          </p>
          <Button variant="outline" onClick={generate} disabled={generating || atLimit} className="w-full">
            Generate another code
          </Button>
        </div>
      ) : (
        <Button
          onClick={generate}
          disabled={generating || atLimit}
          className="w-full bg-ct-saffron hover:bg-ct-saffron-hover text-white"
        >
          {generating ? "Generating..." : atLimit ? "Active code limit reached (3)" : "Generate Join Code"}
        </Button>
      )}

      {!loadingCodes && activeCodes.length > 0 && (
        <div className="space-y-1.5 pt-3 border-t border-ct-border">
          <Label className="text-xs font-semibold text-ct-muted uppercase">
            {privileged ? "Active codes (whole org)" : `Your active codes (${activeCodes.length}/3)`}
          </Label>
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {activeCodes.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-xs text-ct-navy bg-ct-cloud/30 rounded px-2 py-1.5">
                <span className="font-mono">{c.codePrefix}-****-****</span>
                <span className="text-ct-muted">{ROLE_LABEL[c.role] ?? c.role}</span>
                <button onClick={() => revoke(c.id)} className="text-ct-muted hover:text-red-600">Revoke</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Mirrors auth-guard.ts's ROLE_RANK / org-join-code-service.ts's
// resolveAllowedMintRoles -- duplicated here because this is a client
// component and those live in server-only modules (db/crypto imports).
// UX-only: the real gate is server-side in POST /api/join-codes, this
// just decides which tabs/options to render so a non-privileged user
// isn't shown a control that would 403.
const CLIENT_ROLE_RANK: Record<string, number> = {
  viewer: 1, client_viewer: 1, external_auditor: 1,
  member: 2, team_member: 2,
  senior_professional: 3, manager: 3,
  branch_manager: 4,
  admin: 5,
  veridian_admin: 6,
};
const INVITE_ROLES_CLIENT = ["admin", "manager", "member", "viewer"];

export function InviteUserModal({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited?: () => void;
}) {
  const [tab, setTab] = useState<"direct" | "link" | "code">("direct");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [ownRole, setOwnRole] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        const role = typeof d.role === "string" ? d.role : null;
        setOwnRole(role);
        // A non-privileged user has no working tab except Join Code --
        // land them there directly instead of on a Direct Add tab that
        // would just 403.
        const rank = role ? (CLIENT_ROLE_RANK[role] ?? 0) : 0;
        if (rank < CLIENT_ROLE_RANK.manager) setTab("code");
      })
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  const rank = ownRole ? (CLIENT_ROLE_RANK[ownRole] ?? 0) : 0;
  const privileged = rank >= CLIENT_ROLE_RANK.manager;
  const allowedRoles = INVITE_ROLES_CLIENT.filter((r) => CLIENT_ROLE_RANK[r] <= rank);

  const close = () => {
    onOpenChange(false);
    setTab(privileged ? "direct" : "code");
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
          {privileged && (
            <button
              onClick={() => setTab("direct")}
              className={cn(
                "px-1 py-2.5 mr-5 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === "direct" ? "border-ct-saffron text-ct-navy" : "border-transparent text-ct-muted hover:text-ct-navy"
              )}
            >
              Direct Add
            </button>
          )}
          {privileged && (
            <button
              onClick={() => setTab("link")}
              className={cn(
                "px-1 py-2.5 mr-5 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === "link" ? "border-ct-saffron text-ct-navy" : "border-transparent text-ct-muted hover:text-ct-navy"
              )}
            >
              Shareable Link
            </button>
          )}
          <button
            onClick={() => setTab("code")}
            className={cn(
              "px-1 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === "code" ? "border-ct-saffron text-ct-navy" : "border-transparent text-ct-muted hover:text-ct-navy"
            )}
          >
            Join Code
          </button>
        </div>
        <div className="p-5 space-y-4">
          {tab === "direct" && privileged ? (
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
          ) : tab === "link" && privileged ? (
            <ShareableLinkTab />
          ) : (
            <JoinCodeTab privileged={privileged} allowedRoles={allowedRoles.length > 0 ? allowedRoles : ["viewer"]} />
          )}
        </div>
      </Card>
    </div>
  );
}
