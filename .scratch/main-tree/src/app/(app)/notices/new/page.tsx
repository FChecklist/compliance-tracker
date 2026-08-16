"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { format, addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

type Department = { id: string; name: string };
type User = { id: string; name: string; email: string };

const NOTICE_STATUSES = [
  { value: "received", label: "Received" },
  { value: "in_progress", label: "In Progress" },
  { value: "replied", label: "Replied" },
  { value: "closed", label: "Closed" },
  { value: "appealed", label: "Appealed" },
];

export default function NewNoticePage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [noticeNumber, setNoticeNumber] = useState("");
  const [authority, setAuthority] = useState("");
  const [dateReceived, setDateReceived] = useState("");
  const [demandAmount, setDemandAmount] = useState("");
  const [replyDeadline, setReplyDeadline] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("received");
  const [departmentId, setDepartmentId] = useState("");
  const [assignedToId, setAssignedToId] = useState("");

  // Auto-calculate reply deadline (30 days from dateReceived)
  const autoDeadline = useMemo(() => {
    if (!dateReceived) return "";
    return format(addDays(new Date(dateReceived), 30), "yyyy-MM-dd");
  }, [dateReceived]);

  useEffect(() => {
    Promise.all([
      fetch("/api/departments").then((r) => r.json()),
      fetch("/api/users").then((r) => r.json()),
    ])
      .then(([deptData, userData]) => {
        setDepartments(deptData.departments ?? deptData);
        setUsersList(userData.users ?? userData);
      })
      .catch(() => {});
  }, []);

  const handleDateReceivedChange = (value: string) => {
    setDateReceived(value);
    if (!replyDeadline || replyDeadline === autoDeadline) {
      setReplyDeadline(format(addDays(new Date(value), 30), "yyyy-MM-dd"));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!dateReceived) {
      toast.error("Please fill in the Date Received");
      return;
    }
    if (!departmentId) {
      toast.error("Please select a Department");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noticeNumber: noticeNumber.trim() || null,
          authority: authority.trim() || null,
          dateReceived,
          demandAmount: demandAmount ? parseFloat(demandAmount) : null,
          replyDeadline: replyDeadline || null,
          status,
          description: description.trim() || null,
          departmentId,
          assignedToId: assignedToId || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error);
      }

      const created = await res.json();
      toast.success("Notice created successfully!");
      router.push(`/notices/${created.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create notice");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <Link
        href="/notices"
        className="inline-flex items-center gap-1 text-sm text-ct-muted hover:text-ct-navy transition"
      >
        <ArrowLeft className="size-4" />
        Back to Notices
      </Link>

      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Add New Notice</h1>
        <p className="text-sm text-ct-muted mt-1">Record a government notice / SCN received</p>
      </div>

      <Card className="rounded-xl shadow-card bg-white">
        <CardHeader>
          <CardTitle className="text-base text-ct-navy">Notice Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="noticeNumber" className="text-xs font-semibold text-ct-muted uppercase">
                  Notice Number
                </Label>
                <Input
                  id="noticeNumber"
                  placeholder="e.g. SCN/GST/2025/1234"
                  value={noticeNumber}
                  onChange={(e) => setNoticeNumber(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="authority" className="text-xs font-semibold text-ct-muted uppercase">
                  Authority
                </Label>
                <Input
                  id="authority"
                  placeholder="e.g. GST Authority, IT Department"
                  value={authority}
                  onChange={(e) => setAuthority(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dateReceived" className="text-xs font-semibold text-ct-muted uppercase">
                  Date Received <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="dateReceived"
                  type="date"
                  value={dateReceived}
                  onChange={(e) => handleDateReceivedChange(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="demandAmount" className="text-xs font-semibold text-ct-muted uppercase">
                  Demand Amount (₹)
                </Label>
                <Input
                  id="demandAmount"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={demandAmount}
                  onChange={(e) => setDemandAmount(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="replyDeadline" className="text-xs font-semibold text-ct-muted uppercase">
                  Reply Deadline
                </Label>
                <Input
                  id="replyDeadline"
                  type="date"
                  value={replyDeadline}
                  onChange={(e) => setReplyDeadline(e.target.value)}
                />
                <p className="text-[10px] text-ct-muted">Auto-filled 30 days from date received</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">
                  Status
                </Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTICE_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">
                  Department <span className="text-red-500">*</span>
                </Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ct-muted uppercase">
                  Assigned To
                </Label>
                <Select value={assignedToId} onValueChange={setAssignedToId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select assignee" />
                  </SelectTrigger>
                  <SelectContent>
                    {usersList.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description" className="text-xs font-semibold text-ct-muted uppercase">
                Description
              </Label>
              <Textarea
                id="description"
                placeholder="Brief description of the notice / SCN details..."
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron"
                disabled={submitting}
              >
                {submitting ? "Creating..." : "Create Notice"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/notices")}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}