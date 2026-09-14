import { Link, createFileRoute } from "@tanstack/react-router";
import { Activity, LineChart, Trophy, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gridiron Edge — Fantasy Football League Analyzer" },
      {
        name: "description",
        content:
          "Track every fantasy football league in one place. Live scores, title odds, and start-sit, waiver and trade advice ranked by how much each move raises your championship chances.",
      },
      { property: "og:title", content: "Gridiron Edge — Fantasy Football League Analyzer" },
      {
        property: "og:description",
        content:
          "One dashboard for Sleeper, Yahoo, ESPN, NFL.com and FFPC teams, with championship odds behind every recommendation.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Trophy,
    title: "Title odds, not vibes",
    body: "Every team's playoff and championship chances come from thousands of simulated seasons using your league's real scoring.",
  },
  {
    icon: Zap,
    title: "Moves ranked by impact",
    body: "Each waiver add, lineup swap and trade shows exactly how many points of championship odds it gains or costs you.",
  },
  {
    icon: Activity,
    title: "All your teams, one board",
    body: "Sleeper connects in seconds. Yahoo, ESPN, NFL.com and FFPC teams come in from a screenshot or quick manual entry.",
  },
  {
    icon: LineChart,
    title: "Know your weak spot",
    body: "Position-by-position grades against the rest of your league, so you fix the hole that is actually costing you wins.",
  },
];

function Landing() {
  const { session, loading } = useAuth();

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-display text-2xl font-bold tracking-wider">
          Gridiron<span className="text-primary">Edge</span>
        </span>
        <Button asChild variant={session ? "default" : "outline"} size="sm">
          <Link to={session ? "/gameday" : "/auth"}>
            {loading ? "…" : session ? "Open game day" : "Sign in"}
          </Link>
        </Button>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-16 pt-10 md:pt-20">
        <p className="eyebrow text-primary">Fantasy football league analyzer</p>
        <h1 className="mt-4 max-w-3xl text-5xl font-bold leading-[0.95] md:text-7xl">
          THE TOOL BUILT TO WIN CHAMPIONSHIPS.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Gridiron Edge tracks all of your fantasy teams in one spot, refreshes scores every time you open it,
          and turns your roster into one clear answer: what to do next, and what it does to your
          championship odds.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to={session ? "/gameday" : "/auth"}>Start tracking your teams</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/auth">Create an account</Link>
          </Button>
        </div>

        <dl className="mt-14 grid gap-4 sm:grid-cols-3">
          {[
            ["2,500", "seasons simulated per league"],
            ["5", "platforms supported"],
            ["1 tap", "from advice to decision"],
          ].map(([stat, label]) => (
            <div key={label} className="rounded-xl bg-card/60 p-5">
              <dt className="stat-num text-4xl text-primary">{stat}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="text-3xl font-bold">Built for managers who want the trophy</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {FEATURES.map((f) => (
            <article key={f.title} className="rounded-xl bg-card p-6">
              <f.icon className="size-6 text-primary" aria-hidden="true" />
              <h3 className="mt-4 text-xl font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        Gridiron Edge — independent fantasy analysis. Not affiliated with the NFL or any fantasy platform.
      </footer>
    </main>
  );
}
