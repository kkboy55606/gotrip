// 分類、交通方式、預設地點等設定
// q：Overpass 查詢的選擇器（OpenStreetMap 標籤），會自動加上 (around:半徑,緯度,經度)
// named：false 表示沒有名稱也列出（廁所、停車場這類設施常沒取名）

const A = (k, v) => `nwr["${k}"~"^(${v})$"]`;

export const CATEGORIES = [
  {
    id: 'eat', label: '吃', icon: '🍜',
    subs: [
      { id: 'all', label: '全部', q: [A('amenity', 'restaurant|fast_food|food_court')] },
      { id: 'local', label: '小吃', q: [A('amenity', 'fast_food'), `nwr["amenity"="restaurant"]["cuisine"~"taiwanese|local|regional|noodle|dumpling|beef_noodle|rice|congee"]`] },
      { id: 'brunch', label: '早午餐', q: [`nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["cuisine"~"breakfast|brunch"]`] },
      { id: 'dessert', label: '甜點', q: [A('amenity', 'ice_cream'), A('shop', 'bakery|pastry|confectionery'), `nwr["amenity"~"^(cafe|restaurant)$"]["cuisine"~"dessert|cake|ice_cream|shaved_ice"]`] },
      { id: 'seafood', label: '海鮮', q: [`nwr["amenity"="restaurant"]["cuisine"~"seafood|fish"]`] },
      { id: 'hotpot', label: '火鍋', q: [`nwr["amenity"="restaurant"]["cuisine"~"hot_?pot"]`] },
      { id: 'veg', label: '素食', q: [`nwr["amenity"~"^(restaurant|fast_food)$"]["diet:vegetarian"~"yes|only"]`, `nwr["amenity"~"^(restaurant|fast_food)$"]["cuisine"~"vegetarian|vegan"]`] },
    ],
  },
  {
    id: 'drink', label: '喝', icon: '🥤',
    subs: [
      { id: 'all', label: '全部', q: [A('amenity', 'cafe|bar|pub'), A('shop', 'beverages|tea')] },
      { id: 'boba', label: '手搖飲', q: [A('shop', 'beverages|tea'), `nwr["amenity"~"^(cafe|fast_food)$"]["cuisine"~"bubble_tea|juice|tea"]`] },
      { id: 'coffee', label: '咖啡', q: [A('amenity', 'cafe')] },
      { id: 'bar', label: '酒吧', q: [A('amenity', 'bar|pub|biergarten')] },
    ],
  },
  {
    id: 'play', label: '玩', icon: '🏞️',
    subs: [
      { id: 'all', label: '全部', q: [A('tourism', 'attraction|viewpoint|museum|gallery|zoo|aquarium|theme_park'), A('leisure', 'park|nature_reserve|beach_resort'), `nwr["natural"="beach"]["name"]`] },
      { id: 'nature', label: '自然風景', q: [A('tourism', 'viewpoint'), A('leisure', 'nature_reserve'), `nwr["natural"~"^(beach|hot_spring)$"]["name"]`, `nwr["waterway"="waterfall"]["name"]`, `node["natural"="peak"]["name"]`] },
      { id: 'culture', label: '文化古蹟', q: [A('tourism', 'museum|gallery'), `nwr["historic"]["name"]`, `nwr["amenity"="place_of_worship"]["religion"~"buddhist|taoist|chinese_folk"]["name"]`] },
      { id: 'family', label: '親子', q: [A('tourism', 'zoo|aquarium|theme_park'), A('leisure', 'water_park|park')] },
    ],
  },
  {
    id: 'fun', label: '樂', icon: '🎤',
    subs: [
      { id: 'all', label: '全部', q: [A('amenity', 'nightclub|cinema|karaoke_box|marketplace'), A('leisure', 'bowling_alley|amusement_arcade'), A('shop', 'mall|department_store')] },
      { id: 'nightmarket', label: '夜市', q: [`nwr["name"~"夜市"]`] },
      { id: 'shopping', label: '逛街', q: [A('shop', 'mall|department_store'), A('amenity', 'marketplace')] },
      { id: 'karaoke', label: '唱歌', q: [A('amenity', 'karaoke_box')] },
      { id: 'movie', label: '電影', q: [A('amenity', 'cinema')] },
    ],
  },
  {
    id: 'stay', label: '住', icon: '🏨',
    subs: [
      { id: 'all', label: '全部', q: [A('tourism', 'hotel|hostel|guest_house|motel|apartment|camp_site')] },
      { id: 'hotel', label: '飯店', q: [A('tourism', 'hotel|motel')] },
      { id: 'bnb', label: '民宿・青旅', q: [A('tourism', 'guest_house|hostel|apartment')] },
      { id: 'camp', label: '露營', q: [A('tourism', 'camp_site')] },
    ],
  },
  {
    id: 'facility', label: '設施', icon: '🧰',
    subs: [
      { id: 'cvs', label: '便利商店', q: [A('shop', 'convenience')], named: false },
      { id: 'gas', label: '加油站', q: [A('amenity', 'fuel')], named: false },
      { id: 'parking', label: '停車場', q: [A('amenity', 'parking|motorcycle_parking')], named: false },
      { id: 'toilet', label: '廁所', q: [A('amenity', 'toilets')], named: false },
      { id: 'atm', label: 'ATM', q: [A('amenity', 'atm'), `nwr["amenity"="bank"]["atm"="yes"]`], named: false },
      { id: 'pharmacy', label: '藥局', q: [A('amenity', 'pharmacy'), A('shop', 'chemist')], named: false },
      { id: 'ev', label: '充電站', q: [A('amenity', 'charging_station')], named: false },
      { id: 'hospital', label: '醫院', q: [A('amenity', 'hospital')], named: false },
    ],
  },
];

// 路線時間由免費的 OSRM 計算；沒有大眾運輸（改用按鈕開 Google 地圖查，免費）
export const MODES = [
  { id: 'WALK', label: '🚶 步行', short: '步行', nav: 'walking' },
  { id: 'BIKE', label: '🚲 自行車', short: '自行車', nav: 'bicycling' },
  { id: 'DRIVE', label: '🛵 機車・汽車', short: '騎車', nav: 'driving', note: '以汽車路線估算、未含塞車' },
];

export const RADII = [
  { value: 500, label: '500 公尺內' },
  { value: 1000, label: '1 公里內' },
  { value: 2000, label: '2 公里內' },
  { value: 5000, label: '5 公里內' },
  { value: 10000, label: '10 公里內' },
  { value: 30000, label: '30 公里內' },
];

// 座標以 OpenStreetMap 查證（2026-10）；只是搜尋中心點，精度百公尺內即可
export const PRESETS = [
  {
    group: '花蓮',
    places: [
      { name: '花蓮車站', lat: 23.99395, lng: 121.60093 },
      { name: '東大門夜市', lat: 23.97254, lng: 121.61131 },
      { name: '七星潭', lat: 24.02584, lng: 121.63226 },
      { name: '太魯閣遊客中心', lat: 24.15771, lng: 121.62223 },
      { name: '鯉魚潭', lat: 23.92977, lng: 121.51037 },
    ],
  },
  {
    group: '其他縣市',
    places: [
      { name: '臺北車站', lat: 25.04772, lng: 121.51712 },
      { name: '九份老街', lat: 25.10758, lng: 121.84372 },
      { name: '宜蘭車站', lat: 24.75460, lng: 121.75780 },
      { name: '臺中車站', lat: 24.13711, lng: 120.68687 },
      { name: '日月潭水社', lat: 23.86567, lng: 120.90838 },
      { name: '臺南車站', lat: 22.99794, lng: 120.21241 },
      { name: '高雄車站', lat: 22.63934, lng: 120.30265 },
      { name: '墾丁大街', lat: 21.94509, lng: 120.79897 },
      { name: '臺東車站', lat: 22.79375, lng: 121.12301 },
    ],
  },
];

export const DEFAULT_CENTER = PRESETS[0].places[0];
