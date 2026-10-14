// LocalVR player.
//   mode 'magic'     – single full-screen view, drag / gyro to look around (2D)
//   mode 'cardboard' – split-screen stereo with per-headset lens distortion
//   mode 'xr'        – WebXR immersive-vr session (browser handles optics)
// Stereo video halves go to layer 1 (left eye) and layer 2 (right eye).
window.VRPlayer = (function () {
  THREE.ColorManagement.enabled = false;

  const DEG = Math.PI / 180;
  const SPHERE_R = 100;
  const PANEL_W = 1024, PANEL_H = 330, PANEL_M = 1.9;   // canvas px, plane width (m)
  const PANEL_DIST = 2.0;

  const VIDEO_VERT = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const VIDEO_FRAG = `
    uniform sampler2D map;
    uniform vec2 texel;
    uniform float brightness, contrast, saturation, sharpness;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(map, vUv).rgb;
      if (sharpness > 0.001) {
        vec3 blur = 0.25 * (texture2D(map, vUv + vec2(texel.x, 0.0)).rgb + texture2D(map, vUv - vec2(texel.x, 0.0)).rgb
                          + texture2D(map, vUv + vec2(0.0, texel.y)).rgb + texture2D(map, vUv - vec2(0.0, texel.y)).rgb);
        c += (c - blur) * sharpness * 2.0;
      }
      c = (c - 0.5) * contrast + 0.5 + brightness;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, saturation);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`;

  const QUAD_VERT = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  // Screen pixel → tan-angle relative to lens centre → apply lens model →
  // look up the undistorted eye render. Matches the Cardboard distortion model.
  const DISTORT_FRAG = `
    uniform sampler2D tex;
    uniform vec2 eyeSize;       // metres
    uniform vec2 lensCenter;    // metres, from bottom-left of this eye's half
    uniform float screenLens;   // metres
    uniform float k1, k2, tanMax;
    varying vec2 vUv;
    void main() {
      vec2 p = (vUv * eyeSize - lensCenter) / screenLens;
      float r2 = dot(p, p);
      vec2 q = p * (1.0 + k1 * r2 + k2 * r2 * r2);
      vec2 uv = q / (2.0 * tanMax) + 0.5;
      float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      if (edge < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      gl_FragColor = vec4(texture2D(tex, uv).rgb * smoothstep(0.0, 0.02, edge), 1.0);
    }`;

  function stereoRect(layout, eye) {
    if (layout === 'sbs') return { ox: eye === 'right' ? 0.5 : 0, oy: 0, sx: 0.5, sy: 1 };
    if (layout === 'ou')  return { ox: 0, oy: eye === 'right' ? 0 : 0.5, sx: 1, sy: 0.5 };   // top = left eye
    return { ox: 0, oy: 0, sx: 1, sy: 1 };
  }

  function buildGeometry(projection, eyeAspect, opts) {
    let g;
    if (projection === '360') {
      g = new THREE.SphereGeometry(SPHERE_R, 96, 64, Math.PI / 2, Math.PI * 2);
      g.scale(-1, 1, 1);
    } else if (projection === '180') {
      g = new THREE.SphereGeometry(SPHERE_R, 64, 64, Math.PI, Math.PI);
      g.scale(-1, 1, 1);
    } else if (projection === 'fisheye') {
      const half = (opts.fisheyeFov || 180) / 2 * DEG;
      g = new THREE.SphereGeometry(SPHERE_R, 96, 48, 0, Math.PI * 2, 0, half);
      g.rotateX(-Math.PI / 2);
      g.scale(-1, 1, 1);
      const pos = g.attributes.position, uv = g.attributes.uv, d = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        d.fromBufferAttribute(pos, i).normalize();
        const theta = Math.acos(THREE.MathUtils.clamp(-d.z, -1, 1));
        const phi = Math.atan2(d.y, d.x);
        const r = theta / half * 0.5;
        uv.setXY(i, 0.5 + r * Math.cos(phi), 0.5 + r * Math.sin(phi));
      }
    } else {
      const dist = 4;
      const w = 4.6 * (opts.screenSize || 1);
      g = new THREE.PlaneGeometry(w, w / eyeAspect);
      g.translate(0, 0, -dist);
    }
    return g;
  }

  function remapUV(geom, r) {
    const uv = geom.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, r.ox + uv.getX(i) * r.sx, r.oy + uv.getY(i) * r.sy);
    uv.needsUpdate = true;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function fmtTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60);
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }

  class Player {
    constructor(canvas, callbacks = {}) {
      this.canvas = canvas;
      this.cb = callbacks;     // onSubtitle(text), onExit(), onToast(msg), onXREnd()
      this.mode = 'magic';
      this.cues = [];
      this.settings = {};
      this.subText = null;
      this.subsOn = true;

      const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      r.outputColorSpace = THREE.LinearSRGBColorSpace;   // everything is passed through as-is (sRGB in, sRGB out)
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
      r.setClearColor(0x000000, 1);

      this.scene = new THREE.Scene();
      this.contentRoot = new THREE.Group();
      this.scene.add(this.contentRoot);

      this.camera = new THREE.PerspectiveCamera(80, 1, 0.05, 1000);
      this.camera.layers.enable(1);
      this.scene.add(this.camera);

      this.camL = new THREE.PerspectiveCamera(90, 1, 0.05, 1000);
      this.camR = new THREE.PerspectiveCamera(90, 1, 0.05, 1000);
      this.camL.layers.enable(1);
      this.camR.layers.enable(2);

      this.uniforms = {
        map: { value: null }, texel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
        brightness: { value: 0 }, contrast: { value: 1 }, saturation: { value: 1 }, sharpness: { value: 0 },
      };
      this.videoMat = new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: VIDEO_VERT, fragmentShader: VIDEO_FRAG, side: THREE.DoubleSide,
      });

      this._buildDistortion();
      this._buildHud();
      this._initInput();

      this.headQuat = new THREE.Quaternion();
      this.dragYaw = 0; this.dragPitch = 0;
      this.gyroActive = false;
      this.gyroWanted = false;

      this._onResize = () => this._resize();
      window.addEventListener('resize', this._onResize);
      this._resize();
      this.renderer.setAnimationLoop((t, frame) => this._frame(t, frame));
    }

    // ---------------- content ----------------
    load({ source, title, projection, layout, cues, settings }) {
      this.source = source;
      this.title = title || '';
      this.cues = cues || [];
      if (this.texture) this.texture.dispose();
      if (source instanceof HTMLVideoElement) {
        this.texture = new THREE.VideoTexture(source);
        this.srcW = source.videoWidth || 1920; this.srcH = source.videoHeight || 1080;
      } else {
        this.texture = new THREE.CanvasTexture(source);
        this.srcW = source.width; this.srcH = source.height;
      }
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.generateMipmaps = false;
      this.uniforms.map.value = this.texture;
      this.uniforms.texel.value.set(1 / this.srcW, 1 / this.srcH);
      this.applySettings(settings || {});
      this.setFormat(projection, layout);
      this._drawPanel(true);
    }

    setFormat(projection, layout) {
      this.projection = projection;
      this.layout = layout;
      for (const m of this.meshes || []) { this.contentRoot.remove(m); m.geometry.dispose(); }
      const aspect = this.srcW / this.srcH;
      let eyeAspect = aspect;
      if (layout === 'sbs' && aspect >= 2.5) eyeAspect = aspect / 2;       // full-width SBS
      if (layout === 'ou' && aspect <= 1.2) eyeAspect = aspect * 2;        // full-height OU
      const opts = { fisheyeFov: this.settings.fisheyeFov, screenSize: this.settings.screenSize };

      const make = (eye, layer) => {
        const g = buildGeometry(projection, eyeAspect, opts);
        remapUV(g, stereoRect(layout, eye));
        const m = new THREE.Mesh(g, this.videoMat);
        m.layers.set(layer);
        this.contentRoot.add(m);
        return m;
      };
      if (layout === 'mono') this.meshes = [make('mono', 0)];
      else {
        const swap = !!this.settings.swapEyes;
        this.meshes = [make('left', swap ? 2 : 1), make('right', swap ? 1 : 2)];
      }
    }

    applySettings(s) {
      const prev = this.settings;
      this.settings = { ...prev, ...s };
      const st = this.settings;
      this.uniforms.brightness.value = st.brightness ?? 0;
      this.uniforms.contrast.value = st.contrast ?? 1;
      this.uniforms.saturation.value = st.saturation ?? 1;
      this.uniforms.sharpness.value = st.sharpness ?? 0;
      if (this.meshes && (prev.swapEyes !== st.swapEyes || prev.fisheyeFov !== st.fisheyeFov || prev.screenSize !== st.screenSize)) {
        this.setFormat(this.projection, this.layout);
      }
      if (this.source instanceof HTMLVideoElement && st.speed) this.source.playbackRate = st.speed;
      this._layoutSubtitle();
      this.subText = null;      // force redraw
      this._computeLens();
    }

    setOptics(optics, phoneDiag) {
      this.optics = optics;
      this.phoneDiag = phoneDiag;
      this._computeLens();
    }

    // ---------------- modes ----------------
    setMode(mode) {
      this.mode = mode;
      this.hudRoot.visible = mode !== 'magic';
      if (mode !== 'cardboard' && mode !== 'xr') this._hidePanel();
      this._resize();
      if (mode === 'cardboard') this.enableGyro();
    }

    async xrSupported() {
      try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch (e) { return false; }
    }

    async enterXR() {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
      this._modeBeforeXR = this.mode === 'xr' ? 'magic' : this.mode;
      this.mode = 'xr';
      this.hudRoot.visible = true;
      this.camera.layers.disable(1);         // XR adds layers 1/2 per eye itself
      this.renderer.xr.enabled = true;
      this.renderer.xr.setReferenceSpaceType('local');
      await this.renderer.xr.setSession(session);
      session.addEventListener('select', () => this.tap());
      session.addEventListener('end', () => {
        this.renderer.xr.enabled = false;
        this.camera.layers.enable(1);
        this.setMode(this._modeBeforeXR);
        this.cb.onXREnd && this.cb.onXREnd();
      });
    }

    async enableGyro() {
      this.gyroWanted = true;
      if (this._gyroListening) return true;
      try {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
          if (await DeviceOrientationEvent.requestPermission() !== 'granted') return false;
        }
      } catch (e) { return false; }
      window.addEventListener('deviceorientation', this._onOrient, true);
      this._gyroListening = true;
      clearTimeout(this._gyroCheck);
      this._gyroCheck = setTimeout(() => {
        if (!this.gyroActive && this.cb.onToast) {
          this.cb.onToast(window.isSecureContext
            ? 'No motion sensor data — drag to look around.'
            : 'Head tracking needs HTTPS (see README). Drag to look around.');
        }
      }, 1500);
      return true;
    }

    disableGyro() {
      this.gyroWanted = false;
      this.gyroActive = false;
      this._gyroListening = false;
      window.removeEventListener('deviceorientation', this._onOrient, true);
    }

    recenter() {
      const yaw = this._headYaw();
      if (this.mode === 'magic' && !this.gyroActive) {
        this.dragYaw = 0; this.dragPitch = 0; this.contentRoot.rotation.y = 0;
      } else {
        this.contentRoot.rotation.y = yaw;
      }
      this._hudSnap = true;
    }

    setZoom(fov) {
      this.camera.fov = THREE.MathUtils.clamp(fov, 30, 110);
      this.camera.updateProjectionMatrix();
    }

    // ---------------- input ----------------
    _initInput() {
      const zee = new THREE.Vector3(0, 0, 1), euler = new THREE.Euler(), q0 = new THREE.Quaternion();
      const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
      this.sensorQuat = new THREE.Quaternion();
      this._onOrient = (e) => {
        if (e.alpha == null && e.beta == null) return;
        const orient = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * DEG;
        euler.set((e.beta || 0) * DEG, (e.alpha || 0) * DEG, -(e.gamma || 0) * DEG, 'YXZ');
        this.sensorQuat.setFromEuler(euler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -orient));
        if (!this.gyroActive) { this.gyroActive = true; this._hudSnap = true; }
      };

      const c = this.canvas;
      let down = null;
      c.addEventListener('pointerdown', (e) => {
        down = { x: e.clientX, y: e.clientY, yaw: this.dragYaw, pitch: this.dragPitch, moved: false };
        c.setPointerCapture && c.setPointerCapture(e.pointerId);
      });
      c.addEventListener('pointermove', (e) => {
        if (!down || (this.mode !== 'magic' && this.gyroActive)) return;
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) down.moved = true;
        const k = this.camera.fov / c.clientHeight * DEG;
        this.dragYaw = down.yaw + dx * k;
        this.dragPitch = THREE.MathUtils.clamp(down.pitch + dy * k, -1.5, 1.5);
      });
      c.addEventListener('pointerup', () => {
        if (down && !down.moved) {
          if (this.mode === 'cardboard') this.tap();
          else if (this.cb.onCanvasTap) this.cb.onCanvasTap();
        }
        down = null;
      });
      c.addEventListener('wheel', (e) => {
        if (this.mode !== 'magic') return;
        e.preventDefault();
        this.setZoom(this.camera.fov + e.deltaY * 0.05);
      }, { passive: false });
      let pinch0 = null;
      c.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          pinch0 = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), fov: this.camera.fov };
        }
      }, { passive: true });
      c.addEventListener('touchmove', (e) => {
        if (pinch0 && e.touches.length === 2 && this.mode === 'magic') {
          const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
          this.setZoom(pinch0.fov * pinch0.d / d);
          if (down) down.moved = true;
        }
      }, { passive: true });
      c.addEventListener('touchend', () => { pinch0 = null; }, { passive: true });

      this._gpPrev = [];
    }

    _pollGamepads() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of pads) {
        if (!gp) continue;
        const prev = this._gpPrev[gp.index] || [];
        gp.buttons.forEach((b, i) => {
          if (b.pressed && !prev[i]) {
            if (i === 0) this.tap();
            else if (i === 1) this.togglePlay();
            else if (i === 14) this.seekBy(-10);
            else if (i === 15) this.seekBy(10);
          }
        });
        this._gpPrev[gp.index] = gp.buttons.map(b => b.pressed);
      }
    }

    // ---------------- playback helpers ----------------
    get video() { return this.source instanceof HTMLVideoElement ? this.source : null; }
    togglePlay() {
      const v = this.video; if (!v) return;
      if (v.paused) v.play().catch(() => {}); else v.pause();
      this._drawPanel(true);
    }
    seekBy(dt) {
      const v = this.video; if (!v || !v.duration) return;
      v.currentTime = THREE.MathUtils.clamp(v.currentTime + dt, 0, v.duration - 0.1);
      this._drawPanel(true);
    }

    // ---------------- HUD (subtitles, gaze panel, reticle) ----------------
    _buildHud() {
      this.hudRoot = new THREE.Group();
      this.hudRoot.visible = false;
      this.scene.add(this.hudRoot);
      this.hudTarget = new THREE.Quaternion();

      // subtitles
      this.subCanvas = document.createElement('canvas');
      this.subCanvas.width = 2048; this.subCanvas.height = 512;
      this.subTex = new THREE.CanvasTexture(this.subCanvas);
      this.subTex.minFilter = THREE.LinearFilter; this.subTex.generateMipmaps = false;
      this.subMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.25),
        new THREE.MeshBasicMaterial({ map: this.subTex, transparent: true, depthTest: false, depthWrite: false }));
      this.subMesh.renderOrder = 10;
      this.hudRoot.add(this.subMesh);

      // control panel
      this.panelCanvas = document.createElement('canvas');
      this.panelCanvas.width = PANEL_W; this.panelCanvas.height = PANEL_H;
      this.panelTex = new THREE.CanvasTexture(this.panelCanvas);
      this.panelTex.minFilter = THREE.LinearFilter; this.panelTex.generateMipmaps = false;
      this.panelRoot = new THREE.Group();
      this.panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_M, PANEL_M * PANEL_H / PANEL_W),
        new THREE.MeshBasicMaterial({ map: this.panelTex, transparent: true, depthTest: false, depthWrite: false }));
      this.panelMesh.position.z = -PANEL_DIST;
      this.panelMesh.renderOrder = 20;
      this.panelRoot.add(this.panelMesh);
      this.panelRoot.visible = false;
      this.scene.add(this.panelRoot);

      // reticle
      const ret = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.02, 24),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }));
      ret.renderOrder = 30;
      ret.visible = false;
      this.reticle = ret;
      this.scene.add(ret);

      this.raycaster = new THREE.Raycaster();
      this.raycaster.layers.enableAll();
      this.hover = null;
      this.buttons = [
        { id: 'back',   label: '-10s' },
        { id: 'play',   label: 'Play' },
        { id: 'fwd',    label: '+10s' },
        { id: 'subs',   label: 'Subtitles' },
        { id: 'center', label: 'Recenter' },
        { id: 'exit',   label: 'Exit' },
      ];
      const bw = 150, gap = (PANEL_W - 60 - bw * 6) / 5;
      this.buttons.forEach((b, i) => { b.x = 30 + i * (bw + gap); b.y = 175; b.w = bw; b.h = 135; });
      this.seekBar = { x: 40, y: 118, w: PANEL_W - 80, h: 16, hitY0: 92, hitY1: 160 };
    }

    _layoutSubtitle() {
      const s = this.settings;
      const dist = s.subDist || 2.5;
      const w = dist * 0.8 * (s.subSize || 1);
      this.subMesh.scale.set(w, w, 1);
      const a = (s.subAngle ?? 14) * DEG;
      this.subMesh.position.set(0, -Math.tan(a) * dist, -dist);
      this.subMesh.rotation.set(a, 0, 0);
    }

    _updateSubtitle() {
      const v = this.video;
      const t = v ? v.currentTime - (this.settings.subOffset || 0) : 0;
      const text = this.subsOn ? Subs.textAt(this.cues, t) : '';
      if (text === this.subText) return;
      this.subText = text;
      if (this.cb.onSubtitle) this.cb.onSubtitle(text);

      const c = this.subCanvas, ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      if (text) {
        ctx.font = '600 104px system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';
        const lines = [];
        for (const para of text.split('\n')) {
          let line = '';
          for (const word of para.split(/\s+/)) {
            const test = line ? line + ' ' + word : word;
            if (ctx.measureText(test).width > c.width - 140 && line) { lines.push(line); line = word; } else line = test;
          }
          if (line) lines.push(line);
        }
        const shown = lines.slice(-3);
        const lh = 124, total = shown.length * lh;
        const y0 = (c.height - total) / 2;
        const maxW = Math.max(...shown.map(l => ctx.measureText(l).width));
        if ((this.settings.subBg ?? 0.45) > 0) {
          ctx.fillStyle = `rgba(0,0,0,${this.settings.subBg ?? 0.45})`;
          roundRect(ctx, (c.width - maxW) / 2 - 36, y0 - 14, maxW + 72, total + 28, 28);
          ctx.fill();
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round'; ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.fillStyle = '#fff';
        shown.forEach((l, i) => {
          const y = y0 + lh * i + lh / 2;
          ctx.strokeText(l, c.width / 2, y);
          ctx.fillText(l, c.width / 2, y);
        });
      }
      this.subTex.needsUpdate = true;
    }

    _showPanel() {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this._headWorldQuat());
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)), -50 * DEG, 40 * DEG) - 10 * DEG;
      this.panelRoot.position.copy(this._headPos());
      this.panelRoot.rotation.set(pitch, yaw, 0, 'YXZ');
      this.panelRoot.visible = true;
      this.panelRoot.updateMatrixWorld(true);
      this.reticle.visible = true;
      this.subMesh.visible = false;
      this._panelShownAt = performance.now();
      this._drawPanel(true);
    }
    _hidePanel() {
      this.panelRoot.visible = false;
      this.reticle.visible = false;
      this.subMesh.visible = true;
      this.hover = null;
    }

    tap() {
      if (!this.panelRoot.visible) { this._showPanel(); return; }
      const h = this.hover;
      this._panelShownAt = performance.now();
      if (!h) { this._hidePanel(); return; }
      const v = this.video;
      if (h.type === 'seek' && v && v.duration) v.currentTime = h.frac * v.duration;
      else if (h.id === 'play') this.togglePlay();
      else if (h.id === 'back') this.seekBy(-10);
      else if (h.id === 'fwd') this.seekBy(10);
      else if (h.id === 'subs') { this.subsOn = !this.subsOn; this.subText = null; }
      else if (h.id === 'center') { this.recenter(); this._hidePanel(); return; }
      else if (h.id === 'exit') { this._hidePanel(); if (this.cb.onExit) this.cb.onExit(); return; }
      this._drawPanel(true);
    }

    _updateGaze() {
      if (!this.panelRoot.visible) return;
      const q = this._headWorldQuat(), p = this._headPos();
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      this.reticle.position.copy(p).addScaledVector(dir, PANEL_DIST - 0.05);
      this.reticle.quaternion.copy(q);

      this.raycaster.set(p, dir);
      const hit = this.raycaster.intersectObject(this.panelMesh, false)[0];
      let hover = null;
      if (hit && hit.uv) {
        const x = hit.uv.x * PANEL_W, y = (1 - hit.uv.y) * PANEL_H;
        const sb = this.seekBar;
        if (y >= sb.hitY0 && y <= sb.hitY1 && x >= sb.x - 10 && x <= sb.x + sb.w + 10) {
          hover = { type: 'seek', frac: THREE.MathUtils.clamp((x - sb.x) / sb.w, 0, 1) };
        } else {
          const b = this.buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
          if (b) hover = { type: 'btn', id: b.id };
        }
        this._panelShownAt = performance.now();
      }
      const key = hover ? (hover.type === 'seek' ? 'seek' + Math.round(hover.frac * 200) : hover.id) : '';
      if (key !== this._hoverKey) { this._hoverKey = key; this.hover = hover; this._drawPanel(true); }
      this.hover = hover;
      this.reticle.material.color.setHex(hover ? 0xff6b6b : 0xffffff);

      const v = this.video;
      if (v && !v.paused && performance.now() - this._panelShownAt > 5000) this._hidePanel();
    }

    _drawPanel(force) {
      const v = this.video;
      const sec = v ? Math.floor(v.currentTime) : 0;
      if (!force && sec === this._panelSec) return;
      this._panelSec = sec;
      const c = this.panelCanvas, ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = 'rgba(18,18,22,0.88)';
      roundRect(ctx, 4, 4, c.width - 8, c.height - 8, 36); ctx.fill();

      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      ctx.font = '600 34px system-ui, -apple-system, Roboto, sans-serif';
      let title = this.title || '';
      while (title.length > 4 && ctx.measureText(title).width > 640) title = title.slice(0, -2);
      if (title !== this.title) title += '…';
      ctx.textAlign = 'left'; ctx.fillText(title, 40, 56);
      ctx.textAlign = 'right'; ctx.fillStyle = '#bbb'; ctx.font = '500 30px system-ui, Roboto, sans-serif';
      ctx.fillText(v ? `${fmtTime(v.currentTime)} / ${fmtTime(v.duration)}` : '', c.width - 40, 56);

      // seek bar
      const sb = this.seekBar, frac = v && v.duration ? v.currentTime / v.duration : 0;
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; roundRect(ctx, sb.x, sb.y, sb.w, sb.h, 8); ctx.fill();
      ctx.fillStyle = '#ff6b6b'; roundRect(ctx, sb.x, sb.y, Math.max(sb.h, sb.w * frac), sb.h, 8); ctx.fill();
      if (this.hover && this.hover.type === 'seek') {
        const hx = sb.x + sb.w * this.hover.frac;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, sb.y + sb.h / 2, 16, 0, Math.PI * 2); ctx.fill();
        ctx.textAlign = 'center'; ctx.font = '600 26px system-ui, Roboto, sans-serif';
        ctx.fillText(fmtTime(this.hover.frac * (v ? v.duration : 0)), hx, sb.y - 22);
      }

      // buttons
      for (const b of this.buttons) {
        const hot = this.hover && this.hover.id === b.id;
        ctx.fillStyle = hot ? '#ff6b6b' : 'rgba(255,255,255,0.08)';
        roundRect(ctx, b.x, b.y, b.w, b.h, 24); ctx.fill();
        const ink = hot ? '#1b0505' : '#fff';
        ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const cx = b.x + b.w / 2, cy = b.y + 52;
        this._icon(ctx, b.id, cx, cy);
        ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.font = '600 28px system-ui, Roboto, sans-serif';
        let label = b.label;
        if (b.id === 'play') label = v && !v.paused ? 'Pause' : 'Play';
        if (b.id === 'subs') label = this.subsOn ? 'Subs on' : 'Subs off';
        ctx.fillText(label, cx, b.y + b.h - 26);
      }
      this.panelTex.needsUpdate = true;
    }

    _icon(ctx, id, x, y) {
      const v = this.video;
      ctx.beginPath();
      if (id === 'play') {
        if (v && !v.paused) { ctx.fillRect(x - 18, y - 22, 12, 44); ctx.fillRect(x + 6, y - 22, 12, 44); return; }
        ctx.moveTo(x - 14, y - 24); ctx.lineTo(x + 22, y); ctx.lineTo(x - 14, y + 24); ctx.closePath(); ctx.fill();
      } else if (id === 'back' || id === 'fwd') {
        const s = id === 'back' ? -1 : 1;
        for (const o of [-10, 10]) {
          ctx.moveTo(x + o - s * 12, y - 18); ctx.lineTo(x + o + s * 12, y); ctx.lineTo(x + o - s * 12, y + 18);
        }
        ctx.closePath(); ctx.fill();
      } else if (id === 'subs') {
        ctx.lineWidth = 5; roundRect(ctx, x - 30, y - 22, 60, 44, 8); ctx.stroke();
        ctx.font = '700 22px system-ui, Roboto, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('CC', x, y + 1);
        if (!this.subsOn) { ctx.beginPath(); ctx.moveTo(x - 34, y + 26); ctx.lineTo(x + 34, y - 26); ctx.stroke(); }
      } else if (id === 'center') {
        ctx.lineWidth = 6; ctx.arc(x, y, 20, 0.3, Math.PI * 1.75); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      } else if (id === 'exit') {
        ctx.moveTo(x - 18, y - 18); ctx.lineTo(x + 18, y + 18); ctx.moveTo(x + 18, y - 18); ctx.lineTo(x - 18, y + 18); ctx.stroke();
      }
    }

    // ---------------- head pose ----------------
    _headWorldQuat() {
      if (this.mode === 'xr') return this.camera.getWorldQuaternion(new THREE.Quaternion());
      return this.headQuat;
    }
    _headPos() {
      if (this.mode === 'xr') return this.camera.getWorldPosition(new THREE.Vector3());
      return new THREE.Vector3();
    }
    _headYaw() {
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this._headWorldQuat());
      return Math.atan2(-f.x, -f.z);
    }

    _updateHead() {
      const drag = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.dragPitch, this.dragYaw, 0, 'YXZ'));
      if (this.gyroActive && this.gyroWanted) {
        const yawOnly = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.dragYaw);
        this.headQuat.copy(yawOnly).multiply(this.sensorQuat);
      } else {
        this.headQuat.copy(drag);
      }
      this.camera.position.set(0, 0, 0);
      this.camera.quaternion.copy(this.headQuat);
    }

    _updateHudFollow() {
      // subtitles lazily follow where you look (yaw + pitch, never roll)
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this._headWorldQuat());
      const yaw = Math.atan2(-f.x, -f.z);
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)), -60 * DEG, 60 * DEG);
      this.hudTarget.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
      const ang = this.hudRoot.quaternion.angleTo(this.hudTarget);
      if (this._hudSnap) { this.hudRoot.quaternion.copy(this.hudTarget); this._hudSnap = false; this._hudMoving = false; }
      else if (ang > 18 * DEG) this._hudMoving = true;
      if (this._hudMoving) {
        this.hudRoot.quaternion.slerp(this.hudTarget, 0.08);
        if (ang < 1 * DEG) this._hudMoving = false;
      }
      this.hudRoot.position.copy(this._headPos());
    }

    // ---------------- cardboard optics ----------------
    _buildDistortion() {
      const mk = () => new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT, fragmentShader: DISTORT_FRAG, depthTest: false, depthWrite: false,
        uniforms: {
          tex: { value: null }, eyeSize: { value: new THREE.Vector2(0.07, 0.065) }, lensCenter: { value: new THREE.Vector2() },
          screenLens: { value: 0.04 }, k1: { value: 0.3 }, k2: { value: 0.2 }, tanMax: { value: 1.2 },
        },
      });
      this.distMatL = mk(); this.distMatR = mk();
      this.distQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.distMatL);
      this.distQuad.frustumCulled = false;
      this.distScene = new THREE.Scene();
      this.distScene.add(this.distQuad);
      this.distCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.rtL = new THREE.WebGLRenderTarget(1024, 1024, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
      this.rtR = this.rtL.clone();
    }

    _computeLens() {
      const o = this.optics;
      if (!o || !this.distMatL) return;
      const cw = this.canvas.clientWidth || window.innerWidth, ch = this.canvas.clientHeight || window.innerHeight;
      const longPx = Math.max(screen.width, screen.height), shortPx = Math.min(screen.width, screen.height);
      const aspect = longPx / shortPx;
      const longM = (this.phoneDiag || 6.3) * 0.0254 * aspect / Math.hypot(aspect, 1);
      const mPerPx = longM / longPx;
      const eyeW = cw / 2 * mPerPx, eyeH = ch * mPerPx;
      const ipd = o.ipd / 1000, sl = o.screenLens / 1000, vOff = (o.vOffset || 0) / 1000;
      const lensY = o.headset.align === 'bottom'
        ? ((o.headset.trayToLens || 35) - 4) / 1000 + vOff
        : eyeH / 2 + vOff;
      const tanMax = Math.tan(THREE.MathUtils.clamp(o.fov, 20, 80) * DEG);
      const k = o.distortion ?? 1;
      for (const [mat, lx] of [[this.distMatL, eyeW - ipd / 2], [this.distMatR, ipd / 2]]) {
        const u = mat.uniforms;
        u.eyeSize.value.set(eyeW, eyeH);
        u.lensCenter.value.set(lx, lensY);
        u.screenLens.value = sl;
        u.k1.value = o.headset.k1 * k;
        u.k2.value = o.headset.k2 * k;
        u.tanMax.value = tanMax;
      }
      const fovDeg = 2 * Math.atan(tanMax) / DEG;
      for (const cam of [this.camL, this.camR]) { cam.fov = fovDeg; cam.aspect = 1; cam.updateProjectionMatrix(); }
      this.eyeOffset = ipd / 2;
    }

    _resize() {
      const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
      if (this.renderer.xr.isPresenting) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      const dpr = this.renderer.getPixelRatio();
      const size = THREE.MathUtils.clamp(Math.round(h * dpr * 1.4 / 256) * 256, 512,
        Math.min(2048, this.renderer.capabilities.maxTextureSize));
      if (this.rtL.width !== size) { this.rtL.setSize(size, size); this.rtR.setSize(size, size); }
      this._computeLens();
    }

    _renderCardboard() {
      const r = this.renderer;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.headQuat);
      const e = this.eyeOffset || 0.032;
      this.camL.position.copy(right).multiplyScalar(-e); this.camL.quaternion.copy(this.headQuat);
      this.camR.position.copy(right).multiplyScalar(e);  this.camR.quaternion.copy(this.headQuat);
      this.camL.updateMatrixWorld(); this.camR.updateMatrixWorld();

      r.setRenderTarget(this.rtL); r.clear(); r.render(this.scene, this.camL);
      r.setRenderTarget(this.rtR); r.clear(); r.render(this.scene, this.camR);
      r.setRenderTarget(null);

      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      r.setScissorTest(true);
      this.distMatL.uniforms.tex.value = this.rtL.texture;
      this.distMatR.uniforms.tex.value = this.rtR.texture;
      for (const [x, mat] of [[0, this.distMatL], [w / 2, this.distMatR]]) {
        r.setViewport(x, 0, w / 2, h); r.setScissor(x, 0, w / 2, h);
        this.distQuad.material = mat;
        r.clear();
        r.render(this.distScene, this.distCam);
      }
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
    }

    // ---------------- main loop ----------------
    _frame() {
      if (!this.texture) return;
      this._pollGamepads();
      this._updateSubtitle();
      if (this.panelRoot.visible) this._drawPanel(false);

      if (this.mode === 'xr' && this.renderer.xr.isPresenting) {
        this._updateHudFollow();
        this._updateGaze();
        this.renderer.render(this.scene, this.camera);
        return;
      }
      this._updateHead();
      if (this.mode === 'cardboard') {
        this._updateHudFollow();
        this._updateGaze();
        this._renderCardboard();
      } else {
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);
      }
    }

    dispose() {
      this.renderer.setAnimationLoop(null);
      this.disableGyro();
      clearTimeout(this._gyroCheck);
      window.removeEventListener('resize', this._onResize);
      const s = this.renderer.xr.getSession && this.renderer.xr.getSession();
      if (s) s.end().catch(() => {});
      for (const m of this.meshes || []) m.geometry.dispose();
      [this.texture, this.subTex, this.panelTex, this.rtL, this.rtR].forEach(x => x && x.dispose());
      this.renderer.dispose();
    }
  }

  Player.fmtTime = fmtTime;
  return Player;
})();
