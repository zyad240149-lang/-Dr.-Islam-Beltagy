// شيتات التشخيص (Diagnosis Sheets) اللي بعتها د. اسلام لكل منطقة — نفس الأقسام المرقّمة والبنود بالظبط، وكل قسم ليه لون.
// كل شيت كشف ممكن يجمع أكتر من ورقة (الورك والركبة = Hip & Thigh + Knee ...). البند اللي تحته اختيارات فرعية = [البند, [الفرعي...]].
// التخزين: كل قسم مجموعة اختيارات `${prefix}.dxs.${part}.${n}` (الفرعي «البند — الفرعي»)، و«Others» نص `${g}.other`،
// والتشخيص النهائي: `${prefix}.fdx.primary` و `${prefix}.fdx.1..4` و `${prefix}.fdx.notes`.
import type { SheetId } from './regionSheets';

export type DxItem = string | [string, string[]];
export interface DxGroup { title: string; items: DxItem[] }
export interface DxPart { key: string; title: string; groups: DxGroup[] }
export type DxSheetId = Exclude<SheetId, 'cast' | 'postop'>;

const HIP: DxPart = { key: 'hip', title: 'HIP & THIGH — DIAGNOSIS SHEET', groups: [
  { title: 'Degenerative & Osteoarthritis', items: ['Primary hip osteoarthritis', 'Secondary osteoarthritis (post-traumatic / DDH / AVN / others)', 'Hip dysplasia (acetabular)',
    ['Femoroacetabular impingement (FAI)', ['Cam type', 'Pincer type', 'Mixed type']], 'Acetabular labral degeneration', 'Chondral lesion'] },
  { title: 'Traumatic Conditions', items: ['Femoral neck fracture', 'Intertrochanteric fracture', 'Subtrochanteric fracture', 'Femoral shaft fracture', 'Acetabular fracture', 'Hip dislocation',
    'Greater trochanter fracture', 'Pelvic ring injury', ['Muscle / tendon injury', ['Gluteus medius / minimus tear', 'Iliopsoas tendon injury', 'Hamstring avulsion (ischial)', 'Rectus femoris injury (AIIS)']]] },
  { title: 'Avascular & Metabolic Conditions', items: [['Avascular necrosis (AVN) of femoral head', ['Traumatic', 'Non-traumatic (steroid / alcohol / idiopathic)']],
    'Subchondral insufficiency fracture (SONK)', 'Transient osteoporosis of the hip', 'Osteonecrosis after DDH / Perthes', 'Metabolic bone disease'] },
  { title: 'Inflammatory & Rheumatologic', items: ['Rheumatoid arthritis (hip)', 'Psoriatic arthritis', 'Ankylosing spondylitis (hip)', 'Reactive arthritis', 'Septic arthritis (hip)', 'Tuberculous arthritis',
    'Crystal arthropathy (gout / CPPD)', 'Inflammatory myositis'] },
  { title: 'Soft Tissue & Tendon Disorders', items: [['Greater trochanteric pain syndrome', ['Gluteus medius tendinopathy', 'Gluteus minimus tendinopathy', 'Trochanteric bursitis', 'External snapping hip (ITB)']],
    ['Iliopsoas tendinopathy / bursitis', ['Internal snapping hip', 'Iliopsoas impingement']], 'Proximal hamstring tendinopathy', 'Adductor tendinopathy', 'Rectus femoris injury (AIIS)', 'Piriformis syndrome'] },
  { title: 'Thigh Muscle Disorders', items: [['Muscle strain', ['Quadriceps', 'Hamstring', 'Adductor', 'Sartorius', 'Others']], 'Myositis / inflammatory myopathy', 'Chronic exertional compartment syndrome',
    'Heterotopic ossification', 'Myositis ossificans', 'Deep muscle hematoma', 'Femoral nerve palsy (quadriceps weakness)'] },
  { title: 'Other Conditions', items: ['Developmental dysplasia of the hip (DDH)', 'Slipped capital femoral epiphysis (SCFE)', 'Legg-Calvé-Perthes disease', 'Femoral torsional deformity (ante/retroversion)',
    'Hip instability', 'Pigmented villonodular synovitis (PVNS)', 'Synovial chondromatosis', 'Tumor (benign / malignant)', 'Referred pain (lumbar spine / SI joint)', 'Vascular conditions (e.g. DVT, AVM)',
    'Neuropathic pain (e.g. meralgia paresthetica)'] },
] };

const KNEE: DxPart = { key: 'knee', title: 'KNEE — DIAGNOSIS SHEET', groups: [
  { title: 'Osteoarthritis', items: ['Medial compartment OA', 'Lateral compartment OA', 'Patellofemoral OA', 'Tricompartmental OA'] },
  { title: 'Meniscal Disorders', items: ['Medial meniscus injury', 'Lateral meniscus injury', 'Degenerative meniscus', 'Meniscal root tear'] },
  { title: 'Ligament Injuries', items: ['ACL injury', 'PCL injury', 'MCL injury', 'LCL / PLC injury', 'Multiligament injury'] },
  { title: 'Patellofemoral Disorders', items: ['Patellofemoral pain', 'Patellar instability / dislocation', 'Patellar maltracking', 'Chondromalacia patella'] },
  { title: 'Tendon Disorders', items: ['Patellar tendinopathy', 'Quadriceps tendinopathy', 'Patellar tendon tear', 'Quadriceps tendon tear'] },
  { title: 'Bursitis & Periarticular', items: ['Prepatellar bursitis', 'Pes anserine bursitis', 'Infrapatellar bursitis', 'ITB syndrome', 'Hoffa fat pad syndrome', "Baker's cyst"] },
  { title: 'Cartilage / Osteochondral', items: ['Chondral injury', 'Osteochondritis dissecans', 'Osteochondral defect'] },
  { title: 'Fractures', items: ['Patellar fracture', 'Tibial plateau fracture', 'Distal femur fracture', 'Tibial spine avulsion'] },
  { title: 'Inflammatory Arthritis', items: ['Rheumatoid arthritis', 'Gout / CPPD', 'Reactive arthritis', 'Other inflammatory arthritis'] },
  { title: 'Infection', items: ['Septic arthritis', 'Septic bursitis', 'Osteomyelitis'] },
  { title: 'Synovial Disorders', items: ['Synovitis', 'PVNS / TGCT', 'Synovial chondromatosis', 'Lipoma arborescens'] },
  { title: 'Pediatric Knee', items: ['Osgood-Schlatter disease', 'Sinding-Larsen-Johansson', 'Discoid meniscus', 'Juvenile OCD'] },
  { title: 'Deformity / Alignment', items: ['Genu varum', 'Genu valgum', 'Patella alta / baja'] },
  { title: 'Postoperative / TKA', items: ['Failed ACL reconstruction', 'Arthrofibrosis', 'Painful TKA', 'TKA instability / loosening', 'Postoperative infection'] },
  { title: 'Other', items: ['Referred pain', 'Neuropathic pain', 'Tumor / tumor-like lesion', 'Other / undiagnosed'] },
] };

const ANKLE: DxPart = { key: 'ankle', title: 'LEG — ANKLE & FOOT — DIAGNOSIS SHEET', groups: [
  { title: 'Fractures & Traumatic Conditions', items: ['Tibia fracture (shaft / proximal / distal)', 'Fibula fracture (shaft / proximal / distal)', 'Bimalleolar fracture', 'Trimalleolar fracture',
    'Pilon fracture', 'Talus fracture', 'Calcaneus fracture', 'Navicular fracture', 'Cuboid fracture', 'Metatarsal fracture (1st – 5th)', 'Phalangeal fracture (toe)', 'Lisfranc injury (tarsometatarsal)',
    'Syndesmotic injury (high ankle sprain)', 'Achilles tendon rupture (acute / chronic)', 'Tendon / ligament injury'] },
  { title: 'Osteoarthritis & Degenerative Conditions', items: ['Ankle osteoarthritis (primary)', 'Post-traumatic osteoarthritis', 'Osteochondral lesion (talus)', 'Avascular necrosis (talus)',
    'Subtalar osteoarthritis', 'Midfoot osteoarthritis', '1st MTP osteoarthritis (hallux rigidus)', 'Advanced degenerative changes', 'Cartilage degeneration',
    'Impingement syndrome (anterior / posterior)', 'Degenerative flatfoot (adult acquired)'] },
  { title: 'Tendinopathies & Soft Tissue Disorders', items: ['Achilles tendinopathy (insertional / non-insertional)', ['Peroneal tendinopathy', ['Peroneus longus', 'Peroneus brevis']],
    'Tibialis posterior tendinopathy', 'Tibialis anterior tendinopathy', 'Flexor hallucis longus tendinopathy', 'Flexor digitorum longus tendinopathy', 'Extensor tendinopathy (e.g. EHL)',
    'Plantar fasciitis', 'Fat pad syndrome (heel)', 'Bursitis (retrocalcaneal / sub-Achilles)', 'Interstitial bursitis', "Morton's neuroma"] },
  { title: 'Ligamentous & Stability Disorders', items: [['Lateral ankle ligaments (lateral ankle sprain)', ['Anterior talofibular ligament (ATFL)', 'Calcaneofibular ligament (CFL)', 'Posterior talofibular ligament (PTFL)']],
    ['Medial ankle ligaments (deltoid ligament)', ['Superficial deltoid ligament', 'Deep deltoid ligament']], 'Syndesmotic injury (high ankle sprain)', 'Chronic ankle instability',
    'Subtalar instability', 'Midfoot instability (Lisfranc)', 'Generalized ligamentous laxity'] },
  { title: 'Nerve Disorders', items: [['Tarsal tunnel syndrome', ['Tibial nerve (posterior tibial nerve)', 'Medial plantar nerve', 'Lateral plantar nerve']], 'Common peroneal nerve palsy',
    'Superficial peroneal nerve entrapment', 'Deep peroneal nerve entrapment', 'Sural nerve neuropathy', 'Medial calcaneal nerve entrapment', "Baxter's nerve entrapment",
    'Tibial nerve entrapment (proximal)', 'CRPS (Complex Regional Pain Syndrome)'] },
  { title: 'Inflammatory, Infective & Metabolic Conditions', items: ['Rheumatoid arthritis', 'Psoriatic arthritis', 'Gout (acute / chronic)', 'Septic arthritis (ankle / subtalar / MTP)', 'Osteomyelitis',
    'Tuberculosis (TB)', 'Inflammatory enthesitis', 'Vasculitis-related lesions', 'Diabetic foot (ulcer / infection / Charcot)', 'Cellulitis / abscess', 'Crystal arthropathy (CPPD)'] },
  { title: 'Foot Specific Conditions', items: ['Plantar fasciitis', 'Heel spur (calcaneal spur)', 'Fat pad atrophy (heel)', 'Stress fracture (calcaneus / metatarsal)', 'Tarsal coalition',
    'Navicular accessory bone (os tibiale externum)', 'Hallux valgus (bunion)', 'Hallux rigidus', 'Hammer toe / claw toe', 'Pes planus (flat foot)', 'Pes cavus (high arch)', 'Metatarsalgia', "Morton's neuroma"] },
] };

const CERVICAL: DxPart = { key: 'cervical', title: 'CERVICAL SPINE — DIAGNOSIS SHEET', groups: [
  { title: 'Degenerative Disorders', items: ['Cervical spondylosis', 'Cervical disc degeneration', 'Cervical disc prolapse / herniation', 'Cervical spinal canal stenosis', 'Cervical foraminal stenosis',
    'Cervical osteophytes', 'Cervical kyphosis', 'Cervical disc space narrowing', 'Mixed degenerative changes'] },
  { title: 'Pain Disorders', items: ['Mechanical neck pain', 'Cervical muscle spasm', 'Myofascial pain syndrome', 'Cervical facet joint syndrome', 'Cervicogenic headache', 'Upper trapezius myalgia',
    'Postural neck pain', 'Referred shoulder pain'] },
  { title: 'Neurological Disorders', items: ['Cervical radiculopathy', 'Cervical myelopathy', 'Cervical radiculomyelopathy', 'Cervical nerve root compression (specify level)', 'Cervical spinal cord compression',
    'Upper motor neuron signs', 'Lower motor neuron involvement'] },
  { title: 'Traumatic Disorders', items: ['Cervical sprain / strain', 'Whiplash injury', 'Cervical fracture (specify level)', 'Cervical dislocation / subluxation', 'Cervical ligament injury',
    'Post-traumatic cervical instability', 'Post-traumatic spondylosis'] },
  { title: 'Other Disorders', items: ['Cervical spondylolisthesis', 'Cervical instability', 'Congenital cervical deformity (e.g. fusion, Klippel-Feil)', 'Inflammatory cervical disease (e.g. RA, ankylosing spondylitis)',
    'Infective spondylitis (e.g. TB, pyogenic)', 'Neoplastic lesion (primary / secondary)', 'Metabolic bone disease'] },
  { title: 'Associated / Concomitant Diagnoses', items: ['Shoulder disorder (specify)', 'Thoracic outlet syndrome', 'Peripheral neuropathy', 'Carpal tunnel syndrome', 'Rotator cuff pathology'] },
] };

const SHOULDER: DxPart = { key: 'shoulder', title: 'SHOULDER — DIAGNOSIS SHEET', groups: [
  { title: 'Rotator Cuff Disorders', items: ['Rotator cuff tendinopathy', 'Partial-thickness tear', 'Full-thickness tear', 'Massive / irreparable cuff tear', 'Subscapularis tear', 'Calcific tendinitis'] },
  { title: 'Subacromial Disorders', items: ['Subacromial pain syndrome', 'Subacromial bursitis', 'External impingement', 'Internal impingement'] },
  { title: 'Biceps / Labral Disorders', items: ['Long head of biceps tendinopathy', 'Biceps tendon subluxation / dislocation', 'SLAP lesion', 'Bankart lesion', 'Other labral tear'] },
  { title: 'Glenohumeral Joint', items: ['Glenohumeral osteoarthritis', 'Adhesive capsulitis (frozen shoulder)', 'Glenohumeral instability', 'Recurrent shoulder dislocation', 'Posterior shoulder instability', 'Chondral defect'] },
  { title: 'AC Joint Disorders', items: ['AC joint osteoarthritis', 'AC joint sprain / separation', 'Distal clavicle osteolysis'] },
  { title: 'Fractures / Trauma', items: ['Proximal humerus fracture', 'Clavicle fracture', 'Scapular fracture', 'Greater tuberosity fracture', 'Shoulder dislocation', 'Post-traumatic stiffness'] },
  { title: 'Tendon / Muscle Other', items: ['Deltoid injury', 'Pectoralis major injury', 'Teres minor injury', 'Muscle strain / tear'] },
  { title: 'Inflammatory / Infective', items: ['Rheumatoid arthritis', 'Inflammatory arthritis', 'Septic arthritis', 'Septic bursitis', 'Osteomyelitis'] },
  { title: 'Nerve / Referred Pain', items: ['Cervical radiculopathy', 'Suprascapular neuropathy', 'Axillary nerve injury', 'Brachial plexopathy', 'Parsonage-Turner syndrome', 'Referred pain'] },
  { title: 'Pediatric / Developmental', items: ['Proximal humeral physeal injury', 'Little League shoulder', 'Developmental / congenital deformity'] },
  { title: 'Postoperative / Arthroplasty', items: ['Failed rotator cuff repair', 'Re-tear after repair', 'Stiffness after surgery', 'Painful shoulder arthroplasty', 'Prosthetic loosening / instability', 'Periprosthetic infection'] },
  { title: 'Other', items: ['Scapular dyskinesis', 'Thoracic outlet syndrome', 'Tumor / tumor-like lesion', 'Other / undiagnosed'] },
] };

const ELBOW: DxPart = { key: 'elbow', title: 'ELBOW — DIAGNOSIS SHEET', groups: [
  { title: 'Traumatic Conditions', items: ['Supracondylar fracture (humerus)', 'Lateral condyle fracture', 'Medial epicondyle fracture', 'Radial head fracture', 'Coronoid process fracture', 'Olecranon fracture',
    'Elbow dislocation', 'Terrible triad injury', 'Monteggia fracture dislocation', 'Essex-Lopresti injury', 'Ligament injury (MCL / LCL)'] },
  { title: 'Tendinopathies & Overuse Injuries', items: ['Lateral epicondylitis (Tennis elbow)', "Medial epicondylitis (Golfer's elbow)", 'Triceps tendinopathy', 'Biceps tendinopathy (distal)',
    'Common extensor tendon origin tendinopathy', 'Common flexor tendon origin tendinopathy', 'Insertional tendinopathy'] },
  { title: 'Degenerative & Osteoarthritis', items: ['Primary elbow osteoarthritis', 'Post-traumatic osteoarthritis', 'Osteochondral lesion', 'Osteochondritis dissecans (OCD)', 'Loose body', 'Degenerative changes',
    'Stiff elbow (arthrofibrosis)'] },
  { title: 'Nerve Disorders', items: ['Cubital tunnel syndrome (Ulnar nerve)', 'Radial tunnel syndrome (Radial nerve)', 'Posterior interosseous nerve (PIN) syndrome', 'Median nerve compression (Pronator syndrome)',
    'Nerve injury (specify)'] },
  { title: 'Inflammatory & Rheumatologic', items: ['Rheumatoid arthritis', 'Psoriatic arthritis', 'Crystal arthropathy (Gout)', 'Septic arthritis', 'Reactive arthritis', 'Inflammatory enthesitis'] },
  { title: 'Other Conditions', items: ['Elbow instability (chronic)', 'Heterotopic ossification', 'Synovitis', 'Pigmented villonodular synovitis (PVNS)', 'Osteochondromatosis', 'Elbow bursitis (Olecranon bursitis)',
    'Neuropathic elbow pain', 'Referred pain (cervical / shoulder)'] },
] };

const WRIST: DxPart = { key: 'wrist', title: 'WRIST & HAND — DIAGNOSIS SHEET', groups: [
  { title: 'Traumatic Conditions', items: ['Distal radius fracture', 'Distal ulna fracture', 'Scaphoid fracture', 'Other carpal bone fracture (specify)', 'Metacarpal fracture (specify)', 'Phalangeal fracture (specify)',
    'Dislocation (wrist / CMC / MCP / IP)', 'Ligament injury (e.g. scapholunate)', 'Triangular fibrocartilage complex (TFCC) injury', 'Mallet finger', 'Jersey finger (FDP avulsion)', "Boxer's fracture"] },
  { title: 'Degenerative & Overuse Conditions', items: ['Wrist osteoarthritis (radiocarpal)', 'Scaphotrapeziotrapezoid (STT) arthritis', 'First carpometacarpal (CMC) osteoarthritis (thumb base OA)',
    'Scapholunate advanced collapse (SLAC)', "Kienböck's disease", 'Ulnar impaction syndrome', 'Degenerative TFCC tear', 'Intersection syndrome', 'Wrist tendinopathy (extensors)',
    'Hand osteoarthritis (MCP / PIP / DIP)', "Heberden's nodes (DIP OA)", "Bouchard's nodes (PIP OA)", "Dupuytren's disease", 'Trigger finger (stenosing tenosynovitis)'] },
  { title: 'Tendinopathies & Soft Tissue Disorders', items: ["De Quervain's tenosynovitis", 'Flexor tendinopathy (FDS / FDP)', 'Extensor tendinopathy (e.g. ECU, ECRL/ECRB)', 'Intersection syndrome',
    'Trigger finger (thumb / index / middle / ring / little)', 'Flexor tenosynovitis (infective / non-infective)', 'Extensor tenosynovitis', 'Ganglion cyst (dorsal / volar)', 'Retinacular cyst', 'Volar plate injury'] },
  { title: 'Nerve Disorders', items: ['Carpal tunnel syndrome (median nerve)', 'Cubital tunnel syndrome (ulnar nerve)', "Guyon's canal syndrome (ulnar nerve at wrist)", 'Radial tunnel syndrome',
    'Anterior interosseous nerve syndrome (AIN)', 'Posterior interosseous nerve syndrome (PIN)', 'Digital nerve injury', 'Neuropathic pain (CRPS)'] },
  { title: 'Inflammatory & Rheumatologic Conditions', items: ['Rheumatoid arthritis (wrist / hand)', 'Psoriatic arthritis (dactylitis)', 'Gout (tophaceous gout)', 'Crystal arthropathy (CPPD)',
    'Septic arthritis (wrist / hand)', 'Inflammatory tenosynovitis', 'Reactive arthritis', 'Vasculitis-related hand lesions'] },
  { title: 'Other Conditions', items: ['Lunotriquetral instability', 'Scapholunate instability', 'DRUJ instability', 'TFCC degeneration', 'Congenital anomalies (e.g. Madelung deformity)',
    'Infection (cellulitis / abscess / osteomyelitis)', 'Tumor / mass (benign / malignant)', "Vascular disorders (e.g. Raynaud's)", 'Post-operative complications', 'Scar adhesion / stiffness'] },
] };

const LUMBAR: DxPart = { key: 'lumbar', title: 'LUMBAR & SACRAL SPINE — DIAGNOSIS SHEET', groups: [
  { title: 'Disc and Degenerative Disorders', items: ['Lumbar disc degeneration', ['Lumbar disc prolapse / herniation', ['L1–2', 'L2–3', 'L3–4', 'L4–5', 'L5–S1']], 'Annular tear', 'High intensity zone (HIZ)',
    'Disc desiccation', 'Disc space narrowing', 'Modic changes (Type 1 / 2 / 3)', 'Lumbar spondylosis', 'Osteophytes', 'Degenerative scoliosis', 'Vacuum disc phenomenon'] },
  { title: 'Neurological Disorders', items: [['Lumbar radiculopathy', ['L1', 'L2', 'L3', 'L4', 'L5', 'S1']], 'Sciatica', 'Neurogenic claudication', 'Cauda equina syndrome', 'Conus medullaris syndrome',
    'Lumbar spinal canal stenosis', 'Lumbar foraminal stenosis', 'Lateral recess stenosis', ['Sacral radiculopathy', ['S1', 'S2', 'S3', 'S4', 'S5']], 'Peripheral neuropathy (mimic)'] },
  { title: 'Mechanical & Pain Syndromes', items: ['Mechanical low back pain', 'Facet joint syndrome (lumbar)', 'Sacroiliac joint dysfunction', 'Myofascial pain syndrome', 'Ligamentous strain (lumbar)',
    'Multifidus dysfunction', 'Postural / muscular imbalance', 'Chronic low back pain syndrome', 'Coccydynia', 'Referred hip pain', 'Referred sacroiliac pain'] },
  { title: 'Traumatic Conditions', items: [['Vertebral compression fracture', ['L1', 'L2', 'L3', 'L4', 'L5', 'S1']], 'Burst fracture', 'Chance fracture', 'Transverse process fracture', 'Spinous process fracture',
    'Facet fracture / dislocation', 'Spondylolisthesis (traumatic)', ['Sacral fracture', ['Zone 1', 'Zone 2', 'Zone 3']], 'Coccyx fracture', 'Ligament injury'] },
  { title: 'Spinal Deformity & Stability Disorders', items: [['Spondylolisthesis', ['Degenerative', 'Isthmic', 'Traumatic', 'Other']], 'Retrolisthesis', 'Scoliosis (degenerative)', 'Segmental instability',
    'Adjacent segment disease', 'Sagittal imbalance', 'Sacral dysplasia / transitional vertebra (e.g. LSTV)'] },
  // + بنود طلبها د. اسلام قبل كده (Discitis / Osteomyelitis / Myeloma)
  { title: 'Inflammatory, Infective & Other Conditions', items: ['Ankylosing spondylitis (axial SpA)', 'Axial spondyloarthritis', 'Rheumatoid arthritis', 'Psoriatic arthritis',
    'Diffuse idiopathic skeletal hyperostosis (DISH)', 'Infective spondylitis (e.g. TB, pyogenic)', 'Discitis', 'Vertebral osteomyelitis', 'Metastatic lesion', 'Primary spinal tumor', 'Multiple myeloma',
    'Osteoporosis', "Paget's disease", 'Sacral insufficiency fracture'] },
  { title: 'Referred Pain / Extra-spinal Causes', items: ['Hip osteoarthritis', 'Hip pathology', 'Piriformis syndrome', 'Renal pain', 'Abdominal aortic aneurysm', 'Pelvic / visceral referred pain'] },
] };

export const DX_SHEETS: Record<DxSheetId, DxPart[]> = {
  hipknee: [HIP, KNEE], ankle: [ANKLE], neckshoulder: [CERVICAL, SHOULDER], hand: [ELBOW, WRIST], lumbar: [LUMBAR],
};

export const dxGroupKey = (prefix: string, part: DxPart, n: number) => `${prefix}.dxs.${part.key}.${n + 1}`;
export const dxSub = (parent: string, sub: string) => `${parent} — ${sub}`;
export const FDX = ['primary', '1', '2', '3', '4'] as const;

/** المختار في شيت التشخيص كنص — التشخيص الأساسي الأول، ثم الإضافي، ثم بنود الأقسام (والفرعي جنب البند) و«Others» */
export function dxSummary(prefix: string, id: DxSheetId, has: (g: string, i: string) => boolean, tx: (k: string) => string): string {
  const out: string[] = [];
  const primary = tx(`${prefix}.fdx.primary`);
  if (primary) out.push(`Primary: ${primary}`);
  const extra = FDX.slice(1).map((n) => tx(`${prefix}.fdx.${n}`)).filter(Boolean);
  if (extra.length) out.push(`Additional: ${extra.join(', ')}`);
  for (const part of DX_SHEETS[id]) part.groups.forEach((gr, n) => {
    const g = dxGroupKey(prefix, part, n);
    const picked = gr.items.flatMap((it) => {
      if (typeof it === 'string') return has(g, it) ? [it] : [];
      const [parent, subs] = it;
      const s = subs.filter((x) => has(g, dxSub(parent, x)));
      return has(g, parent) || s.length ? [s.length ? `${parent} (${s.join(', ')})` : parent] : [];
    });
    const other = tx(`${g}.other`);
    if (other) picked.push(other);
    if (picked.length) out.push(picked.join(', '));
  });
  const notes = tx(`${prefix}.fdx.notes`);
  if (notes) out.push(notes);
  return out.join(' · ');
}
