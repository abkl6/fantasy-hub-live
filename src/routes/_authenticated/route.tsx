import { Link, Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  BarChart3,
  Bell,
  CalendarDays,
  LogOut,
  Menu,
  Monitor,
  Plus,
  Radio,
  ListChecks,
  Repeat2,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { homeRoute } from "@/lib/fantasy/gamewindow";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

const TABS = [
  { to: "/gameday", label: "Game Day", icon: Radio },
  { to: "/this-week", label: "This week", icon: ListChecks },
  { to: "/games", label: "Games", icon: CalendarDays },
  { to: "/manager-hub", label: "Hub", icon: BarChart3 },
  { to: "/trade-desk", label: "Trades", icon: Repeat2 },
  { to: "/projections", label: "Players", icon: Users },
] as const;

function AuthenticatedLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const bare = useRouterState({ select: (s) => s.location.pathname === "/tv" });

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

  if (bare) return <Outlet />;

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to={homeRoute()} className="font-display text-lg font-bold tracking-wider">
            Gridiron<span className="text-primary">Edge</span>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label="Menu">
                <Menu className="size-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/connect">
                  <Plus className="size-4" aria-hidden="true" />
                  Add league
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/tv">
                  <Monitor className="size-4" aria-hidden="true" />
                  On TV
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/trades">Trade history</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings">
                  <Bell className="size-4" aria-hidden="true" />
                  Notifications
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  await supabase.auth.signOut();
                  navigate({ to: "/" });
                }}
              >
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Outlet />

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur"
      >
        <div className="mx-auto flex max-w-md items-stretch">
          {TABS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium text-muted-foreground transition-colors data-[status=active]:text-primary"
            >
              <Icon className="size-5" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
