"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Sparkles,
  FileText,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SearchResult = {
  id: string;
  title: string;
  status: string;
  department: string;
};

type SemanticResult = {
  type: string;
  label: string;
  id: string;
  title: string;
  description?: string | null;
  complianceType?: string;
  status?: string;
  priority?: string;
  authority?: string | null;
  department?: string;
  score: number;
  snippet: string;
};

type SemanticGrouped = {
  compliance_items: SemanticResult[];
  notices: SemanticResult[];
  documents: SemanticResult[];
  other: SemanticResult[];
};

const statusBadgeStyles: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  in_progress: "bg-blue-100 text-blue-800 border-blue-200",
  completed: "bg-green-100 text-green-800 border-green-200",
  overdue: "bg-red-100 text-red-800 border-red-200",
  not_applicable: "bg-gray-100 text-gray-600 border-gray-200",
  draft: "bg-purple-100 text-purple-800 border-purple-200",
  received: "bg-orange-100 text-orange-800 border-orange-200",
  replied: "bg-teal-100 text-teal-800 border-teal-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
  appealed: "bg-purple-100 text-purple-800 border-purple-200",
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  overdue: "Overdue",
  not_applicable: "N/A",
  draft: "Draft",
  received: "Received",
  replied: "Replied",
  closed: "Closed",
  appealed: "Appealed",
};

// Shared open state via module-level variable
let openDialog: (() => void) | null = null;
let closeDialog: (() => void) | null = null;

type SearchMode = "standard" | "semantic";

function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<SearchMode>("standard");
  const [semanticResults, setSemanticResults] = useState<SemanticGrouped | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Register open/close handlers
  useEffect(() => {
    openDialog = () => setOpen(true);
    closeDialog = () => {
      setOpen(false);
      setQuery("");
      setResults([]);
      setSemanticResults(null);
    };
    return () => {
      openDialog = null;
      closeDialog = null;
    };
  }, []);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Debounced standard search
  useEffect(() => {
    if (mode !== "standard") return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/compliance?search=${encodeURIComponent(query)}&limit=8`
        );
        if (res.ok) {
          const data = await res.json();
          setResults(Array.isArray(data) ? data : data.items ?? data.compliance ?? []);
        } else {
          setResults([]);
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, mode]);

  const doSemanticSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSemanticLoading(true);
    setSemanticResults(null);
    try {
      const res = await fetch("/api/search/semantic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), limit: 8 }),
      });
      if (res.ok) {
        const data = await res.json();
        setSemanticResults(data.grouped);
      }
    } catch {
      setSemanticResults(null);
    } finally {
      setSemanticLoading(false);
    }
  }, [query]);

  const handleSemanticKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doSemanticSearch();
      }
    },
    [doSemanticSearch]
  );

  const handleSelect = useCallback(
    (id: string) => {
      setOpen(false);
      setQuery("");
      setResults([]);
      setSemanticResults(null);
      router.push(`/compliance/${id}`);
    },
    [router]
  );

  const totalSemanticResults = semanticResults
    ? semanticResults.compliance_items.length +
      semanticResults.notices.length +
      semanticResults.documents.length +
      semanticResults.other.length
    : 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQuery("");
          setResults([]);
          setSemanticResults(null);
          setMode("standard");
        }
      }}
      title="Search"
      description="Search compliance items by title, department, or status."
    >
      {/* Mode Tabs */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
        <button
          onClick={() => setMode("standard")}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            mode === "standard"
              ? "bg-ct-saffron text-white"
              : "text-ct-muted hover:text-ct-navy hover:bg-ct-cloud"
          )}
        >
          <Search className="size-3.5" />
          Standard
        </button>
        <button
          onClick={() => setMode("semantic")}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            mode === "semantic"
              ? "bg-ct-saffron text-white"
              : "text-ct-muted hover:text-ct-navy hover:bg-ct-cloud"
          )}
        >
          <Sparkles className="size-3.5" />
          AI Semantic
        </button>
      </div>

      {mode === "standard" ? (
        <>
          <CommandInput
            placeholder="Search compliance items..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {loading
                ? "Searching..."
                : query
                  ? "No compliance items found."
                  : "Type to search..."}
            </CommandEmpty>
            {results.length > 0 && (
              <CommandGroup heading="Compliance Items">
                {results.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.title}
                    onSelect={() => handleSelect(item.id)}
                    className="flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="truncate text-sm font-medium">
                        {item.title}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {item.department}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 text-[10px]",
                        statusBadgeStyles[item.status] ?? ""
                      )}
                    >
                      {statusLabels[item.status] ?? item.status}
                    </Badge>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </>
      ) : (
        <>
          <CommandInput
            placeholder="Ask anything in natural language... (press Enter to search)"
            value={query}
            onValueChange={setQuery}
            onKeyDown={handleSemanticKeyDown}
          />
          <CommandList>
            {semanticLoading ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : semanticResults && totalSemanticResults > 0 ? (
              <>
                {semanticResults.compliance_items.length > 0 && (
                  <>
                    <CommandGroup heading="Compliance Items">
                      {semanticResults.compliance_items.map((r) => (
                        <CommandItem
                          key={r.id}
                          value={r.title}
                          onSelect={() => handleSelect(r.id)}
                          className="flex items-start gap-3 cursor-pointer py-2.5"
                        >
                          <ShieldCheck className="size-4 text-ct-teal mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {r.title}
                              </span>
                              {r.complianceType && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 bg-ct-cloud shrink-0"
                                >
                                  {r.complianceType}
                                </Badge>
                              )}
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[9px] px-1.5 py-0 shrink-0 ml-auto",
                                  statusBadgeStyles[r.status ?? ""] ?? ""
                                )}
                              >
                                {statusLabels[r.status ?? ""] ?? r.status}
                              </Badge>
                            </div>
                            {r.snippet && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                                {r.snippet}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-ct-saffron font-medium">
                                {Math.round(r.score * 100)}% match
                              </span>
                              {r.department && (
                                <span className="text-[10px] text-muted-foreground">
                                  &middot; {r.department}
                                </span>
                              )}
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    {semanticResults.notices.length > 0 && (
                      <CommandSeparator />
                    )}
                  </>
                )}

                {semanticResults.notices.length > 0 && (
                  <>
                    <CommandGroup heading="Notices">
                      {semanticResults.notices.map((r) => (
                        <CommandItem
                          key={r.id}
                          value={r.title}
                          className="flex items-start gap-3 cursor-pointer py-2.5"
                        >
                          <AlertTriangle className="size-4 text-red-500 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {r.title}
                              </span>
                              {r.status && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[9px] px-1.5 py-0 shrink-0",
                                    statusBadgeStyles[r.status] ?? ""
                                  )}
                                >
                                  {statusLabels[r.status] ?? r.status}
                                </Badge>
                              )}
                            </div>
                            {r.snippet && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                                {r.snippet}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-ct-saffron font-medium">
                                {Math.round(r.score * 100)}% match
                              </span>
                              {r.authority && (
                                <span className="text-[10px] text-muted-foreground">
                                  &middot; {r.authority}
                                </span>
                              )}
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    {semanticResults.documents.length > 0 && (
                      <CommandSeparator />
                    )}
                  </>
                )}

                {semanticResults.documents.length > 0 && (
                  <CommandGroup heading="Documents">
                    {semanticResults.documents.map((r) => (
                      <CommandItem
                        key={r.id}
                        value={r.title}
                        className="flex items-start gap-3 cursor-pointer py-2.5"
                      >
                        <FileText className="size-4 text-ct-saffron mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="truncate text-sm font-medium">
                            {r.title}
                          </span>
                          {r.snippet && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {r.snippet}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-ct-saffron font-medium">
                              {Math.round(r.score * 100)}% match
                            </span>
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            ) : (
              <CommandEmpty>
                {semanticResults && totalSemanticResults === 0
                  ? "No similar results found."
                  : "Ask a question and press Enter to search with AI..."}
              </CommandEmpty>
            )}
          </CommandList>

          {/* AI Search button */}
          {query.trim() && !semanticLoading && (
            <div className="border-t border-ct-border p-3">
              <Button
                size="sm"
                className="w-full bg-ct-saffron hover:bg-ct-saffron-hover text-white text-xs"
                onClick={doSemanticSearch}
              >
                <Sparkles className="size-3.5 mr-1.5" />
                AI Semantic Search
              </Button>
            </div>
          )}
        </>
      )}
    </CommandDialog>
  );
}

export function SearchTrigger() {
  return (
    <>
      <SearchDialog />
      <Button
        variant="ghost"
        size="sm"
        className="hidden sm:flex items-center gap-2 h-9 px-3 bg-white/10 border border-white/10 text-white/60 hover:text-white hover:bg-white/15 text-sm"
        onClick={() => openDialog?.()}
      >
        <Search className="size-4" />
        <span className="hidden md:inline">Search compliance...</span>
        <kbd className="hidden lg:inline-flex items-center gap-0.5 ml-1 text-[10px] font-medium text-white/40 bg-white/10 rounded border border-white/10 px-1.5 py-0.5">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>
    </>
  );
}