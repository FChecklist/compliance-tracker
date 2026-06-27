"use client";
import { useState } from "react";
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Modal, Textarea, Select } from "@compliance/ui";
import { Save, AlertTriangle, Globe, Palette, Shield, Building2 } from "lucide-react";

export default function SettingsPage() {
  const [orgForm, setOrgForm] = useState({ name: "", slug: "", timezone: "Asia/Calcutta" });
  const [dangerOpen, setDangerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/orgs/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orgForm),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">Manage your organisation settings</p>
      </div>

      {saved && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700 font-medium">
          Settings saved successfully.
        </div>
      )}

      {/* Organisation Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-gray-500" />
            <CardTitle className="text-base">Organisation</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Organisation Name"
            placeholder="My Organisation"
            value={orgForm.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOrgForm((p) => ({ ...p, name: e.target.value }))}
          />
          <Input
            label="Slug"
            placeholder="my-organisation"
            value={orgForm.slug}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOrgForm((p) => ({ ...p, slug: e.target.value }))}
            description="Used in URLs. Must be unique."
          />
          <Select
            label="Timezone"
            value={orgForm.timezone}
            onChange={(v) => setOrgForm((p) => ({ ...p, timezone: v }))}
            options={[
              { label: "Asia/Calcutta (IST)", value: "Asia/Calcutta" },
              { label: "America/New_York (EST)", value: "America/New_York" },
              { label: "America/Chicago (CST)", value: "America/Chicago" },
              { label: "Europe/London (GMT)", value: "Europe/London" },
              { label: "Asia/Dubai (GST)", value: "Asia/Dubai" },
              { label: "Asia/Singapore (SGT)", value: "Asia/Singapore" },
              { label: "Australia/Sydney (AEST)", value: "Australia/Sydney" },
              { label: "UTC", value: "UTC" },
            ]}
          />
          <div className="pt-3">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />{saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-gray-500" />
            <CardTitle className="text-base">Appearance</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-4">Choose your preferred theme</p>
          <div className="flex gap-4">
            <button
              onClick={() => setTheme("light")}
              className={`flex-1 p-4 rounded-xl border-2 transition-colors ${theme === "light" ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}
            >
              <div className="w-full h-16 rounded-lg bg-white border border-gray-200 mb-3 flex items-center justify-center">
                <div className="w-3/4 space-y-1.5">
                  <div className="h-1.5 bg-gray-300 rounded w-full" />
                  <div className="h-1.5 bg-gray-200 rounded w-3/4" />
                  <div className="h-1.5 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
              <p className="text-sm font-medium text-gray-900">Light</p>
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={`flex-1 p-4 rounded-xl border-2 transition-colors ${theme === "dark" ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"}`}
            >
              <div className="w-full h-16 rounded-lg bg-gray-800 mb-3 flex items-center justify-center">
                <div className="w-3/4 space-y-1.5">
                  <div className="h-1.5 bg-gray-600 rounded w-full" />
                  <div className="h-1.5 bg-gray-700 rounded w-3/4" />
                  <div className="h-1.5 bg-gray-700 rounded w-1/2" />
                </div>
              </div>
              <p className="text-sm font-medium text-gray-900">Dark</p>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-gray-500" />
            <CardTitle className="text-base">Security</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
            <div>
              <p className="text-sm font-medium text-gray-900">Two-Factor Authentication</p>
              <p className="text-xs text-gray-500">Add an extra layer of security to your account</p>
            </div>
            <Button variant="outline" size="sm">Enable</Button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
            <div>
              <p className="text-sm font-medium text-gray-900">API Tokens</p>
              <p className="text-xs text-gray-500">Manage API tokens for integrations</p>
            </div>
            <Button variant="outline" size="sm">Manage</Button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200">
            <div>
              <p className="text-sm font-medium text-gray-900">Webhooks</p>
              <p className="text-xs text-gray-500">Configure webhook endpoints for events</p>
            </div>
            <Button variant="outline" size="sm">Configure</Button>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <CardTitle className="text-base text-red-700">Danger Zone</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 rounded-lg bg-red-50 border border-red-200">
            <div>
              <p className="text-sm font-medium text-red-900">Delete Organisation</p>
              <p className="text-xs text-red-600">Permanently delete your organisation and all its data. This cannot be undone.</p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setDangerOpen(true)}>Delete</Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Modal */}
      <Modal open={dangerOpen} onClose={() => setDangerOpen(false)} title="Delete Organisation" description="This action is permanent and cannot be undone." footer={
        <>
          <Button variant="outline" onClick={() => setDangerOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => { setDangerOpen(false); }}>Delete Organisation</Button>
        </>
      }>
        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-800">
            Type <strong>DELETE</strong> to confirm. All compliance items, documents, users, and audit history will be permanently removed.
          </p>
        </div>
        <Input placeholder='Type "DELETE" to confirm' className="mt-4" />
      </Modal>
    </div>
  );
}