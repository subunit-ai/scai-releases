# SCAI — Releases

Installer für **SCAI (Subunit Corporate AI)** und der Feed für den In-App-Auto-Updater (`latest.json`).
Der Quellcode liegt im privaten Repo `subunit-ai/subunit-scai`; hier landen nur Binaries.
Release-Builds aktivieren das Cargo-Feature `local-meet` auf **macOS Apple Silicon,
Windows x64 und Windows ARM64**. Dort sind lokale Meeting-Aufzeichnung,
Sprechertrennung und (unter Windows) Systemaudio in den ausgelieferten Paketen enthalten.
macOS Intel und Linux enthalten das vollständige Meet-Plugin mit Cloud-Meeting,
Bibliothek, Atlas-Anbindung und Legacy-Protokollimport; die native lokale Engine meldet
auf diesen Targets über denselben stabilen IPC-Vertrag explizit `built=false`.

Grund für die Target-Grenze: `ort`/ONNX Runtime stellt keine passende vorgebaute
x86_64-macOS-Runtime bereit. Das aktuelle Linux-Archiv referenziert glibc-2.38/C23-
Symbole, während unser kompatibler Ubuntu-22.04-Release glibc 2.35 verwendet. Die
Pipeline baut deshalb keine nicht startfähigen oder nur auf neuen Distributionen
laufenden Pakete.
Für Windows ARM64 baut die Pipeline die nativen whisper.cpp/ggml-Anteile mit
ClangCL + Ninja und aktiviert die von ggml benötigte C++-Exception-Semantik;
Rust/Tauri bleiben dabei auf `aarch64-pc-windows-msvc`.

## Download
- **macOS (Apple Silicon):** `SCAI_x.y.z_aarch64.dmg`
- **Windows x64:** `SCAI_x.y.z_x64-setup.exe`
- **Windows ARM64:** `SCAI_x.y.z_arm64-setup.exe`

Die App hält sich danach selbst aktuell (Einstellungen → Updates).

## Fleet-Release-Vertrag

`fleet/manifests/` enthält die unveränderlichen Kandidaten-Pins über alle
SCAI-Dienste. Ein Manifest darf erst `status: pass` tragen, wenn sowohl A1–A8
als auch die Marktnachweise R0–R3, getrennt verifizierte Updater- und native
Plattformsignaturen, SBOM-Digests/Provenance,
Governance-Freigaben und Betriebsdrills maschinell vollständig belegt sind.

```bash
node scripts/verify-fleet-manifest.mjs
node --test scripts/verify-fleet-manifest.test.mjs
node scripts/verify-release-workflow.mjs
node --test scripts/verify-release-workflow.test.mjs scripts/merge-cyclonedx.test.mjs
node scripts/verify-readiness-evidence.mjs fleet/evidence/operations-template.json fleet/evidence/market-template.json
```
