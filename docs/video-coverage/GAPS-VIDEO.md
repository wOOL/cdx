# Residual differences after the video pass

Everything demonstrated in the 17 training videos exists functionally in the web
clone. The items below are the verified residual differences — interaction-style
or catalog-content deltas, each with a working equivalent, none blocking a user
who follows a video. Severity per the adversarial verifier (none rated high).

Follow-up (2026-06-11, same day): three items were closed on request and removed
from the tables below — direct 3D drag/wheel manipulation of support circles and
the guide label (hover-highlight, drag along the surface, wheel resize, red centre
dot), rotation-marker engraving on sleeve mounts (radial slot oriented by the
abutment rotation azimuth), and PLY vertex-color rendering (colored scans now
display their own colors in 3D). A second follow-up closed three more: F2
rename of the selected model, Boundary optimization in the Mesh Editor, and
volumetric flood fill seeded by clicking the 3D reconstruction. 11 items remain.

## Interaction style (equivalent exists, different input gesture)

| Item (video) | Our equivalent | Sev |
|---|---|---|
| Sleeve drag along implant axis in views (place-sleeve) | offset stepper per sleeve system (1–8 mm) | low |
| Sleeve-mount ø/height fields + CTRL+wheel (expert design-guide) | mount derived from sleeve catalog + wall parameter | low |
| Midsagittal lateral translation onto the incisal point (coordinate-system) | PCS is rotation-only by design — the panoramic curve anchors all arch-relative planning, so volume translation has no downstream effect | low |
| 3D head-icon orientation indicator + live angle readout while rotating | text direction indicator (Anterior/Left/…); pending PCS angles shown in toolbar | low |
| View-layout preset dropdown (nerve stage) | all constituent views shown at once; cross/tangential toggle per pane | low |
| HU readout pinned to nerve points | hover-HU readout in slice views + density measurement tool | low |
| Per-model comment field (Ctrl+Shift+C) | plan-level notes; model rename (inline or F2) | low |
| Cancel inside long mesh operations | ops are short synchronous calls with busy indicator; jobs that are actually long (AI segmentation) are async with status chip | low |

## Catalog / content deltas (deliberate)

| Item | Why | Sev |
|---|---|---|
| Branded third-party sleeve entries (Camlog/Nobel/…) | open sleeve library + custom sleeve-system editor (/sleeves) instead of licensed vendor catalogs | low |
| CARES proprietary VPE format | STL export only; the proprietary option is shown disabled with a note | low |
| Maxilla/Mandible prompt when providing data to the AI | per-plan jaw setting; the vendor model segments both jaws regardless | low |

## Closed during this pass (for the record)

All four AI-assistant workflow surfaces (post-import offer, status chip,
review wizard, auto-alignment), Virtual Planning Export end-to-end, the
dedicated Mesh Editor window, dual-scan Add-object/intaglio/copy-alignment,
occlusal plane + depth defaults, guided pano markers, nerve waypoint
routing/stepping/axial+cross editing/section spin, in-view PCS rotation
(plus a real pitch/roll label bug found and fixed), guide footprint preview,
3D-click supports, free-hand contact areas, bone-reduction simulation,
tooth-driven implant placement, sleeve recommendations, import abort,
named segments. See VIDEO_COVERAGE.md and commits be1d0c4..HEAD.
