"use client";

// Wave 59 (Tier 3 #13, second half): SAML SSO admin configuration UI.
// Shows this org's own SP metadata (ACS URL, entity ID) the admin gives
// to their IdP, and a form for the IdP's own entry point/issuer/cert.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type SsoConfig = { idpEntryPoint: string; idpIssuer: string; idpCert: string; spEntityId: string; isEnabled: boolean } | null;

export default function SsoSection() {
  const [config, setConfig] = useState<SsoConfig>(null);
  const [orgSlug, setOrgSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [idpEntryPoint, setIdpEntryPoint] = useState("");
  const [idpIssuer, setIdpIssuer] = useState("");
  const [idpCert, setIdpCert] = useState("");
  const [spEntityId, setSpEntityId] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);

  const load = useCallback(() => {
    Promise.all([fetch("/api/settings/sso"), fetch("/api/me")])
      .then(([ssoRes, meRes]) => Promise.all([ssoRes.json(), meRes.json()]))
      .then(([ssoData, meData]) => {
        setOrgSlug(meData.orgSlug ?? "");
        const cfg: SsoConfig = ssoData.configuration;
        setConfig(cfg);
        setIdpEntryPoint(cfg?.idpEntryPoint ?? "");
        setIdpIssuer(cfg?.idpIssuer ?? "");
        setIdpCert(cfg?.idpCert ?? "");
        setSpEntityId(cfg?.spEntityId ?? (meData.orgSlug ? `veridian-${meData.orgSlug}` : ""));
        setIsEnabled(cfg?.isEnabled ?? false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const save = async () => {
    setSaving(true);
    const res = await fetch("/api/settings/sso", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idpEntryPoint, idpIssuer, idpCert, spEntityId, isEnabled }),
    });
    setSaving(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error ?? "Failed to save SSO configuration"); return; }
    toast.success("SSO configuration saved");
    load();
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const acsUrl = orgSlug ? `${window.location.origin}/api/auth/sso/${orgSlug}/acs` : "";
  const loginUrl = orgSlug ? `${window.location.origin}/api/auth/sso/${orgSlug}/login` : "";

  if (loading) return <div className="p-4 text-sm text-ct-muted">Loading…</div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-ct-muted bg-amber-50 rounded px-2 py-1">
        SAML login only authenticates users who already have a VERIDIAN account in this organisation — it never creates new accounts from an IdP assertion. Verify this configuration against your identity provider before enabling for real users.
      </p>

      <div className="space-y-2">
        <Label className="text-xs text-ct-muted">Your ACS (Assertion Consumer Service) URL — give this to your IdP</Label>
        <div className="flex gap-2">
          <Input readOnly value={acsUrl} className="text-xs font-mono" />
          <Button size="sm" variant="outline" onClick={() => copy(acsUrl, "ACS URL")}><Copy className="w-3 h-3" /></Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-ct-muted">SSO Login URL — where your users start SAML login</Label>
        <div className="flex gap-2">
          <Input readOnly value={loginUrl} className="text-xs font-mono" />
          <Button size="sm" variant="outline" onClick={() => copy(loginUrl, "Login URL")}><Copy className="w-3 h-3" /></Button>
        </div>
      </div>

      <div><Label>Our SP Entity ID (give this to your IdP as the audience)</Label><Input value={spEntityId} onChange={(e) => setSpEntityId(e.target.value)} /></div>
      <div><Label>IdP Entry Point (your IdP's SSO redirect URL)</Label><Input value={idpEntryPoint} onChange={(e) => setIdpEntryPoint(e.target.value)} placeholder="https://your-idp.example.com/sso/saml" /></div>
      <div><Label>IdP Issuer / Entity ID</Label><Input value={idpIssuer} onChange={(e) => setIdpIssuer(e.target.value)} placeholder="https://your-idp.example.com/metadata" /></div>
      <div><Label>IdP X.509 Signing Certificate (PEM)</Label><textarea className="w-full border border-ct-border rounded-md p-2 text-xs font-mono h-32" value={idpCert} onChange={(e) => setIdpCert(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----..." /></div>

      <div className="flex items-center gap-2">
        <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
        <Label>Enable SAML SSO for this organisation</Label>
      </div>

      <Button onClick={save} disabled={saving} className="bg-ct-teal hover:bg-ct-teal-hover text-white">
        {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save
      </Button>
    </div>
  );
}
