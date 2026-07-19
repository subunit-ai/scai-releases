#!/usr/bin/env python3
"""
assemble-latest-json.py — baut EIN vollständiges latest.json für den Tauri-Updater
aus allen .sig-Assets eines Release.

WARUM: Die Plattform-Builds laufen als parallele Matrix-Jobs, jeder mit
tauri-actions `includeUpdaterJson: true`. Jeder Job liest das (evtl. leere)
latest.json des Release, hängt SEINE Plattform an und lädt es wieder hoch —
ohne Lock. Bei parallelem Lauf gewinnt der letzte Upload und überschreibt die
Einträge der anderen. Ergebnis: ein Manifest mit nur 1-2 Plattformen, der Rest
(z.B. darwin-aarch64 = Apple Silicon) fehlt und diese Nutzer bekommen NIE ein
Update angeboten. (Eingetreten bei v0.40.0: es fehlten darwin-aarch64, Linux und
windows-x86_64.)

FIX: Dieser Job läuft NACH allen Builds (needs: build), liest ALLE .sig-Assets des
Release und baut daraus deterministisch EIN vollständiges Manifest — ein einziger
Upload, kein Race. Der Signatur-Wert im Manifest ist der wortwörtliche Inhalt der
.sig-Datei (base64-kodierter minisign-Blob), genau wie tauri-action ihn erzeugt.

Aufruf:
  assemble-latest-json.py <sig-dir> <version> <base-url> <notes> [out]
"""
import json
import os
import sys
from datetime import datetime, timezone

# Alle Ziele, die ein vollständiger Release bedienen SOLL. Fehlt eines im Manifest
# (weil sein Build fehlschlug → keine .sig), wird das laut protokolliert, statt es
# still zu verschlucken (Regel: keine stillen Lücken).
CANONICAL = ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64", "windows-aarch64"]


def keys_for(artifact: str) -> list[str]:
    """Artefakt-Dateiname (ohne .sig) → Updater-Plattform-Schlüssel.

    Je Ziel zwei Schlüssel (kurzes + langes Namensschema), damit sowohl ältere als
    auch neuere Tauri-Updater-Clients bedient werden — exakt das Schema, das
    tauri-action selbst schreibt.
    """
    if artifact == "SCAI_aarch64.app.tar.gz":
        return ["darwin-aarch64", "darwin-aarch64-app"]
    if artifact == "SCAI_x64.app.tar.gz":
        return ["darwin-x86_64", "darwin-x86_64-app"]
    if artifact.endswith("_amd64.AppImage"):
        return ["linux-x86_64", "linux-x86_64-appimage"]
    if artifact.endswith("_amd64.deb"):
        return ["linux-x86_64-deb"]
    if artifact.endswith("_x64-setup.exe"):
        return ["windows-x86_64", "windows-x86_64-nsis"]
    if artifact.endswith("_arm64-setup.exe"):
        return ["windows-aarch64", "windows-aarch64-nsis"]
    return []


def main() -> int:
    if len(sys.argv) < 5:
        print(__doc__)
        return 2
    sig_dir, version, base_url, notes = sys.argv[1:5]
    out = sys.argv[5] if len(sys.argv) > 5 else "latest.json"

    platforms: dict[str, dict[str, str]] = {}
    for fn in sorted(os.listdir(sig_dir)):
        if not fn.endswith(".sig"):
            continue
        artifact = fn[:-4]  # ".sig" ab
        keys = keys_for(artifact)
        if not keys:
            print(f"  · übersprungen (kein Updater-Ziel): {artifact}")
            continue
        sig = open(os.path.join(sig_dir, fn), encoding="utf-8").read().strip()
        if not sig:
            print(f"::warning::leere Signatur in {fn} — übersprungen")
            continue
        for k in keys:
            platforms[k] = {"signature": sig, "url": f"{base_url}/{artifact}"}

    if not platforms:
        print("::error::Keine gültigen .sig-Assets gefunden — Manifest wäre leer, Abbruch.", file=sys.stderr)
        return 1

    # Sichtbarkeit: welche kanonischen Ziele sind da, welche fehlen (Build-Fehler)?
    present = [t for t in CANONICAL if t in platforms]
    missing = [t for t in CANONICAL if t not in platforms]
    for t in missing:
        print(f"::warning::Ziel {t} fehlt im Manifest — dessen Build lieferte keine Signatur.")
    print(f"→ Ziele im Manifest: {', '.join(present)}" + (f" | FEHLT: {', '.join(missing)}" if missing else " (vollständig)"))

    manifest = {
        "version": version,
        "notes": notes,
        "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "platforms": platforms,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"latest.json geschrieben: {len(platforms)} Plattform-Einträge → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
