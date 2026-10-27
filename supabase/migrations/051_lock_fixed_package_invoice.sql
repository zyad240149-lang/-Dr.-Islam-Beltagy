-- فاتورة باقة 4/6 جلسات: السعر والخصم يتقفلوا أول ما يبقى فيه طلب تقسيط مفتوح (بانتظار/موافق عليه) أو أي دفعة —
-- عشان مبالغ الدفعتين اللي وافق عليها المدير (50%/50%) ماتتغيرش من ورا الموافقة بتعديل سعر أو كود خصم.
create or replace function guard_fixed_package_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.price is distinct from old.price or new.discount is distinct from old.discount)
     and exists (select 1 from packages where id = new.package_id and kind is not null)
     and (old.paid > 0 or exists (select 1 from package_installment_requests where invoice_id = new.id and status in ('pending','approved'))) then
    raise exception 'لا يمكن تعديل سعر أو خصم فاتورة الباقة بعد طلب التقسيط أو تسجيل دفع';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_fixed_package_invoice on invoices;
create trigger trg_guard_fixed_package_invoice before update of price, discount on invoices
  for each row execute function guard_fixed_package_invoice();
