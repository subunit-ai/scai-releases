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

## Aktueller Fleet-Status (2026-09-02)

Der historische `scai-candidate-2026-08-24.1` pinnt SCAI `0.126.0` und ist über
[PR #29](https://github.com/subunit-ai/scai-releases/pull/29), Merge
`291ea267b57585db5c4bee9c458617faf1d426a3`, als `superseded` markiert. Seine Evidenz bleibt
auditierbar, darf aber nicht auf die aktuelle Produktlinie übertragen werden.

SCAI `0.139.0` ist weiterhin der aktuelle öffentliche technische Desktop-Release. Der neueste
reproduzierbare Stand `0.146.0` bleibt dagegen bewusst ein **unveröffentlichter Draft**. Er bindet
Source `96971a1784397daaae8b7dfcf20b9c4cae98b9d2` an
`scai-candidate-2026-09-02.7`. Build
[`33580984759`](https://github.com/subunit-ai/scai-releases/actions/runs/33580984759) ist über
macOS Apple Silicon/Intel, Windows ARM64/x64, Linux x64 und den abschließenden Signatur-, SBOM-
und Provenance-Job vollständig grün. Der Draft enthält 26 allowlistete Assets, 25 mit GitHubs
Asset-Digests deckungsgleiche `SHA256SUMS`-Einträge, fünf aus den gepackten Produkten erzeugte
Runtime-Evidenzen, vier Signing-Evidenzen und elf Updater-Ziele.

Fleet-Lauf [`33580986805`](https://github.com/subunit-ai/scai-releases/actions/runs/33580986805)
bestand im zweiten Versuch die exakten Main-SHAs von u1-chat, Atlas, subunit-auth und Echo. Der
erste Atlas-Versuch bleibt als fehlgeschlagener isolierter Testlauf auditierbar. Das Manifest
`fleet/manifests/scai-candidate-2026-09-02.7.json` bleibt fail-closed auf `status: candidate`:
A1–A6 sind Kandidatenbelege, A7/A8 sowie R0–R3 bleiben offen.

Die technische Distribution nutzt bewusst `legacy-v0.125`: macOS ist
Apple-Development-signiert, aber nicht notarisiert/Gatekeeper-freigegeben; Windows besitzt noch
kein Authenticode-Zertifikat. Signing folgt nach dem Handelsregisterauszug. Deshalb ist
`0.146.0` ein reproduzierbarer G1-Fleet-Candidate, aber kein `market-ready`-Nachweis und kein
Ersatz für Legal/DPO, unabhängigen Operations-/Recovery-/Rollback-Judge oder drei vergleichbare
zahlende Kunden. Kein privater Quellcode wurde veröffentlicht.
