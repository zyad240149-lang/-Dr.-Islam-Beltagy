// Supabase Edge Function: "api"
// بوابة API موحّدة تربط لوحة الإدارة (admin) وبوابة العميل (portal) بقاعدة بيانات واحدة.
// تستخدم service_role key من داخل Supabase نفسه فقط — أبدًا لا يصل هذا المفتاح للمتصفح.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const STAFF_TABLES = [
  "patients", "therapists", "services", "rooms", "package_plans", "packages",
  "treatment_plans", "initial_assessments", "treatment_sessions", "employees",
  "inventory_items", "stock_movements", "activity_log", "center_info", "role_permissions",
];
// الاسم الثلاثي بالعربي — نفس is_arabic_name() في القاعدة (هجرة 162)
const ARABIC_NAME = /^[\u0621-\u063A\u0640-\u0652\u0670\u067E\u0686\u0698\u06A9\u06AF\u06CC ]+$/;
const SHARED_TABLES = ["appointments", "invoices", "payments", "notifications"];
const ALL_TABLES = [...STAFF_TABLES, ...SHARED_TABLES, "customers"];

const AREA_BY_TABLE: Record<string, string> = {
  patients: "patients", therapists: "therapists", services: "services", rooms: "rooms",
  package_plans: "packages", packages: "packages", treatment_plans: "plans",
  initial_assessments: "sessions", treatment_sessions: "sessions", employees: "employees",
  inventory_items: "inventory", stock_movements: "inventory", activity_log: "reports",
  center_info: "settings", role_permissions: "roles", appointments: "appointments",
  invoices: "invoices", payments: "payments", notifications: "notifications", customers: "patients",
};

// التحقق من الجوال على الخادم = نفس ملف الواجهة بالظبط (src/utils/phoneUtils.ts، سكربت النشر بيرفعه جنب الدالة)
// → مفيش أي تحقق مكرر أو مختلف بين المتصفح والسيرفر، والتخزين دايمًا E.164.
import { PHONE_ERROR_AR, analyzePhone, countryOptions, e164Digits, isCountryCode, parseStoredPhone, phoneLookupCandidates, type CountryCode } from "./phoneUtils.ts";

// الدولة ممكن تيجي كرمز ISO (SA/EG — الواجهة الجديدة) أو ككود اتصال (966/20 — نسخ قديمة من الموقع)
function toCountry(raw: unknown): CountryCode {
  const s = String(raw ?? "").trim().toUpperCase();
  if (isCountryCode(s)) return s;
  const cc = s.replace(/\D/g, "");
  return countryOptions().find((c) => c.callingCode === cc)?.code ?? "EG";
}
// يرجّع E.164 أو رسالة الخطأ العربية الموحدة
function checkPhone(raw: unknown, country: unknown): { e164: string } | { error: string } {
  const r = analyzePhone(String(raw ?? ""), toCountry(country));
  return r.e164 ? { e164: r.e164 } : { error: PHONE_ERROR_AR[r.error ?? "invalid"] };
}
// كل الصيغ اللي ممكن الرقم يكون اتخزن بيها قبل التوحيد (عشان منع التكرار والبحث يشتغلوا مع البيانات القديمة)
const storedVariants = (e164: string) => phoneLookupCandidates(e164);

// ربط حساب جديد بملف موجود بنفس الموبايل لازم يثبت الملكية بالرقم القومي/الجواز المسجّل في الملف (هجرة 905)
const LINK_ERRORS: Record<string, { status: number; error: string }> = {
  need_id: { status: 409, error: "الرقم ده مسجّل عندنا في ملف مريض. اكتب الرقم القومي (أو رقم جواز السفر) المسجّل في ملفك عشان نربط حسابك بيه." },
  id_mismatch: { status: 403, error: "الرقم القومي مش مطابق للمسجّل في ملفك. راجعه، أو كلّم العيادة." },
  contact_clinic: { status: 409, error: "الرقم ده مسجّل عندنا في ملف مريض من غير رقم قومي، فمش هنقدر نتأكد إنه ملفك. كلّم العيادة يضيفوا رقمك القومي للملف، وبعدها اعمل الحساب." },
  locked: { status: 429, error: "محاولات غلط كتير على الرقم ده. جرّب بعد ساعة، أو كلّم العيادة." },
};
// null = مسموح (ملف جديد أو الرقم القومي مطابق)، غير كده = الرد اللي يترجع للمتصفح
async function linkCheck(phone: string, nationalId: string): Promise<Response | null> {
  const { data, error } = await admin.rpc("register_link_check", { p_phone: phone, p_national_id: nationalId });
  if (error) return json({ error: error.message }, 500);
  if (data?.ok) return null;
  const e = LINK_ERRORS[data?.code] ?? { status: 400, error: "تعذّر التحقق من ملفك — كلّم العيادة" };
  return json({ error: e.error, code: data?.code }, e.status);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// السعودية بدون توقيت صيفي — UTC+3 ثابتة طوال السنة.
function riyadhNow(): { date: string; time: string } {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}

// يطابق منطق is_on_leave() على الخادم (003/024) — الموظف أثناء إجازة/استئذان معتمد
// يُعامل كأنه غير مصرّح له، سواء دخل عبر RPC مباشرة أو عبر هذه الـ Edge Function.
async function isOnLeave(employeeId: string): Promise<boolean> {
  const { date, time } = riyadhNow();
  const { data } = await admin.from("staff_requests").select("type, from_time, to_time")
    .eq("employee_id", employeeId).eq("status", "approved").in("type", ["leave", "permission"])
    .lte("from_date", date).gte("to_date", date);
  return !!data?.some((r) => r.type === "leave" || (r.from_time <= time && time <= r.to_time));
}

async function getCaller(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const uid = data.user.id;

  const { data: employee } = await admin.from("employees").select("*").eq("auth_user_id", uid).eq("active", true).maybeSingle();
  if (employee) return (await isOnLeave(employee.id)) ? null : { kind: "staff" as const, employee };

  const { data: customer } = await admin.from("customers").select("*").eq("auth_user_id", uid).maybeSingle();
  if (customer) return { kind: "customer" as const, customer };

  return null;
}

async function can(role: string, area: string, op: string) {
  if (role === "system_admin" || role === "center_manager") return true;
  const { data } = await admin.from("role_permissions").select("ops").eq("role", role).eq("area", area).maybeSingle();
  return !!data?.ops?.includes(op);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      },
    });
  }

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const table = parts[0];
  const id = parts[1];

  // ===== تسجيل حساب مريض جديد (عام — بدون تسجيل دخول) =====
  if (table === "register" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const name = String(b.name ?? "").trim().replace(/\s+/g, " ");
    const ph = checkPhone(b.phone, b.country);
    const email = String(b.email ?? "").trim().toLowerCase();
    const password = String(b.password ?? "");
    if (name.split(" ").filter(Boolean).length < 3 || !ARABIC_NAME.test(name)) return json({ error: "اكتب اسمك الثلاثي بالعربي (الاسم واسم الأب واسم الجد) — بحروف عربية فقط" }, 400);
    if ("error" in ph) return json({ error: ph.error }, 400);
    const phone = ph.e164;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "البريد الإلكتروني غير صحيح" }, 400);
    if (password.length < 6) return json({ error: "كلمة المرور لازم ما تقل عن 6 خانات" }, 400);
    if (b.confirm !== undefined && b.confirm !== password) return json({ error: "كلمتا المرور غير متطابقتين" }, 400);
    const { count } = await admin.from("customers").select("id", { count: "exact", head: true }).gte("member_since", new Date(Date.now() - 60_000).toISOString());
    if ((count ?? 0) >= 30) return json({ error: "محاولات كثيرة، حاول بعد قليل" }, 429);
    const { data: exists } = await admin.from("customers").select("id").in("phone", storedVariants(phone)).limit(1);
    if (exists?.length) return json({ error: "فيه حساب بهذا الرقم — سجّل الدخول أو تواصل مع المركز" }, 409);
    const nationalId = String(b.nationalId ?? "").trim();
    const blocked = await linkCheck(phone, nationalId);
    if (blocked) return blocked;
    // بريد الدخول الداخلي: c + أرقام E.164 (الحسابات القديمة بصيغ تانية بيدخلوا عادي لأن الدخول بيجرب كل الصيغ)
    const { data: au, error: authErr } = await admin.auth.admin.createUser({ email: "c" + e164Digits(phone) + "@clinic.local", password, email_confirm: true });
    if (authErr || !au.user) return json({ error: authErr?.message ?? "تعذّر إنشاء الحساب" }, 400);
    const { data: reg, error: regErr } = await admin.rpc("register_customer", { p_auth_user: au.user.id, p_name: name, p_phone: phone, p_email: email, p_national_id: nationalId });
    if (regErr) { await admin.auth.admin.deleteUser(au.user.id); return json({ error: regErr.message }, 400); }
    return json({ ok: true, ...reg }, 201);
  }

  if (table === "me") {
    const caller = await getCaller(req);
    if (!caller) return json({ error: "غير مصرح — سجّل الدخول أولًا" }, 401);
    if (caller.kind === "staff") {
      const { data: perms } = await admin.from("role_permissions").select("area, ops").eq("role", caller.employee.role);
      return json({ kind: "staff", employee: caller.employee, permissions: perms ?? [] });
    }
    return json({ kind: "customer", customer: caller.customer });
  }

  // ===== إكمال حساب عميل بعد الدخول بجوجل (المستخدم مسجّل في auth.users بالفعل عبر Google، محتاج ربطه بحساب عميل برقم جوال) =====
  if (table === "google-complete" && req.method === "POST") {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "غير مصرح" }, 401);
    const { data: authData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !authData.user) return json({ error: "غير مصرح" }, 401);
    const uid = authData.user.id;

    const { data: existing } = await admin.from("customers").select("*").eq("auth_user_id", uid).maybeSingle();
    if (existing) return json({ ok: true, customer: existing });

    const b = await req.json().catch(() => ({}));
    const ph = checkPhone(b.phone, b.country);
    if ("error" in ph) return json({ error: ph.error }, 400);
    const phone = ph.e164;
    // الاسم اللي المريض كتبه (ثلاثي)؛ اسم جوجل يتقبل لوحده بس لو هو نفسه ثلاثي — والتحقق النهائي في register_customer
    const googleName = String(authData.user.user_metadata?.full_name ?? authData.user.user_metadata?.name ?? "").trim().replace(/\s+/g, " ");
    const name = String(b.name ?? "").trim().replace(/\s+/g, " ") || googleName;
    if (name.split(" ").filter(Boolean).length < 3 || !ARABIC_NAME.test(name)) return json({ error: "اكتب اسمك الثلاثي بالعربي (الاسم واسم الأب واسم الجد) — بحروف عربية فقط", needName: true, googleName }, 400);
    const email = String(authData.user.email ?? "").trim().toLowerCase();

    const { data: taken } = await admin.from("customers").select("id").in("phone", storedVariants(phone)).limit(1);
    if (taken?.length) return json({ error: "فيه حساب بهذا الرقم بالفعل — سجّل الدخول برقم الجوال بدلًا من جوجل، أو تواصل مع المركز لربط الحسابين" }, 409);
    const nationalId = String(b.nationalId ?? "").trim();
    const blocked = await linkCheck(phone, nationalId);
    if (blocked) return blocked;

    const { data: reg, error: regErr } = await admin.rpc("register_customer", { p_auth_user: uid, p_name: name, p_phone: phone, p_email: email, p_national_id: nationalId });
    if (regErr) return json({ error: regErr.message }, 400);
    return json({ ok: true, ...reg }, 201);
  }

  // ===== الدعم الفني: البحث عن حساب عميل وإعادة تعيين كلمة مروره =====
  if (table === "support" && req.method === "POST") {
    const caller = await getCaller(req);
    if (!caller || caller.kind !== "staff") return json({ error: "غير مصرح — سجّل الدخول بحساب موظف" }, 401);
    if (!(await can(caller.employee.role, "support", "edit"))) return json({ error: "ما فيه صلاحية للدعم الفني" }, 403);
    const body = await req.json().catch(() => ({}));

    // نبحث بحساب واحد محدَّد بالـ id (اللي رجعناه من lookup) عشان reset-password ميلمسش حساب تاني غلط.
    // لو مفيش id (استدعاء قديم أو lookup)، نرجع لمطابقة الرقم — بالمطابقة الكاملة أولًا، وبعدين اللاحقة
    // بس لو نتيجة واحدة فريدة؛ لو فيه أكتر من حساب بنفس آخر 9 أرقام (زي رقم دولي وسعودي بيتقاطعوا) نرفض
    // ونطلب الرقم كامل بدل ما نخمّن حساب عشوائي — ده بالظبط السبب اللي كان بيخلي كلمة المرور تتغيّر لحساب غلط.
    let customer: { id: string; name: string; phone: string; email: string | null; member_since: string; auth_user_id: string | null } | null = null;
    if (body.id) {
      const { data } = await admin.from("customers").select("id, name, phone, email, member_since, auth_user_id").eq("id", body.id).maybeSingle();
      customer = data;
    } else {
      const digits = String(body.phone ?? "").replace(/\D/g, "");
      if (digits.length < 7) return json({ error: "أدخل رقم جوال صحيح" }, 400);
      // نطبّع المدخل (بأي صيغة) لـ E.164 ونطابق كل الصيغ اللي ممكن الحساب يكون اتخزن بيها
      const e164 = parseStoredPhone(String(body.phone ?? ""), toCountry(body.country)).e164;
      const variants = Array.from(new Set([...(e164 ? storedVariants(e164) : []), digits]));
      const { data: exactRows } = await admin.from("customers").select("id, name, phone, email, member_since, auth_user_id").in("phone", variants);
      if (exactRows && exactRows.length > 1) return json({ error: "الرقم يتطابق مع أكثر من حساب — أدخل رقم الجوال كاملًا بدقة." }, 409);
      const exact = exactRows?.[0] ?? null;
      if (exact) customer = exact;
      else {
        const { data: matches } = await admin.from("customers").select("id, name, phone, email, member_since, auth_user_id").ilike("phone", `%${digits.slice(-9)}`);
        if (matches && matches.length > 1) return json({ error: "الرقم يتطابق مع أكثر من حساب — أدخل رقم الجوال كاملًا بدقة." }, 409);
        customer = matches?.[0] ?? null;
      }
    }
    if (!customer || !customer.auth_user_id) return json({ error: "ما فيه حساب إلكتروني مسجّل بهذا الرقم" }, 404);

    if (parts[1] === "lookup") {
      return json({ id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, memberSince: customer.member_since });
    }
    if (parts[1] === "reset-password") {
      const password = String(body.password ?? "");
      if (password.length < 6) return json({ error: "كلمة المرور لازم ما تقل عن 6 خانات" }, 400);
      const { error } = await admin.auth.admin.updateUserById(customer.auth_user_id, { password });
      if (error) return json({ error: error.message }, 400);
      await admin.from("activity_log").insert({ employee_id: caller.employee.id, action: `الدعم الفني: إعادة تعيين كلمة مرور العميل ${customer.name} (${customer.phone})` });
      return json({ ok: true, name: customer.name });
    }
    return json({ error: "عملية غير مدعومة" }, 404);
  }

  // ===== حسابات الموظفين: إنشاء/تعديل/حذف حساب دخول حقيقي (Supabase Auth + جدول employees) =====
  if (table === "staff") {
    const caller = await getCaller(req);
    if (!caller || caller.kind !== "staff") return json({ error: "غير مصرح — سجّل الدخول بحساب موظف" }, 401);
    const opMap: Record<string, string> = { GET: "view", POST: "create", PATCH: "edit", DELETE: "delete" };
    if (!(await can(caller.employee.role, "employees", opMap[req.method] ?? "x"))) return json({ error: "ما فيه صلاحية لإدارة الموظفين" }, 403);
    const ROLES = ["system_admin", "center_manager", "secretary", "therapist", "reception", "accountant"];

    if (req.method === "GET") {
      const { data, error } = await admin.from("employees").select("id, name, username, role, phone, active, created_at, last_login, therapist_id, branch_id, job_title, work_hours").order("created_at");
      if (error) return json({ error: error.message }, 400);
      return json(data);
    }

    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const ph = checkPhone(b.phone, b.country);
      const name = String(b.name ?? "").trim();
      const password = String(b.password ?? "");
      if (!name) return json({ error: "اكتب اسم الموظف" }, 400);
      if ("error" in ph) return json({ error: ph.error }, 400);
      const phone = ph.e164;                 // المخزن في employees.phone
      const username = e164Digits(phone);    // اسم الدخول = أرقام E.164 (بريد الدخول username@clinic.local)
      if (password.length < 6) return json({ error: "كلمة المرور لازم ما تقل عن 6 خانات" }, 400);
      if (!ROLES.includes(b.role)) return json({ error: "دور غير صالح" }, 400);
      if (b.role === "system_admin" && caller.employee.role !== "system_admin") return json({ error: "مدير النظام فقط يقدر ينشئ مدير نظام" }, 403);
      const variants = storedVariants(phone);
      const { data: exists } = await admin.from("employees").select("id")
        .or(`username.in.(${variants.map((v) => `"${v}"`).join(",")}),phone.in.(${variants.map((v) => `"${v}"`).join(",")})`).limit(1);
      if (exists?.length) return json({ error: "فيه حساب موظف بهذا الرقم بالفعل" }, 409);
      const { data: au, error: authErr } = await admin.auth.admin.createUser({ email: `${username}@clinic.local`, password, email_confirm: true });
      if (authErr || !au.user) return json({ error: authErr?.message ?? "تعذّر إنشاء حساب الدخول" }, 400);
      const { data: emp, error } = await admin.from("employees").insert({
        auth_user_id: au.user.id, name, username, role: b.role, phone, active: true,
        therapist_id: b.therapistId || null, branch_id: b.branchId || null, job_title: String(b.jobTitle ?? "").trim(),
        work_hours: Array.isArray(b.workHours) ? b.workHours : [],
      }).select("id, name, username, role, phone, active, created_at, last_login, therapist_id, branch_id, job_title, work_hours").single();
      if (error) { await admin.auth.admin.deleteUser(au.user.id); return json({ error: error.message }, 400); }
      await admin.from("activity_log").insert({ employee_id: caller.employee.id, action: `إضافة حساب موظف: ${name} (${phone})` });
      return json(emp, 201);
    }

    const { data: target } = id ? await admin.from("employees").select("*").eq("id", id).maybeSingle() : { data: null };
    if (!target) return json({ error: "الموظف غير موجود" }, 404);
    const isSelf = target.id === caller.employee.id;
    if (target.role === "system_admin" && caller.employee.role !== "system_admin") return json({ error: "ما تقدر تعدّل حساب مدير النظام" }, 403);

    if (req.method === "PATCH") {
      const b = await req.json().catch(() => ({}));
      const patch: Record<string, unknown> = {};
      if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
      // جوال العرض بيتخزن E.164 (اسم الدخول username مابيتغيرش هنا)
      if (typeof b.phone === "string" && b.phone.trim()) patch.phone = parseStoredPhone(b.phone).e164 ?? b.phone.trim();
      if (Array.isArray(b.workHours)) patch.work_hours = b.workHours;
      if (typeof b.jobTitle === "string") patch.job_title = b.jobTitle.trim();
      if (b.branchId !== undefined) patch.branch_id = b.branchId || null;
      if (b.role !== undefined) {
        if (isSelf && b.role !== target.role) return json({ error: "ما تقدر تغيّر دورك بنفسك" }, 400);
        if (!ROLES.includes(b.role)) return json({ error: "دور غير صالح" }, 400);
        if (b.role === "system_admin" && caller.employee.role !== "system_admin") return json({ error: "فقط مدير النظام يعيّن مدير نظام" }, 403);
        patch.role = b.role;
      }
      if (typeof b.active === "boolean") {
        if (isSelf && !b.active) return json({ error: "ما تقدر تعطّل حسابك" }, 400);
        patch.active = b.active;
      }
      if (b.password) {
        if (String(b.password).length < 6) return json({ error: "كلمة المرور لازم ما تقل عن 6 خانات" }, 400);
        if (!target.auth_user_id) return json({ error: "الحساب غير مربوط بتسجيل دخول" }, 400);
        const { error } = await admin.auth.admin.updateUserById(target.auth_user_id, { password: String(b.password) });
        if (error) return json({ error: error.message }, 400);
      }
      const { data, error } = await admin.from("employees").update(patch).eq("id", id).select("id, name, username, role, phone, active, created_at, last_login, therapist_id, branch_id, job_title, work_hours").single();
      if (error) return json({ error: error.message }, 400);
      await admin.from("activity_log").insert({ employee_id: caller.employee.id, action: `تعديل حساب موظف: ${data.name}` });
      return json(data);
    }

    if (req.method === "DELETE") {
      if (isSelf) return json({ error: "ما تقدر تحذف حسابك" }, 400);
      const { error } = await admin.from("employees").delete().eq("id", id);
      if (error) {
        // مرتبط بسجلات قديمة — نعطّله بدل الحذف ونقفل دخوله
        await admin.from("employees").update({ active: false }).eq("id", id);
      }
      if (target.auth_user_id) await admin.auth.admin.deleteUser(target.auth_user_id);
      await admin.from("activity_log").insert({ employee_id: caller.employee.id, action: `حذف حساب موظف: ${target.name}` });
      return json({ ok: true, disabledOnly: !!error });
    }
    return json({ error: "عملية غير مدعومة" }, 405);
  }

  if (!table || !ALL_TABLES.includes(table)) return json({ error: "جدول غير معروف" }, 404);

  const caller = await getCaller(req);
  if (!caller) return json({ error: "غير مصرح — سجّل الدخول أولًا" }, 401);

  // ===== نطاق العميل: وصول لبياناته فقط عبر customer_id / patient_id =====
  if (caller.kind === "customer") {
    const c = caller.customer;
    if (!SHARED_TABLES.includes(table) && table !== "services" && table !== "therapists" && table !== "customers") {
      return json({ error: "ما فيه صلاحية" }, 403);
    }
    if (req.method !== "GET" && table !== "appointments") {
      return json({ error: "يمكن للعميل فقط حجز موعد أو الاطلاع على بياناته" }, 403);
    }

    if (req.method === "GET") {
      let q = admin.from(table).select("*");
      if (table === "appointments") q = q.eq("customer_id", c.id);
      else if (table === "invoices" || table === "payments") q = q.eq("patient_id", c.patient_id);
      else if (table === "notifications") q = q.eq("customer_id", c.id);
      else if (table === "customers") q = q.eq("id", c.id);
      if (id) q = q.eq("id", id);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 400);
      return json(data);
    }

    if (req.method === "POST" && table === "appointments") {
      const body = await req.json();
      const no = await admin.rpc("next_counter", { p_name: "appointment", p_prefix: "AP-" });
      const { data: svc } = await admin.from("services").select("*").eq("id", body.serviceId).single();
      if (!svc) return json({ error: "خدمة غير موجودة" }, 400);

      const { data: conflict } = await admin.from("appointments")
        .select("id").eq("therapist_id", body.therapistId).eq("date", body.date).eq("time", body.time)
        .not("status", "in", "(cancelled,rescheduled)").maybeSingle();
      if (conflict) return json({ error: "هذا الموعد محجوز بالفعل" }, 409);

      const { data: appt, error } = await admin.from("appointments").insert({
        no: no.data, patient_id: c.patient_id, customer_id: c.id, type: "session",
        service_id: body.serviceId, therapist_id: body.therapistId, date: body.date, time: body.time,
        duration_min: svc.duration_min, price: svc.price, status: "new",
      }).select().single();
      if (error) return json({ error: error.message }, 400);

      const invNo = await admin.rpc("next_counter", { p_name: "invoice", p_prefix: "INV-" });
      await admin.from("invoices").insert({
        no: invNo.data, patient_id: c.patient_id, appointment_id: appt.id,
        service_name: svc.name, price: svc.price, total: svc.price, remaining: svc.price, status: "due",
      });
      await admin.from("notifications").insert({
        audience: "staff", kind: "appointment_new", title: "حجز جديد", body: `حجز جديد من ${c.name}`, ref_id: appt.id,
      });
      return json(appt, 201);
    }

    return json({ error: "عملية غير مدعومة" }, 405);
  }

  // ===== نطاق الموظف (staff) — يمر عبر RBAC role_permissions =====
  const role = caller.employee.role;
  const area = AREA_BY_TABLE[table] ?? table;
  const opMap: Record<string, string> = { GET: "view", POST: "create", PATCH: "edit", DELETE: "delete" };
  const op = opMap[req.method];
  if (!op || !(await can(role, area, op))) return json({ error: "ما فيه صلاحية" }, 403);

  // هذا المسار العام (insert/update/delete خام بدون أي تحقق على مستوى الحقول) بيستخدم مفتاح service_role
  // فبيتخطى RLS بالكامل — والجداول دي مقصود إنها RPC-only بالضبط عشان الكتابة المباشرة فيها بتتخطى منطق
  // العمل الحقيقي (إعادة احتساب الفواتير، منع تعارض الحجز، سجل العمليات، قواعد ترقية الأدوار...) اللي
  // موجود في الدوال المخصصة (book_appointment/record_payment/apply_discount_code/... أو /api/staff).
  // فسمحنا بالقراءة (GET) بس، ومنعنا أي كتابة مباشرة هنا حتى لو الدور عنده صلاحية "تعديل/إضافة" على القسم.
  const RPC_ONLY_TABLES = new Set([
    "appointments", "employees", "treatment_sessions", "treatment_plans", "packages",
    "stock_movements", "inventory_items", "payments", "invoices", "customers",
  ]);
  if (req.method !== "GET" && RPC_ONLY_TABLES.has(table)) {
    return json({ error: "الكتابة المباشرة على هذا الجدول غير مسموحة — استخدم شاشة النظام المخصصة لهذا الإجراء." }, 403);
  }

  if (req.method === "GET") {
    let q = admin.from(table).select("*");
    if (id) q = q.eq("id", id);
    const phoneFilter = url.searchParams.get("phone");
    if (table === "customers" && phoneFilter) {
      const digits = phoneFilter.replace(/\D/g, "").slice(-9);
      q = q.ilike("phone", `%${digits}`);
    }
    const { data, error } = await q;
    if (error) return json({ error: error.message }, 400);
    return json(data);
  }

  if (req.method === "POST") {
    const body = await req.json();
    const { data, error } = await admin.from(table).insert(body).select().single();
    if (error) return json({ error: error.message }, 400);
    return json(data, 201);
  }

  if (req.method === "PATCH" && id) {
    const body = await req.json();
    const { data, error } = await admin.from(table).update(body).eq("id", id).select().single();
    if (error) return json({ error: error.message }, 400);
    return json(data);
  }

  if (req.method === "DELETE" && id) {
    const { error } = await admin.from(table).delete().eq("id", id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "طلب غير صالح" }, 400);
});
