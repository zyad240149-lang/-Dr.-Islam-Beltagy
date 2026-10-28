// لقطات تشخيص لمشكلة تخطيط: حساب مدير مؤقت ← يفتح صفحة على الموقع (أو UI_BASE) بمقاس معيّن قبل وبعد السكرول ← صور في docs/ui-failures.
//   UI_BASE=https://beltagy-ortho.pages.dev node scripts/shot-layout.mjs /diagnosis 1494 1175
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { allDayHours, api, deleteEmployee, loginAdmin, randomPassword, sql } from './_harness.mjs';

const [path = '/diagnosis', w = '1494', h = '1175'] = process.argv.slice(2);
const BASE = (process.env.UI_BASE || 'https://beltagy-ortho.pages.dev').replace(/\/$/, '');
const PW = randomPassword();
const phone = '01200000993';
let empId, browser;
try {
  const admin = await loginAdmin();
  const r = await api(admin, 'POST', 'staff', { name: 'مدير لقطات اختبار', phone, country: 'EG', password: PW, role: 'system_admin', workHours: allDayHours() });
  empId = r.body?.id;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await (await browser.newContext({ viewport: { width: +w, height: +h }, locale: 'ar-EG' })).newPage();
  await page.goto(BASE + '/login');
  await page.fill('#al-phone', phone);
  await page.fill('#al-pass', PW);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => u.pathname === '/', { timeout: 30000 });
  await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
  await page.waitForSelector('.page h1', { timeout: 20000 });
  await page.waitForTimeout(2500);
  const dir = new URL('../docs/ui-failures/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('layout-top.png', dir)) });
  const info = await page.evaluate(() => {
    const tb = document.querySelector('.desktop-topbar');
    const r = tb?.getBoundingClientRect();
    const cs = tb ? getComputedStyle(tb) : null;
    const before = tb ? [...tb.parentElement.children].slice(0, [...tb.parentElement.children].indexOf(tb)).map((e) => `${e.className || e.tagName}:${Math.round(e.getBoundingClientRect().height)}`) : [];
    return { top: r && Math.round(r.top), height: r && Math.round(r.height), position: cs?.position, z: cs?.zIndex, before, scrollEl: document.scrollingElement.scrollHeight };
  });
  console.log('before scroll:', JSON.stringify(info));
  await page.mouse.wheel(0, 150);
  await page.waitForTimeout(800);
  await page.screenshot({ path: fileURLToPath(new URL('layout-scrolled.png', dir)) });
  console.log('after scroll:', JSON.stringify(await page.evaluate(() => { const r = document.querySelector('.desktop-topbar')?.getBoundingClientRect(); return { top: r && Math.round(r.top), scrollY: window.scrollY, mainScroll: document.querySelector('.main')?.scrollTop }; })));
} finally {
  await browser?.close().catch(() => {});
  if (empId) { await sql(`delete from attendance where employee_id = '${empId}';`).catch(() => {}); await deleteEmployee(empId).catch(() => {}); }
}
