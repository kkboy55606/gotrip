// 地圖：Leaflet + 內政部國土測繪中心「臺灣通用電子地圖」（免費、中文標示）
// Leaflet 只在打開地圖分頁時才載入。

const LEAFLET_VER = '1.9.4';
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VER}`;
const TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}';
const ATTRIBUTION = '底圖 © <a href="https://maps.nlsc.gov.tw/" target="_blank" rel="noopener">內政部國土測繪中心</a>｜地點 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap 貢獻者</a>';

let loading = null;
let map = null;
let layer = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${CDN}/leaflet.min.css`;
    document.head.append(css);
    const s = document.createElement('script');
    s.src = `${CDN}/leaflet.min.js`;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('地圖元件載入失敗，請檢查網路。'));
    };
    document.head.append(s);
  });
  return loading;
}

/** 畫出中心點與編號標記；點標記呼叫 onSelect(place) */
export async function renderMap(el, center, places, { onSelect } = {}) {
  await loadLeaflet();
  const L = window.L;
  if (!map) {
    map = L.map(el, { zoomControl: true });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }
  map.invalidateSize(); // 地圖容器剛從隱藏變顯示時要重算尺寸
  layer.clearLayers();
  L.circleMarker([center.lat, center.lng], { radius: 8, color: '#ffffff', weight: 2, fillColor: '#1a73e8', fillOpacity: 1 })
    .bindTooltip('搜尋中心')
    .addTo(layer);
  places.forEach((p, i) => {
    L.marker([p.lat, p.lng], {
      title: p.displayName,
      icon: L.divIcon({ className: 'map-pin', html: `<span>${i + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
    })
      .on('click', () => onSelect?.(p))
      .addTo(layer);
  });
  if (places.length) {
    map.fitBounds(L.latLngBounds([[center.lat, center.lng], ...places.map((p) => [p.lat, p.lng])]), { padding: [36, 36], maxZoom: 17 });
  } else {
    map.setView([center.lat, center.lng], 15);
  }
}
