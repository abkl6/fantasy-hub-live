import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, Loader2, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { InstallHint } from "@/components/InstallHint";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  getNotificationPrefs,
  saveNotificationPrefs,
  type NotificationPrefs,
} from "@/lib/push.functions";
import { currentSubscription, disablePush, enablePush, pushSupported } from "@/lib/push/client";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Gridiron Edge" },
      {
        name: "description",
        content:
          "Choose which fantasy football alerts reach your phone: inactive starters, scoring plays, red zone, lead changes and lineup lock reminders.",
      },
      { property: "og:title", content: "Settings — Gridiron Edge" },
      {
        property: "og:description",
        content: "Turn game-day alerts on or off for every device you use.",
      },
    ],
  }),
  component: SettingsPage,
});

const TOGGLES: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  {
    key: "inactives",
    label: "Inactive starters",
    hint: "A starter is ruled out — tap the alert to swap in the best bench option.",
  },
  { key: "scoring_plays", label: "Scoring plays", hint: "Every time one of your starters scores." },
  { key: "red_zone", label: "Red zone", hint: "Your starter's team reaches the opponent's 20." },
  { key: "lead_change", label: "Matchup lead change", hint: "Whenever a matchup flips." },
  {
    key: "lineup_lock",
    label: "Lineup lock reminder",
    hint: "One nudge in the hour before kickoff.",
  },
];

function SettingsPage() {
  const load = useServerFn(getNotificationPrefs);
  const save = useServerFn(saveNotificationPrefs);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["notification-prefs"], queryFn: () => load() });
  const [deviceOn, setDeviceOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    currentSubscription().then((sub) => setDeviceOn(!!sub));
  }, []);

  const mutate = useMutation({
    mutationFn: (patch: Partial<NotificationPrefs>) => save({ data: patch }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-prefs"] }),
    onError: () => toast.error("We couldn't save that. Try again."),
  });

  const prefs = data?.prefs;

  const turnOn = async () => {
    setBusy(true);
    try {
      const status = await enablePush();
      if (status === "registered") {
        setDeviceOn(true);
        toast.success("Alerts are on for this device.");
      } else if (status === "open-in-new-tab") {
        toast.error("Open the app in its own tab or from your home screen, then try again.");
      } else if (status === "denied") {
        toast.error("Your browser blocked notifications. Allow them in site settings.");
      } else if (status === "unsupported") {
        toast.error("This browser can't show push alerts. On iPhone, install the app first.");
      } else {
        toast.error("Alerts aren't configured yet.");
      }
    } catch {
      toast.error("We couldn't turn alerts on.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    await disablePush().catch(() => undefined);
    setDeviceOn(false);
    setBusy(false);
    toast.success("Alerts are off for this device.");
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <InstallHint />
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="mt-6 space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground">Notifications</h2>

        <div className="rounded-xl bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 font-medium">
                <Smartphone className="size-4 text-primary" aria-hidden="true" />
                This device
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {deviceOn
                  ? "Alerts are on here. Turn them off to stop notifications on this device only."
                  : "Turn alerts on to get game-day notifications on this device."}
              </p>
            </div>
            <Button
              onClick={deviceOn ? turnOff : turnOn}
              disabled={busy || !pushSupported()}
              variant={deviceOn ? "outline" : "default"}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : deviceOn ? (
                <BellOff className="size-4" aria-hidden="true" />
              ) : (
                <Bell className="size-4" aria-hidden="true" />
              )}
              {deviceOn ? "Turn off" : "Turn on"}
            </Button>
          </div>
          {!!data?.devices.length && (
            <p className="mt-3 text-xs text-muted-foreground">
              {data.devices.length} device{data.devices.length > 1 ? "s" : ""} receiving alerts.
            </p>
          )}
        </div>

        {isLoading || !prefs ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : (
          <div className="divide-y divide-border rounded-xl bg-card">
            {TOGGLES.map(({ key, label, hint }) => (
              <div key={key} className="flex items-start justify-between gap-4 p-4">
                <div>
                  <p className="font-medium">{label}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
                </div>
                <Switch
                  checked={prefs[key]}
                  aria-label={label}
                  onCheckedChange={(checked) => mutate.mutate({ [key]: checked })}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
