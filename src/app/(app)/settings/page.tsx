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
  Brain,
  Key,
  Webhook,
  Bot,
  Rocket,
  Cpu,
} from "lucide-react";
import AiConfigSection from "@/components/AiConfigSection";
import OrchestraModelConfigSection from "@/components/OrchestraModelConfigSection";
import AiAssistantsSection from "@/components/AiAssistantsSection";
import PersonalAiConfigSection from "@/components/PersonalAiConfigSection";
import ApiKeySection from "@/components/ApiKeySection";
import WebhookSection from "@/components/WebhookSection";
import PmsEnablementSection from "@/components/PmsEnablementSection";
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
import { useState, useEffect } from "react";
import { toast } from "sonner";

const SETTINGS_NAV = [
  { id: "profile", label: "Profile", icon: User },
  { id: "organisation", label: "Organisation", icon: Building2 },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "ai-config", label: "AI Configuration", icon: Brain },
  { id: "ai-assistants", label: "AI Assistants", icon: Bot },
  { id: "my-ai", label: "My AI", icon: Cpu },
  { id: "preferences", label: "Preferences", icon: Palette },
  { id: "pms", label: "Project Management", icon: Rocket },
  { id: "api-access", label: "API Access", icon: Key },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "about", label: "About", icon: Info },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [activeSection, setActiveSection] = useState("profile");

  // Profile state
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profileRole, setProfileRole] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // Org state
  const [orgName, setOrgName] = useState('');
  const [orgAddress, setOrgAddress] = useState('');
  const [orgCin, setOrgCin] = useState('');
  const [orgPan, setOrgPan] = useState('');
  const [orgGstin, setOrgGstin] = useState('');
  const [orgAccountType, setOrgAccountType] = useState('company');
  const [orgRegulatoryEntityType, setOrgRegulatoryEntityType] = useState('general');
  const [orgSaving, setOrgSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // PageAgent org-level toggle
  const [pageAgentOrgEnabled, setPageAgentOrgEnabled] = useState(true);
  const [pageAgentToggleSaving, setPageAgentToggleSaving] = useState(false);

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => {
      setProfileName(d.name ?? '');
      setProfileEmail(d.email ?? '');
      setProfileRole(d.role ?? '');
      setOrgName(d.orgName ?? '');
      setOrgAccountType(d.orgAccountType ?? 'company');
      setOrgRegulatoryEntityType(d.orgRegulatoryEntityType ?? 'general');
      setIsAdmin(d.role === 'admin');
      setPageAgentOrgEnabled(d.pageAgentEnabled ?? true);
    }).catch(() => {});
  }, []);

  const togglePageAgentOrgEnabled = async (next: boolean) => {
    setPageAgentToggleSaving(true);
    const previous = pageAgentOrgEnabled;
    setPageAgentOrgEnabled(next);
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageAgentEnabled: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next ? 'PageAgent enabled for your organisation' : 'PageAgent disabled for your organisation');
    } catch {
      setPageAgentOrgEnabled(previous);
      toast.error('Failed to update PageAgent setting');
    } finally {
      setPageAgentToggleSaving(false);
    }
  };

  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profileName }),
      });
      if (!res.ok) throw new Error();
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to save profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const saveOrg = async () => {
    setOrgSaving(true);
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgName, orgAddress, orgCin, orgGstin, orgPan, orgAccountType, orgRegulatoryEntityType }),
      });
      if (!res.ok) throw new Error();
      toast.success('Organisation updated');
    } catch {
      toast.error('Failed to save organisation');
    } finally {
      setOrgSaving(false);
    }
  };

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
                      {profileName ? profileName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2) : '??'}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold text-ct-navy">{profileName || '—'}</p>
                    <p className="text-sm text-ct-muted">{profileEmail || '—'}</p>
                    <Badge variant="secondary" className="bg-ct-accent text-ct-saffron text-[10px] mt-1 font-medium capitalize">
                      {profileRole || 'member'}
                    </Badge>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Full Name</Label>
                    <Input value={profileName} onChange={e => setProfileName(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Email</Label>
                    <Input value={profileEmail} disabled className="h-9 opacity-60" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Role</Label>
                    <Input value={profileRole} disabled className="h-9 opacity-60 capitalize" />
                  </div>
                </div>
                <div className="pt-2">
                  <Button onClick={saveProfile} disabled={profileSaving} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
                    <Save className="size-4 mr-2" />
                    {profileSaving ? 'Saving...' : 'Save Changes'}
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
                {!isAdmin && (
                  <p className="text-sm text-ct-muted bg-ct-cloud rounded-lg p-3">
                    Only admins can edit organisation details.
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Organisation Name</Label>
                    <Input value={orgName} onChange={e => setOrgName(e.target.value)} disabled={!isAdmin} className="h-9" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Address</Label>
                    <Input value={orgAddress} onChange={e => setOrgAddress(e.target.value)} disabled={!isAdmin} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">CIN Number</Label>
                    <Input value={orgCin} onChange={e => setOrgCin(e.target.value)} disabled={!isAdmin} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">PAN</Label>
                    <Input value={orgPan} onChange={e => setOrgPan(e.target.value)} disabled={!isAdmin} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">GSTIN</Label>
                    <Input value={orgGstin} onChange={e => setOrgGstin(e.target.value)} disabled={!isAdmin} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Account Type</Label>
                    <select value={orgAccountType} onChange={e => setOrgAccountType(e.target.value)} disabled={!isAdmin} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                      <option value="company">Company (single client)</option>
                      <option value="ca_firm">CA Firm (serves many clients)</option>
                      <option value="legal_firm">Legal Firm</option>
                      <option value="consultant">Consultant</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-ct-muted uppercase">Regulatory Entity Type</Label>
                    <select value={orgRegulatoryEntityType} onChange={e => setOrgRegulatoryEntityType(e.target.value)} disabled={!isAdmin} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                      <option value="general">General (unlisted, non-BFSI)</option>
                      <option value="listed_company">Listed Company (SEBI)</option>
                      <option value="bank_nbfc">Bank / NBFC (RBI)</option>
                      <option value="insurer">Insurer (IRDAI)</option>
                    </select>
                    <p className="text-[11px] text-ct-muted">Determines which sector regulator (SEBI/RBI/IRDAI) module shows real content.</p>
                  </div>
                </div>
                {isAdmin && (
                  <div className="pt-2">
                    <Button onClick={saveOrg} disabled={orgSaving} className="bg-ct-saffron hover:bg-ct-saffron-hover text-white shadow-saffron">
                      <Save className="size-4 mr-2" />
                      {orgSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                )}
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

          {activeSection === "ai-config" && (
            <div className="space-y-6">
              <AiConfigSection />
              <Card className="rounded-xl shadow-card bg-white">
                <CardContent className="pt-6">
                  <OrchestraModelConfigSection />
                </CardContent>
              </Card>
            </div>
          )}

          {activeSection === "ai-assistants" && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                  <Bot className="size-4" />
                  AI Assistants
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AiAssistantsSection />
              </CardContent>
            </Card>
          )}

          {activeSection === "my-ai" && (
            <div className="space-y-6">
              {isAdmin && (
                <Card className="rounded-xl shadow-card bg-white">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                      <Cpu className="size-4" />
                      PageAgent (Organisation)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium text-ct-navy">Enable PageAgent for this organisation</Label>
                        <p className="text-xs text-ct-muted mt-0.5">
                          When off, no one in your organisation gets the PageAgent assistant, regardless of
                          their personal configuration below.
                        </p>
                      </div>
                      <Switch
                        checked={pageAgentOrgEnabled}
                        onCheckedChange={togglePageAgentOrgEnabled}
                        disabled={pageAgentToggleSaving}
                        className="data-[state=checked]:bg-ct-saffron"
                      />
                    </div>
                  </CardContent>
                </Card>
              )}
              <PersonalAiConfigSection />
            </div>
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

          {activeSection === "pms" && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                  <Rocket className="size-4" />
                  Project Management
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PmsEnablementSection isAdmin={isAdmin} />
              </CardContent>
            </Card>
          )}

          {activeSection === "api-access" && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                  <Key className="size-4" />
                  API Access
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ApiKeySection />
              </CardContent>
            </Card>
          )}

          {activeSection === "webhooks" && (
            <Card className="rounded-xl shadow-card bg-white">
              <CardHeader>
                <CardTitle className="text-base font-semibold text-ct-navy flex items-center gap-2">
                  <Webhook className="size-4" />
                  Webhooks & Integrations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <WebhookSection />
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
                  { label: "Application", value: "VERIDIAN AI", icon: ShieldCheck },
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