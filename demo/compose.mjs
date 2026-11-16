// Builds demo/demo.mp4 from the recorded scenes: 1920x1080, 30 fps, H.264, under 30 s, no voice.
// On-screen text is large statements and number cards (demo/overlays.html, burned in), the two
// result scenes zoom slowly into the highlighted numbers, and a small "Made with AI assistance"
// mark stays in the corner (2026 Space Apps rule for SI-made video).
// Usage: node demo/compose.mjs <recDir> [liveLink]
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REC = resolve(process.argv[2] ?? '');
const LINK = process.argv[3] ?? '';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = join(HERE, 'demo.mp4');
const FPS = 30;
const XF = 0.4; // cross-fade between scenes, seconds

// Scene, start in the take, length on screen, and an optional slow zoom into the saved focus box:
// zoom factor z, start t0 and duration (s), and where the focus sits vertically (fraction of the frame).
const PLAN = [
  { shot: 'hook', from: 0.2, len: 12.8 },
  // 1.42 puts the left edge between the row labels and the two date columns.
  { shot: 'compare', from: 0.0, len: 7.2, zoom: { z: 1.42, t0: 1.3, dur: 2.2, fy: 0.3 } },
  { shot: 'nearby', from: 0.0, len: 6.2, zoom: { z: 1.25, t0: 1.0, dur: 2.0, fy: 0.29 } },
  { shot: 'end', from: 0, len: 4.8 },
];
const CSS_WIDTH = { compare: 1024, nearby: 960 }; // viewport widths used in record.mjs

const starts = [];
let t = 0;
for (const p of PLAN) {
  starts.push(t);
  t += p.len - XF;
}
const TOTAL = +(t + XF).toFixed(3);
if (TOTAL > 29.9) throw new Error(`video would be ${TOTAL} s`);
const at = (shot) => starts[PLAN.findIndex((p) => p.shot === shot)];

// Statements and number cards (ids in overlays.html), each held long enough to read.
const OVERLAYS = [
  { id: 'title', a: 0.0, b: 3.6 },
  { id: 'ridges', a: 3.9, b: 8.4 },
  { id: 'timeline', a: 8.8, b: at('compare') - 0.1 },
  { id: 'slip', a: at('compare') + 1.6, b: at('nearby') - 0.2 },
  { id: 'move', a: at('nearby') + 0.9, b: at('end') - 0.2 },
];

const chrome = (args) =>
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1920,1080', '--virtual-time-budget=3000', `--user-data-dir=${process.env.TEMP}/lsn-overlay`, ...args], { stdio: 'ignore' });

// Overlays: transparent PNGs rendered with the app's fonts.
for (const o of OVERLAYS) {
  chrome(['--default-background-color=00000000', `--screenshot=${join(REC, `ovl_${o.id}.png`)}`, pathToFileURL(join(HERE, 'overlays.html')).href + `?o=${o.id}`]);
}

// End card: a horizon frame from the first scene, then the HTML card.
const hookFrames = readdirSync(join(REC, 'hook')).filter((n) => n.endsWith('.jpg')).sort();
const still = join(REC, 'hook', hookFrames[Math.floor(hookFrames.length * 0.25)]);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', still, '-vf', 'crop=1800:600:50:285', join(HERE, 'endcard-horizon.png')]);
const endPng = join(REC, 'endcard.png');
chrome([`--screenshot=${endPng}`, pathToFileURL(join(HERE, 'endcard.html')).href + (LINK ? `?link=${encodeURIComponent(LINK)}` : '')]);

// The corner mark, as a one-line subtitle track.
const ts = (s) => `0:${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
writeFileSync(
  join(HERE, 'captions.ass'),
  `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Mark,Segoe UI,24,&H00C8C8C8,&H00C8C8C8,&H50000000,&H00000000,0,0,0,0,100,100,0,0,3,6,0,3,30,30,22,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 1,${ts(0)},${ts(TOTAL)},Mark,,0,0,0,,Made with AI assistance
`,
);

// Inputs: scenes (real timing from the screencast), end card, overlays, silent audio.
const args = ['-hide_banner', '-loglevel', 'error', '-y'];
for (const p of PLAN) {
  if (p.shot === 'end') args.push('-loop', '1', '-framerate', String(FPS), '-t', String(p.len + 0.5), '-i', endPng);
  else {
    const list = join(REC, p.shot, 'frames.txt');
    if (!existsSync(list)) throw new Error(`missing ${list}: run record.mjs first`);
    args.push('-f', 'concat', '-safe', '0', '-i', list);
  }
}
const ovlBase = PLAN.length;
for (const o of OVERLAYS) args.push('-loop', '1', '-framerate', String(FPS), '-t', (o.b - o.a).toFixed(2), '-i', join(REC, `ovl_${o.id}.png`));
const audioIdx = ovlBase + OVERLAYS.length;
args.push('-f', 'lavfi', '-t', String(TOTAL), '-i', 'anullsrc=r=48000:cl=stereo');

const f = [];
PLAN.forEach((p, i) => {
  let chain = `[${i}:v]fps=${FPS},trim=start=${p.from},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=3,trim=duration=${p.len},setpts=PTS-STARTPTS,`;
  if (p.zoom) {
    // Smooth-step zoom from 1 to z, keeping the focus box at fy of the frame height.
    const fb = JSON.parse(readFileSync(join(REC, p.shot, 'focus.json'), 'utf8'));
    const firstFrame = readdirSync(join(REC, p.shot)).find((n) => n.endsWith('.jpg'));
    const width = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width', '-of', 'csv=p=0', join(REC, p.shot, firstFrame)]).toString().trim());
    const scale = width / CSS_WIDTH[p.shot]; // input pixels per CSS pixel
    const cx = (fb.x + fb.w / 2) * scale;
    const cy = (fb.y + fb.h / 2) * scale;
    const { z, t0, dur, fy } = p.zoom;
    chain +=
      `zoompan=z='st(0,clip((on/${FPS}-${t0})/${dur},0,1));1+${(z - 1).toFixed(3)}*ld(0)*ld(0)*(3-2*ld(0))'` +
      `:x='clip(${cx.toFixed(1)}-iw/zoom/2,0,iw-iw/zoom)':y='clip(${cy.toFixed(1)}-ih/zoom*${fy},0,ih-ih/zoom)'` +
      `:d=1:s=1920x1080:fps=${FPS},`;
  } else chain += `scale=1920:1080:flags=lanczos,`;
  chain += `scale=out_range=tv,setsar=1,format=yuv420p[v${i}]`;
  f.push(chain);
});
let prev = 'v0';
for (let i = 1; i < PLAN.length; i++) {
  const out = i === PLAN.length - 1 ? 'vx' : `x${i}`;
  f.push(`[${prev}][v${i}]xfade=transition=fade:duration=${XF}:offset=${starts[i].toFixed(3)}[${out}]`);
  prev = out;
}
let cur = 'vx';
OVERLAYS.forEach((o, k) => {
  const len = o.b - o.a;
  f.push(`[${ovlBase + k}:v]format=rgba,fade=t=in:st=0:d=0.45:alpha=1,fade=t=out:st=${(len - 0.45).toFixed(2)}:d=0.45:alpha=1,setpts=PTS-STARTPTS+${o.a.toFixed(2)}/TB[o${k}]`);
  f.push(`[${cur}][o${k}]overlay=0:0:enable='between(t,${o.a.toFixed(2)},${o.b.toFixed(2)})':eof_action=pass[c${k}]`);
  cur = `c${k}`;
});
f.push(`[${cur}]subtitles=captions.ass:fontsdir=C\\\\:/Windows/Fonts,fade=t=in:st=0:d=0.4,fade=t=out:st=${(TOTAL - 0.5).toFixed(2)}:d=0.5,trim=duration=${TOTAL},format=yuv420p[v]`);
args.push('-filter_complex', f.join(';'), '-map', '[v]', '-map', `${audioIdx}:a`);
args.push('-r', String(FPS), '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-preset', 'slow', '-crf', '18');
args.push('-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart', OUT);
execFileSync('ffmpeg', args, { cwd: HERE, stdio: 'inherit' });
console.log(`${OUT} (${TOTAL} s planned)`);
