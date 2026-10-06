@echo off
REM ============================================================
REM  LabelPro Local — ดับเบิลคลิกไฟล์นี้เพื่อเริ่มระบบ
REM  ไม่ต้องเปิด terminal เอง / ไม่ต้อง cd — ไฟล์นี้จัดการให้หมด
REM  สิ่งที่จะเกิด: ดึงโค้ดล่าสุดจาก GitHub (ถ้าเน็ตล่มก็ข้าม)
REM                 → สตาร์ท server + worker → เปิด browser ให้เอง
REM ============================================================

REM ย้ายมาที่โฟลเดอร์ของไฟล์นี้ก่อน (กันปัญหา cd ไม่ผ่าน)
cd /d "%~dp0"

REM ตรวจว่ามี Node.js ไหม
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ผิดพลาด] ไม่พบ Node.js — โหลด Node.js LTS จาก https://nodejs.org มาติดตั้งก่อน
  echo.
  pause
  exit /b 1
)

REM ตรวจว่ามี node_modules ไหม (รันครั้งแรก)
if not exist "node_modules" (
  echo [ติดตั้ง] ไม่พบ node_modules — กำลัง npm install ครั้งแรก อาจใช้เวลาสักครู่…
  call npm install
  if errorlevel 1 (
    echo.
    echo [ผิดพลาด] npm install ไม่สำเร็จ — ตรวจเน็ตแล้วดับเบิลคลิกใหม่
    echo.
    pause
    exit /b 1
  )
)

call npm start
if errorlevel 1 (
  echo.
  echo [ผิดพลาด] โปรแกรมหยุดด้วยข้อผิดพลาด — แคปหน้าจอนี้ส่งให้ผู้ดูแลได้เลย
  echo.
  pause
)
