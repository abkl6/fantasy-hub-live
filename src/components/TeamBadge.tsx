import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { TeamBadge as TeamBadgeValue } from "@/lib/fantasy/team-class";

const TONE: Record<TeamBadgeValue["tone"], string> = {
  gold: "border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300",
  good: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  neutral: "border-border bg-muted text-muted-foreground",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function TeamBadge({
  badge,
  className,
}: {
  badge: TeamBadgeValue | null | undefined;
  className?: string;
}) {
  if (!badge) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("cursor-help text-[11px] font-medium", TONE[badge.tone], className)}>
            {badge.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-[16rem]">{badge.reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
