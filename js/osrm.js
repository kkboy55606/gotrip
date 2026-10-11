// 免費路線時間：OSRM（OpenStreetMap 資料）
// 步行/自行車用 FOSSGIS 的 routing.openstreetmap.de；汽車用 OSRM 官方示範伺服器，失敗再換 FOSSGIS。
// 兩者皆實測支援 CORS、table 服務可一次算多個目的地。時間不含即時路況。
import { ApiError } from './errors.js';

export const OSRM_SERVERS = {
  WALK: ['https://routing.openstreetmap.de/routed-foot'],
  BIKE: ['https://routing.openstreetmap.de/routed-bike'],
  DRIVE: ['https://router.project-osrm.org', 'https://routing.openstreetmap.de/routed-car'],
};
const BATCH = 50; // 公共伺服器 table 上限約 100 個座標，保守切批

const coord = (p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

export function buildTableUrl(server, origin, destinations) {
  const coords = [origin, ...destinations].map(coord).join(';');
  return `${server}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`;
}

/** OSRM table 回應 → 每個目的地 {meters, seconds} 或 null（到不了） */
export function parseTable(json, count) {
  if (json?.code !== 'Ok') throw new ApiError(`路線服務回應錯誤：${json?.message ?? json?.code ?? '未知'}`);
  const dur = json.durations?.[0] ?? [];
  const dist = json.distances?.[0] ?? [];
  return Array.from({ length: count }, (_, i) => {
    const s = dur[i + 1];
    if (typeof s !== 'number') return null;
    return { seconds: s, meters: typeof dist[i + 1] === 'number' ? dist[i + 1] : null };
  });
}

async function fetchTable(servers, origin, dests) {
  let lastErr;
  for (const server of servers) {
    try {
      const res = await fetch(buildTableUrl(server, origin, dests));
      if (!res.ok) throw new ApiError(`路線服務暫時無法使用（${res.status}）`);
      return parseTable(await res.json(), dests.length);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof ApiError ? lastErr : new ApiError('連不上路線服務，請稍後再試。');
}

export async function computeTable(mode, origin, destinations) {
  const servers = OSRM_SERVERS[mode] ?? OSRM_SERVERS.DRIVE;
  const out = [];
  for (let i = 0; i < destinations.length; i += BATCH) {
    out.push(...(await fetchTable(servers, origin, destinations.slice(i, i + BATCH))));
  }
  return out;
}
