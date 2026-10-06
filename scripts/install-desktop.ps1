param([string]$DesktopDir = $env:LABELPRO_DESKTOP_DIR, [string]$StartupDir = $env:LABELPRO_STARTUP_DIR, [string]$LegacyRoot)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
if(!$DesktopDir){$DesktopDir=[Environment]::GetFolderPath('Desktop')}
if(!$StartupDir){$StartupDir=[Environment]::GetFolderPath('Startup')}
$shell=New-Object -ComObject WScript.Shell
foreach($folder in @($DesktopDir,$StartupDir)){[IO.Directory]::CreateDirectory($folder)|Out-Null}
$wscript=Join-Path $env:WINDIR 'System32\wscript.exe'
$desktop=$shell.CreateShortcut((Join-Path $DesktopDir 'Label Pro Max Local.lnk'))
$desktop.TargetPath=$wscript
$desktop.Arguments='"'+(Join-Path $projectRoot 'start-label-pro-max-local.vbs')+'"'
$desktop.WorkingDirectory=$projectRoot
$desktop.IconLocation=(Join-Path $projectRoot 'web\icons\labelpro-transparent.ico')+',0'
$desktop.Description='Label Pro Max Local'
$desktop.Save()
$startup=$shell.CreateShortcut((Join-Path $StartupDir 'Label Pro Max Local.lnk'))
$startup.TargetPath=$wscript
$startup.Arguments='"'+(Join-Path $projectRoot 'start-label-pro-max-local.vbs')+'" /startup'
$startup.WorkingDirectory=$projectRoot
$startup.IconLocation=$desktop.IconLocation
$startup.Save()
foreach($folder in @($DesktopDir,$StartupDir)){
  $legacy=Join-Path $folder 'LabelPro Local.lnk'
  if(Test-Path -LiteralPath $legacy){
    $link=$shell.CreateShortcut($legacy)
    if($link.WorkingDirectory -eq $projectRoot -or ($LegacyRoot -and $link.WorkingDirectory -eq $LegacyRoot)){Remove-Item -LiteralPath $legacy -Force}
  }
}
