"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Loader2, Image as ImageIcon, Palette, Globe, Mail, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface Branding {
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  customDomain: string | null;
  emailSenderName: string | null;
  isCustomized: boolean;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Wave B (VERIDIAN Review Framework remediation, "BYOB white-label
// branding", 2026-07-17): org-branding-service.ts plus its
// /api/settings/branding[/logo] routes were built with no settings surface
// at all before this -- this is that surface, following OrgLimitsSection.tsx
// (Areas 16/11 admin-UI gap-close precedent) for load/save/loading-skeleton
// structure.
export default function BrandingSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const [branding, setBranding] = useState<Branding | null>(null);

  const [primaryColor, setPrimaryColor] = useState("#1C2B3A");
  const [accentColor, setAccentColor] = useState("#F5820A");
  const [customDomain, setCustomDomain] = useState("");
  const [emailSenderName, setEmailSenderName] = useState("");

  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/branding");
      if (!res.ok) return;
      const data = await res.json();
      const b: Branding = data.branding;
      setBranding(b);
      setPrimaryColor(b.primaryColor);
      setAccentColor(b.accentColor);
      setCustomDomain(b.customDomain ?? "");
      setEmailSenderName(b.emailSenderName ?? "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveColorsAndDetails() {
    if (!HEX_RE.test(primaryColor) || !HEX_RE.test(accentColor)) {
      toast.error("Colors must be 6-digit hex values, e.g. #1C2B3A");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryColor,
          accentColor,
          customDomain: customDomain.trim() === "" ? null : customDomain.trim(),
          emailSenderName: emailSenderName.trim() === "" ? null : emailSenderName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to update branding");
        return;
      }
      setBranding(data.branding);
      toast.success("Branding updated");
    } finally {
      setSaving(false);
    }
  }

  async function uploadAsset(kind: "logo" | "favicon", file: File) {
    const setUploading = kind === "logo" ? setUploadingLogo : setUploadingFavicon;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", kind);
      const res = await fetch("/api/settings/branding/logo", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to upload " + kind);
        return;
      }
      setBranding(data.branding);
      toast.success(kind === "logo" ? "Logo updated" : "Favicon updated");
    } finally {
      setUploading(false);
    }
  }

  async function resetAsset(kind: "logo" | "favicon") {
    const setUploading = kind === "logo" ? setUploadingLogo : setUploadingFavicon;
    setUploading(true);
    try {
      const res = await fetch("/api/settings/branding/logo?kind=" + kind, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to reset " + kind);
        return;
      }
      setBranding(data.branding);
      toast.success(kind === "logo" ? "Logo reset to default" : "Favicon reset to default");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Logo & Favicon */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Logo and Favicon</h4>
          {branding?.isCustomized && <Badge variant="outline">Customized</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          PNG, JPEG, WebP, SVG or ICO, up to 2 MB. Replaces the default VERIDIAN AI mark in the sidebar for everyone in this organisation.
        </p>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-md border border-ct-border flex items-center justify-center bg-ct-cloud overflow-hidden">
              {/* Arbitrary org-supplied Supabase Storage URL -- next/image would need it added to remotePatterns per-tenant, which defeats the point (plain <img>, matching MfaSection.tsx's own precedent for a dynamic, non-local image source). */}
              <img src={branding?.logoUrl || "/logo-mark.svg"} alt="Current logo" className="max-h-full max-w-full object-contain" />
            </div>
            <div className="space-y-1">
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={uploadingLogo} onClick={() => logoInputRef.current?.click()}>
                  {uploadingLogo ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
                  Upload logo
                </Button>
                {branding?.logoUrl && (
                  <Button size="sm" variant="ghost" disabled={uploadingLogo} onClick={() => resetAsset("logo")}>
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Reset
                  </Button>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadAsset("logo", file);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="size-12 rounded-md border border-ct-border flex items-center justify-center bg-ct-cloud overflow-hidden">
              <img src={branding?.faviconUrl || "/logo-mark.svg"} alt="Current favicon" className="max-h-8 max-w-8 object-contain" />
            </div>
            <div className="space-y-1">
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={uploadingFavicon} onClick={() => faviconInputRef.current?.click()}>
                  {uploadingFavicon ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
                  Upload favicon
                </Button>
                {branding?.faviconUrl && (
                  <Button size="sm" variant="ghost" disabled={uploadingFavicon} onClick={() => resetAsset("favicon")}>
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Reset
                  </Button>
                )}
              </div>
              <input
                ref={faviconInputRef}
                type="file"
                accept="image/png,image/x-icon,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadAsset("favicon", file);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* Brand Colors */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Brand Colors</h4>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label htmlFor="primary-color" className="text-xs">Primary color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Primary color picker"
                value={HEX_RE.test(primaryColor) ? primaryColor : "#1C2B3A"}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-9 w-9 rounded border border-input cursor-pointer"
              />
              <Input id="primary-color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-28 font-mono text-xs" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="accent-color" className="text-xs">Accent color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Accent color picker"
                value={HEX_RE.test(accentColor) ? accentColor : "#F5820A"}
                onChange={(e) => setAccentColor(e.target.value)}
                className="h-9 w-9 rounded border border-input cursor-pointer"
              />
              <Input id="accent-color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-28 font-mono text-xs" />
            </div>
          </div>

          {/* Live preview -- a small mock of the sidebar logo header block, so
              an admin can see the actual effect before saving, without
              leaving the settings page. */}
          <div className="space-y-1">
            <Label className="text-xs">Live preview</Label>
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-md border-b-2 bg-white shadow-sm"
              style={{ borderBottomColor: HEX_RE.test(accentColor) ? accentColor : "#F5820A" }}
            >
              <img src={branding?.logoUrl || "/logo-mark.svg"} alt="Logo preview" className="size-6 object-contain rounded-sm" />
              <span
                className="font-heading text-sm tracking-tight"
                style={{ color: HEX_RE.test(primaryColor) ? primaryColor : "#1C2B3A" }}
              >
                {branding?.logoUrl ? "Your Organisation" : "VERIDIAN AI"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* Custom Domain (advanced, deliberately descoped beyond storing the request) */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Custom Domain</h4>
          <Badge variant="outline">Advanced</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Reserve the domain you would like to use for this organisation (e.g. reports.acme.com). This only records the request --
          DNS verification, TLS certificate provisioning, and actually routing traffic to this domain are not yet implemented and
          require a separate infrastructure setup. Contact support once you are ready to activate it.
        </p>
        <div className="max-w-xs space-y-1">
          <Label htmlFor="custom-domain" className="text-xs">Requested domain</Label>
          <Input id="custom-domain" placeholder="reports.acme.com" value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} className="h-9" />
        </div>
      </div>

      <Separator />

      {/* Email sender name */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Email Sender Name</h4>
        </div>
        <div className="max-w-xs space-y-1">
          <Label htmlFor="email-sender-name" className="text-xs">Display name</Label>
          <Input id="email-sender-name" placeholder="Acme Corp Notifications" value={emailSenderName} onChange={(e) => setEmailSenderName(e.target.value)} className="h-9" maxLength={100} />
        </div>
      </div>

      <div className="pt-2">
        <Button size="sm" disabled={saving} onClick={saveColorsAndDetails}>
          {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}
