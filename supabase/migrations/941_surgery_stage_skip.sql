-- 941: تخطي مرحلة العملية. المرحلة المتخطاة مابتمنعش إنهاء العملية.
alter table ortho_surgery_stages drop constraint if exists ortho_surgery_stages_status_check;
alter table ortho_surgery_stages add constraint ortho_surgery_stages_status_check check (status in ('pending', 'in_progress', 'done', 'skipped'));

create or replace function public.finish_surgery(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare s ortho_surgeries; v_price numeric := _num(p, 'price', 0); v_cost numeric := _num(p, 'cost', 0); v_paid numeric := _num(p, 'paid', 0);
  v_method text := _txt(p, 'method'); inv uuid; it jsonb; over boolean := coalesce((p->>'overdraw')::boolean, false);
begin
  perform require_perm('sessions', 'edit');
  select * into s from ortho_surgeries where id = _uuid(p, 'id') for update;
  if s.id is null then raise exception 'العملية غير موجودة'; end if;
  if s.status = 'done' then return jsonb_build_object('alreadyDone', true, 'invoiceId', s.invoice_id); end if;
  if not exists (select 1 from ortho_surgery_stages where surgery_id = s.id) then raise exception 'أضف مراحل العملية الأول'; end if;
  if exists (select 1 from ortho_surgery_stages where surgery_id = s.id and status not in ('done', 'skipped')) then raise exception 'فيه مراحل لسه ماخلصتش — حدّث حالتها الأول'; end if;
  if v_price < 0 or v_cost < 0 or v_paid < 0 then raise exception 'المبالغ ما ينفع تكون سالبة'; end if;
  if v_paid > v_price then raise exception 'المدفوع أكبر من المبلغ المستحق'; end if;
  if v_paid > 0 and not is_payment_method(v_method) then raise exception 'طريقة الدفع غير صحيحة'; end if;
  if over and not (is_admin() or has_perm('inv_overdraw', 'view')) then raise exception 'صرف كمية أكبر من المتاح محتاج صلاحية خاصة'; end if;

  perform set_config('app.surgery_finish', '1', true);
  if v_price > 0 then
    inv := new_invoice(s.patient_id, 'عملية: ' || s.procedure, v_price, 'due', riyadh_today());
    if v_paid > 0 then
      insert into payments (invoice_id, patient_id, amount, method, note, created_by)
      values (inv, s.patient_id, v_paid, v_method, 'مدفوع عند إنهاء العملية', my_employee_id());
      perform recalc_invoice(inv);
    end if;
  end if;
  if jsonb_typeof(p->'supplies') = 'array' then
    for it in select * from jsonb_array_elements(p->'supplies') loop
      perform stock_move_core(_uuid(it, 'itemId'), 'issue', _num(it, 'qty'), 0, 'عملية: ' || s.procedure, '', 'surgery:' || s.id || ':' || _txt(it, 'itemId'), over, s.id);
    end loop;
  end if;
  update ortho_surgeries set status = 'done', price = v_price, cost = v_cost, paid_at_finish = v_paid, invoice_id = inv, finished_at = now(), finished_by = my_employee_id() where id = s.id;
  perform set_config('app.surgery_finish', '', true);
  perform log_action('إنهاء عملية ' || s.procedure || ' — المستحق ' || v_price || ' ج.م، المدفوع ' || v_paid || ' ج.م', s.patient_id);
  return jsonb_build_object('alreadyDone', false, 'invoiceId', inv);
end $$;
revoke all on function public.finish_surgery(jsonb) from public, anon;
grant execute on function public.finish_surgery(jsonb) to authenticated;
