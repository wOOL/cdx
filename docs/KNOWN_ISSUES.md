# Known issues / deferred hardening

From the adversarial code review (34 confirmed findings; 20 fixed in 476a520, upload caps, login lockout, hashed session tokens, portable data paths and import rollback fixed subsequently); extended 2026-06-12 with the deliberate engineering caveats of the stage-3 (YouTube-pass) additions.
Remaining items, deferred deliberately with rationale:

- **Share-link lifetime** — share links now expire 90 days after creation
  (`src/routes/share/[token]` checks `created_at > datetime('now','-90 days')`), but the
  TTL is hard-coded, and the create endpoint (`api/plans/[id]/share`) returns the existing
  non-revoked token without checking that window — re-sharing after expiry hands out the
  dead link until it is explicitly revoked. The share page still intentionally shows the
  (possibly pseudonymized) patient name; consider a configurable TTL + per-link
  pseudonymization toggle.
- **Pano column spacing** — the pano view assumes columns are exactly `step` mm apart;
  the resampled arc length makes true spacing marginally larger (≤1% typical). Affects
  only the on-screen mm readout of the pano scrubber, not measurements.

Stage-3 caveats (each a deliberate approximation, with rationale):

- **Combine 'Subtract' / tooth extraction use approximate CSG** — triangles are
  classified whole, by a +X ray-parity test on their centroid (`src/lib/server/meshEdit.ts`,
  `opCombine`); no edge intersections are computed, so the cut boundary is accurate to
  ~1 triangle. On-surface/coplanar centroids and edge grazes are resolved by a single
  retry from a fixed-jitter origin — deterministic for a given mesh pair (replay
  determinism is asserted in `scripts/test-meshsubtract.ts`) but the side chosen is
  effectively arbitrary. The parity test assumes a closed shell: subtracting an open
  (non-watertight) mesh yields parity misclassification near the opening — the same
  limitation as desktop subtract tools. Rationale: scan-resolution accuracy is enough
  for planning, and the grid-accelerated test stays interactive (~120k − 77k triangles
  well under 5 s in the test suite).
- **'Cut + close hole' keeps the largest opening** — extraction mode `cut-close`
  (`src/lib/server/toothOps.ts`) runs `fillHoles` with `exceptLargest`, which skips the
  biggest boundary loop unconditionally (`fillLoops` in `meshEdit.ts`); a watertight scan
  whose only hole IS the cut therefore gets nothing closed. Rationale: this is the Mesh
  Editor's "Close holes without largest" convention and protects an intraoral scan's
  natural (largest) opening from being capped.
- **Merge models is concatenation, not a boolean union** —
  `api/cases/[id]/merge-models` maps each source through its own transform into the
  shared volume frame, concatenates the triangle soups and writes one binary STL with no
  transform (identity); overlapping shells remain inside the merged mesh. Rationale:
  lossless, fast, and exactly what the desktop "Create merged AI model" export produces.
- **Import-time triangle count is a header read / token count** — `countTriangles`
  (`api/cases/[id]/models`) reads the binary-STL header uint32 (sanity-checked against the
  byte length) and the PLY `element face N` header line exactly, but counts `facet normal`
  tokens for ASCII STL and `\nf ` lines for OBJ — an OBJ quad/n-gon face counts once
  though it triangulates to more, and unknown formats return null (no offer). Rationale:
  the count only gates the >320k-triangle optimize offer at import, so a cheap header/
  single-scan read beats a full parse on upload.
- **Undercut preview is a facing test, not occlusion analysis** — the insertion-direction
  preview (`VolumeView.svelte`, `applyUndercutPreview`) colors a vertex as undercut when
  its world-space normal dotted with the seating axis is < −0.05; no rays are cast, so a
  wall tilted away from the axis is flagged even if nothing actually blocks seating, and
  a forward-facing surface shadowed by overhanging geometry is not. Rationale: per-frame
  recoloring stays instant while the axis is dragged; true visibility analysis belongs in
  guide production, not the live preview.
