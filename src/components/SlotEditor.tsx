import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CANONICAL_ORDER } from "@/lib/fantasy/eligibility";
import { slotLabel, type LeagueSlot } from "@/lib/fantasy/slots";

interface Props {
  slots: LeagueSlot[];
  onChange: (slots: LeagueSlot[]) => void;
}

/**
 * Adds, counts and sets the positions for each starting spot. The same editor
 * serves the manual set-up wizard and the league page's confirmation step.
 */
export function SlotEditor({ slots, onChange }: Props) {
  const [newKey, setNewKey] = useState("");

  const update = (i: number, patch: Partial<LeagueSlot>) => {
    onChange(
      slots.map((slot, si) => {
        if (si !== i) return slot;
        const next = { ...slot, ...patch, source: "user" as const };
        if (patch.eligible) next.label = slotLabel(next.key, next.eligible);
        return next;
      }),
    );
  };

  const togglePosition = (i: number, position: string) => {
    const slot = slots[i]!;
    const eligible = slot.eligible.includes(position)
      ? slot.eligible.filter((p) => p !== position)
      : [...slot.eligible, position];
    update(i, { eligible });
  };

  const add = () => {
    const key = newKey.trim().toUpperCase();
    if (!key || slots.some((s) => s.key === key)) return;
    onChange([...slots, { key, label: key, count: 1, eligible: [], source: "user" }]);
    setNewKey("");
  };

  return (
    <div className="space-y-3">
      {slots.map((slot, i) => (
        <div key={slot.key} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{slot.label}</span>
            <Label className="text-xs text-muted-foreground" htmlFor={`count-${slot.key}`}>
              How many
            </Label>
            <Input
              id={`count-${slot.key}`}
              type="number"
              min={0}
              max={12}
              value={slot.count}
              onChange={(e) => update(i, { count: Number(e.target.value) })}
              className="h-8 w-20"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(slots.filter((_, si) => si !== i))}
            >
              Remove
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {CANONICAL_ORDER.map((position) => (
              <Button
                key={position}
                type="button"
                size="sm"
                variant={slot.eligible.includes(position) ? "default" : "outline"}
                aria-pressed={slot.eligible.includes(position)}
                onClick={() => togglePosition(i, position)}
              >
                {position}
              </Button>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="Add a spot, e.g. FLEX"
          className="h-9 w-56"
          aria-label="New lineup spot"
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Add spot
        </Button>
      </div>
    </div>
  );
}
