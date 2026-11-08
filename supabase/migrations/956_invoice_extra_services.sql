-- ٨/١١: «إضافة خدمة» على الموعد (جبس، أشعة، …): كل خدمة سطر في نفس الفاتورة، والسعر يزيد — فاتورة واحدة للزيارة
create or replace function public.invoice_items_resync(p_invoice uuid) returns void
language plpgsql security definer set search_path to 'public' as $function$
begin
  update invoices i set
    price = coalesce((select sum(amount) from invoice_items where invoice_id = i.id), 0),
    service_name = left(coalesce((select string_agg(description, ' + ' order by ctid) from invoice_items where invoice_id = i.id), service_name), 300)
  where id = p_invoice;
  perform recalc_invoice(p_invoice);
end $function$;

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
    insert into invoice_items (invoice_id, service_id, description, qty, unit_price, amount)
    values (inv.id, null, coalesce(nullif(inv.service_name, ''), 'الخدمة'), 1, inv.price, inv.price);
  end if;
  insert into invoice_items (invoice_id, service_id, description, qty, unit_price, amount) values (inv.id, s.id, s.name, 1, s.price, s.price);
  perform invoice_items_resync(inv.id);
  perform log_action('إضافة خدمة «' || s.name || '» على الفاتورة ' || inv.no, inv.patient_id);
end $function$;

create or replace function public.invoice_remove_item(p_item uuid) returns void
language plpgsql security definer set search_path to 'public' as $function$
declare it invoice_items; inv invoices;
begin
  if my_employee_id() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into it from invoice_items where id = p_item;
  if it.id is null then raise exception 'الخدمة غير موجودة'; end if;
  select * into inv from invoices where id = it.invoice_id for update;
  if inv.status = 'cancelled' then raise exception 'الفاتورة ملغاة'; end if;
  if (select count(*) from invoice_items where invoice_id = inv.id) <= 1 then raise exception 'دي الخدمة الأساسية — ماينفعش تتشال'; end if;
  if inv.paid > (select coalesce(sum(amount), 0) from invoice_items where invoice_id = inv.id and id <> p_item) then
    raise exception 'المدفوع أكبر من الفاتورة بعد الحذف — ألغِ الدفعة الأول';
  end if;
  delete from invoice_items where id = p_item;
  perform invoice_items_resync(inv.id);
  perform log_action('حذف خدمة «' || it.description || '» من الفاتورة ' || inv.no, inv.patient_id);
end $function$;

revoke all on function public.invoice_items_resync(uuid) from public, anon, authenticated;
revoke all on function public.invoice_add_service(uuid, text) from public, anon;
revoke all on function public.invoice_remove_item(uuid) from public, anon;
grant execute on function public.invoice_add_service(uuid, text) to authenticated;
grant execute on function public.invoice_remove_item(uuid) to authenticated;
