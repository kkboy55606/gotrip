import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestObservation, parseForecast, parseWarnings, parseCwaTime } from '../js/weather.js';

// 格式取自中央氣象署官方文件與 2026 年實際回應範例（數值已改寫）
const st = (name, lat, lng, temp, weather, county = '花蓮縣', town = '花蓮市') => ({
  StationName: name,
  StationId: name,
  ObsTime: { DateTime: '2026-10-12T17:00:00+08:00' },
  GeoInfo: {
    Coordinates: [
      { CoordinateName: 'TWD67', StationLatitude: '0', StationLongitude: '0' },
      { CoordinateName: 'WGS84', StationLatitude: String(lat), StationLongitude: String(lng) },
    ],
    CountyName: county,
    TownName: town,
  },
  WeatherElement: { Weather: weather, AirTemperature: temp, RelativeHumidity: '78', Now: { Precipitation: '0.0' } },
});
const center = { lat: 23.99395, lng: 121.60093 };

test('nearestObservation：用 WGS84 座標、跳過溫度 -99 的故障站', () => {
  const json = { success: 'true', records: { Station: [st('故障站', 23.994, 121.601, '-99', '晴'), st('花蓮', 23.977, 121.605, '26.4', '多雲'), st('遠方', 24.5, 121.8, '20.0', '雨')] } };
  const o = nearestObservation(json, center);
  assert.equal(o.stationName, '花蓮');
  assert.equal(o.temp, 26.4);
  assert.equal(o.weather, '多雲');
  assert.equal(o.county, '花蓮縣');
  assert.ok(o.distance < 3000);
});

test('nearestObservation：最近站沒有天氣描述（-99）時，借 30 公里內最近有描述的站', () => {
  const json = { records: { Station: [st('自動站', 23.994, 121.601, '25.0', '-99'), st('氣象站', 24.05, 121.62, '24.0', '陰'), st('太遠', 25.0, 121.5, '20', '晴')] } };
  const o = nearestObservation(json, center);
  assert.equal(o.stationName, '自動站');
  assert.equal(o.weather, '陰');
});

test('nearestObservation：沒資料回 null', () => {
  assert.equal(nearestObservation(null, center), null);
  assert.equal(nearestObservation({ records: { Station: [st('x', 23.99, 121.6, '-99', '-99')] } }, center), null);
});

test('parseCwaTime：無時區字串視為台灣時間', () => {
  assert.equal(parseCwaTime('2026-10-12 18:00:00').toISOString(), '2026-10-12T10:00:00.000Z');
  assert.equal(parseCwaTime('bad'), null);
});

const FORECAST = {
  success: 'true',
  records: {
    location: [{
      locationName: '花蓮縣',
      weatherElement: ['Wx', 'PoP', 'MinT', 'CI', 'MaxT'].map((name, k) => ({
        elementName: name,
        time: [
          ['2026-10-12 18:00:00', '2026-10-13 06:00:00'],
          ['2026-10-13 06:00:00', '2026-10-13 18:00:00'],
          ['2026-10-13 18:00:00', '2026-10-14 06:00:00'],
        ].map(([s, e], i) => ({ startTime: s, endTime: e, parameter: { parameterName: [['多雲', '晴', '陰'], ['40', '10', '20'], ['23', '22', '23'], ['舒適', '舒適', '悶熱'], ['27', '29', '30']][k][i] } })),
      })),
    }],
  },
};

test('parseForecast：三個時段、標上今天/明天', () => {
  const now = new Date('2026-10-12T09:00:00Z'); // 台灣 17:00
  const fc = parseForecast(FORECAST, '花蓮縣', now);
  assert.equal(fc.length, 3);
  assert.deepEqual([fc[0].wx, fc[0].pop, fc[0].minT, fc[0].maxT, fc[0].ci], ['多雲', 40, 23, 27, '舒適']);
  assert.equal(fc[0].label, '今天 18:00–06:00');
  assert.equal(fc[1].label, '明天 06:00–18:00');
  assert.deepEqual(parseForecast({}, '花蓮縣'), []);
});

test('parseWarnings：有特報 → 標題與時間；沒特報 → 空陣列', () => {
  const json = { records: { location: [
    { locationName: '花蓮縣', hazardConditions: { hazards: [{ info: { phenomena: '大雨', significance: '特報' }, validTime: { startTime: '2026-10-12 10:00:00', endTime: '2026-10-13 06:00:00' } }] } },
    { locationName: '臺東縣', hazardConditions: { hazards: [] } },
  ] } };
  assert.deepEqual(parseWarnings(json, '花蓮縣'), [{ title: '大雨特報', start: '10/12 10:00', end: '10/13 06:00' }]);
  assert.deepEqual(parseWarnings(json, '臺東縣'), []);
  assert.deepEqual(parseWarnings(null, '花蓮縣'), []);
});
