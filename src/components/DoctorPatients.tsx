// الرئيسية لحساب الدكتور (مربوط بـ employees.therapist_id): ترحيب قوي «صباح/مساء الخير يا دكتور + جملة تحفيز»
// والمرضى اللي خلص معاهم جلسات/كشوفات **النهارده** بس — للعرض بس (من غير فتح ملفات ولا أزرار).
// المصدر: مواعيد اليوم باسمه بحالة «حضر» أو «مكتمل» من الكاش اللحظي.
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { EmptyState } from './ui';
import { fmtTime, riyadhNow, todayYmd } from '../utils/format';

const MOTIVATION = [
  'أنت لا تعالج فقط — بل تُعيد للناس حياتهم وحركتهم. لنصنع يومًا مميزًا 💪',
  'كل مريض سيخرج من عندك أفضل مما دخل — هذا أثرك الحقيقي، واصل! 🔥',
  'يدك التي تعالج اليوم هي أمل مريض الغد — وأنت أهلٌ لذلك 💙',
  'الأبطال ما ينتظرون الفرصة، بل يصنعونها — وأنت بطل في عملك كل يوم 🏆',
  'كل جلسة تُجريها خطوة في رحلة شفاء أحدهم — اليوم يوم إنجاز جديد ✨',
  'الاستمرارية تصنع الفرق — وأنت مثال للالتزام والتميّز 🌟',
  'ابتسامتك وعملك المتقن أول علاج لأي مريض — اجعل يومك مليئًا بالنجاح 💪',
];
const DONE = new Set(['arrived', 'completed']); // «خلص معاه» = حضر أو مكتمل
// الكشف = خدمة اسمها فيها «كشف» — غير كده جلسة
const isExam = (serviceId: string) => /كشف/.test(db.service(serviceId)?.name ?? '');

// اسم الدكتور من غير «د.» عشان مايبقاش «دكتور د. ...»
const cleanName = (name: string) => name.replace(/^\s*(د\.?|دكتور|دكتورة)\s+/, '').trim();
// الترحيب على سطرين: «صباح الخير ☀️ / مساء الخير 🌙» صغير فوق، و«د. الاسم» عنوان كبير
export const dayGreeting = () => (riyadhNow().getHours() < 12 ? 'صباح الخير ☀️' : 'مساء الخير 🌙');
export const doctorTitle = (name: string) => `دكتور ${cleanName(name)}`;
export const dailyMotivation = () => MOTIVATION[Number(todayYmd().replace(/-/g, '')) % MOTIVATION.length];

export default function DoctorPatients({ therapistId }: { therapistId: string }) {
  useDbVersion();
  const today = todayYmd();
  const done = db.appointments()
    .filter((a) => a.therapistId === therapistId && a.date === today && DONE.has(a.status))
    .sort((a, b) => (a.time < b.time ? -1 : 1));
  const exams = done.filter((a) => isExam(a.serviceId)).length;
  const sessions = done.length - exams;

  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="card__head">
        <h2>المرضى الذين أنهيت جلساتهم اليوم</h2>
        <span className="muted-sm"><span className="num">{sessions}</span> جلسة · <span className="num">{exams}</span> كشف</span>
      </div>
      <div className="card__body">
        {done.length === 0 ? <EmptyState icon="users" title="ما فيه جلسات منتهية اليوم بعد" text="ستظهر هنا فور تسجيل زيارة «حضر» أو «مكتمل» باسمك اليوم." />
          : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>الوقت</th><th>المريض</th><th>رقم الملف</th><th>النوع</th><th>الخدمة</th></tr></thead>
              <tbody>{done.map((a) => {
                const p = db.patient(a.patientId);
                return (
                  <tr key={a.id}>
                    <td className="num">{fmtTime(a.time)}</td>
                    <td style={{ fontWeight: 600 }}>{p?.fullName ?? '—'}</td>
                    <td className="num">{p?.fileNo || '—'}</td>
                    <td>{isExam(a.serviceId) ? 'كشف' : 'جلسة'}</td>
                    <td>{db.service(a.serviceId)?.name ?? '—'}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
      </div>
    </section>
  );
}
