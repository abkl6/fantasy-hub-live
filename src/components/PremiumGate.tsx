/**
 * The inline note a free member sees where a Premium feature would be, instead
 * of a blank space. Every gate in the app renders through here.
 */

import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { usePremium } from "@/hooks/usePremium";

export function PremiumNote({ title, what }: { title: string; what: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Lock className="size-4 text-primary" aria-hidden="true" />
        {title}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{what}</p>
      <Link to="/premium" className="mt-2 inline-block text-sm font-medium text-primary underline">
        See what Premium includes
      </Link>
    </div>
  );
}

/**
 * Renders `children` for Premium members, otherwise a short explanation with a
 * link to /premium.
 */
export function PremiumGate({
  title,
  what,
  children,
}: {
  title: string;
  what: string;
  children: ReactNode;
}) {
  const { premium } = usePremium();
  if (premium) return <>{children}</>;
  return <PremiumNote title={title} what={what} />;
}
