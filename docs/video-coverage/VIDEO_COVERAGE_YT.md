# Video-coverage map (stage 3 — YouTube tutorials)

Third completeness pass: the web clone audited against the 42 coDiagnostiX YouTube
tutorial videos in `cod_guide/yt-video/` (whisper SRT subtitles + scene keyframes
as reference). Method as in stage 2: one analyzer per video enumerated every
demonstrated feature from subtitles + keyframes and checked it against code and
manual; every non-present claim was adversarially re-verified; confirmed gaps were
implemented in batches. Stage-2 residuals (GAPS-VIDEO.md) were not re-flagged.

Legend: **closed** = every demonstrated feature present (incl. deliberate web
adaptations) · *(n feats)* = features enumerated · ¹ = with low-severity residuals
listed in GAPS-VIDEO.md (stage-3 section).

## EN playlist (webinars, demos, teasers)

| # | Video | Status | Built this pass |
|---|-------|--------|-----------------|
| 1 | Basic Training 1 *(61)* | closed¹ | nerve delete-point; toolbar quick actions |
| 2 | Basic Training 2 *(94)* | closed¹ | measurement rename; annotation/measure colors + label size; implant color picker; tooth-number tags; implant-axis length; line thickness; per-implant lock; plan-copy element selection; nerve rename; fine positioning; free 3D model import; sidebar collapse (F9) |
| 3 | Mesh Editor — Opportunities and new tools *(42)* | closed¹ | Combine Subtract mode; Mesh-Editor delta batch (ctrl-wheel radius, pivot, drag-paint, view types, margin spline edit, partial fill, remesh params, area smooth, combine preview, reduce guidance) |
| 4 | Predictable surgical guide design (webinar) *(35)* | closed¹ | import-time mesh-optimize offer |
| 5 | Planning workflow — 7 steps *(26)* | closed | (insertion undercut coloring pending verdict) |
| 6 | coDiagnostiX EASY *(43)* | closed¹ | (vendor integrations → GAPS) |
| 7 | coDiagnostiX EASY — A Simplified Implant Planning Solution *(42)* | closed | — (already complete) |
| 8 | Enjoy fast and easy drill guide design (Dental Wings) *(29)* | closed¹ | elongated inspection windows (stadium length+angle) |
| 9 | Transformations in Dentistry *(14)* | closed | — (marketing; already complete) |
| 10 | Teaser — clinicians *(9)* | closed | — (marketing) |
| 11 | Teaser — labs *(13)* | closed | — (marketing) |

## AI Assistant playlist

| # | Video | Status | Built this pass |
|---|-------|--------|-----------------|
| 12 | Discover the AI Assistant *(21)* | closed¹ | wizard parity batch (subset presets, counts, manual-align jump, reset view) |
| 13 | How to provide data to the AI Assistant *(22)* | closed¹ | |
| 14 | How to Review Import Data from the AI Assistant *(22)* | closed¹ | (wizard refinement batch queued) |
| 15 | How to merge and use results from the AI Assistant *(22)* | closed¹ | Create merged model dialog (+ arch quick-picks) |
| 16 | How to change AI tooth numbering *(17)* | closed¹ | AI renumbering (builder in flight) |
| 17 | How to perform AI tooth extraction *(15)* | closed¹ | AI tooth extraction (cut/cut+close/alveolus + add-tooth) |
| 18 | Time saving with the AI Assistant *(–)* | closed | — (marketing) |

## How-to EXPERT mode

| # | Video | Status | Built this pass |
|---|-------|--------|-----------------|
| 19 | Start a new case *(14)* | closed¹ | (scan-date field → pending verdict) |
| 20 | Segment DICOM data (Expert) *(18)* | closed¹ | upper HU bound in editor; zoom readout; 3D volume-render toggle |
| 21 | Use the coordinate system *(11)* | closed | — (already complete) |
| 22 | Detect the nerve canal (Expert) *(19)* | closed¹ | |
| 23 | Place an implant *(19)* | closed¹ | |
| 24 | Place a sleeve *(20)* | closed¹ | (catalog rows → GAPS) |
| 25 | Design a drill guide *(40)* | closed | label presets: Date of birth, Tooth positions |
| 26 | Export on abutment level *(24)* | closed¹ | (branded abutment catalogs → GAPS; scanbody thumbnails) |

## How-to EASY mode

| # | Video | Status | Built this pass |
|---|-------|--------|-----------------|
| 27 | Segment DICOM data (Easy) *(14)* | closed | — (already complete) |
| 28 | Define the panoramic curve (Easy) *(14)* | closed¹ | (3D inset thumbnail → GAPS) |
| 29 | Detect the nerve canal (Easy) *(18)* | closed | detect with-or-without intermediate waypoints choice |

## Tips & Tricks

| # | Video | Status | Built this pass |
|---|-------|--------|-----------------|
| 30 | 3D Mouse *(8)* | closed¹ | (3Dconnexion HID + fly-through → GAPS hardware row) |
| 31 | Adjusting the toolbar *(10)* | closed¹ | stage-bar step hiding; extended quick-action catalog; full reset |
| 32 | caseXchange registration code *(12)* | closed¹ | (vendor cloud onboarding → GAPS; pairing codes are the equivalent) |
| 33 | Changing the implant color *(18)* | verifying | per-implant picker + default color setting; x-ray implants; dbl-click 3D pivot; settings link |
| 34 | Deleting Patient Data *(12)* | closed¹ | (two-pane delete dialog → GAPS; inline deletes are the equivalent) |
| 35 | Distance Measurements *(17)* | verifying | 3D measurements in cross view; armed-tool cursor |
| 36 | Exporting a Plan *(10)* | verifying | (OS file association → GAPS; plan export/import present) |
| 37 | Hotkeys *(8)* | verifying | ⌨ hotkeys button (mouse path to the list) |
| 38 | Inserting Logo in Printouts *(13)* | verifying | logo accepts PNG/JPEG/BMP/WebP |
| 39 | Locking implant positions *(7)* | verifying | per-implant lock + bulk Lock implants + tree padlocks |
| 40 | Moving implants *(11)* | verifying | 0.1° fine-rotation step; (right-drag gestures → GAPS, handle drags equivalent) |
| 41 | Surgical Guide Visualization *(14)* | verifying | metallic/wireframe/x-ray looks; properties readout (tris/points/area/volume) |
| 42 | Transparent Segmentation *(14)* | closed¹ | (model opacity/color = the transparency; setup-dialog style → GAPS) |

## Verification

(filled at the end of the pass)
