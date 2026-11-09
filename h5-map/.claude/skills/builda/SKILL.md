---
name: builda
description: BuildaGame (Builda) game publishing toolchain - integrate the Builda SDK, debug locally with the mock, export Godot Web / Unity WebGL or package HTML5 builds, and upload/update game drafts.
---

This project has the project-scoped BuildaGame toolchain installed (publishes Godot Web / HTML5 / Unity WebGL games to Builda). The CLI and the base Skill share one version; the SDK version is pinned per project:

1. Full guide (read first): `.builda-agent/SKILL.md` at the project root
SDK tasks must read .builda-agent/sdk-guidance/<sdk-version>/SKILL.md; restore missing dependencies per the base Skill, and reread it after upgrading.
2. At the start of every task run `./.builda-agent/builda check` (aligns the toolchain version automatically and reports whether the SDK needs syncing)

If these files are missing (e.g. right after cloning this repo), reinstall from the project root:

```bash
curl -fsSL https://ai.builda.game/agent/install.sh | bash
```

Windows (download to a file; never `iwr | iex`):

```powershell
$p = Join-Path $env:TEMP "builda-install.ps1"; iwr https://ai.builda.game/agent/install.ps1 -UseBasicParsing -OutFile $p; & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $p; Remove-Item -Force $p -ErrorAction SilentlyContinue
```
