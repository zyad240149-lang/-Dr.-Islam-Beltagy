import { Fragment, useState } from 'react';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { Button, Select, StatusBadge } from '../components/ui';
import { ConfirmDialog, useCan } from '../components/common';
import { AREA_LABEL, OP_DESC, OP_LABEL, ROLE_DESC, ROLE_ICON, ROLE_LABEL } from '../services/permissions';
import { AREAS, OPS, ROLES } from '../services/defaultPermissions';
import { AREA_GROUPS, AREA_HELP } from '../services/permissionHelp';
import { useToast } from '../hooks/useToast';
import { Icon } from '../utils/icons';
import type { Area, Op, PermissionMatrix, Role } from '../types';

export default function Roles() {
  useDbVersion();
  const toast = useToast();
  const can = useCan();
  const [role, setRole] = useState<Role>('secretary');
  const [draft, setDraft] = useState<PermissionMatrix>(() => JSON.parse(JSON.stringify(db.permissions())));
  const [resetting, setResetting] = useState(false);
  // موظف محدد (اختياري): صلاحياته الخاصة بتحل محل صلاحيات دوره
  const [empId, setEmpId] = useState('');
  const emp = empId ? db.employees().find((e) => e.id === empId) : undefined;
  const baseEmp = (): Partial<Record<Area, Op[]>> => { const r = JSON.parse(JSON.stringify(db.permissions()[role] ?? {})); return { ...r, ...(emp?.permOverride ?? {}) }; };
  const [empDraft, setEmpDraft] = useState<Partial<Record<Area, Op[]>>>({});
  const pickEmp = (id: string) => {
    setEmpId(id);
    const e = db.employees().find((x) => x.id === id);
    setEmpDraft(e ? { ...JSON.parse(JSON.stringify(db.permissions()[role] ?? {})), ...(e.permOverride ?? {}) } : {});
  };
  const editable = can('roles', 'edit') && role !== 'system_admin';
  const dirty = emp ? JSON.stringify(empDraft) !== JSON.stringify(baseEmp()) : JSON.stringify(draft) !== JSON.stringify(db.permissions());

  const has = (r: Role, a: Area, o: Op) => (emp ? empDraft[a] : draft[r]?.[a])?.includes(o) ?? false;
  const toggle = (a: Area, o: Op) => {
    if (emp) {
      setEmpDraft((d) => { let ops = new Set(d[a] ?? []); if (ops.has(o)) { ops.delete(o); if (o === 'view') ops = new Set(); } else { ops.add(o); ops.add('view'); } return { ...d, [a]: [...ops] as Op[] }; });
      return;
    }
    setDraft((d) => {
      const next: PermissionMatrix = JSON.parse(JSON.stringify(d));
      let ops = new Set(next[role][a] ?? []);
      if (ops.has(o)) { ops.delete(o); if (o === 'view') ops = new Set(); }
      else { ops.add(o); ops.add('view'); } // أي عملية تتطلب العرض
      next[role][a] = [...ops] as Op[];
      return next;
    });
  };
  const setRow = (a: Area, on: boolean) => emp ? setEmpDraft((d) => ({ ...d, [a]: on ? [...OPS] : [] })) : setDraft((d) => { const n: PermissionMatrix = JSON.parse(JSON.stringify(d)); n[role][a] = on ? [...OPS] : []; return n; });

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>الأدوار والصلاحيات</h1><p>حدد لكل دور ما يستطيع عرضه وإضافته وتعديله وحذفه في كل قسم. التغييرات تطبَّق فورًا على كل المستخدمين بهذا الدور.</p></div>
        {can('roles', 'edit') && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="outline" onClick={() => setResetting(true)}>استعادة الافتراضي</Button>
            <Button icon="check" disabled={!dirty} onClick={async () => {
              if (emp) {
                // بنحفظ بس الأقسام اللي مختلفة عن الدور — عشان أي تعديل بعدين على الدور يوصل للموظف في باقي الأقسام
                const roleM = db.permissions()[role] ?? {}; const norm = (x?: Op[]) => JSON.stringify([...(x ?? [])].sort());
                const diff = Object.fromEntries(Object.entries(empDraft).filter(([k, ops]) => norm(ops as Op[]) !== norm(roleM[k as Area])));
                const r = await db.setEmployeePermissions(emp.id, Object.keys(diff).length ? diff : null); if (r.ok) toast.success(`تم حفظ صلاحيات ${emp.name}.`); else toast.error(r.error); return; }
              await db.updatePermissions(draft); toast.success('تم حفظ الصلاحيات.');
            }}>حفظ التغييرات</Button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card__body">
          <div className="section-title" style={{ marginBottom: 10 }}>معاني الصلاحيات</div>
          <div className="grid-form grid-form--4">
            {OPS.map((o) => (
              <div key={o}><strong>{OP_LABEL[o]}</strong><p className="muted" style={{ fontSize: 12.5, margin: '2px 0 0' }}>{OP_DESC[o]}</p></div>
            ))}
          </div>
        </div>
      </div>

      <div className="role-pills">
        {ROLES.map((r) => (
          <Button key={r} type="button" variant={role === r ? 'primary' : 'outline'} size="sm" onClick={() => { setRole(r); setEmpId(''); }}>{ROLE_LABEL[r]}</Button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card__body row-between" style={{ gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span className="choice__ic"><Icon name={ROLE_ICON[role]} size={20} /></span>
            <div>
              <strong>{ROLE_LABEL[role]}</strong>
              <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>{ROLE_DESC[role]}</p>
            </div>
          </div>
          {role !== 'system_admin' && (
            <div style={{ minWidth: 260 }}>
              <Select id="rl-emp" label="اختر موظف (اختياري)" value={empId} onChange={(e) => pickEmp(e.target.value)}
                options={[{ value: '', label: `كل موظفي «${ROLE_LABEL[role]}» (صلاحيات الدور)` }, ...db.employees().filter((e) => e.role === role).map((e) => ({ value: e.id, label: `${e.name}${e.permOverride ? ' — صلاحيات مخصّصة' : ''}${e.active ? '' : ' (معطّل)'}` }))]} />
              {emp?.permOverride && editable && <Button size="sm" variant="ghost" onClick={async () => { const r = await db.setEmployeePermissions(emp.id, null); if (r.ok) { toast.success(`${emp.name} رجع لصلاحيات دوره.`); setEmpDraft(JSON.parse(JSON.stringify(db.permissions()[role] ?? {}))); } else toast.error(r.error); }}>رجوع لصلاحيات الدور</Button>}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card__head row-between" style={{ flexWrap: 'wrap' }}>
          <h2>{emp ? <>صلاحيات الموظف «{emp.name}» ({ROLE_LABEL[role]})</> : <>صلاحيات دور «{ROLE_LABEL[role]}» في كل قسم</>}</h2>
          <StatusBadge label={role === 'system_admin' ? 'ثابت' : dirty ? 'غير محفوظ' : 'محفوظ'} tone={role === 'system_admin' ? 'info' : dirty ? 'warn' : 'ok'} />
        </div>
        <div className="card__body">
          {emp && <div className="alert alert-info" style={{ marginBottom: 12 }}>هذي الصلاحيات خاصة بـ <strong>{emp.name}</strong> فقط، وتحل محل صلاحيات دور «{ROLE_LABEL[role]}» بالنسبة له. ولا يتأثر باقي موظفي الدور. لازم على الموظف تحديث الصفحة أو تسجيل الدخول من جديد لتظهر التغييرات.</div>}
          {role === 'system_admin' && <div className="alert alert-info" style={{ marginBottom: 12 }}>المدير العام يملك كل الصلاحيات دائمًا ولا يمكن تقييده، حتى ما يُقفل النظام.</div>}
          <div className="table-wrap"><table className="table perm-table">
            <thead><tr><th>القسم</th>{OPS.map((o) => <th key={o}>{OP_LABEL[o]}</th>)}<th>الكل</th></tr></thead>
            <tbody>{AREA_GROUPS.map((g) => (
              <Fragment key={g.title}>
                <tr className="perm-group"><td colSpan={OPS.length + 2}><strong>{g.title}</strong> <span className="muted" style={{ fontSize: 12.5 }}>— {g.hint}</span></td></tr>
                {g.areas.filter((a) => a !== 'roles' && a !== 'payroll' && AREAS.includes(a)).map((a) => {
                  const h = AREA_HELP[a]; const single = !!h.ops && Object.keys(h.ops).length === 1;
                  return (
                    <tr key={a}>
                      <td style={{ minWidth: 230 }}>
                        <div style={{ fontWeight: 600 }}>{AREA_LABEL[a]}</div>
                        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 2 }}>{h.desc}</div>
                      </td>
                      {OPS.map((o) => single && o !== 'view' ? <td key={o} className="muted">—</td> : (
                        <td key={o} title={h.ops?.[o] ?? OP_DESC[o]}>
                          <label style={{ display: 'grid', gap: 3, justifyItems: 'center', cursor: editable ? 'pointer' : 'default' }}>
                            <input type="checkbox" aria-label={`${AREA_LABEL[a]} — ${OP_LABEL[o]}`} checked={has(role, a, o)} disabled={!editable} onChange={() => toggle(a, o)} />
                            <span className="muted" style={{ fontSize: 11, lineHeight: 1.35, maxWidth: 130, textAlign: 'center' }}>{single ? 'مسموح' : h.ops?.[o] ?? ''}</span>
                          </label>
                        </td>
                      ))}
                      <td>{single ? null : <input type="checkbox" aria-label={`${AREA_LABEL[a]} — الكل`} checked={OPS.every((o) => has(role, a, o))} disabled={!editable} onChange={(e) => setRow(a, e.target.checked)} />}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}</tbody>
          </table></div>
          <div className="section-title" style={{ marginTop: 16 }}>المستخدمون بهذا الدور</div>
          <p>{db.employees().filter((e) => e.role === role).map((e) => `${e.name}${e.active ? '' : ' (معطّل)'}`).join('، ') || 'ما فيه مستخدمون بهذا الدور.'}</p>
        </div>
      </div>

      <details className="card" style={{ marginTop: 18 }}>
        <summary className="card__head" style={{ cursor: 'pointer' }}><h2>ملخص الصلاحيات لكل الأدوار</h2></summary>
        <div className="card__body">
          <div className="table-wrap"><table className="table perm-table">
            <thead><tr><th>القسم</th>{ROLES.map((r) => <th key={r}>{ROLE_LABEL[r]}</th>)}</tr></thead>
            <tbody>{AREAS.filter((a) => a !== 'roles' && a !== 'payroll').map((a) => (
              <tr key={a}><td style={{ fontWeight: 600 }}>{AREA_LABEL[a]}</td>{ROLES.map((r) => {
                const ops = draft[r]?.[a] ?? [];
                return <td key={r} style={{ fontSize: 12 }}>{ops.length === 0 ? <span className="muted">—</span> : ops.length === 4 ? 'كامل' : ops.map((o) => OP_LABEL[o]).join('، ')}</td>;
              })}</tr>
            ))}</tbody>
          </table></div>
        </div>
      </details>

      {resetting && <ConfirmDialog title="استعادة الصلاحيات الافتراضية" danger={false} confirmLabel="استعادة" onClose={() => setResetting(false)}
        message="سيتم استبدال كل الصلاحيات الحالية لكل الأدوار بالإعداد الافتراضي للنظام."
        onConfirm={async () => { await db.resetPermissions(); setDraft(JSON.parse(JSON.stringify(db.permissions()))); toast.success('تمت استعادة الصلاحيات الافتراضية.'); }} />}
    </div>
  );
}
