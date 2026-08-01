#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// CORRER-PRUEBAS.MJS — banco de pruebas para el agente (sin navegador)
// ════════════════════════════════════════════════════════════════════
//
// Corre /pruebas.html en un Chromium headless y escribe el resultado en la
// consola. Es el equivalente de "npm test" para este repo: se usa ANTES de
// mergear cualquier cambio que toque stock, pedidos, catálogo o `normalize()`.
//
//   node tools/correr-pruebas.mjs           → solo las pruebas automáticas
//   node tools/correr-pruebas.mjs --todo    → agrega conexión y datos locales
//                                             (necesitan internet y sesión;
//                                             en un contenedor van a fallar)
//
// Sale con código 1 si alguna prueba salió en rojo (sirve para CI).
//
// Requisitos: Node 18+ y Playwright con Chromium. En el contenedor de trabajo
// ya está instalado (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers); el script lo
// busca también en los node_modules globales.
//
// Esta carpeta está en .assetsignore: NO se publica con la app.
// ════════════════════════════════════════════════════════════════════

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, normalize as normPath } from 'node:path';

const require = createRequire(import.meta.url);
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function cargarPlaywright() {
  const intentos = ['playwright', 'playwright-core'];
  try { intentos.push(join(execSync('npm root -g').toString().trim(), 'playwright')); } catch {}
  for (const p of intentos) {
    try { return require(p); } catch {}
  }
  console.error('No se encontró Playwright. Instalalo con: npm i -g playwright');
  process.exit(2);
}

const TIPOS = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json', '.webmanifest':'application/manifest+json',
  '.png':'image/png', '.css':'text/css', '.sql':'text/plain; charset=utf-8',
};

function servir() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const rel = normPath(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      const file = join(RAIZ, rel || 'index.html');
      if (!file.startsWith(RAIZ)) { res.writeHead(403).end(); return; }   // sin escapar de la raíz
      const body = await readFile(file);
      const ext = (file.match(/\.[^.]+$/) || [''])[0];
      res.writeHead(200, { 'content-type': TIPOS[ext] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end('no encontrado'); }
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

const BLOQUES = { 1:'Conexión', 2:'Datos y stock', 3:'Pruebas automáticas' };

(async () => {
  const todo = process.argv.includes('--todo');
  const bloques = todo ? [1, 2, 3] : [3];
  const { chromium } = cargarPlaywright();
  const server = await servir();
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push('error de la página: ' + e.message));

  let rojos = 0, verdes = 0, amarillos = 0;
  try {
    await page.goto(`http://127.0.0.1:${port}/pruebas.html`, { waitUntil: 'load' });
    for (const b of bloques) {
      console.log(`\n── ${b}. ${BLOQUES[b]} ──`);
      await page.evaluate(n => runSection(n), b);
      await page.waitForFunction(
        n => document.getElementById('t' + n)?.textContent.startsWith('listo'),
        b, { timeout: 180000 });
      const filas = await page.$$eval(`#s${b} .check`, els => els.map(e => ({
        ico:  e.querySelector('.ico').textContent,
        name: e.querySelector('.cname').textContent,
        det:  e.querySelector('.cdet').textContent,
      })));
      for (const f of filas) {
        if (f.ico === '✅') verdes++;
        else if (f.ico === '⚠️') amarillos++;
        else rojos++;
        const detalle = (f.ico === '✅') ? '' : '\n    ' + f.det.replace(/\n/g, '\n    ');
        console.log(`${f.ico} ${f.name}${detalle}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (errores.length) console.log('\n' + errores.slice(0, 10).join('\n'));
  console.log(`\nResultado: ${verdes} en verde · ${amarillos} a revisar · ${rojos} en rojo`);
  process.exit(rojos ? 1 : 0);
})();
