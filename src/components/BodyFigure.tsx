import { BODY_REGIONS, MAP_REGION_IDS } from '../data/bodyRegions';

export type BodyView = 'front' | 'back';

export const regionById = (id: string) => BODY_REGIONS.find((r) => r.id === id);

// ترتيب المناطق (من الراس للرجل) — كان مواقع النقط على صورة الهيكل العظمي
type Spot = [region: string, x: number, y: number];
const SPOTS: Record<BodyView, Spot[]> = {
  front: [
    ['skull', 175, 45], ['cervical', 178, 100], ['clavicle', 132, 124], ['clavicle', 222, 124],
    ['shoulder', 92, 150], ['shoulder', 262, 150], ['chest', 175, 172], ['humerus', 80, 205], ['humerus', 272, 205],
    ['elbow', 68, 268], ['elbow', 280, 268], ['forearm', 62, 318], ['forearm', 290, 318],
    ['wrist_hand', 62, 395], ['wrist_hand', 300, 395], ['lumbar', 178, 290], ['hip', 140, 335], ['hip', 215, 335],
    ['femur', 130, 445], ['femur', 228, 445], ['knee', 142, 525], ['knee', 214, 525],
    ['leg', 140, 605], ['leg', 220, 605], ['ankle_foot', 132, 690], ['ankle_foot', 226, 690],
  ],
  back: [
    ['skull', 175, 40], ['cervical', 180, 95], ['shoulder', 80, 135], ['shoulder', 268, 135],
    ['scapula', 114, 162], ['scapula', 238, 162], ['thoracic', 180, 200], ['humerus', 70, 210], ['humerus', 268, 210],
    ['elbow', 62, 272], ['elbow', 272, 272], ['forearm', 55, 320], ['forearm', 285, 320],
    ['wrist_hand', 48, 400], ['wrist_hand', 292, 400], ['lumbar', 182, 280], ['sacrum', 176, 350],
    ['hip', 128, 318], ['hip', 220, 318], ['femur', 128, 455], ['femur', 220, 455], ['knee', 128, 540], ['knee', 215, 540],
    ['leg', 125, 610], ['leg', 222, 610], ['ankle_foot', 118, 690], ['ankle_foot', 225, 690],
  ],
};

// جهة النقطة من مكانها على الصورة (أمامي: شمال الصورة = يمين المريض) — للمناطق اللي ليها جهتين بس
export type PinSide = 'right' | 'left' | null;

// صورة جسم الإنسان اتشالت من السيستم (طلب الدكتور ٧/١١): مكان الألم بقى أزرار بأسماء المناطق — نفس البيانات ونفس الاستخدام.
// المناطق اللي ليها جهتين بتتعرض «يمين» و«شمال». view مابقاش بيفرق (كل المناطق بتتعرض مرة واحدة).
const ALL_ORDER = [...SPOTS.front, ...SPOTS.back].map((s) => s[0]).filter((id, i, a) => a.indexOf(id) === i);
export function BodyFigure({ selected, hovered, highlighted, marked, onSelect, onHover }: {
  view?: BodyView; selected: string | null; hovered: string | null; highlighted?: Set<string>;
  /** اختيارات متعلّمة (اختيار متعدد): «knee:right» للمناطق اللي ليها جهتين، أو «lumbar» */
  marked?: Set<string>;
  onSelect: (id: string, side: PinSide) => void; onHover: (id: string | null) => void; compact?: boolean;
}) {
  const ids = ALL_ORDER.filter((id) => MAP_REGION_IDS.has(id)); // المناطق اللي ليها شيت كشف بس
  return (
    <div className="rg-pick" role="group" aria-label="مكان الألم">
      {ids.map((id) => {
        const r = regionById(id);
        if (!r) return null;
        const sides: PinSide[] = r.sided ? ['right', 'left'] : [null];
        return (
          <div key={id} className={`rg-pick__row ${hovered === id ? 'is-hover' : ''} ${highlighted?.has(id) ? 'is-match' : ''}`}>
            <span className="rg-pick__name">{r.name}</span>
            <span className="rg-pick__btns">
              {sides.map((sd) => {
                const on = selected === id || !!marked?.has(sd ? `${id}:${sd}` : id);
                return (
                  <button key={sd ?? 'c'} type="button" className={`rg-pick__btn ${on ? 'is-selected' : ''}`} aria-pressed={on}
                    onClick={() => onSelect(id, sd)} onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(id)} onBlur={() => onHover(null)}>
                    {sd === 'right' ? 'يمين' : sd === 'left' ? 'شمال' : 'اختيار'}
                  </button>
                );
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
