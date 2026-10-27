-- كتابة كود الخصم/الولاء بأي شكل تتقبل: أرقام عربية/فارسي، علامات اتجاه مخفية (نسخ من واتساب)، مسافات جوه الكود،
-- شرطة طويلة (– —) أو من غير شرطة خالص. التطابق: الأول بالشكل الموحّد، ولو مالقاش يقارن من غير أي فواصل (بشرط كود واحد بس).
create or replace function normalize_discount_code(p text) returns text
language sql immutable as $$
  select upper(regexp_replace(
    translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹–—−‐‑_', '01234567890123456789------'),
    '[\s​-‏‪-‮⁦-⁩﻿]+', '', 'g'))
$$;

create or replace function find_discount_code(p text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare n text := normalize_discount_code(p); v uuid; cnt int;
begin
  if n = '' then return null; end if;
  select id into v from discount_codes where upper(code) = n;
  if v is not null then return v; end if;
  select count(*), min(id::text)::uuid into cnt, v from discount_codes
    where regexp_replace(upper(code), '[^A-Z0-9]', '', 'g') = regexp_replace(n, '[^A-Z0-9]', '', 'g');
  return case when cnt = 1 then v end;
end $$;

create or replace function apply_discount_code(p_invoice uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv invoices; dc discount_codes; amount numeric; t date := riyadh_today();
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'الفاتورة ملغاة'; end if;
  if inv.discount_code is not null then raise exception 'تم تطبيق الكود % على هذه الفاتورة بالفعل', inv.discount_code; end if;
  select * into dc from discount_codes where id = find_discount_code(p_code) for update;
  if dc.id is null then raise exception 'كود الخصم غير صحيح'; end if;
  if dc.patient_id is not null and dc.patient_id <> inv.patient_id then raise exception 'هذا الكود خاص بمريض آخر ولا يمكن استخدامه هنا'; end if;
  if not dc.active then raise exception 'كود الخصم موقوف'; end if;
  if dc.used_count >= dc.max_uses then raise exception 'تم استهلاك كل مرات استخدام الكود'; end if;
  if t < dc.valid_from then raise exception 'الكود يبدأ من %', dc.valid_from; end if;
  if t > dc.valid_to then raise exception 'انتهت صلاحية الكود في %', dc.valid_to; end if;
  if inv.price < dc.min_amount then raise exception 'الكود يتطلب حدًّا أدنى للطلب % — قيمة الفاتورة %', dc.min_amount, inv.price; end if;
  amount := least(inv.price, case when dc.type = 'percent' then round(inv.price * dc.value / 100) else dc.value end);
  if inv.price - amount < inv.paid then raise exception 'الإجمالي بعد الخصم أقل من المدفوع فعلًا'; end if;
  update invoices set discount = amount, discount_code = dc.code, discount_code_id = dc.id,
    service_name = case when amount >= inv.price then 'جلسة مجانية - مكافأة ولاء' else service_name end
  where id = p_invoice;
  update discount_codes set used_count = used_count + 1 where id = dc.id;
  insert into coupon_usage (coupon_id, invoice_id, patient_id, amount, used_by) values (dc.id, p_invoice, inv.patient_id, amount, my_employee_id());
  perform recalc_invoice(p_invoice);
  perform log_action('تطبيق كود الخصم ' || dc.code || ' (' || amount || ' ر.س) على ' || inv.no, inv.patient_id);
  return jsonb_build_object('amount', amount);
end $$;

revoke execute on function find_discount_code(text) from public, anon;
grant execute on function normalize_discount_code(text), find_discount_code(text) to authenticated;
