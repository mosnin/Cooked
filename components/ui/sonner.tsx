"use client"

import { Toaster as SonnerToaster } from "sonner"

/**
 * Toast surface for the whole app.
 *
 * Wraps `sonner`'s `<Toaster>` with the system styling. The actual slide-in
 * keyframe + Apple-curve easing for toast enter/exit lives in
 * `app/globals.css` under the `Toast (Sonner) motion polish` block —
 * Sonner controls its own animation timeline at the DOM level, so the only
 * way to retune it is global CSS targeting Sonner's data attributes.
 *
 * Single source: `app/layout.tsx` mounts <Toaster /> from this file.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      theme="system"
      toastOptions={{
        duration: 3500,
        unstyled: true,
        classNames: {
          toast:
            "group pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border/70 bg-popover p-3.5 text-foreground shadow-lg shadow-foreground/5 transition-all duration-150",
          title: "text-sm font-medium leading-snug text-foreground",
          description: "text-[13px] leading-snug text-muted-foreground",
          actionButton:
            "rounded-md bg-foreground px-2.5 py-1 text-[13px] font-medium text-background transition-colors duration-150 hover:bg-foreground/90",
          cancelButton:
            "rounded-md bg-muted px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/80",
          closeButton:
            "rounded-md border border-border/70 bg-background text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground",
          success: "border-l-2 border-l-emerald-500/70",
          error: "border-l-2 border-l-red-500/70",
          warning: "border-l-2 border-l-orange-500/70",
          info: "border-l-2 border-l-sky-500/70",
        },
      }}
    />
  )
}
