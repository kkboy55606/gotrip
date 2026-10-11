// 觀光署資料整理（純函式，Node 測試可直接測）：原始 JSON → 手機用的精簡格式
import { inflateRawSync } from 'node:zlib';
import { tileKey } from '../js/tourism.js';

// ---------- 最小 zip 解壓（只需支援 store / deflate，檔案 < 4GB） ----------
export function unzip(buf) {
  const files = {};
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 檔');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 目錄損壞');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    files[name] = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

export const parseJsonBuf = (b) => JSON.parse(b.toString('utf8').replace(/^﻿/, ''));

// ---------- 轉換 ----------

const DAY = { Monday: 'Mo', Tuesday: 'Tu', Wednesday: 'We', Thursday: 'Th', Friday: 'Fr', Saturday: 'Sa', Sunday: 'Su' };
const hm = (t) => (t ?? '').slice(0, 5);

/** 觀光署 ServiceTimes → OSM opening_hours 字串（App 用同一套解析）；資料不完整回 '' */
export function serviceTimesToOsm(times, today) {
  const rules = [];
  for (const t of Array.isArray(times) ? times : []) {
    if (t.EffectiveDate && today < t.EffectiveDate.slice(0, 10)) continue;
    if (t.ExpireDate && today > t.ExpireDate.slice(0, 10)) continue;
    const days = (t.ServiceDays ?? []).map((d) => DAY[d]).filter(Boolean);
    const start = hm(t.StartTime);
    let end = hm(t.EndTime);
    if (!days.length || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return '';
    if (end === '23:59' || (start === '00:00' && end === '00:00')) end = '24:00';
    rules.push(`${days.join(',')} ${start}-${end}`);
  }
  return rules.join('; ');
}

/** 收費 → 文字：「免費」或「全票 100 元、半票 50 元」 */
export function feesText(fees) {
  const list = Array.isArray(fees) ? fees : [];
  if (!list.length) return '';
  if (list.every((f) => !f.Price)) return list.map((f) => f.Name).filter(Boolean).join('、') || '免費';
  return list.map((f) => (f.Price ? `${f.Name ?? ''} ${f.Price} 元`.trim() : f.Name)).filter(Boolean).join('、');
}

const clip = (s, n) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const addressOf = (pa) => (pa ? `${pa.City ?? ''}${pa.Town ?? ''}${pa.StreetAddress ?? ''}` : '');
const firstTel = (tels) => (Array.isArray(tels) && tels[0]?.Tel) || '';
const firstImg = (imgs) => (Array.isArray(imgs) && imgs.find((i) => /^https:\/\//.test(i?.URL ?? ''))?.URL) || '';
const safeUrl = (u) => (/^https?:\/\//.test(u ?? '') ? u : '');

/** 只保留「正常營運」且對外開放的景點（ServiceStatus 1；0 與 3 為停止/暫停營運類） */
export const isOperatingAttraction = (a) => a.ServiceStatus === 1 && a.IsPublicAccess !== 0;

export function compactAttraction(a, { times, fees, today }) {
  if (typeof a.PositionLat !== 'number' || typeof a.PositionLon !== 'number') return null;
  const out = {
    id: a.AttractionID.replace(/^Attraction_/, ''),
    n: a.AttractionName,
    lat: Math.round(a.PositionLat * 1e6) / 1e6,
    lng: Math.round(a.PositionLon * 1e6) / 1e6,
    c: a.AttractionClasses ?? [],
    a: addressOf(a.PostalAddress),
    t: firstTel(a.Telephones),
    d: clip(a.Description, 300),
    img: firstImg(a.Images),
    w: safeUrl(a.WebsiteURL),
    h: serviceTimesToOsm(times, today),
    f: feesText(fees) || (a.IsAccessibleForFree === 1 ? '免費' : ''),
    p: clip(a.ParkingInfo, 120),
  };
  for (const k of Object.keys(out)) if (out[k] === '' || (Array.isArray(out[k]) && !out[k].length)) delete out[k];
  return out;
}

/**
 * 活動日期（台灣日期）。資料怪癖：約兩成的時間是 UTC 卻標 +08:00
 * （開始 16:00:00 = 隔天 00:00、結束 15:59:59 = 當天 23:59:59），開始時間要進一天。
 */
export function eventDate(iso, isStart) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso ?? '');
  if (!m) return null;
  if (!(isStart && m[4] === '16:00:00')) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
  return d.toISOString().slice(0, 10);
}

export function compactEvent(e) {
  const s = eventDate(e.StartDateTime, true);
  const end = eventDate(e.EndDateTime, false);
  if (!s || !end || typeof e.PositionLat !== 'number' || typeof e.PositionLon !== 'number') return null;
  const out = {
    id: e.EventID.replace(/^Event_/, ''),
    n: e.EventName,
    lat: Math.round(e.PositionLat * 1e6) / 1e6,
    lng: Math.round(e.PositionLon * 1e6) / 1e6,
    s,
    e: end < s ? s : end,
    a: addressOf(e.PostalAddress),
    t: firstTel(e.Telephones),
    d: clip(e.Description, 300),
    img: firstImg(e.Images),
    w: safeUrl(e.WebsiteURL),
    f: e.IsAccessibleForFree === 1 ? '免費' : clip(e.FeeInfo, 80),
  };
  for (const k of Object.keys(out)) if (out[k] === '') delete out[k];
  return out;
}

const SKIP_EVENT_STATUS = new Set(['EventCancelled', 'EventPostponed']);

/** 原始資料 → { index, tiles: {key: [...]}, events } */
export function buildTourism({ attractions, serviceTimes = [], fees = [], events = [], updateTime = '', today }) {
  const timesById = new Map(serviceTimes.map((x) => [x.AttractionID, x.ServiceTimes]));
  const feesById = new Map(fees.map((x) => [x.AttractionID, x.Fees]));
  const tiles = {};
  let skipped = 0;
  for (const a of attractions) {
    if (!isOperatingAttraction(a)) { skipped++; continue; }
    const s = compactAttraction(a, { times: timesById.get(a.AttractionID), fees: feesById.get(a.AttractionID), today });
    if (!s) continue;
    (tiles[tileKey(s.lat, s.lng)] ??= []).push(s);
  }
  const ev = events
    .filter((e) => !SKIP_EVENT_STATUS.has(e.EventStatus))
    .map(compactEvent)
    .filter((e) => e && e.e >= today)
    .sort((x, y) => x.s.localeCompare(y.s));
  const spotCount = Object.values(tiles).reduce((n, t) => n + t.length, 0);
  return {
    index: { updateTime, builtFor: today, spots: spotCount, skippedNotOperating: skipped, events: ev.length, tiles: Object.keys(tiles).sort() },
    tiles,
    events: ev,
  };
}
