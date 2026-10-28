// تشغيل Edge للاختبارات: من Edge 156 chromium.launch مابقاش بيقوم (الـ headless القديم اتشال)،
// فبنشغّله إحنا بـ --headless=new ونوصل له بـ CDP. browser.close() بيقفل العملية كمان.
//   const browser = await launchEdge();                       // بروفايل مؤقت جديد
//   const browser = await launchEdge({ userDataDir: dir });   // بروفايل ثابت (زي launchPersistentContext) ← browser.contexts()[0]
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

export async function launchEdge({ userDataDir, args = [] } = {}) {
  const port = await freePort();
  const dir = userDataDir ?? mkdtempSync(join(tmpdir(), 'e2e-edge-'));
  const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--lang=ar-EG', ...args, 'about:blank'], { stdio: 'ignore' });
  let browser = null;
  for (let i = 0; !browser && i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
  }
  if (!browser) { proc.kill(); throw new Error('Edge ما اشتغلش'); }
  const close = browser.close.bind(browser);
  // القفل بـ CDP (Browser.close) بيقفل Edge كله؛ وبعده taskkill للشجرة كلها — عشان البروفايل يتفك قبل ما حد يفتحه تاني
  browser.close = async () => {
    const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((r) => proc.once('exit', r));
    await browser.newBrowserCDPSession().then((s) => s.send('Browser.close')).catch(() => {});
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    await close().catch(() => {});
    if (proc.exitCode === null) spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 500));
  };
  return browser;
}
