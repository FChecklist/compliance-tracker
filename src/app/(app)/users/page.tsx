"use client";

import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  department: { name: string } | null;
  createdAt: string;
};

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-ct-accent text-ct-saffron",
  manager: "bg-emerald-50 text-ct-teal",
  member: "bg-blue-50 text-blue-700",
  viewer: "bg-gray-100 text-gray-600",
};

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);

  const loadUsers = () => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((d) => {
        setUsers(d.users ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadUsers(); }, []);

  const sendInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      toast.error('Name and email are required');
      return;
    }
    setInviting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inviteName.trim(), email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to invite'); return; }
      toast.success(`Invite sent to ${inviteEmail}`);
      setShowInvite(false);
      setInviteName(''); setInviteEmail(''); setInviteRole('member');
      loadUsers();
    } catch {
      toast.error('Failed to invite user');
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Users</h1>
          <p className="text-sm text-ct-muted mt-1">
            {users.length} team members
          </p>
        </div>
        <Button onClick={() => setShowInvite(true)} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
          <UserPlus className="size-4 mr-2" />
          Invite User
        </Button>
      </div>

      {/* Table */}
      <Card className="rounded-xl shadow-card bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold text-ct-navy">Name</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden sm:table-cell">Email</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy">Role</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden md:table-cell">Department</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden lg:table-cell">Status</TableHead>
                <TableHead className="text-xs font-semibold text-ct-navy hidden lg:table-cell">Last Login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Skeleton className="size-9 rounded-full" />
                          <Skeleton className="h-4 w-28" />
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                    </TableRow>
                  ))
                : users.map((user) => (
                    <TableRow key={user.id} className="hover:bg-ct-row-hover">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-ct-accent text-ct-saffron text-xs font-bold">
                              {getInitials(user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-sm text-ct-navy">{user.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-ct-muted hidden sm:table-cell">
                        {user.email}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "text-[10px] px-2 py-0.5 font-medium capitalize",
                            ROLE_BADGE[user.role] ?? ""
                          )}
                        >
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-ct-muted hidden md:table-cell">
                        {user.department?.name ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "text-[10px] px-2 py-0.5",
                            user.isActive
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-gray-100 text-gray-500"
                          )}
                        >
                          {user.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-ct-muted hidden lg:table-cell">
                        {user.lastLoginAt
                          ? formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true })
                          : "Never"}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <Card className="rounded-xl bg-white w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between p-5 border-b border-ct-border">
              <h2 className="font-heading text-lg text-ct-navy">Invite Team Member</h2>
              <button onClick={() => setShowInvite(false)} className="text-ct-muted hover:text-ct-navy">
                <X className="size-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Full Name</Label>
                <Input value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Priya Sharma" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Email Address</Label>
                <Input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="priya@company.com" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
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
                  {inviting ? 'Sending...' : 'Send Invite'}
                </Button>
                <Button variant="outline" onClick={() => setShowInvite(false)} className="flex-1">Cancel</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}