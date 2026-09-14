import { Link, Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { LogOut, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="eyebrow text-muted-foreground">Loading your leagues…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/gameday" className="font-display text-xl font-bold uppercase tracking-wider">
            Gridiron<span className="text-primary">Edge</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link to="/gameday">Game day</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/manager-hub">Manager Hub</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/trade-desk">Trade Simulator</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/trades">Trades</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/projections">Stats Hub</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/connect">
                <Plus className="size-4" aria-hidden="true" />
                Add league
              </Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Sign out"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/" });
              }}
            >
              <LogOut className="size-4" aria-hidden="true" />
            </Button>
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
