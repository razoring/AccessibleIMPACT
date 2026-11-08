#!/usr/bin/env node
/*!
 * tools/dump-server.mjs — local receiver for console block catalog extractor
 *
 * Runs a local HTTP server that tools/console-extract-blocks.js can POST to,
 * dumping 100% faithful SVGs directly into catalog/ on disk with zero clicks.
 *
 * Usage:
 *   node tools/dump-server.mjs [port]
 * Default port: 4567
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const CATALOG_DIR = path.join(root, 'catalog');
const CATALOG_JSON = path.join(CATALOG_DIR, 'catalog.json');
const PORT = parseInt(process.argv[2], 10) || 4567;

if (!fs.existsSync(CATALOG_DIR)) {
  fs.mkdirSync(CATALOG_DIR, { recursive: true });
}

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ running: true, port: PORT, catalogDir: CATALOG_DIR }));
    return;
  }

  if (req.method === 'POST' && req.url === '/dump') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = JSON.parse(raw);
        if (typeof data === 'string') data = JSON.parse(data);

        const blocks = data.blocks || {};
        const blockList = Object.values(blocks);
        console.log(`[dump-server] Received ${blockList.length} blocks from console extractor`);

        let existing = {};
        if (fs.existsSync(CATALOG_JSON)) {
          try { existing = JSON.parse(fs.readFileSync(CATALOG_JSON, 'utf8')); } catch (e) {}
        }
        const merged = { ...existing };
        let written = 0;

        for (const b of blockList) {
          const key = b.key;
          if (!key || !b.svg) continue;
          const file = key + '.svg';
          fs.writeFileSync(path.join(CATALOG_DIR, file), b.svg, 'utf8');
          written++;

          merged[key] = {
            type: b.type,
            file,
            width: b.width,
            height: b.height,
            category: b.category,
            isMultiLine: !!b.isMultiLine,
            fields: (b.fields || []).map(f => ({ name: f.name, kind: f.kind, text: f.text })),
            inputs: b.inputs || []
          };
        }

        fs.writeFileSync(CATALOG_JSON, JSON.stringify(merged, null, 2) + '\n', 'utf8');
        console.log(`[dump-server] Successfully wrote ${written} SVGs into ${CATALOG_DIR} and updated catalog.json`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, written, totalInCatalog: Object.keys(merged).length }));
      } catch (err) {
        console.error('[dump-server] Error writing dump:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: String(err && err.message || err) }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[AIFX dump-server] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[AIFX dump-server] Target directory: ${CATALOG_DIR}`);
  console.log(`[AIFX dump-server] Ready to receive dumps from tools/console-extract-blocks.js`);
});

