// خريطة الهيكل العظمي — مناطق العظام والمفاصل (مطابقة للوحة التشريح في public/anatomy) وحالات جراحة العظام والكسور لكل منطقة

export interface Condition { id: string; name: string; en: string; icd10: string; tests: string; desc: string; services: string[] }
export interface BodyRegion { id: string; name: string; en: string; sided: boolean; conditions: Condition[] }

const c = (id: string, name: string, en: string, icd10: string, tests: string, desc: string): Condition => ({ id, name, en, icd10, tests, desc, services: [] });

export const BODY_REGIONS: BodyRegion[] = [
  { id: 'skull', name: 'الجمجمة والوجه', en: 'Skull & face', sided: false, conditions: [
    c('sk_vault_fx', 'كسر عظام الجمجمة', 'Skull vault fracture', 'S02.0', 'CT مخ، فحص عصبي GCS', 'كسر في العظم الجبهي أو الجداري أو الصدغي بعد إصابة مباشرة.'),
    c('sk_face_fx', 'كسر عظام الوجه', 'Facial bone fracture', 'S02.4', 'CT وجه، فحص تماثل الوجه', 'كسر في عظم الوجنة أو الفك العلوي مع تورم وتشوه.'),
    c('sk_mand_fx', 'كسر الفك السفلي', 'Mandible fracture', 'S02.6', 'Panorama X-Ray، إطباق الأسنان', 'ألم وعدم انتظام الإطباق بعد إصابة الفك.'),
    c('sk_tmj_disl', 'خلع المفصل الفكي', 'TMJ dislocation', 'S03.0', 'عدم القدرة على قفل الفم، أشعة', 'خروج لقمة الفك من مكانها مع فم مفتوح ثابت.'),
  ] },
  { id: 'cervical', name: 'الفقرات العنقية (C1–C7)', en: 'Cervical spine', sided: false, conditions: [
    c('cv_disc', 'انزلاق غضروفي عنقي', 'Cervical disc herniation', 'M50.1', 'Spurling، فحص عصبي للطرف العلوي، MRI', 'ألم بالرقبة ممتد للذراع مع تنميل أو ضعف.'),
    c('cv_spond', 'خشونة الفقرات العنقية', 'Cervical spondylosis', 'M47.8', 'أشعة عادية، مدى الحركة', 'تآكل وزوائد عظمية بالفقرات مع تيبس وألم مزمن.'),
    c('cv_stenosis', 'ضيق القناة العصبية العنقية', 'Cervical canal stenosis', 'M48.02', 'Hoffmann، Romberg، MRI', 'ضغط على الحبل الشوكي مع اضطراب المشي واليدين.'),
    c('cv_fx', 'كسر الفقرات العنقية', 'Cervical vertebra fracture', 'S12.9', 'Canadian C-spine rule، CT', 'كسر بالفقرات العنقية بعد حادث أو سقوط.'),
    c('cv_whiplash', 'إصابة الارتجاج العنقي', 'Whiplash injury', 'S13.4', 'مدى الحركة، أشعة', 'التواء أربطة الرقبة بعد الحركة المفاجئة للرأس.'),
  ] },
  { id: 'clavicle', name: 'الترقوة', en: 'Clavicle', sided: true, conditions: [
    c('cl_fx', 'كسر الترقوة', 'Clavicle fracture', 'S42.0', 'أشعة عادية، تشوه موضعي', 'كسر شائع بعد السقوط على الكتف.'),
    c('cl_ac', 'خلع المفصل الأخرمي الترقوي', 'AC joint dislocation', 'S43.1', 'Cross-body adduction، أشعة مقارنة', 'بروز طرف الترقوة أعلى الكتف بعد الإصابة.'),
    c('cl_sc', 'خلع المفصل القصي الترقوي', 'SC joint dislocation', 'S43.2', 'CT صدر', 'إصابة نادرة عند اتصال الترقوة بعظمة القص.'),
  ] },
  { id: 'scapula', name: 'لوح الكتف', en: 'Scapula', sided: true, conditions: [
    c('sc_fx', 'كسر لوح الكتف', 'Scapula fracture', 'S42.1', 'أشعة، CT', 'كسر بعد إصابة شديدة في الظهر العلوي.'),
  ] },
  { id: 'shoulder', name: 'مفصل الكتف', en: 'Shoulder joint', sided: true, conditions: [
    c('sh_disl', 'خلع الكتف', 'Shoulder dislocation', 'S43.0', 'Apprehension، أشعة قبل وبعد الرد', 'خروج رأس عظمة العضد من مكانها مع ألم شديد.'),
    c('sh_rc_tear', 'قطع أوتار الكفة المدورة', 'Rotator cuff tear', 'M75.1', 'Empty can، Drop arm، MRI', 'ضعف وألم عند رفع الذراع.'),
    c('sh_frozen', 'الكتف المتجمد', 'Frozen shoulder', 'M75.0', 'فقد الدوران الخارجي السلبي', 'تيبس وألم تدريجي يحد من حركة الكتف.'),
    c('sh_impinge', 'متلازمة الانحشار', 'Shoulder impingement', 'M75.4', 'Neer، Hawkins-Kennedy', 'ألم عند رفع الذراع فوق الرأس.'),
    c('sh_oa', 'خشونة مفصل الكتف', 'Shoulder osteoarthritis', 'M19.01', 'أشعة، فقد الحركة', 'تآكل غضروف المفصل مع ألم وطقطقة.'),
    c('sh_prox_fx', 'كسر أعلى عظمة العضد', 'Proximal humerus fracture', 'S42.2', 'أشعة 3 اتجاهات، CT', 'كسر عند رأس العضد، شائع مع هشاشة العظام.'),
  ] },
  { id: 'chest', name: 'القفص الصدري (الضلوع والقص)', en: 'Ribs & sternum', sided: false, conditions: [
    c('ch_rib_fx', 'كسر الضلوع', 'Rib fracture', 'S22.3', 'ألم عند الضغط، أشعة صدر', 'ألم مع التنفس بعد إصابة مباشرة.'),
    c('ch_multi_rib', 'كسور ضلوع متعددة', 'Multiple rib fractures', 'S22.4', 'أشعة/CT صدر، تشبع الأكسجين', 'أكثر من ضلع مكسور، يحتاج متابعة التنفس.'),
    c('ch_sternum_fx', 'كسر عظمة القص', 'Sternum fracture', 'S22.2', 'أشعة جانبية، رسم قلب', 'كسر بعد اصطدام الصدر بعجلة القيادة.'),
    c('ch_costo', 'التهاب غضاريف الضلوع', 'Costochondritis', 'M94.0', 'ألم موضعي عند الضغط', 'ألم بجدار الصدر بدون إصابة.'),
  ] },
  { id: 'humerus', name: 'عظمة العضد', en: 'Humerus', sided: true, conditions: [
    c('hu_shaft_fx', 'كسر جسم عظمة العضد', 'Humeral shaft fracture', 'S42.3', 'أشعة، فحص العصب الكعبري', 'كسر منتصف العضد، يُفحص معه العصب الكعبري.'),
    c('hu_supra_fx', 'كسر فوق اللقمتين', 'Supracondylar fracture', 'S42.4', 'أشعة، فحص النبض والأعصاب', 'كسر أسفل العضد، شائع عند الأطفال.'),
  ] },
  { id: 'elbow', name: 'مفصل المرفق', en: 'Elbow joint', sided: true, conditions: [
    c('el_disl', 'خلع المرفق', 'Elbow dislocation', 'S53.1', 'أشعة، فحص الأعصاب والنبض', 'خروج المفصل بعد السقوط على اليد.'),
    c('el_olec_fx', 'كسر النتوء المرفقي', 'Olecranon fracture', 'S52.0', 'أشعة جانبية، القدرة على فرد الكوع', 'كسر خلف الكوع بعد سقوط مباشر.'),
    c('el_rh_fx', 'كسر رأس الكعبرة', 'Radial head fracture', 'S52.1', 'ألم مع لف الساعد، أشعة', 'ألم على الجانب الخارجي للكوع بعد السقوط.'),
    c('el_tennis', 'مرفق التنس', 'Lateral epicondylitis', 'M77.1', "Cozen، Mill's", 'ألم خارج الكوع عند القبض.'),
    c('el_golfer', 'مرفق لاعب الجولف', 'Medial epicondylitis', 'M77.0', 'Reverse Cozen', 'ألم داخل الكوع يمتد للساعد.'),
    c('el_cubital', 'متلازمة النفق المرفقي', 'Cubital tunnel syndrome', 'G56.2', 'Tinel عند المرفق، رسم أعصاب', 'تنميل بالخنصر والبنصر من ضغط العصب الزندي.'),
  ] },
  { id: 'forearm', name: 'الساعد (الكعبرة والزند)', en: 'Forearm (radius & ulna)', sided: true, conditions: [
    c('fa_both_fx', 'كسر عظمتي الساعد', 'Radius & ulna shaft fracture', 'S52.2', 'أشعة للساعد كاملًا مع المفصلين', 'كسر الكعبرة والزند معًا مع تشوه واضح.'),
    c('fa_distal_fx', 'كسر نهاية الكعبرة (كوليس)', 'Distal radius fracture (Colles)', 'S52.5', 'أشعة، تشوه شوكة العشاء', 'أشهر كسور الرسغ بعد السقوط على اليد.'),
    c('fa_monteggia', 'كسر مونتيجيا / جالياتزي', 'Monteggia / Galeazzi fracture', 'S52.2', 'أشعة للكوع والرسغ', 'كسر بأحد العظمتين مع خلع مفصل مجاور.'),
  ] },
  { id: 'wrist_hand', name: 'الرسغ واليد', en: 'Wrist & hand', sided: true, conditions: [
    c('wh_scaphoid', 'كسر العظمة الزورقية', 'Scaphoid fracture', 'S62.0', 'ألم Snuffbox، أشعة زورقية، MRI', 'كسر قد لا يظهر في الأشعة الأولى، خطر عدم الالتئام.'),
    c('wh_metacarpal', 'كسر عظام المشط (كسر الملاكم)', 'Metacarpal fracture', 'S62.3', 'أشعة، دوران الأصابع', 'كسر بعظام كف اليد بعد اللكم أو السقوط.'),
    c('wh_phalanx', 'كسر السلاميات', 'Phalanx fracture', 'S62.6', 'أشعة للإصبع', 'كسر بعظام الأصابع.'),
    c('wh_cts', 'متلازمة النفق الرسغي', 'Carpal tunnel syndrome', 'G56.0', 'Phalen، Tinel، رسم أعصاب', 'تنميل الإبهام والأصابع ليلًا من ضغط العصب الأوسط.'),
    c('wh_dequervain', 'التهاب أوتار الإبهام (دي كيرفان)', "De Quervain's tenosynovitis", 'M65.4', 'Finkelstein', 'ألم على جانب الإبهام من الرسغ.'),
    c('wh_trigger', 'الإصبع الزنادي', 'Trigger finger', 'M65.3', 'طقطقة وقفل الإصبع', 'قفل الإصبع عند ثنيه.'),
    c('wh_mallet', 'الإصبع المطرقي', 'Mallet finger', 'S66.3', 'عدم فرد طرف الإصبع', 'قطع الوتر الباسط لطرف الإصبع.'),
    c('wh_ganglion', 'كيس دهني بالرسغ (جانجليون)', 'Ganglion cyst', 'M67.4', 'إضاءة الكيس، سونار', 'تورم لين على ظهر أو باطن الرسغ.'),
  ] },
  { id: 'thoracic', name: 'الفقرات الصدرية (T1–T12)', en: 'Thoracic spine', sided: false, conditions: [
    c('th_compress', 'كسر انضغاطي بالفقرات (هشاشة)', 'Osteoporotic compression fracture', 'M80.08', 'أشعة جانبية، DEXA', 'انهيار فقرة مع ألم ظهر، شائع مع هشاشة العظام.'),
    c('th_fx', 'كسر الفقرات الصدرية', 'Thoracic vertebra fracture', 'S22.0', 'CT، فحص عصبي', 'كسر بعد حادث أو سقوط من ارتفاع.'),
    c('th_scoliosis', 'انحناء العمود الفقري (جنف)', 'Scoliosis', 'M41.9', 'Adam forward bend، أشعة كاملة للعمود', 'انحناء جانبي بالعمود الفقري.'),
    c('th_kyphosis', 'تحدب الظهر', 'Kyphosis', 'M40.2', 'أشعة جانبية، زاوية Cobb', 'تقوس زائد بأعلى الظهر.'),
  ] },
  { id: 'lumbar', name: 'الفقرات القطنية (L1–L5)', en: 'Lumbar spine', sided: false, conditions: [
    c('lb_disc', 'انزلاق غضروفي قطني (عرق النسا)', 'Lumbar disc herniation with sciatica', 'M51.1', 'SLR، فحص عصبي للطرف السفلي، MRI', 'ألم أسفل الظهر ممتد للساق مع تنميل.'),
    c('lb_stenosis', 'ضيق القناة العصبية القطنية', 'Lumbar canal stenosis', 'M48.06', 'المشي المتقطع، MRI', 'ألم وتنميل بالساقين يزيد مع المشي.'),
    c('lb_listhesis', 'انزلاق الفقرات', 'Spondylolisthesis', 'M43.1', 'أشعة جانبية وديناميكية', 'انزلاق فقرة على الأخرى مع ألم أسفل الظهر.'),
    c('lb_spond', 'خشونة الفقرات القطنية', 'Lumbar spondylosis', 'M47.8', 'أشعة عادية', 'تآكل الفقرات والمفاصل الصغيرة مع ألم مزمن.'),
    c('lb_fx', 'كسر الفقرات القطنية', 'Lumbar vertebra fracture', 'S32.0', 'CT، فحص عصبي', 'كسر بعد سقوط أو حادث.'),
    c('lb_lbp', 'ألم أسفل الظهر الميكانيكي', 'Mechanical low back pain', 'M54.5', 'فحص إكلينيكي، استبعاد العلامات الحمراء', 'ألم عضلي أو رباطي بدون إصابة عصبية.'),
  ] },
  { id: 'sacrum', name: 'العجز والعصعص', en: 'Sacrum & coccyx', sided: false, conditions: [
    c('sa_coccydynia', 'ألم العصعص', 'Coccydynia', 'M53.3', 'ألم عند الجلوس والضغط', 'ألم بنهاية العمود الفقري بعد السقوط على الظهر.'),
    c('sa_coccyx_fx', 'كسر العصعص', 'Coccyx fracture', 'S32.2', 'أشعة جانبية', 'كسر بعد السقوط جلوسًا.'),
    c('sa_sacrum_fx', 'كسر العجز', 'Sacrum fracture', 'S32.1', 'CT حوض', 'كسر خلف الحوض، شائع مع هشاشة العظام.'),
    c('sa_si', 'التهاب المفصل العجزي الحرقفي', 'Sacroiliitis', 'M46.1', 'FABER، ضغط المفصل، MRI', 'ألم بأسفل الظهر والأرداف.'),
  ] },
  { id: 'hip', name: 'الحوض ومفصل الورك', en: 'Pelvis & hip joint', sided: true, conditions: [
    c('hp_neck_fx', 'كسر عنق عظمة الفخذ', 'Femoral neck fracture', 'S72.0', 'قِصر ودوران القدم للخارج، أشعة', 'كسر شائع عند كبار السن بعد السقوط.'),
    c('hp_troch_fx', 'كسر بين المدورين', 'Intertrochanteric fracture', 'S72.1', 'أشعة حوض وورك', 'كسر أعلى الفخذ يحتاج تثبيتًا جراحيًا غالبًا.'),
    c('hp_oa', 'خشونة مفصل الورك', 'Hip osteoarthritis', 'M16.1', 'فقد الدوران الداخلي، أشعة', 'ألم بالأرداف والفخذ مع عرج وتيبس.'),
    c('hp_avn', 'نخر رأس عظمة الفخذ', 'Avascular necrosis of femoral head', 'M87.05', 'MRI', 'موت عظم رأس الفخذ لنقص التروية.'),
    c('hp_disl', 'خلع مفصل الورك', 'Hip dislocation', 'S73.0', 'أشعة، فحص العصب الوركي', 'إصابة طارئة بعد حادث شديد.'),
    c('hp_pelvis_fx', 'كسر عظام الحوض', 'Pelvic fracture', 'S32.8', 'CT حوض، ثبات الحوض', 'كسر بعد حادث أو سقوط عند كبار السن.'),
    c('hp_bursitis', 'التهاب الجراب المدوري', 'Trochanteric bursitis', 'M70.6', 'ألم عند الضغط على جانب الورك', 'ألم على جانب الفخذ عند النوم عليه.'),
  ] },
  { id: 'femur', name: 'عظمة الفخذ', en: 'Femur', sided: true, conditions: [
    c('fe_shaft_fx', 'كسر جسم عظمة الفخذ', 'Femoral shaft fracture', 'S72.3', 'أشعة للفخذ كاملًا، النبض', 'كسر كبير بعد إصابة شديدة، يحتاج تثبيتًا.'),
    c('fe_distal_fx', 'كسر نهاية عظمة الفخذ', 'Distal femur fracture', 'S72.4', 'أشعة، CT للركبة', 'كسر فوق الركبة.'),
  ] },
  { id: 'knee', name: 'مفصل الركبة', en: 'Knee joint', sided: true, conditions: [
    c('kn_oa', 'خشونة الركبة', 'Knee osteoarthritis', 'M17.1', 'أشعة واقفًا، طقطقة، تشوه', 'تآكل الغضروف المفصلي مع ألم وتيبس.'),
    c('kn_menisc', 'قطع الغضروف الهلالي', 'Meniscus tear', 'S83.2', 'McMurray، Thessaly، MRI', 'ألم وقفل بالركبة بعد لف.'),
    c('kn_acl', 'قطع الرباط الصليبي الأمامي', 'ACL tear', 'S83.51', 'Lachman، Anterior drawer، MRI', 'عدم ثبات الركبة بعد إصابة رياضية.'),
    c('kn_pcl', 'قطع الرباط الصليبي الخلفي', 'PCL tear', 'S83.52', 'Posterior drawer، Sag sign', 'إصابة بعد ضربة أمام الساق.'),
    c('kn_collat', 'إصابة الرباط الجانبي', 'Collateral ligament sprain', 'S83.4', 'Valgus / Varus stress', 'ألم على جانب الركبة بعد الإصابة.'),
    c('kn_patella_fx', 'كسر الرضفة', 'Patella fracture', 'S82.0', 'أشعة، القدرة على رفع الساق مفرودة', 'كسر صابونة الركبة بعد السقوط عليها.'),
    c('kn_patella_disl', 'خلع الرضفة', 'Patellar dislocation', 'S83.0', 'Apprehension للرضفة', 'خروج الصابونة للجانب الخارجي.'),
    c('kn_plateau_fx', 'كسر هضبة القصبة', 'Tibial plateau fracture', 'S82.1', 'أشعة، CT', 'كسر بالسطح المفصلي أسفل الركبة.'),
    c('kn_baker', 'كيس بيكر', "Baker's cyst", 'M71.2', 'سونار', 'تورم خلف الركبة.'),
  ] },
  { id: 'leg', name: 'الساق (القصبة والشظية)', en: 'Leg (tibia & fibula)', sided: true, conditions: [
    c('lg_tibia_fx', 'كسر جسم القصبة', 'Tibial shaft fracture', 'S82.2', 'أشعة، متابعة متلازمة الحيز', 'كسر بالساق بعد حادث أو إصابة رياضية.'),
    c('lg_fibula_fx', 'كسر الشظية', 'Fibula fracture', 'S82.4', 'أشعة للساق والكاحل', 'كسر بالعظمة الرفيعة خارج الساق.'),
    c('lg_stress_fx', 'كسر إجهادي', 'Stress fracture', 'M84.36', 'ألم موضعي، MRI', 'كسر دقيق من الحمل المتكرر.'),
    c('lg_shin', 'آلام قصبة الساق', 'Shin splints', 'M76.8', 'ألم على حافة القصبة', 'ألم مع الجري والمجهود.'),
  ] },
  { id: 'ankle_foot', name: 'الكاحل والقدم', en: 'Ankle & foot', sided: true, conditions: [
    c('af_ankle_fx', 'كسر الكاحل', 'Ankle (malleolar) fracture', 'S82.6', 'Ottawa ankle rules، أشعة', 'كسر بالكعب الخارجي أو الداخلي بعد اللف.'),
    c('af_bimall_fx', 'كسر الكاحل الثنائي / الثلاثي', 'Bimalleolar / trimalleolar fracture', 'S82.84', 'أشعة 3 اتجاهات', 'كسر غير ثابت يحتاج تثبيتًا غالبًا.'),
    c('af_sprain', 'التواء الكاحل', 'Ankle sprain', 'S93.4', 'Anterior drawer للكاحل، Ottawa', 'تمزق أربطة الكاحل الخارجية بعد اللف.'),
    c('af_achilles', 'قطع وتر أكيليس', 'Achilles tendon rupture', 'S86.0', 'Thompson، سونار', 'ألم مفاجئ خلف الكعب مع ضعف الوقوف على المشط.'),
    c('af_calc_fx', 'كسر عظمة الكعب', 'Calcaneus fracture', 'S92.0', 'أشعة، CT', 'كسر بعد السقوط من ارتفاع على القدمين.'),
    c('af_meta_fx', 'كسر عظام مشط القدم', 'Metatarsal fracture', 'S92.3', 'أشعة للقدم', 'كسر بعظام القدم الأمامية.'),
    c('af_plantar', 'التهاب اللفافة الأخمصية (شوكة القدم)', 'Plantar fasciitis', 'M72.2', 'ألم أول خطوة صباحًا، جس الكعب', 'ألم أسفل الكعب.'),
    c('af_hallux', 'انحراف إصبع القدم الكبير', 'Hallux valgus', 'M20.1', 'أشعة واقفًا', 'بروز عظمي عند قاعدة الإصبع الكبير.'),
    c('af_flat', 'القدم المسطحة', 'Flat foot', 'M21.4', 'Navicular drop، أشعة واقفًا', 'هبوط قوس القدم مع ألم بالمجهود.'),
  ] },
];

export const SIDE_LABEL: Record<'right' | 'left' | 'both', string> = { right: 'يمين', left: 'يسار', both: 'الجهتين' };
export const SIDE_EN: Record<'right' | 'left' | 'both', string> = { right: 'Right', left: 'Left', both: 'Bilateral' };

export function findCondition(conditionId: string) {
  for (const r of BODY_REGIONS) { const c = r.conditions.find((x) => x.id === conditionId); if (c) return { region: r, condition: c }; }
  return undefined;
}

// ---- تعديلات المركز على الحالات (جدول conditions في Supabase) تُطبَّق فوق القائمة الأصلية ----
const BASE_CONDITIONS = new Map(BODY_REGIONS.map((r) => [r.id, r.conditions.slice()]));
export interface ConditionRow { id: string; region_id: string; name_ar: string; name_en: string; icd10: string; tests: string; description?: string | null; services?: string[] | null; active?: boolean | null }
export function applyConditionRows(rows: ConditionRow[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const region of BODY_REGIONS) {
    const list: Condition[] = [];
    for (const c of BASE_CONDITIONS.get(region.id) ?? []) {
      const r = byId.get(c.id);
      if (r && r.active === false) continue;
      list.push(r ? { ...c, name: r.name_ar, en: r.name_en, icd10: r.icd10, tests: r.tests, desc: r.description || c.desc, services: r.services?.length ? r.services : c.services } : c);
    }
    for (const r of rows) {
      if (r.region_id !== region.id || r.active === false || list.some((c) => c.id === r.id) || (BASE_CONDITIONS.get(region.id) ?? []).some((c) => c.id === r.id)) continue;
      list.push({ id: r.id, name: r.name_ar, en: r.name_en, icd10: r.icd10, tests: r.tests, desc: r.description ?? '', services: r.services?.length ? r.services : ['sv_pt'] });
    }
    region.conditions = list;
  }
}
