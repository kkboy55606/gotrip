// GoTrip 主程式：畫面狀態與各分頁（資料來源全部免費：OpenStreetMap、OSRM、氣象署、TDX、林業署、公路局）
import { $, h, setChildren, toast } from './dom.js';
import { createStore } from './storage.js';
import { CATEGORIES, MODES, RADII, PRESETS, DEFAULT_CENTER } from './config.js';
import { formatDistance, formatDuration, roundCoordKey, haversine } from './geo.js';
import { filterPlaces, sortPlaces, openStatus, todayHoursText, isClosedBusiness, twDate, twMinutes, twParts } from './places-logic.js';
import { hoursFromOsm } from './opening-hours.js';
import { buildOverpassQuery, queryOverpass, parseOverpass, searchPlace } from './osm.js';
import { computeTable } from './osrm.js';
import { directionsUrl, googleSearchUrl, routeLinks } from './links.js';
import { orderStops } from './route-order.js';
import { renderMap } from './map.js';
import {
  createTdx, nearestStations, upcomingDepartures, parseOdTrains, groupBusStops, parseBusEta, busEtaText,
  parseRoadEvents, filterHighwayNews, countyFromAddress, CITY_CODES,
} from './tdx.js';
import { createWeather } from './weather.js';
import { fetchTrailNotices, filterTrailNotices, fetchControlEvents, nearControlEvents } from './closures.js';

const DEMO = new URLSearchParams(location.search).has('demo');
if (DEMO) {
  const { installDemo } = await import('./demo.js');
  installDemo();
}

const SHOW_LIMIT = 50; // 清單最多顯示幾個（也是一次算路線的數量）
const store = createStore();
const state = {
  settings: store.getSettings(),
  center: null,
  cat: 'eat',
  sub: 'all',
  raw: [],
  truncated: false,
  seq: 0,
  routesPending: false,
  view: 'nearby',
  county: null,
  traStation: null,
  stations: null,
};
if (!MODES.some((m) => m.id === state.settings.mode)) state.settings.mode = 'DRIVE';

const placeCache = new Map();
const routeCache = new Map();
let tdx = null;
let weather = null;

const modeInfo = (id = state.settings.mode) => MODES.find((m) => m.id === id) ?? MODES[2];
const currentCat = () => CATEGORIES.find((c) => c.id === state.cat);
const currentSub = () => currentCat().subs.find((s) => s.id === state.sub) ?? currentCat().subs[0];
const routeKey = (mode, id) => `${roundCoordKey(state.center, 4)}|${mode}|${id}`;

function rebuildClients() {
  const s = state.settings;
  // 示範模式不寫入本機快取，免得假資料留到正式模式
  tdx = createTdx({ id: s.tdxId.trim(), secret: s.tdxSecret.trim(), storage: DEMO ? null : globalThis.localStorage });
  weather = createWeather({ key: DEMO ? 'demo-key' : s.cwaKey.trim() });
}

// ================= 位置 =================

function renderLocation() {
  const c = state.center;
  $('#loc-label').textContent = c ? c.label : '尚未定位';
  $('#loc-sub').textContent = c ? c.sub || '點這裡切換位置' : '點這裡選擇位置';
}

function setCenter(c) {
  state.center = { lat: c.lat, lng: c.lng, label: c.label, sub: c.sub ?? '', gps: Boolean(c.gps) };
  state.county = null;
  state.traStation = null;
  state.settings = store.saveSettings({ lastCenter: state.center });
  renderLocation();
  refreshAll();
}

function locateMe({ quiet = false } = {}) {
  if (!navigator.geolocation) {
    if (!quiet) toast('這個瀏覽器不支援定位');
    if (!state.center) useDefaultCenter('這個瀏覽器不支援定位');
    return;
  }
  $('#loc-label').textContent = '定位中…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      setCenter({ lat, lng, label: '目前位置', sub: `GPS 精確度約 ${Math.round(accuracy)} 公尺`, gps: true });
    },
    (err) => {
      const msg = err.code === 1 ? '沒有定位權限，請在瀏覽器設定允許定位' : '暫時無法定位，請稍後再試';
      if (!quiet) toast(msg);
      if (!state.center) useDefaultCenter(msg);
      else renderLocation();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

function useDefaultCenter(reason) {
  setCenter({ ...DEFAULT_CENTER, label: DEFAULT_CENTER.name, sub: `預設地點・${reason}` });
}

function openLocationSheet() {
  setChildren($('#search-results'));
  $('#search-input').value = '';
  setChildren(
    $('#preset-list'),
    PRESETS.map((g) =>
      h('div', { class: 'preset-group' }, h('h3', {}, g.group), h('div', { class: 'chips' },
        g.places.map((p) => h('button', {
          class: 'chip',
          type: 'button',
          onclick: () => {
            $('#loc-sheet').close();
            setCenter({ lat: p.lat, lng: p.lng, label: p.name, sub: `${g.group}・預設地點` });
          },
        }, p.name)),
      )),
    ),
  );
  $('#loc-sheet').showModal();
}

async function onSearch(e) {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  const box = $('#search-results');
  if (!q) return;
  setChildren(box, h('li', { class: 'status' }, '搜尋中…'));
  try {
    const results = await searchPlace(q, state.center);
    if (!results.length) return setChildren(box, h('li', { class: 'status' }, '找不到這個地名，試試更完整的名稱（例如「花蓮縣 清水斷崖」）'));
    setChildren(box, results.map((r) => h('li', {}, h('button', {
      type: 'button',
      onclick: () => {
        $('#loc-sheet').close();
        setCenter({ lat: r.lat, lng: r.lng, label: r.name, sub: r.address });
      },
    }, h('b', {}, r.name), h('div', { class: 'row-sub' }, r.address)))));
  } catch (err) {
    setChildren(box, h('li', { class: 'status error' }, err.message));
  }
}

// ================= 附近 =================

function renderControls() {
  setChildren($('#cat-chips'), CATEGORIES.map((c) => h('button', {
    class: 'chip', type: 'button', role: 'tab', 'aria-selected': String(c.id === state.cat),
    onclick: () => {
      state.cat = c.id;
      state.sub = c.subs[0].id;
      renderControls();
      loadNearby();
    },
  }, `${c.icon} ${c.label}`)));

  const subs = currentCat().subs;
  $('#sub-chips').hidden = subs.length < 2;
  setChildren($('#sub-chips'), subs.map((s) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(s.id === state.sub),
    onclick: () => {
      state.sub = s.id;
      renderControls();
      loadNearby();
    },
  }, s.label)));

  setChildren($('#mode-seg'), MODES.map((m) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(m.id === state.settings.mode),
    onclick: () => {
      saveSetting({ mode: m.id });
      renderControls();
      renderPlaces();
      loadRoutes(state.seq);
    },
  }, m.label)));

  setChildren($('#radius-select'), RADII.map((o) => h('option', { value: o.value, selected: o.value === state.settings.radius }, o.label)));
  $('#open-now').checked = state.settings.openNowOnly;
}

function saveSetting(patch) {
  state.settings = store.saveSettings(patch);
}

function setStatus(msg, isError = false) {
  const el = $('#nearby-status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

/** 依目前條件算出要顯示的清單：重算距離與營業狀態、套上路線時間、只取最近 SHOW_LIMIT 個 */
function visiblePlaces() {
  const now = new Date();
  const { openNowOnly, mode, radius } = state.settings;
  const list = state.raw
    .map((p) => {
      const routes = {};
      for (const m of MODES) {
        const k = routeKey(m.id, p.id);
        if (routeCache.has(k)) routes[m.id] = routeCache.get(k);
      }
      return { ...p, distance: haversine(state.center, p), hours: hoursFromOsm(p.openingHours, now), routes };
    })
    .filter((p) => p.distance <= radius);
  const nearest = filterPlaces(list, { openNowOnly }).sort((a, b) => a.distance - b.distance).slice(0, SHOW_LIMIT);
  return sortPlaces(nearest, 'distance', mode);
}

async function loadNearby() {
  const seq = ++state.seq;
  if (!state.center) return;
  const sub = currentSub();
  const { radius } = state.settings;
  // 查詢中心取約 550 公尺的格點、半徑多抓 800 公尺：走動一小段路還能用同一份快取
  const qc = { lat: Math.round(state.center.lat / 0.005) * 0.005, lng: Math.round(state.center.lng / 0.005) * 0.005 };
  const qr = radius + 800;
  const cacheKey = [qc.lat.toFixed(3), qc.lng.toFixed(3), state.cat, sub.id, radius].join('|');
  setStatus('搜尋中…');
  setChildren($('#place-list'));
  const slowHint = setTimeout(() => {
    if (seq === state.seq) setStatus('搜尋中…免費的開放地圖伺服器比較慢，請稍候（第一次查詢較久，之後會快取）');
  }, 6000);
  try {
    const hit = placeCache.get(cacheKey);
    let result;
    if (hit && Date.now() - hit.at < 15 * 60 * 1000) {
      result = hit.result;
    } else {
      const json = await queryOverpass(buildOverpassQuery(sub.q, qc, qr));
      result = parseOverpass(json, qc, qr, { named: sub.named !== false });
      placeCache.set(cacheKey, { at: Date.now(), result });
    }
    clearTimeout(slowHint);
    if (seq !== state.seq) return;
    state.raw = result.places;
    state.truncated = result.truncated;
    renderPlaces();
    await loadRoutes(seq);
  } catch (err) {
    clearTimeout(slowHint);
    if (seq === state.seq) setStatus(err.message, true);
  }
}

async function loadRoutes(seq) {
  const mode = state.settings.mode;
  const missing = visiblePlaces().filter((p) => !routeCache.has(routeKey(mode, p.id)));
  if (!missing.length) return;
  state.routesPending = true;
  renderPlaces();
  try {
    const results = await computeTable(mode, state.center, missing);
    missing.forEach((p, i) => routeCache.set(routeKey(mode, p.id), results[i]));
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    state.routesPending = false;
  }
  if (seq === state.seq) renderPlaces();
}

function statusPill(p) {
  const s = openStatus(p.hours);
  const label = s.kind === 'unknown' && p.openingHours ? '營業時間見詳情' : s.label;
  return h('span', { class: `pill pill-${s.kind}` }, label);
}

function travelText(p, mode) {
  const has = Object.prototype.hasOwnProperty.call(p.routes, mode);
  const r = p.routes[mode];
  if (r) return { time: formatDuration(r.seconds), dist: formatDistance(r.meters) };
  if (has) return { time: '無路線', dist: `直線 ${formatDistance(p.distance)}` };
  return { time: state.routesPending ? '計算中' : '—', dist: `直線 ${formatDistance(p.distance)}` };
}

const placeMeta = (p) => [p.type, p.cuisine].filter(Boolean).map((t) => h('span', {}, t));
const favPayload = (p) => ({ id: p.id, name: p.displayName, lat: p.lat, lng: p.lng, address: p.address, type: p.type });

function favButton(p, onChange) {
  const on = store.isFavorite(p.id);
  return h('button', {
    class: `btn${on ? ' fav-on' : ''}`, type: 'button', 'aria-pressed': String(on),
    onclick: (e) => {
      const now = store.toggleFavorite(favPayload(p));
      toast(now ? `已收藏「${p.displayName}」` : `已取消收藏「${p.displayName}」`);
      e.currentTarget.replaceWith(favButton(p, onChange));
      onChange?.();
    },
  }, on ? '★ 已收藏' : '☆ 收藏');
}

function renderPlaces() {
  const list = $('#place-list');
  const mode = state.settings.mode;
  const shown = visiblePlaces();
  const inRange = state.raw.filter((p) => haversine(state.center, p) <= state.settings.radius);
  const closed = inRange.filter(isClosedBusiness).length;
  const now = new Date();
  const notOpen = state.settings.openNowOnly
    ? inRange.filter((p) => !isClosedBusiness(p) && hoursFromOsm(p.openingHours, now)?.openNow === false).length
    : 0;
  const notes = [closed && `排除標記停業 ${closed} 個`, notOpen && `隱藏休息中 ${notOpen} 個`].filter(Boolean);
  const total = inRange.length - closed - notOpen;
  if (!state.raw.length) {
    setStatus('這個範圍內沒有找到，試試擴大範圍或換個分類');
  } else {
    setStatus([
      `找到 ${total} 個${total > shown.length ? `，顯示最近 ${shown.length} 個` : ''}`,
      notes.length ? `（${notes.join('、')}）` : '',
      state.truncated ? '・範圍內地點太多，建議縮小範圍' : '',
      modeInfo().note ? `・${modeInfo().short}時間${modeInfo().note}` : '',
    ].join(''));
  }
  setChildren(list, shown.map((p, i) => {
    const t = travelText(p, mode);
    return h('li', { class: 'card' },
      h('div', { class: 'card-main', onclick: () => openDetail(p), role: 'button', tabindex: '0' },
        h('div', { class: 'card-info' },
          h('h3', { class: 'card-name' }, `${i + 1}. ${p.displayName}`),
          h('div', { class: 'card-meta' }, placeMeta(p)),
          p.address && h('div', { class: 'card-meta' }, p.address),
          statusPill(p),
        ),
        h('div', { class: 'travel' },
          h('div', { class: 'travel-time' }, t.time),
          h('div', { class: 'travel-dist' }, `${modeInfo().short}・${t.dist}`),
        ),
      ),
      h('div', { class: 'card-actions' },
        h('a', { class: 'btn btn-primary', href: directionsUrl(p, modeInfo().nav), target: '_blank', rel: 'noopener' }, '🧭 導航'),
        favButton(p),
        h('button', { class: 'btn', type: 'button', onclick: () => openDetail(p) }, '詳情'),
      ),
    );
  }));
  if (state.view === 'map') showMap();
}

// ================= 詳情 =================

const NAV_LINKS = [
  { label: '🛵 機車導航', mode: 'two-wheeler' },
  { label: '🚗 開車導航', mode: 'driving' },
  { label: '🚌 大眾運輸', mode: 'transit' },
  { label: '🚶 步行導航', mode: 'walking' },
];

async function openDetail(p) {
  $('#detail-title').textContent = p.displayName;
  const body = $('#detail-body');
  const timesBox = h('div', { class: 'detail-times' });
  const weekly = p.hours?.weekdayDescriptions;
  const todayIdx = (twParts(new Date()).weekday + 6) % 7;
  setChildren(body,
    h('div', { class: 'card-meta' }, placeMeta(p)),
    p.address && h('p', { class: 'card-meta' }, p.address),
    statusPill(p),
    todayHoursText(p.hours) && h('p', {}, `今天：${todayHoursText(p.hours).replace(/^[^:：]+[:：]\s*/, '')}`),
    h('h3', { class: 'section-title' }, `從「${state.center.label}」出發`),
    timesBox,
    h('p', { class: 'hint' }, '時間由開放資料路線服務估算，不含即時路況；機車以汽車路線估算。'),
    h('div', { class: 'detail-actions' }, NAV_LINKS.map((n) => h('a', { class: 'btn', href: directionsUrl(p, n.mode), target: '_blank', rel: 'noopener' }, n.label))),
    Array.isArray(weekly) && weekly.length === 7
      ? h('details', {},
        h('summary', {}, '每週營業時間'),
        h('ul', { class: 'detail-hours' }, weekly.map((line, i) => h('li', { class: i === todayIdx ? 'today' : '' }, line))))
      : p.openingHours && h('p', { class: 'hint' }, `營業時間（原文）：${p.openingHours}`),
    p.phone && h('p', {}, '📞 ', h('a', { href: `tel:${p.phone.replace(/[^\d+]/g, '')}` }, p.phone)),
    p.website && /^https?:\/\//.test(p.website) && h('p', {}, '🔗 ', h('a', { href: p.website, target: '_blank', rel: 'noopener' }, '官方網站')),
    h('div', { class: 'detail-actions' },
      h('a', { class: 'btn btn-primary', href: googleSearchUrl(p), target: '_blank', rel: 'noopener' }, '在 Google 地圖查評論'),
      favButton(p, () => state.view === 'favs' && renderFavs()),
    ),
    h('p', { class: 'hint' },
      '資料來自 OpenStreetMap 志工，可能未即時更新',
      p.checkDate ? `（最後確認：${p.checkDate}）` : '',
      '。發現已停業可以 ',
      h('a', { href: p.osmUrl, target: '_blank', rel: 'noopener' }, '到 OpenStreetMap 回報'),
      '。'),
  );
  if (!$('#detail-sheet').open) $('#detail-sheet').showModal();

  const renderTimes = () => setChildren(timesBox, MODES.map((m) => {
    const k = routeKey(m.id, p.id);
    const r = routeCache.get(k);
    const label = routeCache.has(k) ? (r ? formatDuration(r.seconds) : '無路線') : '計算中…';
    return h('a', { class: 'detail-time', href: directionsUrl(p, m.nav), target: '_blank', rel: 'noopener' },
      h('small', {}, m.label), h('b', {}, label), h('small', {}, r ? formatDistance(r.meters) : ''));
  }));
  renderTimes();
  await Promise.all(MODES.filter((m) => !routeCache.has(routeKey(m.id, p.id))).map(async (m) => {
    try {
      const [r] = await computeTable(m.id, state.center, [p]);
      routeCache.set(routeKey(m.id, p.id), r);
    } catch {
      routeCache.set(routeKey(m.id, p.id), null);
    }
    renderTimes();
  }));
}

// ================= 地圖 =================

async function showMap() {
  const status = $('#map-status');
  const el = $('#map');
  status.textContent = '';
  // 地圖高度 = 畫面剩下的空間（上方可能有天氣列），底部不能被選單蓋住（右下角要露出資料來源標示）
  const tabbar = document.querySelector('.tabbar').getBoundingClientRect().height;
  el.style.height = `${Math.max(260, window.innerHeight - el.getBoundingClientRect().top - tabbar)}px`;
  try {
    await renderMap(el, state.center, visiblePlaces(), { onSelect: openDetail });
  } catch (err) {
    status.textContent = err.message;
  }
}

// ================= 收藏 =================

let favRoute = null;

function renderFavs() {
  const favs = store.getFavorites();
  const list = $('#fav-list');
  const link = $('#fav-route-link');
  $('#fav-order-btn').disabled = favs.length < 2 || !state.center;
  if (!favs.length) {
    setChildren(list);
    link.hidden = true;
    document.querySelectorAll('[data-extra]').forEach((el) => el.remove());
    $('#fav-status').textContent = '還沒有收藏。在「附近」清單按 ☆ 收藏，想去的地方都會出現在這裡。';
    return;
  }
  $('#fav-status').textContent = favRoute
    ? `已排好順路順序，總直線距離約 ${formatDistance(favRoute.meters)}。`
    : `共 ${favs.length} 個地點，距離為從「${state.center?.label ?? ''}」算的直線距離。`;
  setChildren(list, favs.map((f, i) => h('li', { class: 'card' },
    h('span', { class: 'fav-num' }, String(i + 1)),
    h('div', { class: 'card-info' },
      h('h3', { class: 'card-name' }, f.name),
      h('div', { class: 'card-meta' }, f.type && h('span', {}, f.type), state.center && h('span', {}, `直線 ${formatDistance(haversine(state.center, f))}`)),
    ),
    h('a', { class: 'btn', href: directionsUrl(f, modeInfo().nav), target: '_blank', rel: 'noopener', 'aria-label': `導航到${f.name}` }, '🧭'),
    h('button', {
      class: 'btn', type: 'button', 'aria-label': `移除${f.name}`,
      onclick: () => {
        store.toggleFavorite(f);
        favRoute = null;
        renderFavs();
      },
    }, '✕'),
  )));
  renderRouteLinks(favs);
}

function renderRouteLinks(favs) {
  const link = $('#fav-route-link');
  document.querySelectorAll('[data-extra]').forEach((el) => el.remove());
  if (!favRoute || !state.center) {
    link.hidden = true;
    return;
  }
  const links = routeLinks(state.center, favs, modeInfo().nav);
  link.hidden = false;
  link.href = links[0];
  link.textContent = links.length > 1 ? `用 Google 地圖走第 1 段（共 ${links.length} 段）` : '用 Google 地圖走這條路線';
  link.after(...links.slice(1).map((u, i) => h('a', { class: 'btn', href: u, target: '_blank', rel: 'noopener', dataset: { extra: '1' } }, `第 ${i + 2} 段`)));
}

function orderFavorites() {
  const favs = store.getFavorites();
  if (favs.length < 2 || !state.center) return;
  favRoute = orderStops(state.center, favs);
  store.saveFavoritesOrder(favRoute.order.map((f) => f.id));
  renderFavs();
  toast('已依順路重新排序');
}

// ================= 交通 =================

const emptyNote = (text) => h('p', { class: 'empty' }, text);
const errorNote = (err) => h('p', { class: 'empty status error' }, err.message || String(err));
const guestHint = () => (tdx.hasKey ? null : h('p', { class: 'hint' }, '未填 TDX 帳號：使用免登入額度（每天約 20 次），到「設定」填帳號可放寬。'));

async function ensureStations() {
  if (!state.stations) state.stations = await tdx.stations();
  return state.stations;
}

/** 所在縣市：有氣象署授權碼就用最近測站的縣市（不耗 TDX 額度），否則用最近台鐵站地址；一邊失敗換另一邊 */
async function ensureCounty() {
  if (state.county) return state.county;
  const fromWeather = async () => (weather.hasKey ? (await weather.current(state.center))?.county || null : null);
  const fromTra = async () => {
    const [near] = nearestStations(await ensureStations(), state.center, 1);
    return near ? countyFromAddress(near.address) : null;
  };
  const sources = weather.hasKey ? [fromWeather, fromTra] : [fromTra];
  let lastErr = null;
  for (const src of sources) {
    try {
      const county = await src();
      if (county) return (state.county = county);
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

function loadTransit() {
  if (!state.center) return;
  loadTra();
  loadBus();
}

async function loadTra() {
  const panel = $('#tra-panel');
  setChildren(panel, emptyNote('載入台鐵資料…'));
  try {
    const stations = await ensureStations();
    const near = nearestStations(stations, state.center, 3);
    if (!near.length) return setChildren(panel, emptyNote('找不到台鐵車站資料'));
    const sel = near.find((s) => s.id === state.traStation) ?? near[0];
    state.traStation = sel.id;
    const now = new Date();
    const [table, live] = await Promise.all([
      tdx.stationTimetable(sel.id, twDate(now)),
      tdx.liveBoard(sel.id).catch(() => new Map()),
    ]);
    const rows = upcomingDepartures(table, sel.id, twMinutes(now), live);
    const destSelect = h('select', { 'aria-label': '目的地車站' },
      h('option', { value: '' }, '選擇目的地車站…'),
      [...stations].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')).filter((s) => s.id !== sel.id)
        .map((s) => h('option', { value: s.id }, s.name)));
    const odBox = h('div');
    setChildren(panel,
      h('div', { class: 'station-tabs' }, near.map((s) => h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(s.id === sel.id),
        onclick: () => { state.traStation = s.id; loadTra(); },
      }, `${s.name}站・${formatDistance(s.distance)}`))),
      rows.length
        ? rows.map((r) => h('div', { class: 'row' },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title' }, `${r.dep}　${r.type} ${r.trainNo} 次`),
            h('div', { class: 'row-sub' }, `往 ${r.to}`)),
          h('div', { class: `row-side${r.cancelled ? ' soon' : r.delay ? ' late' : ''}` },
            r.cancelled ? '取消' : r.delay ? `晚 ${r.delay} 分` : r.delay === 0 ? '準點' : '')))
        : emptyNote('今天已經沒有班次了'),
      h('form', {
        class: 'tra-form',
        onsubmit: async (e) => {
          e.preventDefault();
          if (!destSelect.value) return;
          setChildren(odBox, emptyNote('查詢中…'));
          try {
            const d = new Date();
            const trains = parseOdTrains(await tdx.odTimetable(sel.id, destSelect.value, twDate(d)), twMinutes(d));
            const destName = destSelect.selectedOptions[0].textContent;
            setChildren(odBox, h('h3', { class: 'section-title' }, `${sel.name} → ${destName}（今天）`),
              trains.length
                ? trains.map((t) => h('div', { class: 'row' },
                  h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, `${t.dep} → ${t.arr}`), h('div', { class: 'row-sub' }, `${t.type} ${t.trainNo} 次`)),
                  h('div', { class: 'row-side' }, t.minutes !== null ? formatDuration(t.minutes * 60) : '')))
                : emptyNote('今天已經沒有直達班次'));
          } catch (err) {
            setChildren(odBox, errorNote(err));
          }
        },
      }, destSelect, h('button', { class: 'btn btn-primary', type: 'submit' }, '查班次')),
      odBox,
      guestHint(),
    );
  } catch (err) {
    setChildren(panel, errorNote(err), guestHint());
  }
}

async function loadBus() {
  const panel = $('#bus-panel');
  setChildren(panel, emptyNote('尋找附近站牌…'));
  try {
    const county = await ensureCounty();
    const city = CITY_CODES[county];
    const [cityStops, interStops] = await Promise.all([
      city ? tdx.busStopsCity(city, state.center).catch(() => []) : [],
      tdx.busStopsInterCity(state.center).catch(() => []),
    ]);
    const groups = groupBusStops(cityStops, interStops, state.center);
    if (!groups.length) return setChildren(panel, emptyNote('附近 400 公尺內沒有公車站牌'), guestHint());
    const cityUids = groups.flatMap((g) => g.city);
    const interUids = groups.flatMap((g) => g.inter);
    const [cityEta, interEta] = await Promise.all([
      cityUids.length ? tdx.busEtaCity(city, cityUids) : [],
      interUids.length ? tdx.busEtaInterCity(interUids) : [],
    ]);
    const all = [...(cityEta ?? []), ...(interEta ?? [])];
    setChildren(panel,
      groups.map((g) => {
        const uids = new Set([...g.city, ...g.inter]);
        const items = parseBusEta(all.filter((r) => uids.has(r.StopUID)));
        return h('div', { class: 'bus-stop' },
          h('h3', { class: 'section-title' }, `🚏 ${g.name}・${formatDistance(g.distance)}`),
          items.length
            ? items.map((it) => h('div', { class: 'row' },
              h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, it.route), h('div', { class: 'row-sub' }, [it.direction, it.isLast && '末班車'].filter(Boolean).join('・'))),
              h('div', { class: `row-side${it.eta !== null && it.eta < 180 ? ' soon' : ''}` }, busEtaText(it))))
            : emptyNote('這個站牌目前沒有到站資料'));
      }),
      h('button', { class: 'btn btn-block refresh-btn', type: 'button', onclick: loadBus }, '🔄 更新到站時間'),
      guestHint(),
    );
  } catch (err) {
    setChildren(panel, errorNote(err), guestHint());
  }
}

// ================= 路況與天氣 =================

const NEWS_KEYWORDS = {
  花蓮縣: ['花蓮', '蘇花', '中橫', '太魯閣'],
  宜蘭縣: ['宜蘭', '蘇花', '北宜'],
  臺東縣: ['臺東', '台東', '南迴'],
  南投縣: ['南投', '中橫', '合歡山'],
};

const OFFICIAL_LINKS = [
  { title: '太魯閣國家公園：步道開放與中橫、蘇花管制', url: 'https://www.taroko.gov.tw/ch/trailopen/road-and-trail-openings' },
  { title: '公路防救災資訊系統：省道通阻', url: 'https://bobe168.tw/' },
  { title: '台灣山林悠遊網：國家步道', url: 'https://recreation.forest.gov.tw/' },
  { title: '中央氣象署：天氣與颱風', url: 'https://www.cwa.gov.tw/' },
];

function loadRoad() {
  if (!state.center) return;
  loadWarnings();
  loadRoadEvents();
  loadControls();
  loadTrails();
  setChildren($('#links-panel'), h('ul', { class: 'link-list' }, OFFICIAL_LINKS.map((l) => h('li', {}, h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.title)))));
}

async function loadWarnings() {
  const panel = $('#warning-panel');
  if (!weather.hasKey) return setChildren(panel, emptyNote('到「設定」填中央氣象署授權碼（免費），就能看到天氣預報與豪雨、颱風等特報。'));
  setChildren(panel, emptyNote('載入天氣…'));
  try {
    const county = await ensureCounty();
    if (!county) return setChildren(panel, emptyNote('無法判斷所在縣市'));
    const [fc, warns] = await Promise.all([weather.forecast(county), weather.warnings(county)]);
    setChildren(panel,
      warns.length
        ? warns.map((w) => h('div', { class: 'warn-item' }, `⚠️ ${w.title}`, w.end && h('div', { class: 'row-sub' }, `至 ${w.end}`)))
        : h('p', { class: 'empty' }, `${county}目前沒有天氣特報。`),
      fc.map((f) => h('div', { class: 'row' },
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, f.label), h('div', { class: 'row-sub' }, [f.wx, f.ci].filter(Boolean).join('・'))),
        h('div', { class: 'row-side' }, `${f.minT}–${f.maxT}°・☔${f.pop}%`))),
    );
  } catch (err) {
    setChildren(panel, errorNote(err));
  }
}

async function loadRoadEvents() {
  const panel = $('#road-panel');
  setChildren(panel, emptyNote('載入道路事件…'));
  try {
    const county = await ensureCounty();
    const [evJson, newsJson] = await Promise.all([tdx.roadEvents(), tdx.highwayNews().catch(() => null)]);
    const events = parseRoadEvents(evJson, state.center, 60000);
    const short = county ? county.replace(/[縣市]$/, '') : '';
    const keywords = NEWS_KEYWORDS[county] ?? [short];
    const news = newsJson ? filterHighwayNews(newsJson, keywords) : [];
    setChildren(panel,
      h('h3', { class: 'section-title' }, '60 公里內的即時事件'),
      events.length
        ? events.map((e) => h('div', { class: 'row' },
          h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, `${e.title}${e.road ? `・${e.road}` : ''}`), h('div', { class: 'row-sub' }, e.description)),
          h('div', { class: 'row-side' }, formatDistance(e.distance))))
        : emptyNote('目前沒有即時事件'),
      h('h3', { class: 'section-title' }, `公路局消息${short ? `（提到「${keywords.join('、')}」）` : ''}`),
      news.length
        ? news.map((n) => h('div', { class: 'row' },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title' }, n.url ? h('a', { href: n.url, target: '_blank', rel: 'noopener' }, n.title) : n.title),
            n.description && h('div', { class: 'row-sub' }, n.description.slice(0, 120))),
          h('div', { class: 'row-side' }, n.category)))
        : emptyNote('沒有相關消息'),
      guestHint(),
    );
  } catch (err) {
    setChildren(panel, errorNote(err), guestHint());
  }
}

async function loadControls() {
  const panel = $('#control-panel');
  setChildren(panel, emptyNote('載入省道管制路段…'));
  try {
    const events = nearControlEvents(await fetchControlEvents(), state.center, 80000);
    setChildren(panel, events.length
      ? events.map((e) => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, e.route || e.event),
          h('div', { class: 'row-sub' }, [e.event, e.implement].filter(Boolean).join('：').slice(0, 160)),
          e.release && h('div', { class: 'row-sub' }, `預計解除：${e.release}`)),
        h('div', { class: 'row-side' }, formatDistance(e.distance))))
      : emptyNote('80 公里內沒有公路局列管的長期封閉路段'));
  } catch (err) {
    setChildren(panel, errorNote(err));
  }
}

async function loadTrails() {
  const panel = $('#trail-panel');
  setChildren(panel, emptyNote('載入步道公告…'));
  try {
    const county = await ensureCounty().catch(() => null);
    const notices = filterTrailNotices(await fetchTrailNotices(), county);
    setChildren(panel,
      notices.length
        ? notices.map((n) => h('div', { class: 'row' },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title' }, h('a', { href: n.url, target: '_blank', rel: 'noopener' }, n.trail)),
            h('div', { class: 'row-sub' }, `${n.title.slice(0, 120)}（${n.date}・${n.branch}）`)),
          h('div', { class: `row-side${n.status === '暫停開放' ? ' soon' : n.status === '部分封閉' ? ' late' : ''}` }, n.status)))
        : emptyNote('附近的國家步道目前沒有封閉公告'),
      h('p', { class: 'hint' }, '來源：林業及自然保育署（國家步道）。太魯閣國家公園步道請看下方官方連結。'));
  } catch (err) {
    setChildren(panel, errorNote(err));
  }
}

async function loadWeatherStrip() {
  const strip = $('#weather-strip');
  if (!weather.hasKey || !state.center) {
    strip.hidden = true;
    return;
  }
  try {
    const cur = await weather.current(state.center);
    if (!cur) return (strip.hidden = true);
    const county = cur.county || (await ensureCounty().catch(() => null));
    const [fc, warns] = county
      ? await Promise.all([weather.forecast(county).catch(() => []), weather.warnings(county).catch(() => [])])
      : [[], []];
    strip.hidden = false;
    setChildren(strip,
      h('span', { class: 'temp' }, cur.temp !== null ? `${Math.round(cur.temp)}°` : '—'),
      h('span', {},
        h('div', {}, [cur.weather, fc[0] && `降雨 ${fc[0].pop}%`].filter(Boolean).join('・') || '天氣'),
        h('div', { class: 'wx-meta' }, `${cur.town || cur.county || ''} ${cur.stationName} 測站・${formatDistance(cur.distance)}`)),
      warns.length ? h('span', { class: 'alert' }, `⚠️ ${warns[0].title}${warns.length > 1 ? ` 等 ${warns.length} 項` : ''}`) : null,
    );
  } catch {
    strip.hidden = true;
  }
}

// ================= 設定 =================

const KEY_FIELDS = ['cwaKey', 'tdxId', 'tdxSecret'];

function openSettings() {
  const f = $('#settings-form');
  for (const k of KEY_FIELDS) f.elements[k].value = state.settings[k] ?? '';
  $('#settings-sheet').showModal();
}

function saveSettingsForm(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const patch = {};
  for (const k of KEY_FIELDS) patch[k] = f.elements[k].value.trim();
  saveSetting(patch);
  rebuildClients();
  state.stations = null;
  state.county = null;
  $('#settings-sheet').close();
  toast('設定已儲存');
  refreshAll();
}

// ================= 分頁與啟動 =================

function showView(view) {
  state.view = view;
  for (const sec of document.querySelectorAll('main > .view')) sec.hidden = sec.id !== `view-${view}`;
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
  if (view === 'map') showMap();
  if (view === 'transit') loadTransit();
  if (view === 'favs') renderFavs();
  if (view === 'road') loadRoad();
}

function refreshAll() {
  favRoute = null;
  loadNearby();
  loadWeatherStrip();
  if (state.view !== 'nearby') showView(state.view);
}

function bindEvents() {
  $('#loc-btn').addEventListener('click', openLocationSheet);
  $('#gps-btn').addEventListener('click', () => {
    $('#loc-sheet').close();
    locateMe();
  });
  $('#search-form').addEventListener('submit', onSearch);
  $('#settings-btn').addEventListener('click', openSettings);
  $('#settings-form').addEventListener('submit', saveSettingsForm);
  $('#weather-strip').addEventListener('click', () => showView('road'));
  $('#fav-order-btn').addEventListener('click', orderFavorites);
  $('#radius-select').addEventListener('change', (e) => { saveSetting({ radius: Number(e.target.value) }); loadNearby(); });
  $('#open-now').addEventListener('change', (e) => { saveSetting({ openNowOnly: e.target.checked }); renderPlaces(); loadRoutes(state.seq); });
  for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => showView(tab.dataset.view));
  for (const btn of document.querySelectorAll('[data-close]')) btn.addEventListener('click', () => btn.closest('dialog').close());
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // 點背景關閉
  }
}

function init() {
  rebuildClients();
  $('#demo-banner').hidden = !DEMO;
  renderControls();
  bindEvents();
  const last = state.settings.lastCenter;
  if (DEMO) {
    setCenter({ ...DEFAULT_CENTER, label: DEFAULT_CENTER.name, sub: '示範模式' });
  } else if (last) {
    // 上次是手動選的地點（例如規劃別的縣市行程）就保留；上次是 GPS 才自動重新定位
    setCenter(last);
    if (last.gps) locateMe({ quiet: true });
  } else {
    locateMe({ quiet: true });
  }
  if ('serviceWorker' in navigator && !DEMO) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
