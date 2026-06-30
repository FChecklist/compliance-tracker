"use client";

import { useTheme } from "next-themes";
import {
  User,
  Building2,
  Bell,
  Palette,
  Info,
  ShieldCheck,
  Sun,
  Moon,
  Save,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useState } from "react";

const SETTINGS_NAV = [
  { id: "profile", label: "Profile", icon: User },
  { id: "organisation", label: "Organisation", icon: Building2 },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "preferences", label: "Preferences", icon: Palette },
  { id: "about", label: "About", icon: Info },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [activeSection, setActiveSection] = useState("profile");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl md:text-3xl text-ct-navy">Settings</h1>
        <p className="text-sm text-ct-muted mt-1">
          Manage your account and preferences
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Settings Nav */}
        <nav className="lg:w-[240px] shrink-0">
          <Card className="rounded-xl shadow-card bg-white p-2">
            <div className="flex lg:flex-col gap-1">
              {SETTINGS_NAV.map((item) => {
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors w-full text-left",
                      isActive
                        ? "bg-ct-accent text-ct-saffron font-bold"
                        : "text-ct-slate hover:bg-ct-cloud"
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        </nav>

        {/* Settings Content */}
        <div className="flex-1 max-w-2xl">
          {activeSection === "profile" && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                  <User className="size-4" />
                  Profile
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 mb-2">
                  <Avatar className="h-14 w-14">
                    <AvatarFallback className="bg-ct-saffron text-white text-lg font-bold">
                      RS
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold text-ct-navy">Rajesh Sharma</p>
                    <p className="text-sm text-ct-muted">admin@compliancetrack.com</p>
                    <Badge
                      variant="secondary"
                      className="bg-ct-accent text-ct-saffron text-[10px] mt-1 font-medium"
                    >
                      Admin
                    </Badge>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Full Name</Label>
                    <Input defaultValue="Rajesh Sharma" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Email</Label>
                    <Input defaultValue="admin@compliancetrack.com" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Phone</Label>
                    <Input defaultValue="+91 98765 43210" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Role</Label>
                    <Select defaultValue="admin">
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="pt-2">
                  <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
                    <Save className="size-4 mr-2" />
                    Save Changes
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "organisation" && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                  <Building2 className="size-4" />
                  Organisation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Organisation Name</Label>
                    <Input defaultValue="Acme Financial Services Pvt. Ltd." className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Industry</Label>
                    <Input defaultValue="Financial Services" className="h-9" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Address</Label>
                    <Input defaultValue="Mumbai, Maharashtra, India" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">CIN Number</Label>
                    <Input defaultValue="U67120MH2020PTC345678" className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">PAN</Label>
                    <Input defaultValue="AABCS1234K" className="h-9" />
                  </div>
                </div>
                <div className="pt-2">
                  <Button className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
                    <Save className="size-4 mr-2" />
                    Save Changes
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "notifications" && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                  <Bell className="size-4" />
                  Notifications
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: "Deadline Reminders", desc: "Get notified before compliance deadlines", defaultChecked: true },
                  { label: "Assignment Alerts", desc: "When a compliance item is assigned to you", defaultChecked: true },
                  { label: "Status Changes", desc: "When a compliance status is updated", defaultChecked: false },
                  { label: "Comment Mentions", desc: "When someone mentions you in a comment", defaultChecked: true },
                  { label: "Weekly Digest", desc: "Summary email every Monday morning", defaultChecked: false },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between py-1">
                    <div>
                      <Label className="text-sm font-medium text-ct-navy">{item.label}</Label>
                      <p className="text-xs text-ct-muted">{item.desc}</p>
                    </div>
                    <Switch defaultChecked={item.defaultChecked} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {activeSection === "preferences" && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                  <Palette className="size-4" />
                  Preferences
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {theme === "dark" ? (
                      <Moon className="size-4 text-ct-muted" />
                    ) : (
                      <Sun className="size-4 text-amber-500" />
                    )}
                    <div>
                      <Label htmlFor="theme-toggle" className="text-sm font-medium text-ct-navy">
                        Dark Mode
                      </Label>
                      <p className="text-xs text-ct-muted">Switch between light and dark theme</p>
                    </div>
                  </div>
                  <Switch
                    id="theme-toggle"
                    checked={theme === "dark"}
                    onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
                  />
                </div>
                <Separator />
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Timezone</Label>
                  <Select defaultValue="asia-kolkata">
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asia-kolkata">Asia/Kolkata (IST)</SelectItem>
                      <SelectItem value="utc">UTC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-ct-muted uppercase">Date Format</Label>
                  <Select defaultValue="dd-mm-yyyy">
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dd-mm-yyyy">DD/MM/YYYY</SelectItem>
                      <SelectItem value="mm-dd-yyyy">MM/DD/YYYY</SelectItem>
                      <SelectItem value="yyyy-mm-dd">YYYY-MM-DD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === "about" && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                  <Info className="size-4" />
                  About
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Application", value: "Veridian AI", icon: ShieldCheck },
                  { label: "Tagline", value: "One Portal. One Truth." },
                  { label: "Version", value: "1.0.0", isBadge: true },
                  { label: "Tech Stack", value: "Next.js 16, Prisma, SQLite, shadcn/ui, Tailwind CSS 4" },
                  { label: "Framework", value: "React 19 + TypeScript 5" },
                ].map((row, i) => (
                  <div key={row.label}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-ct-muted">{row.label}</span>
                      {row.isBadge ? (
                        <Badge variant="outline" className="text-xs">{row.value}</Badge>
                      ) : (
                        <span className="text-sm font-medium text-ct-navy flex items-center gap-1.5">
                          {row.icon && <row.icon className="size-3.5 text-ct-teal" />}
                          {row.value}
                        </span>
                      )}
                    </div>
                    {i < 4 && <Separator className="mt-3" />}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}