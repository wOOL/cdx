# Adaptations and known limitations

Differences between the original desktop product's documented functionality and this web
re-implementation, as discovered while writing the manual. Items here are either deliberate
adaptations (different platform, same job) or logged limitations.

## Deliberate adaptations (equivalent exists, different shape)

| Original | Our equivalent | Note |
|----------|----------------|------|
| Desktop installation, dongle licensing | Server deployment + account tiers/credits | Ch. 2.10, 11.5 |
| caseXchange communication platform | Contacts + transfers + inbox + orders | Ch. 7.2 |
| DWOS Synergy live CAD link | **Embedded CAD workstation (`/cad`, Chili3D pinned 0.6.1, AGPL) with a live same-session bridge**: anatomy → CAD, design → case in one click | Ch. 7.2; supersedes the earlier file-only adaptation |
| coPeriodontiX module | Built-in periodontal chart dialog (6 directions/tooth, severity colors, CSV) | Ch. 7.1; values entered from measurements rather than a dedicated CEJ point-pair picker |
| Remote support session from Help Center | F1 help + issue tracker | Ch. 10; no remote-desktop integration |
| Update notification bar | Server-side deployment; browser reload | Ch. 9 |
| iPad presentation app | Read-only plan share links | Plan menu → Share read-only link |
| Printed label / UDI symbols | About dialog as identification + UI-symbol legend | Ch. 11.3, 12 |
| Training webinars / videos | Onboarding tour + manual + F1 help | Ch. 3.1 |

## Closed after coverage audit (2026-06-11)

A page-by-page audit against the 88-page reference identified seven topic gaps and four
figure gaps; all were closed: bone-reduction profile workflow (§6.6 + bars-from-implants
proposal feature + figure), combination/stacked guide procedure (§6.6 + converted-base
support in the app + figure), endodontic straight-path caution (§6.5), inspection-window
stability caution (§6.6), tooth-transplant steps with gingivectomy/orthognathic mentions
(§6.6 + figure), scan-preparation details (§11.4), edentulous registration hint (§6.4),
in-view measurement examples figure (§7.3).

## Logged limitations (not fully replicated)

| Item | Status | Why / mitigation |
|------|--------|------------------|
| AI segmentation quality | **Closed** — real vendor multi-class CBCT model (jawbones, 32 teeth, inferior alveolar canals, sinuses, pharynx, crowns/bridges/implants) behind the async-job + review-dialog contract; soft tissue added locally (threshold, as agreed); local heuristic remains the no-backend fallback | Real-data segmentation *quality* validation pending — synthetic phantom only proves the pipeline (auth, voxel-aligned labelmap, per-class meshing, ~45 s inference) |
| Automatic nerve detection robustness | Path-search A* fallback; **the vendor AI model also segments the inferior alveolar canals** directly when configured | Either path is a verify-on-every-slice aid; the model supersedes A* where available |
| Live two-way CAD session (Synergy) | **Closed** — embedded Chili3D at `/cad` with postMessage bridge (load anatomy, return design); regression scripts/test-cad-bridge.ts | Both applications share one browser session and one backend |
| Scan-template (radiographic template) double-scan calibration markers | **Closed** — automatic marker detection (spheres + gutta-percha blobs, artifact rejection) with RANSAC correspondence and review dialog (§6.4); synthetic validation 0.011–0.021 mm RMS (scripts/test-template-match.ts) | Real-data validation pending — clinical dual-scan pairs requested from the project owner |
