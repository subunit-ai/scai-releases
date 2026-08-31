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

## Aktueller Fleet-Status (2026-08-31)

Der historische `scai-candidate-2026-08-24.1` pinnt SCAI `0.126.0` und ist über
[PR #29](https://github.com/subunit-ai/scai-releases/pull/29), Merge
`291ea267b57585db5c4bee9c458617faf1d426a3`, als `superseded` markiert. Seine Evidenz bleibt
auditierbar, darf aber nicht auf die aktuelle Produktlinie übertragen werden.

SCAI `0.138.0` ist der aktuelle öffentliche technische Desktop-Release. Er bindet den Quell-SHA
`14eacdf5cccc726f19ba58553da103580a541244` an die Fleet-ID
`scai-candidate-2026-08-31.7`; Build-Lauf
[`33436306279`](https://github.com/subunit-ai/scai-releases/actions/runs/33436306279) ist über die
vollständige Matrix macOS Apple Silicon/Intel, Windows ARM64/x64, Linux x64 und den abschließenden
Signatur-, SBOM- und Provenance-Job grün. Der öffentliche Release enthält 21 Artefakte,
20 deckungsgleiche `SHA256SUMS`-Einträge, 11 Updater-Ziele und sechs gültige
Updater-Signaturen.

Die Veröffentlichung läuft bewusst unter `legacy-v0.125`: macOS ist Apple-Development-signiert,
aber nicht notarisiert/Gatekeeper-freigegeben; Windows besitzt noch kein Authenticode-Zertifikat.
Damit ist `0.138.0` ein funktionaler Desktop-Release, aber kein `market-ready`-Nachweis und kein
Ersatz für Legal/DPO, Operations oder R0–R3. Die überholten beziehungsweise fehlerhaften Stände
`0.131.0` bis `0.137.0` bleiben als nicht öffentliche Drafts auditierbar; nichts wurde gelöscht.
