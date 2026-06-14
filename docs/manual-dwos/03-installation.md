# 3. Installation (deployment)

DWOS Web is a web application: there is nothing to install on the workstation — operators only
need the URL and an account. "Installation" here means deploying and serving the web app and,
optionally, configuring the AI-segmentation backend.

## 3.1 Building and serving the application

DWOS Web is served from the same SvelteKit + Bun project as coDiagnostiX Web; the CAD
workstation reachable at `/cad` is built together with the rest of the application.

```bash
bun install
bun run build                 # also builds the embedded Chili3D CAD workstation
PORT=3000 ORIGIN=https://your-host bun run build/index.js
```

`ORIGIN` must be set to the public URL the browser uses (scheme + host + port) so that
form actions and the CAD `postMessage` bridge accept requests; a mismatch blocks those
interactions. Place the server behind HTTPS for any non-local use.

The repository is self-contained — the embedded CAD's complete source ships under
`vendor/chili3d`, so deployment needs no access to external code hosting.

> 💡 **Hint**
> For evaluation, `bun run dev` starts a development server (default port 5173) with the same
> feature set. Open `/cad` to reach the restoration workstation directly.

## 3.2 Data directory

The database and all order files (imported scans, exported designs) live in the server data
directory (`CDX_DATA_DIR`, default `./data`). Back it up as a whole; the directory is portable
and may be moved to a new server to preserve every order and design.

## 3.3 Browser requirements

A desktop browser with **WebGL 2** is required — the CAD workstation will not render
otherwise. A display of 1600 × 900 or larger and a mouse with a wheel and middle button are
recommended for comfortable navigation. See chapter 8 for full requirements.

## 3.4 First run and login

On first start, create the initial account (or sign in with credentials provisioned by an
administrator). Accounts and authentication are shared with the coDiagnostiX Web application in
the same deployment. After signing in, open the **`/cad`** route to load the restoration
workstation.

## 3.5 Optional AI-segmentation credentials

AI tooth segmentation of intraoral scans calls an external vendor model. Configure it through
the server environment before starting the server:

| Variable | Purpose | Default |
|----------|---------|---------|
| `CDX_AISEG_URL` | Base URL of the segmentation backend | `https://pbapi.becertain.ai` |
| `CDX_AISEG_EMAIL` | Account e-mail for the backend | _(unset)_ |
| `CDX_AISEG_PASSWORD` | Account password for the backend | _(unset)_ |

The backend is read from the server process, so set these before launching the server. When
credentials are not configured, AI auto-tagging is unavailable; scans can still be imported and
labelled manually.

> ⚠️ **Caution**
> The segmentation backend receives the scan geometry you submit. Do not enable it for data you
> are not permitted to send to an external endpoint.
