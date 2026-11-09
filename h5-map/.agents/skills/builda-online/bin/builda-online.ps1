$ErrorActionPreference = "Stop"

$ScriptPath = Join-Path $PSScriptRoot "builda-online.py"
$InstallationPath = Join-Path (Split-Path $PSScriptRoot -Parent) "installation.json"

if (Test-Path -LiteralPath $InstallationPath -PathType Leaf) {
    try {
        $Installation = Get-Content -LiteralPath $InstallationPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "Unable to read .builda-online/installation.json. Reinstall Builda Online."
    }
    if ($Installation.pythonInterpreter) {
        if (!($Installation.pythonInterpreter -is [string]) -or ![System.IO.Path]::IsPathRooted($Installation.pythonInterpreter)) {
            throw "The recorded Python interpreter path is invalid. Reinstall Builda Online."
        }
        if (!(Test-Path -LiteralPath $Installation.pythonInterpreter -PathType Leaf)) {
            throw "The recorded Python interpreter is unavailable. Reinstall Builda Online."
        }
        $env:BUILDA_ONLINE_PYTHON_SOURCE = "installation"
        & $Installation.pythonInterpreter $ScriptPath @args
        exit $LASTEXITCODE
    }
}

$Python = Get-Command python3 -ErrorAction SilentlyContinue
if ($Python) {
    $env:BUILDA_ONLINE_PYTHON_SOURCE = "python3"
    & $Python.Source $ScriptPath @args
    exit $LASTEXITCODE
}

$Python = Get-Command python -ErrorAction SilentlyContinue
if ($Python) {
    $env:BUILDA_ONLINE_PYTHON_SOURCE = "python"
    & $Python.Source $ScriptPath @args
    exit $LASTEXITCODE
}

$PythonLauncher = Get-Command py -ErrorAction SilentlyContinue
if ($PythonLauncher) {
    $env:BUILDA_ONLINE_PYTHON_SOURCE = "py"
    & $PythonLauncher.Source -3 $ScriptPath @args
    exit $LASTEXITCODE
}

throw "Builda Online requires Python 3. Reinstall it with an available Python 3 interpreter."
