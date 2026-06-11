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

Reconciliation: a full page-by-page audit (every content figure of all 88 pages) was run on
2026-06-11; the seven topic gaps and four figure gaps it found are closed (see GAPS.md
"Closed after coverage audit"). Remaining differences are platform adaptations documented in
GAPS.md (installer/dongle/regulatory-label material, live CAD session) or cosmetic.
