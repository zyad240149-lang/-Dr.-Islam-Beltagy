// شيتات كشف الطبيب حسب المنطقة: اللي بيتفتح للطبيب بيتحدد من مكان الألم في شيت التمريض (خانة 5 — خريطة الجسم):
// الركبة/الورك/الفخذ ← «الورك والركبة» (الشيت الأصلي — ExamSheet.tsx، مفاتيح x.*)، الكاحل والقدم والساق ← «الكاحل والقدم»،
// الكتف ← «الكتف»، الرقبة والظهر ← «العمود الفقري»، الكوع والرسغ واليد ← «الكوع والرسغ واليد»، وأي منطقة تانية ← «شيت عام».
// الشيتات دي بنفس ترتيب شيت الورك والركبة (شكوى ← تاريخ مرضي ← علامات خطر ← فحص ← اختبارات ← أشعة ← تشخيص ← خطة) —
// كل شيت ليه بادئة مفاتيح خاصة بيه (ak./sh./sp./hd./gn.) عشان أكتر من منطقة في نفس الكشف ما يتلخبطوش.
import type { ExamSheet, Side } from './data';

export type SheetId = 'hipknee' | 'ankle' | 'shoulder' | 'spine' | 'hand' | 'general';
export type Field =
  | { t: 'checks'; g: string; items: string[]; label?: string; none?: string; cols?: boolean }
  | { t: 'pick'; g: string; items: string[]; label: string }
  | { t: 'text'; k: string; label: string; stack?: boolean }
  | { t: 'side' }
  | { t: 'two'; a: Field[]; b: Field[] }
  | { t: 'rom'; k: string; title: string; rows: [string, string][] }
  | { t: 'grade'; k: string; title: string; rows: [string, string][]; opts: 'mrc' | 'reflex' }
  | { t: 'ticks'; g: string; title: string; rows: [string, string][]; note?: string }
  | { t: 'imaging'; k: string }
  | { t: 'dxmap' }
  | { t: 'notes'; k: string };
export type BoxRole = 'cc' | 'hx' | 'rf' | 'exam' | 'dx' | 'plan' | 'notes';
export interface BoxDef { title: string; role: BoxRole; tone?: 'red'; f: Field[] }
export interface RegionSheetDef { id: Exclude<SheetId, 'hipknee'>; prefix: string; tab: string; title: string; boxes: BoxDef[] }

// ---------- بنود مشتركة (نفس شيت الورك والركبة) ----------
const DUR = ['Acute (< 6 weeks)', 'Subacute (6-12 weeks)', 'Chronic (> 12 weeks)'];
const ONSET = ['Sudden', 'Gradual'];
const COURSE = ['Progressive', 'Recurrent', 'Static', 'Improving'];
const PREV = ['Medication', 'Physiotherapy', 'Injection', 'Surgery'];
const RF = ['History of malignancy', 'Unexplained weight loss', 'Fever / night pain', 'Recent significant trauma', 'Neurovascular deficit', 'Signs of infection (redness, hotness)'];
const PLAN = ['Medication', 'Physiotherapy', 'Activity modification', 'Injection / Intervention', 'Brace / Support', 'Surgery (if indicated)'];
const UPPER_MRC: [string, string][] = [['C5', 'Shoulder abduction'], ['C6', 'Elbow flexion / wrist extension'], ['C7', 'Elbow extension'], ['C8', 'Finger flexion'], ['T1', 'Finger abduction']];
const UPPER_REFLEX: [string, string][] = [['Biceps', 'C5–C6'], ['Brachioradialis', 'C6'], ['Triceps', 'C7']];

const cc = (items: string[]): BoxDef => ({ title: 'Chief Complaint', role: 'cc', f: [{ t: 'two', a: [{ t: 'checks', g: 'cc', items }, { t: 'text', k: 'cc.other', label: 'Other:' }], b: [{ t: 'pick', g: 'dur', items: DUR, label: 'Duration:' }] }] });
const hpi = (mech?: string[], extra: Field[] = []): BoxDef => ({ title: 'History of Present Illness', role: 'hx', f: [
  { t: 'side' }, ...extra, { t: 'pick', g: 'onset', items: ONSET, label: 'Onset:' },
  ...(mech ? [{ t: 'checks', g: 'mech', items: mech, label: 'Mechanism:' } as Field] : []),
  { t: 'pick', g: 'course', items: COURSE, label: 'Course:' },
  { t: 'text', k: 'aggr', label: 'Aggravating factors:', stack: true }, { t: 'text', k: 'reliev', label: 'Relieving factors:', stack: true },
  { t: 'checks', g: 'prev', items: PREV, label: 'Previous treatment:' }, { t: 'text', k: 'prev.other', label: 'Other:' },
] });
const redFlags = (extra: string[] = []): BoxDef => ({ title: '⚠ Red Flags', role: 'rf', tone: 'red', f: [{ t: 'checks', g: 'rf', items: [...RF, ...extra] }, { t: 'text', k: 'rf.other', label: 'Others:' }] });
const listBox = (title: string, g: string, items: string[], role: BoxRole = 'exam', none?: string): BoxDef => ({ title, role, f: [{ t: 'checks', g, items, none, cols: items.length > 8 }, { t: 'text', k: `${g}.other`, label: 'Other:' }] });
const imaging: BoxDef = { title: 'Imaging / Investigations', role: 'exam', f: [{ t: 'imaging', k: 'img' }] };
const dx = (items: string[]): BoxDef => ({ title: 'Diagnosis (Likely / Working)', role: 'dx', f: [{ t: 'checks', g: 'dx', items, cols: true }, { t: 'text', k: 'dx.other', label: 'Others:' }, { t: 'dxmap' }] });
const plan = (extra: string[] = []): BoxDef => ({ title: 'Plan', role: 'plan', f: [{ t: 'checks', g: 'plan', items: [...PLAN, ...extra] }, { t: 'text', k: 'plan.fu', label: 'Follow up after:' }, { t: 'text', k: 'plan.other', label: 'Others:' }] });
const notes: BoxDef = { title: 'Notes', role: 'notes', f: [{ t: 'notes', k: 'notes' }] };

export const REGION_SHEETS: RegionSheetDef[] = [
  {
    id: 'ankle', prefix: 'ak', tab: 'الكاحل والقدم', title: 'ANKLE &amp; FOOT CONSULTATION SHEET',
    boxes: [
      cc(['Ankle pain', 'Heel pain', 'Midfoot pain', 'Forefoot / toe pain', 'Swelling', 'Instability / giving way', 'Stiffness', 'Deformity', 'Numbness / tingling', 'Difficulty walking', 'Follow-up']),
      hpi(['Inversion injury', 'Eversion injury', 'Direct trauma', 'Overuse', 'No trauma']),
      redFlags(['Inability to bear weight (Ottawa rules)', 'Diabetic foot / ulcer']),
      listBox('Inspection', 'insp', ['Normal', 'Swelling', 'Bruising', 'Deformity', 'Flat foot (pes planus)', 'High arch (pes cavus)', 'Hallux valgus', 'Callus / ulcer'], 'exam', 'Normal'),
      listBox('Palpation (Tenderness)', 'palp', ['No tenderness', 'Lateral malleolus', 'Medial malleolus', 'ATFL', 'CFL', 'Deltoid ligament', 'Achilles tendon', 'Plantar fascia / heel', 'Base of 5th metatarsal', 'Navicular', 'Metatarsal heads'], 'exam', 'No tenderness'),
      { title: 'Range of Motion', role: 'exam', f: [{ t: 'rom', k: 'rom', title: 'Ankle / Foot Motion', rows: [['Dorsiflexion', '0–20°'], ['Plantarflexion', '0–50°'], ['Inversion', '0–35°'], ['Eversion', '0–15°'], ['1st MTP extension', '0–70°']] }] },
      { title: 'Neurovascular Examination', role: 'exam', f: [
        { t: 'grade', k: 'mrc', title: 'Motor Power (MRC)', opts: 'mrc', rows: [['L4', 'Ankle dorsiflexion'], ['L5', 'Big toe extension'], ['S1', 'Ankle plantar flexion']] },
        { t: 'grade', k: 'refl', title: 'Reflexes', opts: 'reflex', rows: [['Ankle', 'S1']] },
        { t: 'ticks', g: 'sens', title: 'Reduced sensation', rows: [['Deep peroneal', '1st web space'], ['Superficial peroneal', 'Dorsum of foot'], ['Sural', 'Lateral foot'], ['Saphenous', 'Medial ankle'], ['Tibial', 'Sole of foot']] },
        { t: 'checks', g: 'vasc', items: ['Dorsalis pedis +ve', 'Posterior tibial +ve', 'Capillary refill normal'], label: 'Vascular:' },
      ] },
      listBox('Special Tests (+ve)', 'st', ['Anterior drawer (ankle)', 'Talar tilt', 'Squeeze test', 'External rotation (Kleiger)', 'Thompson test', "Tinel's (tarsal tunnel)", 'Windlass test', "Mulder's click", 'Single heel raise (unable)']),
      imaging,
      dx(['Lateral ankle sprain', 'Ankle fracture', 'High ankle (syndesmosis) sprain', 'Achilles tendinopathy', 'Achilles tendon rupture', 'Plantar fasciitis', 'Ankle osteoarthritis', 'Hallux valgus', "Morton's neuroma", 'Tarsal tunnel syndrome', 'Tibialis posterior dysfunction (flat foot)', 'Gout']),
      plan(['Cast / Walking boot']),
      notes,
    ],
  },
  {
    id: 'shoulder', prefix: 'sh', tab: 'الكتف', title: 'SHOULDER CONSULTATION SHEET',
    boxes: [
      cc(['Shoulder pain', 'Night pain', 'Stiffness', 'Weakness', 'Instability / dislocation', 'Clicking / catching', 'Pain radiating to arm', 'Difficulty with overhead activity', 'Follow-up']),
      hpi(['Fall on outstretched hand', 'Dislocation', 'Lifting / overuse', 'Sports injury', 'No trauma'], [{ t: 'pick', g: 'dom', items: ['Right-handed', 'Left-handed'], label: 'Dominant hand:' }]),
      redFlags(),
      listBox('Inspection', 'insp', ['Normal', 'Muscle wasting', 'Deformity', 'Swelling', 'Scapular winging', 'Step deformity (AC joint)'], 'exam', 'Normal'),
      listBox('Palpation (Tenderness)', 'palp', ['No tenderness', 'AC joint', 'Greater tuberosity', 'Bicipital groove', 'Coracoid', 'SC joint', 'Trapezius', 'Scapular border'], 'exam', 'No tenderness'),
      { title: 'Range of Motion', role: 'exam', f: [
        { t: 'rom', k: 'rom', title: 'Shoulder Motion', rows: [['Flexion', '0–180°'], ['Extension', '0–60°'], ['Abduction', '0–180°'], ['Adduction', '0–45°'], ['Internal rotation', '0–70°'], ['External rotation', '0–90°']] },
        { t: 'checks', g: 'arc', items: ['Painful arc (60–120°)', 'Active < passive ROM', 'Global loss of ROM'] },
      ] },
      { title: 'Neurological Examination', role: 'exam', f: [
        { t: 'grade', k: 'mrc', title: 'Motor Power (MRC)', opts: 'mrc', rows: UPPER_MRC },
        { t: 'grade', k: 'refl', title: 'Reflexes', opts: 'reflex', rows: UPPER_REFLEX },
        { t: 'ticks', g: 'sens', title: 'Reduced sensation', rows: [['Axillary', 'Regimental badge'], ['C5', 'Lateral arm'], ['C6', 'Lateral forearm / thumb']] },
      ] },
      listBox('Special Tests (+ve)', 'st', ['Neer test', 'Hawkins-Kennedy test', 'Empty can (Jobe) test', 'Drop arm test', 'External rotation lag sign', 'Lift-off / belly press', "Speed's test", "O'Brien's test", 'Apprehension test', 'Relocation test', 'Sulcus sign', 'Cross-body adduction']),
      imaging,
      dx(['Rotator cuff tendinopathy', 'Rotator cuff tear', 'Subacromial impingement', 'Frozen shoulder (adhesive capsulitis)', 'Shoulder dislocation / instability', 'SLAP / labral tear', 'AC joint injury / arthritis', 'Glenohumeral osteoarthritis', 'Calcific tendinitis', 'Biceps tendinopathy', 'Proximal humerus fracture', 'Clavicle fracture']),
      plan(['Sling']),
      notes,
    ],
  },
  {
    id: 'spine', prefix: 'sp', tab: 'العمود الفقري', title: 'SPINE CONSULTATION SHEET',
    boxes: [
      cc(['Neck pain', 'Back pain', 'Radiating arm pain', 'Radiating leg pain (sciatica)', 'Numbness / tingling', 'Weakness', 'Stiffness', 'Gait disturbance', 'Follow-up']),
      hpi(['Lifting', 'Fall / trauma', 'Road traffic accident', 'Prolonged sitting / posture', 'No trauma']),
      { title: '⚠ Red Flags', role: 'rf', tone: 'red', f: [{ t: 'checks', g: 'rf', items: ['Bladder / bowel dysfunction', 'Saddle anaesthesia', 'Progressive neurological deficit', 'History of malignancy', 'Unexplained weight loss', 'Fever / night pain', 'Significant trauma', 'New onset age > 50', 'Steroid use / osteoporosis'] }, { t: 'text', k: 'rf.other', label: 'Others:' }] },
      listBox('Inspection / Palpation', 'insp', ['Normal', 'Loss of lordosis', 'Scoliosis', 'Increased kyphosis', 'Paraspinal spasm', 'Cervical midline tenderness', 'Thoracic midline tenderness', 'Lumbar midline tenderness', 'SI joint tenderness'], 'exam', 'Normal'),
      { title: 'Range of Motion', role: 'exam', f: [{ t: 'rom', k: 'rom', title: 'Spine Motion', rows: [['Cervical flexion', '0–50°'], ['Cervical extension', '0–60°'], ['Cervical rotation', '0–80°'], ['Cervical lateral flexion', '0–45°'], ['Lumbar flexion', '0–60°'], ['Lumbar extension', '0–25°'], ['Lumbar lateral flexion', '0–25°']] }] },
      { title: 'Neurological Examination', role: 'exam', f: [
        { t: 'grade', k: 'mrc', title: 'Motor Power (MRC)', opts: 'mrc', rows: [...UPPER_MRC, ['L2', 'Hip flexion'], ['L3', 'Knee extension'], ['L4', 'Ankle dorsiflexion'], ['L5', 'Big toe extension'], ['S1', 'Ankle plantar flexion']] },
        { t: 'grade', k: 'refl', title: 'Reflexes', opts: 'reflex', rows: [...UPPER_REFLEX, ['Knee', 'L3–L4'], ['Ankle', 'S1']] },
        { t: 'ticks', g: 'sens', title: 'Reduced sensation (dermatome)', rows: [['C5', 'Lateral arm'], ['C6', 'Thumb'], ['C7', 'Middle finger'], ['C8', 'Little finger'], ['L3', 'Medial knee'], ['L4', 'Medial leg'], ['L5', 'Dorsum of foot'], ['S1', 'Lateral foot']] },
        { t: 'checks', g: 'umn', items: ['Plantar upgoing (Babinski)', "Hoffmann's sign +ve", 'Clonus'], label: 'Upper motor neuron:' },
      ] },
      listBox('Special Tests (+ve)', 'st', ["Spurling's test", 'Straight leg raise (SLR)', 'Crossed SLR', 'Slump test', 'Femoral nerve stretch', 'FABER (SI joint)', "Lhermitte's sign"]),
      imaging,
      dx(['Cervical spondylosis', 'Cervical radiculopathy', 'Cervical myelopathy', 'Mechanical low back pain', 'Lumbar disc herniation', 'Lumbar canal stenosis', 'Spondylolisthesis', 'Sacroiliac joint dysfunction', 'Vertebral compression fracture', 'Muscle strain']),
      plan(['Cervical collar / lumbar support']),
      notes,
    ],
  },
  {
    id: 'hand', prefix: 'hd', tab: 'الكوع والرسغ واليد', title: 'ELBOW, WRIST &amp; HAND CONSULTATION SHEET',
    boxes: [
      cc(['Elbow pain', 'Wrist pain', 'Hand / finger pain', 'Numbness / tingling', 'Weak grip', 'Swelling', 'Stiffness', 'Triggering / locking', 'Deformity', 'Follow-up']),
      hpi(['Fall on outstretched hand', 'Direct trauma', 'Repetitive use', 'Sports injury', 'No trauma'], [{ t: 'pick', g: 'dom', items: ['Right-handed', 'Left-handed'], label: 'Dominant hand:' }]),
      redFlags(),
      listBox('Inspection', 'insp', ['Normal', 'Swelling', 'Deformity', 'Thenar wasting', 'Hypothenar / interossei wasting', 'Ganglion / mass', 'Nodules'], 'exam', 'Normal'),
      listBox('Palpation (Tenderness)', 'palp', ['No tenderness', 'Lateral epicondyle', 'Medial epicondyle', 'Olecranon', 'Radial head', 'Anatomical snuffbox', 'Distal radius', 'Ulnar side / TFCC', '1st dorsal compartment', 'A1 pulley', 'Thumb CMC joint'], 'exam', 'No tenderness'),
      { title: 'Range of Motion', role: 'exam', f: [{ t: 'rom', k: 'rom', title: 'Elbow / Wrist Motion', rows: [['Elbow flexion', '0–145°'], ['Elbow extension', '0°'], ['Pronation', '0–80°'], ['Supination', '0–80°'], ['Wrist flexion', '0–80°'], ['Wrist extension', '0–70°'], ['Radial deviation', '0–20°'], ['Ulnar deviation', '0–30°']] }] },
      { title: 'Neurological Examination', role: 'exam', f: [
        { t: 'grade', k: 'mrc', title: 'Motor Power (MRC)', opts: 'mrc', rows: UPPER_MRC },
        { t: 'grade', k: 'refl', title: 'Reflexes', opts: 'reflex', rows: UPPER_REFLEX },
        { t: 'ticks', g: 'sens', title: 'Reduced sensation', rows: [['Median', 'Thumb–index–middle'], ['Ulnar', 'Little / ring finger'], ['Radial', 'Dorsal 1st web space']] },
      ] },
      listBox('Special Tests (+ve)', 'st', ["Cozen's test", "Mill's test", "Golfer's elbow test", 'Elbow valgus stress', "Tinel's (carpal tunnel)", "Phalen's test", 'Durkan (carpal compression)', "Tinel's (cubital tunnel)", "Froment's sign", "Finkelstein's test", 'Watson (scaphoid shift)', 'CMC grind test']),
      imaging,
      dx(['Lateral epicondylitis (tennis elbow)', 'Medial epicondylitis', 'Olecranon bursitis', 'Carpal tunnel syndrome', 'Cubital tunnel syndrome', "De Quervain's tenosynovitis", 'Trigger finger', 'Ganglion cyst', 'Distal radius fracture', 'Scaphoid fracture', 'Thumb CMC osteoarthritis', 'TFCC injury']),
      plan(['Splint / cast']),
      notes,
    ],
  },
  {
    id: 'general', prefix: 'gn', tab: 'شيت عام', title: 'ORTHOPEDIC CONSULTATION SHEET',
    boxes: [
      { title: 'Chief Complaint', role: 'cc', f: [{ t: 'text', k: 'cc.other', label: 'Complaint:', stack: true }, { t: 'pick', g: 'dur', items: DUR, label: 'Duration:' }] },
      hpi(),
      redFlags(),
      { title: 'Examination', role: 'exam', f: [
        { t: 'text', k: 'insp', label: 'Inspection:', stack: true }, { t: 'text', k: 'palp', label: 'Palpation:', stack: true },
        { t: 'text', k: 'romtxt', label: 'Range of motion:', stack: true }, { t: 'text', k: 'neuro', label: 'Neurovascular:', stack: true },
        { t: 'text', k: 'sttxt', label: 'Special tests:', stack: true },
      ] },
      imaging,
      { title: 'Diagnosis (Likely / Working)', role: 'dx', f: [{ t: 'text', k: 'dx.other', label: 'Diagnosis:', stack: true }, { t: 'dxmap' }] },
      plan(),
      notes,
    ],
  },
];
export const regionSheet = (id: SheetId) => REGION_SHEETS.find((d) => d.id === id);

// كل شيت بالترتيب اللي بيظهر بيه + اسمه في تبويب الطبيب
export const SHEET_ORDER: SheetId[] = ['hipknee', 'ankle', 'shoulder', 'spine', 'hand', 'general'];
export const SHEET_TAB: Record<SheetId, string> = { hipknee: 'الورك والركبة', ...Object.fromEntries(REGION_SHEETS.map((d) => [d.id, d.tab])) } as Record<SheetId, string>;
const PREFIX: Record<SheetId, string> = { hipknee: 'x', ...Object.fromEntries(REGION_SHEETS.map((d) => [d.id, d.prefix])) } as Record<SheetId, string>;
export const DOCTOR_PREFIXES = Object.values(PREFIX);

// منطقة خريطة الجسم (bodyRegions) ← الشيت بتاعها
const REGION_SHEET: Record<string, SheetId> = {
  hip: 'hipknee', femur: 'hipknee', knee: 'hipknee',
  leg: 'ankle', ankle_foot: 'ankle',
  shoulder: 'shoulder', clavicle: 'shoulder', scapula: 'shoulder', humerus: 'shoulder',
  elbow: 'hand', forearm: 'hand', wrist_hand: 'hand',
  cervical: 'spine', thoracic: 'spine', lumbar: 'spine', sacrum: 'spine',
};

/** فيه حاجة متكتبة في شيت المنطقة دي */
export function sheetFilled(s: ExamSheet, id: SheetId): boolean {
  const p = PREFIX[id] + '.';
  return s.on.some((o) => o.startsWith(p)) || Object.entries(s.txt).some(([k, v]) => k.startsWith(p) && v.trim());
}
/** الشيتات اللي بتظهر للطبيب: من أماكن الألم في شيت التمريض + أي شيت اتكتب فيه + اللي الطبيب ضافه بنفسه («sheets|...») */
export function activeSheets(s: ExamSheet): SheetId[] {
  const set = new Set<SheetId>();
  for (const k of s.pain) set.add(REGION_SHEET[k.split(':')[0]] ?? 'general');
  for (const id of SHEET_ORDER) if (sheetFilled(s, id)) set.add(id);
  for (const o of s.on) if (o.startsWith('sheets|')) set.add(o.slice(7) as SheetId);
  return SHEET_ORDER.filter((id) => set.has(id));
}

// ---------- ملخص نصي لشيت منطقة (الشكوى/التاريخ المرضي/الفحص/التشخيص/الخطة) ----------
const SIDE_EN: Record<Side, string> = { right: 'Right', left: 'Left', both: 'Bilateral', na: '' };
export function regionSummary(def: RegionSheetDef, s: ExamSheet, side: Side) {
  const key = (k: string) => `${def.prefix}.${k}`;
  const has = (g: string, i: string) => s.on.includes(`${key(g)}|${i}`);
  const tx = (k: string) => (s.txt[key(k)] ?? '').trim();
  const join = (xs: (string | false | undefined)[], sep = ', ') => xs.filter(Boolean).join(sep);
  const rtLt = (k: string, unit = '') => join([tx(k + '.rt') && `Rt ${tx(k + '.rt')}${unit}`, tx(k + '.lt') && `Lt ${tx(k + '.lt')}${unit}`], ' / ');
  const field = (f: Field): string => {
    switch (f.t) {
      case 'checks': { const v = join(f.items.filter((i) => has(f.g, i))); return v && (f.label ? `${f.label} ${v}` : v); }
      case 'pick': { const v = f.items.find((i) => has(f.g, i)); return v ? `${f.label} ${v}` : ''; }
      case 'text': return tx(f.k) && `${f.label} ${tx(f.k)}`;
      case 'side': return SIDE_EN[side] && `Side: ${SIDE_EN[side]}`;
      case 'two': return join([...f.a, ...f.b].map(field), ' · ');
      case 'rom': return join(f.rows.map(([m]) => { const v = rtLt(`${f.k}.${m}`, '°'); return v && `${m} ${v}`; }));
      case 'grade': return join(f.rows.map(([r]) => { const v = rtLt(`${f.k}.${r}`, f.opts === 'mrc' ? '/5' : ''); return v && `${r} ${v}`; }));
      case 'ticks': { const v = join(f.rows.flatMap(([r]) => ['Rt', 'Lt'].filter((sd) => has(f.g, `${r} ${sd}`)).map((sd) => `${r} ${sd}`))); return v && `${f.title}: ${v}`; }
      case 'imaging': return join([...['X-ray', 'MRI', 'CT', 'Ultrasound'].filter((m) => has(f.k, m) || tx(`${f.k}.${m}`)).map((m) => join([`${m}:`, tx(`${f.k}.${m}`), tx(`${f.k}.${m}.date`) && `(${tx(`${f.k}.${m}.date`)})`], ' ')), tx(`${f.k}.prev`) && `Previous: ${tx(`${f.k}.prev`)}`, tx(`${f.k}.other`)], '; ');
      case 'notes': return tx(f.k);
      default: return '';
    }
  };
  const boxText = (b: BoxDef) => join(b.f.map(field), ' · ');
  const by = (role: BoxRole) => def.boxes.filter((b) => b.role === role);
  // الشكوى/التشخيص من غير اسم الخانة؛ الباقي «اسم الخانة — المحتوى»
  const ccBox = by('cc')[0];
  const complaint = ccBox ? join(ccBox.f.flatMap((f) => (f.t === 'two' ? [...f.a, ...f.b] : [f])).map((f) => (f.t === 'checks' ? join(f.items.filter((i) => has(f.g, i))) : f.t === 'text' ? tx(f.k) : field(f)))) : '';
  const dxBox = by('dx')[0];
  const diagnosis = dxBox ? join(dxBox.f.map((f) => (f.t === 'checks' ? join(f.items.filter((i) => has(f.g, i))) : f.t === 'text' ? tx(f.k) : ''))) : '';
  const titled = (bs: BoxDef[]) => bs.map((b) => { const t = boxText(b); return t && `${b.title.replace('⚠ ', '')} — ${t}`; }).filter(Boolean) as string[];
  return {
    complaint, diagnosis,
    history: titled([...by('hx'), ...by('rf')]),
    examination: [...titled(by('exam')), ...by('notes').map(boxText).filter(Boolean)],
    plan: join(by('plan').map(boxText)),
  };
}
