# coDiagnostiX Web Clone — Functional Specification

Target stack: **SvelteKit + Bun + SQLite (server) + Three.js (client rendering)**.
Source of truth: research notes in `docs/research/` (derived from the official coDiagnostiX 10 IFU v14.9, the v10 User Help, release notes 9.x–10.10, and supporting documents). All parameter defaults, units, dialog contents and warning texts below come from those notes; web-specific adaptations are marked **[WEB]**.

Document conventions:
- "Dataset" = one imported CBCT/CT volume + all derived objects + 1..n plans (one patient case).
- "Plan" = a treatment plan inside a dataset; one plan covers exactly one jaw (maxilla or mandible).
- All linear values are millimeters (mm), angles degrees (°), densities Hounsfield Units (HU, CT only), volumes milliliters (ml), areas cm².
- FDI tooth notation is the default; Universal numbering is a user setting.

---

## 0. Product Overview & Web Architecture

### 0.1 Purpose
A web application for virtual dental surgery planning: import CBCT/CT DICOM data and surface scans, compute planning views (axial / cross-sectional / tangential / panoramic "virtual OPG" / 3D), trace nerve canals, place implants and other surgical instruments (fixation pins, endodontic drills) with sleeves, design surgical guides (drill / cutting / evaluation), and export guide geometry as STL for 3D printing, plus printable protocols (PDF).

### 0.2 Planning principles (drive feature scope)
1. Plan a surgical path along a **trajectory** → drill guide (implants, endodontic drills, fixation pins).
2. Plan a surgical path along a **profile** → cutting guide (bone reduction, apicoectomy, sinus lift, gingivectomy).
3. Plan a **form** to evaluate a surgical step → evaluation guide (bone augmentation, tooth auto-transplantation).

### 0.3 Desktop → Web adaptations [WEB]
| Desktop concept | Web equivalent |
|---|---|
| USB dongle / Straumann AXS licensing | **User accounts** (email + password, optional MFA); per-account subscription tier records feature flags (`basic / individual / professional / enterprise`) and a guide-export credit counter. Tier gating is data-driven, never hard-coded. |
| Local file database (`PatientDatabase.cdxDatabase` + `Patients/` folder) | **Server-side SQLite** DB: tables for users, teams, patients, datasets, plans, objects (JSON payload per object), files (volume blobs, mesh blobs), audit log. Binary volume/mesh data stored on server disk, referenced by content hash. |
| Network Database SQL module, multi-seat | Built-in: every account is server-backed; **teams/organizations** with role-based permissions (read / modify / delete; admin "Super Group" equivalent = team owner role). |
| DICOM import from CD/DVD | Browser **file/folder upload** (multi-file `.dcm`, ZIP of a DICOM folder, or single multi-frame file); server-side parsing pipeline with progress reporting. |
| caseXchange platform | In-app **case sharing** between accounts (transfer activities with states, comments, share IDs) + read-only share links (replaces the iPad presentation app). |
| Online Updater / Master DB updates | Implant/sleeve **catalog is server data**, versioned; admin UI to import catalog updates; no client update mechanism needed. |
| TeamViewer remote support | Support page with documentation links and contact; no remote control. |
| Windows printer / calibrated printing | Server-side **PDF generation** for all protocols (gonyX analog workflow is out of scope — legacy). |
| OpenGL 3.3 requirement | WebGL2 via Three.js; feature-detect and show an unsupported-browser page. |

### 0.4 Safety/warning philosophy (must replicate)
- All distance/collision checks are **advisory only** — they warn but never block placement.
- Datasets creatable despite warnings show a persistent caution; the user is "solely responsible for the correctness, accuracy and completeness of all data entered".
- Mandatory caution strings (verbatim, render where noted in each module): nerve-verification, matching-congruency, inspection-window stability, "never drill directly through the guide", "printouts … not intended for diagnostic purposes".
- Only **finalized** plans may be exported for production.

### 0.5 Module map & data flow
```
Auth/Accounts → Patient DB → DICOM Import → Dataset
Dataset → Plan(s) → {PCS alignment, Panoramic curve, Segmentations, Model scans,
                     Nerve canals, Measurements, Implants(+abutments), Sleeves,
                     Cut profiles, Augmentations, Surgical guides}
Plan → Reports (PDF) | Guide STL export | VPE STL export | Case sharing
```

---

## 1. Patient & Case Management

### 1.1 Purpose
Store and manage patients, datasets (cases) and plans; the application entry point ("start screen").

### 1.2 Start screen (application shell) [WEB: post-login landing page]
Elements:
1. **Create New dataset** — opens the DICOM import flow (§2).
2. **Open dataset** — opens the Patient Database list.
3. **Case sharing** ("caseXchange") — opens the collaboration inbox (§12).
4. **Management** — admin functions: backup/archive export, language, team/permissions, catalog admin (§13).
5. **Support and help** — help center, documentation.
6. **Work Mode selector** — EXPERT / EASY toggle; selected mode is highlighted and applied when a dataset is opened/created (§10).
7. **Recently opened datasets list** — sortable/searchable; per-dataset columns: patient name, DOB, patient ID, modified date, plan count, AI/processing status icon, share status.
8. **Status bar** — account/plan-tier and app version.
9. First-run **onboarding tour** explaining the start screen and EXPERT vs EASY.

### 1.3 Patient Database
- List of patients with their datasets. One dataset = one imported volume; maxilla and mandible are planned as **two separate plans** (jaw chosen per plan).
- Operations: open dataset (in selected work mode), rename/edit patient metadata, **delete dataset** (confirmation dialog), **anonymize** (toggleable pseudonymization of name/DOB/ID; reversible via the same command — `Patient > Anonymize` equivalent), export dataset archive, search/sort/filter.
- Patient record fields: last name, first name, date of birth, patient ID, comment (initially populated from DICOM tags; editable via "Verify Patient Data" dialog).
- **Viewer mode**: expired/insufficient subscription opens datasets read-only.
- Dataset locking: a dataset sent for production/sharing can be locked; lock state visible; "Remove archive lock" admin action. [WEB: lock is a DB flag with audit entry.]

### 1.4 Plans
- Every dataset has ≥1 plan; the **Edit Plan dialog** opens automatically on first open. Fields:
  - **Jaw**: maxilla | mandible (changing later deletes positioned reference pins; recommend separate plans per jaw).
  - **Name** (unique per dataset; duplicate names highlighted with warning).
  - **Comments** (free text; printable on Material List).
  - **Protect this plan against changes** (checkbox, reversible write-protection).
  - **Mark this plan as final** (checkbox, **irreversible**; to modify, copy the plan).
  - **Implant update mode**: `Check for updates if new implants are available` (default) | `Never check plan for updated implants` | `Check for updates each time the plan is opened`.
- **Plan panel** (top of left sidebar in EXPERT): combo box listing all plans; status icons: "Plan sent and locked for editing", "Copy of a transferred plan (enabled for editing)".
- **Plan menu**: New (Ctrl+Shift+N), Create Copy (dialog lets user pick which elements to copy; copy auto-loads), Properties, Finalize, Management, Send, Print ▸, Check Lock State for Production.
- **Plan Management dialog**: lists plans with name, status, last editor, modification date; actions: open, Properties (edit without opening), **Delete** (only here, to prevent accidents), **Compare** (select 2 plans → diff of all differences, incl. implant move distances). Transferred plans show as write-protected sub-entries under their editable copies ("+" head entry).
- **Outdated objects handling**: per the plan's implant-update mode, when an implant/abutment in the plan is marked outdated in the catalog, prompt: keep outdated vs use newer version; after replacing, prompt user to recheck the plan.
- **Finalization rule**: exports (guide STL, VPE) and production sends require a finalized, unlocked plan; UI must surface this.

### 1.5 Object model (per plan)
Object tree categories: Groups, Tooth positions, Implants, Abutments, Sleeves, Teeth (virtual), Digital surgical guides, Model scans & 3D models, Augmentations, Cut profiles, Nerve canals, View definition (Panoramic curve, Patient coordinate system), Measurements (distance, continuous distance, angle, auxiliary line), Segmentations, Annotations.
- Common object operations: rename (F2), delete (DEL), visibility checkbox (object/group/category), comment (speech-balloon indicator), context action menu, warning icons on conflicts (click for details).
- **Positioning mode** (Ctrl+E): global toggle; objects cannot be moved/rotated unless active. Left-drag = move, right-drag = rotate (where applicable). Auto-activated after adding implants/nerve canals/measurements.
- **Groups**: New Group dialog (name + tree background color; two-list picker with Ctrl+→ / Ctrl+Alt+→ / Ctrl+← / Ctrl+Alt+← hotkeys). Group modes: `No action` | `Jointly move and turn implants only` | `Jointly move and turn all objects`. Groups support batch edit of visibility, abutments, sleeves.
- Undo/Redo (Ctrl+Z / Ctrl+Shift+Z) for position changes and object edits; toolbar "Undo last position change".

### 1.6 Persistence & autosave [WEB]
- Plan state autosaves (debounced) and on navigation (EASY home button = save + exit).
- Server keeps modification history (last editor + timestamp per plan); full version history is P4.

---

## 2. Data Import

### 2.1 DICOM import (creates a dataset)
**Flow**: Create New dataset → upload DICOM files/folder/ZIP → server validates & parses → patient data verification → jaw selection (maxilla/mandible for first plan) → optional AI-assist offer (declinable) → open in selected work mode.

**Two modes**:
- **Quick transfer** (default): auto-detect valid series, show patient info for verification, auto-create dataset with sensible defaults.
- **Advanced transfer**: manual control — series/slice selection ("Automatically select valid images", "Clear image selection"), slice preview with scrollbar (F5 reload), warnings detail panel. Checkbox **"Always start DICOM import in advanced mode"**.

**Validation & constraints**:
- Accept DICOM 3.0, axial slices, single-frame and multi-frame files; reject JPEG 2000 transfer syntax with the message that it is unsupported.
- Slice-consistency checks within a series: patient name, patient ID, study, orientation, pixel spacing, resolution, modality, gantry angle.
- **Gantry tilt ≠ 0°** is corrected by resampling to an orthogonal volume (with note about interpolation).
- Missing slices: option **"Fill missing slices black"** (else interpolate).
- Recommended input surfaced as warnings (not blockers): resolution ≥ 512×512, slice width ≤ 1 mm.
- Warnings never block creation, but the dataset is flagged "created despite warnings" with the standard caution.

**Import options**:
- **Slice distance / resolution**: `Standard` (all slices) | `Optimized (1:n)` (every nth) | manual: smallest / most frequent / other distance (interpolated). Note shown: decreasing slice distance leads to unnecessarily large datasets.
- **Region restriction**: drag a red rectangle in the slice preview to crop the dataset volume.
- **Grayscale at import**: histogram of full range with lower/upper sliders; preset combo (default **"Read from DICOM data (automatically)"**); preset CRUD (save new / overwrite / delete); **Set global grayscale factor** (user-defined global histogram width, persisted for subsequent imports until reset to "Read from DICOM data"). Full grayscale range is always stored with the dataset so window/level can be changed any time later.
- **Verify Patient Data** dialog after creation: name, first name, DOB, patient ID, comment; warning not to carelessly overwrite DICOM-provided values. Optional **alias name** for permanent anonymization at import.
- Embedded non-volume images in the DICOM (OPGs, X-rays) can be pushed to the patient's **Image Management** ("Add selected images to Image Management" with per-image metadata: information, scan date, comment).

### 2.2 Model scan import (surface scans) — wizard
Shared wizard used by EXPERT toolbar "Add model scan", EASY model-scan sub-step, and object-tree Add menu.

**Step 1 — Source**:
- **Load model scan** — upload **STL** or **PLY** (PLY supports vertex-color intraoral scans). (OBJ unsupported, matching the original.)
- **Import segmentation** — import a segmentation from another dataset of the same patient (dual-scan method, §2.3); choose level of detail; result appears as a 3D object.
- **Import from device or service** — [WEB] stub integration point (order inbox); out-of-scope for parity with DWOS Connect/3Shape, P4.

**Step 2 — Alignment method**:
- **Align to other object** (standard; runs all steps below).
- **Copy alignment** — reuse the registration of a previously aligned scan exported in the same coordinate system (wax-up workflow); skips matching steps.
- **Do not align** — postpone; the scan appears in the object tree with an **exclamation mark**; double-click later to align.
- **Align using AI** — automated surface matching when AI preprocessing exists (P4; behind feature flag).
- "Visualization and properties" button: set scan color (auto-assigned from an editable default palette).

**Step 3 — Registration object**: a segmentation of the volume or a previously imported model scan; must cover analogous anatomical regions. **Edit segmentations** shortcut to clean noise/artifacts.

**Step 4 — Corresponding regions**: click matching spots alternately on scan and registration object (rendered side-by-side 3D views). Rules shown inline: minimum **3 pairs**; anatomically significant spots; teeth if available, temporary implants if edentulous; as far apart as possible; not collinear. Pairs are regions, not exact points (coarse alignment).

**Step 5 — Automatic registration**: Next runs coarse alignment from region pairs, then ICP-style surface best-fit refinement. On failure: fall back to regions-only alignment + guidance (reposition pairs, add pairs, or align manually).

**Step 6 — Verify / manual alignment**: show merged contours in all 4 views (axial / panoramic / cross-sectional / 3D); manual drag (left = move, right = rotate; "mouse not recommended" note) and **Fine Alignment** dialog (numeric step width for translation mm and rotation °, patient-oriented vs object-oriented frame). **Finish** applies the import.
- Caution (verbatim, both modes): "Thoroughly check the congruency of the contours of the merged 3D objects in all views… Matching accuracy directly influences the accuracy of the designed surgical guide."

**Post-import scan tools** (context menu of model scan / 3D model):
- **Visualization…** (color palette picker, Edit palettes), **Replace Mesh** (swap geometry, keep alignment), **Convert to 3D model** (for segmentations/guides), **Fine Alignment…**, virtual tooth extraction (§5.6), mesh-repair tools (repair / detect / cut, P3), Export.
- **3D Model import** (no matching): Object > Add > 3D Model / Protected 3D model; manual placement via positioning mode.
- Multiple scans per plan supported (situ scan + separate wax-up scan; wax-up must be a separate file — "model scan must not include any wax-up or prosthetic setup").

### 2.3 Dual-scan method (edentulous)
- Import patient-with-denture scan as dataset 1; denture-only scan as dataset 2 (separate dataset of same patient).
- In dataset 1: model scan import → **Import segmentation** → pick dataset 2 segmentation (radiopaque-marker based) → match via region pairs on the markers.
- The imported denture is a 3D object usable as guide-design basis; guide wizard exposes **"Use bottom side of dual scan"** (intaglio surface → mucosa-supported guide).

### 2.4 Prosthetic design import (P4)
- Import an order package (model scan + prosthetic design + implant proposals + optional antagonist): wizard = model-scan matching + **Select implant models** step (proposed tooth numbers red in dental chart; pick one implant model placed at all positions; gray = position already planned, pale red = planned and requested; overwrite prompt on Finish). Imported objects are linked as one order; moving the scan moves linked restoration/antagonist but not implants.

---

## 3. Viewing & Navigation

### 3.1 Purpose
Render the volume and all plan objects in five synchronized, color-coded views; provide navigation, window/level, visibility, and capture tools.

### 3.2 EXPERT planning screen layout
- Regions: **Toolbar** (top), **Views grid** (center), **Object tree + Plan panel + Tooth Position panel + Density statistics** (left sidebar), **Status bar** (bottom).
- Default view arrangement: top-left = **Cross-sectional group** (three parallel slices, group title "Cross sectionals (+/- 1.0 mm)") with **Tangential view** below; top-right = **Axial**; bottom-left = **3D**; bottom-right = **Panoramic**.
- View **color coding** (reference line/plane color in other views): Axial = **cyan**, Cross-sectional = **red**, Panoramic = **green**, Tangential = **blue**.
- Every view title bar: color label, caption, and buttons: **Snapshot** (save high-res image to Image Management or download; size selection), **Reset** (zoom + best fit), **Maximize/Restore** (also double-click title bar; F11 fullscreen/hide sidebar).
- Scrollbars: double-click slider = jump to default position.

### 3.3 View behaviors
- **Axial**: axial slice; patient left/right reversed, anterior at top; right scrollbar / mouse wheel scrolls the stack; title-bar **mirror horizontally** button.
- **Cross-sectional** (×3): cuts perpendicular to the panoramic curve, vestibular→oral; in-view labels "VESTIBULAR" / "ORAL"; mm scale bar; left/right pane offset configurable (default **±1.00 mm**); **link button** "jointly move and zoom" (default ON); auto-recenters when another implant is selected; bottom scrollbar of the panoramic view moves the position along the curve.
- **Tangential**: cut along the curve at the middle cross-section position; vertical scrollbar rotates **±90°** around the cut line; when views are aligned to an implant it rotates **360° around the implant axis**; display-mode chooser: `Cross-Sectional Views and Tangential View` | `3D View and Tangential View`.
- **Panoramic (virtual OPG)**: curved slab along the panoramic curve; right scrollbar shifts a **temporary parallel curve** orally/vestibularly (original curve untouched; title-bar **Reset panorama offset**); bottom scrollbar moves the cross-section position along the curve; **X-ray mode toggle** (ray-sum projection of the slab vs single curved slice).
- **3D**: surface rendering of segmentations (§5); scrollbars orbit; **default-perspective dropdown** (Left, Right, Anterior, Posterior, Superior, Inferior); stereo 3D toggle (red/cyan anaglyph; P4).
- Display-mode chooser per pane group switches pane configurations (`Cross-Sectional + Tangential`, `Cross-Sectional + Panoramic`, `Cross-Sectional only`, …); optional toolbar button cycles configurations.

### 3.4 Navigation tools (toolbar toggles + View menu)
- **Move and Turn** (Ctrl+M): left-drag pans any view; right-drag rotates the 3D view only.
- **Localizer** (Ctrl+L): click centers all views on the clicked 3D point (MPR crosshair); double-click with Localizer = add implant at that point.
- **Zoom** tool: left-click = step zoom in, right-click = step zoom out, hold + drag = dynamic; **Shift + wheel** = zoom anywhere; zoom "enhances measurement accuracy".
- **Reset all views** (fit content); per-view Reset.
- **Reference lines 2D** toggle; **Reference planes 3D** toggle.
- **Align views to implant**: aligns cross-sectional, tangential and axial views to the selected implant/instrument axis (≥1 planned); click again reverts; optional per-view rotation on alignment (settings, default OFF).
- **Millimeter scales** toggle (default ON). **Orientation indicators** toggle: orientation strings in 2D views + 3D orientation model (L/R/A/P/H/F cube; model selectable in settings — Face/Cube/Reindeer; Ctrl+1..6 to switch).
- **Vertical 3D cut** / **Horizontal 3D cut**: clip the 3D rendering at the current cross-sectional position / axial plane.
- Mouse wheel scrolls slices; thumb-wheel (horizontal wheel) rotates 3D/panoramic/tangential (P4); 3D-mouse support not required [WEB].

### 3.5 Grayscale (window/level)
- **Adjust Grayscale dialog** (View menu): left = live axial preview with slice scrollbar; right = histogram with global range labels (e.g. "−3508 HU … 3908 HU") + black→white gradient bar with two handles; numeric spinners **Left / Width / Level / Right** (HU for CT); preset combo (e.g. "Implant Planning (CT)", "User-defined") + save/overwrite/delete preset buttons; OK/Cancel.
- Semantics: below Left → black; above Right → white. HU labels only when modality = CT (CBCT shows unitless values + informational note about HU validity).
- Interactive **Grayscale drag tool** (segmentation module): up = lighter (decrease level), down = darker (increase level), left = more contrast (decrease width), right = less contrast (increase width); live parameter readout.

### 3.6 Object visibility
- View > Objects submenu: Show/Hide per type — Implants, Implant Axes, Crestal Levels, Implant 3D Models, Abutments, Sleeves, Teeth; plus Angle Between Implants… shortcut.
- Per-object/group/category visibility checkboxes in the object tree.
- AI models visibility: 2D+3D vs 3D-only (P4, behind AI flag).

### 3.7 3D Setup dialog
Sections: **Segmentations** (per-slot visibility, name, color, transparency); **Absolute rotation** (Alpha −180…180, 0 = front; Beta −90…90; Gamma −180…180); **Relative rotation** (step angle, default 5°, six arrows); **Move** (px increment, default 5); **Zoom** (% factor, default 12; reset; 1:1 buttons); **Default perspectives** (6 buttons); **Contrast/Brightness** sliders (3D only); **Segmentation thresholds** (gradient + 2 numeric fields + preset) for the Default segmentation.

### 3.8 Status bar
- Patient name, DOB, plan count, transfer status ("Sent" label).
- **Implant verification chips** (live, for the selected implant): `Average density: NNN HU`, `Distance to other implants`, `Distance to nerve canal`, `Distance to other sleeves` — green when OK, red on violation; clicking a distance chip opens a popup listing every other object with its live distance (1 decimal, mm).

### 3.9 Hotkeys (global)
F1 help; Ctrl+F1 hotkey list; Ctrl+O open dataset; wheel scroll, Shift+wheel zoom; Ctrl+Z / Ctrl+Shift+Z undo/redo; Ctrl+Shift+N new plan; Ctrl+P edit panoramic curve; Ctrl+A add object; F2 rename; DEL delete; Ctrl+E positioning mode; Ctrl+L localizer; Ctrl+M move&turn; F8 screenshot; F11 fullscreen; Ctrl+1..6 orientation model; EASY: Ctrl+'+'/'−'/0 zoom in/out/reset.

### 3.10 Image Management & Image Viewer
- **Image Management** (Extras): per-patient image library (screenshots, photos, OPGs); add from file (BMP/JPEG/TIFF/DICOM image) with metadata (information, scan date, comment); select all/invert/clear; delete; **export selected** (destination, filename = image info | consecutive numbering, format choice with JPEG quality note); show in **Image Viewer**.
- **Image Viewer**: layouts 1 / 2-vertical / 2-horizontal / 4 images; first/prev/next/last; image info (name, resolution, scan date); full screen (wheel/arrows browse, Esc/double-click exits); pan; 5 zoom levels.
- Screenshots (F8 / Extras > Create Screenshot) follow Screenshot settings (§13).
- Images travel with dataset export/import.

---

## 4. Alignment & Panoramic Curve

### 4.1 Patient Coordinate System (PCS)
- Purpose: compensate gantry tilt / patient positioning by aligning the occlusal plane; defines initial implant/tooth orientation. Align **before** placing implants.
- Object in tree under "View definition"; open via toolbar "Align patient coordinate system", Object menu, or object properties.
- **Align Patient Coordinate System dialog**: instruction "Make the green plane coincide with the occlusal plane and the red plane with the sagittal plane"; three 3D sub-views (Sagittal / Coronal / Axial), each with default-perspective button and orientation models.
- Plane colors: **green = occlusal**, **red = sagittal**, **blue = coronal**.
- Interaction: left-drag = move PCS, right-drag = rotate. Dialog tools: Reset to defaults; horizontal 3D cut toggle; "Setup 3D Views" (segmentation threshold adjustment). OK saves, Cancel discards.
- EASY variant: jaw selector (maxilla/mandible) at top; segmentation-threshold slider at bottom; "Edit source data…" reopens the grayscale window dialog.

### 4.2 Panoramic curve
- Purpose: defines the panoramic view, the cross-section travel path, initial implant positions, and abutment orientation ("rotated orthogonally to the panoramic curve"). Define before implants.
- Open: toolbar Panoramic Curve, Ctrl+P, double-click in tree, Object menu → **Edit Panoramic Curve dialog** (an axial view with right scrollbar to pick a layer "containing both bone and tooth information").
- Curve = **five basic points** (movable, not deletable) + user-added points (red; right-click > Delete Point). First/last points labeled with target tooth positions (FDI: mandible 48/38, maxilla 18/28; Universal: 32/17, 1/16); middle point = incisal point between front incisors.
- Editing: left-drag a point (cursor → hand); click on/along the curve outside existing points to add a point; **Shift+left-drag moves the whole curve**; right-click > "Reset this view" restores the initial curve shape (curve itself cannot be deleted).
- EASY variant adds a top-right pop-up showing the current axial position in 3D while scrolling.
- Auto-detection of PCS + curve via AI is P4 (feature-flag); a geometric auto-initialization (jaw-arch fit from the segmentation) is acceptable as the default proposal. [WEB]

---

## 5. Segmentation & 3D Models

### 5.1 Concept
Segmentation turns voxels into named, colored, individually controllable regions; the 3D view renders segmentations (surface rendering), not a raw transfer function. **Slot 1 is always the threshold segmentation, named "Default"**; up to **8 segmentations** simultaneously.

### 5.2 Threshold segmentation
- Live reconstruction of all voxels in a High/Low window (HU for CT); vertical color-ramp slider + two numeric spin boxes (e.g. High 2249 / Low 465).
- Technique notes shown: set grayscale window first; lower slider for dense objects (bone), upper slider for darker ones.
- Threshold re-editing is blocked once the slot was used as source for other segmentations until "Clear segmentation in whole dataset".
- EASY equivalent: single **"Segmentation threshold"** slider in the preparation step.

### 5.3 Segmentation mode (Scanview module)
- Entered via toolbar Segmentation button / Object > Segmentations; auto-saves on exit or slot change.
- Layout: large main view + 4 small reference views (axial, coronal, sagittal, 3D); drag & drop view types between panes; **Fast Paint** performance toggle (no interpolation 2D / low-res 3D); left parameter pane.
- Tool pane areas: **Target slot** (radio select; "exclude" toggle column), **Source** (constrains tools; "None" = free segmentation; "Source visible in 3D" checkbox), **Volume readout** (ml), **Tools**, **Threshold sliders**.
- Slots: visibility checkbox, editable name (Enter to commit; right-click name = predefined list: Mandible, Maxilla, "Mandible w. Teeth", …), color swatch (left-click cycles palette, right-click opens Color Palettes dialog), transparency.
- **Tools**: Flood Fill (LMB add / RMB delete; respects boundaries; Ctrl+F); Brush (3 sizes small/medium/large, Ctrl+P / Ctrl+S; in 3D affects pixels within & behind cursor); Segmentation boundary polyline/freehand in yellow (Ctrl+L; right-click finishes; Ctrl+Backspace deletes last point) + Clear boundary; **Automatic segmentation** slice-propagation (Ctrl+A; Page Up/Down advance; 2D only; warning to check slice-by-slice); All voxels in current slice (LMB select / RMB clear); Segment whole dataset (confirm); Clear whole segmentation (confirm); Import segmentation boundaries from surface objects; Undo/Redo (10 steps, toggleable in Extras > Segmentation Options together with "Automatically refresh small 3D view").
- Auxiliary in-module tools: Grayscale drag, Zoom, Move, Localizer, Measurement grid (mm), user-defined **oblique cut**, area measurement (trace outline → cm²), **3D cut** dialog (Square/Plane/Pyramid cuts; cut faces rendered as grayscale).

### 5.4 Convert to 3D model & exports
- Right-click segmentation (or guide) > **Convert to 3D model** → mesh object in tree (marching-cubes style extraction with level-of-detail preset).
- Level-of-detail presets: **Coarse / Standard (default) / Fine**; expert editing of preset parameters (algorithm, resolution, noise reduction, reduction, filter); preset CRUD.
- **Virtual Planning Export (VPE)** (Plan menu): export one segmentation or model scan at a time as **STL** (`Untouched` or `Insert implant analogs`; "Include implant positions" STL-only), coordinate system = patient CS or any object CS; single-file vs **multi-file export**. Other proprietary container formats are out of scope [WEB]; P4 stub.
- Per-dataset export fee/locking from the desktop product maps to **export credits** on the account [WEB].

### 5.5 Augmentation (sinus lift / bone graft evaluation)
- Object > Add > Augmentation… 3-step wizard:
  1. **Preparation**: pick the bone segmentation; orient to top view.
  2. **Edit outline**: left-click adds outline points on the bone (click+drag to move; right-click point = delete one/all; toggle "Set new points always at the end of outline"); **Next disabled until outline is closed**; outline must lie above bone.
  3. **Result**: generate body; **Filling Material slider** (fill height); color; **volume in ml**; Apply.
- Augmentation object: movable/rotatable in positioning mode (donor-site check; Redo resets); hidden in panoramic view. Note shown: approximate volume evaluation only, not a final graft shape.

### 5.6 Virtual tooth extraction
- **Manual** (P2): segment jaw bone excluding the tooth; in the guide designer use a bone-support region at that position (§9.5).
- **Automated mesh extraction** (P3/P4, requires tooth labeling): context menu of a surface scan → three modes: **Cut out**, **Cut out and close** (mimic healed site), **Cut out dental alveolus** (keep socket contour).

### 5.7 Mesh editor (P3)
Local smoothing, wax knife (add/remove material), local remeshing, partial hole filling, surface bridges between two meshes. Jaw hole filling (AI) is P4.

---

## 6. Nerve Canals & Measurements

### 6.1 Nerve canal objects
- First-class objects under tree category "Nerve canals": **Left nerve canal**, **Right nerve canal**, plus arbitrary renamable branch objects (e.g. "Incisive branch"; branches always traced manually).
- A canal = ordered polyline of points; each point has 3D position + **individual diameter**; rendered as an interpolated **pink/magenta tube** in 3D, a pink circle where crossing 2D slices, and a pink curve with ⊕ point markers in panoramic view; endpoints visually distinct.
- Definable for mandible and maxilla (manual recommended for maxilla).
- Adding: toolbar Nerve Canal workflow button (adds both sides + auto-activates positioning mode), Object > Add > Left/Right Nerve Canal, or tree Add menu.

### 6.2 Manual tracing
- Click in **any 2D view** to append points (point lands on current slice); drag to move (with **live density readout** under the cursor while dragging); verify in all views.
- Point context menu (positioning mode): Reset This View; Delete Point; Delete All Points; Bring Point to Current Slice; **Point Diameter…**; Clickzoom Enabled (default on); Interchange Point with Successor / Predecessor (anterior-loop ordering fix); Delete (whole canal); Positioning Mode; **Nerve Canal Detection**; Center Views to Point (default on); Show Point Numbers.
- **Point Diameter dialog** ("Change point diameter"): numeric text box + slider, checkbox **"Apply to all points"**, Accept/Cancel. Default diameter **2.0 mm** (per-point override).

### 6.3 Automatic detection
- Seed with two points: **entry at the mental foramen**, **exit at the mandibular foramen**; start via **Detect** button next to the canal in the object tree, context menu "Nerve Canal Detection", or EASY **Auto detect** footer button.
- Detection traces the radiolucent canal between seeds and replaces all intermediate points. Switching manual → automatic warns that intermediate points are removed.
- Cautions (always displayed with the feature): "Automatic nerve detection does not guarantee exact and accurate nerve canal display. Make sure to always verify the correct position of the nerve canal manually." / "If nerve definition is not clear due to poor image quality, the dataset must not be used." / "Always maintain an appropriate safety distance to the nerve canal."

### 6.4 Safety distance engine
| Check | Implant ↔ implant (incl. sleeves) | Implant ↔ nerve canal | Sleeve ↔ sleeve |
|---|---|---|---|
| Type | distance | distance | collision |
| User-adjustable | yes | yes | no |
| Default | **3 mm** | **2 mm** | **0 mm** |
| Range | 0–10 mm | 0–10 mm | n/a |
- Pure warning function; never blocks placement. Distances computed in 3D against the nerve tube surface / implant+sleeve geometry; recomputed live during drag.
- EXPERT display: status-bar chips + popups (§3.8) + warning icons in the object tree.
- EASY display: warnings force-enabled; yellow banner in the views ("The implant violates the safety distance to the nerve.") + affected implants marked in the implant selector.

### 6.5 Measurement objects
- Types (Object > Add / tree Add menu): **Distance** (2 points, mm, 1 decimal), **Continuous distance** (polyline; per-segment labels in view, total in tree), **Angle** (3 points, °), **Auxiliary line** (2 points, no value).
- Behavior: points are placed in one view and the measurement displays **only in that view**; value shown in view + object tree; points on the current slice; off-slice points render transparent; clicking a hidden point jumps to its slice; positioning-mode editing (red cross handles, selected object blue); **Shift+drag moves the whole measurement**; point context menu: Reset This View / Delete Point / Bring Point to Current Slice / Delete / Positioning Mode.
- Adding a measurement auto-enables positioning mode. Decimal places configurable (Settings > Common).
- **Annotations**: point-anchored multi-line text (dialog with OK/Cancel), displayed in **all views** + tree; rendered red.

### 6.6 Angulation dialogs
- **Angle Between Implants…** (right-click implant; needs ≥2 implants): table Name | Selection ☑ | Master ☑(single) | Angle (1 decimal); orientation radio **Align to master** | **Mean direction**; dialog may stay open — values update in **real time** during positioning.
- **Angle Between Abutments…** (needs ≥2 compatible abutments): same + **Acceptable deviation** column (insertion-path tolerance of the abutment system).

### 6.7 Density tools
- **Interactive density measurement** (View menu/toolbar): circular probe cursor in 2D views; LMB shows average density in circle (HU if CT); RMB cycles 3 probe sizes.
- **Density statistics panel** (sidebar): for current/last-selected implant; vertical + horizontal distribution diagrams along/around the implant; offset sliders to implant bottom/top (mm); checkbox **"Outline measure only"** (shell at implant surface) vs whole volume; footer "Bone density (Ø NNN HU)"; mean mirrored in the status-bar chip, updates live as the implant moves.

---

## 7. Implant Planning

### 7.1 Implant catalog ("Master Database") [WEB: server-side catalog]
- Versioned catalog of **implants, fixation pins, endodontic drills, abutments, scan bodies, sleeves** from many manufacturers; each item: manufacturer, model series, article number, geometry (Length, Diameter 1 = crestal, Diameter 2 = apical optional, Total length, Insertion depth), region availability, date added, **outdated flag**, preview mesh/profile.
- Planned items are **copied into the plan** (catalog updates never mutate existing plans).
- Admin import pipeline for catalog data (JSON/CSV + meshes); seed data: a generic manufacturer set + Straumann-like demo series. [WEB]

### 7.2 Choose Implant dialog
- Left: manufacturer/series tree with parent nodes **All / Filtered / Favorites**; star icon toggles favorites; note about country availability.
- Right: implants pane, **table view** (sortable columns: Article no., Length, Diameter 1, Diameter 2, Total length, Insertion depth, Date added; outdated = red line) ↔ **thumbnail view** (scale consistent within a series; badges: abutment available, sleeve system available, region-limited globe, technical-info cogwheel with hover text, favorite star, user-defined icon).
- **Quick search** (live filter on any attribute) + clear button.
- **Filter dialog**: manufacturer, length, diameter, favorites, outdated, user-defined (show/hide/only), region — AND-combined; custom manufacturer subsets; saveable advanced filters.
- **Abutments tab**: compatible abutments for the selected implant; selection applies to every implant added in this step.
- **Dental chart**: shows only the plan's jaw; click 1..n positions (multi-select inserts the same implant at each); already-assigned positions gray/unselectable (1 implant per position); **undefined position "XX"** supported (lateral fixation pins, decide-later). Notation per settings (FDI default | Universal).
- Buttons: **OK** (insert at chart positions; initial pose from panoramic curve + occlusal plane) and **Add at current position** (current cross-section position; only with exactly one selected position).

### 7.3 Adding & positioning implants
- Entry points: toolbar Add Implant (workflow step), Object > Add > Implant, Localizer double-click, tree Add menu, EASY "Add implant".
- After insert: implants appear in all views + tree under their tooth position; **positioning mode auto-activated**.
- Mouse: **left-drag = translate** (follows cursor in any 2D view and 3D), **right-drag = rotate**; rotation pivot: cursor below implant → rotate around **crestal level**, above → around **tip** (disable via setting "Set rotation point based on mouse position" → always crestal).
- Precision: **Fine Alignment dialog** (nudge buttons; step width edit boxes mm/°; patient-oriented vs implant-oriented frame).
- Verification flow: **Align views to implant** + 360° tangential rotation.
- Rendering: 2D outline (configurable color) or true 3D model in 2D views; **Implant Appearance** submenu toggles Implant Axes (length/diameter configurable), Crestal Planes (green disc at crestal level), 3D Models. Selection box around the active object (flash or permanent per setting). "Implants visible through segmentations" setting.
- **Tooth Position panel** (sidebar, tabs): **Implant** (info, Change Implant button, prev/next **diameter and length stepper buttons** showing neighbor catalog values, full list popup of all length/diameter combinations in the series), **Abutment** (info / Edit abutments…), **Sleeve** (system combo + editable values), **Tooth** (virtual tooth / cut-profile info).
- **Changing an implant**: double-click in tree or Change Implant → catalog dialog (current = blue, previous = red); after a change, prompt to re-check the assigned sleeve.
- **Re-labeling tooth position**: right-click position header > Properties > new position — relabels only, never moves geometry.
- **Make Parallel** (right-click implant/group): checkbox list of affected implants; orientation = align to master (Master column) | mean direction; Preview / Reset / OK (confirmation) / Cancel.
- Fixation pins and endodontic drills are planned identically (same dialog, same positioning; pins default to XX; lateral pins auto-placed at an angle). Endodontic planning = straight path to the root-canal entry only.
- **Virtual teeth** (wax-up library): Object > Add > Tooth — library tooth meshes for prosthetic-driven planning; positioned like implants (P3).

### 7.4 Abutments
- One abutment per implant. Sources: **catalog abutments** (compatible list per implant) | **user-defined abutment** | **no abutment**.
- Edit Abutments dialog (right-click implant or Tooth Position panel): tabs Abutment database (with filters), User-defined abutment, No abutment; on single-implant invocation, ask "place on all implants or selected only".
- **Group assignment**: pick a compatible series → software auto-selects suitable (incl. **angulated**) abutments so abutment axes are as parallel as possible (All-on-4/6 support).
- **Dataset alignment tab**: rotate a non-rotationally-symmetric abutment around the implant axis by dragging (per-abutment only).
- **User-defined abutment**: emergence profile + mesostructure; per segment height + top/bottom diameter; mesostructure inclination **0–45°**; rotation; numeric fields + drag handles; selected segment highlighted yellow.

### 7.5 Implant Designer (user-defined implants, P4)
Segment-by-segment rotational geometry editor (per segment: name, height, top/bottom diameter, face type, inclination) or STL import; publish to catalog (locks editing; "User" icon in the dialog); `.cid`-style templates; hotkeys Ctrl+L/S/A/C/X/V.

### 7.6 Interactions
- Implant selection drives: cross-sectional auto-jump, density statistics, status-bar chips, Tooth Position panel, sleeve dialog target.
- Implant changes invalidate dependent guide designs (stale-guide warning, §9.10) and surgical protocol contents.

---

## 8. Sleeve Planning

### 8.1 Concept
Sleeves are the metal guidance inserted in the guide; every guided trajectory needs one. Sleeve geometry + position drive the guide's sleeve mounts, hole (negative) geometry, and the surgical protocol depth calculations.

### 8.2 Sleeve dialog
- Entry: select implant → toolbar **Edit Sleeves**; or right-click sleeve > Properties; or Tooth Position panel Sleeve tab.
- Lists only sleeve **systems compatible** with the selected implant (closed systems restrict by implant; open systems accept any implant).
- After choosing a system: all system-relevant parameters shown with live **schematic illustration** (sleeve over implant) on the right; **arrow buttons** cycle prev/next implant without closing.
- **Sleeve position**: discrete offsets defined per system (e.g. Straumann-style **H2 / H4 / H6** = 2/4/6 mm sleeve-bottom→implant-shoulder); interactive drag in views snaps to the system's allowed increments; no drag if single-position system.
- **Group add**: only systems supported by all selected implants offered; applied to all, then per-sleeve parameter tweaks.
- **Removing**: trash button or select "No sleeve system".
- Pin sleeves and endodontic sleeves come from the same catalog and behave identically.
- **Sleeve-to-sleeve collision check** always on (0 mm).

### 8.3 Custom sleeve systems (generic sleeves)
- Extras > Edit Custom Sleeve System: presets (import/export/delete; **not editable** — create anew). Wizard:
  1. **Geometry**: manual parameters (inner Ø, outer Ø, height; optional article number for the Material List; Add for further sleeves) or **Load from STL** (define top side with slider — yellow plane; set vestibular rotation; enter catalog inner/outer Ø).
  2. **Position**: radio — `Distance to crestal level of implant` | `Distance to top of implant` | `Complete length` (top of sleeve → implant apex; for drill-stop systems) + value(s) in mm; multiple positions allowed (drag increments).
  3. **Sleeve holes** (negative geometry): `Compute automatically` (STL-imported only) | `Design sleeve holes` (segment editor: axially symmetric, per segment height, upper/lower Ø, distance to zero level = sleeve bottom; auto proposal: clearance cylinder above + zero-height transition + sleeve hole extending below bottom) | `Don't use with digital guide`.
  4. **Summary**: name the preset.
- **Sleeveless guides**: realized via auxiliary/dummy sleeves; hole Ø = sleeve outer Ø + offset. Caution: "Never drill directly through the guide. Always use appropriate metal guidance to avoid chipping."

### 8.4 Sleeve calibration matrix (P3)
- Generate an STL test plate with a series of holes in 0.01 mm diameter steps around a sleeve's outer Ø; user prints it, finds the best-fit hole, clicks that hole in the dialog illustration → diameter **offset stored per sleeve model** (used by subsequent guide exports). Reachable from sleeve context menu ("Save Calibration Matrix") and the guide export flow.

---

## 9. Surgical Guide Design

### 9.1 Prerequisites (enforced/warned by the wizard)
- All implants/pins/drills planned with sleeves assigned (sleeves with negative geometry).
- A matched model scan (without wax-up) — or dual-scan denture object — present; for cutting guides additionally a bone 3D model (jaw segmentation without teeth) and a cut profile.
- Design hard rules (validation warnings): design volume ≤ **200 × 200 × 100 mm**; ≥ 3 supporting points forming a triangle; cut bar ≥ 4 mm wide × 3 mm high at 40 mm span; hole height per sleeve outer geometry; stacked guides reuse existing design features.

### 9.2 Wizard entry & start screen
- Object > Add > Surgical Guide / toolbar Add Surgical Guide / EASY "Create surgical guide".
- Optional pre-step: select the base model scan / 3D model (a converted bone-reduction guide can be the base — stacked guides).
- Start options: **new guide** vs **use existing guide as template**; checkboxes **With bone support regions** and **With bone reduction (cut profile)** (adds steps 4 and 7).

### 9.3 Canonical step order
1. Start (template choice + options)
2. **Insertion direction**
3. **Bone support regions** (optional)
4. **Contact surfaces + sleeve mounts** (+ free-hand drawing)
5. **Offset / wall thickness / connector thickness** → body proposal
6. **Bone reduction bars** (only with cut profile)
7. **Inspection windows** (optional)
8. **Label text** (optional)
9. **Finish** (review) → **Export** (license/credits gated)
Back-navigation through all steps is required; edits regenerate downstream results.

### 9.4 Insertion direction
- The current 3D viewing direction = insertion direction; adjust by sliders or mouse (left move / right rotate; wheel zoom).
- Checkbox **"Use bottom side of dual scan"** (intaglio mucosa support).
- Undercuts are **blocked out automatically** from this direction (inner surface = silhouette-swept model surface + offset); no manual block-out step.

### 9.5 Bone support regions (optional)
- Default support surface = model scan; "Add bone support region" → select segmentation → drag box **handles** to scope the region where the segmented bone replaces the scan.
- Use cases surfaced in help: expose bone / remove gingiva under thin sleeve mounts; free-end situations; manual virtual tooth extraction.
- Options: show sleeves during definition; show bone reduction profile (sinus-lift); selected segmentation persisted.

### 9.6 Contact surfaces & sleeve mounts
- Wizard auto-generates a **virtual plaster model** and **sleeve mounts for all sleeves** in the plan.
- **Contact surfaces**: place **spheres** at tooth positions (dental-diagram picker; implant positions pre-blocked/highlighted); sphere size via mouse wheel or left-panel controls.
- **Sleeve mounts**: per-mount size/diameter via wheel or controls; hole shape option **cylindrical** vs **fit to sleeve form**; pin sleeve bodies sized the same way; pin sleeves can be **unselected** (stacked guides).
- **Show contact surface order** toggle: displays the sequence and where connectors will be generated.
- **Drawing tool**: free-hand contact areas (palatal support; stacked-guide edge contact). Note: free-hand areas need sufficient contact with standard guide parts.

### 9.7 Offset / wall thickness / connectors
- **Offset** = gap guide↔teeth (default **0.15 mm**, printer/material dependent); **Wall thickness** (default **3.0 mm**); **Connector thickness** (default **2.5 mm**); checkbox **Use large connectors** (recommended for apicoectomy/sinus-lift/stacked guides).
- Next generates the guide body proposal; gaps between supports bridged by **auto-generated connectors**.

### 9.8 Bone reduction bars (cutting guides)
- Per-side checkboxes **Oral** / **Vestibular**; per bar: **Width**, **Height**, **Offset** (distance to bone/profile).
- Recommended ranges: apicoectomy W 3.9–4.0 / H 3.0–4.0 / O 0.5–1.0; sinus lift W 3.0–4.0 / H 3.0–4.0 / O 0.5–1.5; absolute minimum 4 × 3 mm at 40 mm span.

### 9.9 Inspection windows & labels
- **Windows**: click in the view to add (cylindrical cutouts along view direction); unlimited count/placement; per-window height & diameter via left-panel boxes or mouse wheel over the active window. Caution: windows must not compromise stability. Endodontic guides: place windows **below the sleeves**.
- **Labels**: Add → type text → drag the red-cross anchor on the guide; confirm with green check; multiple labels; font size/style editor (text icon or wheel); **presets** (factory + "Add text to presets"); embossed on the surface.

### 9.10 Finish, validity & export
- Review render; back-navigate to adjust. On finish the guide becomes an object-tree object; 2D views render its cross-section (guide white, sleeve green, soft tissue orange).
- **Stale-design tracking**: if underlying planning changes after design, the guide gets a warning sign; "Guides with warning signs cannot be produced"; **Edit guide design** re-opens the wizard to update.
- **Export final surgical guide** → export dialog: adjust general offset/wall-thickness for material/printer (producer-side adjustment in collaborations); optional **sleeve calibration matrix** export; STL download. Gated by: plan finalized + export credit available (decrement on export; show remaining credits) [WEB].

### 9.11 Specialized guide recipes (documentation-level, same wizard)
- **Bone reduction guide**: cut profile object (panoramic-view reference points; "Add implant base points" auto-seeds; parameters **offset, angulation**; advanced: **Invert profile surface**, **Spline curve**) + bone 3D model → wizard "With cut profile" → bars step.
- **Apicoectomy**: inverted profile, vestibular-only bar, large connectors.
- **External sinus lift**: bone support regions + cut profile; bone window opening region.
- **Endodontic guide**: endodontic drill + its sleeve; contact surfaces on treated teeth; windows below sleeves.
- **Stacked guides**: convert bone-reduction guide → 3D model → use as wizard base; unselect pin sleeves; spheres on pin-hole surfaces; drawing tool along the front edge; large connectors. Warning: **stacked guides must be pin-supported, never purely bone-supported**.
- **Tooth auto-transplantation / evaluation forms**: donor-tooth segmentation → 3D model → positioned; guide evaluates the prepared site.

---

## 10. Wizards & Work Modes

### 10.1 Work modes
- One product, two UIs: **EXPERT** (free toolbar/menu-driven) and **EASY** (guided wizard shell over the same domain objects, plans, catalog, safety engine). Mode chosen on the start screen; switchable per session; EASY uses a dark theme, EXPERT a light theme.

### 10.2 EXPERT toolbar & workflow area
- Toolbar = workflow-step buttons (numbered, left→right standard order; numbers turn **green** when the step is complete) + view tools + menu access.
- Digital workflow preset order: Segmentation → Align PCS → Panoramic curve → Nerve canal → Add model scan → Add Implant → Edit Sleeves → Add Surgical Guide → Print. (Analog/gonyX preset out of scope.)
- Toolbar customization: right-click > Adjust → drag buttons in/out (optional buttons: quick measurements, view-configuration switch, Quick Import/Export) (P3).
- Main menu: Patient, Plan, Object, View, Extras, Help (?).

### 10.3 EASY mode
Four regions: ① **Step overview** tree (steps + collapsible sub-steps, current step blue, one-click jump, object data at a glance, plan-management button), ② collapsible **contextual Help** panel per step, ③ **Views** (pre-aligned per step, step-specific tools only), ④ bottom bar: **Home** (auto-save + exit to start), **Back/Forward**, **Help**, **Plan Management**.

Steps & sub-steps:
1. **Prepare data**
   - *Jaw Selection & Alignment*: maxilla/mandible selector; PCS drag (left move / right rotate); segmentation-threshold slider; "Edit source data…".
   - *Panoramic curve*: point dragging; extra points; Shift-drag whole curve; axial-position popup.
   - *Model scans*: Add / Edit / Remove model scan buttons → shared wizard (§2.2).
   - *Nerve canals* (mandible): top segmented selector **View | Right | Left**; entry/exit point placement in axial or bottom panoramic view; **Auto detect** footer button; point context menu (diameter, reorder, delete).
2. **Place implants**: **Add implant** → catalog dialog (manufacturer → series → tooth positions; chart: deep red = current, light red = used); **Change selected implant** / **Remove selected implant**; per-implant alignment sub-step with **Implant length** and **Implant diameter** − / value / + steppers (within the series); temporary **Measurements** mode toggle; **Select sleeve** / **Select abutment** per implant or for all via the Overview node. Distance warnings always on (yellow in-view banner).
3. **Surgical guide**: *Model scan* (if pending) + *Edit design* → **Create surgical guide** / **Edit surgical guide** → shared design wizard; object-visibility segmented control; stale-design warning.
4. **Finish**: *Print protocol* — segmented selector `Selected protocols | Material list | Details | Surgical protocol`; page arrows; **Print** / **Save to PDF** buttons. *Export & completion* — export/download guides; guides with warnings blocked.

### 10.4 Shared wizard grammar
All multi-step dialogs (model-scan import, guide design, custom sleeve, augmentation, prosthetic import, treatment evaluation) use one component framework: modal step sequence with Back/Next/Finish, per-step toolbar, live 3D/2D sub-views, inline help.

### 10.5 Treatment Evaluation (P4)
- Plan > Treatment Evaluation: studies list (New/Load). Two study types: (A) postoperative **model scan with scanbodies**, (B) postoperative **CT/CBCT**.
- Shared pipeline: study properties (name, type, comment, tooth-position selection, change-implant correction) → load postop data + select segmentations → corresponding regions → automatic surface registration (+ manual) → **implant alignment** (click scanbody tops / align to CT contours; arrows cycle implants) → **evaluation report**: per-implant deviation table (planned vs actual, multiple directions), views below, Print + **Export results table to CSV**; Finish saves the study.

### 10.6 AI assistance (P4, feature-flagged) [WEB]
- Optional server-side pipeline mirroring the AI Assistant: auto segmentation (teeth labeled + jaw), PCS + panoramic-curve proposal, nerve detection, surface matching, tooth extraction. Offered at import (declinable) and via toolbar button; background job with status (hourglass/check) on toolbar + dataset list; **review dialog** (object list, checkmark selection, yellow-warning errors unselectable, "Import reviewed data"); manual tooth-label correction. Input constraints surfaced: CBCT only, slice/pixel spacing 0.05–0.5 mm, thickness ≤ 0.8 mm, uniformity 0.01 mm.

---

## 11. Reports & Printing

### 11.1 Protocol set
Accessible via Plan > Print ▸ and the toolbar Print dropdown; every protocol renders to **PDF** (server-side), with optional direct download (no preview). Set:
1. **Screen copy** (current screen capture).
2. **Material list** (+ All Plans variant) — BOM of all implants, sleeves, abutments with manufacturer/system, type, article number, dimensions, tooth position; optional plan comment (setting).
3. **Details** (+ All Plans) — per implant/instrument: images of all planning views centered on the item + implant identification (manufacturer, type, article no., Ø, length, tooth position) + sleeve info + protocol summary.
4. **Surgical protocol** — guided-surgery drill sequence; only for systems with protocol definitions (catalog-driven).
5. **Print all** — document-selection dialog, batch generation; selection persisted.
(Analog gonyX template plan/verification and printer calibration are legacy — out of scope [WEB].)

### 11.2 Common layout
- **Header**: app logo + version, "Licensed to" account/team name, document title + guided system name, patient block (Name, Date of birth, Patient ID), tooth-notation note ("FDI notation (World Dental Federation)" or Universal).
- Optional **user logo** in the header (Settings > Printout; uploaded image).
- **Footer**: verbatim disclaimer (user responsible for data; not a substitute for professional judgment; liability disclaimer), "Printed: YYYY-MM-DD HH:MM", copyright.
- Caution on every image-bearing report: "Printouts containing images of the dataset are not intended for diagnostic purposes."
- Reports must be generated from a **finalized plan** for production use; UI verifies and stamps plan name/status.

### 11.3 Surgical protocol details
- One row (or block) per implant: Position (tooth), drill sequence per the system definition (e.g. milling cutter, pilot drill, guided drills by Ø, profile drill, tap), implant (article no., type/platform, Ø, length), **Depth stop / sleeve position** (H-value).
- Per drill cell: drill Ø + color code, **bone-class applicability** (3 classes: soft/D4, medium/D2–D3, hard/D1), glyph coding (dots = handle cylinder +1/+3 mm, lines = drill length short/medium/long), "c" = cortical-widening-only steps; guiding info in empty fields; **manual steps clearly marked** where guided drilling is impossible.
- Protocol definitions are **data** (per sleeve system: ordered steps with conditions on implant Ø/length/bone class) so new systems are added without code changes. Show a friendly notice when the implant+sleeve combination has no protocol.

### 11.4 Plan approval document [WEB]
- A dedicated "Plan approval" PDF: patient + plan identification, planner account, implant & sleeve table, key view images, date/version, disclaimer, signature lines; sharing a case for approval can attach it; approval marks the plan final (workflow built on §12).

### 11.5 Print preview
- In-app preview pane: page navigation (first/prev/next/last), zoom in/out/levels, Download PDF, Close. "Direct to PDF" path skips preview.

---

## 12. Collaboration [WEB re-imagining of caseXchange / Order Management]

### 12.1 Case sharing (caseXchange equivalent)
- **Contacts**: account-to-account pairing via **connection code / share ID** (7-digit), or directory of registered **labs/providers** (asynchronous pairing request with "Confirmation pending" state, email confirmation). Contact list grouped: contacts, reference laboratories, viewer links. Delete contact (warning).
- **Sending a plan**: Plan > Send → contact picker (re-send preselects prior recipient — must verify) → optional **comment** → send. Sending **write-protects** the plan ("Sent" label in status bar); editing later requires **Plan > Edit** which keeps the sent version in history and creates an editable copy.
- **Receiving**: inbox polling/notifications (in-app toast + optional email "new data available"); transfer list with per-activity **transfer number**, colored status bar, statuses: ready for upload → uploading → ready for download → downloading → ready for import → finished | rejected; recipient-download acknowledgment; received plans arrive **write-protected**; Send Back; Download Again; Tidy-up (hide finished); auto-remove finished older than N days; quick search + filters; background transfers with Hide.
- **Consent gate**: legal disclaimer (patient consent + lawful sharing) confirmed before first send.
- **Service requests** (clinician → lab): Send order → service type: `Digital surgical guide` (sub-items: matching of model scan [only if a scan is unaligned], design of guide [+ requirements text], fabrication), `Custom` (free text), `Bone block design`, `Radiographic assessment`. "Non-binding inquiries." Rejected services show a minus icon.

### 12.2 Order Management (provider side, P3)
- Provider registration: profile + **services offered** checklist; listed in the lab directory.
- Order list: color code per service type; group by contact/patient/service; full-text search; service chains **sequence-controlled** (dependent services locked until predecessor done); pending transfer actions as inline buttons; statuses: locked / actionable / completed; Process service (opens the case), Finish → `Current service finished` | `All open services finished`; Reject service; Remove finished.

### 12.3 Read-only share links (iPad-app equivalent, P3)
- Generate a tokenized **viewer link** for a plan: recipient gets a browser-based, presentation-only view (implant list with tooth positions, implant-aligned 3D, axial/panoramic/cross-sectional views). Watermark "presentation only — not for diagnostic purposes". Revocable.

### 12.4 Archive exchange (offline)
- **Quick Export** (Patient > Export Planning): downloads a `.caf`-style archive of the **active plan only**; plan becomes write-protected with "Sent" label. **Quick Import** (Patient > Import Planning or drag-drop archive upload). Full **dataset archives** (all plans + images) export/import via Management. Version-compatibility warning on import of archives from other app versions.

---

## 13. Settings & Administration

### 13.1 Settings dialog (Extras > Settings; per-user) — tabs
1. **Views**: Smooth view transitions (ON); Orientation indicator model (default "Face"); Adjust object outline width to zoom level (ON); colors — Auxiliary lines (green), Annotations (yellow), Measurements (yellow); Text size of measures and annotations (default 8); Jointly move and zoom all cross-sectional views (ON); Rotate view when aligned to an implant — cross-sectional (OFF) and axial (OFF); Distance between cross-sectional views (default 1.00 mm).
2. **Safety distance**: "Warn if implants are too close to each other" ☑ + Allowed minimal distance (default 3 mm; note "Sleeves are also checked."); "Warn if implants are too close to the nerve" ☑ + Allowed minimal distance (default 2 mm); ranges 0–10 mm.
3. **Implants**: Dental notation (FDI | Universal); Implant axes (show + length/diameter); Implants visible through segmentations; Show object selection box permanently; Set rotation point based on mouse position; 2D implant color.
4. **Printout**: Print plan comment on material list; Use logo in header of printouts (+ logo upload).
5. **Stereo 3D** (P4): mode, invert sides, eye angle, separate-monitor option.
6. **Screenshot**: Filename scheme (Default | Anonymized | User-defined with placeholders); Storage (Image Management | download folder) + format; Notification after saving.
7. **Common**: decimal places for measurements.

### 13.2 Management console [WEB]
- **Account & team**: profile, password/MFA, team members + roles (read/modify/delete per patient or dataset; owner = full); most restrictive permission wins; if permissions disabled, everyone in the team sees everything.
- **Language**: UI language selection (EN baseline; i18n framework; DE/FR/IT/NL/HU as added locales, P4).
- **Subscription & credits**: tier display, guide-export credits remaining, usage history.
- **Backup/archive**: export/import dataset archives; auto-suggest backup of datasets unopened for N days (configurable check frequency) (P4).
- **Catalog admin** (admin role): import/update implant & sleeve catalog versions; outdated flags; region availability; surgical-protocol definitions.
- **Audit log**: plan finalization, exports, shares, deletions, anonymization (P3).

### 13.3 Help & support
- Context-sensitive help (F1 / per-dialog "?" bubbles) backed by a static help site; hotkey list dialog (Ctrl+F1); About box (version, license info, third-party licenses); onboarding tour replay.

### 13.4 Non-functional requirements [WEB]
- Volume rendering and MPR must stay interactive for 512×512×~600 16-bit volumes (use typed arrays, web workers, GPU textures; downsampled previews while interacting).
- All mutations server-persisted; optimistic UI with autosave; soft-delete + confirmation for destructive ops.
- Encryption in transit (TLS); patient data access restricted by auth; anonymization function for sharing.
- Max per-view render resolution 4096×3072; minimum layout 1680×1050, responsive down to 1366×768 with collapsible sidebar.
- Browser support: evergreen Chrome/Edge/Firefox/Safari with WebGL2.

---

## Appendix A — Default values quick reference

| Parameter | Default | Range/Notes |
|---|---|---|
| Implant↔implant warning distance | 3 mm | 0–10 mm, also checks sleeves |
| Implant↔nerve warning distance | 2 mm | 0–10 mm |
| Sleeve↔sleeve collision | 0 mm | fixed |
| Cross-sectional view offset | ±1.00 mm | settings spin box |
| Nerve point diameter | 2.0 mm | per-point; "Apply to all points" |
| Segmentation slots | 8 | slot 1 = "Default" threshold |
| Segmentation undo depth | 10 steps | toggleable |
| Brush sizes | 3 (S/M/L) | |
| Guide offset | 0.15 mm | printer-dependent |
| Guide wall thickness | 3.0 mm | |
| Connector thickness | 2.5 mm | |
| Reduction bar minimum | 4 w × 3 h mm | at 40 mm span |
| Guide design volume | 200×200×100 mm | hard limit |
| Mesh LOD presets | Coarse/Standard/Fine | Standard default |
| 3D relative rotation step | 5° | |
| 3D move step | 5 px | |
| 3D zoom step | 12 % | |
| Measurement decimals | 1 | settings (Common) |
| Text size measures/annotations | 8 | |
| Mesostructure inclination | 0–45° | user-defined abutment |
| Corresponding region pairs | ≥ 3 | not collinear |
| Panoramic curve basic points | 5 | not deletable |
