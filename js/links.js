// 開啟 Google 地圖 App 的網址（Maps URLs，免費、不需要金鑰）

/** 導航到某地點；travelmode：walking | bicycling | driving | two-wheeler | transit */
export function directionsUrl(place, travelmode, origin = null) {
  const q = new URLSearchParams({ api: '1', destination: `${place.lat},${place.lng}` });
  if (origin) q.set('origin', `${origin.lat},${origin.lng}`);
  if (travelmode) q.set('travelmode', travelmode);
  return `https://www.google.com/maps/dir/?${q}`;
}

/** 在 Google 地圖搜尋這個店名（可看評論、確認有沒有營業）；附上地址降低同名店的誤判 */
export function googleSearchUrl(place) {
  const query = [place.name || place.displayName, place.address].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: query || `${place.lat},${place.lng}` })}`;
}

/** 多點路線：起點 → 途經點… → 最後一點 */
export function multiStopUrl(origin, stops, travelmode) {
  if (!stops.length) return null;
  const last = stops.at(-1);
  const q = new URLSearchParams({ api: '1', origin: `${origin.lat},${origin.lng}`, destination: `${last.lat},${last.lng}` });
  const mid = stops.slice(0, -1);
  if (mid.length) q.set('waypoints', mid.map((s) => `${s.lat},${s.lng}`).join('|'));
  if (travelmode) q.set('travelmode', travelmode);
  return `https://www.google.com/maps/dir/?${q}`;
}

/** 手機版 Google 地圖最多 3 個途經點 → 每段最多 4 站，下一段從上一段終點出發 */
export function routeLinks(origin, stops, travelmode, perLink = 4) {
  const links = [];
  let from = origin;
  for (let i = 0; i < stops.length; i += perLink) {
    const seg = stops.slice(i, i + perLink);
    links.push(multiStopUrl(from, seg, travelmode));
    from = seg.at(-1);
  }
  return links;
}
