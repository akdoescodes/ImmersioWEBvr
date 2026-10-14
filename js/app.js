(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const video = $('#video');
  const playerEl = $('#view-player');

  const state = { file: null, url: null, cues: [], subName: '', projection: '180', layout: 'sbs', detected: false };
  let player = null;
  let playerMode = 'magic';
  let posKey = null;

  // ---------------------------------------------------------------- navigation
  function go(name) {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'home') refreshHome();
    if (name === 'setup') refreshSetup();
    if (name === 'phones') { $('#phone-search').value = ''; renderPhones(); }
    if (name === 'headsets') { $('#headset-search').value = ''; renderHeadsets(); }
    if (name !== 'player') window.scrollTo(0, 0);
  }
  $$('[data-go]').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); go(b.dataset.go); }));

  let toastTimer;
  function toast(msg, ms = 2800) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------------- format detection
  function detectFormat(name, w, h) {
    const n = name.toLowerCase();
    const has = (words) => new RegExp('(^|[^a-z0-9])(' + words + ')(?=[^a-z0-9]|$)').test(n);
    const num = (x) => new RegExp('(^|[^0-9])' + x + '(?=[^0-9]|$)').test(n);
    const a = w && h ? w / h : 16 / 9;
    let projection = null, layout = null;

    if (has('fisheye|fisheye190|fisheye200|mkx200|mkx220|rf52|vrca220|fe')) projection = 'fisheye';
    else if (num('360') || has('360vr|vr360')) projection = '360';
    else if (num('180') || has('vr180|180vr|180x180')) projection = '180';

    if (has('sbs|lr|rl|3dh|hsbs|fsbs|half-sbs|half_sbs|side-by-side|side_by_side|sidebyside')) layout = 'sbs';
    else if (has('tb|ou|bt|3dv|htab|hou|tab|top-bottom|top_bottom|over-under|over_under|overunder')) layout = 'ou';
    else if (has('mono|2d')) layout = 'mono';

    if (!projection) {
      if (Math.abs(a - 2) < 0.12) projection = layout === 'mono' ? '360' : '180';   // 2:1 → VR180 SBS is most common
      else if (Math.abs(a - 1) < 0.08) projection = layout === 'mono' ? '180' : '360';
      else if (Math.abs(a - 0.5) < 0.06) projection = '180';
      else projection = 'flat';
    }
    if (!layout) {
      if (projection === 'flat') layout = a > 3 ? 'sbs' : (a < 1 ? 'ou' : 'mono');
      else if (projection === '360') layout = a > 1.5 ? 'mono' : 'ou';
      else layout = a > 1.5 ? 'sbs' : (a < 0.75 ? 'ou' : 'mono');
    }
    return { projection, layout };
  }

  // ---------------------------------------------------------------- home
  const fmtSize = (b) => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(0) + ' MB';

  function waitFor(el, ok, bad, ms = 15000) {
    return new Promise((res, rej) => {
      const done = (fn, arg) => { clearTimeout(t); el.removeEventListener(ok, a); if (bad) el.removeEventListener(bad, b); fn(arg); };
      const a = () => done(res);
      const b = () => done(rej, el.error);
      const t = setTimeout(() => done(rej, new Error('timeout')), ms);
      el.addEventListener(ok, a, { once: true });
      if (bad) el.addEventListener(bad, b, { once: true });
    });
  }

  async function openVideo(file) {
    if (state.url) URL.revokeObjectURL(state.url);
    state.file = file;
    state.url = URL.createObjectURL(file);
    video.src = state.url;
    $('#dropzone').classList.add('has-file');
    $('#dz-empty').hidden = true;
    $('#media').hidden = false;
    $('#media-name').textContent = file.name;
    $('#media-meta').textContent = 'Reading…';
    updateButtons();
    try {
      await waitFor(video, 'loadedmetadata', 'error');
    } catch (e) {
      $('#media-meta').textContent = 'Your browser cannot play this file (codec not supported).';
      state.file = null;
      updateButtons();
      return;
    }
    const w = video.videoWidth, h = video.videoHeight;
    $('#media-meta').textContent = `${w}×${h} · ${VRPlayer.fmtTime(video.duration)} · ${fmtSize(file.size)}`;
    const d = detectFormat(file.name, w, h);
    setFormat(d.projection, d.layout, true);
    updateButtons();
    makeThumb();
  }

  async function makeThumb() {
    const c = $('#thumb'), ctx = c.getContext('2d');
    try {
      video.muted = true;
      video.currentTime = Math.min(5, (video.duration || 10) * 0.1);
      await waitFor(video, 'seeked', null, 4000);
      const vw = video.videoWidth, vh = video.videoHeight;
      const s = Math.max(c.width / vw, c.height / vh);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(video, (c.width - vw * s) / 2, (c.height - vh * s) / 2, vw * s, vh * s);
    } catch (e) { /* thumbnail is optional */ }
    video.muted = false;
  }

  $('#file-video').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) openVideo(f);
    e.target.value = '';
  });

  async function openSubs(f) {
    try {
      const cues = await Subs.readFile(f);
      if (!cues.length) { toast('No subtitle lines found in that file.'); return; }
      state.cues = cues;
      state.subName = f.name;
      if (player) player.cues = cues;
      refreshHome();
    } catch (e) { toast('Could not read subtitles.'); }
  }
  $('#file-sub').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) openSubs(f);
    e.target.value = '';
  });
  $('#sub-clear').addEventListener('click', () => {
    state.cues = []; state.subName = '';
    if (player) player.cues = [];
    refreshHome();
  });

  // drag & drop (desktop / tablets)
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  document.addEventListener('drop', (e) => {
    for (const f of e.dataTransfer.files) {
      if (/\.(srt|vtt|ass|ssa)$/i.test(f.name)) openSubs(f);
      else if (f.type.startsWith('video/') || /\.(mp4|mkv|webm|mov|m4v)$/i.test(f.name)) openVideo(f);
    }
  });

  function setFormat(projection, layout, auto = false) {
    state.projection = projection;
    state.layout = layout;
    state.detected = auto;
    $('#detect-chip').hidden = !auto;
    for (const id of ['#seg-projection', '#seg2-projection']) $$(id + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === projection));
    for (const id of ['#seg-layout', '#seg2-layout']) $$(id + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === layout));
    if (player && !player.isTest) player.setFormat(projection, layout);
  }
  for (const id of ['#seg-projection', '#seg2-projection']) {
    $$(id + ' button').forEach(b => b.addEventListener('click', () => setFormat(b.dataset.v, state.layout)));
  }
  for (const id of ['#seg-layout', '#seg2-layout']) {
    $$(id + ' button').forEach(b => b.addEventListener('click', () => setFormat(state.projection, b.dataset.v)));
  }

  function updateButtons() {
    const ok = !!state.file;
    $('#btn-vr').disabled = !ok;
    $('#btn-2d').disabled = !ok;
    $('#btn-xr').disabled = !ok;
  }

  function refreshHome() {
    const o = Store.optics();
    $('#dev-headset').textContent = o.headset.name;
    $('#dev-phone').textContent = Store.phoneLabel();
    $('#sub-name').textContent = state.subName || 'Add subtitles';
    $('#sub-info').textContent = state.subName ? `${state.cues.length} lines loaded` : '.srt · .vtt · .ass — optional';
    $('#sub-clear').hidden = !state.subName;
    setFormat(state.projection, state.layout, state.detected);
  }

  // ---------------------------------------------------------------- setup + sliders
  function decimals(step) { const s = String(step); return s.includes('.') ? s.split('.')[1].length : 0; }
  function sliderFormat(el, v) {
    if (el.hasAttribute('data-pct')) return Math.round(v * 100) + '%';
    const sign = el.hasAttribute('data-signed') && v > 0 ? '+' : '';
    return sign + (+v).toFixed(decimals(el.dataset.step)) + (el.dataset.unit || '');
  }
  function sliderValue(el) {
    return el.dataset.tune ? Store.optics()[el.dataset.tune] : Store.load()[el.dataset.setting];
  }
  function refreshSliders() {
    $$('.slider').forEach(el => {
      const v = sliderValue(el);
      $('input', el).value = v;
      $('output', el).textContent = sliderFormat(el, v);
    });
    $('#swap-eyes').checked = !!Store.load().swapEyes;
  }
  $$('.slider').forEach(el => {
    const input = $('input', el);
    input.min = el.dataset.min; input.max = el.dataset.max; input.step = el.dataset.step;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (el.dataset.tune) Store.setTune({ [el.dataset.tune]: v });
      else Store.save({ [el.dataset.setting]: v });
      $('output', el).textContent = sliderFormat(el, v);
      // keep duplicate sliders (setup page + in-player sheet) in sync
      const key = el.dataset.tune || el.dataset.setting;
      $$(`.slider[data-setting="${key}"], .slider[data-tune="${key}"]`).forEach(o => {
        if (o !== el) { $('input', o).value = v; $('output', o).textContent = sliderFormat(o, v); }
      });
      if (key === 'customDiag') renderPhones($('#phone-search').value);
      applyLive();
    });
  });
  $('#swap-eyes').addEventListener('change', (e) => { Store.save({ swapEyes: e.target.checked }); applyLive(); });
  $('#tune-reset').addEventListener('click', () => { Store.resetTune(); refreshSliders(); applyLive(); toast('Lens settings reset for this headset.'); });

  function applyLive() {
    if (!player) return;
    player.applySettings(Store.load());
    player.setOptics(Store.optics(), Store.phoneDiagonal());
  }

  function refreshSetup() {
    $('#setup-phone').textContent = Store.phoneLabel();
    $('#setup-headset').textContent = Store.optics().headset.name;
    refreshSliders();
  }

  function li(name, meta, selected, onClick) {
    const el = document.createElement('li');
    el.innerHTML = '<span class="pl-name"></span><span class="pl-meta"></span>';
    el.firstChild.textContent = name;
    el.lastChild.textContent = meta || '';
    if (selected) el.classList.add('sel');
    el.addEventListener('click', onClick);
    return el;
  }
  function group(title) {
    const el = document.createElement('li');
    el.className = 'group';
    el.textContent = title;
    return el;
  }

  function renderPhones(q = '') {
    const s = Store.load(), list = $('#phone-list');
    q = q.trim().toLowerCase();
    list.innerHTML = '';
    $('#custom-size').hidden = s.phoneId !== 'custom';
    const pick = (id) => { Store.save({ phoneId: id }); applyLive(); if (id === 'custom') renderPhones(q); else go('setup'); };
    if (!q) {
      list.append(group('Automatic'));
      list.append(li('Auto-detect', `~${estimateDiagonal()}"`, s.phoneId === 'auto', () => pick('auto')));
      list.append(li('Custom screen size', `${s.customDiag}"`, s.phoneId === 'custom', () => pick('custom')));
      list.append(group('Phones'));
    }
    PHONES.filter(p => !q || p.name.toLowerCase().includes(q))
      .forEach(p => list.append(li(p.name, p.diag + '"', s.phoneId === p.id, () => pick(p.id))));
  }
  $('#phone-search').addEventListener('input', (e) => renderPhones(e.target.value));

  function renderHeadsets(q = '') {
    const s = Store.load(), list = $('#headset-list');
    q = q.trim().toLowerCase();
    list.innerHTML = '';
    const add = (title, items) => {
      const m = items.filter(h => !q || h.name.toLowerCase().includes(q));
      if (!m.length) return;
      list.append(group(title));
      m.forEach(h => list.append(li(h.name, '', s.headsetId === h.id, () => {
        Store.save({ headsetId: h.id }); applyLive(); go('setup');
      })));
    };
    add('Popular HMDs', HEADSETS.popular);
    add('Other HMDs', HEADSETS.other);
  }
  $('#headset-search').addEventListener('input', (e) => renderHeadsets(e.target.value));

  // ---------------------------------------------------------------- test pattern
  function makeTestPattern() {
    const c = document.createElement('canvas');
    c.width = 4096; c.height = 2048;
    const ctx = c.getContext('2d'), W = c.width, H = c.height, ppd = W / 360;
    ctx.fillStyle = '#15151b'; ctx.fillRect(0, 0, W, H);
    for (let lon = 0; lon <= 360; lon += 15) {
      ctx.strokeStyle = lon % 45 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.32)';
      ctx.lineWidth = lon % 45 ? 2 : 4;
      ctx.beginPath(); ctx.moveTo(lon * ppd, 0); ctx.lineTo(lon * ppd, H); ctx.stroke();
    }
    for (let lat = 0; lat <= 180; lat += 15) {
      ctx.strokeStyle = lat === 90 ? '#ff6b6b' : (lat % 45 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.32)');
      ctx.lineWidth = lat === 90 ? 5 : (lat % 45 ? 2 : 4);
      ctx.beginPath(); ctx.moveTo(0, lat * ppd); ctx.lineTo(W, lat * ppd); ctx.stroke();
    }
    const cx = W / 2, cy = H / 2;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    for (const deg of [5, 10, 20, 30]) {
      ctx.beginPath(); ctx.arc(cx, cy, deg * ppd, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '600 26px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(deg + '°', cx + deg * ppd * 0.72, cy - deg * ppd * 0.72);
    }
    ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(cx - 60, cy); ctx.lineTo(cx + 60, cy); ctx.moveTo(cx, cy - 60); ctx.lineTo(cx, cy + 60); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 90px system-ui, sans-serif';
    [['FRONT', 180], ['RIGHT', 270], ['BACK', 0], ['BACK', 360], ['LEFT', 90]].forEach(([t, lon]) => ctx.fillText(t, lon * ppd, cy - 37 * ppd));
    ctx.font = '600 34px system-ui, sans-serif';
    ctx.fillText('Two crosses? → adjust Lens spacing', cx, cy + 33 * ppd);
    ctx.fillText('Bent lines? → adjust Distortion', cx, cy + 37 * ppd);
    return c;
  }

  // ---------------------------------------------------------------- player
  async function requestMotion() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        await DeviceOrientationEvent.requestPermission();
      }
    } catch (e) {}
  }
  async function enterFullscreen() {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      }
    } catch (e) {}
  }
  async function lockLandscape() {
    try { await screen.orientation.lock('landscape'); } catch (e) {}
  }
  function unlockOrientation() {
    try { screen.orientation.unlock(); } catch (e) {}
  }

  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (player && document.visibilityState === 'visible') keepAwake();
    if (document.visibilityState === 'hidden') savePosition();
  });

  function setPlayerMode(mode) {
    playerMode = mode;
    playerEl.classList.toggle('cardboard', mode === 'cardboard');
    document.body.classList.toggle('cb', mode === 'cardboard');
    $('#toast').classList.remove('show');
    if (player) player.setMode(mode);
    $('#p-gyro').classList.toggle('on', !!(player && player.gyroWanted));
    $('#p-cc').classList.toggle('on', !!(player && player.subsOn && state.cues.length));
    if (mode === 'magic') showHud();
  }

  async function start(mode, test = false) {
    if (!test && !state.file) return;
    await requestMotion();
    if (mode !== 'xr') await enterFullscreen();
    if (mode === 'cardboard') await lockLandscape();

    go('player');
    history.pushState({ player: 1 }, '');
    playerEl.classList.toggle('cardboard', mode === 'cardboard');

    if (player) player.dispose();
    player = new VRPlayer($('#gl'), {
      onSubtitle: (t) => { $('#sub2d').textContent = t; },
      onExit: () => exitPlayer(),
      onToast: (m) => toast(m, 4000),
      onCanvasTap: () => toggleHud(),
      onXREnd: () => setPlayerMode(player ? player.mode : 'magic'),
    });
    player.isTest = test;
    const title = test ? 'Test pattern' : state.file.name;
    $('#p-title').textContent = title;
    player.load({
      source: test ? makeTestPattern() : video,
      title,
      projection: test ? '360' : state.projection,
      layout: test ? 'mono' : state.layout,
      cues: test ? [] : state.cues,
      settings: Store.load(),
    });
    player.setOptics(Store.optics(), Store.phoneDiagonal());
    setPlayerMode(mode === 'xr' ? 'magic' : mode);
    keepAwake();

    if (mode === 'xr') {
      try { await player.enterXR(); }
      catch (e) { toast('WebXR could not start: ' + (e.message || e)); }
    }

    if (!test) {
      posKey = state.file.name + '|' + state.file.size;
      const saved = Store.getPosition(posKey);
      video.currentTime = saved > 10 && saved < video.duration - 15 ? saved : 0;
      if (saved > 10 && saved < video.duration - 15) toast('Resumed at ' + VRPlayer.fmtTime(saved));
      video.playbackRate = Store.load().speed || 1;
      video.muted = false;
      video.play().catch(() => { showHud(); if (player) player.tap(); });
    }
    syncPlayButton();
    if (mode === 'cardboard') setTimeout(() => toast('Tap the headset button to open the menu'), test ? 0 : 3200);
  }

  function savePosition() {
    if (posKey && video.duration && !(player && player.isTest)) Store.setPosition(posKey, video.ended ? 0 : video.currentTime);
  }

  function exitPlayer(fromPop = false) {
    if (!player) return;
    savePosition();
    video.pause();
    player.dispose();
    player = null;
    $('#sheet').hidden = true;
    playerEl.classList.remove('cardboard');
    document.body.classList.remove('cb');
    $('#sub2d').textContent = '';
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    unlockOrientation();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    go('home');
    if (!fromPop && history.state && history.state.player) history.back();
  }
  window.addEventListener('popstate', () => { if (player) exitPlayer(true); });

  $('#btn-vr').addEventListener('click', () => start('cardboard'));
  $('#btn-2d').addEventListener('click', () => start('magic'));
  $('#btn-xr').addEventListener('click', () => start('xr'));
  $('#btn-test').addEventListener('click', () => start('cardboard', true));

  // ---------------------------------------------------------------- 2D HUD
  let hudTimer;
  function showHud() {
    $('#hud2d').classList.remove('faded');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => { if (!video.paused && $('#sheet').hidden) $('#hud2d').classList.add('faded'); }, 3500);
  }
  function toggleHud() {
    if ($('#hud2d').classList.contains('faded')) showHud();
    else $('#hud2d').classList.add('faded');
  }
  $('#hud2d').addEventListener('pointerdown', showHud);

  function syncPlayButton() {
    $('#p-play use').setAttribute('href', video.paused ? '#i-play' : '#i-pause');
  }
  video.addEventListener('play', () => { syncPlayButton(); showHud(); });
  video.addEventListener('pause', () => { syncPlayButton(); showHud(); savePosition(); });
  video.addEventListener('ended', () => { savePosition(); showHud(); });

  let seeking = false, lastSave = 0;
  const seek = $('#seek');
  seek.addEventListener('input', () => {
    seeking = true;
    if (video.duration) {
      const t = seek.value / 1000 * video.duration;
      video.currentTime = t;
      $('#t-cur').textContent = VRPlayer.fmtTime(t);
    }
  });
  seek.addEventListener('change', () => { seeking = false; });
  video.addEventListener('timeupdate', () => {
    if (!player || !video.duration) return;
    if (!seeking) seek.value = video.currentTime / video.duration * 1000;
    $('#t-cur').textContent = VRPlayer.fmtTime(video.currentTime);
    $('#t-dur').textContent = VRPlayer.fmtTime(video.duration);
    if (Date.now() - lastSave > 5000) { lastSave = Date.now(); savePosition(); }
  });

  $('#p-play').addEventListener('click', () => { if (player) player.togglePlay(); });
  $('#p-rew').addEventListener('click', () => player && player.seekBy(-10));
  $('#p-fwd').addEventListener('click', () => player && player.seekBy(10));
  $('#p-exit').addEventListener('click', () => exitPlayer());
  $('#p-cc').addEventListener('click', () => {
    if (!player) return;
    if (!state.cues.length) { toast('No subtitles loaded — add a .srt on the home screen.'); return; }
    player.subsOn = !player.subsOn; player.subText = null;
    $('#p-cc').classList.toggle('on', player.subsOn);
  });
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  $('#p-speed').addEventListener('click', () => {
    const cur = Store.load().speed || 1;
    const next = speeds[(speeds.indexOf(cur) + 1) % speeds.length] || 1;
    Store.save({ speed: next });
    video.playbackRate = next;
    $('#p-speed').textContent = next + '×';
  });
  $('#p-gyro').addEventListener('click', async () => {
    if (!player) return;
    if (player.gyroWanted) { player.disableGyro(); toast('Motion look-around off'); }
    else { await requestMotion(); await player.enableGyro(); player.recenter(); toast('Motion look-around on'); }
    $('#p-gyro').classList.toggle('on', player.gyroWanted);
  });
  $('#p-tovr').addEventListener('click', async () => {
    await enterFullscreen(); await lockLandscape();
    setPlayerMode('cardboard');
    toast('Tap the headset button to open the menu');
  });
  $('#cb-2d').addEventListener('click', () => { unlockOrientation(); setPlayerMode('magic'); });
  $('#cb-exit').addEventListener('click', () => exitPlayer());
  $('#p-sheet').addEventListener('click', () => { $('#sheet').hidden = false; refreshSliders(); clearTimeout(hudTimer); });
  $('#sheet-close').addEventListener('click', () => { $('#sheet').hidden = true; showHud(); });
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') { $('#sheet').hidden = true; showHud(); } });

  // keyboards and Bluetooth remotes
  document.addEventListener('keydown', (e) => {
    if (!player || e.target.tagName === 'INPUT') return;
    const k = e.key;
    if (k === ' ' || k === 'k' || k === 'MediaPlayPause') { e.preventDefault(); player.togglePlay(); }
    else if (k === 'Enter') { e.preventDefault(); if (playerMode === 'cardboard' || player.mode === 'xr') player.tap(); else player.togglePlay(); }
    else if (k === 'ArrowLeft' || k === 'MediaTrackPrevious') player.seekBy(-10);
    else if (k === 'ArrowRight' || k === 'MediaTrackNext') player.seekBy(10);
    else if (k === 'ArrowDown') player.seekBy(-60);
    else if (k === 'ArrowUp') player.seekBy(60);
    else if (k === 'r') player.recenter();
    else if (k === 'v') setPlayerMode(playerMode === 'cardboard' ? 'magic' : 'cardboard');
  });

  // ---------------------------------------------------------------- PWA bits
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btn-install').hidden = false; });
  $('#btn-install').addEventListener('click', async () => {
    if (!installEvt) return;
    installEvt.prompt();
    await installEvt.userChoice.catch(() => {});
    installEvt = null; $('#btn-install').hidden = true;
  });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready)
      .then(() => { $('#offline-chip').hidden = false; }).catch(() => {});
  }
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then(ok => { $('#btn-xr').hidden = !ok; }).catch(() => {});
  }

  // test hook for automated checks
  window.LocalVR = { openVideo, openSubs, start, exitPlayer, setFormat, detectFormat, get player() { return player; }, state };

  $('#p-speed').textContent = (Store.load().speed || 1) + '×';
  refreshSliders();
  go('home');
})();
