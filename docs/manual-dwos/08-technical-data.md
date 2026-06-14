# 8. Technical data and label

## 8.1 Hardware and software requirements

**Workstation (client):**

| Item | Minimum |
|------|---------|
| Browser | Current Chromium-based browser (or an equivalent-generation Firefox/Safari) with **WebGL 2** — the CAD workstation will not render otherwise. |
| Display | 1600 × 900 or larger; the design workstation uses a multi-panel layout. |
| Input | Mouse with wheel and middle button recommended (orbit, pan, zoom in the 3D view). |
| Memory | 8 GB system RAM; the 3D view holds the active scan and design in GPU memory. |

**Server:**

| Item | Minimum |
|------|---------|
| Runtime | Bun (bundles the SQLite driver); Linux x64 tested. |
| CPU / RAM | 4 cores, 8 GB. |
| Deployment | `bun run build` + an `ORIGIN`-configured production server (chapter 3); place behind HTTPS for any non-local use. |

## 8.2 Supported file formats

| Direction | Formats |
|-----------|---------|
| Scan import | **STL**, **PLY**, **OBJ** (surface meshes) |
| AI segmentation transport | binary glTF (**GLB**), per-vertex labelled |
| Design export | **STL** (open mesh for manufacturing) |

All 3D data is interpreted in **millimetres**, even where the underlying exchange format
carries no explicit dimension information.

## 8.3 Ports and services

| Component | Default |
|-----------|---------|
| Application server (production) | Port from `PORT` (example: 3000) |
| Development server | Port 5173 (`bun run dev`) |
| AI-segmentation backend | `CDX_AISEG_URL` (default `https://pbapi.becertain.ai`) |
| Data directory | `CDX_DATA_DIR` (default `./data`) |

## 8.4 Identification (label)

The product identification of this build — name and version — is shown in the application.
Quote the version shown there in every support request. This build repeats the
demonstration-use disclaimer (chapter 1.1); it carries no medical-device label, UDI or
manufacturer marking, because it is not a medical device.
