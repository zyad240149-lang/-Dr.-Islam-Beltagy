// قوائم اقتراحات للكشف (الطبيب يقدر يكتب أي حاجة غيرها) — أدوية وتحاليل وأوضاع أشعة شائعة في عيادة العظام
import type { Medication } from './data';

export interface MedPreset extends Omit<Medication, 'notes'> { group: string }

export const MED_PRESETS: MedPreset[] = [
  { group: 'مسكنات ومضادات التهاب', name: 'Diclofenac sodium 50mg', dose: 'قرص', frequency: 'مرتين يوميًا بعد الأكل', duration: '5 أيام' },
  { group: 'مسكنات ومضادات التهاب', name: 'Diclofenac sodium 75mg amp', dose: 'أمبول عضل', frequency: 'مرة يوميًا', duration: '3 أيام' },
  { group: 'مسكنات ومضادات التهاب', name: 'Ibuprofen 400mg', dose: 'قرص', frequency: '3 مرات يوميًا بعد الأكل', duration: '5 أيام' },
  { group: 'مسكنات ومضادات التهاب', name: 'Celecoxib 200mg', dose: 'كبسولة', frequency: 'مرة يوميًا', duration: '10 أيام' },
  { group: 'مسكنات ومضادات التهاب', name: 'Etoricoxib 90mg', dose: 'قرص', frequency: 'مرة يوميًا', duration: '7 أيام' },
  { group: 'مسكنات ومضادات التهاب', name: 'Meloxicam 15mg', dose: 'قرص', frequency: 'مرة يوميًا', duration: '10 أيام' },
  { group: 'مسكنات ومضادات التهاب', name: 'Paracetamol 500mg', dose: 'قرصين', frequency: 'كل 8 ساعات عند اللزوم', duration: '5 أيام' },
  { group: 'مسكنات ومضادات التهاب', name: 'Tramadol 50mg', dose: 'كبسولة', frequency: 'كل 12 ساعة عند الألم الشديد', duration: '3 أيام' },
  { group: 'باسط عضلات', name: 'Thiocolchicoside 4mg', dose: 'كبسولة', frequency: 'مرتين يوميًا', duration: '5 أيام' },
  { group: 'باسط عضلات', name: 'Orphenadrine + Paracetamol', dose: 'قرص', frequency: '3 مرات يوميًا', duration: '5 أيام' },
  { group: 'باسط عضلات', name: 'Tizanidine 2mg', dose: 'قرص', frequency: 'مرتين يوميًا', duration: '7 أيام' },
  { group: 'حماية المعدة', name: 'Esomeprazole 40mg', dose: 'قرص', frequency: 'مرة يوميًا قبل الفطار', duration: 'طول مدة المسكن' },
  { group: 'حماية المعدة', name: 'Pantoprazole 40mg', dose: 'قرص', frequency: 'مرة يوميًا قبل الفطار', duration: 'طول مدة المسكن' },
  { group: 'أعصاب', name: 'Pregabalin 75mg', dose: 'كبسولة', frequency: 'مرة مساءً', duration: 'شهر' },
  { group: 'أعصاب', name: 'Vitamin B complex (B1-B6-B12)', dose: 'قرص', frequency: 'مرتين يوميًا', duration: 'شهر' },
  { group: 'عظام وغضاريف', name: 'Calcium + Vitamin D3', dose: 'قرص', frequency: 'مرة يوميًا بعد الغدا', duration: '3 شهور' },
  { group: 'عظام وغضاريف', name: 'Vitamin D3 50,000 IU', dose: 'كبسولة', frequency: 'مرة أسبوعيًا', duration: '8 أسابيع' },
  { group: 'عظام وغضاريف', name: 'Alendronate 70mg', dose: 'قرص', frequency: 'مرة أسبوعيًا على الريق مع كوب مية', duration: '3 شهور' },
  { group: 'عظام وغضاريف', name: 'Glucosamine + Chondroitin', dose: 'قرص', frequency: 'مرة يوميًا', duration: '3 شهور' },
  { group: 'عظام وغضاريف', name: 'Diacerein 50mg', dose: 'كبسولة', frequency: 'مرتين يوميًا', duration: '3 شهور' },
  { group: 'موضعي', name: 'Diclofenac gel 1%', dose: 'دهان', frequency: '3 مرات يوميًا', duration: 'أسبوعين' },
  { group: 'موضعي', name: 'Piroxicam gel', dose: 'دهان', frequency: '3 مرات يوميًا', duration: 'أسبوعين' },
  { group: 'سيولة (بعد الجبس/العمليات)', name: 'Enoxaparin 40mg', dose: 'حقنة تحت الجلد', frequency: 'مرة يوميًا', duration: 'طول مدة الجبس' },
  { group: 'سيولة (بعد الجبس/العمليات)', name: 'Rivaroxaban 10mg', dose: 'قرص', frequency: 'مرة يوميًا', duration: '14 يوم' },
  { group: 'مضاد حيوي', name: 'Amoxicillin/Clavulanate 1g', dose: 'قرص', frequency: 'مرتين يوميًا', duration: '7 أيام' },
  { group: 'مضاد حيوي', name: 'Cefuroxime 500mg', dose: 'قرص', frequency: 'مرتين يوميًا', duration: '7 أيام' },
  { group: 'كورتيزون', name: 'Methylprednisolone 4mg', dose: 'حسب الجرعة المتناقصة', frequency: 'حسب الجدول', duration: '6 أيام' },
];

export const LAB_GROUPS: { group: string; items: string[] }[] = [
  { group: 'صورة دم وكيمياء', items: ['CBC', 'ESR', 'CRP', 'Fasting blood sugar', 'HbA1c', 'Serum creatinine', 'Urea', 'ALT / AST'] },
  { group: 'عظام', items: ['Serum calcium', 'Serum phosphorus', 'Alkaline phosphatase', 'Vitamin D (25-OH)', 'PTH', 'Serum uric acid'] },
  { group: 'روماتيزم ومناعة', items: ['Rheumatoid factor (RF)', 'Anti-CCP', 'ANA', 'HLA-B27', 'ASO titer'] },
  { group: 'قبل العمليات', items: ['PT / INR', 'PTT', 'Blood group', 'HBsAg', 'HCV Ab', 'HIV Ab', 'ECG', 'Chest X-ray'] },
];

export const XRAY_VIEWS = ['AP & Lateral', 'AP', 'Lateral', 'Oblique', 'Standing (weight-bearing)', 'Skyline (patella)', 'Flexion/Extension', 'Comparative (both sides)'];
