# Requirements Traceability — عيادة د. إسلام بلتاجي

> مولَّد آليًا. «مختبَر» = له اختبار تكامل حقيقي على Supabase في `scripts/e2e.mjs` (آخر تشغيل: 2026-10-26T15:40:49.018Z — 113 نجح / 0 فشل). «غير مختبَر آليًا» = الكود موجود ومربوط بالخادم لكن مالوش اختبار آلي بعد.

## نتائج اختبارات التكامل

| الاختبار | النتيجة |
|---|---|
| الزائر بدون دخول ما يقدر يقرا المرضى | ✅ نجح |
| كلمة مرور غلط مرفوضة | ✅ نجح |
| المدير يدخل و /api/me يرجّع موظف | ✅ نجح |
| إنشاء ملف طبيب (save_therapist) | ✅ نجح |
| إنشاء حساب استقبال | ✅ نجح |
| إنشاء حساب طبيب مربوط بملفه | ✅ نجح |
| رقم موظف مكرر مرفوض | ✅ نجح |
| كلمة مرور قصيرة مرفوضة | ✅ نجح |
| الاستقبال ما يقدر ينشئ موظفين | ✅ نجح |
| الاستقبال يضيف مريض ورقم الملف يتولد تلقائي | ✅ نجح |
| المريض محفوظ فعلًا في القاعدة | ✅ نجح |
| بحث المرضى بالاسم (list_patients) | ✅ نجح |
| حجز موعد من الاستقبال | ✅ نجح |
| حجز نفس الوقت لنفس الطبيب مرفوض من الخادم | ✅ نجح |
| حجز خارج ساعات العمل مرفوض | ✅ نجح |
| حجزين متزامنين على نفس الوقت: واحد بس ينجح | ✅ نجح |
| الفاتورة اتعملت تلقائيًا مع الحجز بسعر الخدمة | ✅ نجح |
| دفع أكبر من المتبقي مرفوض | ✅ نجح |
| تسجيل دفعة جزئية | ✅ نجح |
| الخادم حسب المدفوع والمتبقي والحالة | ✅ نجح |
| الاستقبال ما يشوفش الرواتب | ✅ نجح |
| المدير يشوف الرواتب | ✅ نجح |
| لوحة الاستقبال بدون أرقام الإيراد | ✅ نجح |
| الاستقبال ما يقدرش يكتب تشخيص | ✅ نجح |
| الطبيب يسجّل كشف وتشخيص | ✅ نجح |
| الكشف محفوظ باسم الطبيب | ✅ نجح |
| الاستقبال يقرا الكشف (عرض فقط) | ✅ نجح |
| تشخيص فاضي مرفوض من القاعدة | ✅ نجح |
| موعد فك الجبس قبل التركيب مرفوض | ✅ نجح |
| الاستقبال ما يقدرش يحذف كشف | ✅ نجح |
| إضافة الكشف متسجلة في سجل التدقيق | ✅ نجح |
| ملف طبيب الاختبار | ✅ نجح |
| حساب استقبال اختبار وحدات | ✅ نجح |
| حساب محاسب اختبار وحدات | ✅ نجح |
| حساب طبيب اختبار وحدات | ✅ نجح |
| حجز موعد (حالة جديد) لمريض بدون رقم قومي مسموح | ✅ نجح |
| تأكيد الموعد مرفوض والملف ناقص الرقم القومي | ✅ نجح |
| رقم هوية بالشكل السعودي (10 أرقام) مرفوض من القاعدة | ✅ نجح |
| رقم جواز سفر قصير مرفوض | ✅ نجح |
| رقم قومي مصري (14 رقم) → التأكيد ينجح | ✅ نجح |
| الأجنبي برقم جواز سفر يعتبر ملفه مكتمل | ✅ نجح |
| إضافة باقة للكتالوج (المدير) | ✅ نجح |
| الاستقبال ما يقدرش يبيع باقة (عرض فقط) | ✅ نجح |
| المحاسب يبيع الباقة | ✅ نجح |
| الباقة فعّالة بعدد جلسات وسعر الكتالوج | ✅ نجح |
| فاتورة الباقة اتعملت بقيمتها | ✅ نجح |
| شراء الباقة أضاف 4 نقاط ولاء | ✅ نجح |
| تسجيل حضور جلسة من الباقة (زيارة مباشرة) | ✅ نجح |
| جلسة ثانية في نفس اليوم مرفوضة بدون موافقة المدير | ✅ نجح |
| قائمة حضور الباقات بتعرض المتبقي صح | ✅ نجح |
| دفعة جزئية على فاتورة الباقة | ✅ نجح |
| الاستقبال ما يقدرش يلغي باقة | ✅ نجح |
| المدير يلغي الباقة | ✅ نجح |
| فاتورة عليها مدفوعات مابتتلغيش مع الباقة | ✅ نجح |
| نقاط الباقة اتسحبت بعد الإلغاء | ✅ نجح |
| حضور على باقة ملغاة مرفوض | ✅ نجح |
| باقة الـ4 جلسات بتبدأ «بانتظار الدفع» | ✅ نجح |
| الاستقبال يطلب الدفع على دفعتين | ✅ نجح |
| الاستقبال ما يقدرش يوافق على التقسيط | ✅ نجح |
| المدير يوافق على التقسيط | ✅ نجح |
| القسطين نص الإجمالي | ✅ نجح |
| طلب تقسيط تاني لنفس الفاتورة مرفوض | ✅ نجح |
| إضافة منتج بكمية افتتاحية | ✅ نجح |
| كود منتج (SKU) مكرر مرفوض | ✅ نجح |
| سعر سالب مرفوض | ✅ نجح |
| الطبيب ما يقدرش يبيع منتجات | ✅ نجح |
| الاستقبال يبيع 2 لعميل بدون جنسية (مصري افتراضي) | ✅ نجح |
| إجمالي البيع 300 بدون ضريبة | ✅ نجح |
| تكرار نفس العملية (نفس المفتاح) مابيخصمش مرتين | ✅ نجح |
| بيع كمية أكبر من المتاح مرفوض | ✅ نجح |
| بيعتين متزامنتين لآخر قطعة: واحدة بس تنجح | ✅ نجح |
| المخزون صفر بعد البيع | ✅ نجح |
| الاستقبال ما يقدرش يلغي بيع | ✅ نجح |
| المدير يلغي البيع والكمية ترجع للمخزون | ✅ نجح |
| إلغاء نفس البيع مرتين مرفوض | ✅ نجح |
| حذف منتج له مبيعات = تعطيله بس | ✅ نجح |
| رصيد المريض 40 نقطة | ✅ نجح |
| الطبيب ما يقدرش يستبدل نقاط | ✅ نجح |
| الاستقبال يستبدل 30 نقطة بكود جلسة مجانية | ✅ نجح |
| تكرار نفس الاستبدال مابيخصمش مرتين | ✅ نجح |
| استبدال برصيد غير كافي مرفوض | ✅ نجح |
| قيمة الكود = سعر جلسة التأهيل (300) | ✅ نجح |
| سجل النقاط فيه الاستبدال (−30) | ✅ نجح |
| مفيش حضور مسجّل في البداية | ✅ نجح |
| انصراف قبل الحضور مرفوض | ✅ نجح |
| تسجيل الحضور | ✅ نجح |
| تسجيل الحضور مرتين بيحتفظ بأول وقت | ✅ نجح |
| تسجيل الانصراف | ✅ نجح |
| الانصراف مرتين مرفوض | ✅ نجح |
| الاستقبال ما يشوفش تقرير حضور الكل | ✅ نجح |
| المدير يشوف حضور الموظف في التقرير | ✅ نجح |
| الاستقبال ما يقدرش يحدد رواتب | ✅ نجح |
| نسبة عمولة أكبر من 100% مرفوضة | ✅ نجح |
| المدير يحدد راتب + عمولة 10% للطبيب | ✅ نجح |
| المدير يحدد راتب ثابت للاستقبال | ✅ نجح |
| راتب ثابت لحساب طبيب كموظف إداري مرفوض | ✅ نجح |
| «تارجتي»: الإيراد 1200 من تارجت 1000 = وصل | ✅ نجح |
| «تارجتي»: العمولة 10% = 120 | ✅ نجح |
| الاستقبال مالوش «تارجتي» | ✅ نجح |
| اعتماد الشهر بيثبّت مستحقين (الطبيب والاستقبال) | ✅ نجح |
| مستحق الطبيب: راتب 3000 + عمولة 120 | ✅ نجح |
| مستحق الاستقبال: راتب 2500 | ✅ نجح |
| صرف راتب الطبيب | ✅ نجح |
| تكرار نفس الصرف (نفس المفتاح) مابيتسجّلش مرتين | ✅ نجح |
| صرف أكتر من المستحق مرفوض | ✅ نجح |
| صرف بتاريخ في المستقبل مرفوض | ✅ نجح |
| صرف العمولة | ✅ نجح |
| إلغاء اعتماد شهر عليه صرف مرفوض | ✅ نجح |
| المالية: رواتب 3000 + عمولات 120 + فواتير 1200 | ✅ نجح |
| الاستقبال ما يشوفش المالية | ✅ نجح |
| إغلاق الشهر | ✅ نجح |
| إلغاء صرف مرة واحدة بس | ✅ نجح |
| الصرف الملغي مابيتحسبش في الرواتب | ✅ نجح |

## الصفحات ← العمليات ← الحالة

| الصفحة | الصلاحية | العمليات في ملف الصفحة | حالة الاختبار |
|---|---|---|---|
| `/` | dashboard | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/patients` | patients | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/patients/:id` | patients | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/booking` | booking | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/appointments` | appointments | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/body-map` | bodymap | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/sessions` | sessions | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/services` | services | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/consultations` | patients | ortho.save(consultations), ortho.remove(consultations), ortho.list(consultations) | غير مختبَر آليًا |
| `/imaging` | patients | ortho.save(imaging), ortho.remove(imaging), ortho.list(imaging) | غير مختبَر آليًا |
| `/fractures` | patients | ortho.save(fractures), ortho.remove(fractures), ortho.list(fractures) | غير مختبَر آليًا |
| `/surgeries` | patients | ortho.save(surgeries), ortho.remove(surgeries), ortho.list(surgeries) | غير مختبَر آليًا |
| `/employees` | employees | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/work-hours` | workhours | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/requests` | requests | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/attendance` | attendance | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/loyalty` | loyalty | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/support` | support | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/discounts` | discounts | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/campaigns` | campaigns | campaign_audience | غير مختبَر آليًا |
| `/therapists` | therapists | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/invoices` | invoices | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/finance` | payroll | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/payroll` | payroll | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/payroll/staff` | payroll | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/payroll/reports` | payroll | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/my-target` | mytarget | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/payments` | invoices | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/product-sales` | products | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/installments` | installments | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/reports` | reports | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/marketing-report` | marketing | marketing_report | غير مختبَر آليًا |
| `/online-accounts` | online_accounts | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/notifications` | notifications | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/roles` | roles | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |
| `/settings` | settings | — | عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة |

## دوال الخادم ← الاختبار

| الدالة | مختبَرة آليًا |
|---|---|
| `add_stock_movement` | — |
| `apply_discount_code` | — |
| `attendance_check_in` | ✅ |
| `attendance_report` | ✅ |
| `audit_login` | — |
| `book_appointment` | ✅ |
| `book_plan_session` | — |
| `campaign_audience` | — |
| `cancel_discount_code` | — |
| `cancel_invoice` | — |
| `cancel_package` | ✅ |
| `cancel_product_sale` | ✅ |
| `clock_in` | ✅ |
| `clock_out` | ✅ |
| `complete_next_plan_session` | — |
| `complete_session` | — |
| `create_invoice` | — |
| `create_staff_request` | — |
| `dashboard_stats` | ✅ |
| `decide_package_installment` | ✅ |
| `decide_second_session` | — |
| `decide_staff_request` | — |
| `delete_appointment` | — |
| `delete_discount_code` | — |
| `delete_invoice` | — |
| `delete_item` | — |
| `delete_patient` | — |
| `delete_payment` | — |
| `delete_plan` | — |
| `delete_plan_service` | — |
| `delete_push_subscription` | — |
| `delete_service` | — |
| `delete_session` | — |
| `delete_therapist` | — |
| `end_staff_leave` | — |
| `finance_month` | ✅ |
| `global_search` | — |
| `hide_condition` | — |
| `list_patients` | ✅ |
| `log_invoice_share` | — |
| `log_whatsapp_message` | — |
| `loyalty_codes_list` | — |
| `loyalty_ledger_list` | ✅ |
| `mark_invoice_sent` | — |
| `marketing_report` | — |
| `my_attendance_today` | ✅ |
| `my_loyalty_codes` | — |
| `my_target` | ✅ |
| `notification_delivery_report` | — |
| `notification_settings` | — |
| `offline_book_appointment` | — |
| `online_accounts` | — |
| `patient_import_check` | — |
| `patient_import_commit` | — |
| `patient_import_wipe` | — |
| `patient_loyalty_summary` | ✅ |
| `payroll_adjust_due` | — |
| `payroll_approve_period` | ✅ |
| `payroll_close_period` | ✅ |
| `payroll_ensure_due` | — |
| `payroll_log_list` | — |
| `payroll_overview` | ✅ |
| `payroll_pay` | ✅ |
| `payroll_recalc_due` | — |
| `payroll_reopen_period` | ✅ |
| `payroll_save_plan` | ✅ |
| `payroll_set_basis` | — |
| `payroll_set_bonus_rate` | — |
| `payroll_subject_detail` | — |
| `payroll_void_payout` | ✅ |
| `physio_delete_note` | — |
| `physio_list_save` | — |
| `physio_plan_tracking` | — |
| `physio_save_evaluation` | — |
| `physio_save_note` | — |
| `physio_save_plan` | — |
| `physio_set_goals` | — |
| `product_add_stock` | — |
| `product_delete` | ✅ |
| `product_save` | ✅ |
| `product_set_quantity` | — |
| `record_payment` | ✅ |
| `redeem_loyalty_points` | ✅ |
| `report_summary` | — |
| `request_package_installment` | ✅ |
| `request_second_session` | — |
| `reschedule_appointment` | — |
| `run_automations` | — |
| `save_condition` | — |
| `save_discount_code` | — |
| `save_item` | — |
| `save_notification_settings` | — |
| `save_permissions` | — |
| `save_plan` | — |
| `save_plan_service` | — |
| `save_push_subscription` | — |
| `save_service` | — |
| `save_therapist` | ✅ |
| `schedule_blocks` | — |
| `sell_package` | ✅ |
| `sell_product` | ✅ |
| `send_campaign` | — |
| `session_diagnoses_list` | — |
| `session_diagnosis_save` | — |
| `set_appointment_status` | ✅ |
| `set_employee_extra_perms` | — |
| `set_employee_permissions` | — |
| `set_invoice_name` | — |
| `set_service_doctors` | — |
| `site_push_count` | — |
| `staff_directory` | — |
| `start_session` | — |
| `update_appointment_details` | — |
| `update_installment_dates` | — |
| `update_loyalty_settings` | — |
| `update_my_profile` | — |
| `update_payment` | — |
| `update_plan_invoice` | — |
| `update_plan_sessions` | — |
| `update_session` | — |
| `update_week_schedule` | — |
| `void_package_payment` | — |
