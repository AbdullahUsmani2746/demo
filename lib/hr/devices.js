// lib/hr/devices.js — ZKTeco attendance machines (zkteco-js, TCP 4370 / UDP).
//
// The server must reach the machine on the network. A sync reads the
// machine's whole log, keeps punches since the last sync (less 3 days of
// overlap; the first sync goes back to the start of last month), stores the
// new ones and rebuilds those days (lib/hr/attendance/save.js). Nothing is
// ever deleted from the machine.
//
// Times: a machine keeps local wall-clock time. zkteco-js builds a Date from
// it in the SERVER's timezone, so its local parts are the machine's clock —
// read back as Karachi time (instantFromWall), whatever the server runs in.
import prisma from "@/lib/prisma";
import { ingestPunches } from "@/lib/hr/attendance/save";
import { addDays, instantAt, instantFromWall, todayKey } from "@/lib/hr/time";

const TIMEOUT_MS = 10000;
const OVERLAP_DAYS = 3;
let running = false; // one sync at a time in this process (a machine serves one connection)

async function withDevice(device, work) {
  const { default: Zkteco } = await import("zkteco-js");
  const zk = new Zkteco(device.ip, device.port || 4370, TIMEOUT_MS, 5000);
  try {
    await zk.createSocket();
    return await work(zk);
  } finally {
    try {
      await zk.disconnect();
    } catch {
      // already closed
    }
  }
}

const describeError = (e) => {
  const m = e?.err?.message || e?.message || String(e);
  if (/ETIMEDOUT|timeout/i.test(m)) return "No answer from the machine (timed out) — check the IP / port and that the server can reach it.";
  if (/ECONNREFUSED/i.test(m)) return "The machine refused the connection — check the port (usually 4370).";
  if (/EHOSTUNREACH|ENETUNREACH/i.test(m)) return "The machine's network cannot be reached from the server.";
  return m.slice(0, 280);
};

/** Connect and read its counters — the "Test connection" button. */
export async function testDevice(device) {
  try {
    const info = await withDevice(device, (zk) => zk.getInfo());
    return { ok: true, users: info?.userCounts ?? null, logs: info?.logCounts ?? null };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

const recordToPunch = (r) => {
  const d = new Date(r.record_time ?? r.attTime);
  if (Number.isNaN(d.getTime())) return null;
  return {
    device_user_id: String(r.user_id ?? r.userId ?? "").trim(),
    punch_time: instantFromWall(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()),
  };
};

/** Pull one machine. Records the outcome on the device row. */
export async function syncDevice(device, { actor = "system" } = {}) {
  const startedAt = new Date();
  try {
    const records = await withDevice(device, async (zk) => (await zk.getAttendances())?.data ?? []);
    const lastMonthStart = `${addDays(`${todayKey().slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
    const since = device.last_sync_at
      ? new Date(new Date(device.last_sync_at).getTime() - OVERLAP_DAYS * 86400000)
      : instantAt(lastMonthStart, 0);
    const punches = records.map(recordToPunch).filter((p) => p && p.device_user_id && p.punch_time >= since && p.punch_time <= startedAt);
    const result = await ingestPunches({ punches, source: "DEVICE", deviceId: device.id, batch: `device-${device.id}`, actor });
    await prisma.hrDevice.update({
      where: { id: device.id },
      data: { last_sync_at: startedAt, last_sync_ok: true, last_sync_count: result.inserted, last_sync_error: null },
    });
    return { ok: true, read: records.length, ...result };
  } catch (e) {
    const error = describeError(e);
    await prisma.hrDevice.update({
      where: { id: device.id },
      data: { last_sync_ok: false, last_sync_error: error },
    });
    return { ok: false, error };
  }
}

/** Every active machine set to sync automatically — the cron job (instrumentation.js). */
export async function syncAllDevices() {
  if (running) return { skipped: true };
  // Before the HR migration (prisma/sql/2026-10-30_hr_attendance.sql) there is nothing to sync.
  if (!prisma.hrDevice) return { devices: [] };
  running = true;
  try {
    let devices;
    try {
      devices = await prisma.hrDevice.findMany({ where: { is_active: true, auto_sync: true } });
    } catch (e) {
      if (e?.code === "P2021") return { devices: [] }; // table not created yet
      throw e;
    }
    const out = [];
    for (const d of devices) out.push({ id: d.id, name: d.name, ...(await syncDevice(d)) });
    return { devices: out };
  } finally {
    running = false;
  }
}

/** Wrap a manual sync so it does not run over the cron's. */
export async function syncOne(device, opts) {
  if (running) return { ok: false, error: "A sync is already running — try again in a minute." };
  running = true;
  try {
    return await syncDevice(device, opts);
  } finally {
    running = false;
  }
}

export function deviceData(b) {
  const name = String(b?.name ?? "").trim();
  const ip = String(b?.ip ?? "").trim();
  const port = Number(b?.port ?? 4370);
  if (!name || name.length > 100) throw Object.assign(new Error("Name is required (100 characters at most)."), { status: 400 });
  if (!/^[A-Za-z0-9.-]{3,64}$/.test(ip)) throw Object.assign(new Error("IP / host is not valid."), { status: 400 });
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error("Port must be 1–65535."), { status: 400 });
  return {
    name,
    ip,
    port,
    location: b.location ? String(b.location).trim().slice(0, 100) || null : null,
    auto_sync: b.auto_sync !== false,
    is_active: b.is_active !== false,
  };
}
