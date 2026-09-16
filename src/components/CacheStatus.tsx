import { lastUpdatedLabel } from "@/lib/offline-cache";

/**
 * Subtle line telling you how fresh the view is: when the stored result was
 * built, that it is updating now, or that a refresh failed.
 */
export function CacheStatus({
  updating,
  stale,
  lastUpdated,
  computedAt,
}: {
  updating: boolean;
  stale: boolean;
  lastUpdated: number | null;
  /** When the server built the stored result, if it came from the cache. */
  computedAt?: string | null | undefined;
}) {
  const computed = computedAt ? new Date(computedAt).getTime() : null;

  if (!updating && !stale) {
    if (!computed || Number.isNaN(computed)) return null;
    return (
      <p className="text-[11px] text-muted-foreground" aria-live="polite">
        Updated {lastUpdatedLabel(computed)}
      </p>
    );
  }

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

