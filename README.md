# SCAI — Releases

Installer für **SCAI (Subunit Corporate AI)** und der Feed für den In-App-Auto-Updater (`latest.json`).
Der Quellcode liegt im privaten Repo `subunit-ai/subunit-scai`; hier landen nur Binaries.
Release-Builds aktivieren verpflichtend das Cargo-Feature `local-meet`, damit lokale
Meeting-Aufzeichnung, Sprechertrennung und Windows-Systemaudio in allen ausgelieferten
SCAI-Paketen enthalten sind.
Für Windows ARM64 baut die Pipeline die nativen whisper.cpp/ggml-Anteile mit
ClangCL + Ninja; Rust/Tauri bleiben dabei auf `aarch64-pc-windows-msvc`.

## Download
- **macOS (Apple Silicon):** `SCAI_x.y.z_aarch64.dmg`
- **Windows x64:** `SCAI_x.y.z_x64-setup.exe`
- **Windows ARM64:** `SCAI_x.y.z_arm64-setup.exe`

Die App hält sich danach selbst aktuell (Einstellungen → Updates).
