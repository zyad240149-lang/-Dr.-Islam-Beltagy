-- 956 كان بيكتب في amount وهو عمود محسوب تلقائي (qty × unit_price)
create or replace function public.invoice_add_service(p_invoice uuid, p_service text) returns void
language plpgsql security definer set search_path to 'public' as $function$
declare inv invoices; s services;
begin
  if my_employee_id() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'الفاتورة ملغاة'; end if;
  if inv.package_id is not null then raise exception 'فاتورة باقة — ماينفعش يتضاف عليها خدمة'; end if;
  select * into s from services where id = p_service and active and not coalesce(deleted, false);
  if s.id is null then raise exception 'الخدمة غير موجودة'; end if;
  -- فاتورة قديمة من غير سطور: سعرها الحالي بيبقى أول سطر عشان مايضيعش
  if not exists (select 1 from invoice_items where invoice_id = inv.id) then
    insert into invoice_items (invoice_id, service_id, description, qty, unit_price)
    values (inv.id, null, coalesce(nullif(inv.service_name, ''), 'الخدمة'), 1, inv.price);
  end if;
  insert into invoice_items (invoice_id, service_id, description, qty, unit_price) values (inv.id, s.id, s.name, 1, s.price);
  perform invoice_items_resync(inv.id);
  perform log_action('إضافة خدمة «' || s.name || '» على الفاتورة ' || inv.no, inv.patient_id);
end $function$;

