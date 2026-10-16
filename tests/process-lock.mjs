// Process-lock regression tests for the Oct 2026 "already running" startup failure.
//
// Root cause: the old lock check trusted a PID alone
// (process.kill(pid, 0) success, or EPERM, meant "alive"). After an unclean
// shutdown the stale lock file survived, Windows reused the PID for an
// unrelated process, and every startup died at server/index.mjs with
// "Label Pro Max Local กำลังทำงานอยู่แล้ว" with no recovery path.
//
// These tests run on any OS. Windows-only identity inspection
// (tasklist + Get-CimInstance) is injected via fake probes; the real child
// processes below exercise genuine cross-process locking. Manual Windows
// verification that automated tests cannot cover:
//   1. tasklist/CIM identity path: kill node with Task Manager (forced, no
//      graceful exit), then start again — the stale lock must be quarantined
//      (renamed to "<db>.server.lock.stale-<ts>") and startup must succeed.
//   2. Genuinely duplicated server (orphaned node running server/index.mjs):
//      the second start must refuse with the PID in the message and the
//      runtime must exit cleanly reusing the old instance (no restart loop).
//   3. Uncertain ownership (locked PID belongs to an elevated process):
//      startup must refuse WITHOUT deleting the lock file, with an
//      actionable message naming the PID and the lock path.
//   4. Double-click the desktop shortcut twice: the second launch must reuse
//      the running server (also covered by tests/windows-launch.mjs on CI).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import {
  acquireLock, releaseLock, isLockActive, isProcessAlive, probeProcess, matchesExpected,
  ALREADY_RUNNING_CODE, ALREADY_RUNNING_EXIT_CODE,
} from '../server/process-lock.mjs';
import { describeChildExit } from '../scripts/runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_MJS_URL = pathToFileURL(join(ROOT, 'server', 'process-lock.mjs')).href;
const scratch = mkdtempSync(join(tmpdir(), 'labelpro-lock-test-'));
const lockPath = (name) => join(scratch, name);
const execFileAsync = promisify(execFile);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const silent = () => {};
const writeLock = (file, lock) => writeFileSync(file, JSON.stringify(lock));
const quarantined = (file) => readdirSync(dirname(file)).filter((n) => n.startsWith(`${file.split(/[\\/]/).pop()}.stale-`));
const probeReturning = (result) => () => result;
// acquireLock throws synchronously — capture instead of crashing the test.
const tryAcquire = (file, options) => {
  try {
    return { release: acquireLock(file, options) };
  } catch (error) {
    return { error };
  }
};

let holder = null;
try {
  // -- 1. first startup acquires the lock ---------------------------------
  {
    const file = lockPath('first.lock');
    const release = acquireLock(file, { role: 'server', logger: silent });
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(stored.pid, process.pid);
    assert.equal(typeof stored.token, 'string');
    assert.equal(stored.role, 'server');
    assert.equal(release(), true);
    assert.ok(!existsSync(file), 'release removes the lock file');
    console.log('ok 1 - first startup acquires the lock; release removes it');
  }

  // -- 2/3/8. genuine holder, SIGKILL, stale recovery ----------------------
  {
    const file = lockPath('holder.lock');
    const holderSrc = join(scratch, 'holder.mjs');
    writeFileSync(holderSrc, `import { acquireLock } from ${JSON.stringify(LOCK_MJS_URL)};
const release = acquireLock(process.argv[2], { role: 'server', expected: { root: process.argv[3], script: 'holder.mjs' }, logger: () => {} });
if (process.send) process.send({ type: 'held' }); else console.log('held');
setInterval(() => {}, 10000);
`);
    holder = fork(holderSrc, [file, scratch], { silent: true });
    await once(holder, 'message', { signal: AbortSignal.timeout(15000) }).catch(() => { throw new Error('holder did not acquire the lock'); });

    const logs = [];
    const { release: second, error } = tryAcquire(file, { role: 'server', expected: { root: scratch, script: 'holder.mjs' }, logger: (m) => logs.push(m) });
    assert.ok(!second, 'second startup must not acquire the lock');
    assert.ok(error, 'second startup must be rejected while the holder is alive');
    // On Windows the holder's identity verifies -> "already running"; on other
    // platforms identity is unavailable -> "cannot verify" (safe direction).
    assert.match(error.message, /กำลังทำงานอยู่แล้ว|ยืนยันไม่ได้/);
    assert.equal(error.code, ALREADY_RUNNING_CODE);
    assert.equal(error.exitCode, ALREADY_RUNNING_EXIT_CODE);
    assert.equal(error.detail.pid, holder.pid);
    assert.ok(logs.some((m) => m.includes('existing lock: pid=')), 'diagnostic log records the recorded PID');
    console.log('ok 2 - second startup rejected while the original server is genuinely alive');

    holder.kill('SIGKILL');
    await once(holder, 'exit');
    holder = null;
    await wait(200);
    assert.ok(existsSync(file), 'forced termination leaves the lock file behind (release never ran)');
    const release = acquireLock(file, { role: 'server', expected: { root: scratch, script: 'holder.mjs' }, logger: silent });
    assert.equal(quarantined(file).length, 1, 'stale lock quarantined, not silently deleted');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, process.pid, 'new owner holds the lock');
    assert.equal(release(), true);
    console.log('ok 3/8 - stale lock after forced termination is recovered safely');
  }

  // -- 4. malformed lock data ----------------------------------------------
  {
    const fresh = lockPath('malformed-fresh.lock');
    writeFileSync(fresh, 'not-json{{{');
    const { error } = tryAcquire(fresh, { role: 'server', logger: silent });
    assert.ok(error, 'fresh malformed lock must not be stolen');
    assert.match(error.message, /กำลังเริ่มระบบ/);
    assert.ok(existsSync(fresh), 'fresh malformed lock is left untouched');
    const old = lockPath('malformed-old.lock');
    writeFileSync(old, 'not-json{{{');
    const past = new Date(Date.now() - 60000);
    utimesSync(old, past, past);
    const release = acquireLock(old, { role: 'server', logger: silent });
    assert.equal(quarantined(old).length, 1, 'old malformed lock quarantined');
    assert.equal(release(), true);
    console.log('ok 4 - malformed lock data handled safely (fresh waits, old quarantined)');
  }

  // -- 5. unrelated process / reused PID ------------------------------------
  {
    const file = lockPath('foreign.lock');
    writeLock(file, { pid: process.pid, token: 'foreign-token', created: Date.now(), role: 'server' });
    const foreignProbe = probeReturning({ alive: true, certain: true, image: 'chrome.exe', commandLine: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
    const release = acquireLock(file, {
      role: 'server',
      expected: { root: scratch, script: 'server/index.mjs' },
      probe: foreignProbe,
      logger: silent,
    });
    assert.equal(quarantined(file).length, 1, 'lock pointing at an unrelated process is quarantined');
    assert.equal(release(), true);
    console.log('ok 5a - reused PID belonging to an unrelated process does not block startup');

    const uncertainFile = lockPath('uncertain.lock');
    writeLock(uncertainFile, { pid: process.pid, token: 'uncertain-token', created: Date.now(), role: 'server' });
    const uncertainProbe = probeReturning({ alive: true, certain: false, image: null, commandLine: null });
    const { error } = tryAcquire(uncertainFile, {
      role: 'server',
      expected: { root: scratch, script: 'server/index.mjs' },
      probe: uncertainProbe,
      logger: silent,
    });
    assert.ok(error, 'uncertain ownership must refuse startup');
    assert.match(error.message, /ยืนยันไม่ได้/);
    assert.equal(error.detail.uncertain, true);
    assert.ok(existsSync(uncertainFile), 'lock with uncertain ownership is NEVER deleted');
    console.log('ok 5b - uncertain lock ownership refuses startup without deleting the lock');
  }

  // -- 6. concurrent startup attempts ---------------------------------------
  {
    const file = lockPath('race.lock');
    const racerSrc = join(scratch, 'racer.mjs');
    writeFileSync(racerSrc, `import { acquireLock } from ${JSON.stringify(LOCK_MJS_URL)};
try {
  const release = acquireLock(process.argv[2], { role: 'server', logger: () => {} });
  await new Promise((r) => setTimeout(r, 1500)); // hold the lock while rivals attempt
  release();
  console.log('won');
} catch (error) { console.log('lost:' + String(error.message).split('\\n')[0]); }
`);
    const runs = await Promise.all(Array.from({ length: 8 }, () =>
      execFileAsync(process.execPath, [racerSrc, file], { timeout: 30000 }).then(
        ({ stdout }) => stdout.trim(),
        (e) => `error:${e.message}`)));
    const winners = runs.filter((r) => r === 'won');
    assert.equal(winners.length, 1, `exactly one starter wins the race (got ${winners.length}: ${runs.join(' | ')})`);
    console.log('ok 6 - concurrent startup attempts cannot both acquire the lock');
  }

  // -- 7. release is token-guarded -------------------------------------------
  {
    const file = lockPath('guarded.lock');
    const release = acquireLock(file, { role: 'server', logger: silent });
    assert.equal(releaseLock(file, 'bogus-token', { logger: silent }), false, 'wrong token must not release');
    assert.ok(existsSync(file), 'lock survives a foreign release attempt');
    assert.equal(release(), true);
    assert.equal(releaseLock(file, 'bogus-token', { logger: silent }), true, 'releasing a missing lock is a no-op success');
    console.log('ok 7 - release only removes the lock owned by this process');
  }

  // -- 8b. isLockActive with identity ----------------------------------------
  {
    const file = lockPath('active.lock');
    const expected = { root: 'C:\\label-pro-max-local', script: 'server/index.mjs' };
    writeLock(file, { pid: 4242, token: 't', created: Date.now(), role: 'server' });
    assert.equal(isLockActive(file, expected, probeReturning({ alive: false, certain: true })), false, 'dead PID is not active');
    assert.equal(isLockActive(file, expected, probeReturning({ alive: true, certain: true, image: 'node.exe', commandLine: 'C:\\other\\node.exe C:\\other\\server\\index.mjs' })), false, 'foreign root is not active');
    assert.equal(isLockActive(file, expected, probeReturning({ alive: true, certain: true, image: 'node.exe', commandLine: 'C:\\label-pro-max-local\\node.exe C:\\label-pro-max-local\\server\\index.mjs' })), true, 'matching identity is active');
    assert.equal(isLockActive(file, expected, probeReturning({ alive: true, certain: false })), true, 'uncertain ownership counts as active (safe direction)');
    writeFileSync(file, 'garbage');
    assert.equal(isLockActive(file, expected), false, 'malformed lock is not active');
    assert.equal(isLockActive(lockPath('missing.lock'), expected), false, 'missing lock is not active');
    console.log('ok 8b - isLockActive honors process identity');
  }

  // -- 9. runtime does not restart-loop on "already running" ------------------
  {
    const reuse = describeChildExit({ role: 'server', code: ALREADY_RUNNING_EXIT_CODE, alreadyRunning: { message: 'Label Pro Max Local กำลังทำงานอยู่แล้ว (PID 4242)' } });
    assert.equal(reuse.action, 'reuse');
    assert.match(reuse.message, /ไม่เริ่มซ้ำ/);
    const codeOnly = describeChildExit({ role: 'server', code: ALREADY_RUNNING_EXIT_CODE });
    assert.equal(codeOnly.action, 'reuse', 'exit code 2 alone (lost IPC) still reuses the instance');
    const crash = describeChildExit({ role: 'server', code: 1 });
    assert.equal(crash.action, 'fail');
    assert.match(crash.message, /server หยุดทำงาน \(1\)/);
    const sig = describeChildExit({ role: 'worker', code: null, signal: 'SIGTERM' });
    assert.equal(sig.action, 'fail');
    assert.match(sig.message, /SIGTERM/);
    console.log('ok 9 - "already running" child exit reuses the instance instead of restarting');
  }

  // -- 10. probe / matcher unit checks ----------------------------------------
  {
    for (const bad of [-1, 0, 1.5, NaN, '123', null, undefined]) assert.equal(probeProcess(bad).alive, false, `pid ${String(bad)} is not alive`);
    assert.equal(probeProcess(process.pid).alive, true, 'own pid is alive');
    assert.equal(isProcessAlive(process.pid), true);
    assert.equal(isProcessAlive(99999999), false);
    const expected = { root: 'C:\\label-pro-max-local', script: 'server/index.mjs' };
    const nodeCmd = '"C:\\label-pro-max-local\\node.exe" "C:\\label-pro-max-local\\server\\index.mjs"';
    assert.equal(matchesExpected({ alive: true, certain: true, image: 'node.exe', commandLine: nodeCmd }, expected), true);
    assert.equal(matchesExpected({ alive: true, certain: true, image: 'NODE.EXE', commandLine: nodeCmd }, expected), true);
    assert.equal(matchesExpected({ alive: true, certain: true, image: 'chrome.exe', commandLine: 'C:\\x\\chrome.exe' }, expected), false);
    assert.equal(matchesExpected({ alive: true, certain: true, image: 'node.exe', commandLine: '"C:\\label-pro-max-local\\node.exe" "C:\\label-pro-max-local\\scripts\\runtime.mjs"' }, expected), false, 'runtime is not the server');
    assert.equal(matchesExpected({ alive: true, certain: true, image: 'node.exe', commandLine: '"C:\\other\\node.exe" "C:\\other\\server\\index.mjs"' }, expected), false, 'different root is not ours');
    assert.equal(matchesExpected({ alive: true, certain: false, image: null, commandLine: null }, expected), true, 'uncertain -> safe direction');
    assert.equal(matchesExpected({ alive: false, certain: true, image: null, commandLine: null }, expected), false);
    assert.equal(matchesExpected({ alive: true, certain: true, image: 'node.exe', commandLine: nodeCmd }, null), true, 'legacy PID-only mode');
    console.log('ok 10 - probeProcess/matchesExpected unit checks');
  }

  console.log('\nAll process-lock tests passed.');
} finally {
  try { holder?.kill('SIGKILL'); } catch { /* ignore */ }
  assert.ok(resolve(scratch).startsWith(resolve(tmpdir())));
  rmSync(scratch, { recursive: true, force: true });
}
