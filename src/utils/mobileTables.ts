// ٨/١١: على الموبايل الجداول بتتعرض كروت (سطر لكل خانة) من غير سكرول لجنب.
// بيحط data-label على كل خانة من عنوان العمود بتاعها، والـ CSS (index.css «جداول الموبايل») بيعرضه جنب القيمة.
function label(table: HTMLTableElement) {
  const heads = [...table.querySelectorAll(':scope > thead > tr:last-child > th')].map((th) => th.textContent?.trim() ?? '');
  if (!heads.length) return;
  for (const tr of table.querySelectorAll(':scope > tbody > tr')) {
    let col = 0;
    for (const td of (tr as HTMLTableRowElement).cells) {
      const h = heads[col] ?? '';
      if (td.getAttribute('data-label') !== h) td.setAttribute('data-label', h);
      col += td.colSpan || 1;
    }
  }
}
let queued = false;
function run() { queued = false; document.querySelectorAll<HTMLTableElement>('table.table').forEach(label); }
export function initMobileTables() {
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
    .observe(document.body, { childList: true, subtree: true });
}
