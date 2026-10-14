// Settings + resume positions persisted in localStorage.
window.Store = (function () {
  const KEY = 'localvr:settings:v2';
  const POS_KEY = 'localvr:positions:v1';
  const defaults = {
    phoneId: 'auto',
    customDiag: 6.5,
    headsetId: 'irusu-ultra',
    tune: {},            // per-headset overrides: { [headsetId]: {ipd, screenLens, vOffset, distortion, fov} }
    swapEyes: false,
    fisheyeFov: 180,
    screenSize: 1.0,     // flat-video virtual screen scale
    subSize: 1.2,
    subDist: 2.5,
    subAngle: 14,        // degrees below eye level
    subBg: 0.45,
    subOffset: 0,        // seconds, + = show later
    brightness: 0,
    contrast: 1,
    saturation: 1,
    sharpness: 0,
    speed: 1,
  };
  let cache = null;

  const read = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  function load() {
    if (!cache) cache = { ...defaults, ...read(KEY, {}) };
    return cache;
  }
  function save(partial) {
    cache = { ...load(), ...partial };
    write(KEY, cache);
    return cache;
  }

  // Effective lens parameters = headset profile + user fine-tuning.
  function optics() {
    const s = load();
    const h = findHeadset(s.headsetId);
    const t = s.tune[h.id] || {};
    return {
      headset: h,
      ipd: t.ipd ?? h.ipd,
      screenLens: t.screenLens ?? h.screenLens,
      vOffset: t.vOffset ?? 0,
      distortion: t.distortion ?? 1,
      fov: t.fov ?? h.fov,
    };
  }
  function setTune(partial) {
    const s = load();
    const tune = { ...s.tune, [s.headsetId]: { ...(s.tune[s.headsetId] || {}), ...partial } };
    return save({ tune });
  }
  function resetTune() {
    const s = load();
    const tune = { ...s.tune };
    delete tune[s.headsetId];
    return save({ tune });
  }

  function phoneDiagonal() {
    const s = load();
    if (s.phoneId === 'custom') return s.customDiag;
    const p = findPhone(s.phoneId);
    return p ? p.diag : estimateDiagonal();
  }
  function phoneLabel() {
    const s = load();
    if (s.phoneId === 'custom') return `Custom (${s.customDiag}")`;
    const p = findPhone(s.phoneId);
    return p ? p.name : `Auto-detect (~${estimateDiagonal()}")`;
  }

  function getPosition(key) { return read(POS_KEY, {})[key] || 0; }
  function setPosition(key, t) {
    const all = read(POS_KEY, {});
    if (t > 0) all[key] = t; else delete all[key];
    const keys = Object.keys(all);
    if (keys.length > 50) delete all[keys[0]];
    write(POS_KEY, all);
  }

  return { load, save, optics, setTune, resetTune, phoneDiagonal, phoneLabel, getPosition, setPosition, defaults };
})();
