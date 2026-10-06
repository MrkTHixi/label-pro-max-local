-- LabelPro Local — schema v2
-- รันอัตโนมัติตอน server start ครั้งแรก (ดู server/db.mjs)
-- รูปแบบข้อมูลตามไฟล์ Excel จริงของร้าน: 4 คอลัมน์
--   A=ชื่อสถานที่ (place_name: ชื่อย่อที่พนักงานใช้จำลูกค้า = คีย์หลักในการค้นหา)
--   B=กรุณาส่ง   (attention_name: ชื่อผู้รับ/ส่งถึงใคร)
--   C=ที่อยู่      (address)
--   D=ติดต่อ      (contact: ข้อความอิสระ ผสมชื่อ+เบอร์โทรได้)

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_name TEXT NOT NULL,
  attention_name TEXT DEFAULT '',
  address TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_place ON customers(place_name);
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(is_active);

-- โปรไฟล์ผู้ส่ง: มีแถวเดียวเสมอ (id = 1)
CREATE TABLE IF NOT EXISTS sender_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sender_name TEXT DEFAULT '',
  sender_address TEXT DEFAULT '',
  sender_phone TEXT DEFAULT '',
  sender_address_extra TEXT DEFAULT ''
);
INSERT OR IGNORE INTO sender_profile (id) VALUES (1);

-- คิวงานพิมพ์: UI แค่ insert แถว status='queued' แล้วตอบกลับทันที
-- print-worker (process แยก) จะมา claim แล้วพิมพ์ ไม่บล็อก UI
-- คอลัมน์ place_name/attention_name/address/contact = snapshot ข้อมูลตอนสั่งพิมพ์
CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  place_name TEXT DEFAULT '',
  attention_name TEXT DEFAULT '',
  address TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  sender_name TEXT DEFAULT '',
  sender_address TEXT DEFAULT '',
  sender_phone TEXT DEFAULT '',
  sender_address_extra TEXT DEFAULT '',
  message TEXT DEFAULT '',  copies INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | printing | done | failed | cancelled
  error TEXT,
  printed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  printed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON print_jobs(status, id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('branch_name', ''),
  ('backup_repo_url', '');

CREATE TABLE IF NOT EXISTS backup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
