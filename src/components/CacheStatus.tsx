import { lastUpdatedLabel } from "@/lib/offline-cache";

/** Subtle line telling you the view is cached: updating now, or stuck after a failed refresh. */
export function CacheStatus({
  updating,
  stale,
  lastUpdated,
}: {
  updating: boolean;
  stale: boolean;
  lastUpdated: number | null;
}) {
  if (!updating && !stale) return null;

  return (
    <p className="text-[11px] text-muted-foreground" aria-live="polite">
      {updating ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="live-dot size-1.5 rounded-full bg-muted-foreground" aria-hidden="true" />
          Updating…
        </span>
      ) : (
        <>Could not refresh · last updated {lastUpdated ? lastUpdatedLabel(lastUpdated) : "earlier"}</>
      )}
    </p>
  );
}
