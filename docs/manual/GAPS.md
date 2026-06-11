# Adaptations and known limitations

Differences between the original desktop product's documented functionality and this web
re-implementation, as discovered while writing the manual. Items here are either deliberate
adaptations (different platform, same job) or logged limitations.

## Deliberate adaptations (equivalent exists, different shape)

| Original | Our equivalent | Note |
|----------|----------------|------|
| Desktop installation, dongle licensing | Server deployment + account tiers/credits | Ch. 2.10, 11.5 |
| caseXchange communication platform | Contacts + transfers + inbox + orders | Ch. 7.2 |
| DWOS Synergy live CAD link | Order-package import + plan send (file-based, not live session) | Ch. 7.2; live socket sync not replicated — rule-based file exchange covers the documented workflow |
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
| AI segmentation quality | Heuristic (threshold + morphology), clearly labelled "offline heuristic" | A trained model is out of scope; the heuristic produces reviewable bone/teeth/soft-tissue models and the review dialog rejects empty results |
| Automatic nerve detection robustness | Path-search based (low-HU corridor A*) | Works on clear canals; degrades on noisy data — exactly why the mandatory verify-manually caution exists |
| Live two-way CAD session (Synergy) | Not replicated | File-based exchange documented in ch. 7.2 covers send/receive of design data |
| Scan-template (radiographic template) double-scan calibration markers | Generic dual-scan + marker-free ICP only | Marker-based registration of template scans not implemented; point-pair + ICP achieves the documented outcome on the demo data |
