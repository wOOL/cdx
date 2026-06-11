# Known issues / deferred hardening

From the adversarial code review (34 confirmed findings; 20 fixed in commit 476a520).
Remaining items, deferred deliberately with rationale:

- **Upload size limits / zip-bomb caps** — import endpoints buffer uploads in memory and
  `unzipSync` expands without a cap. Single-practice trust model; add per-request size caps
  before any multi-tenant exposure.
- **Login rate limiting / lockout** — no brute-force protection on /login. Add a per-IP
  token bucket (or move behind a reverse proxy with rate limiting) before internet exposure.
- **Share-link lifetime** — share tokens are revocable but do not expire; the share page
  intentionally shows the (possibly pseudonymized) patient name. Consider TTL + per-link
  pseudonymization toggle.
- **Session tokens stored in plaintext** — a leaked DB/backup yields live sessions.
  Hash tokens at rest (store SHA-256, look up by hash).
- **Absolute-ish file paths in DB** — stored paths embed the DATA_DIR prefix; moving the
  data directory breaks references. Store paths relative to DATA_DIR and resolve at read.
  Until then: restore backups to the same relative location and copy the SQLite WAL too.
- **Imports are not transactional** — a failed case/plan import can leave partial rows
  (files are written before rows; orphans possible on crash). Wrap in db.transaction and
  unlink written files on failure.
- **Pano column spacing** — the pano view assumes columns are exactly `step` mm apart;
  the resampled arc length makes true spacing marginally larger (≤1% typical). Affects
  only the on-screen mm readout of the pano scrubber, not measurements.
