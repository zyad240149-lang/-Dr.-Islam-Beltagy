// شيتات كشف الطبيب حسب المنطقة — نفس الورق اللي بعتته العيادة بالظبط (نفس الخانات والترقيم والبنود):
// الورك/الركبة ← «الورك والركبة» (الشيت الأصلي — ExamSheet.tsx، مفاتيح x.*)، الكاحل والقدم ← «Ankle & Foot»،
// الرقبة/الكتف ← «Cervical Spine & Shoulder»، الكوع/الرسغ/اليد ← «Elbow, Wrist & Hand»، أسفل الظهر/العجز ← «Lumbar & Sacral Spine».
// الشيت اللي بيتفتح للطبيب بيتحدد من مكان الألم في الشيت العام (خانة 5 — جسم الإنسان).
// كل شيت ليه بادئة مفاتيح خاصة بيه (af./cs./eh./ls.) عشان أكتر من منطقة في نفس الكشف ما يتلخبطوش.
import type { ExamSheet, Side } from './data';
import { dxSummary, type DxSheetId } from './dxCatalog';

export type SheetId = 'hipknee' | 'ankle' | 'neckshoulder' | 'hand' | 'lumbar' | 'peds' | 'trauma' | 'cast' | 'postop';
type Row3 = [label: string, sub: string, color?: string];
export type Field =
  | { t: 'checks'; g: string; items: string[]; label?: string; none?: string; cols?: boolean }
  | { t: 'pick'; g: string; items: string[]; label: string }
  | { t: 'text'; k: string; label: string; stack?: boolean }
  | { t: 'side' }
  | { t: 'cols'; cols: { title?: string; f: Field[] }[] }
  | { t: 'rom'; k: string; title: string; rows: [string, string][]; noNormal?: boolean }
  | { t: 'grade'; k: string; title: string; rows: [string, string][]; opts: 'mrc' | 'reflex' | 'reflex4' }
  | { t: 'ticks'; g: string; title: string; rows: Row3[]; sub?: string; note?: string }
  | { t: 'key'; title: string; rows: Row3[]; note?: string }
  | { t: 'imaging'; k: string; mods: string[] }
  | { t: 'dxmap' }
  | { t: 'dxsheet'; id: DxSheetId }
  | { t: 'notes'; k: string }
  | { t: 'slot' }; // مكان لحاجة من الشاشة (زي «تحديد موعد متابعة» في الخطة العلاجية)
export type BoxRole = 'cc' | 'hx' | 'rf' | 'exam' | 'dx' | 'plan' | 'notes';
export interface BoxDef { title: string; role: BoxRole; tone?: 'red'; wide?: boolean; f: Field[] }
export interface RegionSheetDef { id: Exclude<SheetId, 'hipknee'> | 'treatment' | 'quick'; prefix: string; tab: string; title: string; boxes: BoxDef[] }

// ---------- بنود مشتركة (نفس شيت الورك والركبة) ----------
const DUR = ['Acute (< 6 weeks)', 'Subacute (6-12 weeks)', 'Chronic (> 12 weeks)'];
const PREV: Field[] = [{ t: 'checks', g: 'prev', items: ['Medication', 'Physiotherapy', 'Injection', 'Surgery'], label: 'Previous treatment:' }, { t: 'text', k: 'prev.other', label: 'Other:' }];
const FACTORS: Field[] = [{ t: 'text', k: 'aggr', label: 'Aggravating factors:', stack: true }, { t: 'text', k: 'reliev', label: 'Relieving factors:', stack: true }];
const hpi: BoxDef = { title: 'History of Present Illness', role: 'hx', f: [
  { t: 'side' }, { t: 'pick', g: 'onset', items: ['Sudden', 'Gradual'], label: 'Onset:' },
  { t: 'pick', g: 'course', items: ['Progressive', 'Recurrent', 'Static', 'Improving'], label: 'Course:' }, ...FACTORS, ...PREV,
] };
const redFlags = (items: string[]): BoxDef => ({ title: '⚠ Red Flags', role: 'rf', tone: 'red', f: [{ t: 'checks', g: 'rf', items }, { t: 'text', k: 'rf.other', label: 'Others:' }] });
const col = (title: string, g: string, items: string[], none?: string): { title: string; f: Field[] } => ({ title, f: [{ t: 'checks', g, items, none }, { t: 'text', k: `${g}.other`, label: 'Other:' }] });
const imaging = (mods: string[]): BoxDef => ({ title: 'Imaging / Investigations', role: 'exam', f: [{ t: 'imaging', k: 'img', mods }] });
const plan = (items: string[]): BoxDef => ({ title: 'Plan', role: 'plan', f: [{ t: 'checks', g: 'plan', items }, { t: 'text', k: 'plan.fu', label: 'Follow up after:' }, { t: 'text', k: 'plan.other', label: 'Others:' }] });
const notes = (title = 'Notes'): BoxDef => ({ title, role: 'notes', f: [{ t: 'notes', k: 'notes' }] });
const STD_PLAN = ['Medication', 'Physiotherapy', 'Activity modification', 'Injection / Intervention', 'Brace / Support', 'Surgery (if indicated)'];
// Pain VAS اختياري من 1 لـ 10 (الضغط تاني على نفس الرقم بيلغيه)
const VAS_PICK: Field = { t: 'pick', g: 'vas', items: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], label: 'Pain VAS (اختياري 1–10):' };
// تقييم الجرح: نفس المربع في متابعة ما بعد العمليات ومتابعة الجبس (طلب ٨/١١)
const wound = (title: string): BoxDef => ({ title, role: 'exam', f: [
  ...['Wound clean', 'Wound dry', 'Redness', 'Discharge', 'Wound dehiscence', 'Signs of infection']
    .map((r): Field => ({ t: 'pick', g: `wd.${r}`, items: ['Yes', 'No'], label: `${r}:` })),
  { t: 'pick', g: 'wstatus', items: ['Healed', 'Healing', 'Needs dressing', 'Needs further intervention'], label: 'Wound status:' },
  { t: 'pick', g: 'suture', items: ['Not indicated', 'Done', 'Planned'], label: 'Suture removal:' }, { t: 'text', k: 'suture.on', label: 'Planned on:' },
] });
const SENS_NOTE = 'Tick the side with reduced / lost sensation.';

export const REGION_SHEETS: RegionSheetDef[] = [
  {
    id: 'ankle', prefix: 'af', tab: 'الكاحل والقدم', title: 'ANKLE &amp; FOOT CONSULTATION SHEET',
    boxes: [
      { title: 'Chief Complaint', role: 'cc', f: [{ t: 'cols', cols: [
        { f: [{ t: 'checks', g: 'cc', items: ['Ankle pain', 'Foot pain', 'Heel pain', 'Midfoot pain', 'Forefoot pain', 'Toe pain', 'Swelling', 'Stiffness', 'Difficulty walking', 'Limp', 'Deformity', 'History of trauma'] }, { t: 'text', k: 'cc.other', label: 'Other:' }] },
        { title: 'Duration:', f: [{ t: 'checks', g: 'dur', items: DUR }] },
      ] }] },
      hpi,
      redFlags(['History of malignancy', 'Unexplained weight loss', 'Fever / night pain', 'Recent significant trauma', 'Inability to bear weight', 'Open wound / suspected infection', 'Neurovascular deficit', 'Severe deformity', 'Non-healing ulcer (especially in DM)']),
      { title: 'Sensation Map (Foot & Ankle)', role: 'exam', f: [{ t: 'ticks', g: 'map', title: 'Key Areas (Nerve Supply)', note: SENS_NOTE, rows: [
        ['Saphenous (L3-L4)', '', '#43a047'], ['Superficial peroneal (L4-L5)', '', '#9ccc65'], ['Deep peroneal (L4-L5)', '', '#f6d55c'], ['Sural (S1-S2)', '', '#64b5f6'],
        ['Tibial (S1-S2)', '', '#e57373'], ['Plantar medial (S1-S2)', '', '#ffb74d'], ['Plantar lateral (S1-S2)', '', '#ce93d8'],
      ] }] },
      { title: 'Palpation', role: 'exam', f: [{ t: 'cols', cols: [
        col('Ankle', 'palp.ankle', ['No tenderness', 'Medial malleolus', 'Lateral malleolus', 'ATFL', 'CFL', 'PTFL', 'Deltoid ligament', 'Achilles tendon', 'Peroneal tendons', 'Anterior joint line', 'Posterior joint line'], 'No tenderness'),
        col('Foot', 'palp.foot', ['No tenderness', 'Calcaneus (heel)', 'Talus', 'Navicular', 'Cuboid', 'Cuneiforms', 'Metatarsals', 'MTP joints', 'Interdigital spaces', 'Plantar fascia', 'Toes (specify)'], 'No tenderness'),
      ] }] },
      { title: 'Range of Motion', role: 'exam', f: [
        { t: 'rom', k: 'rom.ankle', title: 'Ankle Motion', rows: [['Dorsiflexion', '0–20°'], ['Plantar flexion', '0–50°'], ['Inversion', '0–35°'], ['Eversion', '0–15°']] },
        { t: 'rom', k: 'rom.foot', title: 'Subtalar / Foot Motion', rows: [['Inversion', '0–30°'], ['Eversion', '0–20°'], ['1st MTP (Dorsiflexion)', '0–70°'], ['1st MTP (Plantar flexion)', '0–45°']] },
      ] },
      { title: 'Neurological Examination', role: 'exam', f: [
        { t: 'grade', k: 'mrc', title: 'Motor Power (MRC)', opts: 'mrc', rows: [['Ankle dorsiflexion', 'TA'], ['Ankle plantar flexion', 'Gastro-Sol.'], ['Inversion', 'Tibialis posterior'], ['Eversion', 'Peroneus longus/brevis'], ['EHL', 'Great toe extension'], ['Toe flexion', 'FHL']] },
        { t: 'grade', k: 'refl', title: 'Reflexes', opts: 'reflex', rows: [['Ankle', 'S1']] },
        { t: 'ticks', g: 'sens', title: 'Sensation (if abnormal)', rows: [['L4', 'Superficial peroneal'], ['L5', 'Deep peroneal'], ['S1', 'Tibial / Sural']] },
      ] },
      { title: 'Special Tests', role: 'exam', f: [{ t: 'cols', cols: [
        col('Ankle Tests', 'st.ankle', ['Anterior drawer test', 'Talar tilt test', 'Squeeze test (high ankle)', 'Thompson test (Achilles)', 'Single heel rise test', 'External rotation test', "Kleiger's test", 'Weight-bearing lunge']),
        col('Foot Tests', 'st.foot', ["Mulder's click (Morton neuroma)", "Tinel's sign", 'Windlass test (Plantar fasciitis)', 'Midfoot torsion test (Lisfranc)', 'Piano key test (1st ray)', 'Metatarsal squeeze test', 'Forefoot alignment', 'Hindfoot alignment']),
      ] }] },
      imaging(['X-ray', 'MRI', 'CT', 'Ultrasound', 'Bone scan']),
      { title: 'Diagnosis Sheet', role: 'dx', wide: true, f: [{ t: 'dxsheet', id: 'ankle' }, { t: 'dxmap' }] },
      plan(['Medication', 'Physiotherapy', 'Orthotics / Insole', 'Activity modification', 'Injection / Intervention', 'Brace / Support', 'Surgery (if indicated)']),
      notes(),
    ],
  },
  {
    id: 'neckshoulder', prefix: 'cs', tab: 'الرقبة والكتف', title: 'CERVICAL SPINE &amp; SHOULDER CONSULTATION SHEET',
    boxes: [
      { title: 'Chief Complaint', role: 'cc', f: [{ t: 'cols', cols: [
        col('Cervical Spine', 'cc.cx', ['Neck pain', 'Radiating arm pain', 'Numbness / Tingling', 'Weakness', 'Stiffness', 'Headache', 'Dizziness', 'Limited motion', 'History of trauma', 'Follow-up']),
        col('Shoulder', 'cc.sh', ['Shoulder pain', 'Stiffness', 'Restricted motion', 'Weakness', 'Clicking / Locking', 'Instability', 'Night pain', 'History of dislocation', 'History of trauma', 'Follow-up']),
      ] }] },
      hpi,
      redFlags(['History of malignancy', 'Unexplained weight loss', 'Fever / night pain', 'Recent significant trauma', 'Progressive neurological deficit', 'Bowel or bladder dysfunction', 'Gait disturbance', 'Myelopathic signs (hand clumsiness, balance problem)', 'Severe / unremitting pain']),
      { title: 'Dermatomes (Sensation Map)', role: 'exam', f: [{ t: 'ticks', g: 'derm', title: 'Key Areas (Upper Limb)', note: SENS_NOTE, rows: [
        ['C2', 'Occipital / upper neck', '#66bb6a'], ['C3', 'Neck / supraclavicular', '#ffee58'], ['C4', 'Shoulder / clavicle area', '#fdd835'], ['C5', 'Lateral arm', '#9ccc65'],
        ['C6', 'Lateral forearm / thumb', '#64b5f6'], ['C7', 'Middle finger', '#ba68c8'], ['C8', 'Medial forearm / little finger', '#f48fb1'], ['T1', 'Medial arm', '#ffb74d'],
      ] }] },
      { title: 'Palpation', role: 'exam', f: [{ t: 'cols', cols: [
        col('Cervical Spine', 'palp.cx', ['Midline tenderness', 'Paraspinal tenderness', 'Trapezius tenderness', 'Facet joint tenderness', 'Spasm', 'Trigger points']),
        col('Shoulder', 'palp.sh', ['AC joint tenderness', 'Bicipital groove tenderness', 'Greater tuberosity tenderness', 'Subacromial tenderness', 'Posterior joint line', 'SC joint tenderness']),
      ] }] },
      { title: 'Range of Motion', role: 'exam', f: [
        { t: 'rom', k: 'rom.cx', title: 'Cervical Spine Motion', rows: [['Flexion', '0–45°'], ['Extension', '0–45°'], ['Rt. Lateral bending', '0–45°'], ['Lt. Lateral bending', '0–45°'], ['Rt. Rotation', '0–80°'], ['Lt. Rotation', '0–80°']] },
        { t: 'rom', k: 'rom.sh', title: 'Shoulder Motion', rows: [['Flexion', '0–180°'], ['Abduction', '0–180°'], ['External rotation', '0–90°'], ['Internal rotation', '0–70°'], ['Horizontal adduction', '0–135°'], ['Horizontal abduction', '0–45°']] },
      ] },
      { title: 'Neurological Examination (Cervical Spine)', role: 'exam', f: [
        { t: 'grade', k: 'mrc', title: 'Motor Power (MRC)', opts: 'mrc', rows: [['C5', 'Shoulder abduction'], ['C6', 'Elbow flexion / Wrist extension'], ['C7', 'Elbow extension / Wrist flexion'], ['C8', 'Finger flexion'], ['T1', 'Finger abduction']] },
        { t: 'grade', k: 'refl', title: 'Reflexes', opts: 'reflex', rows: [['Biceps', 'C5-C6'], ['Triceps', 'C7-C8'], ['Brachioradialis', 'C5-C6']] },
      ] },
      { title: 'Special Tests', role: 'exam', f: [{ t: 'cols', cols: [
        col('Cervical Spine', 'st.cx', ["Spurling's test", 'Shoulder abduction test', 'Upper limb tension test', "Lhermitte's sign", "Hoffman's sign", 'Romberg test']),
        col('Shoulder', 'st.sh', ['Neer test', 'Hawkins-Kennedy test', 'Empty can test', 'Drop arm test', "Speed's test", "Yergason's test", 'Cross body adduction test', 'Apprehension / Relocation', "O'Brien test"]),
      ] }] },
      imaging(['X-ray', 'MRI', 'CT', 'Ultrasound']),
      { title: 'Diagnosis Sheet', role: 'dx', wide: true, f: [{ t: 'dxsheet', id: 'neckshoulder' }, { t: 'dxmap' }] },
      plan(STD_PLAN),
      notes(),
    ],
  },
  {
    id: 'hand', prefix: 'eh', tab: 'الكوع والرسغ واليد', title: 'ELBOW, WRIST &amp; HAND CONSULTATION SHEET',
    boxes: [
      { title: 'Chief Complaint', role: 'cc', f: [{ t: 'cols', cols: [
        { f: [{ t: 'checks', g: 'cc', items: ['Elbow pain', 'Wrist pain', 'Hand pain', 'Swelling', 'Stiffness', 'Numbness / Tingling', 'Weakness', 'Limited motion', 'Locking / Clicking', 'Deformity', 'History of trauma'] }, { t: 'text', k: 'cc.other', label: 'Other:' }] },
        { title: 'Duration:', f: [{ t: 'checks', g: 'dur', items: DUR }] },
      ] }] },
      hpi,
      redFlags(['History of malignancy', 'Unexplained weight loss', 'Fever / night pain', 'Recent significant trauma', 'Progressive neurological deficit', 'Vascular compromise (coldness, discoloration)', 'Open wound / suspected infection', 'Severe / unremitting pain']),
      { title: 'Anatomical Diagram (Sensation Map)', role: 'exam', f: [{ t: 'ticks', g: 'map', title: 'Key (Nerve Supply)', note: SENS_NOTE, rows: [
        ['Median nerve', '', '#f6d55c'], ['Ulnar nerve', '', '#66bb6a'], ['Radial nerve (superficial branch)', '', '#64b5f6'], ['Musculocutaneous (lateral forearm)', '', '#f48fb1'], ['Axillary nerve (lateral upper arm)', '', '#ffb74d'],
      ] }] },
      { title: 'Palpation', role: 'exam', wide: true, f: [{ t: 'cols', cols: [
        col('Elbow', 'palp.el', ['Medial epicondyle', 'Lateral epicondyle', 'Olecranon', 'Radial head', 'Biceps tendon', 'Triceps tendon', 'Ulnar nerve (tunnel)', 'Swelling / Effusion']),
        col('Wrist', 'palp.wr', ['Distal radius', 'Distal ulna', 'DRUJ', 'Scaphoid (snuffbox)', 'TFCC (ulnar side)', 'Carpal ligaments', 'Tendon tenderness']),
        col('Hand', 'palp.hd', ['MCP joints', 'PIP joints', 'DIP joints', '1st CMC joint', 'Metacarpals', 'Phalanges', 'Flexor tendons', 'Extensor tendons', 'Trigger points']),
      ] }] },
      { title: 'Range of Motion (Degrees)', role: 'exam', f: [
        { t: 'rom', k: 'rom.el', title: 'Elbow Motion', rows: [['Flexion', '0–150°'], ['Extension', '0° (to 5-10° hyperext.)'], ['Pronation', '0–80°'], ['Supination', '0–80°']] },
        { t: 'rom', k: 'rom.wr', title: 'Wrist Motion', rows: [['Flexion', '0–80°'], ['Extension', '0–70°'], ['Radial deviation', '0–20°'], ['Ulnar deviation', '0–30°']] },
        { t: 'rom', k: 'rom.hd', title: 'Hand Motion (Fingers)', rows: [['MCP flexion', '0–90°'], ['PIP flexion', '0–110°'], ['DIP flexion', '0–80°'], ['Thumb abduction', '0–70°'], ['Thumb opposition', 'To base of 5th']] },
      ] },
      { title: 'Neurological & Vascular Examination', role: 'exam', f: [
        { t: 'grade', k: 'mrc', title: 'Motor Power (MRC)', opts: 'mrc', rows: [['Elbow flexion', 'C5-6'], ['Elbow extension', 'C6-7'], ['Wrist extension', 'C6-7'], ['Wrist flexion', 'C7-8'], ['Finger extension', 'C7-8'], ['Finger flexion', 'C8-T1'], ['Thumb abduction', 'C8-T1'], ['Finger abduction', 'T1']] },
        { t: 'ticks', g: 'sens', title: 'Sensation (light touch)', rows: [['Median', 'thumb, index, middle'], ['Ulnar', 'ring, little'], ['Radial', 'dorsal hand'], ['Lateral antebrachial cutaneous', '']] },
        { t: 'grade', k: 'refl', title: 'Reflexes', opts: 'reflex', rows: [['Biceps', 'C5-6'], ['Triceps', 'C7'], ['Brachioradialis', 'C6']] },
        { t: 'ticks', g: 'circ', title: 'Peripheral circulation', sub: 'Normal', note: '✓ = normal', rows: [['Radial pulse', 'Normal'], ['Capillary refill', '< 2 sec']] },
      ] },
      { title: 'Special Tests', role: 'exam', wide: true, f: [{ t: 'cols', cols: [
        col('Elbow Tests', 'st.el', ["Cozen's test (lateral epicondylitis)", "Mill's test", "Maudsley's test", 'Chair test', "Tinel's at ulnar nerve", 'Elbow valgus stress', 'Elbow varus stress', 'Moving valgus stress (UCL)']),
        col('Wrist Tests', 'st.wr', ["Phalen's test", "Tinel's test (median nerve)", "Durkan's test", 'Finkelstein test (De Quervain)', 'Watson test (scaphoid)', 'TFCC stress test (Ulnar grind)', 'DRUJ stability']),
        col('Hand Tests', 'st.hd', ['Tendon glide', 'Trigger finger test', 'CMC grind test (thumb)', "Elson's test (central slip)", 'Bouvier test (mallet finger)', "Froment's sign", "Wartenberg's sign", "Allen's test (vascular)"]),
      ] }] },
      imaging(['X-ray', 'US (MSK)', 'MRI', 'CT', 'Nerve conduction (NCV)']),
      { title: 'Diagnosis Sheet', role: 'dx', wide: true, f: [{ t: 'dxsheet', id: 'hand' }, { t: 'dxmap' }] },
      plan(['Medication', 'Physiotherapy', 'Activity modification', 'Splint / Brace', 'Injection / Intervention', 'Surgery (if indicated)']),
      notes(),
    ],
  },
  {
    id: 'lumbar', prefix: 'ls', tab: 'أسفل الظهر والعجز', title: 'LUMBAR &amp; SACRAL SPINE CONSULTATION SHEET',
    boxes: [
      { title: 'Chief Complaint', role: 'cc', f: [{ t: 'checks', g: 'cc', items: ['Low back pain', 'Radiating leg pain (sciatica)', 'Numbness / tingling', 'Weakness', 'Stiffness', 'Difficulty walking', 'Postural problem', 'Trauma (history of)', 'Bladder / bowel symptoms', 'Night pain', 'Follow-up'] }, { t: 'text', k: 'cc.other', label: 'Other:' }] },
      { title: 'History of Present Illness', role: 'hx', f: [
        { t: 'pick', g: 'dur', items: ['Acute (< 6 weeks)', 'Subacute (6–12 weeks)', 'Chronic (> 12 weeks)'], label: 'Duration:' },
        { t: 'pick', g: 'onset', items: ['Sudden', 'Gradual'], label: 'Onset:' }, { t: 'pick', g: 'course', items: ['Progressive', 'Recurrent', 'Static'], label: 'Course:' }, ...FACTORS, ...PREV,
      ] },
      redFlags(['History of malignancy', 'Unexplained weight loss', 'Fever / night pain', 'Recent significant trauma', 'Progressive neurological deficit', 'Bladder or bowel dysfunction (Cauda equina)', 'Saddle anesthesia', 'Age > 50', 'Steroid use / Immunosuppression']),
      { title: 'Quick Screening', role: 'hx', f: [{ t: 'checks', g: 'qs', items: ['Mechanic / postural back pain', 'Radicular pain (dermatomal)', 'Neurogenic claudication', 'Reduced walking tolerance', 'Night pain', 'Previous spinal surgery', 'Osteoporosis risk', 'Spondylolisthesis suspected'] }, { t: 'text', k: 'qs.other', label: 'Other:' }] },
      { title: 'Inspection', role: 'exam', f: [{ t: 'checks', g: 'insp', items: ['Posture (scoliosis / list)', 'Gait', 'Pelvic tilt', 'Shoulder / hip level', 'Muscle wasting', 'Skin changes (scar, dimple, hair)', 'Deformity (kyphosis / lordosis)', 'Swelling'] }, { t: 'text', k: 'insp.other', label: 'Other:' }] },
      { title: 'Palpation', role: 'exam', f: [{ t: 'checks', g: 'palp', items: ['Midline tenderness', 'Paraspinal tenderness', 'SI joint tenderness', 'Gluteal tenderness', 'Sciatic notch tenderness', 'Muscle spasm', 'Step deformity'] }, { t: 'text', k: 'palp.other', label: 'Other:' }] },
      { title: 'Range of Motion (Lumbar)', role: 'exam', f: [
        { t: 'rom', k: 'rom', title: 'Movement', noNormal: true, rows: [['Flexion', ''], ['Extension', ''], ['Rt. lateral flexion', ''], ['Lt. lateral flexion', ''], ['Rt. rotation', ''], ['Lt. rotation', '']] },
        { t: 'pick', g: 'arc', items: ['Yes', 'No'], label: 'Painful arc:' },
      ] },
      { title: 'Neurological Examination', role: 'exam', wide: true, f: [{ t: 'cols', cols: [
        { f: [
          { t: 'grade', k: 'mrc', title: 'Motor Power (MRC)', opts: 'mrc', rows: [['L2', 'Hip flexion'], ['L3', 'Knee extension'], ['L4', 'Ankle dorsiflexion'], ['L5', 'Great toe extension'], ['S1', 'Ankle plantar flexion']] },
          { t: 'grade', k: 'refl', title: 'Reflexes', opts: 'reflex4', rows: [['Knee', 'L3–L4'], ['Ankle', 'S1']] },
        ] },
        { f: [
          { t: 'ticks', g: 'sens', title: 'Sensation (Dermatomes)', rows: [['L2', 'Anterior thigh'], ['L3', 'Medial knee'], ['L4', 'Medial leg / ankle'], ['L5', 'Dorsum of foot'], ['S1', 'Lateral foot']] },
          { t: 'ticks', g: 'nt', title: 'Special Tests (Nerve Tension)', note: '✓ = positive', rows: [['SLR (Straight Leg Raise)', ''], ['Crossed SLR', ''], ['Femoral Nerve Stretch', '']] },
        ] },
      ] }] },
      { title: 'Special Tests (Lumbar & SI)', role: 'exam', f: [{ t: 'checks', g: 'st', items: ['SLR (Straight Leg Raise)', 'Crossed SLR', 'Femoral nerve stretch test', 'Slump test', "Kemp's test (extension-rotation)", 'FABER test (SI joint)', "Gaenslen's test", 'Thigh thrust test', 'Compression test (SI joint)', 'Distraction test (SI joint)'] }, { t: 'text', k: 'st.other', label: 'Other:' }] },
      { title: 'Imaging / Investigations', role: 'exam', f: [
        { t: 'checks', g: 'img', items: ['X-ray (Lumbosacral spine AP/Lateral)', 'MRI (Lumbosacral spine)', 'CT (if needed)', 'Bone scan (if indicated)', 'DEXA (if indicated)', 'Ultrasound (guided injection)', 'Not available'] },
        { t: 'text', k: 'img.other', label: 'Others:' }, { t: 'text', k: 'img.findings', label: 'Findings:', stack: true },
      ] },
      { title: 'Diagnosis Sheet', role: 'dx', wide: true, f: [{ t: 'dxsheet', id: 'lumbar' }, { t: 'dxmap' }] },
      { title: 'Plan / Management', role: 'plan', f: [{ t: 'checks', g: 'plan', items: ['Medication', 'Physiotherapy (McKenzie / Core)', 'Activity modification', 'Epidural / Nerve root injection', 'Facet / SI joint injection', 'Surgery (if indicated)', 'Follow-up', 'Lifestyle advice (posture / weight)'] }, { t: 'text', k: 'plan.other', label: 'Other:' }] },
      notes('Notes / Diagrams'),
    ],
  },
  // شيت التروما (Orthopedic Trauma Assessment Sheet) — نفس الصورة اللي بعتها الدكتور (٧/١١): بيتضاف من «+ منطقة تانية…»
  {
    // شيت التروما بقى جزء من الشيت العام (طلب ٨/١١) — اتشال منه المتكرر مع الشيت العام:
    // Time since injury (= «منذ متى؟»)، Previous treatment (= «ماذا تم عمله حتى الآن؟»)، Open injury (= Open wound تحت)،
    // العلامات الحيوية (= خانة 2؛ SpO₂ اتنقل هناك)، Diagnosis (= تشخيص كشف الطبيب)، Follow-up (= تحديد موعد متابعة في الخطة العلاجية)
    id: 'trauma', prefix: 'tr', tab: 'شيت التروما', title: 'ORTHOPEDIC TRAUMA ASSESSMENT SHEET',
    boxes: [
      { title: 'History of Trauma', role: 'hx', f: [
        { t: 'checks', g: 'mech', label: 'Mechanism of Injury:', items: ['Road Traffic Accident (RTA)', 'Fall from height', 'Fall on same level', 'Direct trauma', 'Sports injury', 'Twisting injury'] },
        { t: 'text', k: 'mech.other', label: 'Other:' },
        { t: 'text', k: 'site', label: 'Site of injury:' }, { t: 'side' },
      ] },
      { title: 'Primary Assessment – ATLS', role: 'exam', f: [
        { t: 'pick', g: 'a', items: ['Patent', 'Compromised'], label: 'A — Airway:' },
        { t: 'pick', g: 'b', items: ['Normal', 'Abnormal'], label: 'B — Breathing:' },
        { t: 'pick', g: 'c', items: ['Stable', 'Unstable'], label: 'C — Circulation:' },
        { t: 'text', k: 'gcs', label: 'D — Disability (GCS /15):' },
        { t: 'pick', g: 'e', items: ['Completed'], label: 'E — Exposure:' },
      ] },
      { title: 'Orthopedic Examination', role: 'exam', wide: true, f: [{ t: 'cols', cols: [
        { title: 'Inspection', f: [
          ...['Swelling', 'Deformity', 'Bruising / Ecchymosis', 'Open wound'].map((r): Field => ({ t: 'pick', g: `insp.${r}`, items: ['Yes', 'No'], label: `${r}:` })),
          { t: 'text', k: 'skin', label: 'Skin condition:' }, { t: 'text', k: 'pos', label: 'Abnormal position / Rotation:' },
        ] },
        { title: 'Palpation', f: [
          { t: 'text', k: 'tender', label: 'Tenderness:' },
          { t: 'pick', g: 'crep', items: ['Yes', 'No'], label: 'Crepitus:' },
          { t: 'pick', g: 'mob', items: ['Yes', 'No'], label: 'Abnormal mobility:' },
          { t: 'pick', g: 'comp', items: ['Normal', 'Increased'], label: 'Compartment tension:' },
        ] },
        { title: 'Range of Motion', f: [{ t: 'text', k: 'rom.active', label: 'Active ROM:' }, { t: 'text', k: 'rom.passive', label: 'Passive ROM:' }] },
      ] }] },
      { title: 'Neurovascular Assessment', role: 'exam', f: [{ t: 'cols', cols: [
        { title: 'Vascular', f: [
          { t: 'pick', g: 'pulses', items: ['Present', 'Absent'], label: 'Distal pulses:' },
          { t: 'text', k: 'cap', label: 'Capillary refill (seconds):' },
          { t: 'pick', g: 'stemp', items: ['Warm', 'Cold'], label: 'Skin temperature:' },
          { t: 'pick', g: 'perf', items: ['Normal', 'Impaired'], label: 'Distal perfusion:' },
        ] },
        { title: 'Neurological', f: [
          { t: 'text', k: 'motor', label: 'Motor function:' }, { t: 'text', k: 'sens', label: 'Sensation:' },
          { t: 'text', k: 'nerve', label: 'Peripheral nerve examination:' },
        ] },
      ] }] },
      { title: 'Associated Injuries', role: 'exam', f: [
        { t: 'checks', g: 'assoc', cols: true, items: ['Head injury', 'Cervical spine injury', 'Chest injury', 'Abdominal injury', 'Pelvic injury', 'Other limb injury'] },
        { t: 'text', k: 'assoc.details', label: 'Details:' },
      ] },
      { title: 'Imaging', role: 'exam', f: [{ t: 'checks', g: 'img', items: ['X-ray AP', 'X-ray Lateral', 'CT', 'MRI', 'Ultrasound'] }] },
      { title: 'Radiological Findings', role: 'exam', f: [
        { t: 'text', k: 'rad.bone', label: 'Bone / Joint:' }, { t: 'text', k: 'rad.type', label: 'Fracture type:' },
        { t: 'text', k: 'rad.disp', label: 'Displacement:' }, { t: 'text', k: 'rad.ang', label: 'Angulation / Rotation:' },
        { t: 'text', k: 'rad.joint', label: 'Joint involvement:' },
      ] },
      { title: 'Management Plan', role: 'plan', f: [
        { t: 'checks', g: 'plan', cols: true, items: ['Analgesia', 'Wound care', 'Tetanus prophylaxis', 'IV Antibiotics (if indicated)', 'Splint / Back slab', 'Reduction', 'Cast', 'Surgery', 'Admission', 'Referral'] },
        { t: 'text', k: 'immob', label: 'Immobilization:' },
      ] },
      { title: 'Important Documentation', role: 'exam', f: [
        { t: 'text', k: 'nv.before', label: 'Neurovascular status BEFORE intervention:', stack: true },
        { t: 'text', k: 'nv.after', label: 'Neurovascular status AFTER intervention:', stack: true },
        { t: 'pick', g: 'consent', items: ['Yes', 'No'], label: 'Consent:' },
        { t: 'text', k: 'redflags', label: 'Red flags / Complications:', stack: true },
      ] },
    ],
  },
  // متابعة الجبس وما بعد العمليات — مش مناطق جسم: بتتضاف من «+ منطقة تانية…»
  {
    id: 'cast', prefix: 'cf', tab: 'متابعة الجبس', title: 'CAST FOLLOW-UP',
    boxes: [
      { title: '1. بيانات الإصابة والجبس', role: 'hx', f: [
        { t: 'text', k: 'inj.type', label: 'نوع الإصابة:' }, { t: 'text', k: 'inj.site', label: 'مكان الإصابة:' },
        { t: 'checks', g: 'type', items: ['Above Knee', 'Below Knee', 'Long Arm', 'Short Arm'], label: 'نوع الجبس:' }, { t: 'text', k: 'type.other', label: 'Other:' },
        { t: 'text', k: 'applied', label: 'تاريخ تركيب الجبس:' }, { t: 'text', k: 'duration', label: 'مدة التثبيت المتوقعة:' },
      ] },
      { title: '2. تقييم الجبس والطرف', role: 'exam', f: [
        ...['Cast integrity', 'Cast tightness', 'Skin condition', 'Swelling', 'Distal circulation', 'Sensation', 'Finger / Toe movement', 'Pain assessment']
          .map((r): Field => ({ t: 'pick', g: `ev.${r}`, items: ['Normal', 'Abnormal'], label: `${r}:` })),
        VAS_PICK, { t: 'text', k: 'cap', label: 'Capillary refill:' }, { t: 'text', k: 'ev.notes', label: 'ملاحظات:', stack: true },
      ] },
      wound('3. تقييم الجرح'),
      { title: '4. الأشعة والالتئام', role: 'exam', f: [
        { t: 'pick', g: 'xray', items: ['Not done', 'Done'], label: 'X-ray:' },
        { t: 'pick', g: 'align', items: ['Acceptable', 'Unacceptable'], label: 'Alignment:' },
        { t: 'pick', g: 'callus', items: ['Present', 'Absent'], label: 'Callus formation:' },
        { t: 'pick', g: 'heal', items: ['Early healing', 'Progressive healing', 'Union', 'Delayed union', 'Non-union'], label: 'Healing status:' },
      ] },
      { title: '5. القرار والخطة', role: 'plan', f: [
        { t: 'checks', g: 'plan', items: ['Continue cast', 'Cast modification', 'Change cast', 'Remove cast', 'Start physiotherapy', 'Start progressive weight bearing', 'Request X-ray'] },
        { t: 'text', k: 'plan.other', label: 'Other:' }, { t: 'text', k: 'next', label: 'Next follow-up:' },
      ] },
      { title: 'VISIT RECORD — Clinical progress', role: 'notes', f: [{ t: 'notes', k: 'notes' }] },
    ],
  },
  {
    id: 'postop', prefix: 'po', tab: 'متابعة ما بعد العمليات', title: 'POST-OPERATIVE FOLLOW-UP',
    boxes: [
      { title: '1. بيانات العملية', role: 'hx', f: [
        { t: 'text', k: 'op.name', label: 'اسم العملية:' }, { t: 'text', k: 'op.kind', label: 'نوع العملية:' },
        { t: 'text', k: 'op.date', label: 'تاريخ العملية:' }, { t: 'text', k: 'op.surgeon', label: 'Surgeon:' },
        { t: 'checks', g: 'implant', items: ['Plate & Screws', 'Intramedullary Nail', 'K-wire', 'External Fixator', 'Arthroscopy', 'Soft tissue repair'], label: 'Implant / Fixation:' },
        { t: 'text', k: 'implant.other', label: 'Other:' },
      ] },
      wound('2. تقييم الجرح'),
      { title: '3. تقييم الطرف والوظيفة', role: 'exam', f: [
        VAS_PICK,
        { t: 'pick', g: 'swell', items: ['None', 'Mild', 'Moderate', 'Severe'], label: 'Swelling:' },
        { t: 'text', k: 'rom', label: 'ROM:' }, { t: 'text', k: 'nv', label: 'Neurovascular status:' }, { t: 'text', k: 'power', label: 'Muscle power:' },
        { t: 'pick', g: 'wb', items: ['NWB', 'TTWB', 'PWB', 'WBAT', 'FWB'], label: 'Weight bearing:' },
      ] },
      { title: '4. الأشعة والتثبيت', role: 'exam', f: [
        { t: 'pick', g: 'xray', items: ['Done', 'Not done'], label: 'X-ray:' },
        { t: 'pick', g: 'align', items: ['Satisfactory', 'Unsatisfactory'], label: 'Alignment:' },
        { t: 'pick', g: 'fix', items: ['Stable', 'Concern'], label: 'Fixation:' },
        { t: 'pick', g: 'heal', items: ['Progressive', 'Union', 'Delayed union', 'Non-union'], label: 'Healing:' },
      ] },
      { title: '5. خطة العلاج والتأهيل', role: 'plan', f: [
        { t: 'checks', g: 'plan', items: ['Continue current protocol', 'Wound dressing', 'Remove sutures', 'Start / Continue physiotherapy', 'ROM exercises', 'Muscle strengthening', 'Progressive weight bearing', 'Continue immobilization', 'Modify medications', 'Request further imaging'] },
        { t: 'text', k: 'instr', label: 'Instructions / Restrictions:', stack: true }, { t: 'text', k: 'next', label: 'Next follow-up:' },
      ] },
      { title: 'VISIT RECORD — Clinical progress', role: 'notes', f: [{ t: 'notes', k: 'notes' }] },
    ],
  },
  {
    // شيت فحص الأطفال (Pediatric Orthopedic Examination) — نفس الورق: 10 خانات
    id: 'peds', prefix: 'pd', tab: 'فحص أطفال', title: 'PEDIATRIC ORTHOPEDIC EXAMINATION',
    boxes: [
      { title: '1. Growth & Development', role: 'exam', f: [
        { t: 'text', k: 'wt', label: 'Weight (kg):' }, { t: 'text', k: 'ht', label: 'Height (cm):' },
        { t: 'pick', g: 'miles', items: ['Normal', 'Delayed'], label: 'Milestones:' }, { t: 'pick', g: 'birth', items: ['Full term', 'Premature'], label: 'Birth:' },
        { t: 'text', k: 'fam', label: 'Family history:' },
      ] },
      { title: '2. Gait & Function', role: 'exam', f: [
        { t: 'pick', g: 'gait', items: ['Normal', 'Limping', 'Toe walking'], label: 'Gait:' },
        { t: 'pick', g: 'fprog', items: ['In-toeing', 'Out-toeing'], label: 'Foot progression:' },
        { t: 'pick', g: 'funclim', items: ['Yes', 'No'], label: 'Functional limitation:' },
      ] },
      { title: '3. Spine', role: 'exam', f: [
        { t: 'pick', g: 'scol', items: ['Yes', 'No'], label: 'Scoliosis:' }, { t: 'pick', g: 'kyph', items: ['Yes', 'No'], label: 'Kyphosis:' },
        { t: 'pick', g: 'lord', items: ['Normal', 'Increased'], label: 'Lordosis:' }, { t: 'pick', g: 'tend', items: ['Yes', 'No'], label: 'Tenderness:' },
      ] },
      { title: '4. Hip', role: 'exam', f: [
        { t: 'rom', k: 'hip', title: 'Hip ROM', noNormal: true, rows: [['Abduction', ''], ['Internal rotation', ''], ['External rotation', '']] },
        { t: 'pick', g: 'galeazzi', items: ['Negative', 'Positive'], label: 'Galeazzi:' }, { t: 'pick', g: 'barlow', items: ['Negative', 'Positive'], label: 'Barlow / Ortolani:' },
      ] },
      { title: '5. Knee & Lower Limb', role: 'exam', f: [
        { t: 'pick', g: 'align', items: ['Normal', 'Varus', 'Valgus'], label: 'Alignment:' }, { t: 'pick', g: 'rotprof', items: ['Normal', 'Abnormal'], label: 'Rotational profile:' },
        { t: 'rom', k: 'knee', title: 'Knee', noNormal: true, rows: [['ROM', '']] },
        { t: 'pick', g: 'lld', items: ['Yes', 'No'], label: 'Limb length discrepancy:' },
      ] },
      { title: '6. Foot & Ankle', role: 'exam', f: [
        { t: 'checks', g: 'ftype', items: ['Normal', 'Flatfoot', 'Cavus', 'Clubfoot'], label: 'Type:' },
        { t: 'pick', g: 'heel', items: ['Neutral', 'Valgus', 'Varus'], label: 'Heel:' }, { t: 'pick', g: 'flex', items: ['Flexible', 'Rigid'], label: 'Flexibility:' },
        { t: 'rom', k: 'ankle', title: 'Ankle', noNormal: true, rows: [['ROM', '']] },
      ] },
      { title: '7. Upper Limb', role: 'exam', f: [
        { t: 'rom', k: 'ul', title: 'Upper limb ROM', noNormal: true, rows: [['Shoulder ROM', ''], ['Elbow ROM', '']] },
        { t: 'pick', g: 'wrist', items: ['Normal', 'Abnormal'], label: 'Wrist / Hand:' },
      ] },
      { title: '8. Neurovascular', role: 'exam', f: [
        { t: 'text', k: 'power', label: 'Muscle power:' },
        { t: 'pick', g: 'tone', items: ['Normal', 'Abnormal'], label: 'Tone:' }, { t: 'pick', g: 'refl', items: ['Normal', 'Abnormal'], label: 'Reflexes:' },
        { t: 'pick', g: 'sens', items: ['Intact', 'Impaired'], label: 'Sensation:' }, { t: 'pick', g: 'pulse', items: ['Normal', 'Abnormal'], label: 'Pulses:' },
      ] },
      { title: '9. Investigations', role: 'exam', f: [{ t: 'checks', g: 'inv', items: ['X-ray', 'Ultrasound', 'MRI', 'CT'] }] },
      { title: '10. Diagnosis', role: 'dx', wide: true, f: [{ t: 'text', k: 'dx', label: 'Diagnosis:' }] },
      { title: 'Treatment & Follow-up', role: 'plan', wide: true, f: [
        { t: 'checks', g: 'tx', items: ['Observation', 'Physiotherapy', 'Medication', 'Orthosis', 'Casting', 'Surgery'], label: 'Treatment:' },
        { t: 'text', k: 'fu', label: 'Follow-up:' },
      ] },
      notes(),
    ],
  },
];
// الخطة العلاجية والتعليمات وموعد المتابعة — خانة واحدة للكشف كله، بتظهر تحت أي شيت مفتوح (مفاتيح tp.*)
export const TREATMENT: RegionSheetDef = {
  id: 'treatment', prefix: 'tp', tab: 'الخطة العلاجية', title: 'الخطة العلاجية',
  boxes: [{ title: 'الخطة العلاجية والتعليمات', role: 'plan', wide: true, f: [{ t: 'cols', cols: [
    { title: 'الخطة العلاجية', f: [{ t: 'checks', g: 'tx', items: ['علاج تحفظي', 'أشعة', 'حقن'] }, { t: 'text', k: 'tx.other', label: 'تفاصيل:' }] },
    { title: 'التعليمات', f: [{ t: 'checks', g: 'instr', items: ['راحة نسبية', 'تمارين منزلية', 'علاج طبيعي', 'تجنب مجهود معين'] }, { t: 'text', k: 'instr.other', label: 'تعليمات أخرى:' }] },
  ] }] }],
};
export const treatmentFilled = (s: ExamSheet) => s.on.some((o) => o.startsWith('tp.')) || Object.entries(s.txt).some(([k, v]) => k.startsWith('tp.') && v.trim());
// «فحص سريع» (Orthopedic Clinical Examination Sheet — ١٠/١١): تاب 2 في التشخيص، قبل «متابعة المريض». مفاتيح qe.* جوّه شيت الكشف
const jointBox = (name: string, g: string | null, special: string[]): BoxDef => ({ title: name, role: 'exam', wide: true, f: g === null ? [{ t: 'side' }] : [
  { t: 'checks', cols: true, g: `${g}.insp`, items: ['N', 'Sw', 'Deformity'], label: 'Inspection:' },
  { t: 'checks', cols: true, g: `${g}.palp`, items: ['NT', 'Mild', 'Mod', 'Sev'], label: 'Palpation:' },
  { t: 'checks', cols: true, g: `${g}.rom`, items: ['Full', 'Limited', 'Painful'], label: 'ROM:' },
  { t: 'checks', cols: true, g: `${g}.st`, items: special, label: 'Special tests:' },
] });
const MOVES: [string, string][] = [['Flexion', ''], ['Extension', ''], ['Abduction', ''], ['Adduction', ''], ['Internal Rotation', ''], ['External Rotation', '']];
export const QUICK_EXAM: RegionSheetDef = {
  id: 'quick', prefix: 'qe', tab: 'فحص سريع', title: 'ORTHOPEDIC CLINICAL EXAMINATION SHEET',
  boxes: [
    { title: 'General Examination', role: 'exam', wide: true, f: [
      { t: 'pick', g: 'gen', items: ['Good', 'Fair', 'Poor'], label: 'General condition:' },
      { t: 'checks', cols: true, g: 'gait', items: ['Normal', 'Antalgic', 'Limping', 'Trendelenburg', 'Foot drop', 'Unable to walk'], label: 'Gait:', none: 'Normal' },
      { t: 'checks', cols: true, g: 'posture', items: ['Normal', 'Forward head', '↑ Kyphosis', '↑ Lordosis', 'Scoliosis', 'Pelvic tilt'], label: 'Posture:', none: 'Normal' },
      { t: 'pick', g: 'nutr', items: ['Normal', 'Underweight', 'Overweight', 'Obese'], label: 'Nutritional status:' },
      { t: 'checks', cols: true, g: 'deform', items: ['No deformity', 'Varus', 'Valgus', 'Flexion deformity', 'Rotational deformity', 'Limb length discrepancy'], label: 'Visible deformity:', none: 'No deformity' },
      { t: 'checks', cols: true, g: 'aids', items: ['None', 'Walking stick', 'Crutches', 'Walker', 'Wheelchair'], label: 'Walking aids:', none: 'None' },
    ] },
    // كل مفصل مربع لوحده بيتفتح ويتقفل (طلب الدكتور ١١/١١) — «Side» في أول مربع
    jointBox('Local Exam — Side', null, []),
    jointBox('Shoulder', 'sh', ['Neer', 'Hawkins', 'Jobe (Empty can)', 'Drop arm', "Speed's", "Yergason's", 'Cross-body']),
    jointBox('Elbow', 'el', ["Cozen's", "Mill's", "Tinel's", 'Moving valgus stress']),
    jointBox('Wrist & Hand', 'wh', ["Phalen's", "Reverse Phalen's", "Tinel's", 'Finkelstein', "Durkan's"]),
    jointBox('Cervical Spine', 'cs', ['Spurling', 'Cervical distraction', 'Shoulder abduction relief', "Hoffmann's"]),
    jointBox('Lumbar Spine', 'ls', ['SLR', 'Crossed SLR', 'Slump test', 'Femoral stretch']),
    jointBox('Hip', 'hp', ['FABER', 'FADIR', 'Trendelenburg', 'Thomas', "Ober's"]),
    jointBox('Knee', 'kn', ['McMurray', 'Thessaly', 'Lachman', 'Ant. drawer', 'Post. drawer', 'Patellar grind', 'Patellar apprehension']),
    jointBox('Ankle & Foot', 'af', ['Ant. drawer', 'Talar tilt', 'Thompson', 'Squeeze', 'External rotation stress', 'Windlass']),
    { title: 'Neurological Examination', role: 'exam', wide: true, f: [
      { t: 'checks', cols: true, g: 'sens', items: ['Normal sensation', 'Hypoesthesia', 'Hyperesthesia', 'Paresthesia', 'Anesthesia'], label: 'Sensory:', none: 'Normal sensation' },
      { t: 'cols', cols: [
        { f: [{ t: 'ticks', g: 'derm.ul', title: 'Upper Limb Dermatomes', note: 'Tick the side with abnormal sensation.', rows: [['C5', 'Lateral shoulder'], ['C6', 'Thumb'], ['C7', 'Middle finger'], ['C8', 'Little finger'], ['T1', 'Medial forearm']] }] },
        { f: [{ t: 'ticks', g: 'derm.ll', title: 'Lower Limb Dermatomes', rows: [['L1', 'Inguinal region'], ['L2', 'Mid anterior thigh'], ['L3', 'Medial knee'], ['L4', 'Medial leg & medial ankle'], ['L5', 'Dorsum of foot & great toe'], ['S1', 'Lateral foot & little toe'], ['S2', 'Posterior thigh'], ['S3', 'Buttock region'], ['S4-S5', 'Perineal region']] }] },
      ] },
      { t: 'pick', g: 'derm.as', items: ['Normal', 'Decreased', 'Absent', 'Increased'], label: 'Dermatome assessment (R/L):' },
      { t: 'pick', g: 'motor', items: ['Normal motor function', 'Motor weakness', 'Complete paralysis'], label: 'Motor:' },
      { t: 'grade', k: 'dtr', title: 'Deep Tendon Reflexes', opts: 'reflex4', rows: [['Biceps', 'C5-C6'], ['Brachioradialis', 'C5-C6'], ['Triceps', 'C7-C8'], ['Patellar', 'L3-L4'], ['Achilles', 'S1-S2']] },
      { t: 'checks', cols: true, g: 'tension', items: ['SLR', 'Crossed SLR', 'Slump test', 'Femoral nerve stretch test', "Tinel's sign", "Phalen's test"], label: 'Nerve tension tests (+ve):' },
    ] },
    { title: 'Vascular Examination', role: 'exam', wide: true, f: [
      { t: 'pick', g: 'pulse', items: ['Normal', 'Weak', 'Absent'], label: 'Peripheral pulses:' },
      { t: 'pick', g: 'crt', items: ['Normal', 'Delayed'], label: 'Capillary refill:' },
      { t: 'pick', g: 'temp', items: ['Normal', 'Cold extremity'], label: 'Skin temperature:' },
      { t: 'pick', g: 'color', items: ['Normal', 'Pallor', 'Cyanosis'], label: 'Skin color:' },
      { t: 'pick', g: 'edema', items: ['Absent', 'Present'], label: 'Peripheral edema:' },
    ] },
    { title: 'Joint Stability', role: 'exam', wide: true, f: [
      { t: 'pick', g: 'stab', items: ['Stable', 'Mild instability', 'Moderate instability', 'Severe instability'], label: 'Joint stability:' },
      { t: 'checks', cols: true, g: 'stabt', items: ['Anterior drawer', 'Posterior drawer', 'Lachman test', 'Varus stress test', 'Valgus stress test', 'Apprehension test', 'Sulcus sign'], label: 'Stability tests (+ve):' },
    ] },
    { title: 'ROM & Muscle Examination', role: 'exam', wide: true, f: [
      { t: 'cols', cols: [
        { f: [{ t: 'rom', k: 'rom.a', title: 'Active ROM (°)', rows: MOVES, noNormal: true }] },
        { f: [{ t: 'rom', k: 'rom.p', title: 'Passive ROM (°)', rows: MOVES, noNormal: true }] },
      ] },
      { t: 'checks', cols: true, g: 'romc', items: ['Pain at end range', 'Pain throughout movement', 'Stiffness', 'Mechanical restriction', 'Crepitus', 'Capsular pattern', 'Non-capsular pattern'], label: 'ROM characteristics:' },
      { t: 'pick', g: 'power', items: ['0/5', '1/5', '2/5', '3/5', '4/5', '5/5'], label: 'Muscle power grade:' },
      { t: 'pick', g: 'sidecmp', items: ['Equal power', 'Right weaker', 'Left weaker', 'Bilateral weakness'], label: 'Side comparison:' },
      { t: 'checks', cols: true, g: 'tone', items: ['Normal', 'Increased', 'Decreased', 'Muscle spasm', 'Muscle wasting'], label: 'Muscle tone:', none: 'Normal' },
    ] },
    { title: 'Pain Assessment', role: 'exam', wide: true, f: [
      { t: 'pick', g: 'vas', items: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], label: 'Pain score (VAS 0–10):' },
      { t: 'pick', g: 'sev', items: ['0 (No pain)', '1–3 (Mild)', '4–6 (Moderate)', '7–10 (Severe)'], label: 'Pain severity:' },
      { t: 'checks', cols: true, g: 'char', items: ['Sharp', 'Dull', 'Aching', 'Burning', 'Shooting', 'Throbbing', 'Numbness / Tingling'], label: 'Pain character:' },
      { t: 'checks', cols: true, g: 'pattern', items: ['Constant', 'Intermittent', 'Activity-related', 'Night pain', 'Rest pain'], label: 'Pain pattern:' },
    ] },
    { title: 'Clinical Impression', role: 'dx', wide: true, f: [
      { t: 'checks', cols: true, g: 'find', items: ['Findings suggestive of ligament injury', 'Findings suggestive of tendon injury', 'Findings suggestive of nerve compression', 'Findings suggestive of radiculopathy', 'Findings suggestive of joint degeneration', 'Findings suggestive of fracture', 'Findings suggestive of instability'], label: 'Clinical findings:' },
      { t: 'text', k: 'pdx', label: 'Provisional diagnosis:', stack: true },
      { t: 'text', k: 'ddx', label: 'Differential diagnosis:', stack: true },
      { t: 'notes', k: 'notes' },
    ] },
  ],
};
export const quickFilled = (s: ExamSheet) => s.on.some((o) => o.startsWith('qe.')) || Object.entries(s.txt).some(([k, v]) => k.startsWith('qe.') && v.trim());
// أي مربع كله اختيارات (مفيش فيه خانة كتابة) بيتضافله «ملاحظات» في آخره (طلب ٨/١١) — المفتاح ثابت من عنوان المربع
// كل مربع (طلب ٨/١١) ما عدا مربع Notes نفسه أو اللي فيه خانة ملاحظات أصلًا
export const boxNeedsNotes = (b: BoxDef) => b.role !== 'notes' && !b.f.some((f) => f.t === 'notes');
export const boxNotesKey = (b: BoxDef) => 'bn.' + b.title.replace(/[^A-Za-z0-9؀-ۿ]+/g, '_').replace(/^_|_$/g, '');
export const regionSheet = (id: SheetId) => REGION_SHEETS.find((d) => d.id === id);

// كل شيت بالترتيب اللي بيظهر بيه + اسمه في تبويب الطبيب
// التروما مش هنا: بقى جزء من الشيت العام (بيظهر لما «هل توجد إصابة حديثة؟» = نعم)
export const SHEET_ORDER: SheetId[] = ['hipknee', 'ankle', 'neckshoulder', 'hand', 'lumbar', 'peds', 'cast', 'postop'];
// اسم الشيت قدام الطبيب: «كشف …» (ما عدا الشيتات اللي مش مناطق جسم)
const NOT_REGION: SheetId[] = ['cast', 'postop', 'peds', 'trauma'];
export const SHEET_TAB: Record<SheetId, string> = { hipknee: 'كشف الورك والركبة', ...Object.fromEntries(REGION_SHEETS.map((d) => [d.id, NOT_REGION.includes(d.id as SheetId) ? d.tab : `كشف ${d.tab}`])) } as Record<SheetId, string>;
const PREFIX: Record<SheetId, string> = { hipknee: 'x', ...Object.fromEntries(REGION_SHEETS.map((d) => [d.id, d.prefix])) } as Record<SheetId, string>;
// التروما وتقييم الروماتويد (ra) جوّه الشيت العام — مش شيت الطبيب
export const DOCTOR_PREFIXES = Object.values(PREFIX).filter((p) => p !== 'tr');

// منطقة جسم الإنسان (bodyRegions) ← الشيت بتاعها. الظاهر على الجسم: المناطق اللي ليها شيت بس (MAP_REGION_IDS)؛
// المناطق المخفية متسابة هنا عشان أماكن ألم قديمة لو اتسجلت تفتح الشيت الأقرب
const REGION_SHEET: Record<string, SheetId> = {
  hip: 'hipknee', femur: 'hipknee', knee: 'hipknee',
  leg: 'ankle', ankle_foot: 'ankle',
  cervical: 'neckshoulder', shoulder: 'neckshoulder', clavicle: 'neckshoulder', scapula: 'neckshoulder', humerus: 'neckshoulder',
  elbow: 'hand', forearm: 'hand', wrist_hand: 'hand',
  thoracic: 'lumbar', lumbar: 'lumbar', sacrum: 'lumbar',
};

/** الشيت اللي بيفتحه مكان ألم («knee:right») */
export const sheetForPain = (painKey: string): SheetId | undefined => REGION_SHEET[painKey.split(':')[0]];
/** إلغاء منطقة: شيلها من أماكن الألم + اللي اتضاف بإيد الطبيب + كل اللي اتكتب في شيتها */
export function removeSheet(s: ExamSheet, id: SheetId): ExamSheet {
  const p = PREFIX[id] + '.';
  return {
    ...s,
    pain: s.pain.filter((k) => sheetForPain(k) !== id),
    on: s.on.filter((o) => o !== `sheets|${id}` && !o.startsWith(p)),
    txt: Object.fromEntries(Object.entries(s.txt).filter(([k]) => !k.startsWith(p))),
  };
}

/** فيه حاجة متكتبة في شيت المنطقة دي */
export function sheetFilled(s: ExamSheet, id: SheetId): boolean {
  const p = PREFIX[id] + '.';
  return s.on.some((o) => o.startsWith(p)) || Object.entries(s.txt).some(([k, v]) => k.startsWith(p) && v.trim());
}
/** الشيتات اللي بتظهر للطبيب: من أماكن الألم في الشيت العام + أي شيت اتكتب فيه + اللي الطبيب ضافه بنفسه («sheets|...») */
export function activeSheets(s: ExamSheet): SheetId[] {
  const set = new Set<SheetId>();
  for (const k of s.pain) { const id = REGION_SHEET[k.split(':')[0]]; if (id) set.add(id); }
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
  // labeled = بعنوان البند (للتاريخ المرضي والفحص)؛ من غيره المحتوى بس (للشكوى والتشخيص)
  const field = (f: Field, labeled = true): string => {
    switch (f.t) {
      case 'checks': { const v = join(f.items.filter((i) => has(f.g, i))); return v && (labeled && f.label ? `${f.label} ${v}` : v); }
      case 'pick': { const v = f.items.find((i) => has(f.g, i)); return v ? (labeled ? `${f.label} ${v}` : v) : ''; }
      case 'text': return tx(f.k) && (labeled && !/^\d\.$/.test(f.label) ? `${f.label} ${tx(f.k)}` : tx(f.k));
      case 'side': return labeled && SIDE_EN[side] ? `Side: ${SIDE_EN[side]}` : '';
      case 'cols': return join(f.cols.map((c) => { const v = join(c.f.map((x) => field(x, labeled)), labeled ? ' · ' : ', '); return v && (c.title && !c.title.endsWith(':') ? `${c.title}: ${v}` : v); }), ' · ');
      case 'rom': return join(f.rows.map(([m]) => { const v = rtLt(`${f.k}.${m}`, '°'); return v && `${m} ${v}`; }));
      case 'grade': return join(f.rows.map(([r]) => { const v = rtLt(`${f.k}.${r}`, f.opts === 'mrc' ? '/5' : ''); return v && `${r} ${v}`; }));
      case 'ticks': { const v = join(f.rows.flatMap(([r]) => ['Rt', 'Lt'].filter((sd) => has(f.g, `${r} ${sd}`)).map((sd) => `${r} ${sd}`))); return v && `${f.title}: ${v}`; }
      case 'imaging': return join([...f.mods.filter((m) => has(f.k, m) || tx(`${f.k}.${m}`)).map((m) => join([`${m}:`, tx(`${f.k}.${m}`), tx(`${f.k}.${m}.date`) && `(${tx(`${f.k}.${m}.date`)})`], ' ')), tx(`${f.k}.prev`) && `Previous: ${tx(`${f.k}.prev`)}`, tx(`${f.k}.other`)], '; ');
      case 'notes': return tx(f.k);
      case 'slot': return '';
      case 'dxsheet': return dxSummary(def.prefix, f.id, (g, i) => s.on.includes(`${g}|${i}`), (k) => (s.txt[k] ?? '').trim());
      default: return '';
    }
  };
  const boxText = (b: BoxDef, labeled = true) => join(b.f.map((f) => field(f, labeled)), labeled ? ' · ' : ', ');
  const by = (role: BoxRole) => def.boxes.filter((b) => b.role === role);
  const titled = (bs: BoxDef[]) => bs.map((b) => { const t = boxText(b); return t && `${b.title.replace('⚠ ', '')} — ${t}`; }).filter(Boolean) as string[];
  return {
    complaint: join(by('cc').map((b) => boxText(b, false))),
    diagnosis: join(by('dx').map((b) => boxText(b, false)), ' · '),
    history: titled([...by('hx'), ...by('rf')]),
    examination: [...titled(by('exam')), ...by('notes').map((b) => boxText(b)).filter(Boolean)],
    plan: join(by('plan').map((b) => boxText(b, false))),
  };
}
