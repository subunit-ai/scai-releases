# .u1 — Subunit Project Standard

Dieses Repo ist die öffentliche Build- und Download-Schiene des privaten SPS-Projekts
**subunit-scai**. Die kanonischen Projektdateien liegen zentral im u1-brain:

- Vision: `workspace/starts/subunit-scai.md`
- Handoff: `workspace/handoffs/subunit-scai.md`
- Register: `workspace/PROJECTS.md`
- Standard: `workspace/docs/subunit-project-standard.md`

Lesen (Mac): `cat ~/subunit/u1-brain/workspace/starts/subunit-scai.md`

Rolle dieses Repos: öffentliche, manuell ausgelöste CI für PR-Prüfungen sowie
versionierte macOS-, Windows-x64-, Windows-ARM64- und Linux-Release-Artefakte. Der
private Quellcode bleibt in `subunit-scai`; Workflows greifen nur über den
read-only Deploy-Key darauf zu.

Regeln:

1. Kein Quellcode und keine Secrets in Logs oder Artefakte schreiben.
2. Smoke-Workflows erzeugen weder Releases noch Uploads.
3. Release-Workflows nur mit einem verifizierten Quell-Ref auslösen.
4. Den Stand nach Änderungen im Handoff `subunit-scai.md` dokumentieren.
