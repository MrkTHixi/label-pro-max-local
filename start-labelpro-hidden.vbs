' ============================================================
'  LabelPro Local — รันแบบซ่อนหน้าต่าง (ไม่มี console โผล่)
'  ใช้สำหรับ: Task Scheduler (รันตอนเปิดเครื่อง) หรือ Startup folder
'  ดับเบิลคลิกไฟล์นี้ = เริ่มระบบเงียบ ๆ เหมือนไฟล์ .bat แต่ไม่โชว์หน้าต่าง
' ============================================================
Dim fso, scriptDir, shell
Set fso = CreateObject("Scripting.FileSystemObject")
' หาโฟลเดอร์ของไฟล์ .vbs นี้ (ใช้ %~dp0 ไม่ได้ใน VBS)
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
' พารามิเตอร์ตัวที่ 2 = 0 หมายถึงซ่อนหน้าต่าง, ตัวที่ 3 = False หมายถึงไม่รอให้จบ
shell.Run "cmd /c cd /d """ & scriptDir & """ && npm start", 0, False
Set shell = Nothing
Set fso = Nothing
