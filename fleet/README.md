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
7. Die technische Updater-Linie darf `build-all.yml` nur bei explizitem
   `publish_update=true` nach vollständiger Plattformmatrix, Runtime-, Signatur-,
   SBOM-, Provenance- und Digestprüfung veröffentlichen. Zusätzlich müssen der
   aktuelle Source-main, der Source-Tag und `latest.json.source_sha` exakt den
   gebauten SHA tragen; ältere parallele Builds bleiben Draft.
8. Die getrennte Fleet-Promotion läuft ausschließlich über `publish-approved.yml`.
   Sie prüft zusätzlich Manifest-PASS, Manifest-Digest, Release-Contract-Drift,
   Release-ID, Source-SHA und sämtliche Asset-Digests.

## Unveränderliche Genehmigung der veröffentlichten Dateien

Ein neues PASS-Manifest braucht `authorized_release` mit exakt `repository`,
`tag`, `distribution_policy` und `assets`. Jeder Asseteintrag enthält exakt
`name`, die vollständige versionsgebundene GitHub-Download-`url` und `sha256`.
Die bestehende Fünf-Ziel-Buildlane liefert 26 Dateien: sechs Updater-Payloads
mit ihren sechs `.sig`, zwei macOS-DMGs, fünf Runtime- und vier Signing-Belege,
`latest.json`, `scai.cdx.json` und `SHA256SUMS`. Alle 26 Hashes, einschließlich
des Hashs von `SHA256SUMS` selbst, werden **vor** dem separat bestätigten
Manifest-Digest eingetragen. Neue Assettypen brauchen einen neuen geprüften
Release-Contract; eine zusätzliche beliebige Datei wird nicht still mitpubliziert.

Der Prüfer vergleicht auch die fünf bestehenden Installer-/SBOM-Einträge mit
diesem Inventar. Policy, Source und Fleet-ID müssen eindeutig im Draft stehen;
URLs müssen exakt Repository, Tag und Dateiname treffen. Die REST-Digests des
Drafts werden vor dem Download und direkt vor Veröffentlichung erneut mit dem
genehmigten Inventar verglichen. Fehlende REST-Digests blockieren geschlossen.
Die heruntergeladenen Dateien werden ohne Symlinks/Unterverzeichnisse gestreamt
gehasht. Erst danach darf das ebenfalls gebundene `SHA256SUMS` ausgewertet werden.
Ein selbstkonsistentes, aber ausgetauschtes Paar aus Installer und Checksums
ist dadurch keine Genehmigung. Elf exakte Updater-Keys, Source/Version, Payload-
URLs und zugehörige Signaturdateien sowie die Policy der Signing-Belege werden
zusätzlich abgeglichen.

Die tatsächlichen bestehenden Policywerte heißen `market-ready` und
`legacy-v0.125`. Das Genehmigungsformat unterstützt beide, lockert aber **keine**
bestehenden Fleet-, Market-, Legal-, Signatur- oder Provenance-Gates. Hashbindung
ist keine neue kryptografische Signaturprüfung; die vorhandenen verifizierten
Nachweise bleiben Voraussetzung. Insbesondere entsteht daraus keine pauschale
Fleet-PASS-Freigabe für die technisch getrennte Legacy-Updater-Lane.
Historische Nicht-PASS-Manifeste ohne `authorized_release` bleiben lesbar.

Isoliert prüfen: `node --test scripts/verify-approved-release.test.mjs`.
Der CLI unterscheidet ausdrücklich `remote-metadata-only` von der vollständigen
lokalen Byteprüfung `approved-release-bytes`; er veröffentlicht nichts.

Der private PR-Check führt vorhandene `scripts/plugins/deploy.test.mjs` separat
im Confidential-Runner aus, weil `bun test src/lib` diese Node-Suite nicht findet.
Alte Source-Refs ohne diese Suite bleiben kompatibel. Die Suite ersetzt alle
Build-, Signier-, Push-, Sync- und SSH-Aktionen durch isolierte Test-Doubles.

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
