-- كارت «من أين يأتي العملاء؟»: تاريخ بداية العدّ (مثل attendance_since) — بيخلّي العدّاد يبدأ من جديد من غير ما نمسح أي مريض.
alter table center_info add column if not exists marketing_since date;
update center_info set marketing_since = (now() at time zone 'Africa/Cairo')::date;
