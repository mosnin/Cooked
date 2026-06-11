/**
 * /s/[slug]/chippi/loading.tsx — Suspense fallback for the Chippi chat home.
 *
 * Mirrors the empty-state hero in chippi-workspace.tsx so the realtor sees
 * the real surface fading in, not a separate broken page. Two shapes only:
 *
 *   - a centered serif-h1-sized placeholder where the greeting will land
 *   - a composer-sized rounded rectangle pinned to the bottom
 *
 * Without this file, Next.js falls back to /s/[slug]/loading.tsx — a dense
 * dashboard skeleton (KPI grid + tile cards) that has nothing to do with
 * the chat surface and reads as "a different page glitching in" on mobile.
 */
export default function ChippiLoading() {
  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* Centered hero — placeholder for the greeting ("Good morning, …").
          h-10 matches the visual height of text-[2.25rem] sm:text-[2.75rem]
          on the real heading; w-2/3 max-w-md tracks the typical greeting
          length without leaking past the composer's max-w-2xl below. */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pb-16 sm:pb-20">
        <div className="w-full max-w-2xl flex flex-col items-center">
          <div
            className="h-10 w-2/3 max-w-md rounded-lg bg-muted/40 animate-pulse"
            aria-hidden
          />
        </div>
      </div>
      {/* Composer placeholder — matches the docked input's bottom position,
          max-width, and rounded shape so it doesn't lurch when the real
          composer mounts in its place. */}
      <div className="sticky bottom-0 z-10 w-full max-w-3xl mx-auto chat-content-wrap pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div
          className="h-14 w-full rounded-2xl bg-muted/40 animate-pulse"
          aria-hidden
        />
      </div>
      <span className="sr-only">Loading Chippi…</span>
    </div>
  );
}
