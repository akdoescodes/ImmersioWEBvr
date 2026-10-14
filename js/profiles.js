// Headset optics. All distances in millimetres.
//   ipd          distance between lens centres
//   screenLens   screen-to-lens distance (bigger = image looks smaller)
//   align        'center' = phone tray centres the lenses vertically (most box headsets)
//                'bottom' = lens height measured from the bottom of the phone (Cardboard)
//   trayToLens   for align:'bottom', lens centre height above the tray
//   k1,k2        radial distortion coefficients of the lens
//   fov          max half-angle visible through the lens (degrees)
window.HEADSETS = {
  popular: [
    { id: 'irusu-ultra', name: 'IRUSU Play VR Ultra', ipd: 63, screenLens: 40, align: 'center', k1: 0.30, k2: 0.20, fov: 50 },
    { id: 'cardboard-2', name: 'Cardboard 2.0',       ipd: 64, screenLens: 39.3, align: 'bottom', trayToLens: 35, k1: 0.34, k2: 0.55, fov: 60 },
    { id: 'gear-vr',     name: 'Samsung Gear VR',     ipd: 62, screenLens: 42, align: 'center', k1: 0.22, k2: 0.24, fov: 50 },
    { id: 'homido-v2',   name: 'Homido V2',           ipd: 64, screenLens: 41, align: 'center', k1: 0.33, k2: 0.24, fov: 50 },
    { id: 'zeiss-vr1',   name: 'Zeiss VR One',        ipd: 64, screenLens: 44, align: 'center', k1: 0.35, k2: 0.30, fov: 50 },
  ],
  other: [
    { id: 'irusu-monster', name: 'IRUSU Monster VR',   ipd: 63, screenLens: 42, align: 'center', k1: 0.30, k2: 0.20, fov: 50 },
    { id: 'irusu-tz',      name: 'IRUSU Play VR Plus', ipd: 63, screenLens: 41, align: 'center', k1: 0.30, k2: 0.20, fov: 50 },
    { id: 'cardboard-1',   name: 'Cardboard 1.0',      ipd: 60, screenLens: 42, align: 'bottom', trayToLens: 35, k1: 0.441, k2: 0.156, fov: 40 },
    { id: 'daydream',      name: 'Google Daydream View', ipd: 62, screenLens: 39, align: 'bottom', trayToLens: 35, k1: 0.385, k2: 0.593, fov: 50 },
    { id: 'vr-box',        name: 'VR Box 2.0',         ipd: 62, screenLens: 42, align: 'center', k1: 0.32, k2: 0.22, fov: 50 },
    { id: 'bobo-z4',       name: 'BoboVR Z4',          ipd: 63, screenLens: 42, align: 'center', k1: 0.29, k2: 0.20, fov: 50 },
    { id: 'bobo-z5',       name: 'BoboVR Z5',          ipd: 63, screenLens: 44, align: 'center', k1: 0.30, k2: 0.22, fov: 55 },
    { id: 'bobo-z6',       name: 'BoboVR Z6',          ipd: 63, screenLens: 43, align: 'center', k1: 0.30, k2: 0.22, fov: 55 },
    { id: 'shinecon',      name: 'VR Shinecon',        ipd: 62, screenLens: 42, align: 'center', k1: 0.33, k2: 0.24, fov: 50 },
    { id: 'destek-v5',     name: 'Destek V5',          ipd: 63, screenLens: 44, align: 'center', k1: 0.30, k2: 0.22, fov: 55 },
    { id: 'merge',         name: 'Merge VR Goggles',   ipd: 61, screenLens: 46, align: 'center', k1: 0.19, k2: 0.18, fov: 50 },
    { id: 'pansonite',     name: 'Pansonite VR',       ipd: 63, screenLens: 42, align: 'center', k1: 0.30, k2: 0.22, fov: 50 },
    { id: 'view-master',   name: 'View-Master Deluxe', ipd: 63, screenLens: 42, align: 'bottom', trayToLens: 33, k1: 0.26, k2: 0.20, fov: 45 },
    { id: 'generic-box',   name: 'Generic VR box (40mm lens)', ipd: 63, screenLens: 41, align: 'center', k1: 0.30, k2: 0.20, fov: 50 },
    { id: 'no-lens',       name: 'No distortion (flat split)', ipd: 63, screenLens: 42, align: 'center', k1: 0, k2: 0, fov: 55 },
  ],
};

// Phones: physical screen diagonal in inches. Width/height come from the
// diagonal plus the real screen aspect ratio reported by the browser.
window.PHONES = [
  ['apple-se2', 'Apple iPhone SE (2nd/3rd gen)', 4.7], ['apple-8', 'Apple iPhone 8', 4.7],
  ['apple-8p', 'Apple iPhone 8 Plus', 5.5], ['apple-x', 'Apple iPhone X / XS', 5.8],
  ['apple-xr', 'Apple iPhone XR / 11', 6.1], ['apple-12', 'Apple iPhone 12 / 13 / 14', 6.1],
  ['apple-15', 'Apple iPhone 15 / 16', 6.1], ['apple-16p', 'Apple iPhone 16 Pro', 6.3],
  ['apple-pm', 'Apple iPhone Pro Max / Plus', 6.7], ['apple-16pm', 'Apple iPhone 16 Pro Max', 6.9],
  ['galaxy-s8', 'Samsung Galaxy S8 / S9', 5.8], ['galaxy-s10', 'Samsung Galaxy S10', 6.1],
  ['galaxy-s10p', 'Samsung Galaxy S10+', 6.4], ['galaxy-s20', 'Samsung Galaxy S20 / S21', 6.2],
  ['galaxy-s22', 'Samsung Galaxy S22 / S23', 6.1], ['galaxy-s24', 'Samsung Galaxy S24 / S25', 6.2],
  ['galaxy-ultra', 'Samsung Galaxy S Ultra', 6.8], ['galaxy-a54', 'Samsung Galaxy A54 / A55', 6.4],
  ['galaxy-a34', 'Samsung Galaxy A34 / A35', 6.6], ['galaxy-m', 'Samsung Galaxy M / F series', 6.6],
  ['pixel-6', 'Google Pixel 6', 6.4], ['pixel-7', 'Google Pixel 7', 6.3], ['pixel-8', 'Google Pixel 8', 6.2],
  ['pixel-9', 'Google Pixel 9 / 9 Pro', 6.3], ['pixel-xl', 'Google Pixel Pro XL', 6.8], ['pixel-a', 'Google Pixel 7a / 8a', 6.1],
  ['oneplus-nord', 'OnePlus Nord / Nord CE', 6.6], ['oneplus-11', 'OnePlus 11 / 12', 6.8], ['oneplus-13', 'OnePlus 13', 6.8],
  ['redmi-note', 'Xiaomi Redmi Note 12 / 13 / 14', 6.67], ['poco-x', 'POCO X / F series', 6.67], ['xiaomi-14', 'Xiaomi 14', 6.36],
  ['realme', 'Realme Number / Narzo series', 6.7], ['vivo', 'Vivo V / T / Y series', 6.6], ['oppo', 'OPPO Reno / A series', 6.7],
  ['iqoo', 'iQOO Z / Neo series', 6.7], ['moto-g', 'Motorola Moto G / Edge', 6.5], ['nothing', 'Nothing Phone (1) / (2)', 6.6],
].map(([id, name, diag]) => ({ id, name, diag }));

window.findHeadset = (id) =>
  [...HEADSETS.popular, ...HEADSETS.other].find(h => h.id === id) || HEADSETS.popular[0];

window.findPhone = (id) => PHONES.find(p => p.id === id) || null;

// Rough screen size guess from CSS pixels (≈150 css px per inch on most phones).
window.estimateDiagonal = () => {
  const w = screen.width, h = screen.height;
  const ppi = /iPhone|iPad/.test(navigator.userAgent) ? 152 : 150;
  return Math.round(Math.hypot(w, h) / ppi * 10) / 10;
};
