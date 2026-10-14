// Subtitle loading: SRT, WebVTT and basic ASS/SSA → [{start, end, text}]
window.Subs = (function () {

  async function readFile(file) {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    // Not valid UTF-8 → probably an old Windows-1252 / Latin-1 file.
    if (text.includes('�')) {
      try { text = new TextDecoder('windows-1252').decode(buf); } catch (e) {}
    }
    return parse(text.replace(/^﻿/, ''), file.name);
  }

  function toSec(h, m, s, frac) {
    return (+h || 0) * 3600 + (+m) * 60 + (+s) + (frac ? +('0.' + frac) : 0);
  }

  function parse(text, name = '') {
    text = text.replace(/\r\n?/g, '\n');
    if (/\.(ass|ssa)$/i.test(name) || /^\[Script Info\]/m.test(text)) return parseAss(text);

    const cues = [];
    const re = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
    let m;
    while ((m = re.exec(text))) {
      const body = m[9].trim();
      if (!body) continue;
      cues.push({
        start: toSec(m[1], m[2], m[3], m[4]),
        end: toSec(m[5], m[6], m[7], m[8]),
        text: clean(body),
      });
    }
    return finish(cues);
  }

  function parseAss(text) {
    const cues = [];
    let fmt = null;
    for (const line of text.split('\n')) {
      if (/^Format:/i.test(line) && !fmt) {
        // only the [Events] Format line has a Text column
        const cols = line.slice(7).split(',').map(s => s.trim().toLowerCase());
        if (cols.includes('text')) fmt = cols;
        continue;
      }
      if (!fmt || !/^Dialogue:/i.test(line)) continue;
      const parts = line.slice(9).split(',');
      const textIdx = fmt.indexOf('text');
      const get = (k) => (parts[fmt.indexOf(k)] || '').trim();
      const t = (s) => { const x = s.match(/(\d+):(\d+):(\d+)[.](\d+)/); return x ? toSec(x[1], x[2], x[3], x[4]) : 0; };
      const body = parts.slice(textIdx).join(',')
        .replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ');
      if (body.trim()) cues.push({ start: t(get('start')), end: t(get('end')), text: body.trim() });
    }
    return finish(cues);
  }

  function clean(s) {
    return s.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
  }

  function finish(cues) {
    return cues.filter(c => c.end > c.start).sort((a, b) => a.start - b.start);
  }

  // All cues active at time t, joined (handles overlapping cues).
  function textAt(cues, t) {
    if (!cues || !cues.length) return '';
    let lo = 0, hi = cues.length - 1, idx = -1;
    while (lo <= hi) {                // last cue with start <= t
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const out = [];
    for (let i = idx; i >= 0 && i > idx - 8; i--) {
      if (cues[i].end >= t) out.unshift(cues[i].text);
    }
    return out.join('\n');
  }

  return { readFile, parse, textAt };
})();
