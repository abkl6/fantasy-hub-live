import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

// Full-screen scoreboard: loaded only when this route is opened.
const TvBoard = lazy(() => import("@/components/TvBoard").then((m) => ({ default: m.TvBoard })));

export const Route = createFileRoute("/_authenticated/tv")({
  head: () => ({
    meta: [
      { title: "On TV scoreboard — Gridiron Edge" },
      {
        name: "description",
        content: "A full-screen fantasy scoreboard for every league: big live scores, win chances and a running scoring ticker.",
      },
      { property: "og:title", content: "On TV scoreboard — Gridiron Edge" },
      {
        property: "og:description",
        content: "Put your fantasy matchups on the big screen: live scores, win chances and a scoring ticker.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TvPage,
});

function TvPage() {
  return (
    <Suspense fallback={<p className="eyebrow p-6 text-muted-foreground">Loading the scoreboard…</p>}>
      <TvBoard />
    </Suspense>
  );
}
