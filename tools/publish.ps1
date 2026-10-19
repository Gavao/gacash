# Pubblica le modifiche all'app su GitHub Pages: timbra la versione, fa il commit e il push.
# Il telefono vede la versione nuova in version.txt e si ricarica da solo.
# Uso:  powershell -ExecutionPolicy Bypass -File tools\publish.ps1 "Descrizione delle modifiche"
param([Parameter(Mandatory)][string]$Message)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object Text.UTF8Encoding $false

$version = Get-Date -Format 'yyyy.MM.dd-HHmm'
[IO.File]::WriteAllText("$root\version.txt", "$version`n", $utf8)
[IO.File]::WriteAllText("$root\js\version.js",
  "// Versione dei contenuti dell'app: la aggiorna tools/publish.ps1 a ogni pubblicazione, insieme a version.txt.`nexport const APP_VERSION = '$version';`n", $utf8)

git -C $root add -A
git -C $root commit -q -m $Message
if ($LASTEXITCODE) { throw 'Commit non riuscito' }
git -C $root push -q
if ($LASTEXITCODE) { throw 'Push non riuscito' }
"Pubblicata la versione $version"
