import { createFileRoute } from "@tanstack/react-router";

import { GameDayBoard } from "@/components/GameDayBoard";

export const Route = createFileRoute("/_authenticated/gameday")({
  head: () => ({
    meta: [
      { title: "Game day live tracker — Gridiron Edge" },
      {
        name: "description",
        content:
          "Track every fantasy matchup live: real-time scores, projected finals and a running scoring log across all of your leagues.",
      },
      { property: "og:title", content: "Game day live tracker — Gridiron Edge" },
      {
        property: "og:description",
        content: "Live fantasy scores, projections and a play-by-play scoring log for every league you play in.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GameDayPage,
});

function GameDayPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <p className="eyebrow text-primary">Sunday command centre</p>
      <h1 className="mt-2 text-4xl font-bold uppercase">Game day</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Every one of your matchups in one place, with live scores, projected finals and a running log of each
        scoring play — scored with each league&apos;s own rules.
      </p>
      <div className="mt-8">
        <GameDayBoard />
      </div>
    </main>
  );
}
