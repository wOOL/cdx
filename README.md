# coDiagnostiX Web

A web-based clone of the coDiagnostiX® dental implant planning and surgical guide design software, built with SvelteKit + Bun + SQLite + Three.js.

## Features

Complete guided-surgery planning workflow:

- **Patient & case management** — patient database, cases, plan variants (duplicate/compare/lock/approve), case archives (export/import), per-patient image library
- **DICOM import** — CT/CBCT series (.dcm/.zip), HU volume building, synthetic demo phantom generator
- **Viewing** — axial/coronal/sagittal MPR with window/level (histogram dialog), zoom/pan/mirror, scale bars, crosshair linking, view maximize, snapshots
- **Panoramic system** — arch curve editing, curved-MPR panorama, OPG (ray-sum) mode, cross-sections (single or ×3 group), tangential view, align-to-implant sections
- **Patient alignment** — yaw/pitch/roll volume reorientation (resampled in place)
- **Segmentation** — threshold bone models (marching cubes), editable threshold, color/opacity controls
- **Scan registration** — point-pair matching (Kabsch), two-stage ICP refinement, manual drag alignment with live contour verification
- **Nerve tracing** — per-point diameters, 3D tube rendering, safety distance engine (implant↔nerve/implant/sleeve)
- **Implant planning** — multi-system library, FDI/Universal charts, drag + axis-tilt manipulation in all views, depth steppers, parallelize, bone density profile (Misch classes), abutment presets
- **Sleeves & guides** — sleeve systems with offsets, voxel-CSG guide generation (undercut blockout, sleeve mounts, drill channels, inspection windows, insertion direction), STL export gated on plan approval
- **Reports** — printable surgical protocol with drill sequences, per-implant cross-sections, material list
- **Modes & accounts** — EXPERT/EASY work modes with guided step rail and contextual help, multi-user accounts with sessions, undo/redo, hotkeys

## Run (development)

```sh
bun install
bun run dev          # http://localhost:5173
bun run scripts/make-synthetic-dicom.ts   # generates testdata/synthetic-cbct.zip
```

Register an account on first launch, then use **Create demo case** for a synthetic CBCT phantom.

## Run (production)

```sh
bun run build
PORT=3000 ORIGIN=http://localhost:3000 bun run build/index.js
```

`ORIGIN` must match the public URL (SvelteKit CSRF protection). Data lives in `./data` (override with `CDX_DATA_DIR`).

## Testing

```sh
bun run check                       # svelte-check
bun run scripts/test-mesh.ts        # marching cubes / STL / PLY
bun run scripts/test-registration.ts
bun run scripts/test-resample.ts
bun run scripts/test-guide.ts       # guide generation
bun run scripts/test-planning.ts    # browser E2E (needs dev server + playwright chromium)
```

## Status

`docs/SPEC.md` is the full functional spec (research-derived); `docs/FEATURES.md` tracks parity with the original per feature ([x]/[~]/[ ]).

*Not a medical device. For demonstration and development purposes only.*
