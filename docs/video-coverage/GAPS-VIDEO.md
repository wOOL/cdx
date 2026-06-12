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


---

# Stage-3 residuals (42 YouTube tutorials)

Everything demonstrated across the 42 YouTube tutorial videos exists functionally
in the web clone after the stage-3 build batches (see VIDEO_COVERAGE_YT.md).
The rows below are the verified residual differences — vendor-service/hardware
content that a self-hosted web app deliberately replaces, plus interaction-style
deltas, each with a working equivalent. None blocks a user following a video.

## Vendor services & hardware (deliberate)

| Item (videos) | Our equivalent | Sev |
|---|---|---|
| iChiroPro/iGero surgical-motor transfer (Basic 2, EASY) | QR/JSON drill-protocol export stub on the report page | low |
| Straumann RapidShape/NetFabb prepared transfer (Basic 2, EASY) | guide STL download works with any printer workflow | low |
| Straumann eShop ordering (Basic 2, EASY) | material list (BOM) on the protocol + /orders module | low |
| caseXchange cloud registration & code recovery (TT caseXchange) | account signup + contact pairing codes (/contacts) | low |
| TeamViewer built-in remote support (Basic 2) | issue tracker/help channels (manual ch. 10) | none |
| 3Dconnexion 3D-mouse HID support + fly-through camera (TT 3D Mouse) | orbit/pan/zoom + dbl-click pivot; no SpaceMouse HID layer in browsers | low |
| Vendor 'Feedback' button in the AI dialogs (AI series) | self-hosted AI backend; no vendor feedback channel | none |
| Dental Wings Online portal links (Basic 2) | built-in manual + F1 help + tour | none |
| Branded abutment/sleeve catalog entries (Basic 2, EXPERT sleeve/abutment) | stage-2 residual family: open libraries + custom editors | low |

## Platform/deployment deltas (deliberate)

| Item | Why | Sev |
|---|---|---|
| Desktop database switching / SQL reference-lab topology (Basic 2) | server-hosted central DB by design; case packages for transfer | none |
| >900 MB DICOM upload cap vs desktop >1 GB rescue (Predictable) | web upload guard; advanced import reduces slices after upload | low |
| OBJ texture (MTL/jpg) rendering (Predictable) | STL/PLY/OBJ geometry imported; PLY vertex colors render | low |
| Double-click an exported plan file opens the app (TT Exporting a Plan) | OS file association; web equivalent = Import plan… in the plan menu | none |
| Language coverage: 6 locales vs 10+ (Basic 2) | en/de/fr/it/nl/hu on /account | low |
| Email-confirmation onboarding + long company profile (TT caseXchange) | immediate signup; lean provider profile | none |

## Interaction style (equivalent exists, different gesture)

| Item (videos) | Our equivalent | Sev |
|---|---|---|
| Double-click the view title bar to maximize (Basic 1, EXPERT nerve/implant) | ⛶ button per view + Esc restore (no title bars in our grid) | low |
| Drag-and-drop toolbar/workflow customization (TT Adjusting the toolbar) | Adjust-toolbar dialog: checkboxes for tools, quick-action pins, hideable workflow steps | low |
| Full ~50-symbol pinnable function catalog (TT Adjusting the toolbar) | curated catalog: 6 measure tools + 9 quick actions + 5 hideable steps (every demonstrated pin covered) | low |
| Workflow step reorder by drag (TT Adjusting the toolbar) | stages enforce no order in EXPERT mode; steps can be hidden | none |
| Region-paint matching blobs (AI merge video) | ≥3 point-pair correspondences, unlimited pairs | low |
| 'Align to another object' registration-target choice (AI merge) | scans register into the shared volume frame; copy alignment for same-frame scans | low |
| Multi-slot segment editor w/ move/copy between segments (EXPERT segment) | single-mask editor + repeated named bone models; lo/hi HU bounds | low |
| Consolidated 'Setup 3D view' dialog w/ numeric pan/zoom/rotation fields (TT Transparent Segmentation) | per-view hover controls: presets, threshold, clip, stereo, perspectives | none |
| In-dialog 3D arch tooth picking (AI extraction) | FDI-labelled dropdown in the extraction dialog | low |
| Per-wizard-section decline checkboxes (AI review) | per-object toggles, opt-in PCS, per-scan accept | low |
| 3D pane inside the wizard scan-alignment step (AI review) | three slice planes in the wizard; full 3D check in the workspace after import | low |
| Right-drag above/below implant to rotate (TT Moving implants) | head/apex drag handles + fine-position tilts (0.1° steps) | low |
| Right-click context menus on objects (Basic 2) | actions surfaced inline in panels/tree/toolbars | none |
| Hotkey customization (TT Hotkeys) | fixed hotkeys + ⌨ list (?, Ctrl+F1) | low |
| Import dialog duplicate-position/memory readout (Predictable) | series summary + warnings before import | low |
| AI dialog round Reset/Recall-data buttons (AI numbering) | per-step resets + re-run AI job | low |
| 3D inset thumbnail while scrolling EASY axial (EASY pano) | axial-position popup (gauge + slice/mm) | none |
| Two-pane delete-patients/datasets dialog (TT Deleting Patient Data) | inline start-screen deletes (patient + per-case) with cascade confirms | low |
| 3D-in-2D shaded implant rendering toggle (Basic 2) | symbolic outline + tooth tags (the video recommends keeping it off) | low |
| Editable scan-date field in patient verify (EXPERT new case) | DICOM study date captured and shown with the dataset | none |
| Orientation-marker icon skins / Rudolph easter egg (Basic 2) | text direction indicator (stage-2 residual family) | none |
| EASY auto-segmentation live slider (EASY) | live 3D-render threshold slider; bone-model creation takes a numeric HU (lo/hi) | low |
| Guide-wizard 'From template' start (Enjoy) | Copy-plan dialog (duplicates design settings) + guide recipes | low |
| Branded implant detail naming in the properties panel (Enjoy) | article · platform · total-length readout; open catalogs (stage-2 family) | low |
| Merge-dialog FDI chart + in-dialog 3D preview (AI merge) | checkbox list + arch quick-picks; result visible in the 3D view after merge | low |
| Patient-data window AFTER import-source selection (AI provide-data) | web flow inverts the order: patient entered before import; DICOM tags prefill + mismatch warning | low |
| In-dialog result preview before committing an extraction (AI extraction) | operation is non-destructive: result lands as a NEW model to inspect/delete; source untouched | low |
| 'Entire maxilla/mandible' one-click group toggles (AI numbering) | jaw pills + '+ Upper/Lower teeth' and '+ Jaws' subset presets | none |
| Nerve points placed in the spin-rotated tangential view (EXPERT nerve) | placement + drag-correction in pano/cross/axial with section spin for review | low |
| Group select-all highlight via the tree group header (EXPERT sleeve) | single-implant selection by design; group ops exist (toggle-all, parallelize, bulk lock) | none |
| Per-sleeve drill-handle (+1 mm)/milling-cutter ⌀ readouts in the sleeve dialog (EXPERT sleeve) | live drill-length readout in the toolbar + per-step handle/length in the drill protocol | low |
| Filled segment recolors the live 3D volume render (EXPERT segment) | instant colored axial overlay + 3D-seeded fill; colored 3D mesh after Build model | low |
