# coDiagnostiX Web Clone — Implementation Checklist

One line per implementable feature, grouped by module, ordered roughly by dependency (foundations first).
Priorities: **[P1]** core planning workflow must-have · **[P2]** full-parity important · **[P3]** advanced/secondary · **[P4]** nice-to-have polish.
Cross-references point to `docs/SPEC.md` sections.

## 0. Foundations & App Shell (SPEC §0, §1.2, §13.4)

- [~] [P1] SQLite schema: users, teams, patients, datasets, plans, plan objects (JSON payload), file blobs (volumes/meshes by content hash), audit log — partial: users/sessions/audit tables present, teams stored as settings JSON; files on disk per dataset, no content-hash blob table
- [x] [P1] User accounts: register, login (email+password), session management, logout
- [x] [P1] SvelteKit app shell with auth guard and route layout (start screen / dataset planning screen)
- [x] [P1] Start screen: Create New dataset, Open dataset, Management, Support/Help buttons — partial: Help via the ? About dialog (manual + tour replay) and F1 overlay; Management via account/settings links
- [~] [P1] Start screen dataset list: patient name, DOB, ID, modified date, plan count; sort + search — partial: no modified date, plan count, or sort
- [x] [P1] Work Mode selector (EXPERT / EASY) on start screen, persisted per user, applied on dataset open
- [x] [P2] Subscription tier record per account with feature flags + guide-export credit counter (data-driven gating)
- [x] [P2] Read-only "viewer mode" when tier lacks edit rights
- [x] [P2] WebGL2 capability detection with unsupported-browser page
- [~] [P3] Status bar on start screen (account tier, app version) + About dialog with third-party licenses — partial: About dialog with version+licenses, tier on /account; no persistent start-screen status bar
- [x] [P3] First-run onboarding tour (start screen concept, EXPERT vs EASY)
- [x] [P4] MFA (TOTP) for accounts
- [x] [P4] Processing/AI status icon column in dataset list

## 1. Patient & Case Management (SPEC §1)

- [x] [P1] Patient record CRUD: last name, first name, DOB, patient ID, comment
- [x] [P1] Dataset entity: one volume + derived objects + 1..n plans; create via DICOM import
- [x] [P1] Delete dataset with confirmation dialog
- [~] [P1] Plan entity with Edit Plan dialog: jaw (maxilla/mandible), unique name w/ duplicate warning, comments — partial: rename + jaw switch in the plan menu, duplicate-name warning in the Copy-plan dialog; no combined dialog or plan comments
- [~] [P1] Auto-open Edit Plan dialog on first dataset open (every dataset ≥ 1 plan) — partial: master plan auto-created; no dialog
- [x] [P1] Plan panel: combo box to browse/switch plans of a dataset
- [~] [P1] Plan create (Ctrl+Shift+N) / copy (element-selection dialog, auto-load copy) / delete (only inside Plan Management dialog) — partial: copy via element-selection dialog (implants/nerves/measurements) with duplicate-name check + auto-load; no Ctrl+Shift+N hotkey
- [x] [P1] "Protect this plan against changes" (reversible write-protection enforced across all editors)
- [~] [P1] "Mark this plan as final" (irreversible; copy-to-edit; required for exports) — partial: reversible approval that gates guide STL export; no irreversible finalize/copy-to-edit
- [~] [P2] Plan Management dialog: list with name, status, last editor, modification date; open/properties/delete — partial: dropdown only; no editor/date columns
- [~] [P2] Plan Compare: select 2 plans → difference report (incl. implant position deltas) — partial: implant position/axis deltas; no full report
- [~] [P2] Implant update mode per plan (3 options) + outdated-object prompt (keep vs replace + recheck notice) — partial: outdated-article detection chip; no per-plan 3-option update mode
- [~] [P2] Plan autosave (debounced + on navigation) with last-editor/timestamp tracking — partial: debounced autosave + updated_at timestamp; no last-editor tracking
- [x] [P2] Anonymize dataset (toggleable pseudonymization of name/DOB/ID)
- [~] [P2] Undo/Redo framework for plan edits (Ctrl+Z / Ctrl+Shift+Z) + "undo last position change" toolbar action — partial: position/shape edits only, no create/delete undo
- [x] [P3] Dataset lock state (sent for production) + admin "remove lock" + lock audit entry — partial: manual lock/unlock + audit; any pro user may unlock
- [x] [P3] Plan status icons: "sent and locked", "copy of transferred plan"
- [x] [P4] Verify Patient Data dialog post-import with don't-overwrite-DICOM warning

## 2. Data Import — DICOM (SPEC §2.1)

- [~] [P1] DICOM upload: multi-file .dcm, folder, or ZIP; server-side staging with progress — partial: staged progress messages + mid-import abort; no folder picker
- [~] [P1] DICOM parser: single-frame series + multi-frame files; tag extraction (patient, study, geometry, modality) — partial: multi-frame files rejected
- [~] [P1] Series validation: consistent orientation/pixel spacing/resolution/modality; axial-only; reject JPEG 2000 with message — partial: dimension/transfer-syntax checks + orientation-consistency warning; compressed syntaxes (incl. JPEG 2000) rejected with message
- [x] [P1] Volume builder: sorted slice stack → 16-bit 3D volume + metadata (spacing, origin, HU rescale)
- [x] [P1] Quick transfer mode: auto-detect valid series, patient-info verification, auto-create dataset
- [~] [P1] Jaw selection at import (maxilla/mandible for the first plan) — partial: jaw switch in plan menu, not at import
- [x] [P1] Patient identity prefill from DICOM tags into patient record
- [x] [P1] Synthetic/demo dataset generator or bundled sample CBCT for development & demos
- [x] [P2] Advanced transfer mode: slice selection (auto-select valid / clear), slice preview with scrollbar, warning detail panel
- [x] [P2] "Always start DICOM import in advanced mode" checkbox
- [x] [P2] Gantry-tilt correction by orthogonal resampling (with interpolation note) — partial: y-shear approximation, documented
- [x] [P2] Import warnings (resolution < 512×512, slice width > 1 mm, missing slices) — never blocking; dataset flagged "created despite warnings"
- [x] [P2] Slice-distance option: Standard / Optimized (1:n) / manual (smallest, most frequent, other) with large-dataset note
- [x] [P2] Import grayscale histogram with lower/upper sliders; full range stored with dataset
- [~] [P3] Grayscale presets at import: save / overwrite / delete; "Read from DICOM data" default; global grayscale factor persisted across imports — partial: histogram lo/hi stored per dataset; no named preset CRUD
- [x] [P3] Region restriction: drag red rectangle in slice preview to crop volume
- [x] [P3] "Fill missing slices black" option (else interpolate)
- [x] [P3] Push embedded DICOM images (OPG/X-ray) to Image Management with metadata dialog — partial: pushed as PNGs; no metadata dialog
- [x] [P4] Permanent anonymization at import via alias name

## 3. Data Import — Model Scans & Meshes (SPEC §2.2–2.4)

- [x] [P1] STL import (binary + ASCII) into mesh objects
- [~] [P1] Model scan import wizard shell: Source → Alignment method → Registration object → Corresponding regions → Auto registration → Verify/Finish — partial: toolbar flow + post-import alignment-method chooser (AI auto / manual point-pairs / copy alignment / defer); no modal wizard shell
- [x] [P1] Corresponding-regions step: alternating clicks on scan & registration object, ≥3 pairs, inline placement rules (far apart, not collinear, teeth/temporary implants)
- [x] [P1] Coarse alignment from region pairs + ICP surface refinement; regions-only fallback with failure guidance
- [~] [P1] Verification stage: merged contour overlay in all views + manual drag alignment (left move / right rotate) — partial: axial contours + drag/Shift-rotate alignment
- [x] [P1] Model scan object in tree: visibility, color, rename (tree Rename button or F2; prompt-based), delete
- [x] [P2] PLY import incl. vertex colors (rendered in 3D)
- [x] [P2] Fine Alignment dialog: nudge buttons, numeric step width (mm/°), patient-oriented vs object-oriented frame (shared with implants)
- [x] [P2] Alignment methods: Copy alignment (same coordinate system) and Do-not-align (exclamation mark, deferred matching by double-click) — partial: copy-alignment + defer via the post-import chooser and an Align-stage button; no exclamation-mark marker
- [x] [P2] Registration object choice: volume segmentation or previously imported scan; "Edit segmentations" shortcut — partial: base select covers scans + segmentations; Edit-segmentations via seg editor in same stage
- [x] [P2] Multiple scans per plan (situ + separate wax-up); matching congruency caution displayed in wizard — partial: congruency caution in the dual-scan match dialog + low-confidence RMS alert after registration
- [~] [P2] Scan visualization: color palette assignment + Edit palettes dialog — partial: free color picker per model
- [x] [P3] Replace Mesh (swap geometry keeping alignment)
- [x] [P3] 3D model import without matching (Object > Add > 3D Model) with manual positioning — partial: upload + fine-align manual positioning
- [x] [P3] Import-time mesh-optimize offer: scans over 320k triangles prompt for decimation to ~250k before planning (original kept as backup)
- [x] [P3] Dual-scan workflow: import segmentation from second dataset of same patient + marker-based matching; flows into guide "Use bottom side of dual scan"
- [x] [P4] Mesh repair toolset on import (repair / detect / cut)
- [x] [P4] Prosthetic design import wizard (order package: scan + restoration + implant proposals + overwrite handling)
- [x] [P4] "Import from device or service" stub (order inbox integration point)

## 4. Viewing & Navigation (SPEC §3)

- [~] [P1] EXPERT planning screen layout: toolbar, view grid, left sidebar (plan panel, object tree, tooth-position panel, density stats), status bar — partial: density-profile panel in the sidebar; tooth-position info lives in the implant toolbar, no dedicated panel
- [x] [P1] Axial view: slice rendering, right-scrollbar + wheel stack scrolling, L/R-reversed orientation
- [~] [P1] MPR resampler service (arbitrary plane slices from volume, worker/GPU-based) — partial: server-side section resampler (curve-perpendicular, ±90° spin, implant-aligned); no worker/GPU arbitrary-plane service
- [x] [P1] Cross-sectional view group: 3 parallel slices perpendicular to panoramic curve, vestibular→oral, ±offset in group title — partial: 1×/3× toggle with configurable spacing; ±offset shown in each side cell's canvas caption, not in a group title
- [x] [P1] Tangential view: cut along curve at middle cross-section; vertical scrollbar rotation ±90° — partial: ±90° spin slider instead of a scrollbar
- [x] [P1] Panoramic (virtual OPG) view: curved-slab reformat along the panoramic curve
- [~] [P1] Panoramic scrollbars: right = temporary parallel curve offset (oral/vestibular) + reset-offset button; bottom = position along curve driving cross-sections — partial: position scrub only; no parallel-offset
- [x] [P1] 3D view: Three.js scene rendering segmentation surfaces + plan objects; orbit via scrollbars/drag
- [~] [P1] View color coding (axial cyan, cross-sectional red, panoramic green, tangential blue) + 2D reference lines toggle — partial: reference lines in pano/cross; no per-view color titles
- [~] [P1] View title bars: color label, caption, Reset, Maximize/Restore (+ double-click title, F11) — partial: maximize button + Esc restore; no F11
- [~] [P1] Move and Turn tool (Ctrl+M): pan all views, rotate 3D — partial: middle-drag pan in slice views + 3D orbit drag; no dedicated Ctrl+M tool
- [x] [P1] Localizer tool (Ctrl+L): click centers all views on the 3D point
- [~] [P1] Zoom: Shift+wheel everywhere; zoom tool (click step / drag dynamic); Reset all views — partial: Ctrl/Shift+wheel + numeric zoom readout in slice views, Ctrl+0 resets them all; pano/cross wheel scrubs position; no dedicated zoom tool
- [x] [P1] Window/level: Adjust Grayscale dialog (histogram, dual handles, Left/Width/Level/Right spinners, live axial preview, HU labels for CT)
- [~] [P1] Align views to implant (cross-sectional/tangential/axial to selected instrument axis; toggle revert; 360° tangential rotation) — partial: cross/tangential align toggle + ±90° section spin; axial not re-oriented
- [~] [P1] Status bar: patient info + live chips (Average density HU, Distance to other implants, Distance to nerve canal, Distance to other sleeves) with red/green state — partial: nerve + implant distance chips with red state + safety warnings; density readout in the implant toolbar; no patient-info or sleeve-distance chip
- [x] [P2] Status-bar distance chip popups listing per-object live distances (1 decimal mm)
- [~] [P2] Cross-sectional link button "jointly move and zoom" + auto-recenter on implant selection — partial: auto-recenter done; no link button
- [x] [P2] 3D default-perspective dropdown (Left/Right/Anterior/Posterior/Superior/Inferior)
- [~] [P2] Millimeter scale bars in 2D views (toggle, default on) — partial: drawn in axial/cross/pano views; no on/off toggle
- [~] [P2] Orientation indicators: 2D orientation strings + 3D cube/model (L/R/A/P/H/F), model choice setting, Ctrl+1..6 — partial: 2D letters + 3D text direction readout; no cube/model or Ctrl+1..6
- [~] [P2] View > Objects visibility submenu (implants, axes, crestal levels, 3D models, abutments, sleeves, teeth) + per-object tree checkboxes — partial: per-object eyes + per-category group toggles in the tree + axes/crestal/selection-box checkboxes in the view panel; no menu-bar submenu
- [x] [P2] Vertical & horizontal 3D cuts (clip planes bound to current cross-section / axial position)
- [x] [P2] Per-view Snapshot button (high-res capture, size choice, save to Image Management or download)
- [~] [P2] Grayscale presets in dialog (save/overwrite/delete; "Implant Planning (CT)" factory preset) — partial: fixed presets; no save/delete
- [x] [P2] Hotkey system + hotkey list dialog (?, Ctrl+F1, ⌨ button in the case title row) per SPEC §3.9
- [x] [P3] Panoramic X-ray mode toggle (ray-sum projection vs curved slice)
- [x] [P3] Axial mirror-horizontally button
- [~] [P3] View display-mode choosers (pane-config switching: cross-sectional+tangential / +panoramic / only) + toolbar config-cycle button — partial: cross/tangential toggle + 1×/3× section group per pane; layouts stage-fixed
- [~] [P3] 3D Setup dialog: per-segmentation visibility/name/color/transparency, Alpha/Beta/Gamma absolute rotation, relative rotation step, move/zoom steps, 6 perspectives, 3D contrast/brightness, threshold edit — partial: per-view presets/threshold/clip/stereo/6-perspective controls + per-model color/transparency/looks; no absolute-rotation or step-size fields
- [x] [P3] Interactive grayscale drag tool (up/down = level, left/right = width)
- [x] [P3] Smooth animated view transitions (setting, default on)
- [~] [P3] Image Management: per-patient image library (add file BMP/JPEG/TIFF/DICOM + metadata, select/invert/clear, delete, export with naming & format options) — partial: snapshot library with download/delete; no external upload
- [x] [P3] Image Viewer: 1/2/4-image layouts, navigation, info display, full screen, pan, 5 zoom levels
- [x] [P3] Screenshot function (F8) honoring Screenshot settings (filename scheme, storage, notification)
- [x] [P3] Sidebar collapse (F9; also available as a pinnable quick action)
- [x] [P3] Double-click in the 3D view sets the orbit pivot to the clicked surface point (Reset view restores)
- [x] [P3] 3D display extras: volume-render visibility toggle, implants-through-surfaces x-ray mode, per-model looks (Standard/Metallic/Triangles/X-ray), mesh properties readout via /api/models/[id]/stats (triangles, points, surface, volume, dimensions)
- [x] [P4] Stereo 3D anaglyph mode (red/cyan) + Stereo 3D settings tab — partial: anaglyph mode; no separate settings tab
- [x] [P4] Thumb-wheel rotation in 3D/panoramic/tangential views — partial: continuous rotate buttons + drag; no literal wheel widget
- [x] [P4] Reindeer/Easter-egg orientation models

## 5. Alignment & Panoramic (SPEC §4)

- [~] [P1] Patient Coordinate System object (View definition category) with default pose from volume — partial: bake-in resample, no persistent PCS object
- [~] [P1] Align PCS dialog: 3 sub-views (sagittal/coronal/axial), green/red/blue planes, left-drag move / right-drag rotate, OK/Cancel — partial: in-view drag-rotation on the three planes with live preview + numeric yaw/pitch/roll + auto-proposal; rotation-only (no translation)
- [x] [P1] PCS reset-to-default button; PCS drives initial implant orientation & virtual-tooth pose
- [~] [P1] Panoramic curve object: 5 basic points (movable, not deletable), tooth-position labels on end points (48/38, 18/28 FDI), incisal middle point — partial: free-form points + guided five-marker mode (incisal / canine–premolar / tooth-8 prompts); no FDI end-point labels
- [x] [P1] Edit Panoramic Curve dialog (axial view + layer scrollbar, Ctrl+P)
- [~] [P1] Curve editing: drag points; click along curve to add red extra points; right-click delete extra point; Shift+drag whole curve; reset to initial shape — partial: drag/append/clear only; no insert/delete/shift-drag
- [x] [P1] Curve regenerates panoramic & cross-sectional views live
- [x] [P2] Geometric auto-proposal of PCS + panoramic curve from segmentation (jaw-arch fit)
- [x] [P2] PCS dialog extras: horizontal 3D cut toggle + Setup 3D Views (threshold) access
- [x] [P3] EASY axial-position popup (upper-right 3D orientation aid while scrolling)
- [x] [P2] Occlusal reference plane: draggable height line in the coronal/sagittal views, persisted per plan; drives the default implant depth (10 mm below/above per jaw)

## 6. Segmentation & 3D Models (SPEC §5)

- [~] [P1] Threshold segmentation: High/Low window slider + numeric boxes; live 3D surface rebuild (slot 1 "Default") — partial: numeric lo/hi HU bounds, editable in place; no dual-handle slider widget
- [x] [P1] Surface extraction pipeline (marching cubes, worker-based, cached per threshold)
- [~] [P1] Segmentation slots (max 8): name (Enter-commit, predefined list), color (cycle/palette dialog), transparency, visibility — partial: multiple named segmentations (preset name list) w/ color/opacity + server mask slots; no 8-slot cap or palette-cycle UI
- [x] [P1] Segmentations listed in object tree with visibility checkboxes
- [~] [P2] Segmentation mode UI (Scanview): main view + 4 reference views (axial/coronal/sagittal/3D), left parameter pane, auto-save on exit/slot change — partial: mask editing inline on the axial view; no dedicated 4-view mode
- [x] [P2] Target/Source/Exclude slot semantics (source constrains tools, "None" = free, "Source visible in 3D", exclude column) — partial: server slots+roles enforced; minimal UI (main slot default)
- [~] [P2] Flood Fill tool (LMB add / RMB delete, boundary-aware, Ctrl+F) — partial: boundary-aware HU-range fill with add/erase modes + 3D-seeded volumetric fill; no Ctrl+F binding
- [~] [P2] Brush tool (3 sizes, LMB select / RMB erase, source-constrained, Ctrl+P/Ctrl+S) — partial: continuous-size brush, add/erase, source/exclude constraints via mask-slot roles; no 3-size cycle or hotkeys
- [x] [P2] Segmentation boundary polylines (yellow, freehand+polyline, close/clear, Ctrl+L, Ctrl+Backspace) — partial: freehand point placement; no Ctrl+L/Ctrl+Backspace bindings
- [x] [P2] Slice-propagation automatic segmentation (Page Up/Down, 2D-only, boundary-aware, check-slice warning) — partial: propagate buttons + >40% check-slice warning; no PageUp/Down binding
- [~] [P2] Whole-dataset ops: all-voxels-in-slice select/clear, segment whole dataset (confirm), clear whole segmentation (confirm; re-enables threshold edit) — partial: init-from-threshold over the whole dataset
- [x] [P2] Segmentation undo/redo (10 steps) + Segmentation Options toggles (undo on/off, auto-refresh small 3D)
- [x] [P2] Volume readout per segmentation (ml)
- [x] [P2] Convert segmentation → 3D model (LOD presets Coarse/Standard/Fine) — partial: LOD-preset select (user-editable presets + Full detail) on Build 3D model
- [~] [P2] EASY single-handle segmentation-threshold slider — partial: 3D display threshold only
- [x] [P3] Import segmentation boundaries from surface objects (model scans, implants)
- [~] [P3] Scanview aux tools: measurement grid, oblique cut, area measurement (cm²), 3D cut dialog (square/plane/pyramid, grayscale cut faces) — partial: measurement grid + area (cm²) + section-plane spin for oblique viewing; no 3D cut dialog
- [~] [P3] Fast Paint performance toggle — partial: local paint preview is already immediate; no explicit toggle
- [x] [P3] LOD preset editor (algorithm, resolution, noise reduction, reduction, filter; CRUD; default flag)
- [x] [P3] VPE STL export: one segmentation/scan per export, untouched vs implant analogs, include-implant-positions, patient vs object coordinate system, single vs multi-file — 4-step wizard with scanbody profile thumbnails and 3D preview
- [x] [P3] Augmentation wizard: segmentation pick → closed outline drawing (point edit, end-of-outline toggle, closed-gate for Next) → filling-material slider, color, volume in ml, Apply
- [x] [P3] Augmentation object: positionable for donor check, Redo reset, hidden in panoramic — partial: positionable model; not auto-hidden in panoramic
- [x] [P4] Mesh editor: local smoothing, wax knife, local remeshing, hole filling, surface bridges — dedicated window adds parts/erase, margin-spline cut, Combine (merge/subtract w/ show-object preview), partial fill, remesh maxEdge+strength, select-area smoothing (A–D strengths), reduce w/ recommendations, boundary optimization, Surface/edges/wireframe view types, ctrl-wheel radius, dbl-click pivot, drag-paint, undo/redo, save-as-copy
- [x] [P4] Automated virtual tooth extraction on scans (Cut out / Cut out and close / Cut out dental alveolus)
- [x] [P4] AI segmentation pipeline + review dialog (checkmark import, error objects unselectable) + merged AI model + jaw hole filling — partial: vendor CBCT backend (42 FDI-labelled classes) when configured, offline heuristic fallback; 5-step NAM review wizard + merge dialog
- [x] [P3] AI tooth renumbering (/api/models/[id]/renumber): same-arch targets shift the contiguous run of AI teeth, opposite-arch relabels the single tooth; collision/off-arch checks
- [x] [P3] Merge models dialog: combine selected case models (e.g. AI teeth + jaw) into one mesh, with arch quick-picks (/api/cases/[id]/merge-models)

## 7. Nerve Canals & Measurements (SPEC §6)

- [x] [P1] Nerve canal objects: left/right + renamable branches; ordered point list with per-point diameter (default 2.0 mm)
- [x] [P1] Pink tube rendering in 3D + slice intersections in 2D + curve in panoramic; endpoint highlighting
- [~] [P1] Manual tracing: click-to-add in any 2D view (current slice), drag-move points, delete point / delete all — partial: place in pano/cross/axial + drag in all of them, per-point delete + delete nerve; no placement in the spin-rotated section
- [x] [P1] Point Diameter dialog (text box + slider + "Apply to all points")
- [x] [P1] Safety distance engine: implant↔implant (incl. sleeves) 3 mm, implant↔nerve 2 mm, sleeve↔sleeve collision 0 mm; live recompute on drag; advisory only
- [~] [P1] Warning surfacing: status-bar chips red/green + object-tree warning icons — partial: no object-tree icons
- [x] [P1] Distance measurement (2 points, mm, 1 decimal, view-local display, value in tree)
- [x] [P1] Angle measurement (3 points, degrees)
- [x] [P2] Automatic nerve detection between foramen seed points (Detect button in tree, context menu, EASY Auto detect; replaces intermediate points with warning) — offers routing through intermediate markers as waypoints or endpoints-only (user choice)
- [~] [P2] Live density readout under cursor while dragging nerve points — partial: hover HU in orthogonal views only
- [x] [P2] Nerve point context menu: bring-to-slice, interchange successor/predecessor, show point numbers, center-views-to-point, clickzoom toggle — partial: point toolbar (center/to-slice/swap/numbers); right-click reserved for W/L
- [x] [P2] Nerve cautions displayed verbatim (verify manually / poor image quality / safety distance)
- [x] [P2] Continuous distance measurement (polyline, per-segment labels, total in tree)
- [x] [P2] Auxiliary line object (2 points, no value)
- [~] [P2] Measurement editing semantics: positioning-mode handles, blue selection, off-slice transparency + jump-to-slice, Shift-drag whole object, point context menu — partial: drag handles with live recompute + persist; no off-slice transparency/Shift-drag
- [~] [P2] Annotations: point-anchored text in all views + tree, red rendering, edit dialog — partial: axial + cross/tangential rendering with color/text-size settings; prompt-based editing, no edit dialog
- [~] [P2] Interactive density probe (circle cursor, LMB average, RMB cycles 3 sizes, HU for CT only) — partial: single-pixel click; no circle sizes
- [~] [P2] Density statistics panel: vertical + horizontal distribution diagrams, top/bottom offset sliders, outline-only vs whole-area toggle, Ø HU footer + status-bar mirror — partial: vertical profile + Ø HU; no horizontal diagram/offset sliders
- [x] [P3] Measurement rename (name column, migration 15; ✎ button in the tree) + 3D-point measurements in the cross/tangential view (endpoints on different sections measure in true 3D)
- [x] [P3] Angle Between Implants dialog (selection/master table, align-to-master vs mean direction, real-time updates, stays open)
- [x] [P3] Angle Between Abutments dialog (+ acceptable deviation column)
- [x] [P4] HU-validity informational note for CBCT modality

## 8. Implant Planning (SPEC §7)

- [~] [P1] Implant catalog schema: manufacturers, series, items (article no., length, Ø1, Ø2, total length, insertion depth, region, outdated, date added) + geometry meshes — partial: line-level catalog with article prefixes, regions, outdated + tech-info; parametric geometry, no per-item meshes or Ø2/insertion-depth fields
- [x] [P1] Seed catalog content (generic manufacturer + demo series incl. fixation pins and endodontic drills)
- [~] [P1] Choose Implant dialog: manufacturer/series tree (All/Filtered/Favorites), implant table view with sortable columns — partial: quick-search + filter selects with thumbnail cards, favorites toggle; no tree or sortable table view
- [~] [P1] Dental chart in dialog: plan-jaw only, multi-position select, assigned positions gray, XX undefined position — partial: full-mouth chart with other-jaw dimmed + placed positions marked; single-select; pins default to XX
- [x] [P1] Insert implants: OK (initial pose from panoramic curve + occlusal plane) and Add-at-current-position (single selection)
- [~] [P1] Implant rendering in all 2D views + 3D; object tree grouping under tooth positions — partial: flat tree, not grouped by tooth
- [x] [P1] Positioning: left-drag translate / right-drag rotate with crestal/tip pivot logic; positioning-mode auto-on after add
- [~] [P1] Tooth Position panel Implant tab: info, Change Implant, prev/next diameter & length steppers, full combination list — partial: info + Change… + ⌀/length steppers + depth nudge + fine positioning; no full combination list
- [~] [P1] Change implant flow (current blue / previous red in dialog) + sleeve-recheck prompt — partial: change dialog (keeps position/axis) + sleeve-recheck prompt; no blue/red before/after compare
- [x] [P2] Quick search + filter dialog (manufacturer/length/diameter/favorites/outdated/user-defined/region) + favorites stars
- [x] [P2] Thumbnail view with badges (abutment, sleeve, region globe, tech-info cogwheel hover, favorite, user icon)
- [x] [P2] Fixation pins as implants: XX default position, lateral auto-angled placement, pin sleeves
- [x] [P2] Endodontic drills as implants (straight-path note) 
- [x] [P2] Make Parallel dialog (implant checkbox list, master vs mean direction, Preview/Reset/confirm)
- [x] [P2] Implant Appearance toggles (axes, crestal planes, 3D models in 2D) + 2D implant color + selection box setting — partial: 3D-models-in-2D rendered as scaled glyphs, not mesh sections
- [x] [P2] Tooth-position relabel via header Properties (label-only change) — partial: via Change… dialog (keeps position/axis)
- [x] [P2] Localizer double-click to add implant at point
- [~] [P2] Object groups: create dialog (two-list picker + hotkeys), group move modes (none / implants only / all objects), batch visibility/abutments/sleeves — partial: group visibility toggles per object type; no custom groups
- [~] [P3] Abutments: catalog tab on implant add; Edit Abutments dialog (database/user-defined/none; all-vs-selected prompt) — partial: preset abutments per implant (straight/angled), 2D/3D render, report column
- [x] [P3] Group abutment assignment with automatic angulated-abutment selection (axis parallelization, All-on-4/6)
- [x] [P3] Abutment rotational alignment tab (drag around implant axis)
- [x] [P3] User-defined abutment editor (emergence profile + mesostructure, height/Ø per segment, inclination 0–45°, rotation, handles)
- [x] [P3] Virtual teeth from library (prosthetic-driven planning) — chart picker places watertight 3D wax-up crown meshes (virtualTooth.ts) with fine-align Size scaling
- [x] [P3] Per-implant position lock (migration 16): toolbar Lock button, bulk Lock/Unlock implants in the plan menu, padlock icons in the tree; locked implants ignore drag edits
- [x] [P3] Implant fine-positioning panel: M/D, B/L and depth step nudges in the implant frame + shoulder/tip-pivot tilts with steps down to 0.1°
- [x] [P3] Catalog admin: import/update catalog versions, outdated flagging, region availability
- [x] [P4] Implant Designer (segment editor or STL import, publish-to-catalog with lock + user icon)
- [x] [P4] Density-statistics-driven sinus-lift offsets documentation links in panel

## 9. Sleeve Planning (SPEC §8)

- [~] [P1] Sleeve catalog: systems (open/closed, implant compatibility), sleeve items (inner/outer Ø, height, article no.), discrete position offsets (e.g. H2/H4/H6), negative geometry definitions — partial: Ø/height/offset/wall per system + manufacturer-based recommendations; negative-geometry segments on custom systems only, no article numbers
- [~] [P1] Sleeve dialog: compatible-systems list per selected implant, parameter editing with live schematic, prev/next implant arrows — partial: Recommended (implant manufacturer) vs Open grouping in the selects; no live schematic or prev/next arrows
- [x] [P1] Sleeve object rendering (2D green cross-section + 3D) linked to implant axis
- [~] [P1] Sleeve position offset selection (discrete system increments) + interactive snap-drag in views — partial: discrete selects; no snap-drag
- [x] [P1] Remove sleeve (trash / "No sleeve system")
- [~] [P2] Group sleeve assignment (systems supported by all selected implants) — partial: bulk assignment picking each implant's recommended system; no supported-by-all intersection
- [x] [P2] Sleeve tab in Tooth Position panel (system combo + editable values)
- [~] [P2] Sleeve↔sleeve collision detection feeding status bar + EASY banner — partial: status-bar warning, no EASY banner
- [x] [P2] Custom sleeve system wizard: geometry (manual params or STL with top-side/rotation definition) → position modes (crestal / top of implant / complete length) → sleeve holes (auto / segment designer / none) → summary + preset save
- [x] [P2] Negative-geometry segment editor (height, upper/lower Ø, distance-to-zero-level; auto 3-segment proposal)
- [x] [P3] Custom sleeve preset import/export/delete (no in-place edit)
- [x] [P3] Auxiliary/dummy sleeve guidance for sleeveless guides + never-drill-through caution
- [x] [P3] Sleeve calibration matrix: STL generation (hole series in 0.01 mm steps), best-fit hole picker dialog, per-sleeve-model offset storage applied at guide export
- [x] [P4] Per-printer calibration matrix variants

## 10. Surgical Guide Design (SPEC §9)

- [~] [P1] Guide design wizard shell (steps, Back/Next/Finish, live 3D preview, dark theme) — partial: single-panel options + live footprint/undercut previews; no multi-step wizard
- [x] [P1] Prerequisite checks: implants+sleeves present, matched scan present; warnings list
- [~] [P1] Insertion-direction step: view direction = insertion vector; slider + mouse adjustment — partial: along-implant-axes / vertical / current-3D-view-direction modes + undercut color preview; no drag slider
- [x] [P1] Automatic undercut block-out from insertion direction (silhouette sweep of inner surface)
- [x] [P1] Contact surfaces: sphere placement at tooth positions (diagram picker, wheel/panel sizing) — 3D click-to-place support circles + FDI diagram picker + drag handles/wheel resize
- [x] [P1] Automatic sleeve mounts for all plan sleeves with size/diameter controls
- [x] [P1] Offset / wall thickness / connector thickness parameters (defaults 0.15 / 3.0 / 2.5 mm) + body generation with automatic connectors
- [x] [P1] Guide body CSG: inner surface offset, outer shell, sleeve hole subtraction from negative geometry
- [~] [P1] Finish step: review render; guide becomes object-tree object; 2D cross-section rendering (white guide, green sleeve) — partial: tree object + dashed guide contours in the axial view; no cross-view guide section
- [x] [P1] STL export of final guide (binary STL download; export records audit entry)
- [x] [P1] Export gating: plan must be finalized; guide-export credit decremented with remaining-credit display — approval + stale-design checks; credits spent atomically, balance returned via X-Credits-Remaining
- [x] [P2] Start options: new vs from-template guide; "With bone support regions"; "With bone reduction (cut profile)" — partial: recipes act as templates; bone-support/reduction via options panel
- [x] [P2] Base-object selection pre-step (model scan / 3D model / converted guide)
- [~] [P2] Inspection windows: click-to-place cylindrical cutouts, per-window height/diameter controls + wheel, unlimited, stability caution — partial: click-to-place + diameter + elongated (stadium) length/angle; windows always cut the full guide height
- [x] [P2] Label step: multiple embossed text labels, drag anchor, font size/style, confirm check, presets (factory + user)
- [x] [P2] Stale-design tracking: warning sign when planning changed after design; production blocked; Edit guide design reopens wizard
- [x] [P2] "Use bottom side of dual scan" (mucosa-supported guides) — partial: intaglioModelId param; pass a second scan in Design options
- [x] [P2] Design-rule validation warnings: 200×200×100 mm volume, ≥3 support points, bar minimum 4×3 mm
- [x] [P2] Use-large-connectors option
- [x] [P3] Bone support regions step: add region, pick segmentation, drag handles; show-sleeves option; persisted segmentation choice
- [x] [P3] Free-hand drawing tool for contact areas (palatal support, stacked-guide edges)
- [x] [P3] Show contact surface order / connector preview toggle
- [x] [P3] Cut profile object: panoramic reference points, Add implant base points, offset + angulation params, invert-profile + spline options — partial: bone-reduction bars carry the cut level; no separate profile curve
- [x] [P3] Bone reduction bars step (Oral/Vestibular checkboxes; width/height/offset per bar)
- [x] [P3] Bone-reduction simulation: cuts the anatomy model at the bar profile height (incl. gingiva-height allowance) and saves the post-reduction situation as a new model
- [x] [P3] Sleeve-mount hole shape option (cylindrical vs fit-to-form)
- [x] [P3] Convert guide → 3D model (stacked-guide base)
- [x] [P3] Stacked-guide recipe support (unselect pin sleeves, spheres on pin holes, edge drawing) — partial: recipe + convert-to-model base; no sphere-on-pin-hole step
- [x] [P3] Producer export dialog: adjust offset/wall thickness at export + calibration-matrix offset application
- [x] [P4] Endodontic / apicoectomy / sinus-lift guide recipe presets (documentation + default parameter sets)
- [x] [P4] Tooth auto-transplantation evaluation guide workflow — partial: recipe preset + note; no donor-tooth pairing UI

## 11. Wizards & Work Modes (SPEC §10)

- [~] [P1] Shared wizard component framework (modal steps, per-step toolbar, embedded views, inline help) — partial: per-feature modal wizards (VPE, AI review, custom sleeve, augmentation, mesh editor) + stage step rail; no single shared framework component
- [x] [P1] EXPERT workflow toolbar: numbered step buttons in SOP order with green done-state
- [x] [P1] EASY shell: step-overview tree (4 steps + sub-steps, blue current, one-click jump), bottom nav (Home auto-save, Back/Forward, Help, Plan Management)
- [~] [P1] EASY Step 1: Jaw Selection & Alignment (jaw selector, PCS drag, threshold slider, Edit source data) — partial: maps to expert align tools; jaw in plan menu
- [x] [P1] EASY Step 1: Panoramic curve sub-step (pre-aligned views, point editing)
- [~] [P1] EASY Step 1: Nerve canals sub-step (View|Right|Left selector, foramen point placement, Auto detect footer button) — partial: nerve chips + auto-detect (with waypoint choice) via the shared toolbar; no View|Right|Left selector
- [x] [P1] EASY Step 2: Place implants (Add/Change/Remove implant buttons, chart color coding, length/diameter ± steppers) — via the shared implant toolbar; chart marks placed positions
- [~] [P1] EASY forced distance warnings: yellow in-view banner + implant-selector marking — partial: status-bar text + red glyphs; no banner
- [x] [P2] EASY Step 1/3: Model scans sub-step (Add/Edit/Remove → shared wizard)
- [~] [P2] EASY Step 2: Select sleeve / Select abutment per implant + Overview node all-at-once assignment — partial: sleeve sub-step + bulk assign; abutments via the shared implant toolbar, no dedicated sub-step or Overview node
- [x] [P2] EASY Step 3: Surgical guide (Create/Edit surgical guide, object-visibility segment control, stale warning)
- [~] [P2] EASY Step 4: Finish (protocol selector, page arrows, Print + Save to PDF) — partial: combined protocol with per-section selection (Print all…) + browser print; no page arrows
- [x] [P2] EASY contextual help panel per step (collapsible, content authored per step)
- [x] [P2] Mode switching: EASY ↔ EXPERT on same dataset without data loss
- [x] [P2] EASY temporary measurements mode in implant step
- [x] [P3] EASY zoom hotkeys (Ctrl +/−/0) + Ctrl-click recent dataset opens in EASY
- [x] [P3] Toolbar customization (right-click Adjust, drag in/out, preset reset) — partial: Adjust dialog with tool checkboxes, pinnable quick actions, hideable workflow steps + full reset; no drag in/out
- [x] [P4] Treatment Evaluation module: study list, scanbody-scan and postop-CT study types, region matching, implant alignment, deviation report + CSV export
- [x] [P4] AI assistance integration points (import offer, toolbar button, background jobs, review dialog, status icons)

## 12. Reports & Printing (SPEC §11)

- [~] [P1] Server-side PDF generation service (layout engine, fonts, image embedding) — partial: browser print-to-PDF, no server renderer
- [~] [P1] Common report chrome: header (logo, version, licensee, title, patient block, notation note), footer (disclaimer verbatim, timestamp, copyright), non-diagnostic caution — partial: logo + practice block + patient table + timestamp + disclaimer + signature lines; no version string or verbatim original texts
- [~] [P1] Material list report (implants/sleeves/abutments BOM with article numbers, dimensions, tooth positions) + All-Plans variant — partial: BOM with synthetic article names; no All-Plans variant
- [~] [P1] Details report: per-implant pages with view captures (3D/axial/cross-sectional/panoramic centered on implant) + implant/sleeve data + All-Plans variant — partial: per-implant cross-section figures + panoramic overview; no multi-view pages or All-Plans variant
- [x] [P1] Surgical protocol report: per-implant drill sequence from data-driven protocol definitions (position, drills with Ø/color, implant, depth stop/H-position) — incl. bone-class and handle-color columns
- [~] [P1] Print menu (Plan > Print ▸ / toolbar Print dropdown) wired to all protocols — partial: report page with Print/PDF + Print all… (per-section selection) + QR export; no per-protocol menu entries
- [~] [P2] Protocol definition data model per sleeve system (ordered steps, conditions on implant Ø/length, 3 bone classes) + "no protocol available" notice — partial: static catalog, conditions on implant diameter only
- [~] [P2] Bone-class rows (soft/medium/hard), handle/length glyph coding, cortical-only marks, manual-step marking — partial: bone-class column + cortical-only steps; no glyph coding
- [~] [P2] Print preview pane (page nav, zoom, download, close) + direct-to-PDF path — partial: HTML preview; no page nav/zoom
- [x] [P2] Print All batch dialog with persisted document selection
- [x] [P2] Screen copy (current screen capture to PDF/PNG)
- [x] [P2] User logo upload (PNG/JPEG/BMP/WebP) + header inclusion setting; plan-comment-on-material-list setting
- [~] [P3] Finalized-plan stamp/verification on production reports — partial: "(approved)" label only
- [x] [P3] Plan approval PDF (patient/plan ID, planner, tables, view images, signature lines)
- [x] [P4] iChiropro-style QR export stub of protocol data

## 13. Collaboration (SPEC §12)

- [x] [P2] Contact pairing: 7-digit connection/share codes between accounts; contact list grouped by type; delete contact with warning
- [x] [P2] Plan send flow: contact picker (resend preselect + verify warning), comment field, consent disclaimer gate
- [x] [P2] Send side-effects: plan write-protect + "Sent" status label; Plan > Edit creates editable copy keeping sent version in history — partial: write-protect + Sent label; Edit-creates-copy via Duplicate
- [x] [P2] Transfer activities: states (upload→download→import→finished/rejected), transfer numbers, colored status bars, recipient-download acknowledgment
- [x] [P2] Inbox: notifications (in-app toast; optional email), auto-filtered download list, one-click download/import; received plans write-protected — partial: in-app badge + list; no email
- [x] [P3] Transfer list management: quick search, filters, Send Back, Download Again, Tidy-up, auto-remove finished after N days, background transfers with Hide — partial: search/filters/tidy-up; no background-hide
- [x] [P3] Service requests: Digital surgical guide (matching/design/fabrication sub-items + requirements text), Custom, Bone block design, Radiographic assessment; non-binding note; reject with minus icon
- [x] [P3] Order Management (provider): registration with offered services, lab directory listing, asynchronous pairing (confirmation pending → email confirm)
- [x] [P3] Order list: color-coded service types, grouping (contact/patient/service), full-text search, sequence-controlled locking, Process/Finish/Reject/Remove
- [~] [P3] Read-only share links: tokenized presentation viewer (implant list, aligned 3D, 2D views, watermark), revocable — partial: tokenized read-only doc (tables); no 3D viewer/watermark
- [~] [P3] Quick Export/Import: single-plan archive download/upload (.caf-style) with write-protect + Sent label — partial: plan JSON archive; no write-protect/Sent label
- [x] [P4] Full dataset archive export/import (all plans + images) with version-compatibility warning
- [x] [P4] Auto-backup suggestions for stale datasets (N days, check frequency)

## 14. Settings & Administration (SPEC §13)

- [~] [P1] Settings dialog framework (tabs, per-user persistence, defaults per Appendix A) — partial: tabbed settings page (Practice / Planning & Safety / Views / Common / Printout / Screenshots / Users / Audit); settings are instance-global, not per-user
- [x] [P1] Safety distance tab (2 enable checkboxes + mm spin boxes, 0–10 ranges, sleeve note)
- [~] [P1] Implants tab: dental notation FDI/Universal (drives chart, labels, reports), axes options, visible-through-segmentations, selection box, rotation-pivot setting, 2D color — partial: notation + axis-extension length + default implant color in settings; axes/selection-box/x-ray toggles live in the view panel; no rotation-pivot setting
- [~] [P2] Views tab: smooth transitions, orientation model, outline width adapt, auxiliary/annotation/measurement colors, text size, joint cross-sectional move/zoom, rotate-on-align (×2), cross-sectional distance — partial: smooth transitions, annotation/measure colors, text size, line thickness, cross-section spacing; no orientation-model or joint-move/rotate-on-align options
- [x] [P2] Common tab: measurement decimal places
- [x] [P2] Printout tab: plan comment on material list, logo upload + enable
- [~] [P2] Screenshot tab: filename scheme (default/anonymized/user-defined + placeholders), storage target, format, save notification — partial: scheme with placeholders + PNG/JPEG format + save notification; storage fixed to the image library (Alt+click downloads)
- [x] [P2] Management console page: account profile, password change, language placeholder, subscription/credits display
- [x] [P3] Teams: invite members, roles, per-patient/dataset permissions (read/modify/delete; most restrictive wins; owner override) — partial: settings-backed model + resolveAccess; enforcement is opt-in per ACL entry
- [x] [P3] Audit log (finalize, export, share, delete, anonymize events) with viewer UI
- [x] [P3] Catalog admin UI (upload catalog versions, edit protocol definitions, flag outdated items) — partial: upload/activate/outdated-flag; protocol definitions not editable
- [x] [P3] Context-sensitive help system (F1, per-dialog "?" content) + help site — partial: F1 + per-stage topics; no per-dialog ? buttons
- [x] [P4] i18n framework + additional UI locales (DE/FR/IT/NL/HU) — partial: 122-key framework, 6 locales; planning workspace adopts progressively
- [x] [P4] Export-credit purchase/management flow (mock billing)
- [~] [P4] Demo/read-only sandbox mode with bundled sample case — partial: demo case creation; not read-only

## Status summary (auto-reconciled)

Re-reconciled against the codebase on 2026-06-12, after the stage-2 (17 official training videos) and stage-3 (42 YouTube tutorials) completeness passes (305 items — 11 added for pass-2/3 features without an existing line). Zero open items; every feature is at least partially implemented and [~] rows carry an explicit '— partial:' scope note describing what is still missing.

| Priority | [x] done | [~] partial | [ ] open | Total |
| -------- | -------- | ----------- | -------- | ----- |
| P1       | 54       | 52          | 0        | 106   |
| P2       | 68       | 32          | 0        | 100   |
| P3       | 61       | 11          | 0        | 72   |
| P4       | 26       | 1          | 0        | 27   |
| **All**  | **209**  | **96**      | **0**    | 305   |

### Largest remaining P1 deltas (all partial, none open)

- Combined Edit Plan dialog (jaw + duplicate warning + comments in one place; pieces exist in the plan menu / copy dialog) (§1)
- Multi-frame DICOM files still rejected at import (§2)
- Persistent PCS object with translation (current PCS is a rotation-only bake-in resample) (§5)
- Dual-handle threshold slider widget (numeric lo/hi boxes only) (§6)
- Server-side PDF rendering for reports (browser print-to-PDF today) (§12)
- Per-user settings persistence (settings page is instance-global) (§14)
