// تمارين المريض داخل حسابه: الخطط اللي الطبيب ربطها بملفه، بالصور والفيديوهات (من دالة my_exercise_plans المقصورة على ملفه)
import { useEffect, useState } from 'react';
import { useAsync } from '../../hooks/useAsync';
import { supabase } from '../../lib/supabase';
import { fmtDate } from '../../utils/format';
import type { ExerciseMedia } from '../../ortho/data';

interface Plan { id: string; date: string; notes: string; exercises: { name: string; description: string; media: ExerciseMedia[] }[] }

async function loadPlans(): Promise<Plan[]> {
  const { data, error } = await supabase.rpc('my_exercise_plans');
  if (error) throw new Error(error.message);
  return (data ?? []) as Plan[];
}

function Media({ m }: { m: ExerciseMedia }) {
  const [url, setUrl] = useState('');
  useEffect(() => { setUrl(supabase.storage.from('exercise-media').getPublicUrl(m.path).data.publicUrl); }, [m.path]);
  if (!url) return null;
  if (m.type.startsWith('video/')) return <video src={url} controls preload="metadata" style={{ width: '100%', borderRadius: 8 }} />;
  if (m.type.startsWith('image/')) return <img src={url} alt="" loading="lazy" style={{ width: '100%', borderRadius: 8 }} />;
  return <a href={url} target="_blank" rel="noopener noreferrer">فتح الملف</a>;
}

export default function MyExercises() {
  const plans = useAsync(loadPlans, []);
  if (!plans.data?.length) return null;
  return (
    <section className="card">
      <div className="card__head"><h2>تماريني</h2></div>
      <div className="card__body"><div className="cm-history">{plans.data.map((p) => (
        <article key={p.id} className="cm-item">
          <div className="row-between"><strong className="num date">{fmtDate(p.date)}</strong></div>
          {p.notes && <p>{p.notes}</p>}
          {p.exercises.map((e) => (
            <div key={e.name} style={{ marginTop: 10 }}>
              <strong>{e.name}</strong>
              {e.description && <p className="muted-sm" style={{ whiteSpace: 'pre-wrap' }}>{e.description}</p>}
              {(e.media ?? []).map((m) => <Media key={m.path} m={m} />)}
            </div>
          ))}
        </article>
      ))}</div></div>
    </section>
  );
}
