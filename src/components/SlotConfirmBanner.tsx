import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { SlotEditor } from "@/components/SlotEditor";
import { Button } from "@/components/ui/button";
import { confirmLeagueSlots, saveLeagueSlots } from "@/lib/slots.functions";
import type { LeagueSlot } from "@/lib/fantasy/slots";

interface Props {
  leagueId: string;
  slots?: { key: string; label: string; eligible: string[] }[] | null;
  onSaved: () => void;
}

/**
 * Shown only when the app had to work out for itself what a lineup spot
 * accepts. Once the member answers, syncing never changes it again.
 */
export function SlotConfirmBanner({ leagueId, slots, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LeagueSlot[]>([]);

  const confirm = useMutation({
    mutationFn: () => confirmLeagueSlots({ data: { leagueId } }),
    onSuccess: () => {
      toast.success("Lineup spots confirmed.");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
      setEditing(false);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const list = slots ?? [];
  if (!list.length) return null;

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-bold">Check your lineup spots</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your league didn&apos;t say what these spots take, so we worked it out from what teams
        have started: {list.map((s) => `${s.label} — ${s.eligible.join(", ") || "unknown"}`).join("; ")}.
      </p>

      {editing ? (
        <div className="mt-3 space-y-3">
          <SlotEditor slots={draft} onChange={setDraft} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              Save spots
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
            That&apos;s right
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(
                list.map((s) => ({
                  key: s.key,
                  label: s.label,
                  count: 1,
                  eligible: s.eligible,
                  source: "user" as const,
                })),
              );
              setEditing(true);
            }}
          >
            Change them
          </Button>
        </div>
      )}
    </section>
  );
}
