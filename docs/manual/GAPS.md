# Adaptations and known limitations

Differences between the original desktop product's documented functionality and this web
re-implementation, as discovered while writing the manual. Items here are either deliberate
adaptations (different platform, same job) or logged limitations.

## Deliberate adaptations (equivalent exists, different shape)

| Original | Our equivalent | Note |
|----------|----------------|------|
| Desktop installation, dongle licensing | Server deployment + account tiers/credits | Ch. 2.10, 11.5 |
| caseXchange communication platform | Contacts + transfers + inbox + orders | Ch. 7.2 |
| DWOS Synergy live CAD link | **Embedded CAD workstation (`/cad`, Chili3D pinned 0.6.1, AGPL) with a live same-session bridge**: anatomy → CAD, design → case in one click | Ch. 7.2; supersedes the earlier file-only adaptation |
| coPeriodontiX module | Built-in periodontal chart dialog (6 directions/tooth, severity colors, CSV) | Ch. 7.1; values entered from measurements rather than a dedicated CEJ point-pair picker |
| Remote support session from Help Center | F1 help + issue tracker | Ch. 10; no remote-desktop integration |
| Update notification bar | Server-side deployment; browser reload | Ch. 9 |
| iPad presentation app | Read-only plan share links | Plan menu → Share read-only link |
| Printed label / UDI symbols | About dialog as identification + UI-symbol legend | Ch. 11.3, 12 |
| Training webinars / videos | Onboarding tour + manual + F1 help | Ch. 3.1 |

## Closed after coverage audit (2026-06-11)

A page-by-page audit against the 88-page reference identified seven topic gaps and four
figure gaps; all were closed: bone-reduction profile workflow (§6.6 + bars-from-implants
proposal feature + figure), combination/stacked guide procedure (§6.6 + converted-base
support in the app + figure), endodontic straight-path caution (§6.5), inspection-window
stability caution (§6.6), tooth-transplant steps with gingivectomy/orthognathic mentions
(§6.6 + figure), scan-preparation details (§11.4), edentulous registration hint (§6.4),
in-view measurement examples figure (§7.3).

## Closed after video pass (2026-06-11, stage 2)

The clone was audited against the 17 official training videos (see
docs/video-coverage/VIDEO_COVERAGE.md); every confirmed gap was implemented in commits
`be1d0c4..71699d0` and documented: the four AI-assistant workflow surfaces (post-import
offer, status-bar chip, 5-step NAM-style review wizard replacing the flat checkbox dialog,
one-click AI scan alignment — §6.4), Virtual Planning Export end-to-end (new §6.9), the
dedicated Mesh Editor window (new §6.8), dual-scan guide foundation/Add-object/copy
alignment (§6.4, §6.6), occlusal reference plane with depth-aware implant defaults (§6.1,
§6.5), in-view PCS rotation (§6.1, incl. a real swapped pitch/roll label bug found and
fixed), guided panoramic markers (§6.2, §4.2), nerve waypoint routing / detect confirmation
/ point review stepping / axial+cross editing / section spin / live spacing labels (§6.3,
§4.2), tooth-driven implant placement + platform/article detail + manufacturer-IFU caution
(§6.5), sleeve Recommended-vs-Open grouping (§6.5), guide footprint preview / 3D-click
supports / free-hand contact areas / insertion from the 3D view / bone-reduction simulation
(§6.6), abortable DICOM import (§3.3), per-plane crosshair colors (§5.2) and named
segmentation models (§6.4).

## Logged limitations (not fully replicated)

| Item | Status | Why / mitigation |
|------|--------|------------------|
| AI segmentation quality | **Closed + real-data validated** — real vendor multi-class CBCT model behind the async-job contract, now fronted by the 5-step review wizard (§6.4); soft tissue added locally (threshold, as agreed); local heuristic remains the no-backend fallback | Validated on a real CBCT (ToothFairy 410×410×255 @0.3 mm): both jawbones, **25 teeth** by FDI, both inferior alveolar canals, pharynx — anatomically coherent, ~49 s; only two sub-50-vertex spurious fragments |
| Automatic nerve detection robustness | Path-search A* with **waypoint routing through intermediate markers** and point-by-point review stepping (§6.3); **the vendor AI model also segments the inferior alveolar canals** directly when configured | Either path is a verify-on-every-slice aid; the model supersedes A* where available |
| Live two-way CAD session (Synergy) | **Closed** — embedded Chili3D at `/cad` with postMessage bridge (load anatomy, return design); regression scripts/test-cad-bridge.ts | Both applications share one browser session and one backend |
| Scan-template (radiographic template) double-scan calibration markers | **Closed** — automatic marker detection (spheres + gutta-percha blobs, artifact rejection) with RANSAC correspondence and review dialog (§6.4); synthetic validation 0.011–0.021 mm RMS (scripts/test-template-match.ts) | Real-data validation pending — clinical dual-scan pairs requested from the project owner |

## Residual low-severity differences (video pass)

Three of the originally sixteen items were closed in a same-day follow-up:
3D drag/wheel manipulation of support circles and the guide label, rotation-marker
engraving on sleeve mounts, and PLY vertex-color rendering (§6.4, §6.6).

Verified residuals after the stage-2 video audit (docs/video-coverage/GAPS-VIDEO.md) — each
has a working equivalent; none blocks a user following a video. All rated low severity.

| Item | Status | Why / mitigation |
|------|--------|------------------|
| Sleeve drag along the implant axis in the views | open — interaction style | offset stepper per sleeve system (1–8 mm, §6.5) |
| Sleeve-mount ⌀/height fields + Ctrl+wheel | open — interaction style | mount derived from the sleeve catalog + wall parameter (§6.6) |
| Midsagittal lateral translation onto the incisal point | open — by design | PCS is rotation-only; the panoramic curve anchors all arch-relative planning, so a volume translation has no downstream effect (§6.1) |
| 3D head-icon orientation indicator + live angle readout while rotating | open — interaction style | text direction labels (Anterior/Left/…); pending PCS angles shown in the toolbar (§6.1) |
| View-layout preset dropdown (nerve stage) | open — interaction style | all constituent views shown at once; cross/tangential toggle per pane (§6.3) |
| HU readout pinned to nerve points | open — interaction style | hover-HU readout in slice views + density measurement tool (§7.3) |
| Flood-fill segment from a 3D-view click | open — interaction style | threshold init + slice flood-fill/boundary/area tools (§6.4) |
| F2 rename / per-model comment shortcut | open — interaction style | inline rename in the object tree; plan-level notes |
| Cancel inside long mesh operations | open — interaction style | mesh ops are short synchronous calls with a busy indicator; genuinely long jobs (AI segmentation) are async with the status chip (§6.4, §6.8) |
| Branded third-party sleeve entries (Camlog/Nobel/…) | open — catalog content | open sleeve library + custom sleeve-system editor (`/sleeves`) instead of licensed vendor catalogs |
| CARES proprietary VPE format | open — catalog content | STL export only; the proprietary option is shown disabled with a note (§6.9) |
| Partial mesh repair / boundary optimization | open — catalog content | whole-mesh Repair + local smooth + bridge cover the demonstrated outcomes (§6.4, §6.8) |
| Maxilla/Mandible prompt when providing data to the AI | open — by design | per-plan jaw setting; the vendor model segments both jaws regardless (§6.4) |
