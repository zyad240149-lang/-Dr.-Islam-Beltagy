// شيتات كشف الطبيب حسب المنطقة — نفس الورق اللي بعتته العيادة بالظبط (نفس الخانات والترقيم والبنود):
// الورك/الركبة ← «الورك والركبة» (الشيت الأصلي — ExamSheet.tsx، مفاتيح x.*)، الكاحل والقدم ← «Ankle & Foot»،
// الرقبة/الكتف ← «Cervical Spine & Shoulder»، الكوع/الرسغ/اليد ← «Elbow, Wrist & Hand»، أسفل الظهر/العجز ← «Lumbar & Sacral Spine».
// الشيت اللي بيتفتح للطبيب بيتحدد من مكان الألم في شيت التمريض (خانة 5 — جسم الإنسان).
// كل شيت ليه بادئة مفاتيح خاصة بيه (af./cs./eh./ls.) عشان أكتر من منطقة في نفس الكشف ما يتلخبطوش.
import type { ExamSheet, Side } from './data';

export type SheetId = 'hipknee' | 'ankle' | 'neckshoulder' | 'hand' | 'lumbar';
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
  | { t: 'notes'; k: string };
export type BoxRole = 'cc' | 'hx' | 'rf' | 'exam' | 'dx' | 'plan' | 'notes';
export interface BoxDef { title: string; role: BoxRole; tone?: 'red'; wide?: boolean; f: Field[] }
export interface RegionSheetDef { id: Exclude<SheetId, 'hipknee'>; prefix: string; tab: string; title: string; boxes: BoxDef[] }

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
      { title: 'Diagnosis (Likely / Working)', role: 'dx', f: [{ t: 'cols', cols: [
        col('Ankle', 'dx.ankle', ['Ankle sprain (ATFL / CFL)', 'Chronic ankle instability', 'Osteoarthritis', 'Osteochondral lesion (OCD)', 'Impingement syndrome', 'Achilles tendinopathy / rupture', 'Peroneal tendinopathy', 'Deltoid ligament injury', 'High ankle sprain (syndesmosis)']),
        col('Foot', 'dx.foot', ['Plantar fasciitis', 'Metatarsalgia', 'Morton neuroma', 'Hallux valgus', 'Hallux rigidus', 'Lisfranc injury', 'Stress fracture', 'Diabetic foot / ulcer', 'Claw / hammer toes']),
      ] }, { t: 'dxmap' }] },
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
      { title: 'Diagnosis (Likely / Working)', role: 'dx', f: [{ t: 'cols', cols: [
        col('Cervical Spine', 'dx.cx', ['Cervical spondylosis', 'Disc prolapse', 'Cervical radiculopathy', 'Cervical myelopathy', 'Facet joint syndrome', 'Whiplash injury', 'Cervicogenic headache', 'Muscle spasm']),
        col('Shoulder', 'dx.sh', ['Rotator cuff tendinopathy / tear', 'Subacromial impingement', 'Frozen shoulder (adhesive capsulitis)', 'AC joint arthritis', 'Bicipital tendinopathy', 'Shoulder instability', 'Labral tear', 'Calcific tendinopathy', 'Proximal humerus fracture']),
      ] }, { t: 'dxmap' }] },
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
      { title: 'Diagnosis (Likely / Working)', role: 'dx', f: [{ t: 'checks', g: 'dx', cols: true, items: [
        'Lateral epicondylitis (tennis elbow)', "Medial epicondylitis (golfer's elbow)", 'Olecranon bursitis', 'Ulnar nerve entrapment', 'Radial head pathology', 'Carpal tunnel syndrome',
        'De Quervain tenosynovitis', 'TFCC injury', 'Scaphoid fracture', 'Trigger finger', 'CMC osteoarthritis (thumb)', 'Tendon injury / rupture', 'Ligament injury', 'Fracture / dislocation', 'Nerve injury',
      ] }, { t: 'text', k: 'dx.other', label: 'Others:' }, { t: 'dxmap' }] },
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
      { title: 'Dermatome Map (Lower Limb)', role: 'exam', f: [{ t: 'key', title: 'Dermatome', note: 'Sensation is recorded in box 8.', rows: [['L2', 'Anterior thigh', '#e57373'], ['L3', 'Medial knee', '#f6d55c'], ['L4', 'Medial leg / ankle', '#66bb6a'], ['L5', 'Dorsum of foot', '#4fc3f7'], ['S1', 'Lateral foot', '#9575cd']] }] },
      { title: 'Provisional Diagnosis / Assessment', role: 'dx', f: [
        { t: 'text', k: 'dx.1', label: '1.' }, { t: 'text', k: 'dx.2', label: '2.' }, { t: 'text', k: 'dx.3', label: '3.' }, { t: 'text', k: 'dx.4', label: '4.' }, { t: 'dxmap' },
      ] },
      { title: 'Plan / Management', role: 'plan', f: [{ t: 'checks', g: 'plan', items: ['Medication', 'Physiotherapy (McKenzie / Core)', 'Activity modification', 'Epidural / Nerve root injection', 'Facet / SI joint injection', 'Surgery (if indicated)', 'Follow-up', 'Lifestyle advice (posture / weight)'] }, { t: 'text', k: 'plan.other', label: 'Other:' }] },
      notes('Notes / Diagrams'),
    ],
  },
];
export const regionSheet = (id: SheetId) => REGION_SHEETS.find((d) => d.id === id);

// كل شيت بالترتيب اللي بيظهر بيه + اسمه في تبويب الطبيب
export const SHEET_ORDER: SheetId[] = ['hipknee', 'ankle', 'neckshoulder', 'hand', 'lumbar'];
export const SHEET_TAB: Record<SheetId, string> = { hipknee: 'الورك والركبة', ...Object.fromEntries(REGION_SHEETS.map((d) => [d.id, d.tab])) } as Record<SheetId, string>;
const PREFIX: Record<SheetId, string> = { hipknee: 'x', ...Object.fromEntries(REGION_SHEETS.map((d) => [d.id, d.prefix])) } as Record<SheetId, string>;
export const DOCTOR_PREFIXES = Object.values(PREFIX);

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
/** الشيتات اللي بتظهر للطبيب: من أماكن الألم في شيت التمريض + أي شيت اتكتب فيه + اللي الطبيب ضافه بنفسه («sheets|...») */
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
