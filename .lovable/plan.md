# Fix FFPC links that contain only `ltuid`

## Why this link fails

The link passes validation, but the importer currently treats its league ID as missing. In this FFPC link format, the numeric prefix of `ltuid` identifies the league (`762-…`), while the current parser only looks for separate `leagueID`, `leagueNo`, or `lid` parameters. It then tries to discover the ID from links inside FFPC's returned page; that page does not expose a matching link, so the preview ends with “FFPC's league page could not be read.”

## Changes

1. Recognize FFPC's numeric `ltuid` prefix as the league ID while preserving the complete private token for server-side requests and encrypted storage.
2. Fetch the league page with both the derived league ID and the complete `ltuid`, matching FFPC's expected URL shape.
3. Keep HTML discovery as a fallback for other valid FFPC link formats.
4. Improve the private, server-side failure record so a failed page reports whether retrieval, league identification, or standings parsing failed without recording the token.
5. Keep the existing last-good-data and “sync paused — update manually” behavior for later sync failures.

## Verification

- Add parser coverage for this exact URL shape and for links with a separate league ID.
- Test the preview flow with the supplied FFPC link and confirm it reaches league/team selection.
- Confirm the private token never appears in browser data, logs, errors, or returned results.
- Run the FFPC parser tests, project checks, and a signed-in Connect-page browser check.
