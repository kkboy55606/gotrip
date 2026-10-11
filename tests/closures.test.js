import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTrailNotices, parseControlKml, nearControlEvents } from '../js/closures.js';

// 欄位格式取自 2026-10-11 實際資料（內容已改寫）
const TRAILS = [
  { TRAILID: '066', TR_CNAME: '某國家步道', TR_TYP: '注意', Title: '部分路段施工', ANN_DATE: '2026-09-01', DEP_NAME: '花蓮分署' },
  { TRAILID: '154', TR_CNAME: '另一步道', TR_TYP: '暫停開放', Title: '崩塌搶修，暫停開放', ANN_DATE: '2026-09-30', DEP_NAME: '花蓮分署' },
  { TRAILID: '002', TR_CNAME: '北部步道', TR_TYP: '暫停開放', Title: '颱風', ANN_DATE: '2026-09-02', DEP_NAME: '羅東分署' },
];

test('filterTrailNotices：只留該縣市的分署，暫停開放排最前，附上林業署頁面連結', () => {
  const out = filterTrailNotices(TRAILS, '花蓮縣');
  assert.deepEqual(out.map((t) => t.id), ['154', '066']);
  assert.equal(out[0].status, '暫停開放');
  assert.equal(out[0].url, 'https://recreation.forest.gov.tw/Trail/RT?tr_id=154');
});

test('filterTrailNotices：找不到分署（例如澎湖）就全部列出；壞資料不會掛', () => {
  assert.equal(filterTrailNotices(TRAILS, '澎湖縣').length, 3);
  assert.deepEqual(filterTrailNotices(null, '花蓮縣'), []);
});

const KML = `<?xml version="1.0"?><kml><Document>
<Placemark><name>台8臨37線</name><ExtendedData><SchemaData schemaUrl="#ControlEvent">
  <SimpleData name="ROUTE">臺中市和平區省道台8臨37線0K+0~24K+0</SimpleData>
  <SimpleData name="EVENT_NAME">常態性封閉路段</SimpleData>
  <SimpleData name="DISASTER_KIND">道路 預警性封閉</SimpleData>
  <SimpleData name="IMPLEMENT">每日 17:00 至隔日 07:00 封閉 &amp; 管制</SimpleData>
  <SimpleData name="RELEASE_TIME">2026-12-31 23:59:00</SimpleData>
  <SimpleData name="ALTERNATIVE_ROUTE"></SimpleData>
</SchemaData></ExtendedData>
<LineString><coordinates>121.025867,24.209404 121.10,24.20 121.20,24.18</coordinates></LineString></Placemark>
<Placemark><name>台20</name><ExtendedData><SchemaData>
  <SimpleData name="ROUTE">臺東縣海端鄉台20線</SimpleData>
</SchemaData></ExtendedData><LineString><coordinates>120.9609063,23.26406874</coordinates></LineString></Placemark>
</Document></kml>`;

test('parseControlKml：欄位、XML 跳脫字元、座標（經度在前）', () => {
  const ev = parseControlKml(KML);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].route, '臺中市和平區省道台8臨37線0K+0~24K+0');
  assert.equal(ev[0].implement, '每日 17:00 至隔日 07:00 封閉 & 管制');
  assert.equal(ev[0].alternative, '');
  assert.deepEqual(ev[0].points[0], { lat: 24.209404, lng: 121.025867 });
  assert.equal(ev[0].points.length, 3);
  assert.deepEqual(parseControlKml(''), []);
});

test('parseControlKml：上萬個點會抽樣到約 200 點，且保留最後一點', () => {
  const coords = Array.from({ length: 10001 }, (_, i) => `${121 + i * 1e-5},24`).join(' ');
  const [ev] = parseControlKml(`<Placemark><coordinates>${coords}</coordinates></Placemark>`);
  assert.ok(ev.points.length <= 202 && ev.points.length >= 150, `${ev.points.length}`);
  assert.equal(ev.points.at(-1).lng.toFixed(5), (121 + 10000 * 1e-5).toFixed(5));
});

test('nearControlEvents：以路段最近點算距離，只留範圍內', () => {
  const ev = parseControlKml(KML);
  const taroko = { lat: 24.1577, lng: 121.6222 };
  const near = nearControlEvents(ev, taroko, 80000);
  assert.deepEqual(near.map((e) => e.route.slice(0, 3)), ['臺中市']);
  assert.ok(near[0].distance > 40000 && near[0].distance < 50000, `${near[0].distance}`);
  assert.equal(nearControlEvents(ev, taroko, 1000).length, 0);
});
