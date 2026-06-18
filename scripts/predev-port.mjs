#!/usr/bin/env node
// scripts/predev-port.mjs
// Frees the dev ports so `pnpm dev` can start cleanly. Cross-platform.
//
// - Reads comma-separated ports from MODELHARBOR_PORTS (default: 3000).
// - Walks the parent chain so watchers like `tsx watch` / `nodemon` are killed
//   too (otherwise they respawn the listener within milliseconds).
// - Safety: only kills processes whose command line contains the project
//   marker (default: "llm-router"). Set MODELHARBOR_KILL_ALL=1 to bypass.

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const PORTS = (process.env.MODELHARBOR_PORTS ?? '3000,5173')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const PROJECT_MARKER = (process.env.MODELHARBOR_PROJECT_MARKER ?? 'llm-router').toLowerCase();
const KILL_ALL = process.env.MODELHARBOR_KILL_ALL === '1';
const MAX_PARENT_DEPTH = 5;

function isWSL() {
  if (process.platform !== 'linux') return false;
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

function run(cmd, opts = {}) {
  return spawnSync(cmd, { stdio: 'pipe', shell: true, encoding: 'utf8', ...opts });
}

function execOrNull(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

function waitSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

// ---------- Windows ----------

function parseListeningPidsWindows(stdout, port) {
  const pids = new Set();
  for (const raw of stdout.split(/\r?\n/)) {
    if (!/\bLISTENING\b/i.test(raw)) continue;
    const cols = raw.trim().split(/\s+/);
    if (cols.length < 5) continue;
    const localAddr = cols[1];
    const m = localAddr.match(/:(\d+)$/);
    if (!m || Number(m[1]) !== port) continue;
    if (/^\d+$/.test(cols[cols.length - 1])) pids.add(cols[cols.length - 1]);
  }
  return pids;
}

function getParentPidWindows(pid) {
  const wmic = execOrNull(`wmic process where "ProcessId=${pid}" get ParentProcessId /value`);
  if (wmic) {
    const m = wmic.match(/ParentProcessId=(\d+)/);
    if (m && m[1] !== '0') return m[1];
  }
  const ps = execOrNull(
    `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -EA SilentlyContinue).ParentProcessId"`,
  );
  if (ps) {
    const trimmed = ps.trim();
    if (/^\d+$/.test(trimmed) && trimmed !== '0') return trimmed;
  }
  return null;
}

function getCommandLineWindows(pid) {
  const wmic = execOrNull(`wmic process where "ProcessId=${pid}" get CommandLine /value`);
  if (wmic) {
    const m = wmic.match(/CommandLine=(.*)/);
    if (m) return m[1].trim();
  }
  const ps = execOrNull(
    `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -EA SilentlyContinue).CommandLine"`,
  );
  return ps ? ps.trim() : '';
}

function isProjectProcessWindows(pid) {
  if (KILL_ALL) return true;
  return getCommandLineWindows(pid).toLowerCase().includes(PROJECT_MARKER);
}

function killOnWindows(port) {
  const out = execOrNull(`netstat -ano | findstr :${port}`);
  if (!out) return 0;
  const listeners = parseListeningPidsWindows(out, port);
  if (listeners.size === 0) return 0;

  const projectListeners = new Set();
  const skipped = [];
  for (const pid of listeners) {
    if (isProjectProcessWindows(pid)) projectListeners.add(pid);
    else skipped.push(pid);
  }
  if (skipped.length > 0) {
    console.warn(
      `[predev] port ${port}: skipping non-project listener PID(s): ${skipped.join(', ')} (set MODELHARBOR_KILL_ALL=1 to override)`,
    );
  }
  if (projectListeners.size === 0) return 0;

  const toKill = collectAncestors(projectListeners, getParentPidWindows);
  let killed = 0;
  for (const pid of toKill) {
    const r = run(`taskkill /F /T /PID ${pid}`);
    if (r.status === 0) killed++;
  }
  if (killed > 0) waitSync(400);
  return killed;
}

// ---------- WSL (drives Windows host via PowerShell interop) ----------

function killOnWsl(port) {
  const ps =
    `$ls = Get-NetTCPConnection -LocalPort ${port} -State Listen -EA SilentlyContinue; ` +
    `foreach ($c in $ls) { ` +
    `$cur = [int]$c.OwningProcess; ` +
    `$cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -EA SilentlyContinue).CommandLine; ` +
    `if (${KILL_ALL ? '$true' : `$cmd -like '*${PROJECT_MARKER}*'`}) { ` +
    `for ($i=0; $i -lt ${MAX_PARENT_DEPTH}; $i++) { ` +
    `Stop-Process -Id $cur -Force -EA SilentlyContinue; ` +
    `$par = (Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -EA SilentlyContinue).ParentProcessId; ` +
    `if (-not $par -or $par -eq 0 -or $par -eq $cur) { break }; ` +
    `$cur = [int]$par ` +
    `} ` +
    `} ` +
    `}`;
  const escaped = ps.replace(/"/g, '\\"');
  return run(`powershell.exe -NoProfile -Command "${escaped}"`);
}

// ---------- Unix (Linux/macOS) ----------

function getParentPidUnix(pid) {
  const ps = execOrNull(`ps -o ppid= -p ${pid}`);
  if (ps) {
    const ppid = ps.trim();
    if (/^\d+$/.test(ppid) && ppid !== '0') return ppid;
  }
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const m = status.match(/PPid:\s+(\d+)/);
    if (m && m[1] !== '0') return m[1];
  } catch {
    // not Linux, or process gone
  }
  return null;
}

function getCommandLineUnix(pid) {
  const ps = execOrNull(`ps -o command= -p ${pid}`);
  return ps ? ps.trim() : '';
}

function isProjectProcessUnix(pid) {
  if (KILL_ALL) return true;
  return getCommandLineUnix(pid).toLowerCase().includes(PROJECT_MARKER);
}

function killOnUnix(port) {
  const { stdout } = run(`lsof -ti :${port}`);
  const pids = (stdout || '').split(/\s+/).filter(Boolean);
  if (pids.length === 0) return 0;

  const projectListeners = pids.filter(isProjectProcessUnix);
  const skipped = pids.filter((p) => !projectListeners.includes(p));
  if (skipped.length > 0) {
    console.warn(
      `[predev] port ${port}: skipping non-project listener PID(s): ${skipped.join(', ')} (set MODELHARBOR_KILL_ALL=1 to override)`,
    );
  }
  if (projectListeners.length === 0) return 0;

  const toKill = collectAncestors(projectListeners, getParentPidUnix);
  let killed = 0;
  for (const pid of toKill) {
    try {
      process.kill(Number(pid), 'SIGKILL');
      killed++;
    } catch {
      // already gone
    }
  }
  if (killed > 0) waitSync(200);
  return killed;
}

// ---------- shared ----------

function collectAncestors(pids, getParent) {
  const toKill = new Set(pids);
  for (const pid of pids) {
    let current = pid;
    for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
      const parent = getParent(current);
      if (!parent) break;
      if (toKill.has(parent)) break;
      toKill.add(parent);
      current = parent;
    }
  }
  return toKill;
}

// ---------- main ----------

for (const port of PORTS) {
  let killed = 0;
  if (process.platform === 'win32') {
    killed = killOnWindows(port);
  } else if (isWSL()) {
    const res = killOnWsl(port);
    if (res.status === 0) killed = -1;
  } else {
    killed = killOnUnix(port);
  }
  if (killed > 0) {
    console.log(
      `[predev] freed port ${port} (killed ${killed} process${killed === 1 ? '' : 'es'})`,
    );
  } else if (killed === 0) {
    console.log(`[predev] port ${port} is free`);
  }
  // killed === -1 (WSL): no per-port count available
}
