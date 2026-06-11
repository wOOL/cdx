# Source-coverage map

Block-by-block mapping of the original IFU (88 pages) to this manual. "Figures" counts the
original's content images (excluding the page-header logo) and names our counterpart images.

| IFU pages | Topic | Our section | Figure counterparts | Status |
|-----------|-------|------------|---------------------|--------|
| 1–4 | Cover, contents | README.md (TOC) | — (cover art not replicated; TOC is text) | done |
| 5–8 | About, disclaimer, license | 01-about.md | none in original body | done |
| 9–10 | Intended use, device description | 02-introduction.md §2.1–2.2 | — | done |
| 11–12 | Workflow diagrams | 02-introduction.md | workflow-position.png, workflow-steps.png | done |
| 13–20 | Accessories, indications, contraindications, precautions, compatibility, data protection, further info | 02-introduction.md §2.3–2.9 | — | done |
| 21–23 | Installation, disposal | 02-introduction.md §2.10–2.11 | install screenshots → deployment code block (no GUI installer in a web app) | done |
| 24 | Basic principles, getting acquainted | 03-basics.md §3.1 | — | done |
| 25–26 | Start screen, annotated | 03-basics.md §3.2 | start-screen.png (annotated, 8 callouts) | done |
| 27–28 | DICOM import + caution | 03-basics.md §3.3 | data-stage-empty.png, import-wizard.png, dataset-card.png | done |
| 29–30 | EASY UI annotated | 04-easy-mode.md §4.1 | easy-screen.png (annotated) | done |
| 31–32 | EASY navigation/help symbol tables | 04-easy-mode.md §4.1 | ui crops (see reconciliation) | done |
| 33–41 | EASY case planning steps | 04-easy-mode.md §4.2 | easy-align/pano/nerve/implants/sleeves/guide views, easy-rail-pano.png | done |
| 42 | EXPERT screen annotated | 05-expert-ui.md | expert-screen.png (annotated) | done |
| 43–44 | Toolbar | 05-expert-ui.md §5.1 | toolbar visible in stage figures; customization documented | done |
| 45 | View-manipulation symbol table | 05-expert-ui.md §5.2 | ui crops (see reconciliation) | done |
| 46–47 | Object tree | 05-expert-ui.md §5.3 | object-tree.png | done |
| 48 | Plans | 05-expert-ui.md §5.4 | plan-menu.png | done |
| 49 | Align PCS | 06-expert-planning.md §6.1 | pcs-dialog.png | done |
| 50 | Panoramic curve | §6.2 | pano-stage.png | done |
| 51–52 | Nerve detection | §6.3 | nerve-stage.png | done |
| 53–55 | Model scan import/match (+ edentulous hint) | §6.4 | match-stage.png, fine-align.png | done |
| 56–61 | Treatment planning incl. bone-reduction profile, transplant, endo caution | §6.5–6.6 | implant-dialog.png, implant-picker.png, implant-stage.png, sleeve-stage.png, reduction-bars.png, transplant-model.png | done |
| 62–65 | Guide design incl. combination/stacked guides, window caution | §6.6 | guide-stage.png, producer-export.png, stacked-guide.png | done |
| 66 | Print protocols | §6.7 | report-page.png, print-all.png | done |
| 67–70 | coPeriodontiX | 07-optional.md §7.1 (built: PerioChart) | perio-chart.png | done |
| 71 | DWOS Synergy | §7.2 (collaboration equivalent) | contacts.png, inbox.png | done |
| 72 | Measurement functions | §7.3 | measure-rail.png, measure-examples.png | done |
| 73–75 | Safety checks | 08-safety.md | safety-aligned-views.png, safety-statusbar.png, distance-popover.png | done |
| 76 | Maintenance | 09-maintenance.md | — | done |
| 77 | Distributors/service | 10-service.md | — | done |
| 78–81 | Ambient conditions, HW/SW requirements | 11-technical-data.md §11.1–11.2 | — (tables) | done |
| 82 | Label | §11.3 | about-dialog.png | done |
| 83 | CBCT/CT scan guidance | §11.4 | — | done |
| 84–85 | Licensing matrix | §11.5 (tier matrix) | — (table) | done |
| 86–88 | Symbols | 12-symbols.md | ui symbol crops (see reconciliation) | done |
| — (stage 2: 17 training videos) | Video completeness pass — every feature demonstrated in the 17 official training videos audited and documented (see docs/video-coverage/VIDEO_COVERAGE.md): import abort + AI offer (§3.3), EASY guided markers / nerve review (§4.2), crosshair colors (§5.2), in-view PCS rotation + occlusal plane (§6.1), guided markers (§6.2), nerve waypoints/stepping/spin (§6.3), scan auto-/copy-alignment + AI assistant workflow (§6.4), tooth-driven placement + sleeve grouping (§6.5), guide parity bundle + reduction simulation (§6.6), Mesh Editor (new §6.8), Virtual Planning Export (new §6.9), AI chip symbol (§12) | §3.3–§6.9, §12 | pcs-rotate-preview.png, occlusal-plane.png, pano-guided-markers.png, nerve-point-review.png, ai-review-objects.png, ai-review-pano.png, mesh-editor.png, vpe-format.png, vpe-scanbodies.png | done |
| — (stage 3: 42 YouTube tutorials, batches 1–5) | Third pass against the 42 public tutorial videos (see docs/video-coverage/VIDEO_COVERAGE_YT.md): pinnable toolbar quick actions + sidebar collapse F9 (§5.1), Settings → Views display preferences, tooth numbers on implants, Shift+wheel zoom (§5.2), free 3D model import, per-model Look/Properties/Adjust position incl. Size ±5 %, Create merged model, measurement rename (§5.3), Copy-plan element selection (§5.4), nerve rename + ✕ Delete point (§6.3), import-time mesh-optimize offer + Fine-align Size section (§6.4), implant position lock / display color / fine-positioning panel / virtual-tooth wax-up models (§6.5), elongated (stadium) inspection windows (§6.6), Mesh Editor additions — Partial repair, Combine Subtract + show-object preview, Select-area smoothing, drag-to-paint, Ctrl+wheel radius, double-click pivot, view-type switch, margin-spline editing, Remesh max-edge/strength, Reduce guidance (§6.8) | §5.1–§5.4, §6.3–§6.6, §6.8 | yt-settings-views.png, yt-implant-toolbar.png | in progress (pass ongoing; batches 1–5 documented) |

Reconciliation: a full page-by-page audit (every content figure of all 88 pages) was run on
2026-06-11; the seven topic gaps and four figure gaps it found are closed (see GAPS.md
"Closed after coverage audit"). Remaining differences are platform adaptations documented in
GAPS.md (installer/dongle/regulatory-label material, live CAD session) or cosmetic. A second
(stage-2) pass against the 17 official training videos was completed the same day — 17/17
videos closed, reference docs/video-coverage/VIDEO_COVERAGE.md; residual low-severity
interaction/catalog differences are tabled in GAPS.md. A third (stage-3) pass against the
42 public YouTube tutorials is ongoing (reference docs/video-coverage/VIDEO_COVERAGE_YT.md);
the features of its first five build batches are documented above — AI tooth renumbering
and AI tooth extraction were still in build at the time of writing and are not yet covered.
