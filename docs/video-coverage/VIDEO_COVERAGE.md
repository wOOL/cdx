# Video-coverage map (stage 2 — complete)

Second completeness pass: the web clone audited against the 17 official coDiagnostiX
training videos in `cod_guide/video/` (SRT subtitles + scene keyframes as reference).
Method: one analyzer per video enumerated every demonstrated feature from subtitles +
keyframes and checked it against code and manual; every non-present claim was then
adversarially re-verified; confirmed gaps were implemented in batches 1–13
(commits `be1d0c4..71699d0`). Residual differences are in [GAPS-VIDEO.md](GAPS-VIDEO.md).

Legend: **closed** = every demonstrated feature present (incl. deliberate web
adaptations) · *(n feats)* = features enumerated for that video.

| # | Video | Status | Built this pass |
|---|-------|--------|-----------------|
| 1 | EASY how-to-start-a-new-case *(18)* | closed | mid-import abort |
| 2 | EASY how-to-segment-the-dicom *(14)* | closed | in-view PCS drag-rotate w/ live preview |
| 3 | EASY define-the-panoramic-curve *(18)* | closed | guided five-marker mode; tooth-driven implant placement |
| 4 | EASY detect-the-nerve-canal *(19)* | closed | detect-confirm; waypoint routing; prev/next stepping |
| 5 | EASY design-a-drill-guide *(27)* | closed¹ | label presets/impressed; FDI support picker; cut profile |
| 6 | EXPERT how-to-start-a-new-case *(19)* | closed | — (already complete) |
| 7 | EXPERT how-to-segment-the-dicom *(12)* | closed¹ | named segments w/ presets |
| 8 | EXPERT use-the-coordinate-system *(14)* | closed¹ | occlusal plane (draggable) + depth-aware implant defaults; per-plane crosshair colors; fixed swapped pitch/roll labels |
| 9 | EXPERT detect-the-nerve-canal *(20)* | closed¹ | axial placement; cross-view drag; section spin; spacing labels; auto-center |
| 10 | EXPERT place-implant *(29)* | closed | IFU caution; platform/article detail line |
| 11 | EXPERT place-the-sleeve *(22)* | closed¹ | Recommended vs Open sleeve grouping |
| 12 | EXPERT design-a-drill-guide *(29)* | closed¹ | insertion from 3D view; 3D-click supports; free-hand contact areas; reduction simulation |
| 13 | EXPERT mesh-editor *(37)* | closed¹ | dedicated Mesh Editor window (parts/holes/bridge/remesh/reduce/invert/wax/erase/margin cut/combine, undo-redo, save-as-copy) |
| 14 | Dual-Scan workflow 9.10 *(35)* | closed¹ | Add object merge; intaglio foundation UI; copy alignment |
| 15 | Export on Abutment Level *(25)* | closed | Virtual Planning Export (4-step wizard, scanbodies, analogs, export frame) |
| 16 | Review/Import from AI Assistant (NAM) *(23)* | closed | NAM review wizard (5-step rail: objects+FDI chart, PCS, pano, nerves, scan alignment); AI status chip |
| 17 | Provide DICOM+impression to the AI *(22)* | closed¹ | post-import AI offer (CBCT note); AI auto-alignment; import-time alignment chooser |

¹ with low-severity residuals listed in GAPS-VIDEO.md (interaction-style or
catalog-content differences, each with a working equivalent).

Our-app evidence screenshots in `img/`: `vpe-step1/3.png` (VPE wizard),
`ai-wizard-step1/3.png` (NAM review), `mesh-editor.png`, `b1-align-rotate.png`
(PCS drag preview), `b1-pano-guided.png` (guided markers), `b4-occlusal.png`
(occlusal plane), `easy-pano.png`, `easy-nerve.png`.

Verification: every feature build type-checked (`bun run check` 0 errors), unit
suites scripts/test-vpe.ts (38), test-aireview.ts (56), test-guide3.ts (24),
test-meshedit2.ts (48), test-auto-align.ts all pass; key dialogs verified live
via Playwright screenshots against the dev server.
