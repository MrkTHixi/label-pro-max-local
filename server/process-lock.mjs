// server/process-lock.mjs — single-instance lock files with Windows PID-reuse protection.
//
// A lock file alone cannot prove "another instance is running": after a crash or a
// forced termination the lock file stays behind, and Windows reuses PIDs quickly.
// So when a lock file already exists we do NOT trust the recorded PID alone — on
// Windows we verify that the process is actually this application's role
// (node.exe running the expected entry script under this project root) before
// refusing to start. A lock whose PID belongs to an unrelated process is
// quarantined (renamed to "<file>.stale-<timestamp>", never silently deleted)
// and startup continues. A lock whose ownership is uncertain (process exists
// but cannot be inspected) is NEVER deleted — startup is refused with an
// actionable diagnostic instead.
//
// Lock file format (JSON): { pid, token, created, role }
import { openSync, readFileSync, writeFileSync, closeSync, unlinkSync, renameSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, basename } from 'node:path';

export const ALREADY_RUNNING_CODE = 'LABELPRO_ALREADY_RUNNING';
export const ALREADY_RUNNING_EXIT_CODE = 2;

// A lock file this young with unreadable content means another starter is
// still writing it — wait for it instead of stealing it.
const FRESH_LOCK_MS = 30_000;
const MAX_ATTEMPTS = 5;
// Quarantined "<file>.stale-*" copies older than this are cleaned up on acquire.
const QUARANTINE_TTL_MS = 7 * 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// Process inspection
// ---------------------------------------------------------------------------

// Identify the process behind a PID.
// Returns { alive, certain, image, commandLine } and never throws.
// - alive=false  → the PID is definitely dead (safe to recover the lock).
// - certain=false → the PID exists but we could not verify what it is
//   (e.g. EPERM on process.kill, or the Windows inspection tools failed).
//   Callers must treat this as "ownership uncertain": never delete the lock.
// Identity details (image/commandLine) are only available on Windows;
// on other platforms an alive PID is always `certain: false`.
export function probeProcess(pid, run = execFileSync) {
  const unknown = { alive: false, certain: true, image: null, commandLine: null };
  if (!Number.isInteger(pid) || pid < 1) return unknown;
  try {
    process.kill(pid, 0);
  } catch (error) {
    // EPERM = a process with this PID exists but we may not signal it
    // (elevated process, another session, ...). Ownership is uncertain.
    if (error.code === 'EPERM') return { ...unknown, alive: true, certain: false };
    return unknown; // ESRCH or invalid PID → definitely dead
  }
  if (process.platform !== 'win32') {
    return { ...unknown, alive: true, certain: false };
  }
  try {
    const list = run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const line = String(list).split(/\r?\n/).find((l) => l.trim().startsWith('"'));
    const image = line ? line.slice(1, line.indexOf('"', 1)).toLowerCase() : null;
    if (!image) return { ...unknown, alive: false, certain: true }; // vanished between checks
    let commandLine = null;
    try {
      commandLine = String(run('powershell.exe',
        ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`],
        { encoding: 'utf8', timeout: 8000, windowsHide: true })).trim() || null;
    } catch {
      // fall through with certain=false
    }
    return { alive: true, certain: !!commandLine, image, commandLine };
  } catch {
    return { ...unknown, alive: true, certain: false };
  }
}

// Legacy liveness probe: true when a process with this PID exists.
// NOTE: this alone cannot tell whether the process is ours — prefer
// matchesExpected() with an `expected` identity wherever possible.
export function isProcessAlive(pid) {
  return probeProcess(pid).alive;
}

// Does the probed process look like this application's expected role?
// expected = { root, script } e.g. { root: 'C:\\label-pro-max-local', script: 'server/index.mjs' }.
// Safety rules:
// - dead PID            → false (lock is stale)
// - no expected given   → any living PID counts (legacy PID-only mode)
// - uncertain ownership → true  (refuse to steal; the safe direction)
export function matchesExpected(probe, expected) {
  if (!probe || !probe.alive) return false;
  if (!expected || !expected.script) return true;
  if (!probe.certain) return true;
  const image = String(probe.image || '').toLowerCase();
  if (!/(^|\\)node(\.exe)?$/.test(image)) return false;
  const commandLine = String(probe.commandLine || '').replace(/\\/g, '/');
  if (!commandLine) return false;
  const script = String(expected.script).replace(/\\/g, '/');
  if (!commandLine.includes(script)) return false;
  if (expected.root) {
    const root = String(expected.root).replace(/\\/g, '/').toLowerCase();
    if (!commandLine.toLowerCase().includes(root)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lock file helpers
// ---------------------------------------------------------------------------

function mtimeMs(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// Move a stale/foreign lock aside instead of deleting it, so a mistaken
// recovery stays diagnosable. Never throws for a lock that is already gone
// (a racing starter cleared it); throws an actionable error when the file
// cannot be moved (e.g. permission problems).
function quarantineLock(file, reason, log) {
  const target = `${file}.stale-${Date.now()}`;
  try {
    renameSync(file, target);
    log?.(`quarantined ${file} -> ${basename(target)} (${reason})`);
  } catch (error) {
    if (error.code === 'ENOENT') return; // a racing starter already cleared it
    throw new Error(`ไม่สามารถจัดการไฟล์ล็อก ${file}: ${error.message} (สาเหตุ: ${reason})`);
  }
}

// Best-effort cleanup of our own old quarantine copies. Only touches files
// we created ("<file>.stale-<timestamp>"); never touches application data.
function cleanupQuarantined(file, log) {
  try {
    const dir = dirname(file);
    const prefix = `${basename(file)}.stale-`;
    const cutoff = Date.now() - QUARANTINE_TTL_MS;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      const stamp = Number(name.slice(prefix.length));
      if (!Number.isFinite(stamp) || stamp > cutoff) continue;
      try {
        unlinkSync(`${dir}/${name}`);
        log?.(`cleaned old quarantine ${name}`);
      } catch {
        // ignore
      }
    }
  } catch {
    // directory may not exist yet — ignore
  }
}

function alreadyRunningError(file, lock, probe) {
  const pid = lock && Number.isInteger(lock.pid) ? lock.pid : '?';
  const uncertain = !!(probe && probe.alive && !probe.certain);
  const message = uncertain
    ? `พบไฟล์ล็อกของระบบเดิม (PID ${pid}) แต่ยืนยันไม่ได้ว่าเป็น Label Pro Max Local จริงหรือไม่ หากมีระบบทำงานอยู่ให้ปิดด้วย stop-label-pro-max-local.vbs ก่อน หากแน่ใจว่าไม่มีระบบทำงานอยู่แล้ว ให้ลบไฟล์ ${file} แล้วลองใหม่`
    : `Label Pro Max Local กำลังทำงานอยู่แล้ว (PID ${pid}) หากต้องการเริ่มใหม่ ให้ปิดด้วย stop-label-pro-max-local.vbs ก่อน`;
  const error = new Error(message);
  error.code = ALREADY_RUNNING_CODE;
  error.exitCode = ALREADY_RUNNING_EXIT_CODE;
  error.detail = { file, pid, image: (probe && probe.image) || null, certain: !!(probe && probe.certain), uncertain };
  return error;
}

// Inspect an existing lock file. Returns { action: 'retry' } when the lock
// was stale/foreign and has been quarantined (caller should try acquiring
// again), or { action: 'throw', error } when startup must be refused.
function inspectExistingLock(file, { expected, probe, log }) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { action: 'retry' }; // vanished — try again
    throw new Error(`อ่านไฟล์ล็อก ${file} ไม่ได้: ${error.message}`);
  }
  let lock = null;
  try {
    lock = JSON.parse(raw);
  } catch {
    // malformed content below
  }
  const shapeOk = lock && Number.isInteger(lock.pid) && lock.pid >= 1 && typeof lock.token === 'string';
  if (!shapeOk) {
    if (Date.now() - mtimeMs(file) < FRESH_LOCK_MS) {
      // Another starter is probably still writing it — do not steal it.
      const error = new Error('Label Pro Max Local กำลังเริ่มระบบ กรุณารอสักครู่');
      error.code = ALREADY_RUNNING_CODE;
      error.exitCode = ALREADY_RUNNING_EXIT_CODE;
      error.detail = { file, pid: null, malformed: true, fresh: true };
      return { action: 'throw', error };
    }
    quarantineLock(file, 'malformed content', log);
    return { action: 'retry' };
  }
  const probed = probe(lock.pid);
  log?.(`existing lock: pid=${lock.pid} alive=${probed.alive} certain=${probed.certain} image=${probed.image || '-'} created=${lock.created ? new Date(lock.created).toISOString() : '-'}`);
  if (!probed.alive) {
    quarantineLock(file, `stale pid ${lock.pid}`, log);
    return { action: 'retry' };
  }
  if (matchesExpected(probed, expected)) {
    return { action: 'throw', error: alreadyRunningError(file, lock, probed) };
  }
  // Alive, but provably NOT this application (reused PID / unrelated process).
  quarantineLock(file, `foreign process pid ${lock.pid} (${probed.image || 'unknown image'})`, log);
  return { action: 'retry' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Acquire the single-instance lock at `file` (created atomically with 'wx').
// options: { expected: { root, script }, role, logger, probe }
// Returns a release() function guarded by a random token: only the owner can
// remove the lock. Throws when another instance is genuinely running, when
// lock ownership is uncertain, or when the lock file cannot be managed.
export function acquireLock(file, options = {}) {
  const { expected = null, role = 'app', logger = null, probe = probeProcess } = options;
  const log = logger ? (message) => { try { logger(`[lock:${role}] ${message}`); } catch { /* never break startup on logging */ } } : null;
  cleanupQuarantined(file, log);
  const token = randomUUID();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token, created: Date.now(), role }));
      } finally {
        try { closeSync(fd); } catch { /* ignore */ }
      }
      log?.(`acquired ${file} (pid=${process.pid})`);
      return () => releaseLock(file, token, { role, logger });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const outcome = inspectExistingLock(file, { expected, probe, log });
    if (outcome.action === 'retry') continue;
    throw outcome.error;
  }
  throw new Error(`ไม่สามารถล็อกการเริ่มระบบได้ (${file}) กรุณาลองใหม่`);
}

// Release a lock previously acquired by acquireLock(). Only removes the file
// when the stored token matches ours — never removes another owner's lock.
// Returns true when the lock is gone (or was already gone).
export function releaseLock(file, token, options = {}) {
  const { role = 'app', logger = null } = options;
  const log = logger ? (message) => { try { logger(`[lock:${role}] ${message}`); } catch { /* ignore */ } } : null;
  let current;
  try {
    current = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      log?.(`${file} already gone`);
      return true;
    }
    log?.(`release check failed for ${file}: ${error.message}`);
    return false;
  }
  if (!current || current.token !== token) {
    log?.(`not the owner of ${file}; kept`);
    return false;
  }
  try {
    unlinkSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    log?.(`release failed for ${file}: ${error.message}`);
    return false;
  }
  log?.(`released ${file}`);
  return true;
}

// Notify the parent process over IPC, then exit with the given code.
// process.send() is asynchronous, so the callback (plus a safety timeout)
// guarantees the message is flushed before the process actually exits.
// Used by locked children (server/worker) to report "already running" to
// the runtime manager without the message being lost in an IPC race.
export function notifyParentAndExit(message, code) {
  if (process.send) {
    let done = false;
    const exit = () => { if (!done) { done = true; process.exit(code); } };
    try {
      process.send(message, exit);
    } catch {
      exit();
    }
    setTimeout(exit, 2000).unref();
  } else {
    process.exit(code);
  }
}

// True when the lock file describes a live instance of the expected role
// (or when ownership is uncertain — the safe direction for guards like
// restore, which must not run while another instance might be active).
export function isLockActive(file, expected = null, probe = probeProcess) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  if (!lock || !Number.isInteger(lock.pid) || lock.pid < 1) return false;
  let probed;
  try {
    probed = probe(lock.pid);
  } catch {
    return true; // probe failure → assume active (safe direction)
  }
  if (!probed.alive) return false;
  return matchesExpected(probed, expected);
}
