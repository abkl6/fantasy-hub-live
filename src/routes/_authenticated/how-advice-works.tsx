/** Read-only view of the strategy rules behind every recommendation. */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Badge } from "@/components/ui/badge";
import { listStrategyRules } from "@/lib/rules.functions";

export const Route = createFileRoute("/_authenticated/how-advice-works")({
  head: () => ({
    meta: [
      { title: "How advice works — the rules behind every suggestion" },
      {
        name: "description",
        content:
          "The strategy rules that rank waiver claims, trades and lineup calls: value over replacement, streaming kickers and defences, playoff-week weighting and more.",
      },
      { property: "og:title", content: "How advice works" },
      {
        property: "og:description",
        content: "The strategy rules behind every waiver, trade and lineup suggestion.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HowAdviceWorks,
});

function HowAdviceWorks() {
  const list = useServerFn(listStrategyRules);
  const { data, isLoading } = useQuery({
    queryKey: ["strategy-rules"],
    queryFn: () => list(),
  });

  const rules = data?.rules ?? [];
  const categories = [...new Set(rules.map((r) => r.category))];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold">How advice works</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every waiver claim, trade idea and lineup call is ranked by the rules below. When one of
        them changes or hides a suggestion, you'll see its reason on the card.
      </p>

      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading the rules…</p>
      ) : (
        <div className="mt-6 space-y-6">
          {categories.map((category) => (
            <section key={category}>
              <h2 className="eyebrow text-muted-foreground">{category}</h2>
              <div className="mt-2 space-y-3">
                {rules
                  .filter((r) => r.category === category)
                  .map((r) => (
                    <article key={r.id} className="rounded-xl bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold">{r.rule}</p>
                        {r.enabled ? (
                          <Badge variant="secondary">On</Badge>
                        ) : (
                          <Badge variant="outline">Off</Badge>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{r.rationale}</p>
                    </article>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
