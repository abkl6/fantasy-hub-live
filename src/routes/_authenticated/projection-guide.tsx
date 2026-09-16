import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { templateReference } from "@/lib/projections.functions";

export const Route = createFileRoute("/_authenticated/projection-guide")({
  component: GuidePage,
  head: () => ({
    meta: [
      { title: "Projection template guide | Fantasy league analyzer" },
      {
        name: "description",
        content:
          "A one-page reference for the offence, team defence, individual defender and kicker projection templates.",
      },
      { property: "og:title", content: "Projection template guide" },
      {
        property: "og:description",
        content: "Every column in the projection upload templates, explained in one page.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function GuidePage() {
  const load = useServerFn(templateReference);
  const guide = useQuery({ queryKey: ["template-guide"], queryFn: () => load({}) });

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projection template guide</h1>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden="true" />
          Print
        </Button>
      </div>

      <p className="mb-6 text-sm text-muted-foreground">
        Fill in one season total per player. The app splits it across the weeks that player&apos;s
        team plays, evenly or shaped by how tough each week looks. Keep the first five columns as
        they come; leave a stat blank if you don&apos;t project it.
      </p>

      {guide.isLoading ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
        </p>
      ) : (
        <div className="space-y-8">
          {(guide.data?.groups ?? []).map((g) => (
            <section key={g.group}>
              <h2 className="mb-2 text-lg font-medium">{g.label}</h2>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4">Column</th>
                    <th className="py-1">What goes in it</th>
                  </tr>
                </thead>
                <tbody>
                  {g.columns.map((c) => (
                    <tr key={c.header} className="border-t border-border align-top">
                      <td className="py-1 pr-4 font-mono text-xs">{c.header}</td>
                      <td className="py-1">{c.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
