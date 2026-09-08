# .u1 — Subunit Project Standard

Dieses Repo ist die öffentliche Build- und Download-Schiene des privaten SPS-Projekts
**subunit-scai**. Die kanonischen Projektdateien liegen zentral im u1-brain:

- Vision: `workspace/starts/subunit-scai.md`
- Handoff: `workspace/handoffs/subunit-scai.md`
- Register: `workspace/PROJECTS.md`
- Standard: `workspace/docs/subunit-project-standard.md`

Lesen (Mac): `cat ~/subunit/u1-brain/workspace/starts/subunit-scai.md`

Rolle dieses Repos: öffentliche, manuell ausgelöste und releasegebundene CI für
PR-/Fleet-Prüfungen sowie versionierte macOS-, Windows-x64-, Windows-ARM64- und
Linux-Release-Artefakte. Der private Quellcode bleibt in `subunit-scai`,
`u1-chat`, `atlas`, `subunit-auth` und `echo`; Workflows greifen nur über je Repo
getrennte read-only Deploy-Keys auf vollständige Kandidaten-SHAs zu.

Regeln:

1. Kein Quellcode und keine Secrets in Logs oder Artefakte schreiben.
2. Smoke-Workflows erzeugen weder Releases noch Uploads.
3. Release-Workflows nur mit verifizierten vollständigen Quell-SHAs auslösen.
4. Den Stand nach Änderungen im Handoff `subunit-scai.md` dokumentieren.

## Aktueller Fleet-Status (2026-09-08)

Der historische `scai-candidate-2026-08-24.1` pinnt SCAI `0.126.0` und ist über
[PR #29](https://github.com/subunit-ai/scai-releases/pull/29), Merge
`291ea267b57585db5c4bee9c458617faf1d426a3`, als `superseded` markiert. Seine Evidenz bleibt
auditierbar, darf aber nicht auf die aktuelle Produktlinie übertragen werden.

Der aktuelle öffentliche technische Desktop-Release ist SCAI `0.150.0`. Er bindet Source
`e5be3a97c47524868ccba1dafec43d257e544320` und den Release-Vertrag `5e7a14f…` an die bereits im
Release-Body festgeschriebene ID `scai-candidate-2026-09-07.1`. Build
[`34103013195`](https://github.com/subunit-ai/scai-releases/actions/runs/34103013195) ist über
macOS Apple Silicon/Intel, Windows ARM64/x64, Linux x64 und den abschließenden Signatur-, SBOM-
und Provenance-Job vollständig grün. Der Release enthält 26 allowlistete Assets, 25 mit GitHubs
Asset-Digests deckungsgleiche `SHA256SUMS`-Einträge, fünf aus den gepackten Produkten erzeugte
Runtime-Evidenzen, vier Signing-Evidenzen und elf Updater-Ziele. Die Runtime-Evidenzen binden
alle Plattformen an exakt dieselbe private Source-SHA; Source und Rohlogs bleiben privat.

Das Manifest `fleet/manifests/scai-candidate-2026-09-07.1.json` pinnt zusätzlich u1-chat
`80e8ca91…`, Atlas `af282ac0…`, subunit-auth `462a4452…` und Echo `3a72c606…`. Der vertrauliche,
quellcodefreie Fleet-Source-Check auf diesen Pins wird separat ausgeführt und danach als Evidenz
gebunden. Die bisherigen `.6`-bis-`.8`-Kandidaten sind zugunsten des neuen Source-Stands als
`superseded` markiert; ihre Evidenz bleibt unverändert historisch auditierbar.

Die technische Distribution nutzt bewusst `legacy-v0.125`: macOS ist
Apple-Development-signiert, aber nicht notarisiert/Gatekeeper-freigegeben; Windows besitzt noch
kein Authenticode-Zertifikat. Signing folgt nach dem Handelsregisterauszug. Deshalb ist
`0.150.0` ein reproduzierbarer technischer G1-Kandidat, aber kein `market-ready`-Nachweis und kein
Ersatz für Legal/DPO, unabhängigen Operations-/Recovery-/Rollback-Judge oder drei vergleichbare
zahlende Kunden. Kein privater Quellcode wurde veröffentlicht.
