// usage: node gen.cjs job.json
// job: { model, prompt, images:[path|url], aspectRatio, imageSize, out, n }
const fs = require('fs'), path = require('path');
const { execSync } = require('child_process');
function key() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try { return execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'GEMINI_API_KEY\',\'User\')"').toString().trim(); } catch (e) { return ''; }
}
const mime = f => /\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg';
async function load(src, dir) {
  if (/^https?:/.test(src)) {
    const r = await fetch(src); if (!r.ok) throw new Error('fetch ' + r.status + ' ' + src);
    const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    return { mime_type: ct, data: Buffer.from(await r.arrayBuffer()).toString('base64') };
  }
  const p = path.resolve(dir, src);
  return { mime_type: mime(p), data: fs.readFileSync(p).toString('base64') };
}
(async () => {
  const jobFile = path.resolve(process.argv[2]); const dir = path.dirname(jobFile);
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  const K = key(); if (!K) { console.error('NO_KEY'); process.exit(2); }
  const model = job.model || 'gemini-3.1-flash-image';
  const parts = [{ text: job.prompt }];
  for (const s of job.images || []) parts.push({ inline_data: await load(s, dir) });
  const body = { contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: job.aspectRatio || '4:5', imageSize: job.imageSize || '2K' } } };
  const n = job.n || 1;
  for (let i = 1; i <= n; i++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': K }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) { console.error('ERR', r.status, JSON.stringify(j).slice(0, 800)); process.exit(1); }
    const out = (j.candidates?.[0]?.content?.parts) || [];
    let saved = 0;
    for (const p of out) {
      const d = p.inlineData || p.inline_data;
      if (d?.data) { const f = path.resolve(dir, job.out.replace(/(\.\w+)$/, n > 1 ? `_${i}$1` : '$1')); fs.writeFileSync(f, Buffer.from(d.data, 'base64')); console.log('SAVED', f); saved++; }
      else if (p.text) console.log('TEXT', p.text.slice(0, 300));
    }
    if (!saved) console.log('NO_IMAGE', JSON.stringify(j).slice(0, 600));
  }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
