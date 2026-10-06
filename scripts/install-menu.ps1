<#
.SYNOPSIS
  LabelPro Max — ตัวติดตั้งแบบ one-liner (เมนู interactive กดลูกศรเลือก)

  วิธีใช้: เปิด PowerShell บนเครื่องใหม่ แล้ววางคำสั่งเดียวนี้:
    Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/MrkTHixi/label-pro-max-local/codex/windows-launcher-thai-print/scripts/install-menu.ps1 | iex

  เมนูจะพาไล่สเต็ป: ติดตั้ง Git -> ติดตั้ง Node.js -> git clone -> เริ่มโปรแกรม
#>

$RepoUrl = 'https://github.com/MrkTHixi/label-pro-max-local.git'
$Branch  = 'codex/windows-launcher-thai-print'
$BaseDir = 'C:\LabelProMaxLocal'
$AppDir  = Join-Path $BaseDir 'label-pro-max-local'

# ---------- แบนเนอร์ชื่อโปรเจกต์ตัวใหญ่ ----------
function Show-Banner {
    Clear-Host
    $art = @'
 _          _          _ ____              __  __
| |    __ _| |__   ___| |  _ \ _ __ ___   |  \/  | __ ___  __
| |   / _` | '_ \ / _ \ | |_) | '__/ _ \  | |\/| |/ _` \ \/ /
| |__| (_| | |_) |  __/ |  __/| | | (_) | | |  | | (_| |>  <
|_____\__,_|_.__/ \___|_|_|   |_|  \___/  |_|  |_|\__,_/_/\_\
'@
    Write-Host $art -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  ระบบพิมพ์ฉลากพัสดุ 100x150 มม. — ตัวติดตั้ง one-liner' -ForegroundColor Gray
}

# ---------- เมนูกดลูกศรขึ้น/ลง ----------
function Show-Menu {
    param(
        [string]$Title,
        [string[]]$Items
    )
    $index = 0
    $width = [Console]::WindowWidth
    Write-Host ''
    Write-Host "  $Title" -ForegroundColor Yellow
    $menuTop = [Console]::CursorTop
    $hint = '  ↑ ↓ เลือก   Enter ตกลง   Esc ออก'
    while ($true) {
        [Console]::SetCursorPosition(0, $menuTop)
        for ($i = 0; $i -lt $Items.Count; $i++) {
            $cursor = if ($i -eq $index) { '❯' } else { ' ' }
            $line = "  $cursor $($Items[$i])".PadRight($width - 1)
            if ($i -eq $index) {
                Write-Host $line -ForegroundColor White -BackgroundColor DarkBlue
            } else {
                Write-Host $line -ForegroundColor Gray
            }
        }
        Write-Host $hint.PadRight($width - 1) -ForegroundColor DarkGray
        $key = [Console]::ReadKey($true)
        switch ($key.Key) {
            'UpArrow'   { $index = ($index - 1 + $Items.Count) % $Items.Count }
            'DownArrow' { $index = ($index + 1) % $Items.Count }
            'Enter'     {
                [Console]::SetCursorPosition(0, $menuTop + $Items.Count + 1)
                Write-Host ''
                return $index
            }
            'Escape'    {
                [Console]::SetCursorPosition(0, $menuTop + $Items.Count + 1)
                Write-Host ''
                return -1
            }
        }
    }
}

# ---------- helper ----------
function Test-Cmd([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
    # ดึง PATH ล่าสุดหลัง winget ติดตั้งโปรแกรม โดยไม่ต้องเปิด terminal ใหม่
    $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

# ---------- เมนู 1: ติดตั้ง Git ----------
function Install-Git {
    Write-Host ''
    if (Test-Cmd 'git') {
        Write-Host '  ✓ Git ติดตั้งอยู่แล้ว: ' -ForegroundColor Green -NoNewline
        git --version
        return
    }
    if (Test-Cmd 'winget') {
        Write-Host '  ▶ กำลังติดตั้ง Git ผ่าน winget...' -ForegroundColor Yellow
        winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
        Refresh-Path
    } else {
        Write-Host '  ไม่พบ winget — เปิดหน้าเว็บดาวน์โหลด Git ให้แล้ว' -ForegroundColor Yellow
        Start-Process 'https://git-scm.com/download/win'
        Write-Host '  ติดตั้งเสร็จแล้วให้ปิดแล้วเปิด terminal ใหม่ แล้วกลับมาเมนูนี้อีกครั้ง' -ForegroundColor Gray
        return
    }
    if (Test-Cmd 'git') {
        Write-Host '  ✓ ติดตั้ง Git สำเร็จ: ' -ForegroundColor Green -NoNewline
        git --version
    } else {
        Write-Host '  ✗ ยังไม่พบคำสั่ง git — ลองปิดแล้วเปิด terminal ใหม่' -ForegroundColor Red
    }
}

# ---------- เมนู 2: ติดตั้ง Node.js 22 LTS ----------
function Install-Node {
    Write-Host ''
    if (Test-Cmd 'node') {
        $v = node --version
        Write-Host "  ✓ Node.js ติดตั้งอยู่แล้ว: $v" -ForegroundColor Green
        if ($v -notmatch '^v(2[2-9]|[3-9][0-9])') {
            Write-Host '  ⚠ โปรเจกต์นี้ต้องการ Node 22 ขึ้นไป — แนะนำให้อัปเดต' -ForegroundColor Yellow
        }
        return
    }
    if (Test-Cmd 'winget') {
        Write-Host '  ▶ กำลังติดตั้ง Node.js 22 LTS ผ่าน winget...' -ForegroundColor Yellow
        winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
        Refresh-Path
    } else {
        Write-Host '  ไม่พบ winget — เปิดหน้าเว็บดาวน์โหลด Node.js ให้แล้ว' -ForegroundColor Yellow
        Start-Process 'https://nodejs.org/'
        Write-Host '  ติดตั้งเสร็จแล้วให้ปิดแล้วเปิด terminal ใหม่ แล้วกลับมาเมนูนี้อีกครั้ง' -ForegroundColor Gray
        return
    }
    if (Test-Cmd 'node') {
        Write-Host '  ✓ ติดตั้ง Node.js สำเร็จ: ' -ForegroundColor Green -NoNewline
        node --version
    } else {
        Write-Host '  ✗ ยังไม่พบคำสั่ง node — ลองปิดแล้วเปิด terminal ใหม่' -ForegroundColor Red
    }
}

# ---------- เมนู 3: git clone ----------
function Clone-Repo {
    Write-Host ''
    if (-not (Test-Cmd 'git')) {
        Write-Host '  ✗ ยังไม่ได้ติดตั้ง Git — เลือกเมนู "ติดตั้ง Git" ก่อน' -ForegroundColor Red
        return
    }
    if (Test-Path $AppDir) {
        Write-Host "  โฟลเดอร์มีอยู่แล้ว ข้ามการโคลน: $AppDir" -ForegroundColor Yellow
        Write-Host '  (ถ้าต้องการโคลนใหม่ ให้ลบโฟลเดอร์นี้ก่อน)' -ForegroundColor Gray
        return
    }
    if (-not (Test-Path $BaseDir)) {
        New-Item -ItemType Directory -Path $BaseDir | Out-Null
    }
    Write-Host "  ▶ กำลังโคลน branch $Branch ..." -ForegroundColor Yellow
    git clone --branch $Branch --single-branch $RepoUrl $AppDir
    if ($LASTEXITCODE -eq 0) {
        Write-Host '  ✓ โคลนสำเร็จ' -ForegroundColor Green
    } else {
        Write-Host '  ✗ โคลนไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตและสิทธิ์เข้าถึง repo' -ForegroundColor Red
    }
}

# ---------- เมนู 4: เริ่มโปรแกรม ----------
function Start-App {
    Write-Host ''
    $vbs = Join-Path $AppDir 'start-label-pro-max-local.vbs'
    if (-not (Test-Path $vbs)) {
        Write-Host '  ✗ ไม่พบไฟล์ start-label-pro-max-local.vbs' -ForegroundColor Red
        Write-Host '  เลือกเมนู "โคลนโปรเจกต์" ก่อน' -ForegroundColor Gray
        return
    }
    Write-Host '  ▶ กำลังเริ่มโปรแกรม...' -ForegroundColor Yellow
    Start-Process wscript.exe -ArgumentList "`"$vbs`""
    Write-Host '  ✓ สั่งเริ่มโปรแกรมแล้ว (รันแบบซ่อนหน้าต่าง)' -ForegroundColor Green
    Write-Host '  รอสักครู่ หน้าเว็บ LabelPro Max จะเปิดขึ้นมาเอง' -ForegroundColor Gray
}

# ---------- วนลูปเมนูหลัก ----------
Show-Banner
while ($true) {
    $choice = Show-Menu 'ต้องการทำอะไร?' @(
        'ติดตั้ง Git',
        'ติดตั้ง Node.js 22 LTS',
        'โคลนโปรเจกต์ (git clone)',
        'เริ่มโปรแกรม LabelPro Max',
        'ออกจากเมนู'
    )
    switch ($choice) {
        0 { Install-Git }
        1 { Install-Node }
        2 { Clone-Repo }
        3 { Start-App }
        default {
            Write-Host ''
            Write-Host '  แล้วเจอกันใหม่ครับ' -ForegroundColor Cyan
            return
        }
    }
    Write-Host ''
    Read-Host '  กด Enter เพื่อกลับเมนู' | Out-Null
    Show-Banner
}
