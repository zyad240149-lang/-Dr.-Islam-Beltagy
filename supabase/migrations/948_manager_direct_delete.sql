-- 948: المدير (مدير النظام أو مدير المركز) بيحذف الفاتورة والعملية والموعد مباشرة، حتى لو عليهم مدفوعات أو العملية منتهية.
-- باقي الموظفين الحماية القديمة زي ما هي. فاتورة اتبعتت لهيئة الزكاة لسه ماتتحذفش.
create or replace function public.is_center_manager() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from employees where auth_user_id = auth.uid() and active and role in ('system_admin', 'center_manager'));
$$;
revoke all on function public.is_center_manager() from public, anon;
grant execute on function public.is_center_manager() to authenticated;

create or replace function public.delete_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare inv invoices; n_pay int;
begin
  perform require_perm('invoices', 'delete');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if exists (select 1 from zatca_documents where invoice_id = p_invoice and status <> 'awaiting') then
    raise exception 'أُرسلت الفاتورة % إلى هيئة الزكاة — ما يمكن حذفها (ألغِها ليصدر إشعار دائن)', inv.no;
  end if;
  delete from zatca_documents where invoice_id = p_invoice;
  select count(*) into n_pay from payments where invoice_id = p_invoice;
  if inv.discount_code_id is not null then update discount_codes set used_count = greatest(used_count - 1, 0) where id = inv.discount_code_id; end if;
  -- فاتورة عملية منتهية: المدير بس، والعملية بتفضل منتهية من غير فاتورة ولا مدفوع
  if is_center_manager() then
    perform set_config('app.surgery_finish', '1', true);
    update ortho_surgeries set invoice_id = null, paid_at_finish = 0 where invoice_id = p_invoice;
  end if;
  delete from invoices where id = p_invoice; -- الدفعات وبنود الفاتورة وطلبات التقسيط بتتحذف تلقائيًا (cascade)
  perform set_config('app.surgery_finish', '', true);
  perform log_action('حذف الفاتورة ' || inv.no || case when n_pay > 0 then ' مع ' || n_pay || ' دفعة' else '' end, inv.patient_id);
end $$;

create or replace function public.delete_appointment(p_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare a appointments;
begin
  perform require_perm('appointments', 'delete');
  select * into a from appointments where id = p_id;
  if a.id is null then raise exception 'الموعد غير موجود'; end if;
  if exists (select 1 from treatment_sessions where appointment_id = p_id) then raise exception 'للموعد زيارة مسجلة. احذف الزيارة أولًا'; end if;
  if not is_center_manager() and exists (select 1 from payments pay join invoices i on i.id = pay.invoice_id where i.appointment_id = p_id) then
    raise exception 'فاتورة الموعد عليها مدفوعات. احذف المدفوعات أو ألغِ الموعد بدل حذفه';
  end if;
  delete from invoices where appointment_id = p_id;
  delete from appointments where id = p_id;
  perform log_action('حذف الموعد ' || a.no, a.patient_id);
end $$;

-- حذف العملية: المدير بيحذفها مباشرة ولو عليها فاتورة (الفاتورة بتفضل وتتحذف لوحدها)
create or replace function public.trg_surgery_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare finishing boolean := coalesce(current_setting('app.surgery_finish', true), '') = '1';
begin
  if tg_op = 'DELETE' then
    if not is_center_manager() and old.invoice_id is not null and exists (select 1 from invoices where id = old.invoice_id and status <> 'cancelled') then
      raise exception 'العملية عليها فاتورة — ألغِ الفاتورة الأول';
    end if;
    return old;
  end if;
  if not finishing then
    if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
      raise exception 'إنهاء العملية بيتم من زر «إنهاء العملية» بس';
    end if;
    if tg_op = 'UPDATE' and old.status = 'done' and (new.status, new.price, new.cost, new.paid_at_finish, new.invoice_id, new.patient_id, new.finished_at)
        is distinct from (old.status, old.price, old.cost, old.paid_at_finish, old.invoice_id, old.patient_id, old.finished_at) then
      raise exception 'العملية منتهية — بياناتها المالية ماتتعدلش';
    end if;
    if tg_op = 'UPDATE' and (new.paid_at_finish, new.invoice_id, new.finished_at) is distinct from (old.paid_at_finish, old.invoice_id, old.finished_at) then
      raise exception 'البيانات دي بتتسجل عند إنهاء العملية بس';
    end if;
    if tg_op = 'INSERT' and (new.paid_at_finish <> 0 or new.invoice_id is not null or new.finished_at is not null) then
      raise exception 'البيانات دي بتتسجل عند إنهاء العملية بس';
    end if;
  end if;
  return new;
end $$;
