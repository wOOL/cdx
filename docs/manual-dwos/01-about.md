# 1. About this guide

> ⚠️ **Caution**
> This manual explains how to operate DWOS Web safely and effectively. Read it before
> designing your first restoration. Where the application itself shows a warning (yellow ⚠
> banners, red status text, confirmation dialogs), the warning in the running software always
> takes precedence over anything written here.

This guide applies to **DWOS Web**, the browser-based re-implementation of the DWOS
restoration CAD/CAM workflow. It covers the CAD workstation reachable from the **`/cad`**
route, the import of surface scans, AI-assisted tooth segmentation, and the design and export
of restorative prosthetics.

The name *DWOS Web* in this guide refers to this single web application. It is a companion to
the coDiagnostiX Web implant-planning clone that lives in the same repository; the two share a
data directory and several services, and a separate manual documents coDiagnostiX Web.

The manual is delivered in electronic form:

- as Markdown files under `docs/manual-dwos/` in the repository, and
- rendered to a printable PDF (`docs/manual/DWOS-Web-Manual.pdf`).

You can print any chapter with your browser's print function (Ctrl+P).

## 1.1 Disclaimer

DWOS Web is a **demonstration re-implementation** built for training, evaluation and
software-development purposes. It is **not a certified medical device**, has not undergone
regulatory clearance (no CE mark, no FDA clearance), and must not be used to design
restorations for the treatment of real patients.

Beyond that fundamental restriction, the same professional logic applies that governs any
restoration-design software:

- The operator is responsible for verifying every result the software computes — automatic
  tooth segmentation, margin detection, proposed anatomy and intrados surfaces are *aids*,
  never decisions.
- The operator is responsible for the correctness, completeness and adequacy of all data
  entered: orders, imported surface scans, restoration parameters and material selections.
- Design quality depends on the quality of the input scans. A clean prepared stump with a
  clearly captured margin is required for every restoration; low-resolution, incomplete or
  noisy scans degrade every downstream step.

## 1.2 License, trademarks and other rights

DWOS® and coDiagnostiX® are registered trademarks of Dental Wings Inc. (Straumann Group).
This re-implementation is an independent, educational work and is not affiliated with,
endorsed by, or distributed by the trademark owner. The names are used here solely to identify
the software being re-implemented.

The application is built on open-source components, each under its own license. Its
restoration design is performed by a vendored build of the **Chili3D** CAD engine
(`vendor/chili3d`), and the surrounding web application uses SvelteKit and Svelte (MIT),
Bun (MIT) and three.js (MIT). The complete list with version numbers is the authoritative
source for third-party attribution in the running build.

All example data shipped with the application is generated programmatically or anonymized and
contains no real patient information.
