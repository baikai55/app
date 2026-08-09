import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
const root = 'H:/聚合/app-hub/public';
const ct = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const f = join(root, p);
  if (!existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': ct[extname(f)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
  res.end(readFileSync(f));
}).listen(8899, () => console.log('http://localhost:8899'));
