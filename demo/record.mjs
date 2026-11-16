// Records the demo shots from the running app with headless Chrome's screencast.
// Usage: node --experimental-websocket demo/record.mjs <outDir> [baseUrl]
// Each shot is saved as JPEG frames plus frames.txt (an ffmpeg concat list with real durations).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
const BASE = process.argv[3] ?? 'http://localhost:5175/';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!OUT) throw new Error('usage: record.mjs <outDir> [baseUrl]');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONNECTING = '#site=connecting-ridge&t=2026-11-14T00%3A00Z&d=708.7';
const MOUTON = '#site=mons-mouton-plateau&t=2026-12-16T00%3A00Z&d=156';
const MOUTON_SLIP = `${MOUTON}|site=mons-mouton-plateau&t=2026-12-19T00%3A00Z&d=156`;

// The scale factor must be real (a Chrome flag), not emulated: emulated scaling makes the screencast send CSS-pixel frames.
async function browser(dpr) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${dpr}`, `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP}/lsn-demo-${port}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const p = t.find((x) => x.type === 'page');
      if (p) ws = new WebSocket(p.webSocketDebuggerUrl);
    } catch {}
    if (!ws) await sleep(200);
  }
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method) for (const l of listeners) l(m);
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
    return r.result?.result?.value;
  };
  return { proc, ws, send, evaluate, listeners };
}

/** A visible click: a ripple where the pointer lands (headless capture shows no cursor), then a real mouse click. */
async function clickAt(b, x, y) {
  await b.evaluate(`(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;border:3px solid #ffffff;background:rgba(255,255,255,0.18);z-index:99999;pointer-events:none;transition:transform 600ms ease-out, opacity 600ms ease-out';
    document.body.appendChild(d);
    requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = 'scale(1.6)'; d.style.opacity = '0'; }));
    setTimeout(() => d.remove(), 800);
  })()`);
  await sleep(120);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await b.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  }
}

async function centreOf(b, selectorJs) {
  return b.evaluate(`(() => { const e = ${selectorJs}; if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
}

const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)})`;

async function waitFor(b, js, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await b.evaluate(`!!(${js})`)) return true;
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${js}`);
}

/** Outline elements the caption is talking about (yellow, like the Sun in the app). */
async function highlight(b, listJs) {
  await b.evaluate(`(() => { for (const e of ${listJs}) { e.style.outline = '3px solid #f5af0c'; e.style.outlineOffset = '4px'; } return true; })()`);
}

const topOf = (js) => `${js}.getBoundingClientRect().top + scrollY - document.querySelector('.topbar').offsetHeight - 8`;

/** Saves the on-screen box the composer zooms into (CSS pixels of the viewport). */
async function saveFocus(b, dir, listJs) {
  const r = await b.evaluate(`(() => { const rs = ${listJs}.map((e) => e.getBoundingClientRect()); const x0 = Math.min(...rs.map((r) => r.left)), y0 = Math.min(...rs.map((r) => r.top)); const x1 = Math.max(...rs.map((r) => r.right)), y1 = Math.max(...rs.map((r) => r.bottom)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; })()`);
  writeFileSync(join(dir, 'focus.json'), JSON.stringify(r));
}

// Three scenes. The horizon scene is 960x540 at 2x (1920x1080 frames); the two zoom scenes are captured
// at 2560x1440 so a slow zoom into them stays sharp in a 1080p video.
const SHOTS = [
  {
    name: 'hook',
    view: [960, 540, 2],
    hash: CONNECTING,
    async setup(b) {
      await b.evaluate(`window.scrollTo(0, ${topOf("document.querySelectorAll('.chart-card')[0]")})`);
    },
    async act(b) {
      await sleep(500);
      await b.evaluate(`${byText('button', 'Play')}.click()`);
      await sleep(7800);
      await b.evaluate(`window.scrollTo({ top: ${topOf("document.querySelectorAll('.chart-card')[1]")}, behavior: 'smooth' })`);
      await sleep(4800);
    },
  },
  {
    name: 'compare',
    view: [1024, 576, 2.5],
    hash: MOUTON_SLIP,
    async setup(b) {
      await waitFor(b, `document.querySelectorAll('.cmp-table td.best').length > 0`);
      await b.evaluate(`window.scrollTo(0, ${topOf("[...document.querySelectorAll('.panel h2')].find((h) => h.textContent === 'What changes').closest('.panel')")})`);
    },
    async act(b, dir) {
      await sleep(1000);
      const cells = "[...document.querySelector('.cmp-table tbody tr').querySelectorAll('td')]";
      await highlight(b, cells);
      await saveFocus(b, dir, `[...[...document.querySelectorAll('.cmp-table thead th')].slice(1), ...${cells}]`);
      await sleep(6800);
    },
  },
  {
    name: 'nearby',
    view: [960, 540, 8 / 3],
    hash: MOUTON,
    async setup(b) {
      // Run the search first, so the scene opens on the answer.
      await b.evaluate(`${byText('button', 'Search nearby')}.click()`);
      await waitFor(b, `document.querySelector('.nearby-finding')`, 30000);
      await sleep(500);
      // Frame the grid alone; the overlay card states the finding.
      await b.evaluate(`window.scrollTo(0, ${topOf("document.querySelector('.nearby canvas')")})`);
    },
    async act(b, dir) {
      await sleep(900);
      // The grid inside the canvas: same geometry as HeatGrid in NearbySearch.tsx.
      const g = await b.evaluate(`(() => { const r = document.querySelector('.nearby canvas').getBoundingClientRect(); const size = Math.min(260 - 28, r.width - 104 - 14); const x0 = Math.max(0, (r.width - size - 14 - 104) / 2); return { x: r.left + x0, y: r.top + 6, w: size + 14 + 104, h: size + 22 }; })()`);
      writeFileSync(join(dir, 'focus.json'), JSON.stringify(g));
      await sleep(6400);
    },
  },
];

const only = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  const dir = join(OUT, shot.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const [w, h, dpr] = shot.view;
  const b = await browser(dpr);
  await b.send('Page.enable');
  await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 0, mobile: false });
  await b.send('Page.navigate', { url: BASE });
  await sleep(1500);
  // Clean shots: hide the example cards, play at normal speed.
  await b.evaluate(`localStorage.setItem('lsn-stories-hidden', '1'); localStorage.setItem('lsn-speed', '1'); true`);
  await b.send('Page.navigate', { url: BASE + shot.hash });
  await sleep(500);
  await b.evaluate('location.reload()').catch(() => {});
  await sleep(3500);
  await b.evaluate('document.fonts.ready.then(() => true)');
  await shot.setup(b);
  await sleep(700);

  const frames = [];
  b.listeners.add((m) => {
    if (m.method !== 'Page.screencastFrame') return;
    const n = frames.length;
    const file = `f${String(n).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(m.params.data, 'base64'));
    frames.push({ file, t: m.params.metadata.timestamp });
    b.send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
  });
  await b.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: Math.round(w * dpr), maxHeight: Math.round(h * dpr), everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  await shot.act(b, dir);
  const t1 = Date.now() / 1000;
  await b.send('Page.stopScreencast');
  await sleep(300);

  // Concat list: each frame lasts until the next one; the last until the end of the take.
  const lines = [];
  const start = frames.length ? frames[0].t : t0;
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(frames[i].t + 0.04, start + (t1 - t0));
    lines.push(`file '${frames[i].file}'`, `duration ${(next - frames[i].t).toFixed(4)}`);
  }
  if (frames.length) lines.push(`file '${frames[frames.length - 1].file}'`);
  writeFileSync(join(dir, 'frames.txt'), lines.join('\n') + '\n');
  console.log(`${shot.name}: ${frames.length} frames over ${(t1 - t0).toFixed(1)} s`);
  b.ws.close();
  b.proc.kill();
  await sleep(300);
}
