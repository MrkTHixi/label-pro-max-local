# LabelPro Local 🏷️

ระบบพิมพ์ฉลากพัสดุ 100×150 มม. ภาษาไทย แบบ **local-first** สำหรับร้านเล็ก (ออกแบบให้ CoffeeWORKS Pattaya)

**หลักการ:** แต่ละสาขารันระบบทั้งชุดบน PC ของตัวเอง — ไม่ใช้ cloud ในการทำงานประจำวัน ไม่ซิงค์ข้ามสาขา ไม่มี account ส่วนตัวไปผูกกับงาน

```
┌─────────────────────────────────────────────┐
│  PC ประจำสาขา (Windows) — 1 เครื่องจบ       │
│                                             │
│  browser ──► Web UI (http://localhost:3000) │
│                   │                         │
│                   ▼                         │
│              server/index.mjs (Express)      │
│               ├── SQLite (data/labelpro.db) │
│               └── สั่งพิมพ์ = insert คิว    │
│                                             │
│  server/print-worker.mjs (process แยก)      │
│       ทุก 3 วิ: ดึงงาน queued → พิมพ์       │
│                   │                         │
│                   ▼                         │
│         Thermal printer (USB)               │
│                                             │
│  scripts/backup.mjs ──► git repo แยก        │
│  scripts/update.mjs ◄── GitHub (auto-pull)│
└─────────────────────────────────────────────┘
```

## เริ่มใช้งาน (ไม่ต้องใช้ terminal)

**วิธีปกติ — ดับเบิลคลิกไฟล์เดียวจบ:**
1. ติดตั้ง **Node.js 22 LTS** จาก https://nodejs.org (ครั้งเดียว)
2. แตกไฟล์โปรเจกต์ไว้ที่ไหนก็ได้ (เช่น `Desktop\labelpro-local`)
3. **ดับเบิลคลิก `start-labelpro.bat`** — ที่เหลือจัดการให้หมด:
   - `npm install` ให้เองถ้าเป็นครั้งแรก
   - ดึงโค้ดล่าสุดจาก GitHub ให้อัตโนมัติ (ถ้าเน็ตล่ม/ดึงไม่ได้ ก็รันเวอร์ชันเดิมต่อ ไม่พัง)
   - สตาร์ท server (API+เว็บ) และ print worker พร้อมกัน
   - เปิด browser ไปที่ **http://localhost:3000** ให้เอง

**สำหรับ dev** (ไม่อยากให้ pull / อยากรันแยก):
```powershell
npm run server   # เฉพาะ server — ไม่ pull โค้ด
npm run worker   # เฉพาะ print worker
```
> `npm start` = โหมดใช้งานจริง (pull → server+worker → เปิด browser)

> **ติดตั้งเป็นแอป**: แอปมี `manifest.json` + ไอคอนพร้อมแล้ว — เปิด http://localhost:3000 ใน Chrome/Edge บนมือถือหรือ PC แล้วเลือก "ติดตั้งแอป"/"Add to Home Screen" จะได้ไอคอนโลโก้ร้านเปิดแบบเต็มจอ (standalone) เหมือนแอปจริง

## ย้ายข้อมูลออกจาก Excel (ฟอร์แมตจริง 4 คอลัมน์)

```powershell
node scripts/import-excel.mjs "C:\path\to\ลูกค้า.xlsx"
```

หรือกดปุ่ม **📥 นำเข้า Excel** ในหน้าลูกค้า — เลือกไฟล์ `.xlsx` แล้วอัปโหลดผ่านเว็บได้เลย (API: `POST /api/import-excel`, multipart form field `file`)

อ่านชีตชื่อ `PrintLabel` ตามฟอร์แมตจริงของร้าน: **A=ชื่อสถานที่, B=กรุณาส่ง, C=ที่อยู่, D=ติดต่อ** — ตรวจจับแถวหัวตารางอัตโนมัติ (แถวที่มีคำว่า "ชื่อสถานที่") แล้วข้าม ข้ามแถวที่ A ว่าง ไฟล์ Excel ต้นฉบับไม่ถูกแตะต้อง

> **ชื่อสถานที่** คือชื่อย่อที่พนักงานตั้งจดจำลูกค้า (เช่น บ้าน, โรงงาน) — เป็นคีย์หลักในการค้นหา

## วิธีพิมพ์ (โฟลว์ใหม่ตาม mockup v3)

1. **ค้นหา** — พิมพ์ค้นหา (ชื่อสถานที่ / กรุณาส่ง / ติดต่อ) → เลือกการ์ดแล้วดูตัวอย่างฉลากด้านขวา
2. **ดับเบิลคลิก**ที่การ์ด (หรือกดปุ่ม 🖨️ บนการ์ด สำหรับจอสัมผัส) → popup "ตัวเลือกการพิมพ์"
3. เลือกข้อความ (📦 มีเอกสารค่ะ / 💝 ขอบคุณค่ะ) + จำนวน (stepper −/+ 1–20, ปุ่มลัด +2/+4/+6/+8 บวกเพิ่ม, รีเซ็ตเป็น 1) + ชื่อผู้สั่งพิมพ์ → กด **สั่งพิมพ์**
4. popup **"สั่งพิมพ์สำเร็จ!"** กลางจอ — แสดง "ขอบคุณที่ใช้งาน LabelPro Local", คำทักทายตามวันจริง (สวัสดีวันจันทร์…), สุ่มคำอวยพร 1 ข้อ ปิดอัตโนมัติใน 5 วินาที

กด "สั่งพิมพ์" = `INSERT` แถวเดียวลงตาราง `print_jobs` สถานะ `queued` แล้วตอบกลับทันที **ไม่เคยรอเครื่องพิมพ์** — worker แยก process ดึงงานทีละใบแบบ atomic พิมพ์เสร็จ mark `done` / พัง mark `failed`

**คำอวยพร** เก็บในไฟล์ `blessings.json` ที่ root ของโปรเจกต์ (array ของข้อความ) — แก้ไฟล์แล้ว `git push` เครื่องสาขา `git pull` (หรือกดอัปเดตในแอป) ก็ได้คำอวยพรชุดใหม่ทันที **ไม่ต้อง restart server** (API อ่านไฟล์สดทุกครั้ง) / `GET /api/blessings` คืน `{blessings, day, greeting}` โดยชื่อวันคำนวณตามเวลา Asia/Bangkok ฝั่ง server

บล็อกผู้รับบนฉลาก: **ชื่อสถานที่ตัวใหญ่ → กรุณาส่ง → ที่อยู่ → ติดต่อ** ส่วนผู้ส่งมีช่อง **ที่อยู่เพิ่มเติม** (ตั้งในหน้า ⚙️)

## ต่อเครื่องพิมพ์จริง (Grozziie TP518)

TP518 เป็นเครื่องพิมพ์แบบ **Windows-driver-based** (ไม่มี TSPL/ZPL ให้ส่งคำสั่งตรง)
ระบบจึงพิมพ์ด้วยวิธี: **เรนเดอร์ฉลากเป็น PDF ขนาด 100×150 มม. เป๊ะ → ส่งเข้า
Windows print spooler แบบเงียบ** ผ่าน `WindowsPdfDriver` (ค่าเริ่มต้นบน Windows)

### ขั้นตอนบน PC ที่ต่อเครื่องพิมพ์

1. **ติดตั้ง driver TP518** จากแผ่น/เว็บผู้ผลิต แล้วเสียบสาย USB
2. **ตั้งขนาดกระดาษ 100×150 มม.**:
   - เปิด `Control Panel → Devices and Printers` → คลิกขวาเครื่องพิมพ์ → *Printing preferences*
   - สร้าง/เลือก custom form **100 × 150 mm** (บาง driver เรียกว่า *Label Size* / *Page Setup*)
     แล้วตั้งเป็นขนาดเริ่มต้น — ขั้นนี้สำคัญที่สุด ถ้าขนาดผิดฉลากจะเพี้ยน
3. **คัดลอกชื่อเครื่องพิมพ์** ให้ตรงเป๊ะ ๆ (เช่น `Grozziie TP518`) แล้วใส่ในแอปที่
   หน้า **⚙️ ตั้งค่า → ชื่อเครื่องพิมพ์ (Windows)** แล้วกดบันทึก
   (หรือตั้ง env `PRINTER_NAME` ก่อนรัน worker ก็ได้)
4. **ทดสอบ 1 ใบก่อน**: สั่งพิมพ์จากหน้าเว็บ 1 ใบ แล้วดูผลบนกระดาษจริง
5. รัน worker ตามปกติ: `npm run worker` (ไม่ต้องตั้ง `PRINT_DRIVER` — บน Windows
   จะเลือก `windows` ให้อัตโนมัติ; อยากกลับไปโหมดทดสอบใช้ `PRINT_DRIVER=mock`)

### วิธีทำงานข้างใน (เผื่อ debug)

- `server/label-pdf.mjs` เรนเดอร์ฉลากเป็น PDF — ฟอนต์ **Tahoma** (ติดมากับ Windows
  มีไทย+ละตินครบ) และจัดวางสระบน/ล่าง-วรรณยุกต์เอง (pdfkit ไม่ทำ Thai shaping)
- `server/printer-drivers.mjs` → `WindowsPdfDriver`: เขียน PDF ชั่วคราวลง `printed/`
  แล้วเรียก `pdf-to-printer` ด้วย `{ scale: 'noscale' }` (พิมพ์ขนาดจริง ไม่ย่อ/ขยาย)
  สำเร็จแล้วลบไฟล์ temp ทิ้ง — ถ้าล้มเหลวจะ**เก็บ PDF ไว้** + mark งานเป็น failed
  พร้อมข้อความ error ในหน้าคิวงาน
- ชื่อเครื่องพิมพ์หาแบบนี้: env `PRINTER_NAME` → `settings.printer_name` →
  ถ้าไม่มีจะ error ภาษาไทยบอกให้ไปตั้งค่า

### แก้ปัญหาเบื้องต้น

| อาการ | สาเหตุที่น่าจะใช่ |
|---|---|
| ฉลากเพี้ยน/ไม่เต็มใบ/มีขอบขาว | ขนาดกระดาษใน driver ไม่ใช่ 100×150mm → กลับไปทำข้อ 2 |
| พิมพ์ออกมาเป็นกระดาษเปล่า | driver ตั้งความเข้ม (darkness) ต่ำไป หรือเลือก printer ผิดตัว |
| ตัวหนังสือเพี้ยน/สี่เหลี่ยม | Windows ไม่มีฟอนต์ Tahoma (ปกติติดมากับ Windows อยู่แล้ว) |
| งานค้าง status failed: "ยังไม่ได้ตั้งชื่อเครื่องพิมพ์" | ใส่ชื่อ printer ในหน้าตั้งค่าให้ตรงกับ Devices and Printers เป๊ะ |
| งาน failed อื่น ๆ | เปิดไฟล์ `printed/job-XXXXX.pdf` ดู — ถ้า PDF ถูก = ปัญหาที่ฝั่ง driver/spooler |

> **พูดตรง ๆ**: การเรนเดอร์ PDF ตรวจแล้วว่าถูกต้อง (เทส 49 ข้อ + ดูไฟล์จริง)
> แต่**การพิมพ์ลงกระดาษจริงยังไม่ได้ทดสอบ** (ไม่มีเครื่องพิมพ์ในสภาพแวดล้อมนี้)
> — ขอให้ลองพิมพ์จริง 1 ใบก่อนแล้วบอกผล จะได้ปรับต่อถ้าขนาด/ตำแหน่งเพี้ยน

### โหมดทดสอบ (ไม่มีเครื่องพิมพ์)

บนเครื่อง dev ตั้ง `PRINT_DRIVER=mock` (หรือรันบน Linux/macOS — จะเป็น mock
อัตโนมัติ) worker จะเขียนฉลากเป็นไฟล์ `.txt` ลง `printed/` แทนการพิมพ์จริง

## สำรองข้อมูลขึ้น git (ตามโจทย์)

- **ทำไมเป็น SQL text ไม่ใช่ไฟล์ .db**: git diff อ่านรู้เรื่อง, กู้ข้ามเวอร์ชันได้, ไฟล์เล็กกว่าเมื่อ gzip
- **เมื่อไรถึงสำรอง**: มีแค่ 2 กรณี — (1) **เพิ่มลูกค้าใหม่สำเร็จ** (อัตโนมัติทันที เบื้องหลัง ไม่บล็อก) (2) กดปุ่ม **"สำรองข้อมูลตอนนี้"** ในหน้า Settings — **ไม่มีสำรองตามเวลาอัตโนมัติ** ตามที่เจ้าของร้านกำหนด
- **repo แยก**: backup ถูก commit ลง `data-backup/` ซึ่งเป็น **git repo ของตัวเอง** (init อัตโนมัติ) ไม่ปนกับ repo โค้ด แล้ว push ไป `backup_repo_url` ที่ตั้งในหน้า Settings — บนเครื่องสาขาใช้ URL แบบ SSH (`git@github.com:MrkTHixi/labelpro-backups.git`) คู่กับ deploy key ไม่ต้องล็อกอิน (ดูหัวข้อ Deploy Key ด้านล่าง)
- **เน็ตล่ม**: commit เก็บไว้ในเครื่องก่อน รันครั้งหน้าจะ push commit ที่ค้างทั้งหมดให้เอง
- กด "สำรองข้อมูลตอนนี้" ในหน้า Settings ได้ทุกเมื่อ / ดูประวัติในตาราง `backup_log`
- กู้คืน: `node scripts/restore.mjs backups/labelpro-YYYYMMDD-HHMMSS.sql.gz` (มีสำรอง .bak ของ db เดิมให้ก่อนทับเสมอ)

## อัปเดตแอปจาก GitHub (อัตโนมัติ)

repo โค้ด: `github.com/MrkTHixi/labelpro-local` (branch `main`)

- **อัตโนมัติทุกครั้งที่เปิดแอป**: `npm start` / ดับเบิลคลิก `start-labelpro.bat` จะ `git pull --ff-only` ให้ก่อนเสมอ — มีของใหม่ก็ได้ใช้ทันที
- ถ้า pull ไม่ได้ (เน็ตล่ม/ยังไม่ผูก remote/มีไฟล์แก้ค้าง) **แอปจะรันเวอร์ชันเดิมต่อ ไม่พัง** แล้วเขียนบอกเหตุผลใน log
- ปุ่ม "อัปเดตแอปจาก GitHub" ในหน้า Settings ยังมี (= `git pull` เบื้องหลัง แล้ว restart แอป)
- ทดสอบ/แก้โค้ดบนเครื่องตัวเอง (`npm run server` ธรรมดา) → push ขึ้น GitHub → CI (`.github/workflows/ci.yml`) รัน smoke test ให้ → เครื่องสาขาดึงอัตโนมัติตอนเปิดครั้งถัดไป

## ติดตั้งบนเครื่องสาขาโดยไม่ต้องล็อกอิน GitHub (Deploy Key)

เจ้าของร้านไม่ต้องเอา account GitHub ส่วนตัวไปล็อกอินบน PC สาขา — ใช้ **SSH deploy key ประจำเครื่อง** แทน (อ่านโค้ดได้อย่างเดียว / push backup ได้ ไม่มีสิทธิ์แตะต้อง repo อื่น)

**1. บน PC สาขา — สร้าง key** (เปิด PowerShell รันทีละบรรทัด):
```powershell
ssh-keygen -t ed25519 -C "labelpro-branch1" -f "$env:USERPROFILE\.ssh\id_ed25519"
```
กด **Enter 2 ครั้ง** (ไม่ต้องตั้ง passphrase) แล้ว copy ข้อความ key ส่งให้เจ้าของร้าน:
```powershell
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
```

**2. เจ้าของร้าน — เพิ่ม key ที่ GitHub** (ทำบน github.com, repo ละครั้ง):
- repo `labelpro-local` → **Settings → Deploy keys → Add deploy key** → วาง key → ตั้งชื่อเช่น `branch1-pc` → **ไม่ต้องติ๊ก** *Allow write access* (อ่านอย่างเดียว)
- repo `labelpro-backups` → ทำเหมือนกัน แต่ **ติ๊ก** *Allow write access* (สาขาต้อง push ไฟล์ backup ขึ้นไปได้)

**3. บน PC สาขา — clone ด้วย SSH:**
```powershell
git clone git@github.com:MrkTHixi/labelpro-local.git
```
ครั้งแรกจะมีถามเรื่อง host key — พิมพ์ `yes` ครั้งเดียว (ครั้งต่อไปแอปจัดการให้เองอัตโนมัติ)

**4. ในแอป** — หน้า ⚙️ ตั้งค่า → ช่อง **backup repo URL** ใส่:
```
git@github.com:MrkTHixi/labelpro-backups.git
```

**5. ดับเบิลคลิก `start-labelpro.bat`** ใช้งานได้เลย — auto-update (`git pull`) และ backup (`git push`) ทำงานผ่าน deploy key โดย**ไม่ต้องล็อกอิน GitHub บนเครื่องนี้เลย**

> ถ้า git error ขึ้นข้อความไทยบอกเองว่าต้องแก้ตรงไหน เช่น *"GitHub ปฏิเสธ SSH key — ยังไม่ได้เพิ่ม deploy key…"* (ล็อกอยู่ใน console / `backup_log`)

## รันตอนเปิดเครื่อง (ไม่ต้องกดเอง)

**วิธีที่แนะนำ — Task Scheduler:**
1. เปิด `Task Scheduler` → *Create Task…*
2. แท็บ *General*: ตั้งชื่อ `LabelPro Local`, ติ๊ก **"Run only when user is logged on"**
   (ต้องเห็น desktop เพราะต้องเปิด browser + เข้าถึง printer spooler)
3. แท็บ *Triggers* → *New…* → *Begin the task:* **At startup** → ติ๊ก *Delay task for:* **30 seconds** (รอเน็ต/ระบบพร้อมก่อน)
4. แท็บ *Actions* → *New…* → *Action:* Start a program → *Program/script:* เลือกไฟล์ **`start-labelpro-hidden.vbs`** ในโฟลเดอร์โปรเจกต์ (ตัวนี้รันแบบซ่อนหน้าต่าง)
5. กด OK — เปิดเครื่องครั้งถัดไป แอปจะติดขึ้นมาเองพร้อม browser

**ทางเลือกง่ายกว่า**: กด `Win+R` → พิมพ์ `shell:startup` → สร้าง shortcut ของ `start-labelpro-hidden.vbs` ไว้ในโฟลเดอร์นั้น — ได้ผลเหมือนกันตอน login

## API (เผื่อต่อยอด)

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | /api/health | สถานะ + ชื่อสาขา |
| GET | /api/customers?q= | ค้นหา (ชื่อสถานที่/กรุณาส่ง/ติดต่อ, เฉพาะที่ active) |
| GET | /api/customers?q= | ค้นหาลูกค้า (ชื่อสถานที่/กรุณาส่ง/ติดต่อ) |
| POST/PUT/DELETE | /api/customers[/:id] | DELETE = soft delete |
| GET/PUT | /api/sender | โปรไฟล์ผู้ส่ง (ชื่อ/เบอร์/ที่อยู่/ต.อ.จ.) |
| POST | /api/print | เข้าคิวพิมพ์ (non-blocking); `snapshot` สำหรับพิมพ์ซ้ำ |
| GET | /api/queue | 50 งานล่าสุด |
| POST | /api/queue/:id/cancel | ยกเลิกงานที่ยังรอคิว |
| POST | /api/import-excel | อัปโหลด .xlsx (multipart `file`) → รัน import |
| GET | /api/blessings | `{blessings, day, greeting}` — อ่าน blessings.json สดทุกครั้ง, ชื่อวันตามเวลา Asia/Bangkok |
| GET/PUT | /api/settings | branch_name, backup_repo_url |
| POST | /api/backup | สั่ง backup เบื้องหลัง |
| POST | /api/update | git pull เบื้องหลัง |

## ข้อจำกัด (พูดตรง ๆ)

- ไม่มีภาพรวมข้ามสาขา — ตั้งใจตามโจทย์ (ไม่ซิงค์) อยากดูยอดรวมต้องรวมรีพอร์ตเอง
- backup เป็นหน้าที่แต่ละสาขา (แต่แค่ไฟล์เดียว + ปุ่มเดียว)
- worker มีโหมด mock สำหรับ dev และโหมด windows (PDF → spooler) สำหรับเครื่องจริง — การพิมพ์ลงกระดาษจริงยังไม่ได้ทดสอบ (ไม่มีเครื่องพิมพ์ในสภาพแวดล้อมนี้) ลอง 1 ใบก่อนตามคู่มือ
- ถ้า PC สาขาพัง ระบบสาขานั้นหยุด — มีไฟล์ backup กู้กลับได้ในไม่กี่นาที
