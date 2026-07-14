"use client"

import * as React from "react"
import { GripVerticalIcon } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

// react-resizable-panels v4's `useDefaultLayout` hook defaults its
// `storage` param to a bare `storage = localStorage` reference, evaluated
// eagerly at call time regardless of environment -- during Next.js's
// server-side prerendering there is no `window`, and the `localStorage`
// global binding Node itself exposes there is `undefined` (not a
// ReferenceError), so the library's own default crashes with "Cannot read
// properties of undefined (reading 'getItem')" the moment any page
// containing a persisted Group is statically prerendered. Any caller using
// `useDefaultLayout` for layout persistence must pass this SSR-safe
// storage explicitly instead of relying on the library's default.
export const ssrSafeLocalStorage: Pick<Storage, "getItem" | "setItem"> =
  typeof window === "undefined"
    ? { getItem: () => null, setItem: () => {} }
    : window.localStorage

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      // react-resizable-panels v4 (Group) applies flex-direction as an
      // inline style directly, driven by the `orientation` prop -- it no
      // longer emits the v3 `data-panel-group-direction` attribute this
      // used to key off of, so no vertical-variant class is needed here.
      className={cn("flex h-full w-full", className)}
      {...props}
    />
  )
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      // v4's PanelResizeHandle -> Separator rename also dropped the v3
      // `data-panel-group-direction` attribute in favor of the standard
      // ARIA `aria-orientation` attribute (set on this same element, per
      // the ARIA "separator" role spec) -- keyed off that instead.
      className={cn(
        "bg-border focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden aria-[orientation=vertical]:h-px aria-[orientation=vertical]:w-full aria-[orientation=vertical]:after:left-0 aria-[orientation=vertical]:after:h-1 aria-[orientation=vertical]:after:w-full aria-[orientation=vertical]:after:translate-x-0 aria-[orientation=vertical]:after:-translate-y-1/2 [&[aria-orientation=vertical]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border">
          <GripVerticalIcon className="size-2.5" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
