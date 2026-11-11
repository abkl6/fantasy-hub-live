# Roadmap

## Current task: speed fixes (plan: speed-up-plan-stop-re-reading-the-whole-season-on-every-page)

- [x] 1. Season totals added up by the database
- [x] 2. Shared short-lived player list
- [x] 3. Injury/news lookup path
- [x] 4. Failed-transaction check (now ~2/min; queue-insert failures removed)
- [x] 5. Rebuild only when inputs change (content fingerprint, stale-while-rebuild, member-safe queueing)
- [ ] 6. Split the league page code per tab — not started
- [x] 7. Measure page loads before/after
- [ ] 8. Optional bigger database — only if Sundays are still slow
