-- 940: إجمالي سعر العملية والخصم. price فاضل هو المستحق على المريض (الإجمالي ناقص الخصم).
alter table ortho_surgeries
  add column if not exists total_price numeric not null default 0 check (total_price >= 0),
  add column if not exists discount numeric not null default 0 check (discount >= 0);
alter table ortho_surgeries drop constraint if exists ortho_surgeries_discount_within_total;
alter table ortho_surgeries add constraint ortho_surgeries_discount_within_total check (discount <= total_price);

create or replace function public.trg_surgery_pricing_guard() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if old.status = 'done' and (new.total_price, new.discount) is distinct from (old.total_price, old.discount) then
    raise exception 'العملية منتهية — بياناتها المالية ماتتعدلش';
  end if;
  return new;
end $$;
drop trigger if exists trg_surgery_pricing_guard on ortho_surgeries;
create trigger trg_surgery_pricing_guard before update on ortho_surgeries for each row execute function public.trg_surgery_pricing_guard();
revoke execute on function public.trg_surgery_pricing_guard() from public, anon, authenticated;
