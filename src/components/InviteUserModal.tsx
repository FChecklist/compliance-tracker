"use client";

// Shared "Invite a team member" modal (U-D28 / U-D27). Extracted from the
// /users page's inline invite modal so the persistent "+" control in
// AppTopbar (visible on every authenticated screen) and the dedicated
// /users page both drive the exact same invite mechanism -- POST
// /api/users (Path B: Master-Admin-direct-add, see
// src/app/api/users/route.ts). No new invite backend was added; this
// component just makes the existing one reusable outside /users.

import { useState } from "react";
import { X } from "lucide-react";
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
import { toast } from "sonner";

export function InviteUserModal({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited?: () => void;
}) {
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);

  if (!open) return null;

  const close = () => {
    onOpenChange(false);
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
        <div className="p-5 space-y-4">
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
        </div>
      </Card>
    </div>
  );
}
