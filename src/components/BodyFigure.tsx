import { BODY_REGIONS } from '../data/bodyRegions';

export type BodyView = 'front' | 'back';

export const regionById = (id: string) => BODY_REGIONS.find((r) => r.id === id);

// صورة الهيكل العظمي (public/anatomy — مقصوصة من لوحة التشريح 390×745) ونقط الاختيار عليها بالبكسل.
// المنظر الأمامي: شمال الصورة = يمين المريض. الخلفي: شمال الصورة = شمال المريض.
const W = 390, H = 745;
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
const pinSide = (view: BodyView, x: number): 'right' | 'left' => ((x < W / 2) === (view === 'front') ? 'right' : 'left');

export function BodyFigure({ view, selected, hovered, highlighted, marked, onSelect, onHover, compact }: {
  view: BodyView; selected: string | null; hovered: string | null; highlighted?: Set<string>;
  /** نقط متعلّمة (اختيار متعدد): «knee:right» للمناطق اللي ليها جهتين، أو «lumbar» */
  marked?: Set<string>;
  onSelect: (id: string, side: PinSide) => void; onHover: (id: string | null) => void; compact?: boolean;
}) {
  const spots = SPOTS[view];
  const order = spots.map((s) => s[0]).filter((id, i, a) => a.indexOf(id) === i);
  return (
    <figure className={`bm-figure bm-skel ${compact ? 'bm-figure--compact' : ''}`}>
      <div className="bm-skel__frame">
        <img src={`${import.meta.env.BASE_URL}anatomy/${view}.jpg`} alt={view === 'front' ? 'الهيكل العظمي — منظر أمامي' : 'الهيكل العظمي — منظر خلفي'} draggable={false} />
        {spots.map(([id, x, y], i) => {
          const r = regionById(id);
          if (!r) return null;
          const side = r.sided ? pinSide(view, x) : null;
          const on = selected === id || !!marked?.has(side ? `${id}:${side}` : id);
          const state = [on && 'is-selected', hovered === id && 'is-hover', highlighted?.has(id) && 'is-match'].filter(Boolean).join(' ');
          return (
            <button key={i} type="button" className={`bm-skel__pin ${state}`} style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}
              title={r.name} aria-label={r.name} aria-pressed={marked ? on : undefined} onClick={() => onSelect(id, side)} onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(id)} onBlur={() => onHover(null)}>
              {order.indexOf(id) + 1}
            </button>
          );
        })}
      </div>
      <figcaption>{view === 'front' ? 'منظر أمامي' : 'منظر خلفي'}</figcaption>
    </figure>
  );
}
