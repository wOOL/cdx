# 6. Maintenance

The application itself needs no scheduled maintenance — there are no dongles, local
installations or wear parts. Keeping a deployment healthy means three things:

**Back up the data.** Everything lives in the data directory (`CDX_DATA_DIR`): the database
plus all imported scans and exported designs. Back the directory up as a whole, regularly and
before every update. Individual designs can additionally be exported as STL for offline
retention.

**Update the software.** Updates are deployed server-side (`git pull`, `bun install`,
`bun run build`, restart); any database migrations run automatically on startup. The embedded
CAD workstation is rebuilt as part of `bun run build`. Operators simply reload the browser.
Review the changelog before updating a production deployment, and verify after the update that
a representative order opens, a scan imports, the CAD workstation renders and an STL exports.

**Watch the access and audit records.** Sign-ins and integrity-relevant events are recorded
together with the coDiagnostiX Web application sharing the deployment. Unexpected entries are
the earliest indicator of misuse or misconfiguration.

> ⚠️ **Caution**
> Restoring a backup replaces the entire data directory — designs changed after the backup
> point are lost. Export current work before restoring.
