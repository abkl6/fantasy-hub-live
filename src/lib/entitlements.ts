/**
 * Premium access, in one place.
 *
 * Every gate in the app reads `hasPremium()` so there is exactly one rule for
 * who sees the paid features. Nothing here talks to the database — callers
 * pass in the row they already loaded.
 */

export type Tier = "free" | "premium";
export type EntitlementSource = "founding" | "stripe" | "admin";

export interface Entitlement {
  tier: Tier;
  source: EntitlementSource;
  /** ISO timestamp, or null for "never expires". */
  expiresAt: string | null;
}

/** The founding season gives everyone Premium until this date. */
export const FOUNDING_EXPIRES_AT = "2027-02-01T00:00:00.000Z";

/**
 * The single source of truth for "can this person use a Premium feature?".
 * An expired entitlement counts as free.
 */
export function hasPremium(
  entitlement: Entitlement | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!entitlement || entitlement.tier !== "premium") return false;
  if (!entitlement.expiresAt) return true;
  const expires = Date.parse(entitlement.expiresAt);
  return Number.isNaN(expires) ? true : expires > now.getTime();
}

/** Everything Premium unlocks, used by the /premium page and the inline notes. */
export const PREMIUM_FEATURES = [
  "Season simulation odds and title impact on every move",
  "The Season tab with projected seeds and playoff paths",
  "Trade Finder across every rival roster",
  "Buy and sell targets",
  "Value trajectories for every player",
  "The weekly recap and grading",
  "Fragility score for your roster",
  "Championship-week mode",
  "Trade prompts when something changes",
] as const;

/** What stays free forever. */
export const FREE_FEATURES = [
  "Unlimited league imports from every platform",
  "Game Day live scoring",
  "Games and kickoff countdowns",
  "This Week to-do list",
  "Lineup check",
  "Waiver wire ranked by projected points",
  "On TV mode",
  "Notifications and alerts",
] as const;

/**
 * STRIPE STUB — payment processing is not wired up yet.
 *
 * When Stripe is attached: a checkout session webhook should upsert
 * `entitlements` with `tier: "premium"`, `source: "stripe"` and the
 * subscription's current period end as `expires_at`. Nothing else in the app
 * needs to change, because every gate already reads `hasPremium()`.
 */
export const STRIPE_CHECKOUT_ENABLED = false;
