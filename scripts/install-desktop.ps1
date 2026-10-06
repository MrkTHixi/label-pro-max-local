param([string]$DesktopDir = $env:LABELPRO_DESKTOP_DIR, [string]$StartupDir = $env:LABELPRO_STARTUP_DIR)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
if(!$DesktopDir){$DesktopDir=[Environment]::GetFolderPath('Desktop')}
if(!$StartupDir){$StartupDir=[Environment]::GetFolderPath('Startup')}
$shell=New-Object -ComObject WScript.Shell
foreach($folder in @($DesktopDir,$StartupDir)){[IO.Directory]::CreateDirectory($folder)|Out-Null}
$wscript=Join-Path $env:WINDIR 'System32\wscript.exe'
$desktop=$shell.CreateShortcut((Join-Path $DesktopDir 'LabelPro Local.lnk'))
$desktop.TargetPath=$wscript
$desktop.Arguments='"'+(Join-Path $projectRoot 'start-labelpro.vbs')+'"'
$desktop.WorkingDirectory=$projectRoot
$desktop.IconLocation=(Join-Path $projectRoot 'web\icons\labelpro-transparent.ico')+',0'
$desktop.Description='LabelPro Local'
$desktop.Save()
$startup=$shell.CreateShortcut((Join-Path $StartupDir 'LabelPro Local.lnk'))
$startup.TargetPath=$wscript
$startup.Arguments='"'+(Join-Path $projectRoot 'start-labelpro.vbs')+'" /startup'
$startup.WorkingDirectory=$projectRoot
$startup.IconLocation=$desktop.IconLocation
$startup.Save()
