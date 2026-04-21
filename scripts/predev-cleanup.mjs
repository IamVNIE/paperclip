#!/usr/bin/env node
// Nukes every leftover embedded-postgres process, stale lock files, and
// runtime-service registry entries that cause `pnpm dev` to hang on Windows.
// Runs before the dev-runner so startup is always from a clean state.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = process.env.PAPERCLIP_HOME
  ? path.resolve(process.env.PAPERCLIP_HOME)
  : path.resolve(os.homedir(), ".paperclip");
const INSTANCE = process.env.PAPERCLIP_INSTANCE_ID || "default";
const INSTANCE_ROOT = path.resolve(HOME, "instances", INSTANCE);
const DB_DIR = path.resolve(INSTANCE_ROOT, "db");
const POSTMASTER_PID = path.resolve(DB_DIR, "postmaster.pid");
const RUNTIME_SERVICES_DIR = path.resolve(INSTANCE_ROOT, "runtime-services");

function log(msg) {
  process.stdout.write(`[predev] ${msg}\n`);
}

function killPostgresWindows() {
  if (process.platform !== "win32") return 0;
  let killed = 0;
  try {
    const raw = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", timeout: 10_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const victims = items
      .filter((item) => typeof item?.CommandLine === "string")
      .filter((item) =>
        String(item.CommandLine).replace(/\\/g, "/").toLowerCase().includes("/node_modules/@embedded-postgres/"),
      )
      .map((item) => Number(item?.ProcessId))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
    for (const pid of victims) {
      try {
        execFileSync("taskkill.exe", ["/PID", String(pid), "/F"], { stdio: "ignore", windowsHide: true });
        killed += 1;
      } catch {
        // ignore — already gone
      }
    }
  } catch {
    // powershell unavailable or query failed — not fatal
  }
  return killed;
}

function killPostgresUnix() {
  if (process.platform === "win32") return 0;
  try {
    execFileSync("pkill", ["-9", "-f", "node_modules/@embedded-postgres/.*postgres"], { stdio: "ignore" });
    return 1; // pkill exits 0 if it killed anything; we can't tell how many
  } catch {
    return 0;
  }
}

function removePostmasterLock() {
  if (!existsSync(POSTMASTER_PID)) return false;
  try {
    rmSync(POSTMASTER_PID, { force: true });
    return true;
  } catch {
    return false;
  }
}

function clearRuntimeServices() {
  if (!existsSync(RUNTIME_SERVICES_DIR)) return 0;
  let removed = 0;
  for (const entry of readdirSync(RUNTIME_SERVICES_DIR)) {
    if (!entry.endsWith(".json")) continue;
    try {
      rmSync(path.resolve(RUNTIME_SERVICES_DIR, entry), { force: true });
      removed += 1;
    } catch {
      // ignore
    }
  }
  return removed;
}

const killed = process.platform === "win32" ? killPostgresWindows() : killPostgresUnix();
const lockRemoved = removePostmasterLock();
const registryRemoved = clearRuntimeServices();

log(`killed ${killed} embedded-postgres process${killed === 1 ? "" : "es"}`);
if (lockRemoved) log(`removed stale postmaster.pid`);
if (registryRemoved > 0) log(`cleared ${registryRemoved} runtime-service record${registryRemoved === 1 ? "" : "s"}`);
log(`done — dev-runner starting from a clean state`);
