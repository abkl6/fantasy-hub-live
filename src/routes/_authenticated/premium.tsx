import { createFileRoute } from "@tanstack/react-router";
import { Check, Lock, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePremium } from "@/hooks/usePremium";
import { FREE_FEATURES, PREMIUM_FEATURES, STRIPE_CHECKOUT_ENABLED } from "@/lib/entitlements";

const TITLE = "Premium — season odds, trade finder and value trajectories";
const DESCRIPTION =
  "Free covers every league, live scoring and weekly lineup and waiver advice. Premium adds season simulation odds, the Season tab, Trade Finder, buy and sell targets, value trajectories and the weekly recap.";

export const Route = createFileRoute("/_authenticated/premium")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PremiumPage,
});

function List({ items, muted }: { items: readonly string[]; muted?: boolean }) {
  return (
    <ul className="mt-4 space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm">
          <Check
            className={`mt-0.5 size-4 shrink-0 ${muted ? "text-muted-foreground" : "text-primary"}`}
            aria-hidden="true"
          />
          <span className={muted ? "text-muted-foreground" : undefined}>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function PremiumPage() {
  const { premium, entitlement } = usePremium();

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <section className="rounded-xl border border-primary/40 bg-card p-5">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          Founding season — Premium included through January 2027
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone who joins this season gets every Premium feature at no cost until 1 February 2027.
          {premium && entitlement?.source === "founding"
            ? " That's you — nothing to do."
            : ""}
        </p>
      </section>

      <header>
        <h1 className="text-2xl font-bold">Premium</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your plan:{" "}
          <span className="font-medium text-foreground">{premium ? "Premium" : "Free"}</span>
          {entitlement?.expiresAt
            ? ` · through ${new Date(entitlement.expiresAt).toLocaleDateString()}`
            : ""}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Free</h2>
            {!premium ? <Badge variant="secondary">Your plan</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Everything you need to run the week.</p>
          <List items={FREE_FEATURES} muted />
        </section>

        <section className="rounded-xl border border-primary/40 bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Lock className="size-4 text-primary" aria-hidden="true" />
              Premium
            </h2>
            {premium ? <Badge>Your plan</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            The season-long picture: odds, trades and where value is heading.
          </p>
          <List items={PREMIUM_FEATURES} />

          {/* STRIPE STUB — checkout attaches here once payments are enabled. */}
          <Button className="mt-4 w-full" disabled={!STRIPE_CHECKOUT_ENABLED || premium}>
            {premium ? "Included this season" : "Checkout coming soon"}
          </Button>
        </section>
      </div>
    </main>
  );
}
