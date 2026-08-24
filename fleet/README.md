# SCAI Fleet Release

Dieses Verzeichnis ist das gemeinsame Release-Tor über die SCAI-App und ihre
Backend-Dienste. Ein Kandidat pinnt jeden Quellstand mit einem vollständigen
Git-SHA. Einzelne grüne Branches oder PRs ergeben ausdrücklich noch keinen
Produktionsrelease.

## Statusmodell

- `candidate`: technisch zusammengesetzter Stand; offene Nachweise sind erlaubt
  und müssen unter `blockers` benannt sein.
- `pass`: A1–A8 und R0–R3 sind auf demselben `release_id` bestanden; alle
  Komponenten sind gemergt; CI, verifizierte Updater-Signaturen, native
  macOS-/Windows-Code-Signaturen, SBOM-Digests und verifizierte Provenance,
  Legal/DPO-Freigabe, unabhängiges Urteil sowie Health-/Recovery-Drills sind
  mit gepinnter HTTPS-Evidenz und SHA-256 belegt. Linux markiert native
  Plattformsignatur ausdrücklich als `not_applicable`; die Updater-Signatur
  bleibt trotzdem Pflicht.
- `rejected`: Kandidat wurde verworfen und darf nicht veröffentlicht werden.

Der Validator prüft die für `pass` geltenden Regeln zusätzlich zum JSON-Schema
fail-closed. Er veröffentlicht, taggt, merged oder deployt nichts.

## Ablauf

1. Manifest als `candidate` mit vollen SHAs anlegen.
2. `node scripts/verify-fleet-manifest.mjs` und die Tests ausführen.
3. Evidenz nur nach realer Verifikation ergänzen; keine geplanten Resultate als
   bestanden markieren.
   Updater-Signatur und Betriebssystem-Code-Signing sind getrennte Nachweise.
4. Erst nach allen internen und externen Nachweisen auf `pass` umstellen.
5. Ein separater, autorisierter Release-Prozess darf anschließend den exakt
   gepinnten Stand bauen und ausrollen. `build-all.yml` nimmt dafür einen
   vollständigen `source_sha`, hält alle Assets bis zum letzten Gate in einem
   Draft und veröffentlicht erst nach nativer Signatur-, Updater-Signatur-,
   SBOM- und Sigstore-Provenance-Verifikation.
