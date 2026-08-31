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
- `superseded`: Kandidat bleibt als historische Evidenz erhalten, repräsentiert aber wegen
  eines neueren Source-Stands nicht mehr die aktive Release-Linie. `supersession` bindet
  Zeitpunkt, neuen Source-SHA und Grund. Dieser Status ist niemals veröffentlichbar.

Der Validator prüft die für `pass` geltenden Regeln zusätzlich zum JSON-Schema
fail-closed. Er veröffentlicht, taggt, merged oder deployt nichts.

## Ablauf

1. Manifest erst nach bestandenem Candidate-Entry-Gate als `candidate` mit vollen SHAs anlegen.
   Ein neuer Source-Snapshot ohne vollständigen Plattformbeleg bleibt außerhalb der Fleet-
   Kandidatenliste; er darf nicht durch Umbenennen des Vorgängers Evidenz erben.
2. `node scripts/verify-fleet-manifest.mjs` und die Tests ausführen.
3. Evidenz nur nach realer Verifikation ergänzen; keine geplanten Resultate als
   bestanden markieren.
   Updater-Signatur und Betriebssystem-Code-Signing sind getrennte Nachweise.
4. Nach technischer Freigabe baut `build-all.yml` den vollständigen `source_sha`
   für die zugehörige `release_id`. Noch vor Source-Checkout und Draft-Erzeugung
   verweigert der Secret-Preflight einen unvollständig signierbaren Lauf und
   nennt ausschließlich fehlende Secret-Namen. Danach verifiziert der Workflow native Signaturen,
   Updater-Signaturen, SBOM und Sigstore-Provenance und lässt sämtliche Assets
   bewusst als Draft stehen.
5. Autorisierte Betriebsdrills können exakt diesen Draft verwenden; ihre
   Ergebnisse und alle übrigen internen und externen Nachweise werden erst nach
   realer Verifikation eingetragen.
6. Erst wenn der Validator vollständig grün ist, wird das Manifest auf `pass`
   gesetzt, gemergt und sein SHA-256 separat bestätigt.
7. Nur `publish-approved.yml` darf den gebundenen Draft danach veröffentlichen.
   Es prüft erneut Manifest-PASS, Manifest-Digest, Release-Contract-Drift,
   Release-ID, Source-SHA und sämtliche Asset-Digests. `build-all.yml`
   veröffentlicht niemals selbst.

`release-contract.paths` ist die geschlossene, selbst mitgepinnte Inventarliste
der sicherheitskritischen Workflows, Output-Sinks, Asset-/Manifest-Validatoren
und Evidence-Verträge. Stable-Promotion stoppt, sobald auch nur eine dieser
Dateien vom gemergten `scai_release_contract.sha` abweicht. Änderungen an der
Liste selbst benötigen ebenfalls einen neuen Contract-Pin.

## Evidence-Verträge

- `evidence/operations-template.json` bindet Deploy, Health, Recovery und
  Rollback an denselben Release-/Source-Pin. PASS verlangt Autorisierung,
  Messwerte, RTO-/Datenverlustziele und einen vom Operator getrennten Judge.
- `evidence/market-template.json` bindet R0–R3 ebenfalls an Release-ID und
  vollständigen Source-SHA. PASS verlangt einen qualifizierten Budgetpfad,
  bezahlte Vorher-/Nachher-Diagnose, einen positiven Pilot-Deckungsbeitrag und
  drei verschiedene Käufer desselben Outcomes.
- `evidence/market-attestation-template.json` bindet das unabhängige Urteil an
  den SHA-256 des privaten Marktberichts. Das öffentliche Fleet-Manifest enthält
  nur Report-/Attestation-Digests, Validator und Ergebnis; vertrauliche
  Primärbelege bleiben im kontrollierten Evidence Store.
- `scripts/verify-readiness-evidence.mjs` prüft beide Verträge fail-closed. Die
  Templates bleiben `open`, bis echte autorisierte bzw. externe Evidenz vorliegt.
- `scripts/verify-market-evidence-binding.mjs` beweist vor einer stabilen
  Promotion, dass Manifest, privater Report und unabhängige Attestation exakt
  dieselben Bytes, Pins, R0–R3-Belege und drei wiederholbare zahlende Kunden
  meinen. Technische Drafts bleiben davon getrennt.
