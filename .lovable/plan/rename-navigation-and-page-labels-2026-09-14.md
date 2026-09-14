# Rename navigation and page labels

## What we're changing
- The signed-in nav item currently labeled **"Leagues"** becomes **"Manager Hub"**.
- The page currently titled **"Projections"** becomes **"Stats Hub"**.

## Why
Both pages already exist at their current URLs (`/manager-hub` and `/projections`). This change only updates the user-facing names to match the new mental model: Manager Hub is the cross-league command center, and Stats Hub is where baseline stats and personal adjustments live.

## Files to edit
1. `src/routes/_authenticated/route.tsx`
   - Change the nav link text from `Leagues` to `Manager Hub`.

2. `src/routes/_authenticated/projections.tsx`
   - Update `<title>` to "Stats Hub — Gridiron Edge".
   - Update `og:title` to "Stats Hub — Gridiron Edge".
   - Update the page `<h1>` from "Projections" to "Stats Hub".

## What stays the same
- URLs: `/manager-hub` and `/projections` remain unchanged.
- Route file names and generated route tree remain unchanged.
- All underlying functionality remains unchanged.
