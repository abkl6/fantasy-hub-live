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
      <h1 className="text-2xl font-bold">Game day</h1>
      <div className="mt-6">
        <GameDayBoard />
      </div>
    </main>
  );
}
