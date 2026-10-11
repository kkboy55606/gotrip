// 中央氣象署開放資料：目前天氣（最近測站）、36 小時預報、天氣特報
// 授權碼必須放在網址參數（放 header 會觸發 CORS 預檢而失敗）。
// 注意：授權碼錯誤時氣象署回 401 但不帶 CORS header，瀏覽器只會看到「連線失敗」。
import { haversine } from './geo.js';
import { ApiError } from './errors.js';

const BASE = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore';

const num = (v) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= -98 ? null : n;
};
const text = (v) => (typeof v === 'string' && v !== '-99' && v !== 'X' && v.trim() ? v : null);

/** O-A0001-001 → 最近且有溫度的測站；天氣描述若該站沒有，取 30 公里內最近有描述的站 */
export function nearestObservation(json, center) {
  const stations = (json?.records?.Station ?? [])
    .map((s) => {
      const wgs = (s.GeoInfo?.Coordinates ?? []).find((c) => c.CoordinateName === 'WGS84');
      const lat = num(wgs?.StationLatitude);
      const lng = num(wgs?.StationLongitude);
      if (lat === null || lng === null) return null;
      const w = s.WeatherElement ?? {};
      return {
        stationName: s.StationName ?? '',
        county: s.GeoInfo?.CountyName ?? '',
        town: s.GeoInfo?.TownName ?? '',
        temp: num(w.AirTemperature),
        humidity: num(w.RelativeHumidity),
        weather: text(w.Weather),
        rainToday: num(w.Now?.Precipitation),
        obsTime: s.ObsTime?.DateTime ?? '',
        distance: haversine(center, { lat, lng }),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
  const best = stations.find((s) => s.temp !== null);
  if (!best) return null;
  if (!best.weather) {
    const desc = stations.find((s) => s.weather && s.distance <= 30000);
    if (desc) best.weather = desc.weather;
  }
  return best;
}

const TW_OFFSET = 8 * 3600e3;
/** "2026-07-08 06:00:00"（台灣時間、無時區）→ Date */
export function parseCwaTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s ?? '');
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - TW_OFFSET);
}

function periodLabel(start, end, now) {
  if (!start || !end) return '';
  const day = (d) => Math.floor((d.getTime() + TW_OFFSET) / 86400e3);
  const words = ['今天', '明天', '後天'];
  const dayWord = words[day(start) - day(now)] ?? '';
  const hh = (d) => String(new Date(d.getTime() + TW_OFFSET).getUTCHours()).padStart(2, '0');
  return `${dayWord} ${hh(start)}:00–${hh(end)}:00`.trim();
}

/** F-C0032-001 → 三個時段的預報 */
export function parseForecast(json, county, now = new Date()) {
  const locs = json?.records?.location ?? [];
  const loc = locs.find((l) => l.locationName === county) ?? locs[0];
  if (!loc) return [];
  const el = Object.fromEntries((loc.weatherElement ?? []).map((e) => [e.elementName, e.time ?? []]));
  const base = el.Wx ?? [];
  return base.map((t, i) => {
    const start = parseCwaTime(t.startTime);
    const end = parseCwaTime(t.endTime);
    const p = (name) => el[name]?.[i]?.parameter?.parameterName ?? null;
    return {
      start,
      end,
      label: periodLabel(start, end, now),
      wx: p('Wx') ?? '',
      pop: num(p('PoP')) ?? '—',
      minT: num(p('MinT')) ?? '—',
      maxT: num(p('MaxT')) ?? '—',
      ci: p('CI'),
    };
  });
}

const fmtShort = (d) => {
  if (!d) return '';
  const t = new Date(d.getTime() + TW_OFFSET);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};

/** W-C0033-001 → 特報清單（例：大雨特報、陸上強風特報） */
export function parseWarnings(json, county) {
  const locs = json?.records?.location ?? [];
  const loc = locs.find((l) => l.locationName === county);
  return (loc?.hazardConditions?.hazards ?? []).map((hz) => ({
    title: `${hz.info?.phenomena ?? ''}${hz.info?.significance ?? ''}` || '天氣特報',
    start: fmtShort(parseCwaTime(hz.validTime?.startTime)),
    end: fmtShort(parseCwaTime(hz.validTime?.endTime)),
  }));
}

export function createWeather({ key = '' } = {}) {
  const hasKey = Boolean(key);
  const mem = new Map();

  async function get(dataset, params, ttlMs) {
    const q = new URLSearchParams({ Authorization: key, format: 'JSON', ...params });
    const url = `${BASE}/${dataset}?${q}`;
    const hit = mem.get(url);
    if (hit && Date.now() - hit.at < ttlMs) return hit.data;
    let res;
    try {
      res = await fetch(url);
    } catch {
      throw new ApiError('連不上中央氣象署：可能是授權碼錯誤或網路問題，請到「設定」確認。');
    }
    if (!res.ok) throw new ApiError(`中央氣象署回應錯誤 ${res.status}，請確認授權碼。`);
    const data = await res.json().catch(() => null);
    if (String(data?.success) !== 'true') throw new ApiError('中央氣象署回應失敗，請稍後再試。');
    mem.set(url, { at: Date.now(), data });
    return data;
  }

  return {
    hasKey,
    current: async (center) => nearestObservation(await get('O-A0001-001', {}, 10 * 60e3), center),
    forecast: async (county) => parseForecast(await get('F-C0032-001', { locationName: county }, 30 * 60e3), county),
    warnings: async (county) => parseWarnings(await get('W-C0033-001', { locationName: county }, 10 * 60e3), county),
  };
}

// ---------- 示範模式假資料（demo.js 使用） ----------

export function demoResponse(url, center) {
  const county = decodeURIComponent(/locationName=([^&]+)/.exec(url)?.[1] ?? '花蓮縣').replace(/\+/g, ' ');
  const twNow = new Date(Date.now() + TW_OFFSET);
  const pad = (n) => String(n).padStart(2, '0');
  const at = (h) => {
    const d = new Date(Date.UTC(twNow.getUTCFullYear(), twNow.getUTCMonth(), twNow.getUTCDate(), h));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00:00`;
  };
  if (url.includes('O-A0001-001')) {
    const st = (name, dLat, dLng, temp, weather) => ({
      StationName: name, StationId: name,
      ObsTime: { DateTime: new Date().toISOString() },
      GeoInfo: {
        Coordinates: [
          { CoordinateName: 'TWD67', StationLatitude: '0', StationLongitude: '0' },
          { CoordinateName: 'WGS84', StationLatitude: String(center.lat + dLat), StationLongitude: String(center.lng + dLng) },
        ],
        CountyName: '花蓮縣', TownName: '示範市',
      },
      WeatherElement: { Weather: weather, AirTemperature: temp, RelativeHumidity: '78', Now: { Precipitation: '0.0' } },
    });
    return { success: 'true', records: { Station: [st('示範甲', 0.01, 0.01, '26.4', '-99'), st('示範乙', 0.05, 0.02, '25.8', '多雲'), st('故障站', 0.001, 0, '-99', '-99')] } };
  }
  if (url.includes('F-C0032-001')) {
    const times = [[at(18), at(30)], [at(30), at(42)], [at(42), at(54)]];
    const el = (name, vals) => ({ elementName: name, time: times.map(([s, e], i) => ({ startTime: s, endTime: e, parameter: { parameterName: vals[i] } })) });
    return {
      success: 'true',
      records: { location: [{ locationName: county, weatherElement: [el('Wx', ['多雲時陰短暫雨', '晴時多雲', '多雲']), el('PoP', ['40', '10', '20']), el('MinT', ['23', '22', '23']), el('CI', ['舒適', '舒適', '舒適至悶熱']), el('MaxT', ['27', '29', '30'])] }] },
    };
  }
  if (url.includes('W-C0033-001')) {
    return {
      success: 'true',
      records: { location: [{ locationName: county, hazardConditions: { hazards: [{ info: { phenomena: '大雨', significance: '特報' }, validTime: { startTime: at(10), endTime: at(30) } }] } }] },
    };
  }
  return { success: 'false' };
}
