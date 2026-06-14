# 2. Introduction and overview

## 2.1 Intended use

DWOS Web reproduces the workflow of dental restoration CAD/CAM software in a web browser: it
imports 3D surface scans of a prepared clinical situation, lets the operator design dental
restorative prosthetics on those surfaces, and exports the design as an open mesh for
manufacturing.

Because this build is a demonstration re-implementation (see chapter 1.1), its intended use is
**training, evaluation and development** — not the design of restorations for patient
treatment.

## 2.2 Device description and features

DWOS Web imports and visualizes 3D scan data of the clinical situation and lets the operator
design restorations on it inside an embedded CAD workstation. The design result is exported as
an open mesh for automated manufacturing.

The restoration types covered by the original DWOS suite are crowns, bridges, abutments,
screw-retained bars and bridges, partial frameworks, full dentures, bite splints and models.
In this demonstration build the in-scope and planned scope are:

| Restoration type | Status in this demo |
|------------------|---------------------|
| Single full-contour crown | In scope (worked example, chapter 5) |
| Bridges | Planned |
| Abutments | Planned |
| Bars and partial frameworks | Planned |
| Full dentures | Planned |
| Bite splints | Planned |
| Models | Planned |

A real, working feature already built into DWOS Web is **AI tooth segmentation of intraoral
scans**: an imported intraoral scan is sent to a vendor segmentation model that returns
per-vertex tooth labels, which are mapped to **FDI** tooth numbers. This auto-tagging gives
each tooth in the scan its dental notation and drives the worked crown example.

### Device variants and configuration

The original DWOS suite ships in three variants — **DWOS** (full functionality for dental
laboratories), **DWOS Easy** (a.k.a. Straumann Nova™, a simplified subset for laboratories)
and **DWOS Chairside** (a simplified subset for dental clinics). DWOS Web is a single web
application; it does not reproduce the variant split. Where this manual refers to a variant it
is describing the original product for orientation only.

### Principles of operation

DWOS Web provides solutions for computer-aided design (CAD) of dental restorations. It is an
open system: it operates on 3D surface scans supplied in open file formats and produces design
results as open meshes (STL) for any compatible manufacturing chain. All 3D data is interpreted
in millimetres.

The software supports digital realization of conventional dental restoration design; it does
not introduce novel clinical features relative to conventional dentistry.

## 2.3 Indications

Within its demonstration scope, the software supports the design of dental restorative
prosthetics by dental professionals who have appropriate knowledge in the respective field of
application: importing and visualizing 3D scan geometry, labelling teeth, and designing
restorations on the prepared situation for export to a manufacturing chain.

## 2.4 Accessories and products used in combination

**Input — scanners.** DWOS Web operates on 3D surface scans from intraoral or desktop
scanners. Any scanner that exports 3D data in an open file format (**STL**, **PLY** or
**OBJ**) and is certified for dental scanning may, in principle, be suitable; the operator is
responsible for ensuring the files meet the data input requirements below. Intraoral scans for
AI auto-tagging are processed as binary glTF (GLB) per-vertex meshes.

**Output — manufacturing.** Design results are exported as open **STL**. Any 3D manufacturing
chain (milling or printing) that accepts STL and is certified for dental restoration
fabrication may, in principle, fabricate them; the operator is responsible for ensuring the
results meet the requirements for the dental restoration.

**Software used in combination.** DWOS Web shares a repository and data directory with the
**coDiagnostiX Web** implant-planning clone. In the original products the two exchange cases
through DWOS Synergy; this demonstration build documents the interplay but does not reproduce
the proprietary Synergy transport.

> ⚠️ **Caution**
> The software performance depends on the quality and accuracy of the imported 3D scans. The
> production of scans, and of the manufactured restoration, lies fully within the
> responsibility of the user. A clean prepared stump with its margin clearly captured is
> required for every restoration.

## 2.5 Contraindications

Do not use the software:

- for designing restorations for the treatment of real patients (demonstration build — see
  chapter 1.1),
- in direct contact with a patient, or in combination with life-sustaining devices,
- with scans that were imported despite warnings you do not fully understand, or whose margin
  cannot be identified with confidence.

## 2.6 Precautions

- **Verify every automatic result.** AI tooth segmentation, margin detection and proposed
  anatomy are aids; check each before relying on it.
- **Verify scan quality before design.** A noisy, incomplete or low-resolution scan produces an
  unreliable restoration regardless of how the design tools behave.
- **Use a strong password** for any deployed instance to reduce the risk of intrusion.
- **Verify dimensions.** All geometry is interpreted in millimetres; confirm exported meshes
  are at the expected scale before manufacturing.

## 2.7 Compatibility information

The client requires a desktop browser with **WebGL 2**; the embedded CAD workstation renders
in WebGL. Tested with current Chromium-based browsers; equivalent-generation Firefox and Safari
releases are expected to work. The server requires the **Bun** runtime. Supported import
formats are STL, PLY and OBJ; export is STL.

## 2.8 Data protection

- Access is restricted by user accounts shared with the coDiagnostiX Web application
  (password hashing, optional two-factor authentication, login-attempt lockout).
- Orders, scans and design files live in the server data directory; deleting a record removes
  its associated files, not only the database rows.
- The optional AI-segmentation backend transmits scan geometry to an external model endpoint;
  see chapter 3 for how to configure or disable it. Do not send identifiable data to an
  external endpoint you do not control.

## 2.9 Data backup

Everything DWOS Web stores lives in the server data directory: the database plus all imported
scans and exported designs. Back the directory up as a whole, regularly and before every
update. See chapter 6.

## 2.10 Disposal (data deletion)

Electronic data takes the place of a physical device here: when an order or design is no longer
needed, export the design if retention is required, then delete the record. Deletion removes
all files belonging to the record from the data directory.
