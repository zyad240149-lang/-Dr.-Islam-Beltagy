-- تصحيح 106: دوال الهيئة بتتندّه بـ service_role من الـ Edge Function — الفحص لازم يفضل جوه شرط «مش service_role» زي ما كان.
do $$ declare src text; fn text; begin
  foreach fn in array array['public.zatca_enqueue(uuid)', 'public.zatca_enqueue_sale(uuid)'] loop
    select pg_get_functiondef(fn::regprocedure) into src;
    src := replace(src, E'  perform require_perm(''inv_zatca'', ''view'');\n', '');
    src := replace(src, 'perform require_perm(''invoices'', ''edit'')', 'perform require_perm(''inv_zatca'', ''view'')');
    execute src;
  end loop;
end $$;
