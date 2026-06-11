# 9. Maintenance

The application itself needs no scheduled maintenance — there are no dongles, local
installations or wear parts. Keeping a deployment healthy means three things:

**Back up the data.** Everything lives in the data directory (`CDX_DATA_DIR`): the SQLite
database plus all volumes, models, guides and images. Back the directory up as a whole,
regularly and before every update. Individual cases can additionally be exported as portable
archives (start screen → case menu → Export). The **auto-backup banner** on the start screen
reminds you when cases with image data have been unchanged for the configured number of days
(Settings → Common; default 30 days, weekly check).

**Update the software.** Updates are deployed server-side (`git pull`, `bun install`,
`bun run build`, restart); database migrations run automatically on startup and are
versioned. Operators simply reload the browser. Review the changelog before updating a
production deployment, and verify after the update that a representative case opens, the
views render and a test report prints.

**Watch the audit log.** Settings → Audit log records security- and integrity-relevant
events (sign-ins, plan approvals, exports, deletions, lock changes, credit/tier changes).
Unexpected entries are the earliest indicator of misuse or misconfiguration.

> ⚠️ **Caution**
> Restoring a backup replaces the entire data directory — plans changed after the backup
> point are lost. Export current work as case archives before restoring.
