-- تصحيح: مُنشئ التذكرة يقدر يغلقها هو بنفسه (زر "إغلاق" في Tickets.tsx متاح للجميع بتصميم) —
-- الإصدار السابق من enforce_ticket_update كان بيمنع حتى هذا الإغلاق الذاتي. أي تغيير آخر
-- (قيد المعالجة/تم الحل/الأولوية/الإسناد/التصنيف) لسه يحتاج صلاحية support:edit زي ما هو مقصود.
create or replace function enforce_ticket_update() returns trigger
language plpgsql as $$
begin
  if has_perm('support', 'edit') then
    return new;
  end if;
  if new.created_by = my_employee_id() and new.status = 'closed'
     and new.priority is not distinct from old.priority
     and new.assigned_to is not distinct from old.assigned_to
     and new.category is not distinct from old.category then
    return new;
  end if;
  if new.status is distinct from old.status or new.priority is distinct from old.priority or new.assigned_to is distinct from old.assigned_to or new.category is distinct from old.category then
    raise exception 'لا تملك صلاحية تغيير حالة التذكرة أو أولويتها أو إسنادها' using errcode = '42501';
  end if;
  return new;
end $$;
