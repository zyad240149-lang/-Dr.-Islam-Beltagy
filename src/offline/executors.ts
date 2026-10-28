// ======================================================================
// executors.ts — تنفيذ عمليات الطابور فعليًا على الخادم (Supabase). التحقق والصلاحيات وقواعد الحجز كلها على الخادم زي ما هي:
// الطابور مجرد «توصيل مؤجّل»؛ أي رفض من الخادم بيرجع للمستخدم صراحةً، ومفيش حاجة بتتكتب فوق حاجة بصمت.
//
// منع التكرار (idempotency):
//  - مريض جديد: الـ id بيتولّد على الجهاز ويتبعت في الـ insert ← نفس العملية تاني = تعارض مفتاح أساسي ← نعتبرها نجحت.
//  - موعد جديد: RPC offline_book_appointment(key, p) (هجرة 190) بتحفظ مفتاح العملية وبترجع نفس الموعد لو اتكررت.
//    لو الهجرة لسه مش مطبّقة: بنفحص الأول لو فيه موعد مطابق (نفس المريض/الدكتور/الخدمة/التاريخ/الوقت) اتعمل من نفس الموظف
//    ← نعتبره هو. (أضعف شوية من المفتاح، لكن بيمنع التكرار في سيناريو انقطاع الشبكة بعد ما الخادم نفّذ.)
//  - إعادة جدولة/إلغاء: بطبيعتها آمنة للتكرار (نفس القيمة النهائية).
// ======================================================================
import { supabase } from '../lib/supabase';
import { isNetworkError } from './net';
import { asConflict, bookingError, classify, clean, DUP_PHONE, norm, type PgErr } from './classify';
import type { ExecResult, OfflineOp } from './queue';

// ---------- مقارنة تعديل الحقول بنسخة الخادم ----------
async function guardedUpdate(table: string, id: string, op: OfflineOp, row: Record<string, unknown>, label: string): Promise<ExecResult> {
  const base = op.base ?? {};
  const { data: cur, error: e1, status: s1 } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
  const c1 = classify(e1, s1); if (c1) return c1;
  if (!cur) return { type: 'failed', error: `${label} لم يعد موجودًا على الخادم (اتحذف من جهاز آخر).` };
  if (!op.payload.__force) {
    const changed = Object.keys(row).filter((k) => k in base && norm((cur as Record<string, unknown>)[k]) !== norm(base[k]) && norm((cur as Record<string, unknown>)[k]) !== norm(row[k]));
    if (changed.length) {
      const serverValues: Record<string, unknown> = {};
      for (const k of changed) serverValues[k] = (cur as Record<string, unknown>)[k];
      return asConflict({ reason: 'server_changed', message: `${label} اتعدّل على الخادم بعد ما حفظت تعديلك محليًا.`, fields: changed, serverValues });
    }
  }
  const { error, status } = await supabase.from(table).update(row).eq('id', id);
  return classify(error, status) ?? { type: 'done' };
}

// ---------- المنفّذ الرئيسي ----------
export async function executeOp(op: OfflineOp): Promise<ExecResult> {
  try {
    switch (op.kind) {
      case 'patient.create': {
        const row: Record<string, unknown> = { ...(op.payload.row as Record<string, unknown>), id: op.entityId, file_no: '' };
        const { error, status } = await supabase.from('patients').insert(row);
        if (!error) return { type: 'done' };
        // نفس العملية اتنفّذت قبل كده (الاتصال قطع بعد ما الخادم حفظ) ← 23505 على المفتاح الأساسي
        if (error.code === '23505' && /patients_pkey|\(id\)/.test(`${error.message} ${error.details ?? ''}`)) return { type: 'done' };
        const msg = clean(error.message ?? '');
        if (DUP_PHONE.test(msg)) {
          // فحص التكرار في الخادم (نفس الجوال + نفس الاسم) بيشتغل قبل فحص المفتاح الأساسي: لو الملف اللي «متكرر» هو نفس معرّف الجهاز
          // يبقى المحاولة اللي فاتت وصلت والرد بس اللي ضاع ← خلصت (مش تعارض يحتاج قرار)
          const { data: same } = await supabase.from('patients').select('id').eq('id', op.entityId).maybeSingle();
          if (same) return { type: 'done' };
          const { data: ex } = await supabase.from('patients').select('id,full_name,file_no').eq('phone', String(row.phone)).limit(1);
          return asConflict({ reason: 'duplicate_patient', message: msg, existingId: ex?.[0]?.id });
        }
        return classify(error, status) ?? { type: 'failed', error: msg };
      }
      case 'patient.update': {
        return guardedUpdate('patients', op.entityId, op, op.payload.row as Record<string, unknown>, 'ملف المريض');
      }
      case 'assessment.save': {
        const row = op.payload.row as Record<string, unknown>;
        if (op.payload.isNew) {
          const { error, status } = await supabase.from('initial_assessments').insert({ ...row, id: op.entityId, therapist_id: null });
          if (error && !(error.code === '23505' && /pkey|\(id\)/.test(`${error.message} ${error.details ?? ''}`))) return classify(error, status) ?? { type: 'failed', error: clean(error.message ?? '') };
        } else {
          const r = await guardedUpdate('initial_assessments', op.entityId, op, row, 'التقييم');
          if (r.type !== 'done') return r;
        }
        // نفس اللي بتعمله saveAssessment أونلاين: تحديث الشكوى والتشخيص في ملف المريض
        await supabase.from('patients').update({ main_complaint: row.main_complaint, diagnosis: row.medical_diagnosis }).eq('id', String(row.patient_id));
        return { type: 'done' };
      }
      case 'ortho.save': {
        // كشف/أشعة/كسر/عملية: إنشاء بمعرّف الجهاز (التكرار = تعارض مفتاح أساسي ← اتنفّذ قبل كده)، تعديل بكشف تعارض مع نسخة الخادم
        const table = String(op.payload.table);
        if (!/^ortho_(consultations|imaging|fractures|surgeries|nursing)$/.test(table)) return { type: 'failed', error: 'نوع سجل غير معروف' };
        const row = op.payload.row as Record<string, unknown>;
        if (op.payload.isNew) {
          const { error, status } = await supabase.from(table).insert({ ...row, id: op.entityId });
          if (!error || (error.code === '23505' && /pkey|\(id\)/.test(`${error.message} ${error.details ?? ''}`))) return { type: 'done' };
          return classify(error, status) ?? { type: 'failed', error: clean(error.message ?? '') };
        }
        return guardedUpdate(table, op.entityId, op, row, 'السجل الطبي');
      }
      case 'appointment.create': {
        const p = op.payload.p as Record<string, unknown>;
        const params: Record<string, unknown> = { ...p, patientId: op.payload.patientId ?? p.patientId };
        // 1) RPC بمفتاح عملية (هجرة 190)
        const first = await supabase.rpc('offline_book_appointment', { p_key: op.id, p: params });
        if (!first.error) return { type: 'done' };
        const missing = /offline_book_appointment|schema cache|Could not find/i.test(first.error.message ?? '');
        if (!missing) return bookingError(first.error, first.status);
        // 2) الهجرة مش مطبّقة: فحص مطابقة ثم book_appointment العادية
        const { data: dup } = await supabase.from('appointments').select('id').eq('patient_id', String(params.patientId)).eq('therapist_id', String(params.therapistId))
          .eq('service_id', String(params.serviceId)).eq('date', String(params.date)).eq('time', String(params.time)).neq('status', 'cancelled').limit(1);
        if (dup?.length) return { type: 'done' };
        const second = await supabase.rpc('book_appointment', { p: params });
        return second.error ? bookingError(second.error, second.status) : { type: 'done' };
      }
      case 'appointment.reschedule': {
        const { data: cur, error: e0, status: s0 } = await supabase.from('appointments').select('date,time,therapist_id,status').eq('id', op.entityId).maybeSingle();
        const c0 = classify(e0, s0); if (c0) return c0;
        if (!cur) return { type: 'failed', error: 'الموعد لم يعد موجودًا على الخادم.' };
        const to = op.payload as { date: string; time: string; therapistId?: string | null; address?: string | null };
        if (cur.date === to.date && String(cur.time).slice(0, 5) === to.time && (!to.therapistId || cur.therapist_id === to.therapistId)) return { type: 'done' };
        const b = op.base as { date?: string; time?: string } | undefined;
        if (!op.payload.__force && b && (cur.date !== b.date || String(cur.time).slice(0, 5) !== b.time)) {
          return asConflict({ reason: 'server_changed', message: `الموعد اتغيّر على الخادم إلى ${cur.date} ${String(cur.time).slice(0, 5)} بعد ما عدّلته محليًا.`, fields: ['date', 'time'], serverValues: { date: cur.date, time: String(cur.time).slice(0, 5) } });
        }
        if (cur.status === 'cancelled') return { type: 'failed', error: 'الموعد ملغي على الخادم.' };
        const { error, status } = await supabase.rpc('reschedule_appointment', { p_id: op.entityId, p_date: to.date, p_time: to.time, p_therapist: to.therapistId ?? null, p_address: to.address ?? null });
        return error ? bookingError(error, status) : { type: 'done' };
      }
      case 'appointment.cancel': {
        const { data: cur, error: e0, status: s0 } = await supabase.from('appointments').select('status').eq('id', op.entityId).maybeSingle();
        const c0 = classify(e0, s0); if (c0) return c0;
        if (!cur || cur.status === 'cancelled') return { type: 'done' };
        if (['arrived', 'in_progress', 'completed'].includes(cur.status) && !op.payload.__force) {
          return asConflict({ reason: 'server_changed', message: 'المريض حضر/اتنفّذت الجلسة على الخادم بعد ما سجّلت الإلغاء محليًا.', fields: ['status'], serverValues: { status: cur.status } });
        }
        const { error, status } = await supabase.rpc('set_appointment_status', { p_id: op.entityId, p_status: 'cancelled', p_reason: String(op.payload.reason ?? 'إلغاء (مسجّل بدون اتصال)'), p_therapist: null });
        return classify(error, status) ?? { type: 'done' };
      }
    }
  } catch (e) {
    return isNetworkError(e) ? { type: 'retry', error: (e as Error).message } : { type: 'failed', error: (e as Error).message };
  }
}
