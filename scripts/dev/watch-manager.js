#!/usr/bin/env node
/*
 * Simple watch manager for VS Code preLaunchTask/postDebugTask
 * - start: starts tsc -w if not already running; can mark as started by debug
 * - stop: stops only if the watcher was started by debug via this manager
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const workspace = process.cwd();
const isWin = process.platform === 'win32';
const tscBin = path.join(workspace, 'node_modules', '.bin', isWin ? 'tsc.cmd' : 'tsc');
const stateDir = path.join(workspace, '.vscode');
const metaFile = path.join(stateDir, '.watch.meta.json');

function ensureStateDir() {
  try { fs.mkdirSync(stateDir, { recursive: true }); } catch {}
}

function readMeta() {
  try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { return null; }
}

function writeMeta(meta) {
  ensureStateDir();
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
}

function removeMeta() {
  try { fs.unlinkSync(metaFile); } catch {}
}

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function detectExternalTscWatch() {
  try {
    if (isWin) {
      // Best-effort on Windows: check for tsc.exe process (no strong guarantee)
      const out = execSync('wmic process get ProcessId,CommandLine', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      return /tsc(\.cmd|\.exe|\.js)?[^\n]*\s(-w|--watch)/i.test(out);
    } else {
      const out = execSync('ps -ef', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      // Look for tsc watch in this workspace
      const re = new RegExp(`(node\s+)?[^\n]*tsc[^\n]*(-w|--watch)[^\n]*(-p|--project)\s+\.?`, 'i');
      return re.test(out);
    }
  } catch {
    return false;
  }
}

function start(byDebug = false) {
  const existing = readMeta();
  if (existing && isPidAlive(existing.pid)) {
    console.log(`[watch-manager] Watch already running (pid=${existing.pid}).`);
    return; // Reuse existing managed watcher
  }

  // If a non-managed tsc watch is already running, skip starting another
  if (!existing && detectExternalTscWatch()) {
    console.log('[watch-manager] Detected an external TypeScript watch. Skipping managed start.');
    return; // Exit immediately; preLaunch will continue without waiting
  }

  // Start a managed tsc watch
  console.log('[watch-manager] Starting managed TypeScript watch...');
  const args = ['-w', '-p', './'];
  const child = spawn(tscBin, args, { stdio: 'inherit', cwd: workspace, env: process.env, detached: false });

  writeMeta({ pid: child.pid, startedByDebug: !!byDebug, startedAt: new Date().toISOString() });

  const cleanup = () => {
    removeMeta();
  };

  child.on('exit', cleanup);
  child.on('close', cleanup);

  // Keep this process alive while tsc runs
}

function stop() {
  const meta = readMeta();
  if (!meta) {
    console.log('[watch-manager] No managed watch state found. Nothing to stop.');
    return;
  }
  if (!meta.startedByDebug) {
    console.log('[watch-manager] Managed watch was not started by debug. Leaving it running.');
    return;
  }
  if (meta.pid && isPidAlive(meta.pid)) {
    try {
      console.log(`[watch-manager] Stopping managed watch (pid=${meta.pid})...`);
      process.kill(meta.pid, 'SIGTERM');
    } catch (e) {
      // Ignore if already gone
    }
  }
  removeMeta();
}

function main() {
  const [, , cmd, flag] = process.argv;
  if (cmd === 'start') {
    start(flag === '--by-debug');
  } else if (cmd === 'stop') {
    stop();
  } else {
    console.log('Usage: node scripts/dev/watch-manager.js <start|stop> [--by-debug]');
    process.exit(1);
  }
}

main();

