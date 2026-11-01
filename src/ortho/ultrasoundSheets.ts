// تقارير السونار (MSK Ultrasound Report) — نفس ورق العيادة: Wrist & Hand · Knee & Leg · Ankle & Foot · Hip & Thigh.
// كل تقرير ليه بادئة مفاتيح خاصة (usw./usk./usa./ush.) جوّه شيت الكشف نفسه، فبيتحفظ مع التشخيص.
import type { ExamSheet } from './data';
import type { BoxDef, Field, RegionSheetDef } from './regionSheets';

const NA = ['Normal', 'Abnormal'];
// صف في جدول (Structure | Finding | Comment): اختيار واحد + تعليق
const row = (g: string, label: string, items = NA): Field[] => [{ t: 'pick', g, items, label }, { t: 'text', k: `${g}.c`, label: 'Comment:' }];
const table = (title: string, rows: [g: string, label: string, items?: string[]][]): BoxDef => ({ title, role: 'exam', f: rows.flatMap(([g, l, i]) => row(g, l, i)) });
const head = (areas: string[]): BoxDef => ({ title: 'Indication / Area Examined', role: 'exam', f: [
  { t: 'text', k: 'ind', label: 'Indication:' }, { t: 'side' },
  { t: 'checks', g: 'area', items: areas, label: 'Area examined:' }, { t: 'text', k: 'area.other', label: 'Others:' },
] });
const pathos = (items: string[]): BoxDef => ({ title: 'Key Pathologies Checklist', role: 'dx', f: [{ t: 'checks', g: 'path', items }, { t: 'text', k: 'path.other', label: 'Others:' }] });
const tail: BoxDef[] = [
  { title: 'Main Findings', role: 'exam', wide: true, f: [{ t: 'notes', k: 'main' }] },
  { title: 'Impression', role: 'dx', wide: true, f: [{ t: 'notes', k: 'imp' }] },
];
const def = (id: string, prefix: string, tab: string, title: string, boxes: BoxDef[]) => ({ id, prefix, tab, title, boxes: [...boxes, ...tail] }) as unknown as RegionSheetDef;

export const US_SHEETS: RegionSheetDef[] = [
  def('us_wrist', 'usw', 'الرسغ واليد', 'MSK Ultrasound Report – Wrist &amp; Hand', [
    head(['Wrist (Dorsal)', 'Wrist (Volar)', 'Carpal Tunnel', 'Tendons (Flexor/Extensor)', 'First Dorsal Compartment', 'TFCC / Ulnar Side', 'CMC (Thumb)', 'MCP / PIP / DIP Joints']),
    pathos(['Carpal Tunnel Syndrome (CTS)', 'De Quervain Tenosynovitis', 'Trigger Finger', 'Extensor Tenosynovitis', 'Flexor Tenosynovitis', 'TFCC Lesion', 'Ganglion Cyst', 'Scapholunate / Lunotriquetral Injury', 'CMC (Thumb) Osteoarthritis', 'UCL Injury (Thumb)']),
    table('Tendons', [['tn.flex', 'Flexor Tendons'], ['tn.ext', 'Extensor Tendons'], ['tn.apl', 'APL / EPB (1st Compartment)'], ['tn.oth', 'Others']]),
    { title: 'Nerve', role: 'exam', f: [
      { t: 'text', k: 'nv.median', label: 'Median Nerve (Carpal Tunnel) — CSA at pisiform level (mm²):' }, { t: 'text', k: 'nv.median.c', label: 'Comment:' },
      { t: 'text', k: 'nv.ulnar', label: "Ulnar Nerve (Guyon's Canal) — CSA (mm²):" }, { t: 'text', k: 'nv.ulnar.c', label: 'Comment:' },
    ] },
    table('Joints & Other Findings', [['jt.rc', 'Radiocarpal / Midcarpal'], ['jt.cmc', 'CMC (Thumb)'], ['jt.mcp', 'MCP / PIP / DIP'], ['jt.tfcc', 'TFCC / Ulnar Side'], ['jt.gang', 'Ganglion / Cyst'], ['jt.eff', 'Effusion / Synovitis']]),
  ]),
  def('us_knee', 'usk', 'الركبة والساق', 'MSK Ultrasound Report – Knee &amp; Leg', [
    head(['Knee Joint', 'Quadriceps / Patellar Tendon', 'Medial Compartment (MCL / Med. Meniscus)', 'Lateral Compartment (LCL / Lat. Meniscus)', 'Posterior Knee (Popliteal Fossa)', 'Leg (Calf)']),
    pathos(['Knee Joint Effusion / Synovitis', 'Meniscal Lesion (Medial / Lateral)', 'Ligament Injury (MCL / LCL / PCL)', 'Cruciate Ligament – ACL Injury', 'Tendinopathy (Quad / Patellar)', 'Pes Anserine Bursitis', "Baker's Cyst (Popliteal Cyst)", 'Calf Muscle Tear / Hematoma', 'DVT (If Indicated)']),
    { title: 'Knee Joint', role: 'exam', f: [
      ...row('kj.eff', 'Joint Effusion', ['Absent', 'Present']), { t: 'text', k: 'kj.eff.mm', label: 'Size (mm):' },
      ...row('kj.syn', 'Synovitis'), ...row('kj.cart', 'Cartilage (if assessed)', ['Normal', 'Thinned / Irregular']),
      { t: 'text', k: 'kj.other', label: 'Other Intra-articular Findings:' },
    ] },
    table('Menisci (US Findings)', [['mn.med', 'Medial Meniscus'], ['mn.lat', 'Lateral Meniscus']]),
    { title: 'Bursae & Related Structures', role: 'exam', f: [
      ...row('bu.pes', 'Pes Anserine Bursa'), ...row('bu.pat', 'Prepatellar / Infrapatellar Bursa'),
      ...row('bu.baker', "Baker's Cyst (Popliteal Cyst)", ['Absent', 'Present']), { t: 'text', k: 'bu.baker.mm', label: 'Size (mm):' },
      { t: 'text', k: 'bu.other', label: 'Other:' },
    ] },
    table('Tendons', [['tn.quad', 'Quadriceps Tendon'], ['tn.pat', 'Patellar Tendon'], ['tn.pes', 'Pes Anserine Tendons'], ['tn.oth', 'Other Tendons']]),
    table('Ligaments', [['lg.mcl', 'MCL (Medial Collateral)'], ['lg.lcl', 'LCL (Lateral Collateral)'], ['lg.pcl', 'PCL (Posterior Cruciate)'], ['lg.acl', 'ACL (Anterior Cruciate) *US']]),
    table('Leg (Calf)', [['lc.gs', 'Gastrocnemius / Soleus', ['Normal', 'Tear / Hematoma']], ['lc.ach', 'Achilles Tendon'], ['lc.dvt', 'Deep Veins (DVT – if indicated)', ['Compressible', 'Non-compressible']]]),
  ]),
  def('us_ankle', 'usa', 'الكاحل والقدم', 'MSK Ultrasound Report – Ankle &amp; Foot', [
    head(['Ankle (Anterior)', 'Ankle (Medial)', 'Ankle (Lateral)', 'Ankle (Posterior)', 'Foot (Dorsal)', 'Foot (Plantar)']),
    pathos(['Lateral Ankle Sprain (ATFL / CFL / PTFL)', 'Medial Ankle Injury (Deltoid Ligament)', 'Tendinopathy / Tear (Peroneal / Tibialis)', 'Achilles Tendinopathy / Tear', 'Plantar Fasciitis', 'Tarsal Tunnel Syndrome', 'Bursitis (Retrocalcaneal / Subcutaneous)', "Morton's Neuroma", 'Ligament / Capsular Injury (Foot)']),
    table('Ligaments (Ankle)', [['lg.atfl', 'ATFL (Anterior Talofibular)'], ['lg.cfl', 'CFL (Calcaneofibular)'], ['lg.ptfl', 'PTFL (Posterior Talofibular)'], ['lg.delt', 'Deltoid Ligament (Medial)']]),
    table('Tendons', [['tn.pl', 'Peroneus Longus'], ['tn.pb', 'Peroneus Brevis'], ['tn.tp', 'Tibialis Posterior'], ['tn.ta', 'Tibialis Anterior'], ['tn.fhl', 'Flexor Hallucis Longus (FHL)'], ['tn.fdl', 'Flexor Digitorum Longus (FDL)'], ['tn.ach', 'Achilles Tendon']]),
    table('Joints & Other Findings', [['jt.ank', 'Ankle Joint (Effusion / Synovitis)'], ['jt.sub', 'Subtalar Joint'], ['jt.tib', 'Tibiotalar Joint (Cartilage)'], ['jt.retro', 'Retrocalcaneal Bursa'], ['jt.subc', 'Subcutaneous Calcaneal Bursa'], ['jt.tt', 'Tarsal Tunnel (Tibial Nerve)'], ['jt.oth', 'Others']]),
    { title: 'Plantar Foot', role: 'exam', f: [
      ...row('pf.fascia', 'Plantar Fascia'), { t: 'text', k: 'pf.fascia.mm', label: 'Thickness (mm):' },
      ...row('pf.plate', 'Plantar Plate / Capsular'),
      ...row('pf.morton', "Morton's Neuroma", ['Absent', 'Present']), { t: 'text', k: 'pf.morton.mm', label: 'Size (mm):' },
    ] },
  ]),
  def('us_hip', 'ush', 'الورك والفخذ', 'MSK Ultrasound Report – Hip &amp; Thigh', [
    head(['Hip Joint (Anterior)', 'Hip Joint (Lateral)', 'Hip Joint (Posterior)', 'Peritrochanteric Region', 'Thigh (Anterior)', 'Thigh (Medial)', 'Thigh (Lateral)', 'Thigh (Posterior)']),
    pathos(['Hip Joint Effusion / Synovitis', 'Labral Abnormality (US Suggestion)', 'Iliopsoas Tendinopathy / Bursitis', 'Greater Trochanteric Pain Syndrome (GTPS)', 'Gluteal Tendon Tear (Min / Med)', 'Ischiofemoral Impingement', 'Hamstring Tendinopathy / Partial Tear', 'Rectus Femoris / Quadriceps Injury', 'Adductor Injury', 'Muscle Tear / Hematoma']),
    table('Tendons & Muscles', [['tm.ilio', 'Iliopsoas Tendon'], ['tm.gmed', 'Gluteus Medius Tendon'], ['tm.gmin', 'Gluteus Minimus Tendon'], ['tm.ham', 'Hamstring Tendons (Proximal)'], ['tm.rf', 'Rectus Femoris / Quadriceps'], ['tm.add', 'Adductor Group'], ['tm.oth', 'Others']]),
    table('Bursae', [['bu.troch', 'Trochanteric Bursa'], ['bu.ilio', 'Iliopsoas Bursa'], ['bu.isch', 'Ischial Bursa'], ['bu.oth', 'Others']]),
    { title: 'Hip Joint', role: 'exam', f: [
      ...row('hj.eff', 'Joint Effusion', ['Absent', 'Present']), { t: 'text', k: 'hj.eff.mm', label: 'Size (mm):' },
      ...row('hj.syn', 'Synovitis', ['Absent', 'Present']), { t: 'text', k: 'hj.other', label: 'Other Intra-articular Findings:' },
    ] },
    { title: 'Additional Findings', role: 'exam', f: [
      { t: 'pick', g: 'af.tear', items: ['Partial', 'Complete'], label: 'Muscle Tear:' }, { t: 'text', k: 'af.tear.loc', label: 'Location:' },
      { t: 'text', k: 'af.hem', label: 'Hematoma / Collection — Size:' }, { t: 'text', k: 'af.calc', label: 'Calcification / Enthesopathy:' }, { t: 'text', k: 'af.other', label: 'Others:' },
    ] },
  ]),
];

/** فيه حاجة متكتبة في تقرير السونار ده */
export const usFilled = (s: ExamSheet, d: RegionSheetDef) => {
  const p = d.prefix + '.';
  return s.on.some((o) => o.startsWith(p)) || Object.entries(s.txt).some(([k, v]) => k.startsWith(p) && v.trim());
};
