// Local server so your phone can open LocalVR over Wi-Fi.
//   node server.js            → http://<pc-ip>:8080
//   node server.js --https    → https://<pc-ip>:8443 (self-signed; needed for head tracking on some browsers)
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const useHttps = process.argv.includes('--https');
const port = Number((process.argv.find(a => /^--port=/.test(a)) || '').split('=')[1]) || (useHttps ? 8443 : 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8',
};

function handler(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT + path.sep) || /[\\/](certs|node_modules|\.git)([\\/]|$)/.test(file)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function lanIPs() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

function ensureCert() {
  const dir = path.join(ROOT, 'certs');
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  if (fs.existsSync(key) && fs.existsSync(cert)) return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  fs.mkdirSync(dir, { recursive: true });
  const candidates = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanIPs().map(ip => 'IP:' + ip)].join(',');
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825', '-keyout', key, '-out', cert,
        '-subj', '/CN=LocalVR', '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
      return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
    } catch (e) { /* try next */ }
  }
  console.error('Could not create an HTTPS certificate (openssl not found). Install Git for Windows or run without --https.');
  process.exit(1);
}

const server = useHttps ? https.createServer(ensureCert(), handler) : http.createServer(handler);
server.listen(port, '0.0.0.0', () => {
  const scheme = useHttps ? 'https' : 'http';
  console.log(`\n  LocalVR is running.\n`);
  console.log(`  On this PC:     ${scheme}://localhost:${port}`);
  for (const ip of lanIPs()) console.log(`  On your phone:  ${scheme}://${ip}:${port}`);
  console.log(`\n  Phone and PC must be on the same Wi-Fi. Press Ctrl+C to stop.`);
  if (useHttps) console.log(`  The phone will warn about the certificate: tap Advanced → Proceed / Accept the risk.\n`);
  else console.log(`  Head tracking needs HTTPS on phones — use "node server.js --https" or deploy (see README).\n`);
});
