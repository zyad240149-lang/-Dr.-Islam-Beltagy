-- صلاحيات تفصيلية لأزرار مالية/حساسة (طلب الإدارة 2026-10-08) — بتتحدد من «الأدوار والصلاحيات».
-- كل صلاحية منهم: «اطلاع» = مسموح. الافتراضي: كل دور كان عنده الصلاحية العامة الأصلية بياخد الجديدة (مفيش تغيير في السلوك لحد ما تعدّل).
--   inv_approve  اعتماد الفاتورة (مسودة ← مستحقة)         ← كانت invoices:edit
--   inv_price    تعديل سعر/خصم الفاتورة وتطبيق خصم        ← invoices:edit
--   inv_cancel   إلغاء الفاتورة                            ← invoices:edit
--   inv_zatca    تأكيد وإرسال لهيئة الزكاة                 ← invoices:edit
--   appt_confirm تأكيد حضور الموعد (حضر)                   ← appointments:edit
--   appt_cancel  إلغاء الموعد                              ← appointments:edit
insert into role_permissions (role, area, ops)
select rp.role, n.area, '{view}' from role_permissions rp
join (values ('inv_approve','invoices'),('inv_price','invoices'),('inv_cancel','invoices'),('inv_zatca','invoices'),('appt_confirm','appointments'),('appt_cancel','appointments')) n(area, base) on n.base = rp.area
where 'edit' = any(rp.ops) or rp.role = 'system_admin'
on conflict (role, area) do nothing;

do $$ declare src text; begin
  select pg_get_functiondef('public.cancel_invoice(uuid)'::regprocedure) into src;
  if src !~ 'inv_cancel' then execute replace(src, E'begin\n', E'begin\n  perform require_perm(''inv_cancel'', ''view'');\n'); end if;
  select pg_get_functiondef('public.apply_discount(uuid,numeric)'::regprocedure) into src;
  if src !~ 'inv_price' then execute replace(src, E'begin\n', E'begin\n  perform require_perm(''inv_price'', ''view'');\n'); end if;
  select pg_get_functiondef('public.update_plan_invoice(uuid,numeric,numeric,text,boolean)'::regprocedure) into src;
  if src !~ 'inv_price' then execute replace(src, E'begin\n', E'begin\n  perform require_perm(''inv_price'', ''view'');\n  if p_issue then perform require_perm(''inv_approve'', ''view''); end if;\n'); end if;
  select pg_get_functiondef('public.zatca_enqueue(uuid)'::regprocedure) into src;
  if src !~ 'inv_zatca' then execute replace(src, E'begin\n', E'begin\n  perform require_perm(''inv_zatca'', ''view'');\n'); end if;
  select pg_get_functiondef('public.zatca_enqueue_sale(uuid)'::regprocedure) into src;
  if src !~ 'inv_zatca' then execute replace(src, E'begin\n', E'begin\n  perform require_perm(''inv_zatca'', ''view'');\n'); end if;
  select pg_get_functiondef('public.set_appointment_status(uuid,text,text,uuid)'::regprocedure) into src;
  if src !~ 'appt_confirm' then
    execute replace(src, E'  perform require_any(array[''appointments:edit'', ''sessions:edit'']);\n',
      E'  perform require_any(array[''appointments:edit'', ''sessions:edit'']);\n  if p_status = ''arrived'' then perform require_perm(''appt_confirm'', ''view''); end if;\n  if p_status = ''cancelled'' then perform require_perm(''appt_cancel'', ''view''); end if;\n');
  end if;
end $$;
