# Genera dist\GACash.apk, il guscio Android che apre l'app pubblicata su GitHub Pages.
# Va rilanciato solo quando cambia la parte Android; le modifiche all'app web basta pubblicarle.
# Uso:  powershell -ExecutionPolicy Bypass -File android\build.ps1
# Richiede JDK e Android SDK in C:\Users\gavossa\android-build (vedi $tools).
# Con -Release pubblica anche l'APK come nuova release su GitHub: l'app sul telefono la trova
# da sola e propone l'aggiornamento. Prima aumenta il numero in android\version.txt.
param([string]$tools = 'C:\Users\gavossa\android-build', [switch]$Release)

$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $PSScriptRoot 'build'
$bt = "$tools\sdk\build-tools\34.0.0"
$androidJar = "$tools\sdk\platforms\android-34\android.jar"
$env:JAVA_HOME = "$tools\jdk"
$env:Path = "$tools\jdk\bin;$env:Path"

# Chiave con cui l'APK viene firmato. Va conservata: Android accetta un aggiornamento solo se è
# firmato con la stessa chiave, altrimenti bisogna disinstallare l'app (perdendo i dati).
# Chiave e password (keystore.properties) restano fuori dal repository, vedi .gitignore.
$keystore = Join-Path $PSScriptRoot 'gacash.keystore'
$props = Join-Path $PSScriptRoot 'keystore.properties'
if (-not (Test-Path $props)) {
  "storePassword=$([guid]::NewGuid().ToString('N'))" | Set-Content $props -Encoding ascii
}
$storePass = (@(Get-Content $props) -match '^storePassword=' | Select-Object -First 1).Substring('storePassword='.Length).Trim()

function Step($name, [scriptblock]$cmd) {
  Write-Host "== $name"
  & $cmd
  if ($LASTEXITCODE) { throw "$name non riuscito (codice $LASTEXITCODE)" }
}

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force "$out\res\mipmap-xxxhdpi", "$out\gen", "$out\classes", (Join-Path $root 'dist') | Out-Null

# L'APK contiene solo il guscio: l'app web la carica da GitHub Pages (vedi MainActivity.java).
Copy-Item "$root\icons\icon-192.png" "$out\res\mipmap-xxxhdpi\ic_launcher.png"
Copy-Item "$PSScriptRoot\res\*" "$out\res" -Recurse -Force   # risorse fisse (es. regole del backup)

# Versione dell'APK da android\version.txt (es. 1.1). Il codice interno parte da 1.000.000 perché
# deve superare quello delle prime build (basato sulla data): Android rifiuta i codici più bassi.
$versionName = (Get-Content "$PSScriptRoot\version.txt" -TotalCount 1).Trim()
$major, $minor = $versionName.Split('.') | ForEach-Object { [int]$_ }
$versionCode = 1000000 + $major * 1000 + $minor

if (-not (Test-Path $keystore)) {
  Step 'Creazione chiave di firma' {
    keytool -genkeypair -keystore $keystore -storepass $storePass -keypass $storePass -alias ga `
      -keyalg RSA -keysize 2048 -validity 20000 -dname 'CN=GACash'
  }
}

Step 'Risorse' { & "$bt\aapt2.exe" compile --dir "$out\res" -o "$out\res.zip" }
Step 'Pacchetto' {
  & "$bt\aapt2.exe" link -o "$out\app.unsigned.apk" -I $androidJar --manifest "$PSScriptRoot\AndroidManifest.xml" `
    --java "$out\gen" --min-sdk-version 29 --target-sdk-version 34 `
    --version-code $versionCode --version-name $versionName "$out\res.zip"
}
$sources = Get-ChildItem "$PSScriptRoot\src", "$out\gen" -Recurse -Filter *.java | ForEach-Object FullName
Step 'Compilazione Java' { javac --release 11 -encoding UTF-8 -Xlint:-options -cp $androidJar -d "$out\classes" $sources }
Step 'Jar' { jar cf "$out\classes.jar" -C "$out\classes" . }
Step 'Dex' { & "$bt\d8.bat" --lib $androidJar --min-api 29 --output $out "$out\classes.jar" }
Push-Location $out
try { Step 'Aggiunta codice' { & "$bt\aapt.exe" add app.unsigned.apk classes.dex | Out-Null } } finally { Pop-Location }
Step 'Allineamento' { & "$bt\zipalign.exe" -f -p 4 "$out\app.unsigned.apk" "$out\app.aligned.apk" }
$apk = Join-Path $root 'dist\GACash.apk'
Step 'Firma' {
  & "$bt\apksigner.bat" sign --ks $keystore --ks-pass "pass:$storePass" --ks-key-alias ga --out $apk "$out\app.aligned.apk"
}
Step 'Verifica' { & "$bt\apksigner.bat" verify $apk }
Remove-Item "$apk.idsig" -ErrorAction SilentlyContinue   # sottoprodotto della firma, non serve per installare

"APK pronto: $apk  ($([math]::Round((Get-Item $apk).Length / 1KB)) KB, versione $versionName)"

if ($Release) {
  $gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
  if (-not $gh) { $gh = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe\bin\gh.exe" }
  Step 'Pubblicazione su GitHub' {
    & $gh release create "v$versionName" $apk --repo Gavao/gacash --title "GACash $versionName" `
      --notes "Aggiornamento del guscio Android. Dall'app: avviso nella schermata iniziale, tocca Aggiorna."
  }
}
