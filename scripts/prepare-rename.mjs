// Maintenance snapshot before moving the actual project, never used by tests.
import Database from 'better-sqlite3';
import {DB_PATH} from '../server/paths.mjs';
import {isLockActive} from '../server/process-lock.mjs';
import {createLocalBackup} from '../server/local-backup.mjs';
if(['runtime','server','worker'].some(role=>isLockActive(`${DB_PATH}.${role}.lock`)))throw Error('กรุณารอระบบปิดให้เรียบร้อยก่อนย้ายโฟลเดอร์');
const db=new Database(DB_PATH,{readonly:true});
try {
 if(db.prepare("SELECT 1 FROM print_jobs WHERE status IN ('queued','printing')").get())throw Error('ยังมีงานรอหรือกำลังพิมพ์ กรุณาจัดการคิวก่อนย้ายโฟลเดอร์');
 console.log(await createLocalBackup(db,undefined,'before-rename'));
} finally {db.close();}
