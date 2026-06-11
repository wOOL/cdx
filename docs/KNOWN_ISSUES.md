# Known issues / deferred hardening

From the adversarial code review (34 confirmed findings; 20 fixed in 476a520, upload caps, login lockout, hashed session tokens, portable data paths and import rollback fixed subsequently).
Remaining items, deferred deliberately with rationale:

- **Share-link lifetime** — share tokens are revocable but do not expire; the share page
  intentionally shows the (possibly pseudonymized) patient name. Consider TTL + per-link
  pseudonymization toggle.
- **Pano column spacing** — the pano view assumes columns are exactly `step` mm apart;
  the resampled arc length makes true spacing marginally larger (≤1% typical). Affects
  only the on-screen mm readout of the pano scrubber, not measurements.
