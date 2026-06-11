# 1. About this guide

> ⚠️ **Caution**
> This manual explains how to operate coDiagnostiX Web safely and effectively. Read it before
> planning your first case. Where the application itself shows a warning (yellow ⚠ banners,
> red status text, confirmation dialogs), the warning in the running software always takes
> precedence over anything written here.

This guide applies to **coDiagnostiX Web**, the browser-based re-implementation of the
coDiagnostiX dental implant planning workflow. It covers every screen reachable from the
start screen (DentalDB), the EASY and EXPERT planning modes, guide design and export,
collaboration, administration, and the supporting modules.

The manual is delivered in electronic form:

- as Markdown files under `docs/manual/` in the repository, and
- rendered in the application itself at **`/manual`** (also reachable through the F1 help
  panel → "Open the full manual").

You can print any chapter with your browser's print function (Ctrl+P). The Report stage's
"Print all…" dialog is for *clinical documents*, not for this manual.

## 1.1 Disclaimer

coDiagnostiX Web is a **demonstration re-implementation** built for training, evaluation and
software-development purposes. It is **not a certified medical device**, has not undergone
regulatory clearance (no CE mark, no FDA clearance), and must not be used to plan or carry
out treatment of real patients.

Beyond that fundamental restriction, the same professional logic applies that governs any
planning software:

- The operator is responsible for verifying every value the software computes — measurements,
  safety-distance warnings, automatically detected nerve courses, automatically proposed
  alignments and segmentations are *aids*, never decisions.
- The operator is responsible for the correctness and completeness of all data entered:
  patient records, imported DICOM series, model scans, implant selections.
- Planning results depend on the quality of the input data. Low-resolution scans, large slice
  spacing, motion artifacts or wrong import settings degrade every downstream step; the
  import wizard flags these conditions but does not block them.

## 1.2 License, trademarks and other rights

coDiagnostiX® is a registered trademark of its respective owner (Dental Wings GmbH /
Straumann Group). This re-implementation is an independent work and is not affiliated with,
endorsed by, or distributed by the trademark owner. The name is used here solely to identify
the software being re-implemented.

The application is built on open-source components, each under its own license: SvelteKit and
Svelte (MIT), Bun (MIT), three.js (MIT), dicom-parser (MIT) and fflate (MIT). The complete
list with version numbers is shown in the **About dialog** (start screen → ⓘ button), which is
the authoritative source for third-party attribution in the running build.

All example data shipped with the application (the "Demo, Patient" case and the synthetic
CBCT phantoms) is generated programmatically and contains no real patient information.
