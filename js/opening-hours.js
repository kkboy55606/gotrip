// OpenStreetMap 的 opening_hours 解析（只支援常見寫法，看不懂就回 null → 顯示「營業時間未提供」）
// 支援：24/7、Mo-Fr 08:00-17:00、Th-Tu（跨週）、多段時間、off/closed、跨午夜（17:00-03:00、24:30）、
//      「;」覆蓋規則、「,」附加規則（Mo 17:00-24:00, Tu-Fr 11:30-14:30）、PH（國定假日，忽略）
// 不支援：月份/日期、sunrise/sunset、「+」、只有星期沒有時間的規則
// 輸出格式刻意做成跟 Google currentOpeningHours 一樣，沿用 places-logic.js 的 openStatus()。
import { twParts } from './places-logic.js';

const ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const JS_DAY = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };

const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)';
const DAYRANGE = `${DAY}(?:\\s*-\\s*${DAY})?`;
const DAYSEL = `${DAYRANGE}(?:\\s*,\\s*${DAYRANGE})*`;
const TIME = '\\d{1,2}:\\d{2}';
const TR = `${TIME}\\s*-\\s*${TIME}`;
const TIMES = `${TR}(?:\\s*,\\s*${TR})*`;
const RULE = new RegExp(`^(?:(${DAYSEL})\\s*:?\\s+)?(${TIMES}|off|closed)(?:\\s*,\\s*(.+))?$`, 'i');

const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h > 48 || m > 59 ? null : h * 60 + m;
};

/** "Mo-We,Fr,PH" → JS 星期陣列；PH/SH 忽略；只有 PH/SH → [] */
function expandDays(sel) {
  if (!sel) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set();
  for (const part of sel.split(/\s*,\s*/)) {
    const [a, b] = part.split(/\s*-\s*/);
    if (a === 'PH' || a === 'SH') continue;
    const i = ORDER.indexOf(a);
    const j = b ? ORDER.indexOf(b) : i;
    if (i < 0 || j < 0) return null;
    for (let k = i; ; k = (k + 1) % 7) {
      out.add(JS_DAY[ORDER[k]]);
      if (k === j) break;
    }
  }
  return [...out];
}

function parseRanges(times) {
  const out = [];
  for (const r of times.split(/\s*,\s*/)) {
    const [a, b] = r.split(/\s*-\s*/).map(toMin);
    if (a === null || b === null) return null;
    out.push([a, b <= a ? b + 1440 : b]); // 結束早於開始 → 跨午夜
  }
  return out;
}

/** 回傳 { allDay, week }，week[js星期] = [[開始分鐘, 結束分鐘], ...]；看不懂回 null */
export function parseOpeningHours(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim();
  if (!s) return null;
  if (s === '24/7') return { allDay: true, week: Array.from({ length: 7 }, () => [[0, 1440]]) };

  const week = Array(7).fill(null);
  for (const ruleText of s.split(/\s*;\s*/).filter(Boolean)) {
    let text = ruleText;
    let additive = false;
    while (text) {
      const m = RULE.exec(text);
      if (!m) return null;
      const [, daySel, timeSpec, rest] = m;
      const days = expandDays(daySel);
      if (days === null) return null;
      const off = /^(off|closed)$/i.test(timeSpec);
      const ranges = off ? [] : parseRanges(timeSpec);
      if (ranges === null) return null;
      for (const d of days) week[d] = off || !additive ? [...ranges] : [...(week[d] ?? []), ...ranges];
      text = rest ?? '';
      additive = true;
    }
  }
  return { allDay: false, week: week.map((w) => w ?? []) };
}

const pad2 = (n) => String(n).padStart(2, '0');
const clock = (min) => (min === 1440 ? '24:00' : `${pad2(Math.floor((min % 1440) / 60))}:${pad2(min % 60)}`);
const WEEK_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** 台灣時間今天 00:00 的 Date */
function twMidnight(now) {
  const [y, m, d] = twParts(now).ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 8 * 3600e3);
}

/** opening_hours 字串 → 與 Google currentOpeningHours 相同格式；看不懂回 null */
export function hoursFromOsm(str, now = new Date()) {
  const p = parseOpeningHours(str);
  if (!p) return null;
  const weekdayDescriptions = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    if (p.allDay) return `${WEEK_ZH[d]}: 24 小時營業`;
    const w = p.week[d];
    return `${WEEK_ZH[d]}: ${w.length ? w.map(([a, b]) => `${clock(a)}–${clock(b > 1440 ? b - 1440 : b)}`).join(', ') : '休息'}`;
  });
  if (p.allDay) return { openNow: true, periods: [{ open: { day: 0, hour: 0, minute: 0 } }], weekdayDescriptions };

  const today = twParts(now).weekday;
  const nowMin = Math.floor((now - twMidnight(now)) / 60000);
  // 從昨天到 7 天後的營業區間（以「今天 00:00 起算的分鐘」表示），合併相連的區間
  const spans = [];
  for (let k = -1; k <= 7; k++) {
    for (const [a, b] of p.week[(today + k + 7) % 7]) spans.push([k * 1440 + a, k * 1440 + b]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const sp of spans) {
    const last = merged.at(-1);
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([...sp]);
  }
  const base = twMidnight(now).getTime();
  const iso = (min) => new Date(base + min * 60000).toISOString();
  const cur = merged.find(([a, b]) => a <= nowMin && nowMin < b);
  const next = merged.find(([a]) => a > nowMin);
  const periods = [];
  p.week.forEach((w, d) => w.forEach(([a, b]) => periods.push({
    open: { day: d, hour: Math.floor(a / 60), minute: a % 60 },
    close: { day: (d + Math.floor(b / 1440)) % 7, hour: Math.floor((b % 1440) / 60), minute: b % 60 },
  })));
  return {
    openNow: Boolean(cur),
    ...(cur ? { nextCloseTime: iso(cur[1]) } : next ? { nextOpenTime: iso(next[0]) } : {}),
    periods,
    weekdayDescriptions,
  };
}
