"use client";

// Wave 26 (PageAgent integration). Mounted once, globally, in AppShell --
// makes every authenticated VERIDIAN screen AI-enabled by default.
//
// Never calls a real provider or holds a real API key client-side --
// `customFetch` redirects every LLM call the library makes to
// /api/page-agent/proxy, which resolves the real provider/model/key
// server-side (personal config -> org config -> platform default) and
// injects the Purpose-Bound AI clause.
//
// PageAgent is NOT mounted at all on /posh or /whistleblower (user
// decision, following a caught confidentiality gap): the original
// "read-only mode" design only blocked clickElement/inputText via
// customTools, but PageAgent's core mechanism -- reading the DOM as text
// and sending it to the LLM -- would still transmit actual POSH/
// whistleblower case content to Groq/OpenAI/a user's BYO endpoint
// regardless of which actions are allowed. Disabling the agent entirely
// on these routes is the only way to keep case content out of any AI/
// audit path, matching this codebase's established confidentiality
// principle. The proxy route also hard-rejects any request whose
// pathname matches these prefixes server-side, so this is not solely a
// client-side restriction.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { PageAgent as PageAgentType } from "page-agent";

const RESTRICTED_PREFIXES = ["/posh", "/whistleblower"];

// Global kill switch: PageAgent disabled across all of VERIDIAN, all orgs,
// regardless of any org's stored pageAgentEnabled value. Existing orgs
// created before Wave 24's schema default flip still have that column set
// to true, so the per-org DB flag alone doesn't turn it off everywhere --
// this short-circuits the mount before /api/page-agent/config is even
// called. Mirrors the enforcement below in /api/page-agent/proxy.
const PAGE_AGENT_ENABLED = false;

type PageAgentConfigResponse = { enabled: boolean; hasModelConfigured: boolean };

export default function PageAgentInitializer() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const [config, setConfig] = useState<PageAgentConfigResponse | null>(null);
  const agentRef = useRef<PageAgentType | null>(null);

  useEffect(() => {
    if (!PAGE_AGENT_ENABLED) return;
    let cancelled = false;
    fetch("/api/page-agent/config")
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setConfig(data); })
      .catch(() => { if (!cancelled) setConfig({ enabled: false, hasModelConfigured: false }); });
    return () => { cancelled = true; };
  }, []);

  const isRestricted = RESTRICTED_PREFIXES.some((p) => pathname?.startsWith(p));

  useEffect(() => {
    // Not a client-side mode toggle -- the agent is never constructed, never
    // reads the DOM, and never calls the proxy on these routes at all.
    if (isRestricted) return;
    if (!config?.enabled || !config?.hasModelConfigured) return;

    let disposed = false;
    import("page-agent").then(({ PageAgent }) => {
      if (disposed) return;

      const agent = new PageAgent({
        // Never a real endpoint/key -- customFetch below intercepts every
        // call before it would ever reach this URL.
        baseURL: "/api/page-agent/proxy",
        apiKey: "proxied",
        model: "proxied",
        language: "en-US",
        customFetch: async (_input, init) => {
          const body = init?.body ? JSON.parse(init.body as string) : {};
          return fetch("/api/page-agent/proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, pathname: pathnameRef.current }),
            credentials: "same-origin",
          });
        },
      });

      agentRef.current = agent;
      agent.panel.show();
      window.pageAgent = agent;
    });

    return () => {
      disposed = true;
      agentRef.current?.dispose();
      agentRef.current = null;
    };
  }, [config, isRestricted]);

  return null;
}
