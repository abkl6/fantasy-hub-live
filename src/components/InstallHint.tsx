import { Share, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { isIosSafariNotInstalled } from "@/lib/push/client";

const DISMISS_KEY = "ge-install-hint-dismissed";

/** Nudges iPhone users to add the app to their home screen (iOS has no prompt). */
export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return;
    if (window.top !== window.self) return;
    setShow(isIosSafariNotInstalled());
  }, []);

  if (!show) return null;

  return (
    <div className="mx-auto mb-3 flex max-w-6xl items-start gap-3 rounded-xl bg-card px-4 py-3 text-sm">
      <Share className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="flex-1 text-muted-foreground">
        Add Gridiron Edge to your home screen: tap the share button, then{" "}
        <span className="font-medium text-foreground">Add to Home Screen</span>. Alerts only work
        once it's installed.
      </p>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Dismiss"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setShow(false);
        }}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
