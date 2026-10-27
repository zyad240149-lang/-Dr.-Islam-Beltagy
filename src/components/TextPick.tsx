// خانة اختيار (Dropdown جوه نفس المستطيل) بتحفظ في خانة نصية موجودة — من غير تغيير في قاعدة البيانات.
// القيمة المحفوظة = الاختيارات بالكلام مفصولة بـ «، » (+ تفاصيل «أخرى»)؛ والنص القديم اللي مش من القائمة بيتعرض كـ «أخرى».
import { useRef } from 'react';
import { MultiDrop, type MV } from './PhysioObjective';
import type { Opt } from '../data/physioObjective';

const SEP = '، ';
function parse(text: string, options: Opt[]): MV {
  const parts = text.split(/[،,]\s*/).map((x) => x.trim()).filter(Boolean);
  const items: string[] = []; const rest: string[] = [];
  for (const p of parts) { const o = options.find((x) => x.label === p && x.value !== 'other'); if (o) items.push(o.value); else rest.push(p); }
  if (rest.length) items.push('other');
  return { items, other: rest.join(SEP) };
}
const join = (v: MV, options: Opt[]) => v.items.map((i) => (i === 'other' ? (v.other ?? '').trim() : options.find((o) => o.value === i)?.label ?? i)).filter(Boolean).join(SEP);

export function TextPick({ id, label, placeholder, options, value, onChange, single }: {
  id: string; label: string; placeholder: string; options: Opt[]; value: string; onChange: (text: string) => void; single?: boolean;
}) {
  const state = useRef<MV | null>(null);
  // نعيد القراءة من النص لو اتغيّر من برّه (مثلًا فتح خطة محفوظة)
  if (!state.current || join(state.current, options) !== value) state.current = parse(value, options);
  const update = (fn: (p: MV) => MV) => { const next = fn(state.current!); state.current = next; onChange(join(next, options)); };
  return <MultiDrop id={id} label={label} placeholder={placeholder} options={options} value={state.current} onChange={update} single={single} otherLabel="اكتب التفاصيل..." />;
}
