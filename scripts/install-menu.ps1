<#
.SYNOPSIS
  Label Pro Max Local — ตัวติดตั้งแบบ one-liner v3.0 (โฉมใหม่ · เมนู interactive กดลูกศรเลือก)

  วิธีใช้: เปิด PowerShell บนเครื่องใหม่ แล้ววางคำสั่งเดียวนี้:
    Set-ExecutionPolicy Bypass -Scope Process -Force; irm https://raw.githubusercontent.com/MrkTHixi/label-pro-max-local/main/scripts/install-menu.ps1 | iex

  เมนูจะพาไล่สเต็ป: ติดตั้ง Git -> ติดตั้ง Node.js -> โคลนลง C:\ -> เริ่มโปรแกรม

  ปุ่มลัด:  ↑ ↓ เลือก · Enter ตกลง · 1-5 กระโดดไปข้อนั้น · Esc / Q ออก

  ไอคอน: ใช้ emoji อัตโนมัติเมื่อรันใน Windows Terminal / VS Code
         ถ้าเทอร์มินัลแสดง emoji ไม่ได้ จะสลับเป็นตัวเลขให้เอง
         บังคับได้ด้วย  $env:LPM_ICONS = 'emoji'  หรือ  'plain'
#>

$LPM = @{
    Version = 'v3.0'
    RepoUrl = 'https://github.com/MrkTHixi/label-pro-max-local.git'
    Branch  = 'main'
    AppDir  = 'C:\label-pro-max-local'
    Credit  = 'Developed by Mangkorn.dev@gmail.com'
    AppUrl  = 'http://localhost:3000'
    Done    = @{}
    W       = 76
    Ansi    = $false
    Emoji   = $false
}

# ---------- สีธีม (RGB) ----------
$LPM.C = @{
    Cyan   = @(34, 211, 238)
    Violet = @(167, 139, 250)
    Pink   = @(244, 114, 182)
    Green  = @(74, 222, 128)
    Amber  = @(251, 191, 36)
    Red    = @(248, 113, 113)
    Text   = @(226, 232, 240)
    Dim    = @(122, 136, 158)
    Faint  = @(71, 85, 105)
    Dark   = @(15, 23, 42)
    SelBg  = @(30, 41, 59)
}
$LPM.Grad = @($LPM.C.Cyan, $LPM.C.Violet, $LPM.C.Pink)
$LPM.ESC  = [string][char]27
$LPM.RST  = "$($LPM.ESC)[0m"

# ---------- ขั้นตอนทั้งหมด + ไอคอน ----------
function Get-Emoji([int]$Code) { return [char]::ConvertFromUtf32($Code) }

$LPM.Steps = @(
    @{ Key = 'git';   Short = 'Git';          Label = 'ติดตั้ง Git';                       Desc = 'ติดตั้งผ่าน winget · ถ้ามีอยู่แล้วจะข้ามให้อัตโนมัติ' },
    @{ Key = 'node';  Short = 'Node.js';      Label = 'ติดตั้ง Node.js 22 LTS';            Desc = 'โปรเจกต์นี้ต้องการ Node.js 22 ขึ้นไป' },
    @{ Key = 'clone'; Short = 'โคลนโปรเจกต์';  Label = 'โคลนโปรเจกต์ลง C:\';                Desc = "ดาวน์โหลดโปรแกรมจาก GitHub ไปไว้ที่ $($LPM.AppDir)" },
    @{ Key = 'start'; Short = 'เริ่มโปรแกรม';   Label = 'เริ่มโปรแกรม Label Pro Max Local'; Desc = "เปิดระบบพิมพ์ฉลากและหน้าเว็บ $($LPM.AppUrl)" }
)
$LPM.EmojiIcons = @{
    git    = (Get-Emoji 0x1F500)   # 🔀
    node   = (Get-Emoji 0x1F9E9)   # 🧩
    clone  = (Get-Emoji 0x1F4E5)   # 📥
    start  = (Get-Emoji 0x1F680)   # 🚀
    exit   = (Get-Emoji 0x1F44B)   # 👋
    header = (Get-Emoji 0x1F4E6)   # 📦
}

# ---------- เตรียมคอนโซล ----------
function Enable-Vt {
    # เปิดโหมด ANSI/VT ให้ conhost ของ Windows PowerShell 5.1 (Windows Terminal เปิดอยู่แล้ว)
    if ($PSVersionTable.PSEdition -eq 'Core' -and $IsWindows -eq $false) { return $true }
    try {
        if (-not ('Lpm.Native' -as [type])) {
            Add-Type -Namespace Lpm -Name Native -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
'@
        }
        $h = [Lpm.Native]::GetStdHandle(-11)
        $mode = [uint32]0
        if (-not [Lpm.Native]::GetConsoleMode($h, [ref]$mode)) { return $false }
        return [Lpm.Native]::SetConsoleMode($h, [uint32]($mode -bor 4))
    } catch { return $false }
}

function Test-EmojiTerminal {
    $force = $env:LPM_ICONS
    if ($force -eq 'emoji') { return $true }
    if ($force -eq 'plain') { return $false }
    return [bool]($env:WT_SESSION -or $env:TERM_PROGRAM -eq 'vscode')
}

# ---------- ตัวช่วยสี / ข้อความ ----------
function FgC($rgb) { "$($LPM.ESC)[38;2;$($rgb[0]);$($rgb[1]);$($rgb[2])m" }
function BgC($rgb) { "$($LPM.ESC)[48;2;$($rgb[0]);$($rgb[1]);$($rgb[2])m" }

function Paint([string]$Text, $F = $null, $B = $null, [switch]$Bold) {
    if (-not $LPM.Ansi) { return $Text }
    $pre = ''
    if ($Bold) { $pre += "$($LPM.ESC)[1m" }
    if ($F)    { $pre += (FgC $F) }
    if ($B)    { $pre += (BgC $B) }
    return $pre + $Text + $LPM.RST
}

function Get-Grad([double]$t) {
    $s = $LPM.Grad
    if ($t -le 0.5) { $a = $s[0]; $b = $s[1]; $u = $t * 2 }
    else            { $a = $s[1]; $b = $s[2]; $u = ($t - 0.5) * 2 }
    $u = [math]::Max(0, [math]::Min(1, $u))
    return , @(
        [int]($a[0] + ($b[0] - $a[0]) * $u),
        [int]($a[1] + ($b[1] - $a[1]) * $u),
        [int]($a[2] + ($b[2] - $a[2]) * $u)
    )
}

function Paint-Gradient([string]$Text, [int]$Total = 0, [switch]$Bold) {
    if (-not $LPM.Ansi) { return $Text }
    if ($Total -le 0) { $Total = $Text.Length }
    $sb = New-Object System.Text.StringBuilder
    if ($Bold) { [void]$sb.Append("$($LPM.ESC)[1m") }
    for ($i = 0; $i -lt $Text.Length; $i++) {
        $ch = $Text[$i]
        $c  = [int]$ch
        # เว้นการลงสี: ช่องว่าง, ครึ่งหลังของ emoji (surrogate), สระ/วรรณยุกต์ไทยที่ซ้อนบนตัวอักษรก่อนหน้า
        if ($ch -eq ' ' -or ($c -ge 0xDC00 -and $c -le 0xDFFF) -or $c -eq 0x0E31 -or ($c -ge 0x0E34 -and $c -le 0x0E3A) -or ($c -ge 0x0E47 -and $c -le 0x0E4E)) {
            [void]$sb.Append($ch); continue
        }
        $t = $i / [math]::Max(1, $Total - 1)
        [void]$sb.Append((FgC (Get-Grad $t))).Append($ch)
    }
    [void]$sb.Append($LPM.RST)
    return $sb.ToString()
}

# ความกว้างบนหน้าจอจริง: ตัดรหัสสี, สระ/วรรณยุกต์ไทยกว้าง 0, emoji กว้าง 2
function Get-DW([string]$Text) {
    $s = [regex]::Replace($Text, '\x1b\[[0-9;]*[A-Za-z]', '')
    $w = 0
    for ($i = 0; $i -lt $s.Length; $i++) {
        $c = [int][char]$s[$i]
        if ($c -ge 0xD800 -and $c -le 0xDBFF) { $w += 2; continue }
        if ($c -ge 0xDC00 -and $c -le 0xDFFF) { continue }
        if ($c -eq 0x0E31 -or ($c -ge 0x0E34 -and $c -le 0x0E3A) -or ($c -ge 0x0E47 -and $c -le 0x0E4E)) { continue }
        if ($c -eq 0x200B -or $c -eq 0xFE0F) { continue }
        $w++
    }
    return $w
}

function Pad-Right([string]$Text, [int]$Width) {
    $d = $Width - (Get-DW $Text)
    if ($d -gt 0) { return $Text + (' ' * $d) }
    return $Text
}

function Get-UiWidth {
    try { $w = [Console]::WindowWidth } catch { $w = 80 }
    return [math]::Max(50, [math]::Min(76, $w - 4))
}

function Test-Cmd([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
    # ดึง PATH ล่าสุดหลัง winget ติดตั้งโปรแกรม โดยไม่ต้องเปิด terminal ใหม่
    $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Set-CursorVisible([bool]$Visible) {
    try { [Console]::CursorVisible = $Visible } catch { }
}

function Get-StepIcon([string]$Key) {
    if ($LPM.Emoji) { return $LPM.EmojiIcons[$Key] }
    $n = @('git', 'node', 'clone', 'start', 'exit').IndexOf($Key) + 1
    return "$n."
}

# ---------- แบนเนอร์ ----------
function Get-BannerRows {
    $g = @{
        'L' = @('╦  ', '║  ', '╩═╝')
        'A' = @('╔═╗', '╠═╣', '╩ ╩')
        'B' = @('╔╗ ', '╠╩╗', '╚═╝')
        'E' = @('╔═╗', '║╣ ', '╚═╝')
        'P' = @('╔═╗', '╠═╝', '╩  ')
        'R' = @('╦═╗', '╠╦╝', '╩╚═')
        'O' = @('╔═╗', '║ ║', '╚═╝')
        'M' = @('╔╦╗', '║║║', '╩ ╩')
        'X' = @('═╗ ╦', '╔╩╦╝', '╩ ╚═')
    }
    $rows = @('', '', '')
    foreach ($ch in 'LABEL PRO MAX'.ToCharArray()) {
        if ($ch -eq ' ') { for ($r = 0; $r -lt 3; $r++) { $rows[$r] += '   ' }; continue }
        $gl = $g[[string]$ch]
        for ($r = 0; $r -lt 3; $r++) { $rows[$r] += $gl[$r] + ' ' }
    }
    return $rows
}

function Show-Header([switch]$Animate) {
    $LPM.W = Get-UiWidth
    Clear-Host
    Write-Host ''
    $rows  = Get-BannerRows
    $total = ($rows | Measure-Object -Property Length -Maximum).Maximum
    $skip  = $false

    for ($r = 0; $r -lt 3; $r++) {
        $line = '  ' + (Paint-Gradient $rows[$r].PadRight($total) $total -Bold)
        if ($r -eq 1) { $line += '   ' + (Paint ' LOCAL ' $LPM.C.Dark $LPM.C.Violet -Bold) }
        Write-Host $line
        if ($Animate -and -not $skip) {
            if ([Console]::KeyAvailable) { $null = [Console]::ReadKey($true); $skip = $true }
            else { Start-Sleep -Milliseconds 110 }
        }
    }

    Write-Host ('  ' + (Paint 'ระบบพิมพ์ฉลากพัสดุภาษาไทย 100 × 150 มม.' $LPM.C.Dim) + (Paint "   ·   Installer $($LPM.Version)" $LPM.C.Faint))

    $credit = '• ' + $LPM.Credit
    if ($Animate -and -not $skip) {
        Write-Host '  ' -NoNewline
        foreach ($ch in $credit.ToCharArray()) {
            Write-Host (Paint ([string]$ch) $LPM.C.Pink) -NoNewline
            if ([Console]::KeyAvailable) { $null = [Console]::ReadKey($true); $skip = $true }
            if (-not $skip) { Start-Sleep -Milliseconds 16 }
        }
        Write-Host ''
    } else {
        Write-Host ('  ' + (Paint $credit $LPM.C.Pink))
    }
    Write-Host ('  ' + (Paint-Gradient ('━' * $LPM.W)))
}

# ---------- การ์ดกรอบมน ----------
function Write-Card([string]$Title, [string[]]$Lines) {
    $W = $LPM.W
    $bc = $LPM.C.Faint
    $t = " $Title "
    $rest = [math]::Max(0, $W - 3 - (Get-DW $t))
    Write-Host ('  ' + (Paint '╭─' $bc) + (Paint $t $LPM.C.Cyan -Bold) + (Paint (('─' * $rest) + '╮') $bc))
    foreach ($l in $Lines) {
        $pad = [math]::Max(0, $W - 4 - (Get-DW $l))
        Write-Host ('  ' + (Paint '│' $bc) + ' ' + $l + (' ' * $pad) + ' ' + (Paint '│' $bc))
    }
    Write-Host ('  ' + (Paint ('╰' + ('─' * ($W - 2)) + '╯') $bc))
}

function Get-GradBar([int]$Percent, [int]$Width) {
    $filled = [int][math]::Round($Percent / 100 * $Width)
    if (-not $LPM.Ansi) { return ('█' * $filled) + ('░' * ($Width - $filled)) }
    $sb = New-Object System.Text.StringBuilder
    for ($i = 0; $i -lt $filled; $i++) {
        [void]$sb.Append((FgC (Get-Grad ($i / [math]::Max(1, $Width - 1))))).Append('━')
    }
    [void]$sb.Append((FgC $LPM.C.Faint))
    [void]$sb.Append('─' * ($Width - $filled))
    [void]$sb.Append($LPM.RST)
    return $sb.ToString()
}

function Get-NextKey {
    foreach ($s in $LPM.Steps) { if (-not $LPM.Done[$s.Key]) { return $s.Key } }
    return $null
}

# ---------- ความคืบหน้ารวม ----------
function Show-Progress {
    $steps = $LPM.Steps
    $n     = @($steps | Where-Object { $LPM.Done[$_.Key] }).Count
    $pct   = [int][math]::Round($n / $steps.Count * 100)
    $inner = $LPM.W - 4
    $next  = Get-NextKey

    $bar  = Get-GradBar $pct ([math]::Max(10, $inner - 10))
    $line1 = $bar + ' ' + (Paint ('{0,3}%' -f $pct) $LPM.C.Text -Bold) + '  ' + (Paint "$n/$($steps.Count)" $LPM.C.Dim)

    $parts = @()
    foreach ($s in $steps) {
        if ($LPM.Done[$s.Key])   { $parts += (Paint '✓ ' $LPM.C.Green -Bold) + (Paint $s.Short $LPM.C.Green) }
        elseif ($s.Key -eq $next) { $parts += (Paint '● ' $LPM.C.Cyan -Bold)  + (Paint $s.Short $LPM.C.Text) }
        else                      { $parts += (Paint '○ ' $LPM.C.Faint)       + (Paint $s.Short $LPM.C.Dim) }
    }
    $line2 = $parts -join (Paint '  ──  ' $LPM.C.Faint)

    Write-Card 'ความคืบหน้าการติดตั้ง' @($line1, $line2)
}

# ---------- เมนูกดลูกศรขึ้น/ลง ----------
function Show-Menu {
    param([string]$Title, [object[]]$Items, [int]$Start = 0)

    $W      = $LPM.W
    $index  = $Start
    $next   = Get-NextKey
    $needed = $Items.Count + 3

    Write-Host ''
    Write-Host ('  ' + (Paint $Title $LPM.C.Amber -Bold))
    1..($needed + 1) | ForEach-Object { Write-Host '' }
    $menuTop = [Console]::CursorTop - ($needed + 1)
    Set-CursorVisible $false

    try {
        while ($true) {
            $lines = @()
            for ($i = 0; $i -lt $Items.Count; $i++) {
                $it  = $Items[$i]
                $sel = ($i -eq $index)
                $ptr = if ($sel) { '❯' } else { ' ' }
                $left = " $ptr  $($it.IconShown)  $($it.Label)"

                $badge = ''; $badgeClr = $LPM.C.Dim
                if ($it.Key -ne 'exit') {
                    if ($LPM.Done[$it.Key])    { $badge = '✓ เสร็จแล้ว '; $badgeClr = $LPM.C.Green }
                    elseif ($it.Key -eq $next) { $badge = '★ ถัดไป ';    $badgeClr = $LPM.C.Amber }
                }
                $gap = [math]::Max(1, $W - (Get-DW $left) - (Get-DW $badge))

                if ($sel) {
                    $lines += (Paint $left $LPM.C.Cyan $LPM.C.SelBg -Bold) + (Paint (' ' * $gap) $null $LPM.C.SelBg) + (Paint $badge $badgeClr $LPM.C.SelBg -Bold)
                } else {
                    $lines += (Paint $left $LPM.C.Text) + (' ' * $gap) + (Paint $badge $badgeClr)
                }
            }
            $lines += ''
            $lines += (Pad-Right (' ' + (Paint ('› ' + $Items[$index].Desc) $LPM.C.Dim)) $W)
            $lines += (Pad-Right (' ' + (Paint '↑ ↓ เลือก   Enter ตกลง   1-5 ลัด   Esc ออก' $LPM.C.Faint)) $W)

            [Console]::SetCursorPosition(0, $menuTop)
            foreach ($ln in $lines) { Write-Host ('  ' + $ln) }

            $key = [Console]::ReadKey($true)
            switch ($key.Key) {
                'UpArrow'   { $index = ($index - 1 + $Items.Count) % $Items.Count }
                'DownArrow' { $index = ($index + 1) % $Items.Count }
                'Enter'     { return $index }
                'Escape'    { return -1 }
                'Q'         { return -1 }
                default {
                    $d = [int]$key.KeyChar - [int][char]'0'
                    if ($d -ge 1 -and $d -le $Items.Count) { $index = $d - 1 }
                }
            }
        }
    } finally {
        [Console]::SetCursorPosition(0, $menuTop + $needed)
        Set-CursorVisible $true
    }
}

# ---------- ตัวช่วยหน้าจอตอนทำงาน ----------
function Show-ActionHeader([string]$Key, [string]$Title) {
    Clear-Host
    Write-Host ''
    Write-Host ('  ' + (Paint-Gradient ("$(Get-StepIcon $Key)  $Title") -Bold))
    Write-Host ('  ' + (Paint-Gradient ('━' * $LPM.W)))
    Write-Host ''
}

function Write-Tag([string]$Kind, [string]$Text, [string]$Extra = '') {
    switch ($Kind) {
        'ok'   { $pill = Paint ' OK   ' $LPM.C.Dark $LPM.C.Green -Bold;  $clr = $LPM.C.Green }
        'warn' { $pill = Paint ' WARN ' $LPM.C.Dark $LPM.C.Amber -Bold;  $clr = $LPM.C.Amber }
        'err'  { $pill = Paint ' FAIL ' $LPM.C.Dark $LPM.C.Red   -Bold;  $clr = $LPM.C.Red }
        default { $pill = Paint ' INFO ' $LPM.C.Dark $LPM.C.Cyan  -Bold; $clr = $LPM.C.Text }
    }
    $line = '  ' + $pill + '  ' + (Paint $Text $clr)
    if ($Extra) { $line += '  ' + (Paint $Extra $LPM.C.Dim) }
    Write-Host $line
}

function Wait-Back {
    Write-Host ''
    Write-Host ('  ' + (Paint '↵ กดปุ่มใดก็ได้เพื่อกลับเมนู' $LPM.C.Dim))
    $null = [Console]::ReadKey($true)
}

# ---------- เมนู 1: ติดตั้ง Git ----------
function Install-Git {
    Show-ActionHeader 'git' 'ติดตั้ง Git'
    if (Test-Cmd 'git') {
        Write-Tag 'ok' 'Git ติดตั้งอยู่แล้ว' ((git --version) -join ' ')
        $LPM.Done['git'] = $true
        return
    }
    if (Test-Cmd 'winget') {
        Write-Tag 'info' 'กำลังติดตั้ง Git ผ่าน winget...'
        Write-Host ''
        winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
        Refresh-Path
        Write-Host ''
    } else {
        Write-Tag 'warn' 'ไม่พบ winget — เปิดหน้าเว็บดาวน์โหลด Git ให้แล้ว'
        Start-Process 'https://git-scm.com/download/win'
        Write-Host ('  ' + (Paint 'ติดตั้งเสร็จแล้วให้ปิดแล้วเปิด terminal ใหม่ แล้วกลับมาเมนูนี้อีกครั้ง' $LPM.C.Dim))
        return
    }
    if (Test-Cmd 'git') {
        Write-Tag 'ok' 'ติดตั้ง Git สำเร็จ' ((git --version) -join ' ')
        $LPM.Done['git'] = $true
    } else {
        Write-Tag 'err' 'ยังไม่พบคำสั่ง git — ลองปิดแล้วเปิด terminal ใหม่'
    }
}

# ---------- เมนู 2: ติดตั้ง Node.js 22 LTS ----------
function Install-Node {
    Show-ActionHeader 'node' 'ติดตั้ง Node.js 22 LTS'
    if (Test-Cmd 'node') {
        $v = (node --version) -join ' '
        if ($v -notmatch '^v(2[2-9]|[3-9][0-9])') {
            Write-Tag 'warn' 'โปรเจกต์นี้ต้องการ Node 22 ขึ้นไป — แนะนำให้อัปเดต' "พบ $v"
        } else {
            Write-Tag 'ok' 'Node.js ติดตั้งอยู่แล้ว' $v
            $LPM.Done['node'] = $true
        }
        return
    }
    if (Test-Cmd 'winget') {
        Write-Tag 'info' 'กำลังติดตั้ง Node.js 22 LTS ผ่าน winget...'
        Write-Host ''
        winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
        Refresh-Path
        Write-Host ''
    } else {
        Write-Tag 'warn' 'ไม่พบ winget — เปิดหน้าเว็บดาวน์โหลด Node.js ให้แล้ว'
        Start-Process 'https://nodejs.org/'
        Write-Host ('  ' + (Paint 'ติดตั้งเสร็จแล้วให้ปิดแล้วเปิด terminal ใหม่ แล้วกลับมาเมนูนี้อีกครั้ง' $LPM.C.Dim))
        return
    }
    if (Test-Cmd 'node') {
        Write-Tag 'ok' 'ติดตั้ง Node.js สำเร็จ' ((node --version) -join ' ')
        $LPM.Done['node'] = $true
    } else {
        Write-Tag 'err' 'ยังไม่พบคำสั่ง node — ลองปิดแล้วเปิด terminal ใหม่'
    }
}

# ---------- แถบ % ตอนโคลน ----------
function Draw-CloneBar([int]$Row, [int]$Percent, [string]$Phase, [int]$Tick, [double]$Seconds) {
    $spin = @('⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏')[$Tick % 10]
    $barW = [math]::Max(10, $LPM.W - 12)
    $w = $LPM.W
    $l1 = '  ' + (Get-GradBar $Percent $barW) + ' ' + (Paint ('{0,3}%' -f $Percent) $LPM.C.Text -Bold)
    $l2 = '  ' + (Paint $spin $LPM.C.Cyan -Bold) + ' ' + (Paint $Phase $LPM.C.Amber) + (Paint ('  ·  {0:N0} วินาที' -f $Seconds) $LPM.C.Dim)
    [Console]::SetCursorPosition(0, $Row)
    Write-Host $l1 -NoNewline
    [Console]::SetCursorPosition(0, $Row + 1)
    Write-Host (Pad-Right $l2 ($w + 2)) -NoNewline
}

# ---------- เมนู 3: git clone ลง C:\ ----------
function Clone-Repo {
    Show-ActionHeader 'clone' 'โคลนโปรเจกต์ลง C:\'
    if (-not (Test-Cmd 'git')) {
        Write-Tag 'err' 'ยังไม่ได้ติดตั้ง Git — เลือกเมนู "ติดตั้ง Git" ก่อน'
        return
    }
    if (Test-Path $LPM.AppDir) {
        Write-Tag 'warn' 'โฟลเดอร์มีอยู่แล้ว ข้ามการโคลน' $LPM.AppDir
        $LPM.Done['clone'] = $true
        return
    }
    Write-Tag 'info' 'กำลังโคลนโปรเจกต์จาก GitHub...'
    Write-Host ''
    Write-Host ''; Write-Host ''; Write-Host ''
    $barRow = [Console]::CursorTop - 3

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'git'
    $psi.Arguments = "clone --progress --branch $($LPM.Branch) --single-branch $($LPM.RepoUrl) `"$($LPM.AppDir)`""
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardOutput = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = [System.Diagnostics.Process]::Start($psi)

    $reader = $proc.StandardError
    $buf = New-Object char[] 2048
    $pct = 0; $tick = 0
    $phase = 'กำลังเชื่อมต่อ GitHub...'
    Set-CursorVisible $false
    Draw-CloneBar $barRow $pct $phase $tick $sw.Elapsed.TotalSeconds
    try {
        while (($n = $reader.Read($buf, 0, $buf.Length)) -gt 0) {
            $text = [System.String]::new($buf, 0, $n)
            $m = [regex]::Matches($text, '(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files):\s+(\d+)%')
            foreach ($x in $m) {
                $p = [int]$x.Groups[2].Value
                switch ($x.Groups[1].Value) {
                    'Counting objects'    { $phase = 'กำลังนับไฟล์ที่ต้องโหลด...' }
                    'Compressing objects' { $phase = 'GitHub กำลังเตรียมไฟล์...' }
                    'Receiving objects'   { $phase = 'กำลังรับไฟล์จาก GitHub...';   $pct = [math]::Max($pct, [int]($p * 0.85)) }
                    'Resolving deltas'    { $phase = 'กำลังประกอบข้อมูล...';         $pct = [math]::Max($pct, 85 + [int]($p * 0.10)) }
                    'Updating files'      { $phase = 'กำลังเขียนไฟล์ลงเครื่อง...';    $pct = [math]::Max($pct, 95 + [int]($p * 0.05)) }
                }
            }
            $tick++
            Draw-CloneBar $barRow $pct $phase $tick $sw.Elapsed.TotalSeconds
        }
    } catch { }
    $proc.WaitForExit()
    Set-CursorVisible $true
    [Console]::SetCursorPosition(0, $barRow + 3)

    if ($proc.ExitCode -eq 0) {
        Draw-CloneBar $barRow 100 'เสร็จเรียบร้อย' $tick $sw.Elapsed.TotalSeconds
        [Console]::SetCursorPosition(0, $barRow + 3)
        Write-Tag 'ok' 'โคลนสำเร็จ' $LPM.AppDir
        $LPM.Done['clone'] = $true
    } else {
        Write-Tag 'err' 'โคลนไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตและสิทธิ์เข้าถึง repo'
    }
}

# ---------- เมนู 4: เริ่มโปรแกรม + ขอบคุณ + นับถอยหลังปิด ----------
function Start-App {
    Show-ActionHeader 'start' 'เริ่มโปรแกรม'
    $vbs = Join-Path $LPM.AppDir 'start-label-pro-max-local.vbs'
    if (-not (Test-Path $vbs)) {
        Write-Tag 'err' 'ไม่พบไฟล์ start-label-pro-max-local.vbs'
        Write-Host ('  ' + (Paint 'เลือกเมนู "โคลนโปรเจกต์" ก่อน' $LPM.C.Dim))
        return
    }
    Write-Tag 'info' 'กำลังเริ่มโปรแกรม...'
    Start-Process wscript.exe -ArgumentList "`"$vbs`""
    $LPM.Done['start'] = $true

    Write-Host ''
    Show-Progress
    Write-Host ''
    Write-Card 'พร้อมใช้งานแล้ว' @(
        (Paint 'ขอบคุณที่ใช้ Label Pro Max Local ครับ!' $LPM.C.Green -Bold),
        ((Paint 'เปิดที่ ' $LPM.C.Dim) + (Paint $LPM.AppUrl $LPM.C.Cyan -Bold) + (Paint '  (โปรแกรมจะเปิดเบราว์เซอร์ให้เอง)' $LPM.C.Dim))
    )
    Write-Host ''
    $row = [Console]::CursorTop
    Set-CursorVisible $false
    for ($i = 5; $i -ge 1; $i--) {
        $bar = Get-GradBar ([int]($i / 5 * 100)) 20
        [Console]::SetCursorPosition(0, $row)
        Write-Host (Pad-Right ('  ' + (Paint "หน้าต่างนี้จะปิดใน $i วินาที  " $LPM.C.Amber) + $bar) ($LPM.W + 2)) -NoNewline
        Start-Sleep -Seconds 1
    }
    Set-CursorVisible $true
    Write-Host ''
    exit
}

# ---------- เริ่มทำงาน ----------
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
try { $Host.UI.RawUI.WindowTitle = 'Label Pro Max Local · Installer' } catch { }
$LPM.Ansi  = [bool](Enable-Vt)
$LPM.Emoji = Test-EmojiTerminal

if (Test-Cmd 'git')  { $LPM.Done['git'] = $true }
if (Test-Cmd 'node') {
    $v = node --version
    if ($v -match '^v(2[2-9]|[3-9][0-9])') { $LPM.Done['node'] = $true }
}
if (Test-Path $LPM.AppDir) { $LPM.Done['clone'] = $true }

$menuItems = @()
foreach ($s in $LPM.Steps) {
    $menuItems += @{ Key = $s.Key; Label = $s.Label; Desc = $s.Desc; IconShown = (Get-StepIcon $s.Key) }
}
$menuItems += @{ Key = 'exit'; Label = 'ออกจากเมนู'; Desc = 'ปิดตัวติดตั้ง — กลับมาติดตั้งต่อได้ทุกเมื่อ'; IconShown = (Get-StepIcon 'exit') }

# วนลูปเมนูหลัก (รอบแรกมีอนิเมชันแบนเนอร์ · กดปุ่มใดๆ เพื่อข้าม)
$first = $true
try {
    while ($true) {
        Show-Header -Animate:$first
        $first = $false
        Write-Host ''
        Show-Progress

        $nextKey = Get-NextKey
        $start = 0
        if ($nextKey) { $start = [array]::IndexOf(@($menuItems | ForEach-Object { $_.Key }), $nextKey) }
        $choice = Show-Menu 'ต้องการทำอะไร?' $menuItems $start

        switch ($choice) {
            0 { Install-Git }
            1 { Install-Node }
            2 { Clone-Repo }
            3 { Start-App }
            default {
                Write-Host ''
                Write-Host ('  ' + (Paint-Gradient 'แล้วเจอกันใหม่ครับ' -Bold))
                Write-Host ''
                return
            }
        }
        Wait-Back
    }
} finally {
    Set-CursorVisible $true
}
