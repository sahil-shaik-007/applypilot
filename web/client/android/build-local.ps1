<#
.SYNOPSIS
  Builds the ApplyPilot Android app on Windows with a self-contained, user-level toolchain.

.DESCRIPTION
  Toolchain lives in %LOCALAPPDATA%\ApplyPilotBuild (no admin rights, no system/user env changes):
    jdk-21\          Microsoft Build of OpenJDK 21
    android-sdk\     Android SDK (cmdline-tools, platform-tools, platforms;android-36, build-tools 35/36)
    gradle-home\     Gradle user home (wrapper distribution + dependency cache)
  JAVA_HOME / ANDROID_HOME / GRADLE_USER_HOME are set for THIS PowerShell process only.

.EXAMPLE
  .\build-local.ps1 -Bootstrap             # first time: download + install the toolchain (~600 MB)
  .\build-local.ps1                        # web build + cap sync + assembleDebug
  .\build-local.ps1 -SkipWeb               # just re-run Gradle
  .\build-local.ps1 -Task bundleRelease    # release AAB (signed if ANDROID_KEYSTORE_PATH etc. are set)
  .\build-local.ps1 -Task "assembleDebug bundleRelease"
  .\build-local.ps1 -Emulator              # also install the emulator + an Android 16 (API 36) image and create AVD "ApplyPilot_API36"
  .\build-local.ps1 -Shell                 # just print the env setup to paste into another shell
#>
[CmdletBinding()]
param(
  [string]$Task = 'assembleDebug',
  [switch]$SkipWeb,
  [switch]$Bootstrap,
  [switch]$Emulator,
  [switch]$Shell,
  [string]$ToolRoot = (Join-Path $env:LOCALAPPDATA 'ApplyPilotBuild')
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is ~10x faster without the progress bar

$AndroidDir = $PSScriptRoot
$ClientDir  = Split-Path $AndroidDir -Parent
$JdkDir     = Join-Path $ToolRoot 'jdk-21'
$SdkDir     = Join-Path $ToolRoot 'android-sdk'
$GradleHome = Join-Path $ToolRoot 'gradle-home'
$DlDir      = Join-Path $ToolRoot 'dl'

# Pinned official download URLs (update together with docs/ANDROID.md).
$JdkUrl  = 'https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip'
$CmdUrl  = 'https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip'
$CmdSha1 = '57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d'
$SdkPackages = @('platform-tools', 'platforms/android-36', 'build-tools/35.0.0', 'build-tools/36.0.0')
$EmuPackages = @('emulator', 'system-images/android-36/google_apis/x86_64')

function Use-Toolchain {
  $env:JAVA_HOME = $JdkDir
  $env:ANDROID_HOME = $SdkDir
  $env:ANDROID_SDK_ROOT = $SdkDir
  $env:GRADLE_USER_HOME = $GradleHome
  $env:Path = "$JdkDir\bin;$SdkDir\platform-tools;$SdkDir\emulator;$SdkDir\cmdline-tools\latest\bin;$env:Path"
}

function Invoke-SdkManager([string[]]$Packages) {
  $sdkm = Join-Path $SdkDir 'cmdline-tools\latest\bin\sdkmanager.bat'
  # Newer cmdline-tools take "a/b/c" package paths; ';' would be split by cmd.exe.
  $answers = ('y' + [Environment]::NewLine) * 30
  $answers | & $sdkm --sdk_root="$SdkDir" @Packages | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "sdkmanager failed ($LASTEXITCODE)" }
}

function Install-Toolchain {
  New-Item -ItemType Directory -Force $ToolRoot, $DlDir | Out-Null
  if (-not (Test-Path "$JdkDir\bin\java.exe")) {
    Write-Host '==> Downloading Microsoft Build of OpenJDK 21'
    $zip = Join-Path $DlDir 'jdk21.zip'
    Invoke-WebRequest $JdkUrl -OutFile $zip
    $tmp = Join-Path $ToolRoot '_jdk'
    Expand-Archive $zip $tmp -Force
    Move-Item (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName $JdkDir
    Remove-Item $tmp -Recurse -Force
  }
  if (-not (Test-Path "$SdkDir\cmdline-tools\latest\bin\sdkmanager.bat")) {
    Write-Host '==> Downloading Android command-line tools'
    $zip = Join-Path $DlDir 'cmdline-tools.zip'
    Invoke-WebRequest $CmdUrl -OutFile $zip
    $sha = (Get-FileHash $zip -Algorithm SHA1).Hash.ToLower()
    if ($sha -ne $CmdSha1) { throw "cmdline-tools checksum mismatch: $sha" }
    $tmp = Join-Path $SdkDir '_ct'
    Expand-Archive $zip $tmp -Force
    New-Item -ItemType Directory -Force "$SdkDir\cmdline-tools" | Out-Null
    Move-Item "$tmp\cmdline-tools" "$SdkDir\cmdline-tools\latest"
    Remove-Item $tmp -Recurse -Force
  }
  Use-Toolchain
  Write-Host '==> Installing SDK packages (licenses accepted non-interactively)'
  Invoke-SdkManager $SdkPackages
}

function Install-Emulator {
  Use-Toolchain
  Invoke-SdkManager $EmuPackages
  $avd = Join-Path $SdkDir 'cmdline-tools\latest\bin\avdmanager.bat'
  $env:ANDROID_AVD_HOME = Join-Path $ToolRoot 'avd'
  New-Item -ItemType Directory -Force $env:ANDROID_AVD_HOME | Out-Null
  if (-not (Test-Path (Join-Path $env:ANDROID_AVD_HOME 'ApplyPilot_API36.avd'))) {
    'no' | & $avd create avd -n ApplyPilot_API36 -k 'system-images;android-36;google_apis;x86_64' -d pixel_7 | Out-Host
  }
  Write-Host "Start it with:  `$env:ANDROID_AVD_HOME='$($env:ANDROID_AVD_HOME)'; & '$SdkDir\emulator\emulator.exe' -avd ApplyPilot_API36"
}

if ($Bootstrap) { Install-Toolchain }
if ($Emulator) { Install-Emulator }

if (-not (Test-Path "$JdkDir\bin\java.exe") -or -not (Test-Path "$SdkDir\platforms\android-36")) {
  throw "Toolchain not found in $ToolRoot. Run: .\build-local.ps1 -Bootstrap"
}
Use-Toolchain

if ($Shell) {
  Write-Host "`$env:JAVA_HOME='$JdkDir'; `$env:ANDROID_HOME='$SdkDir'; `$env:GRADLE_USER_HOME='$GradleHome'; `$env:Path='$JdkDir\bin;$SdkDir\platform-tools;' + `$env:Path"
  return
}

Push-Location $ClientDir
try {
  if (-not $SkipWeb) {
    Write-Host '==> npm run build (web client)'
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
    Write-Host '==> npx cap sync android'
    npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw 'cap sync failed' }
  }
  Push-Location $AndroidDir
  try {
    Write-Host "==> gradlew $Task"
    & .\gradlew.bat @($Task -split '\s+') --no-daemon --console=plain
    if ($LASTEXITCODE -ne 0) { throw "gradle $Task failed" }
  } finally { Pop-Location }
} finally { Pop-Location }

$outs = Get-ChildItem (Join-Path $AndroidDir 'app\build\outputs') -Recurse -Include *.apk, *.aab -ErrorAction SilentlyContinue
foreach ($o in $outs) { Write-Host ("  {0}  ({1:N1} MB)" -f $o.FullName, ($o.Length / 1MB)) }
