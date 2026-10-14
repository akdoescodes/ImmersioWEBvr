# LocalVR

Watch your own 180° / 360° / 3D videos on your phone in a VR headset (Cardboard, IRUSU, VR Box…), with your own subtitles. It runs completely offline once installed, and your files never leave your phone.

It's like watchvr.online and AstalaVR, plus:

- **Real headset optics.** Lens distortion, lens spacing and screen size are matched to your phone and headset. There's a profile for the **IRUSU Play VR Ultra** and 20+ others, plus fine-tuning sliders and a calibration test pattern.
- **Your own subtitles.** Load `.srt`, `.vtt` or `.ass` files. In VR they float in front of you and gently follow your gaze. Size, distance, height, background and sync delay are all adjustable.
- **In-VR menu.** Press the headset's touch button to open it, look at a button, and press again. It has play/pause, ±10 s, seek bar, subtitles on/off, recenter and exit.
- **WebXR.** If your browser supports it (Chrome on Android), a **WebXR** button appears and the browser handles tracking itself.
- **2D mode.** Watch without a headset: drag or move your phone to look around, pinch to zoom. You can also switch format, playback speed, brightness, contrast, saturation and sharpness.
- **Resume.** Each video remembers where you stopped.
- **Formats.** Flat, 180°, 360° and fisheye, in mono, side-by-side (LR) or top-bottom (OU). The format is auto-detected from the file name and resolution.

## Getting it onto your phone

Phones only allow head tracking (gyroscope), offline install and WebXR on **HTTPS** pages. Pick one of these options:

### Option A: Host it free (easiest; offline install works)
Upload this folder to any static host. Your videos are still never uploaded, because only the app is hosted.
- **Netlify Drop:** open https://app.netlify.com/drop and drag the `projecty` folder onto the page. You get an `https://….netlify.app` link. If you've run `start.bat`, delete the `certs` folder first.
- **GitHub Pages:** push the folder to a repo, then go to Settings → Pages → Deploy from branch.

Open the link on your phone, then use the browser menu → **Install app** / **Add to Home screen**. After that it works in airplane mode.

### Option B: Run it from this PC over Wi-Fi
Double-click **`start.bat`** (requires Node.js), or run:
```
node server.js --https
```
It prints a link like `https://192.168.1.6:8443`. Open it on your phone (same Wi-Fi). The phone warns about the certificate because it's self-signed: tap **Advanced → Proceed**, or **Accept the risk** in Firefox. Head tracking works this way. Offline install needs Option A.

`node server.js` without `--https` also works, but phones will block the gyroscope over plain http.

## Watching your 180° video

1. Tap **Open a video** and pick your MP4.
2. Tap **Add subtitles** and pick your `.srt` (optional).
3. Check **Video format**. Most 180° downloads are **180° + Side-by-side**. If you see two pictures side by side in each eye, that's the wrong layout; if the picture looks stretched or curved wrong, that's the wrong projection.
4. Tap the headset card, then choose **Headset → IRUSU Play VR Ultra** and your **Phone** (or *Custom screen size* with your phone's size in inches).
5. Tap **START VR**, turn the phone sideways and put it in the headset.
6. Press the headset button to open the menu, look at a button, and press again.

### First-time calibration (2 minutes)
VR Setup → **Test pattern in VR**:
- **Two red crosses / double image:** change **Lens spacing (IPD)**, and also set the IPD wheel on the headset itself.
- **Image too big or small, or it "swims" when you turn your head:** change **Lens-to-screen distance**.
- **Grid lines bend at the edges:** change **Distortion correction**.
- **Image too high or low in the lenses:** change **Vertical lens offset**.

Settings are saved per headset. Use the IRUSU's focus slider to make the image sharp.

## Controls

| Where | Action |
|---|---|
| In headset | Headset touch button = open menu / press the button you're looking at |
| In headset | Tap away from the menu = close it. It also hides itself after 5 s while playing |
| Bluetooth remote / keyboard | Enter = menu/select, Space = play/pause, ←/→ = ±10 s, ↑/↓ = ±60 s, R = recenter, V = VR/2D |
| 2D mode | Drag = look, pinch = zoom, compass icon = motion look-around, sliders icon = format & picture |
| Anywhere | Phone back button = exit the player |

## Notes

- **Codecs** depend on your phone's browser. H.264 MP4 plays everywhere. HEVC/H.265 works in Chrome on most modern Android phones but **not in Firefox**. If a video won't open, try Chrome.
- **5.7K/8K** VR files may stutter on mid-range phones. 4K (3840×1920) is the sweet spot.
- Subtitles inside MKV files can't be read in a browser. Use a separate `.srt` file (extract it with MKVToolNix if needed).
- Firefox on Android doesn't support WebXR. The normal **Start VR** mode works in every browser.

## Files

```
index.html          app UI (home, VR setup, pickers, player)
css/styles.css      styles
js/app.js           UI logic, format detection, player lifecycle
js/player.js        renderer: cardboard lens distortion, WebXR, 2D, in-VR menu, 3D subtitles
js/profiles.js      headset optics + phone screen sizes
js/subtitles.js     SRT / VTT / ASS parser
js/storage.js       saved settings + resume positions
vendor/three.min.js three.js r160 (bundled for offline use)
sw.js               service worker (offline)
server.js           local http/https server for testing on your phone
```
