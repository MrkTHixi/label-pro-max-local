param([string]$SourceRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
try {
  $source=[IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
  $parent=Split-Path -Parent $source
  $target=[IO.Path]::GetFullPath((Join-Path $parent 'label-pro-max-local'))
  if($source -eq $target){[Windows.Forms.MessageBox]::Show('โฟลเดอร์เป็นชื่อใหม่แล้ว','Label Pro Max Local')|Out-Null;exit 0}
  if((Split-Path -Parent $target) -ne $parent -or (Split-Path -Leaf $target) -ne 'label-pro-max-local'){throw 'ตำแหน่งปลายทางไม่ถูกต้อง'}
  if(!(Test-Path -LiteralPath (Join-Path $source 'package.json'))){throw 'ไม่พบโฟลเดอร์โปรเจคต้นทาง'}
  if(Test-Path -LiteralPath $target){throw 'มีโฟลเดอร์ปลายทางอยู่แล้ว กรุณาตรวจสอบก่อน ไม่ย้ายทับข้อมูลเดิม'}
  Set-Location -LiteralPath $parent
  [Environment]::CurrentDirectory=$parent
  $node=(Get-Command node -ErrorAction SilentlyContinue).Source
  if(!$node){$portable=Get-ChildItem -LiteralPath (Join-Path $source '.runtime') -Directory | Where-Object Name -Like 'node-v24*-win-*' | Select-Object -First 1;$node=Join-Path $portable.FullName 'node.exe'}
  $identity=(& $node (Join-Path $source 'scripts\runtime.mjs') --identity).Trim()
  $port=if($env:PORT){$env:PORT}else{'3000'}
  $health=$null;try{$health=Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2}catch{}
  if($health){
    if($health.app_id -ne $identity){throw 'พอร์ตนี้เป็นของโปรเจคอื่น กรุณาปิดโปรเจคที่ถูกต้องก่อน'}
    $queue=Invoke-RestMethod "http://127.0.0.1:$port/api/queue"
    if($queue.stats.waiting -gt 0){throw 'ยังมีงานรอหรือกำลังพิมพ์ กรุณาจัดการคิวก่อนย้ายโฟลเดอร์'}
    Invoke-RestMethod -Method Post "http://127.0.0.1:$port/api/runtime/stop" -ContentType 'application/json' -Body '{}'|Out-Null
    Start-Sleep -Seconds 3
  }
  & $node (Join-Path $source 'scripts\prepare-rename.mjs')
  if($LASTEXITCODE -ne 0){throw 'เตรียมสำรองหรือปิดระบบไม่สำเร็จ ยังไม่ได้ย้ายโฟลเดอร์'}
  Move-Item -LiteralPath $source -Destination $target
  & (Join-Path $target 'scripts\install-desktop.ps1') -LegacyRoot $source
  & (Join-Path $target 'scripts\launch.ps1') -NoDialogs
  [Windows.Forms.MessageBox]::Show("ย้ายโฟลเดอร์สำเร็จ: $target`nทางลัดใหม่ชื่อ Label Pro Max Local`nหากจะพัฒนาต่อใน Codex ให้เปิดโปรเจคจากโฟลเดอร์ใหม่",'Label Pro Max Local')|Out-Null
} catch {
  [Windows.Forms.MessageBox]::Show("ยังเปลี่ยนชื่อโฟลเดอร์ไม่สำเร็จ: $($_.Exception.Message)`nกรุณาปิด Codex, VS Code และหน้าต่างคำสั่งที่ใช้โฟลเดอร์นี้ แล้วเปิดตัวเปลี่ยนชื่ออีกครั้ง",'Label Pro Max Local','OK','Error')|Out-Null
  exit 1
}
