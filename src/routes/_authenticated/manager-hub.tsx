import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteLeague, listLeagues } from "@/lib/fantasy.functions";

export const Route = createFileRoute("/_authenticated/manager-hub")({
  head: () => ({
    meta: [
      { title: "Your leagues — Gridiron Edge" },
      {
        name: "description",
        content: "Every fantasy football league you track, with your record, current week and championship outlook.",
      },
      { property: "og:title", content: "Your leagues — Gridiron Edge" },
      { property: "og:description", content: "All of your fantasy football teams in one dashboard." },
    ],
  }),
  component: ManagerHub,
});

const PLATFORM_LABEL: Record<string, string> = {
  sleeper: "Sleeper",
  yahoo: "Yahoo",
  espn: "ESPN",
  nfl: "NFL.com",
  ffpc: "FFPC",
  manual: "Manual",
};

function ManagerHub() {
  const fetchLeagues = useServerFn(listLeagues);
  const removeLeague = useServerFn(deleteLeague);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["leagues"],
    queryFn: () => fetchLeagues(),
  });

  const remove = useMutation({
    mutationFn: (leagueId: string) => removeLeague({ data: { leagueId } }),
    onSuccess: () => {
      toast.success("League removed.");
      queryClient.invalidateQueries({ queryKey: ["leagues"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove that league."),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-primary">Your teams</p>
          <h1 className="mt-2 text-4xl font-bold uppercase">League board</h1>
        </div>
        <Button asChild>
          <Link to="/connect">Add a league</Link>
        </Button>
      </div>

      {isLoading && (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      )}

      {!isLoading && !data?.length && (
        <div className="mt-10 rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
          <h2 className="text-2xl font-bold uppercase">No leagues yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Connect a Sleeper account in seconds, or add a Yahoo, ESPN, NFL.com or FFPC team from a
            screenshot of your roster.
          </p>
          <Button asChild className="mt-6">
            <Link to="/connect">Add your first league</Link>
          </Button>
        </div>
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {(data ?? []).map((l) => (
          <article
            key={l.id}
            className="group relative rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/60"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge variant="secondary" className="uppercase">
                  {PLATFORM_LABEL[l.platform] ?? l.platform}
                </Badge>
                <h2 className="mt-3 text-2xl font-bold uppercase leading-tight">{l.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {l.myTeamName ? `${l.myTeamName} · ${l.myRecord}` : "No team marked as yours yet"}
                </p>
              </div>
              <div className="text-right">
                <p className="eyebrow text-muted-foreground">Week</p>
                <p className="stat-num text-3xl text-primary">{l.current_week}</p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <Button asChild size="sm">
                <Link to="/league/$leagueId" params={{ leagueId: l.id }}>
                  Open analyzer
                </Link>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${l.name}`}
                onClick={() => remove.mutate(l.id)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
