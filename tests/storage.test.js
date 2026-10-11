import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DEFAULT_SETTINGS, KEYS } from '../js/storage.js';

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('settings：預設值 + 部分更新會合併', () => {
  const store = createStore(fakeStorage());
  assert.deepEqual(store.getSettings(), DEFAULT_SETTINGS);
  store.saveSettings({ mode: 'WALK' });
  store.saveSettings({ radius: 5000 });
  const s = store.getSettings();
  assert.equal(s.mode, 'WALK');
  assert.equal(s.radius, 5000);
  assert.equal(s.openNowOnly, true);
});

test('settings：儲存內容壞掉時退回預設值，不丟例外', () => {
  const st = fakeStorage();
  st.setItem(KEYS.settings, '{壞掉的json');
  assert.deepEqual(createStore(st).getSettings(), DEFAULT_SETTINGS);
});

test('localStorage 被封鎖（丟例外）時退回記憶體，App 照常運作', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const store = createStore(broken);
  store.saveSettings({ mode: 'DRIVE' });
  assert.equal(store.getSettings().mode, 'DRIVE');
});

test('favorites：toggle 加入/移除、只存必要欄位', () => {
  const store = createStore(fakeStorage());
  const place = { id: 'p1', name: '扁食店', lat: 23.97, lng: 121.6, address: '花蓮市', rating: 4.5, hours: {} };
  assert.equal(store.toggleFavorite(place), true);
  assert.equal(store.isFavorite('p1'), true);
  const [f] = store.getFavorites();
  assert.equal(f.name, '扁食店');
  assert.equal('hours' in f, false);
  assert.ok(f.addedAt);
  assert.equal(store.toggleFavorite(place), false);
  assert.equal(store.getFavorites().length, 0);
});

test('favorites：saveFavoritesOrder 依指定順序，沒列到的接在後面', () => {
  const store = createStore(fakeStorage());
  for (const id of ['a', 'b', 'c']) store.toggleFavorite({ id, name: id, lat: 0, lng: 0 });
  store.saveFavoritesOrder(['c', 'a']);
  assert.deepEqual(store.getFavorites().map((f) => f.id), ['c', 'a', 'b']);
});

test('usage：同月累加、換月歸零', () => {
  const store = createStore(fakeStorage());
  const oct = new Date('2026-10-11T00:00:00Z');
  store.countUsage('nearby', 1, oct);
  store.countUsage('nearby', 2, oct);
  store.countUsage('matrix', 20, oct);
  assert.deepEqual(store.getUsage(oct).counts, { nearby: 3, matrix: 20 });
  const nov = new Date('2026-11-02T00:00:00Z');
  assert.deepEqual(store.getUsage(nov).counts, {});
  store.countUsage('nearby', 1, nov);
  assert.deepEqual(store.getUsage(nov).counts, { nearby: 1 });
});
