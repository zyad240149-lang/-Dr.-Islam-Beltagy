# Feature Inventory — عيادة د. إسلام بلتاجي

> مولَّد آليًا من الكود بـ `node scripts/inventory.mjs` بتاريخ 2026-10-26. الأعداد محسوبة من المصدر مباشرة.

## الإجماليات

| البند | العدد |
|---|---|
| صفحات لوحة الإدارة (routes) | 36 |
| صفحات بوابة المريض (/me) | 10 |
| ملفات واجهة (.tsx) | 95 |
| حقول إدخال (Input/Select/textarea/…) | 476 |
| أزرار وإجراءات | 655 |
| نوافذ (Modal) | 81 |
| جداول | 78 |
| دوال خادم (RPC) مستخدمة من الواجهة | 122 |

## الصفحات

| المسار | الصلاحية (area) | المكوّن |
|---|---|---|
| `/` | dashboard | Dashboard |
| `/patients` | patients | Patients |
| `/patients/:id` | patients | PatientProfile |
| `/booking` | booking | Booking |
| `/appointments` | appointments | Appointments |
| `/body-map` | bodymap | BodyMap |
| `/sessions` | sessions | Sessions |
| `/services` | services | Services |
| `/consultations` | patients | Consultations |
| `/imaging` | patients | Imaging |
| `/fractures` | patients | Fractures |
| `/surgeries` | patients | Surgeries |
| `/employees` | employees | Staff |
| `/work-hours` | workhours | WorkHours |
| `/requests` | requests | Requests |
| `/attendance` | attendance | Attendance |
| `/loyalty` | loyalty | Loyalty |
| `/support` | support | Support |
| `/discounts` | discounts | Discounts |
| `/campaigns` | campaigns | Campaigns |
| `/therapists` | therapists | Navigate |
| `/invoices` | invoices | Invoices |
| `/finance` | payroll | Finance |
| `/payroll` | payroll | Payroll |
| `/payroll/staff` | payroll | PayrollStaff |
| `/payroll/reports` | payroll | PayrollReports |
| `/my-target` | mytarget | MyTarget |
| `/payments` | invoices | Navigate |
| `/product-sales` | products | ProductSales |
| `/installments` | installments | Installments |
| `/reports` | reports | Reports |
| `/marketing-report` | marketing | MarketingReport |
| `/online-accounts` | online_accounts | Navigate |
| `/notifications` | notifications | Notifications |
| `/roles` | roles | Roles |
| `/settings` | settings | Settings |

بوابة المريض: `/me`، `/me/book`، `/me/appointments`، `/me/file`، `/me/exams`، `/me/plans`، `/me/points`، `/me/invoices`، `/me/notifications`، `/me/account` — **مفعّلة**: المريض بيعمل حساب من `/signup` (أو من «إنشاء حساب» في صفحة الهبوط) ويدخل من `/login`. مختبَرة في `scripts/e2e-patient.mjs`.

## لكل ملف واجهة

| الملف | حقول | أزرار | نوافذ | جداول | عمليات الخادم |
|---|---|---|---|---|---|
| `src/components/AppointmentActions.tsx` | 16 | 22 | 6 | 0 | db.invoices, db.plan, db.services, db.service, db.therapists, db.therapistsForService… |
| `src/components/AutoNotificationsSettings.tsx` | 5 | 4 | 0 | 3 | rpc:notification_settings, rpc:notification_delivery_report, rpc:save_notification_settings |
| `src/components/BookingWizard.tsx` | 10 | 16 | 2 | 0 | db.center, db.findByPhone, db.searchPatients, db.patients, db.patient, db.services… |
| `src/components/common.tsx` | 0 | 3 | 1 | 0 | — |
| `src/components/DailySchedule.tsx` | 2 | 5 | 0 | 0 | db.center, db.appointments, db.doctorDay, db.allTherapists, db.therapist, db.doctorTimeIssue… |
| `src/components/DetailsHost.tsx` | 1 | 14 | 5 | 3 | db.fileUrl, db.patientFiles, db.appointment, db.uploadPatientFile, db.paymentsForInvoice, db.plan… |
| `src/components/DiagnosisPicker.tsx` | 2 | 7 | 1 | 0 | — |
| `src/components/ErrorBoundary.tsx` | 0 | 2 | 0 | 0 | — |
| `src/components/ExamsTab.tsx` | 0 | 2 | 0 | 0 | db.appointmentsForPatient, db.service, db.assessmentsForPatient, db.sessionsForPatient, db.invoicesForPatient, db.plansForPatient… |
| `src/components/ImportPatientsModal.tsx` | 12 | 9 | 1 | 2 | rpc:patient_import_check, rpc:patient_import_wipe, rpc:patient_import_commit |
| `src/components/InstallmentPatientsTab.tsx` | 2 | 4 | 0 | 1 | db.invoice, db.patient, db.plan, db.planStats |
| `src/components/InvoiceActions.tsx` | 2 | 9 | 2 | 0 | db.updatePatient, db.invoices |
| `src/components/Layout.tsx` | 0 | 5 | 0 | 0 | db.center, db.globalSearch, db.runAutomations, db.setHiddenNotificationKinds, db.unreadCount, db.pendingRequestsCount… |
| `src/components/OfflineStatus.tsx` | 2 | 11 | 1 | 0 | — |
| `src/components/PackagePayment.tsx` | 5 | 7 | 2 | 1 | db.paymentsForInvoice, db.recordPayment, db.refresh, db.invoice, db.patient |
| `src/components/PatientCompleteness.tsx` | 0 | 4 | 1 | 0 | db.patient |
| `src/components/PatientExtras.tsx` | 12 | 12 | 1 | 2 | db.searchPatients, db.appointmentsForPatient, db.saveBodyRecord, db.patient, db.bodyRecords, db.therapist… |
| `src/components/PatientForms.tsx` | 53 | 14 | 5 | 1 | db.updatePatient, db.allTherapists, db.patients, db.createPatient, db.saveAssessment, db.patient… |
| `src/components/PatientLayout.tsx` | 0 | 2 | 0 | 0 | — |
| `src/components/PayrollKit.tsx` | 25 | 31 | 7 | 4 | — |
| `src/components/PhoneInput.tsx` | 2 | 2 | 0 | 0 | — |
| `src/components/PhysioListsSettings.tsx` | 3 | 5 | 0 | 0 | — |
| `src/components/PhysioObjective.tsx` | 5 | 7 | 0 | 0 | — |
| `src/components/PhysioTab.tsx` | 20 | 19 | 3 | 0 | db.patient, db.therapists, db.therapist, db.sessionsForPatient, db.packagesForPatient, db.appointmentsForPatient… |
| `src/components/PlanSessionBooking.tsx` | 4 | 4 | 0 | 1 | db.raw, db.therapistsForService, db.availableSlots, db.doctorTimeIssue, db.plan, db.bookPlanSession… |
| `src/components/QuickPlanModal.tsx` | 4 | 4 | 1 | 0 | db.allServices, db.patient, db.searchPatients, db.savePlan, db.therapists |
| `src/components/ScheduleGrid.tsx` | 0 | 3 | 0 | 0 | db.doctorDay, db.center, db.allTherapists, db.therapist, db.appointmentsForDate, db.appointments… |
| `src/components/SecondSessionHost.tsx` | 0 | 2 | 1 | 0 | rpc:request_second_session |
| `src/components/SecondSessionRequests.tsx` | 1 | 4 | 1 | 1 | rpc:decide_second_session, table:second_session_requests |
| `src/components/SessionDiagnosesList.tsx` | 0 | 1 | 0 | 1 | rpc:session_diagnoses_list |
| `src/components/SessionDiagnosisModal.tsx` | 1 | 3 | 1 | 0 | rpc:session_diagnoses_list, rpc:session_diagnosis_save |
| `src/components/SessionModal.tsx` | 2 | 6 | 2 | 0 | db.patient, db.appointment, db.raw, db.plan, db.planSessionIndex, db.updateSession… |
| `src/components/SitePushCard.tsx` | 2 | 1 | 0 | 0 | rpc:site_push_count |
| `src/components/Tickets.tsx` | 6 | 6 | 0 | 0 | db.tickets, db.createTicket, db.replyTicket, db.setTicketStatus, db.employeeById, db.repliesFor |
| `src/components/ui.tsx` | 3 | 4 | 0 | 0 | — |
| `src/components/WhatsappBulkCard.tsx` | 7 | 4 | 0 | 1 | db.appointments, db.patients, db.allTherapists |
| `src/components/WorkHoursEditor.tsx` | 3 | 1 | 0 | 0 | db.center |
| `src/i18n/LangSwitch.tsx` | 0 | 1 | 0 | 0 | — |
| `src/ortho/Consultations.tsx` | 7 | 5 | 1 | 0 | ortho.save(consultations), ortho.remove(consultations), ortho.list(consultations) |
| `src/ortho/Fractures.tsx` | 8 | 6 | 1 | 0 | ortho.save(fractures), ortho.remove(fractures), ortho.list(fractures) |
| `src/ortho/Imaging.tsx` | 5 | 5 | 1 | 1 | ortho.save(imaging), ortho.remove(imaging), ortho.list(imaging) |
| `src/ortho/kit.tsx` | 2 | 2 | 0 | 0 | db.patients, db.patient |
| `src/ortho/PatientTabs.tsx` | 0 | 1 | 0 | 0 | ortho.list(consultations), ortho.list(imaging), ortho.list(fractures), ortho.list(surgeries) |
| `src/ortho/Surgeries.tsx` | 8 | 5 | 1 | 0 | ortho.save(surgeries), ortho.remove(surgeries), ortho.list(surgeries) |
| `src/pages/Account.tsx` | 4 | 2 | 0 | 0 | db.updateMyProfile, db.changePassword |
| `src/pages/Appointments.tsx` | 5 | 22 | 1 | 2 | db.patient, db.appointmentsForDate, db.appointments, db.allTherapists, db.service, db.therapist… |
| `src/pages/Attendance.tsx` | 2 | 4 | 0 | 1 | db.myAttendanceToday, db.clockIn, db.clockOut, db.attendanceReport, db.employees, db.allTherapists |
| `src/pages/BodyMap.tsx` | 3 | 9 | 1 | 0 | db.raw, db.hideCondition, db.saveCondition |
| `src/pages/Booking.tsx` | 0 | 1 | 0 | 0 | — |
| `src/pages/Campaigns.tsx` | 7 | 4 | 0 | 1 | rpc:campaign_audience |
| `src/pages/Dashboard.tsx` | 0 | 10 | 0 | 0 | db.dashboardStats, db.todayAppointments, db.patients, db.unreadCount, db.appointments, db.appointment… |
| `src/pages/Discounts.tsx` | 12 | 17 | 2 | 0 | db.saveDiscountCode, db.discountCodes, db.discountStatus, db.deleteDiscountCode |
| `src/pages/Employees.tsx` | 8 | 11 | 2 | 1 | db.setEmployees, db.employees, db.activeLeave, db.endStaffLeave, db.therapist, db.updateTherapist… |
| `src/pages/Finance.tsx` | 2 | 3 | 0 | 1 | db.invoices, db.patient, db.searchPatients |
| `src/pages/Installments.tsx` | 5 | 8 | 2 | 1 | db.patient, db.raw, db.invoice, db.plan |
| `src/pages/Invoices.tsx` | 31 | 38 | 3 | 5 | db.appointment, db.invoice, db.center, db.patient, db.paymentsForInvoice, db.plan… |
| `src/pages/Loyalty.tsx` | 9 | 21 | 3 | 2 | db.redeemLoyaltyPoints, db.searchPatients, db.patient, db.patientLoyaltySummary, db.loyaltyLedger, db.cancelDiscountCode… |
| `src/pages/MarketingReport.tsx` | 1 | 1 | 0 | 1 | rpc:marketing_report |
| `src/pages/MyTarget.tsx` | 1 | 0 | 0 | 1 | — |
| `src/pages/Notifications.tsx` | 1 | 8 | 0 | 0 | db.center, db.patients, db.notifications, db.runAutomations, db.markAllNotificationsRead, db.deleteReadNotifications… |
| `src/pages/OnlineAccounts.tsx` | 1 | 0 | 0 | 1 | rpc:online_accounts |
| `src/pages/patient/PatientPages.tsx` | 15 | 34 | 2 | 7 | — |
| `src/pages/PatientProfile.tsx` | 0 | 19 | 0 | 2 | db.patient, db.appointmentsForPatient, db.sessionsForPatient, db.assessmentsForPatient, db.plansForPatient, db.packagesForPatient… |
| `src/pages/Patients.tsx` | 8 | 13 | 0 | 2 | db.queryPatients, db.completedSessionCounts, db.patients, db.updatePatient, db.allTherapists, db.patient… |
| `src/pages/Payroll.tsx` | 3 | 7 | 0 | 1 | — |
| `src/pages/PayrollReports.tsx` | 6 | 2 | 0 | 2 | — |
| `src/pages/PayrollStaff.tsx` | 3 | 5 | 0 | 1 | — |
| `src/pages/ProductSales.tsx` | 28 | 32 | 6 | 4 | db.employees, db.patient, db.searchPatients, db.center |
| `src/pages/Reports.tsx` | 0 | 10 | 1 | 5 | db.patient, db.service, db.therapist, db.invoices, db.paymentsForInvoice, db.center… |
| `src/pages/Requests.tsx` | 13 | 10 | 2 | 0 | db.employees, db.employeeById, db.createStaffRequest, db.decideStaffRequest, db.staffRequests, db.activeLeave |
| `src/pages/Roles.tsx` | 3 | 4 | 0 | 2 | db.permissions, db.employees, db.setEmployeePermissions, db.updatePermissions, db.resetPermissions |
| `src/pages/Services.tsx` | 19 | 23 | 3 | 1 | db.allServices, db.deleteService, db.allPlanServices, db.deletePlanService, db.savePlanService, db.servicePrices… |
| `src/pages/Sessions.tsx` | 1 | 6 | 0 | 1 | db.patient, db.appointmentsForDate, db.sessionByAppointment, db.raw, db.appointment, db.startSession… |
| `src/pages/Settings.tsx` | 22 | 7 | 1 | 1 | db.center, db.updateCenter, db.allPackagePlans, db.service, db.patients, db.appointments… |
| `src/pages/Staff.tsx` | 3 | 10 | 0 | 1 | db.employees, db.allTherapists, db.updateTherapist, db.activeLeave, db.endStaffLeave, db.deleteTherapist |
| `src/pages/Support.tsx` | 3 | 6 | 0 | 0 | db.searchPatients |
| `src/pages/Therapists.tsx` | 11 | 9 | 2 | 1 | db.allTherapists, db.appointments, db.raw, db.employeeById, db.updateTherapist, db.deleteTherapist… |
| `src/pages/WorkHours.tsx` | 2 | 4 | 0 | 0 | db.center, db.updateWeekSchedule |
| `src/pwa/AppLogin.tsx` | 2 | 1 | 0 | 0 | — |
| `src/pwa/PushStatusCard.tsx` | 0 | 2 | 0 | 0 | — |
| `src/pwa/PwaControls.tsx` | 0 | 8 | 2 | 0 | — |

## دوال الخادم المستخدمة (122)

`add_stock_movement` · `apply_discount_code` · `attendance_check_in` · `attendance_report` · `audit_login` · `book_appointment` · `book_plan_session` · `campaign_audience` · `cancel_discount_code` · `cancel_invoice` · `cancel_package` · `cancel_product_sale` · `clock_in` · `clock_out` · `complete_next_plan_session` · `complete_session` · `create_invoice` · `create_staff_request` · `dashboard_stats` · `decide_package_installment` · `decide_second_session` · `decide_staff_request` · `delete_appointment` · `delete_discount_code` · `delete_invoice` · `delete_item` · `delete_patient` · `delete_payment` · `delete_plan` · `delete_plan_service` · `delete_push_subscription` · `delete_service` · `delete_session` · `delete_therapist` · `end_staff_leave` · `finance_month` · `global_search` · `hide_condition` · `list_patients` · `log_invoice_share` · `log_whatsapp_message` · `loyalty_codes_list` · `loyalty_ledger_list` · `mark_invoice_sent` · `marketing_report` · `my_attendance_today` · `my_loyalty_codes` · `my_target` · `notification_delivery_report` · `notification_settings` · `offline_book_appointment` · `online_accounts` · `patient_import_check` · `patient_import_commit` · `patient_import_wipe` · `patient_loyalty_summary` · `payroll_adjust_due` · `payroll_approve_period` · `payroll_close_period` · `payroll_ensure_due` · `payroll_log_list` · `payroll_overview` · `payroll_pay` · `payroll_recalc_due` · `payroll_reopen_period` · `payroll_save_plan` · `payroll_set_basis` · `payroll_set_bonus_rate` · `payroll_subject_detail` · `payroll_void_payout` · `physio_delete_note` · `physio_list_save` · `physio_plan_tracking` · `physio_save_evaluation` · `physio_save_note` · `physio_save_plan` · `physio_set_goals` · `product_add_stock` · `product_delete` · `product_save` · `product_set_quantity` · `record_payment` · `redeem_loyalty_points` · `report_summary` · `request_package_installment` · `request_second_session` · `reschedule_appointment` · `run_automations` · `save_condition` · `save_discount_code` · `save_item` · `save_notification_settings` · `save_permissions` · `save_plan` · `save_plan_service` · `save_push_subscription` · `save_service` · `save_therapist` · `schedule_blocks` · `sell_package` · `sell_product` · `send_campaign` · `session_diagnoses_list` · `session_diagnosis_save` · `set_appointment_status` · `set_employee_extra_perms` · `set_employee_permissions` · `set_invoice_name` · `set_service_doctors` · `site_push_count` · `staff_directory` · `start_session` · `update_appointment_details` · `update_installment_dates` · `update_loyalty_settings` · `update_my_profile` · `update_payment` · `update_plan_invoice` · `update_plan_sessions` · `update_session` · `update_week_schedule` · `void_package_payment`
