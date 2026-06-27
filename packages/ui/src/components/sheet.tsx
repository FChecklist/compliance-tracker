import * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "./button";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  side?: "left" | "right";
  className?: string;
}

export function Sheet({ open, onClose, title, children, side = "right", className }: SheetProps) {
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        className={cn(
          "fixed top-0 z-50 h-full w-80 bg-white shadow-xl border-l border-gray-100 transition-transform",
          side === "left" ? "left-0 border-l-0 border-r" : "right-0",
          className
        )}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              &#10005;
            </Button>
          </div>
        )}
        <div className="overflow-y-auto h-[calc(100%-52px)] p-4">{children}</div>
      </div>
    </>
  );
}