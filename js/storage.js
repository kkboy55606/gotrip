// 手機本機儲存（localStorage）：設定、金鑰、收藏、API 用量
// 金鑰只存在使用者自己的手機裡，不進程式碼、不上傳任何伺服器。
// ⚠ 下列 key 與資料格式為凍結契約（見 CLAUDE.md），只能 additive 擴充。

export const KEYS = {
  settings: 'gotrip.settings.v1',
  favorites: 'gotrip.favorites.v1',
  usage: 'gotrip.usage.v1',
};

export const DEFAULT_SETTINGS = {
  googleKey: '',
  cwaKey: '',
  tdxId: '',
  tdxSecret: '',
  mode: 'DRIVE',
  radius: 2000,
  openNowOnly: true,
  minRating: 0,
  sort: 'distance',
  lastCenter: null, // {lat, lng, label, sub}
};

const memoryStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

export function createStore(storage) {
  // 私密瀏覽、儲存被封鎖時 localStorage 可能會丟例外 → 退回記憶體（重新整理就會消失）
  let s = storage;
  try {
    s = s ?? globalThis.localStorage;
    s.getItem('__probe__');
  } catch {
    s = null;
  }
  s = s ?? memoryStorage();

  const read = (key, fallback) => {
    try {
      const raw = s.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      s.setItem(key, JSON.stringify(value));
    } catch {
      /* 空間不足或被封鎖：忽略，不讓整個 App 掛掉 */
    }
  };

  return {
    getSettings: () => ({ ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }),
    saveSettings(patch) {
      const next = { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}), ...patch };
      write(KEYS.settings, next);
      return next;
    },

    getFavorites: () => read(KEYS.favorites, []),
    isFavorite: (id) => read(KEYS.favorites, []).some((f) => f.id === id),
    /** 已收藏就移除、沒收藏就加入；回傳加入後是否為收藏狀態 */
    toggleFavorite(place) {
      const list = read(KEYS.favorites, []);
      const idx = list.findIndex((f) => f.id === place.id);
      if (idx >= 0) {
        list.splice(idx, 1);
        write(KEYS.favorites, list);
        return false;
      }
      const { id, name, lat, lng, address = '', type = '', mapsUri = '' } = place;
      list.push({ id, name, lat, lng, address, type, mapsUri, addedAt: new Date().toISOString() });
      write(KEYS.favorites, list);
      return true;
    },
    /** 更新收藏的名稱/座標（30 天刷新用），會記錄 refreshedAt */
    updateFavorite(id, patch, now = new Date()) {
      const list = read(KEYS.favorites, []);
      const f = list.find((x) => x.id === id);
      if (!f) return;
      Object.assign(f, patch, { refreshedAt: now.toISOString() });
      write(KEYS.favorites, list);
    },
    saveFavoritesOrder(ids) {
      const byId = new Map(read(KEYS.favorites, []).map((f) => [f.id, f]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
      for (const f of byId.values()) if (!ids.includes(f.id)) ordered.push(f);
      write(KEYS.favorites, ordered);
    },

    /** 每月 API 呼叫次數（給使用者估算 Google 費用用），換月自動歸零 */
    countUsage(sku, n = 1, now = new Date()) {
      const month = now.toISOString().slice(0, 7);
      const u = read(KEYS.usage, { month, counts: {} });
      const cur = u.month === month ? u : { month, counts: {} };
      cur.counts[sku] = (cur.counts[sku] ?? 0) + n;
      write(KEYS.usage, cur);
    },
    getUsage(now = new Date()) {
      const month = now.toISOString().slice(0, 7);
      const u = read(KEYS.usage, { month, counts: {} });
      return u.month === month ? u : { month, counts: {} };
    },
  };
}
