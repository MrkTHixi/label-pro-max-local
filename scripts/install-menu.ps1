<#
.SYNOPSIS
  Label Pro Max Local — ตัวติดตั้งแบบ one-liner v2.0 (เมนู interactive กดลูกศรเลือก)

  วิธีใช้: เปิด PowerShell บนเครื่องใหม่ แล้ววางคำสั่งเดียวนี้:
    Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/MrkTHixi/label-pro-max-local/main/scripts/install-menu.ps1 | iex

  เมนูจะพาไล่สเต็ป: ติดตั้ง Git -> ติดตั้ง Node.js -> โคลนลง C:\ -> เริ่มโปรแกรม
#>

$InstallerVersion = 'v2.0'
$RepoUrl = 'https://github.com/MrkTHixi/label-pro-max-local.git'
$Branch  = 'main'
$AppDir  = 'C:\label-pro-max-local'
$Credit  = 'Developed by Mangkorn.dev@gmail.com'
$BannerWidth = 89

$Steps = @(
    @{ Key = 'git';   Label = 'ติดตั้ง Git' },
    @{ Key = 'node';  Label = 'ติดตั้ง Node.js 22 LTS' },
    @{ Key = 'clone'; Label = 'โคลนโปรเจกต์ลง C:\' },
    @{ Key = 'start'; Label = 'เริ่มโปรแกรม' }
)
$Done = @{}

$bannerArt = @'
  _          _          _   ____              __  __              _                    _
 | |    __ _| |__   ___| | |  _ \ _ __ ___   |  \/  | __ ___  __ | |    ___   ___ __ _| |
 | |   / _` | '_ \ / _ \ | | |_) | '__/ _ \  | |\/| |/ _` \ \/ / | |   / _ \ / __/ _` | |
 | |__| (_| | |_) |  __/ | |  __/| | | (_) | | |  | | (_| |>  <  | |__| (_) | (_| (_| | |
 |_____\__,_|_.__/ \___|_| |_|   |_|  \___/  |_|  |_|\__,_/_/\_\ |_____\___/ \___\__,_|_|
'@

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

function Center-Text([string]$Text, [int]$Width) {
    $pad = [math]::Max(0, [int](($Width - $Text.Length) / 2))
    return ('  ' + (' ' * $pad) + $Text)
}

# ---------- แบนเนอร์ ----------
function Write-BannerArt {
    Write-Host $bannerArt -ForegroundColor Cyan
    Write-Host "  Installer v$InstallerVersion" -ForegroundColor DarkGray
}

function Show-BannerIntro {
    # ใช้ตอนเปิดครั้งแรก: จองบรรทัดไว้ให้ข้อความวิ่ง
    Clear-Host
    Write-BannerArt
    $row = [Console]::CursorTop
    Write-Host ''
    return $row
}

function Show-Banner {
    Clear-Host
    Write-BannerArt
    Write-Host (Center-Text $Credit $BannerWidth) -ForegroundColor Magenta
}

# ---------- ข้อความวิ่งซ้ายไปขวา (แล้ววนใหม่) ----------
function Show-Marquee {
    param(
        [string]$Text,
        [int]$Row,
        [int]$Width,
        [int]$Loops = 3,
        [int]$DelayMs = 40
    )
    $track = (' ' * $Width) + $Text + (' ' * $Width)
    $total = $Width + $Text.Length
    for ($l = 0; $l -lt $Loops; $l++) {
        for ($i = $total; $i -ge 0; $i--) {
            if ([Console]::KeyAvailable) { $null = [Console]::ReadKey($true); return }
            $seg = $track.Substring($i, $Width)
            [Console]::SetCursorPosition(0, $Row)
            Write-Host "  $seg" -ForegroundColor Magenta -NoNewline
            Start-Sleep -Milliseconds $DelayMs
        }
    }
}

# ---------- แถบความคืบหน้ารวม (ใหญ่) ----------
function Show-OverallProgress {
    $total = $Steps.Count
    $doneCount = ($Steps | Where-Object { $Done[$_.Key] }).Count
    $pct = [int][math]::Round($doneCount / $total * 100)
    $width = 52
    $filled = [int][math]::Round($pct / 100 * $width)
    $bar = ('█' * $filled) + ('░' * ($width - $filled))
    Write-Host ''
    Write-Host '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor DarkCyan
    Write-Host "  ความคืบหน้า  $bar  $pct%" -ForegroundColor Cyan
    foreach ($s in $Steps) {
        if ($Done[$s.Key]) { Write-Host "   ✓ $($s.Label)" -ForegroundColor Green }
        else               { Write-Host "   ○ $($s.Label)" -ForegroundColor DarkGray }
    }
    Write-Host '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor DarkCyan
}

# ---------- เมนูกดลูกศรขึ้น/ลง ----------
function Show-Menu {
    param(
        [string]$Title,
        [string[]]$Items
    )
    $index = 0
    $w = [Console]::WindowWidth
    Write-Host ''
    Write-Host "  $Title" -ForegroundColor Yellow
    $menuTop = [Console]::CursorTop
    $hint = '  ↑ ↓ เลือก   Enter ตกลง   Esc ออก'
    while ($true) {
        [Console]::SetCursorPosition(0, $menuTop)
        for ($i = 0; $i -lt $Items.Count; $i++) {
            $cursor = if ($i -eq $index) { '❯' } else { ' ' }
            $line = "  $cursor $($Items[$i])".PadRight($w - 1)
            if ($i -eq $index) {
                Write-Host $line -ForegroundColor White -BackgroundColor DarkBlue
            } else {
                Write-Host $line -ForegroundColor Gray
            }
        }
        Write-Host $hint.PadRight($w - 1) -ForegroundColor DarkGray
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

# ---------- แถบ % ตอนโคลน (ใหญ่) ----------
function Draw-DownloadBar {
    param([int]$Row, [int]$Percent)
    $width = 56
    $w = [Console]::WindowWidth
    $filled = [int][math]::Round($Percent / 100 * $width)
    $bar = ('█' * $filled) + ('░' * ($width - $filled))
    [Console]::SetCursorPosition(0, $Row)
    Write-Host "  $bar" -ForegroundColor Green -NoNewline
    [Console]::SetCursorPosition(0, $Row + 1)
    Write-Host "  กำลังดาวน์โหลด... $Percent%".PadRight($w - 1) -ForegroundColor Yellow -NoNewline
}

# ---------- เมนู 1: ติดตั้ง Git ----------
function Install-Git {
    Write-Host ''
    if (Test-Cmd 'git') {
        Write-Host '  ✓ Git ติดตั้งอยู่แล้ว: ' -ForegroundColor Green -NoNewline
        git --version
        $Done['git'] = $true
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
        $Done['git'] = $true
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
        } else {
            $Done['node'] = $true
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
        $Done['node'] = $true
    } else {
        Write-Host '  ✗ ยังไม่พบคำสั่ง node — ลองปิดแล้วเปิด terminal ใหม่' -ForegroundColor Red
    }
}

# ---------- เมนู 3: git clone ลง C:\ ----------
function Clone-Repo {
    Write-Host ''
    if (-not (Test-Cmd 'git')) {
        Write-Host '  ✗ ยังไม่ได้ติดตั้ง Git — เลือกเมนู "ติดตั้ง Git" ก่อน' -ForegroundColor Red
        return
    }
    if (Test-Path $AppDir) {
        Write-Host "  โฟลเดอร์มีอยู่แล้ว ข้ามการโคลน: $AppDir" -ForegroundColor Yellow
        $Done['clone'] = $true
        return
    }
    Write-Host '  ▶ กำลังโคลนโปรเจกต์...' -ForegroundColor Yellow
    Write-Host ''
    $barRow = [Console]::CursorTop
    Write-Host ''
    Write-Host ''

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'git'
    $psi.Arguments = "clone --progress --branch $Branch --single-branch $RepoUrl `"$AppDir`""
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardOutput = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)

    $reader = $proc.StandardError
    $buf = New-Object char[] 2048
    $pct = 0
    try {
        while (($n = $reader.Read($buf, 0, $buf.Length)) -gt 0) {
            $text = -join $buf[0..($n - 1)]
            $m = [regex]::Matches($text, '(\d+)%')
            if ($m.Count -gt 0) { $pct = [int]$m[$m.Count - 1].Groups[1].Value }
            Draw-DownloadBar -Row $barRow -Percent $pct
        }
    } catch { }
    $proc.WaitForExit()

    Write-Host ''
    if ($proc.ExitCode -eq 0) {
        Draw-DownloadBar -Row $barRow -Percent 100
        Write-Host ''
        Write-Host ''
        Write-Host '  ✓ โคลนสำเร็จ' -ForegroundColor Green
        $Done['clone'] = $true
    } else {
        Write-Host '  ✗ โคลนไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตและสิทธิ์เข้าถึง repo' -ForegroundColor Red
    }
}

# ---------- เมนู 4: เริ่มโปรแกรม + ขอบคุณ + นับถอยหลังปิด ----------
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
    $Done['start'] = $true

    Show-OverallProgress
    Write-Host ''
    Write-Host '  ═══════════════════════════════════════════════' -ForegroundColor Green
    Write-Host '  ขอบคุณที่ใช้ Label Pro Max Local ครับ!' -ForegroundColor Green
    Write-Host '  เริ่มโปรแกรมแล้ว หน้าต่างนี้จะปิดใน...' -ForegroundColor Gray
    Write-Host ''
    $row = [Console]::CursorTop
    for ($i = 5; $i -ge 1; $i--) {
        [Console]::SetCursorPosition(0, $row)
        Write-Host "  ปิดใน $i วินาที...".PadRight(40) -ForegroundColor Yellow -NoNewline
        Start-Sleep -Seconds 1
    }
    Write-Host ''
    exit
}

# ---------- เริ่มทำงาน ----------
if (Test-Cmd 'git')  { $Done['git'] = $true }
if (Test-Cmd 'node') {
    $v = node --version
    if ($v -match '^v(2[2-9]|[3-9][0-9])') { $Done['node'] = $true }
}
if (Test-Path $AppDir) { $Done['clone'] = $true }

# อินโทร: แบนเนอร์ + ข้อความวิ่ง (กดปุ่มใดๆ เพื่อข้าม)
$marqueeRow = Show-BannerIntro
Show-Marquee -Text $Credit -Row $marqueeRow -Width $BannerWidth -Loops 3
[Console]::SetCursorPosition(0, $marqueeRow)
Write-Host (Center-Text $Credit $BannerWidth) -ForegroundColor Magenta

# วนลูปเมนูหลัก
while ($true) {
    Show-Banner
    Show-OverallProgress
    $choice = Show-Menu 'ต้องการทำอะไร?' @(
        'ติดตั้ง Git',
        'ติดตั้ง Node.js 22 LTS',
        'โคลนโปรเจกต์ลง C:\',
        'เริ่มโปรแกรม Label Pro Max Local',
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
}
