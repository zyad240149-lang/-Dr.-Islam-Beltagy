// طلبات الأشعة التفصيلية: X-Ray و MRI و CT (ورق الدكتور ٨/١١) — كل ورقة مقسومة: العمود الفقري / الطرف العلوي / الطرف السفلي / فحوصات خاصة
// المفاتيح في شيت الكشف: «<id>.r.<المنطقة>|<الوضع>» للمناطق، «<id>.sp|<الفحص>» للفحوصات الخاصة، «<id>.x<n>|<اختيار>» للتفاصيل الإضافية،
// والنص: «<id>.other» (منطقة أخرى) و«<id>.notes» (ملاحظات طبية). الأسماء بالإنجليزي زي الورقة — وده اللي بيتطبع.
import type { ExamSheet, ImagingKind, ImagingRequest } from './data';

// kind: نوع الأشعة لطلبات المجموعة دي لو مختلف عن الورقة (طب نووي: ديكسا / مسح ذري)؛ other: خانة «Other» للمجموعة
export interface RadGroup { en: string; ar: string; rows?: [string, string[]][]; items?: string[]; kind?: ImagingKind; other?: boolean }
export interface RadForm { id: string; kind: ImagingKind; en: string; ar: string; groups: RadGroup[]; extras: { label: string; items: string[]; one?: boolean }[]; other?: boolean }

const NC = ['Non-Contrast', 'With Contrast'];
const SIDE = { label: 'Side', items: ['Right', 'Left', 'Bilateral'], one: true };

export const RAD_FORMS: RadForm[] = [
  {
    id: 'xr', kind: 'xray', en: 'X-Ray Request', ar: 'طلب أشعة سينية (X-Ray)',
    groups: [
      { en: 'Spine', ar: 'العمود الفقري', rows: [['Cervical Spine', ['AP', 'Lateral', 'Oblique', 'Flexion & Extension']], ['Thoracic Spine', ['AP', 'Lateral']], ['Lumbar Spine', ['AP', 'Lateral', 'Oblique', 'Flexion & Extension']], ['Sacrum & Coccyx', ['AP', 'Lateral']], ['SI Joints', ['AP', 'Oblique']], ['Whole Spine', ['Standing AP', 'Standing Lateral']]] },
      { en: 'Upper Limb', ar: 'الطرف العلوي', rows: [['Shoulder', ['AP', 'Axillary', 'Scapular Y']], ['Clavicle', ['AP', 'AP (Cephalic Tilt)']], ['Humerus', ['AP', 'Lateral']], ['Elbow', ['AP', 'Lateral', 'Oblique']], ['Forearm', ['AP', 'Lateral']], ['Wrist', ['PA (AP)', 'Lateral', 'Oblique']], ['Scaphoid', ['Dedicated Views']], ['Hand', ['PA (AP)', 'Oblique', 'Lateral']], ['Fingers', ['AP', 'Oblique', 'Lateral']]] },
      { en: 'Lower Limb', ar: 'الطرف السفلي', rows: [['Pelvis', ['AP']], ['Hip', ['AP', 'Lateral', 'Frog-leg']], ['Femur', ['AP', 'Lateral']], ['Knee', ['AP', 'Lateral', 'Skyline (Merchant)', 'Tunnel (Rosenberg)']], ['Patella', ['Skyline (Merchant)']], ['Leg (Tibia & Fibula)', ['AP', 'Lateral']], ['Ankle', ['AP', 'Lateral', 'Mortise']], ['Foot', ['AP', 'Oblique', 'Lateral']], ['Calcaneus', ['Axial (Harris)', 'Lateral']], ['Toes', ['AP', 'Oblique', 'Lateral']]] },
      { en: 'Special Orthopaedic Views', ar: 'أشعة خاصة في العظام', items: ['Standing Long-Leg Alignment (Scanogram)', 'Weight-Bearing Knee AP', 'Rosenberg View', 'Bilateral Knee Standing AP', 'Patellar Skyline View (Merchant)', 'Pelvis AP Standing', 'Scoliosis Series', 'Bone Age X-Ray', 'Stress Views of Ankle (If Indicated)', 'Stress Views of Knee (If Indicated)'] },
    ],
    extras: [SIDE, { label: 'Weight Bearing', items: ['Weight Bearing', 'Non Weight Bearing'], one: true }, { label: 'Other', items: ['Comparison View', 'Post-operative Follow-up'] }],
  },
  {
    id: 'mr', kind: 'mri', en: 'MRI Request', ar: 'طلب أشعة رنين مغناطيسي (MRI)', other: true,
    groups: [
      { en: 'Spine', ar: 'العمود الفقري', rows: [['Cervical Spine MRI', NC], ['Thoracic Spine MRI', NC], ['Lumbar Spine MRI', NC], ['Sacrum & Coccyx MRI', NC], ['SI Joints MRI', NC]] },
      { en: 'Upper Limb', ar: 'الطرف العلوي', rows: [['Shoulder MRI', NC], ['Elbow MRI', NC], ['Wrist MRI', NC], ['Hand MRI', NC], ['Digits MRI', NC]] },
      { en: 'Lower Limb', ar: 'الطرف السفلي', rows: [['Hip MRI', NC], ['Knee MRI', NC], ['Ankle MRI', NC], ['Foot MRI', NC]] },
      { en: 'Special MRI Studies', ar: 'فحوصات خاصة', items: ['Whole Spine MRI (Screening)', 'Bone & Soft Tissue Tumor MRI', 'Osteomyelitis MRI', 'Soft Tissue / Muscle MRI', 'Brachial Plexus MRI', 'MR Arthrography (if indicated)', 'Post-operative MRI (Follow-up)'] },
    ],
    extras: [SIDE, { label: 'Study Type', items: ['Arthro-MRI', 'MR Angiography (MRA)', 'MR Neurography'] }, { label: 'Contrast', items: ['Non-Contrast', 'With Contrast', 'As per Radiologist'], one: true }],
  },
  {
    id: 'ct', kind: 'ct', en: 'CT Scan Request', ar: 'طلب أشعة مقطعية (CT)', other: true,
    groups: [
      { en: 'Spine', ar: 'العمود الفقري', rows: [['Cervical Spine CT', NC], ['Thoracic Spine CT', NC], ['Lumbar Spine CT', NC], ['Sacrum & Coccyx CT', NC], ['SI Joints CT', NC]] },
      { en: 'Upper Limb', ar: 'الطرف العلوي', rows: [['Shoulder CT', NC], ['Clavicle CT', NC], ['Humerus CT', NC], ['Elbow CT', NC], ['Forearm CT', NC], ['Wrist CT', NC], ['Hand CT', NC]] },
      { en: 'Lower Limb', ar: 'الطرف السفلي', rows: [['Pelvis CT', NC], ['Hip CT', NC], ['Femur CT', NC], ['Knee CT', NC], ['Leg (Tibia & Fibula) CT', NC], ['Ankle CT', NC], ['Foot CT', NC], ['Calcaneus CT', NC]] },
      { en: 'Special CT Studies', ar: 'فحوصات خاصة', items: ['Complex Fracture Evaluation', 'Bone & Joint CT (3D Reconstruction)', 'Deformity Assessment', 'Bone Tumor Assessment', 'Fracture Union / Non-union', 'Pre-operative Planning (3D)', 'Post-operative Assessment (Implants)'] },
    ],
    extras: [SIDE, { label: 'Study Type', items: ['Routine', 'High Resolution (Bone)', '3D Reconstruction'] }, { label: 'Contrast', items: ['Non-Contrast', 'With IV Contrast'], one: true }],
  },
  {
    id: 'nm', kind: 'dexa', en: 'Nuclear & Bone Density Imaging Request', ar: 'طلب فحوصات الطب النووي وكثافة العظام',
    groups: [
      { en: 'DEXA — Scan Area', ar: 'قياس كثافة العظام (ديكسا) — منطقة الفحص', kind: 'dexa', items: ['Lumbar Spine (L1 – L4)', 'Hip (Right / Left / Bilateral)', 'Forearm (Distal Radius)', 'Whole Study (Lumbar Spine + Both Hips)'] },
      { en: 'DEXA — Indication', ar: 'ديكسا — الهدف من الفحص', kind: 'dexa', other: true, items: ['Diagnosis of Osteoporosis', 'Treatment Follow-up', 'Fracture Risk Assessment', 'Before Long-term Steroid Therapy'] },
      { en: 'Bone Scan (Bone Scintigraphy) — Indication', ar: 'مسح عظمي (مسح ذري للعظام) — الهدف من الفحص', kind: 'xray', other: true, items: ['Suspected Bone Tumor (Primary or Metastasis)', 'Metastatic Work-up', 'Evaluation of Osteomyelitis', 'Assessment of Delayed or Non-union', 'Evaluation of Unexplained Bone Pain', 'Evaluation of Prosthetic Joint Complications (Loosening / Infection)'] },
    ],
    extras: [{ label: 'Patient Status', items: ['Pre-operative', 'Post-operative', 'Follow-up'] }, { label: 'Special Notes', items: ['Suspected Prosthetic Joint Infection', 'History of Malignancy', 'Chronic Steroid Use'] }],
  },
];

const has = (s: ExamSheet, g: string, i: string) => s.on.includes(`${g}|${i}`);
const tx = (s: ExamSheet, k: string) => (s.txt[k] ?? '').trim();

export interface RadPicked { f: RadForm; rows: [string, string[]][]; items: string[]; groups: { g: RadGroup; items: string[]; other: string }[]; other: string; extras: [string, string[]][]; notes: string; count: number }
export const groupOtherKey = (f: RadForm, g: RadGroup) => `${f.id}.o.${g.en}`;
/** اللي اتعلّم في ورقة واحدة */
export function radPicked(s: ExamSheet, f: RadForm): RadPicked {
  const rows = f.groups.flatMap((g) => g.rows ?? []).map(([r, opts]) => [r, opts.filter((o) => has(s, `${f.id}.r.${r}`, o))] as [string, string[]]).filter(([, o]) => o.length);
  const groups = f.groups.filter((g) => g.items).map((g) => ({ g, items: g.items!.filter((i) => has(s, `${f.id}.sp`, i)), other: g.other ? tx(s, groupOtherKey(f, g)) : '' })).filter((x) => x.items.length || x.other);
  const items = groups.flatMap((x) => x.items);
  const other = f.other ? tx(s, `${f.id}.other`) : '';
  const extras = f.extras.map((x, n) => [x.label, x.items.filter((i) => has(s, `${f.id}.x${n}`, i))] as [string, string[]]).filter(([, v]) => v.length);
  return { f, rows, items, groups, other, extras, notes: tx(s, `${f.id}.notes`), count: rows.length + items.length + groups.filter((x) => x.other).length + (other ? 1 : 0) };
}
export const radDetailCount = (s: ExamSheet) => RAD_FORMS.reduce((n, f) => n + radPicked(s, f).count, 0);

/** المناطق/الفحوصات اللي الورق ده بيولّدها — عشان الحفظ يبدّلها من غير ما يلمس الطلبات اللي اتكتبت بإيد */
export const RAD_DETAIL_REGIONS = new Set(RAD_FORMS.flatMap((f) => f.groups.flatMap((g) => [...(g.rows ?? []).map(([r]) => r), ...(g.items ?? [])])));
/** طلبات «Other» الخاصة بالمجموعات بتبدأ باسم المجموعة («DEXA — Indication: …») */
export const RAD_GROUP_PREFIXES = RAD_FORMS.flatMap((f) => f.groups.filter((g) => g.other).map((g) => `${g.en}: `));
export function radDetailRequests(s: ExamSheet): ImagingRequest[] {
  return RAD_FORMS.flatMap((f) => {
    const p = radPicked(s, f);
    const side = p.extras.find(([l]) => l === 'Side')?.[1].join('') ?? '';
    const sfx = side ? ` — ${side}` : '';
    return [
      ...p.rows.map(([r, o]) => ({ kind: f.kind, region: r, view: o.join(', ') + sfx })),
      ...p.groups.flatMap((x) => [...x.items.map((i) => ({ kind: x.g.kind ?? f.kind, region: i, view: side })), ...(x.other ? [{ kind: x.g.kind ?? f.kind, region: `${x.g.en}: ${x.other}`, view: side }] : [])]),
      ...(p.other ? [{ kind: f.kind, region: p.other, view: side }] : []),
    ];
  });
}
