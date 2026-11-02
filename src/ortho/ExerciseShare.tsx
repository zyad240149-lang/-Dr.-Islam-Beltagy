// صفحة المريض العامة للتمرينات (/ex/<token>): تمارين بس — اسم/وصف/صور/فيديوهات، من غير أي بيانات للمريض.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ExerciseMedia } from './data';

interface Item { name: string; description: string; media: ExerciseMedia[] }

export default function ExerciseShare() {
  const { token = '' } = useParams();
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    void supabase.rpc('exercise_share', { p_token: token }).then(({ data, error }) => { if (error) setErr(true); else setItems((data ?? []) as Item[]); });
  }, [token]);
  return (
    <div className="exs" dir="rtl">
      <h1>التمرينات العلاجية</h1>
      {err && <p className="exs__msg">تعذّر تحميل التمرينات — جرّب تاني.</p>}
      {!err && items === null && <p className="exs__msg">جاري التحميل…</p>}
      {items?.length === 0 && <p className="exs__msg">الرابط ده مش متاح.</p>}
      {items?.map((x, i) => (
        <section className="exs__card" key={i}>
          <h2><span className="num">{i + 1}</span> {x.name}</h2>
          {x.description && <p>{x.description}</p>}
          {x.media.map((m) => m.type.startsWith('video/')
            ? <video key={m.path} src={m.url} controls playsInline preload="metadata" />
            : <img key={m.path} src={m.url} alt={x.name} loading="lazy" />)}
        </section>
      ))}
    </div>
  );
}
