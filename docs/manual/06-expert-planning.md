# 6. EXPERT mode: step-by-step case planning

This chapter walks through a complete planning in EXPERT mode, stage by stage. It assumes a
dataset has been imported (chapter 3.3).

## 6.1 Align patient coordinate system

Open the **Align stage** and click **Align patient axes…**:

![Patient-coordinate-system dialog](img/pcs-dialog.png)

- **Propose automatically** analyzes the bone segmentation, fits the jaw arch and fills in
  yaw / pitch / roll (and proposes a panoramic curve at the same time). Review the values —
  a low-confidence proposal is announced explicitly.
- Or enter the angles manually: *yaw* rotates in the axial plane, *pitch* in the sagittal,
  *roll* in the coronal. Use the coronal view to judge roll and the sagittal view for pitch.
- The **horizontal 3D cut** checkbox clips the 3D view at the current axial position while
  you align; the **bone threshold** field tunes the 3D bone display ("Setup 3D views").
- **Apply rotation** resamples the volume permanently and co-rotates everything already
  planned (curve, nerves, implants, measurements). **Reset to default** undoes all applied
  rotations exactly.

## 6.2 Panoramic curve

Open the **Panoramic stage**:

![Panoramic stage with curve](img/pano-stage.png)

1. Click **Draw curve**, then click 5–7 points along the middle of the dental arch in the
   axial view, posterior → anterior → posterior.
2. The panoramic view reconstructs live. Drag any point to refine; *Undo point* removes the
   last one. The **Slab** slider thickens the panoramic reconstruction into a slab projection.
3. The orange line in the panoramic view is the axial reference; while scrolling axial slices
   in EASY mode an orientation popup shows the current position (chapter 4.2).

> 💡 The PCS auto-proposal (6.1) can also propose the curve; accept it and refine points
> manually where needed.

## 6.3 Detect nerve canal

Open the **Nerve stage** (mandible plans):

![Nerve stage with auto-detect](img/nerve-stage.png)

1. **Add right/left nerve** creates the nerve object with its color chip in the toolbar and
   the object tree.
2. Click the entry point at the mental foramen and the exit at the mandibular foramen
   (panoramic or cross-section view).
3. **Automatic detection:** with both seed points placed, click **Auto detect**. The
   software traces the low-density canal between the seeds and replaces the intermediate
   points, then reminds you: *"Automatic detection — verify the nerve course manually on
   every slice."*
4. **Manual definition:** add further points by clicking in the views; drag existing points
   to correct them. The point toolbar offers *Center views*, *To slice* (moves the point to
   the current axial slice), *Swap ↔ next* (fixes point order) and **#** (shows point
   numbers along the canal). The ⌀ field sets the diameter per point or for the whole nerve.

> ⚠️ **Caution**
> Automatic detection cannot guarantee an exact nerve display. Verify the canal on every
> slice and correct it manually. If the canal cannot be identified due to poor image
> quality, do not use the dataset (chapter 2.5). Maintain the configured safety distance —
> violations are flagged in red in the toolbar, status bar and report.

## 6.4 Import and match model scan data

A matched surface scan is the basis for tooth-supported guides.

1. In the **Data stage**, drop the scan file (`.stl` / `.ply`) onto the dropzone. It appears
   under *Models* in the object tree.
2. In the **Align stage**, pick the scan in *Match scan* and add **at least three point
   pairs**: click a distinctive spot on the scan in the 3D view, then the same anatomical
   spot in a slice view. **Align** computes the registration; **Refine fit (ICP)** optimizes
   it against the bone surface and reports the fit RMS.
3. For manual corrections use **Drag scan** (drag in the axial view, Shift = rotate) or
   **Fine align…** — numeric nudge steps in millimetres/degrees, in the patient or object
   frame:

![Model scan matching](img/match-stage.png)

![Fine alignment dialog](img/fine-align.png)

4. Mesh utilities next to the matching tools: **Check** (degenerate/duplicate triangles,
   open edges), **Repair**, **Smooth** (local, around the last clicked scan point),
   **Fill holes**, and **Replace…** (swap the mesh file, keeping the alignment — e.g. when
   the lab delivers a corrected scan).

> 💡 **Hint — edentulous patients**
> When no stable teeth are available as landmarks, place temporary reference objects
> (fixation pins or temporary implants from the library) before scanning and use them as the
> point-pair landmarks for registration.

### Dual-scan template matching (radiographic template)

For the classic dual-scan protocol — a radiographic template with radiopaque fiducial
markers, scanned once **in the patient's mouth** and once **alone** — the registration is
automatic:

1. Import both scans into the case (the Data stage shows a hint when two datasets are
   present).
2. Open **Align stage → Match template…**, pick which dataset is the patient scan and which
   the template-alone scan, and click **Detect & match**. The software finds the markers in
   both volumes (spheres and irregular gutta-percha blobs are supported; streak artifacts
   are rejected) and solves the correspondence:

![Dual-scan template matching](img/template-match.png)

3. Review the result: every marker pair with its residual in mm (green < 0.3, yellow < 0.6,
   red above), the total RMS and the confidence verdict. Ambiguous or degenerate marker
   constellations are reported as *low* confidence — never silently accepted.
4. **Accept & create matched template model** transforms the template surface into patient
   space and adds it to the case as a matched model, ready to serve as the intaglio side of
   a mucosa-supported guide (chapter 6.6). The match is recorded in the audit log.

> ⚠️ **Caution**
> Verify the congruency in all views after applying — automatic matching never replaces the
> visual check. Manual point-pair + ICP registration remains available at any time and is
> the fallback whenever the confidence verdict is not *good*.

> ⚠️ **Caution**
> After matching, check the congruency of the scan and volume contours in **all** 2D views
> (the scan is drawn as an outline over the slices). The fit RMS is an aid — only visual
> verification across the whole arch confirms the registration. An inaccurate match degrades
> every guide built on it.

## 6.5 Plan surgical treatment

Open the **Implants stage** and click **Add implant** (or double-click the target position
in the axial view):

![Add-implant dialog](img/implant-dialog.png)

- Pick the tooth position on the dental chart (FDI or Universal numbering per Settings),
  the implant system and the dimensions. **Browse library…** opens the searchable catalog —
  filter by manufacturer, diameter, length, type (implants, fixation pins, endodontic
  drills), region; star entries as favorites:

![Implant library picker](img/implant-picker.png)

> ⚠️ **Caution — endodontic drills**
> A guide supports an endodontic drill only on a **straight path to the canal entry point**;
> the root-canal treatment itself is not guide-supported. Plan the access trajectory
> accordingly (the endodontic entries in the library carry the same note).

- The implant is placed at the cross-section position. **Drag** the body to move it, drag
  the **head/apex handles** to angle it, ▲/▼ to step the depth; the toolbar shows the bone
  density (HU with class) along the implant:

![Implants stage](img/implant-stage.png)

- **Parallelize…** aligns implants to a master or their mean direction; **Angles…** shows
  the live angle table between all implants; **Group abutments…** picks angulated abutments
  automatically (All-on-4/6 style); **Virtual tooth…** places a prosthetic marker from the
  tooth library.
- Abutments are assigned per implant (preset straight/angled or a custom abutment built in
  the segment editor); the rotation dial aligns an angled abutment around the implant axis.
- Red warnings appear when a safety distance is violated; the affected pair and distance are
  listed in the status bar and the report repeats every active warning.

**Sleeves** — in the **Sleeves stage**, assign a sleeve to every implant (the guide
generator only builds drill channels for sleeved implants). Sleeve diameter/height and the
drill-stop offset follow the selected system; custom systems with their negative geometry
are defined under `/sleeves`:

![Sleeves stage](img/sleeve-stage.png)

> ⚠️ **Caution**
> Never plan a drill path through bare guide material. For sleeveless protocols, plan an
> auxiliary (dummy) sleeve so the path stays metal-guided.

## 6.6 Design the surgical guide

**Preparation:** complete the planning, match the master-model scan (without wax-up), and —
for bone-supported or bone-reduction guides — create a bone model (Align stage → *Create
bone model*).

Open the **Guide stage**:

![Guide stage with design options](img/guide-stage.png)

1. Choose the **base model** (matched scan, or bone segmentation for bone-supported guides;
   for mucosa-supported guides pass the dual-scan bottom side as the intaglio surface in
   *Design options*).
2. Set **offset** (scan-to-guide gap), **wall thickness**, **support radius** and the
   **insertion direction** (along implant axes or vertical).
3. **Design options…** holds the advanced features: recipe presets (standard, endodontic,
   apicoectomy, sinus lift, stacked, transplant evaluation), embossed **label**, **bone
   support regions**, free-hand **contact polygons**, **bone reduction bars**, large
   connectors and the sleeve-mount hole shape (cylindrical or press-fit). **Windows** places
   inspection openings by clicking the guide in the 3D view — keep them small and away from
   sleeve mounts: an opening must never compromise the stability of the guide or the
   accuracy of drilling (the design rules warn when a window overlaps a mount).
4. **Generate guide** builds the body and lists **design-rule warnings** (thin walls,
   sleeves too close, label outside the footprint, bars crossing drill channels…). Resolve
   or consciously accept each warning.
5. Approve the plan (plan menu), then download the **STL**. Any later planning change marks
   the design *"Guide outdated"* and blocks the download until you regenerate.
6. **Producer export…** regenerates with production adjustments (offset/wall deltas) and
   applies a printer calibration profile from `/sleeves`:

![Producer export dialog](img/producer-export.png)

### Bone reduction profile

For cases that require levelling the alveolar ridge before implant placement, the guide can
carry a **bone reduction profile**:

1. **Prerequisites:** a bone model (Align stage → *Create bone model*; for an edentulous
   reduction guide, segment the jaw without teeth using the segmentation editor's boundary
   tools) and the planned implants.
2. Click **Bars from implants** in the Guide toolbar — the software proposes one reduction
   bar between each pair of neighbouring implants at platform level (the reference points
   are derived from the implant bases).
3. Refine in **Design options… → Bone reduction bars**: every bar is editable (start/end
   position, width, height and the *zTop* cut level that marks the reduction plane); add or
   remove bars freely. The bar undersides mark the bone level to be reduced to.
4. **Generate guide** — the bars are merged into the guide body and checked by the design
   rules (a bar crossing a drill channel raises a warning):

![Bone reduction bars proposed from the implant positions](img/reduction-bars.png)

The same profile principle serves further interventions: **apicoectomy** (cut window at the
root apex), **sinus-lift** lateral access profiles, **gingivectomy** levels and the
evaluation of **orthognathic** cut planes — pick the matching recipe preset and place the
bars/windows along the planned cut.

### Tooth auto-transplantation evaluation

To evaluate a donor tooth at the recipient site:

1. Segment the donor tooth from the matched model scan: select the scan, then
   *extract-tooth* at the donor position (the *(extracted)* model appears in the object
   tree).
2. Position the extracted tooth model at the recipient site with **Fine align…**
   (translation and rotation in patient or object frame) and judge the fit in all views:

![Extracted tooth model for transplant evaluation](img/transplant-model.png)

3. Use the **Transplant evaluation** recipe preset for an evaluation guide if the surgical
   plan requires one.

### Combination and stacked guides

Complex cases combine several guides on one anatomy:

- **Integrated guides** add evaluation features to a normal drill guide — e.g. inspection
  windows over an augmentation site or reference pins for re-seating checks. Plan them with
  windows + support regions in *Design options*.
- **Stacked guides** split the surgery into a sequence that shares one fixation: typically a
  **pin guide** (fixation pins only), a **bone-reduction guide** and the **implantation
  guide**, each seating on the previous one. The workflow:
  1. Generate the first-stage guide (e.g. pins only) and approve/produce it.
  2. **→ model** converts the generated guide into a plain 3D model.
  3. Select that converted model as the **base** of the next guide and pick the **Stacked
     guide** recipe (it enables large connectors and reminds you that stacked guides must be
     pin-supported, never purely bone-supported):

![Stacked guide generated on a converted guide base](img/stacked-guide.png)

  4. Repeat for the final implantation guide. After pin drilling, the pin guide is removed
     and the subsequent guides are fixed through the same pin holes.

> 💡 **Convert guide → model** turns a generated guide into a plain 3D model — the base for
> stacked-guide workflows.

## 6.7 Print protocols

Open the **Report stage** (or *Protocol & report* in EASY):

![Surgical protocol](img/report-page.png)

The protocol contains patient/plan identification, volume data, the implant list (material
list, optionally with the plan comment), the per-implant **drill protocol** with bone
classes and guided drill lengths, active **safety warnings**, the nerve list, implant
**cross-sections** and the **panoramic overview**.

- **Print / PDF** opens the browser print dialog.
- **Print all…** batch-prints a remembered selection of the documents:

![Print-all dialog](img/print-all.png)

- **QR export** provides the protocol data in machine-readable form for surgical-motor
  integrations (chapter 7).

> ⚠️ **Caution**
> Printouts are documentation, not diagnostic images, and drawings are not to scale.
> The protocol repeats every active safety-distance warning — resolve them before surgery
> or document why they are acceptable.
