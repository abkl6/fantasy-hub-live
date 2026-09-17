import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getMyEntitlement } from "@/lib/entitlements.functions";
import { hasPremium, type Entitlement } from "@/lib/entitlements";

/**
 * One hook for every Premium gate in the app. While the answer is loading we
 * assume Premium so paid sections never flash an upsell at a paying member.
 */
export function usePremium() {
  const load = useServerFn(getMyEntitlement);
  const query = useQuery({
    queryKey: ["entitlement"],
    queryFn: () => load(),
    staleTime: 5 * 60_000,
  });

  const entitlement = (query.data ?? null) as Entitlement | null;
  return {
    entitlement,
    loading: query.isLoading,
    premium: query.isLoading ? true : hasPremium(entitlement),
  };
}
