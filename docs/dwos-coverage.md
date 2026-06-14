# DWOS-Web — IFU replication coverage

Self-audit of DWOS-Web against **DWOS Software IFU v4.1** (`dwos_guide/pdf/29-0100_DWOS Software_v4.1-EN.pdf`).
Goal: replicate every feature/function the IFU describes. Updated each build increment.

**Status legend:** ✅ done & verified · 🟡 partial · ⬜ missing (buildable) · 🚫 external blocker
(hardware / proprietary service / regulatory — see `[[dwos-clone-direction]]` analysis).

**Completeness (rough, by feature line): see the rollup at the bottom — recomputed each pass.**

---

## A. Order & case management (IFU 5.1, 4.3)
| # | Feature | Status | Notes |
|---|---|---|---|
| A1 | Order creation station | ✅ | /restoration-orders + order panel in /cad |
| A2 | Order types (Cnb & Implant, Virtual Wax-up, Denture, Bite Splint, …) | 🟡 | roles/subtypes cover crown/pontic/etc; no per-indication order types yet |
| A3 | Auto order ID; Dentist + Patient | ✅ | order_number auto; dentist field; patient via case |
| A4 | Prosthesis Family / role (crown, pontic, abutment, inlay, …) | ✅ | |
| A5 | Prosthesis Subtype (Full crown, Full pontic, …) | ✅ | per-role subtype picker |
| A6 | Material selection (+ Material Management .XML) | 🟡 | material list (generic); no per-material .XML constraints yet |
| A7 | Colour / shade | ✅ | VITA classical |
| A8 | Anatomy Family selection | ✅ | placeholder library names |
| A9 | FDI tooth-chart selection (pillars/pontics) | ✅ | clickable two-row chart |
| A10 | Create Bridge (join units) | ✅ | bridge groupings |
| A11 | Route Order | ✅ | status lifecycle + production routing (/production) |
| A12 | Active cases list (Chairside/Easy) | 🟡 | host case panel exists |
| A13 | Import .xorder / model scans (Easy) | ⬜ | |

## B. Scan acquisition & import (IFU 2.3, 5.1–5.3)
| # | Feature | Status | Notes |
|---|---|---|---|
| B1 | Arch Scan station (scanner control) | 🚫 | needs scanner hardware/driver |
| B2 | Multi-die scan station (scanner control) | 🚫 | hardware |
| B3 | Scan Import (STL/PLY/OBJ) | ✅ | bridge loads single mesh as MeshNode |
| B4 | Multiple named scans (arch / antagonist / occlusion-key / gingiva) | 🟡 | can load several + align them; named roles via order pending |
| B5 | Mesh optimization (trim in-depth/on-surface, repair holes, remove artifacts) | 🟡 | Optimize Mesh (keep-largest + fill-holes) done via /api/cad/mesh-edit; interactive trim/plane-cut pending |
| B6 | Scan matching: smart-match (ICP) | ✅ | Match Scan station + /api/cad/align (host icp); RMS-verified |
| B7 | Scan matching: 3-point match | ⬜ | host markerReg.matchMarkers ready |
| B8 | Occlusion-key alignment (upper↔lower) | ⬜ | |
| B9 | Orientation to reference axes (front/right/top, vertical axis) | ⬜ | |

## C. Assignment / tagging (IFU 5.1–5.3)
| # | Feature | Status | Notes |
|---|---|---|---|
| C1 | Model assignment designer (tag teeth) | ✅+ | AI auto-tag (beyond DWOS manual tagging) |
| C2 | Per-triangle pick / select tooth | ✅ | BVH picking |
| C3 | Manual tag correction / adjacents / gingiva | ⬜ | AI only, no manual edit yet |
| C4 | Tagging clockwise from leftmost adjacent (Easy convention) | ⬜ | |

## D. Design parameters (IFU 4.4, 5.1–5.2)
| # | Feature | Status | Notes |
|---|---|---|---|
| D1 | Margin / emergence line | ✅ | auto-traced (Margin Line) + interactive point editing (Edit Margin) |
| D2 | Insertion axis (auto) | ✅ | display |
| D3 | Insertion axis (manual adjust) + undercut analysis | ⬜ | |

## E. Anatomy design / CAD engine (IFU 4.4, 5.1–5.3)
| # | Feature | Status | Notes |
|---|---|---|---|
| E1 | Automatic anatomy proposition | 🟡 | library tooth placed at gap (parametric), not context-fit |
| E2 | Tooth-Chain technology (context + statistics) | ⬜ | biogeneric/data problem (no model needed) |
| E3 | Intrados / cement-gap (fitting surface) | 🟡 | robust offset primitive built (meshSdf thickenSurface + /api/cad/offset); margin-bounded intrados assembly pending |
| E4 | Full-contour crown solid (anatomy ∪ collar, hollowed) | 🟡 | crown proposal is solid; coping shell generation done; hollowing pending |
| E5 | Shaping: Add/Remove material | ✅ | interactive wax-knife brush (Shape group) via /api/cad/mesh-edit |
| E6 | Shaping: Clinical Handles | ⬜ | |
| E7 | Shaping: Transforms | ⬜ | |
| E8 | Shaping: smooth / fill | ⬜ | |
| E9 | Duplicate existing tooth (clone) | ⬜ | |
| E10 | Fit handles (yellow/purple/green: rotate/spacing/size) | ⬜ | |
| E11 | Readapt anatomy / pre-position / mirror anatomy | ⬜ | |
| E12 | Adjust occlusion (vs antagonist) | ⬜ | needs B4/B8 |
| E13 | Adjust contact points (interproximal) | ⬜ | |
| E14 | Adaptation Environment | ⬜ | |
| E15 | 3/4 crown, prehension items | ⬜ | |
| E16 | Import wax-up / CBCT / face scan to verify | ⬜ | |

## F. Bridges & connectors (IFU 5.1)
| # | Feature | Status | Notes |
|---|---|---|---|
| F1 | Multi-unit bridge | ⬜ | |
| F2 | Pontics (full pontic, conical, …) | 🟡 | propose-crown places a pontic-like tooth at gap |
| F3 | Connectors (sizing, cross-section, min area) | ⬜ | |
| F4 | Recompute bridge | ⬜ | |

## G. Other indications (IFU 2.2, 4.3, 5.3)
| # | Feature | Status | Notes |
|---|---|---|---|
| G1 | Abutments (implant/scan-body libraries) | 🚫 | implant kits are manufacturer data |
| G2 | Screw-retained bars & bridges (SRBB) | ⬜ | |
| G3 | Partial frameworks (survey, clasps, connectors) | ⬜ | |
| G4 | Full dentures | ⬜ | |
| G5 | Bite splints | 🟡 | Bite Splint shell generation (offset over teeth); bite-relation/relief refinement pending |
| G6 | Orthodontic appliances | ⬜ | |
| G7 | Models (study/working) | ⬜ | |

## H. Libraries & data (IFU 4.4)
| # | Feature | Status | Notes |
|---|---|---|---|
| H1 | Anatomy libraries (download/duplicate/customize/import STL) | 🟡 | one parametric set |
| H2 | Attachment kits | ⬜ | |
| H3 | Material files (.XML constraints/warnings) | 🚫/⬜ | generic approximable; vendor files external |
| H4 | Implant libraries | 🚫 | manufacturer data |

## I. Nesting & manufacturing (IFU 5.1–5.2)
| # | Feature | Status | Notes |
|---|---|---|---|
| I1 | Nesting (position in milling blank/disc) | 🟡 | Nest in Blank (Ø98×16 outline + fit check); multi-part packing/sprues pending |
| I2 | Milling / CAM tool-data config | ⬜ | |
| I3 | Production Management station | ✅ | /production queue (advance status, per-order routing) |
| I4 | Export manufacturing STL | ✅ | bridge export (attach to case) |
| I5 | Subcontract (send to lab) | ✅ | subcontract to a lab contact (+ transfer record) |

## J. Variants, connectivity, platform (IFU 2.2, 2.7–2.9, 3, 4)
| # | Feature | Status | Notes |
|---|---|---|---|
| J1 | DWOS variant (full lab) | 🟡 | single ribbon |
| J2 | DWOS Easy (anatomy-first wizard) | ⬜ | |
| J3 | DWOS Chairside (Next-driven wizard) | ⬜ | |
| J4 | DWOS Connect (cloud Inbox) | ⬜ | build our own — server-side file sharing (user-confirmed in scope) |
| J5 | DWOS Synergy (coDiagnostiX interop) | 🟡 | host IS the coDiagnostiX clone; build our own bridge |
| J6 | Context-sensitive webhelp / Knowledge Base | ⬜ | |
| J7 | Anonymisation, archiving, encryption | 🟡 | host has some |
| J8 | Multi-language | 🟡 | engine i18n; dental strings en-only |
| J9 | Installation/deploy, license | 🟡 | web deploy; no license system |

---

## Rollup (recomputed each pass)
- Per user: only scanner **hardware** (B1,B2) and **medical-device validation** are out of scope.
  Everything else — incl. DWOS Connect/Synergy, implant/material/anatomy libraries (our own,
  generic) — is buildable. 🚫 now ≈ 4 (B1, B2, G1-implant-data, H4-implant-data).
- Buildable feature lines: ~74
- ✅ done: ~24 · 🟡 partial: ~18 · ⬜ missing: ~32
- **Approx. completeness: ~38%** of buildable scope.
  (pass 2: Optimize/B5; pass 3: order A1–A11, material E5; pass 4: Match B6, Nest I1,
   Edit Margin D1, offset primitive + Coping E3/E4, Bite Splint G5, Production I3/I5)

## Build order (depth + breadth, long-run-correct)
1. **Order creation station** (A) — real order model: families/subtypes/materials/shades/FDI chart/routing.
2. **Multi-scan import + matching** (B4,B6–B9) — antagonist/occlusion-key + ICP/3-point align (unblocks occlusion).
3. **Mesh optimization** (B5) — trim/repair/smooth via host meshEdit.
4. **Crown design engine** (D1,D3,E3,E4) — interactive margin, manual axis, intrados/cement-gap, crown solid.
5. **Occlusion + contacts** (E12,E13) and **sculpting** (E5–E11).
6. **Bridges & connectors** (F).
7. **Nesting + CAM** (I1,I2,I3).
8. **Other indications** (G2–G7): splints, models, partials, dentures, SRBB, ortho.
9. **Libraries** (H1,H2,H3-generic).
10. **UI variants** (J2,J3) + webhelp (J6) + i18n (J8).
11. **Own Connect/Synergy equivalent** (J4,J5).

External blockers (🚫) get our-own-equivalent or documented-as-out-of-scope, never faked.
