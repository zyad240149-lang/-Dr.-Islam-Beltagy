-- نوع المتابعة بقى بيتحدد من الخدمة المختارة، والخدمات اللي مش عمليات ولا صور (زي «كشف») مالهاش نوع.
-- فالنوع مابقاش إلزامي. قيد القيم المسموحة (surgery / imaging) لسه موجود.
drop trigger if exists trg_require_kind on ortho_follow_ups;
