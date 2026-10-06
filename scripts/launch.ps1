param([switch]$Stop, [switch]$NoBrowser, [switch]$NoDialogs, [switch]$ForcePortableNode, [switch]$NoIntegration)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$runtimeDir = Join-Path $projectRoot '.runtime'
$logDir = if ($env:LABELPRO_DATA_DIR) { $env:LABELPRO_DATA_DIR } elseif ($env:LABELPRO_DB) { Split-Path -Parent $env:LABELPRO_DB } else { Join-Path $projectRoot 'data' }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$launchLog = Join-Path $logDir 'launcher.log'
if ((Test-Path -LiteralPath $launchLog) -and (Get-Item -LiteralPath $launchLog).Length -gt 2MB) { Move-Item -LiteralPath $launchLog -Destination "$launchLog.1" -Force }
$form = $null
function Get-Sha256([string]$path) {
  $stream = [IO.File]::OpenRead($path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','') }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Show-Status([string]$message) {
  if (-not $NoDialogs) {
    if (-not $script:form) {
      Add-Type -AssemblyName System.Windows.Forms
      $script:form = New-Object System.Windows.Forms.Form
      $script:form.Text = 'Label Pro Max Local'; $script:form.Width = 450; $script:form.Height = 140
      $script:form.StartPosition = 'CenterScreen'; $script:form.ControlBox = $false
      $script:statusLabel = New-Object System.Windows.Forms.Label
      $script:statusLabel.Dock = 'Fill'; $script:statusLabel.TextAlign = 'MiddleCenter'
      $script:form.Controls.Add($script:statusLabel); $script:form.Show()
    }
    $script:statusLabel.Text = $message; [System.Windows.Forms.Application]::DoEvents()
  }
}
function Run-Hidden([string]$file, [string[]]$arguments) {
  $outFile = Join-Path $logDir ('setup-' + [guid]::NewGuid().ToString() + '.out')
  $errFile = "$outFile.err"
  try {
    $process = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    # Keep the process handle open: Windows PowerShell otherwise may return a null ExitCode.
    $null = $process.Handle
    $deadline = (Get-Date).AddMinutes(15)
    while (-not $process.HasExited) {
      if ((Get-Date) -gt $deadline) { $process.Kill(); throw 'Setup timed out. Check the internet connection and try again.' }
      if (-not $NoDialogs) { [System.Windows.Forms.Application]::DoEvents() }
      Start-Sleep -Milliseconds 150; $process.Refresh()
    }
    $process.WaitForExit()
    $content = (Get-Content -LiteralPath $outFile,$errFile -Raw -ErrorAction SilentlyContinue) -join "`n"
    Add-Content -LiteralPath $launchLog -Value $content
    if ($process.ExitCode -ne 0) { throw "Setup failed (exit $($process.ExitCode)). See $launchLog`n$content" }
    return $content
  } finally {
    Remove-Item -LiteralPath $outFile,$errFile -Force -ErrorAction SilentlyContinue
  }
}
function Get-Health {
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:$script:port/api/health" -TimeoutSec 2 } catch { return $null }
}
$setupMutex = $null; $ownedMutex = $false
try {
  $port = if ($env:PORT) { $env:PORT } else { '3000' }
  $pathHash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot + '|' + $logDir))).Replace('-','')
  $setupMutex = New-Object Threading.Mutex($false, "Local\LabelProLaunch-$pathHash")
  try { $ownedMutex = $setupMutex.WaitOne(60000) } catch [Threading.AbandonedMutexException] { $ownedMutex = $true }
  if (-not $ownedMutex) { throw 'Label Pro Max Local is still preparing. Please try the desktop shortcut again shortly.' }
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  $nodePath = if ($nodeCommand -and -not $ForcePortableNode) { $nodeCommand.Source } else { $null }
  if ($nodePath) { $major = [int]((& $nodePath --version).TrimStart('v').Split('.')[0]); if ($major -lt 22) { $nodePath = $null } }
  if (-not $nodePath) {
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    $portable = Get-ChildItem -LiteralPath $runtimeDir -Directory | Where-Object Name -Like 'node-v24*-win-*' | Select-Object -First 1
    if ($portable -and (Test-Path -LiteralPath (Join-Path $portable.FullName 'node.exe'))) { $nodePath = Join-Path $portable.FullName 'node.exe' }
    else {
      Show-Status 'Preparing Node.js for Label Pro Max Local. Please wait...'
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
      $manifest = (Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt').Content
      $line = ($manifest -split "`n" | Where-Object { $_ -match "node-v24\.[0-9]+\.[0-9]+-win-$architecture\.zip$" } | Select-Object -First 1).Trim()
      if (-not $line) { throw 'Cannot find the Windows Node.js package.' }
      $parts = $line -split '\s+'; $zipName = $parts[1]; $zipPath = Join-Path $runtimeDir $zipName
      Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/latest-v24.x/$zipName" -OutFile $zipPath
      if ((Get-Sha256 $zipPath) -ne $parts[0]) { throw 'Node.js checksum verification failed.' }
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $runtimeDir)
      Remove-Item -LiteralPath $zipPath -Force
      $nodePath = Join-Path (Join-Path $runtimeDir $zipName.Replace('.zip','')) 'node.exe'
    }
  }
  $env:PATH = (Split-Path -Parent $nodePath) + ';' + $env:PATH
  $npmCli = Join-Path (Split-Path -Parent $nodePath) 'node_modules\npm\bin\npm-cli.js'
  if (-not (Test-Path -LiteralPath $npmCli)) { throw 'Node.js installation has no npm. Reinstall Node.js LTS.' }
  $identityScript = Join-Path $PSScriptRoot 'runtime.mjs'
  $identity = (& $nodePath $identityScript --identity).Trim()
  $health = Get-Health
  if ($health -and $health.app_id -ne $identity) { throw "Port $port is used by another application or a different Label Pro Max Local project." }
  if ($Stop) {
    if ($health) { Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/runtime/stop" -ContentType 'application/json' -Body '{}' | Out-Null }
    exit 0
  }
  if ($health -and -not $health.managed) { throw 'Label Pro Max Local is running in the old mode. Close the old server and worker, then open start-label-pro-max-local.vbs.' }
  if (-not $health) {
    $marker = Join-Path $projectRoot 'node_modules\.labelpro-setup'
    $lockHash = (Get-Sha256 (Join-Path $projectRoot 'package-lock.json')) + (& $nodePath -p 'process.versions.modules + process.arch')
    $cached = (Test-Path -LiteralPath $marker) -and (Get-Content -LiteralPath $marker -Raw).Trim() -eq $lockHash
    if (-not $cached) {
      Show-Status 'Preparing Label Pro Max Local. First setup requires internet...'
      Run-Hidden $nodePath @(('"' + $npmCli + '"'),'ci','--no-fund','--no-audit') | Out-Null
      $playwrightCli = Join-Path $projectRoot 'node_modules\playwright\cli.js'
      Run-Hidden $nodePath @(('"' + $playwrightCli + '"'),'install','chromium','--only-shell') | Out-Null
    }
    Show-Status 'Checking the label renderer...'
    try { Run-Hidden $nodePath @(('"' + (Join-Path $PSScriptRoot 'check-setup.mjs') + '"')) | Out-Null }
    catch {
      if (-not $cached) { throw }
      Show-Status 'Repairing Label Pro Max Local dependencies...'
      Run-Hidden $nodePath @(('"' + $npmCli + '"'),'ci','--no-fund','--no-audit') | Out-Null
      Run-Hidden $nodePath @(('"' + (Join-Path $projectRoot 'node_modules\playwright\cli.js') + '"'),'install','chromium','--only-shell') | Out-Null
      Run-Hidden $nodePath @(('"' + (Join-Path $PSScriptRoot 'check-setup.mjs') + '"')) | Out-Null
    }
    Set-Content -LiteralPath $marker -Value $lockHash -Encoding ASCII
    Show-Status 'Starting Label Pro Max Local...'
    Start-Process -FilePath $nodePath -ArgumentList @(('"' + $identityScript + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
  }
  $deadline = (Get-Date).AddSeconds(55)
  do {
    $health = Get-Health
    if ($health -and $health.app_id -eq $identity -and $health.worker.ready) { break }
    if ((Get-Date) -gt $deadline) { throw "Label Pro Max Local could not start. See $logDir\runtime.log" }
    if (-not $NoDialogs -and $form) { [System.Windows.Forms.Application]::DoEvents() }
    Start-Sleep -Milliseconds 300
  } while ($true)
  if (-not $NoIntegration -and -not $env:LABELPRO_DB) { & (Join-Path $PSScriptRoot 'install-desktop.ps1') }
  if (-not $NoBrowser) {
    $chromePaths=@((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),(Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),(Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'))
    $chrome=$chromePaths|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1
    if($chrome){Start-Process -FilePath $chrome -ArgumentList "--app=http://localhost:$port" -WindowStyle Normal}
    else {Start-Process "http://localhost:$port"}
  }
} catch {
  Add-Content -LiteralPath $launchLog -Value $_.Exception.Message
  if (-not $NoDialogs) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Label Pro Max Local', 'OK', 'Error') | Out-Null
  } else { Write-Error $_.Exception.Message }
  exit 1
} finally {
  if ($form) { $form.Close(); $form.Dispose() }
  if ($ownedMutex) { $setupMutex.ReleaseMutex() }
  if ($setupMutex) { $setupMutex.Dispose() }
}
