import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SlotEditor } from "@/components/SlotEditor";
import { Button } from "@/components/ui/button";
import { getLeagueSlots, saveLeagueSlots } from "@/lib/slots.functions";
import type { LeagueSlot } from "@/lib/fantasy/slots";

interface Props {
  leagueId: string;
  onSaved: () => void;
}

/**
 * Lets a member correct the starting spots for any league, not just manual
 * ones — a platform page that could not be read no longer leaves them stuck
 * with positions their league does not start.
 */
export function LineupSpotsCard({ leagueId, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LeagueSlot[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["league-slots", leagueId],
    queryFn: () => getLeagueSlots({ data: { leagueId } }),
    enabled: open,
  });

  useEffect(() => {
    if (data?.slots) setDraft(data.slots as LeagueSlot[]);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      saveLeagueSlots({
        data: {
          leagueId,
          slots: draft.map((s) => ({
            key: s.key,
            label: s.label,
            count: s.count,
            eligible: s.eligible,
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Lineup spots saved.");
      setOpen(false);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) {
    return (
      <div className="mt-6">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Edit lineup spots
        </Button>
      </div>
    );
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-bold">Lineup spots</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Set what your league actually starts. Remove a spot your league does not use and it stops
        appearing in advice, lists and position buttons.
      </p>
      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading your spots…</p>
      ) : (
        <div className="mt-3 space-y-3">
          <SlotEditor slots={draft} onChange={setDraft} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              Save spots
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
