"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type SearchResult = {
  id: string;
  title: string;
  status: string;
  department: string;
};

const statusBadgeStyles: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  in_progress: "bg-blue-100 text-blue-800 border-blue-200",
  completed: "bg-green-100 text-green-800 border-green-200",
  overdue: "bg-red-100 text-red-800 border-red-200",
  not_applicable: "bg-gray-100 text-gray-600 border-gray-200",
  draft: "bg-purple-100 text-purple-800 border-purple-200",
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  overdue: "Overdue",
  not_applicable: "N/A",
  draft: "Draft",
};

// Shared open state via module-level variable
let openDialog: (() => void) | null = null;
let closeDialog: (() => void) | null = null;

function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Register open/close handlers
  useEffect(() => {
    openDialog = () => setOpen(true);
    closeDialog = () => {
      setOpen(false);
      setQuery("");
      setResults([]);
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

  // Debounced search
  useEffect(() => {
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
          setResults(Array.isArray(data) ? data : data.items ?? []);
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
  }, [query]);

  const handleSelect = useCallback(
    (id: string) => {
      setOpen(false);
      setQuery("");
      setResults([]);
      router.push(`/compliance/${id}`);
    },
    [router]
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQuery("");
          setResults([]);
        }
      }}
      title="Search Compliance"
      description="Search compliance items by title, department, or status."
    >
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
                  className={`shrink-0 text-[10px] ${statusBadgeStyles[item.status] ?? ""}`}
                >
                  {statusLabels[item.status] ?? item.status}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
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