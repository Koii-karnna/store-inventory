import { useMemo, useState } from 'react';
import { serverTimestamp } from 'firebase/firestore';
import { useData } from '../state.jsx';
import { AsyncButton, Badge, Empty, toast } from '../ui.jsx';
import { commit, updateItem } from '../lib/db.js';
import { itemId, fmtDateTime } from '../lib/model.js';
import { nextCode, nextSub, composeName, checkName, mmyyNow } from '../lib/codegen.js';
import ItemDrawer from './ItemDrawer.jsx';

const NEW_SUB = '__new__';
const EMPTY_NAME = { type: '', kind: '', model: '', spec: '', brand: '' };

const copy = async (text, label) => {
  try { await navigator.clipboard.writeText(text); toast(`คัดลอก${label}แล้ว`); } catch { toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกด Ctrl+C', 'err'); }
};
const CopyBtn = ({ text, label }) => <button className="btn btn-sm" onClick={() => copy(text, label)} disabled={!text}>คัดลอก{label}</button>;

export default function NewCode() {
  const { building, byBuilding, taxonomy, brands, user } = useData();
  const rows = byBuilding[building];
  const subs = taxonomy?.subs || [];
  const [group, setGroup] = useState('');
  const [sub, setSub] = useState('');
  const [gg, setGg] = useState('');
  const [mmyy, setMmyy] = useState(mmyyNow());
  const [newSubName, setNewSubName] = useState('');
  const [parts, setParts] = useState(EMPTY_NAME);
  const [unit, setUnit] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(null);
  const [openId, setOpenId] = useState(null);

  const cmcGroups = useMemo(() => [...new Set(subs.map((s) => s.group))].sort(), [subs]);
  const groupSubs = subs.filter((s) => s.group === group && !s.closed).sort((a, b) => a.code.localeCompare(b.code));
  const npCodes = (taxonomy?.npCodes || []).filter((n) => n.gg !== '20');
  const units = useMemo(() => [...new Set(rows.flatMap((r) => [r.m?.unit, r.g?.unit]).filter((u) => u && !/^\d/.test(u)))].sort((a, b) => a.localeCompare(b, 'th')), [rows]);
  const codes = rows.map((r) => r.code);

  // รหัสที่จะได้
  let proposal = null, codeError = '';
  try {
    if (building === 'CMC' && sub && sub !== NEW_SUB) proposal = nextCode({ building, sub, mmyy }, codes);
    if (building === 'NP' && gg) proposal = nextCode({ building, gg }, codes);
  } catch (e) { codeError = e.message; }
  const proposedSub = building === 'CMC' && sub === NEW_SUB && group ? (() => { try { return nextSub(group, subs); } catch (e) { return e; } })() : null;
  const itemGroup = building === 'CMC' ? group : npCodes.find((n) => n.gg === gg)?.group || '';

  const isAV = building === 'CMC' ? sub === '3661' : itemGroup === 'NP-AV';
  const avTag = isAV ? (building === 'CMC' && proposal ? `(AV${String(proposal.seq).padStart(2, '0')})` : '(AV)') : null;
  const brand = parts.brand.trim().toUpperCase();
  const name = composeName({ ...parts, brand }, { avTag });
  // ยี่ห้อถูกแปลงเป็นตัวพิมพ์ใหญ่ให้อัตโนมัติ
  const check = useMemo(() => checkName(name, { brands, items: rows, brand, model: parts.model }), [name, brands, rows, brand, parts.model]);
  const pending = rows.filter((r) => r.pending && !r.pending.cancelled).sort((a, b) => (b.pending.at?.seconds || 0) - (a.pending.at?.seconds || 0));
  const p = (k) => (e) => setParts((x) => ({ ...x, [k]: e.target.value }));

  const openSub = async () => {
    if (!(typeof proposedSub === 'string')) throw new Error(proposedSub?.message || 'เลือก Group ก่อน');
    if (!newSubName.trim()) throw new Error('ตั้งชื่อหมวดย่อยใหม่ก่อน');
    const s = { code: proposedSub, name: newSubName.trim(), group, closed: false, createdInWeb: true };
    await commit(user,
      [{ type: 'set', path: ['config', 'taxonomy'], data: { ...taxonomy, subs: [...subs, s] } }],
      [{ action: 'newcode', building, summary: `เปิดหมวดย่อยใหม่ ${s.code} ${s.name} (${group})` }]);
    setSub(s.code); setNewSubName('');
    toast(`เปิดหมวดย่อย ${s.code} แล้ว`);
  };

  const reserve = async () => {
    // คำนวณเลขใหม่อีกครั้งจากข้อมูลล่าสุด (กันสองคนจองพร้อมกัน)
    const fresh = byBuilding[building].map((r) => r.code);
    const { code } = building === 'CMC' ? nextCode({ building, sub, mmyy }, fresh) : nextCode({ building, gg }, fresh);
    if (fresh.includes(code)) throw new Error(`รหัส ${code} มีอยู่แล้ว ลองใหม่อีกครั้ง`);
    if (check.errors.length) throw new Error(check.errors[0]);
    if (!unit.trim()) throw new Error('ระบุหน่วยนับ');
    const finalName = composeName({ ...parts, brand }, { avTag: isAV ? (building === 'CMC' ? `(AV${code.slice(5, 7)})` : '(AV)') : null });
    const id = itemId(building, code);
    await commit(user, [{
      type: 'set', path: ['items', id], data: {
        building, code, g: null,
        m: { name: finalName, active: true, unit: unit.trim(), group: itemGroup, brand: brand || null, source: 'web' },
        group: itemGroup, sub: building === 'CMC' ? sub : null, brand: brand || null,
        vendors: [], note: note.trim(), thumb: null, review: false, inGenedia: false, ordering: null,
        pending: { at: serverTimestamp(), by: user.name },
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      },
    }], [{ action: 'newcode', building, code, itemId: id, summary: `ออกรหัสใหม่ ${code} ${finalName} (${unit.trim()})` }]);
    setDone({ id, code, name: finalName, unit: unit.trim(), group: itemGroup });
    setParts(EMPTY_NAME); setUnit(''); setNote('');
    toast(`จองรหัส ${code} แล้ว`);
  };

  const cancelReserve = async (r) => {
    if (!confirm(`ยกเลิกการจองรหัส ${r.code}?\n(ตามมาตรฐาน เลขนี้จะไม่ถูกนำกลับมาใช้อีก)`)) return;
    await updateItem(user, r, { m: { ...r.m, active: false }, pending: { ...r.pending, cancelled: true } }, 'newcode');
    toast(`ยกเลิกการจอง ${r.code} แล้ว`);
  };

  const openItem = openId && rows.find((r) => r.id === openId);

  return (
    <div className="page narrow-wide">
      <div className="page-head"><h1>ออกรหัสใหม่ · อาคาร {building}</h1></div>
      <p className="muted">ตามมาตรฐานในไฟล์ Master: ห้ามเปลี่ยนรหัสเดิม · ไม่นำเลขที่ยกเลิก/ข้ามกลับมาใช้ · จองแล้วให้นำรหัส ชื่อ หน่วย ไปเพิ่มใน Genedia — นำเข้าไฟล์ครั้งถัดไป สถานะจะเปลี่ยนเป็นปกติเอง</p>

      <section className="card">
        <h2>1. หมวด</h2>
        <div className="form form-cols">
          {building === 'CMC' ? <>
            <label>Group
              <select value={group} onChange={(e) => { setGroup(e.target.value); setSub(''); }}>
                <option value="">– เลือก –</option>
                {cmcGroups.map((g) => <option key={g}>{g}</option>)}
              </select>
            </label>
            <label>หมวดย่อย
              <select value={sub} onChange={(e) => setSub(e.target.value)} disabled={!group}>
                <option value="">– เลือก –</option>
                {groupSubs.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}
                {group && group !== 'CMC-AV' && <option value={NEW_SUB}>+ เปิดหมวดย่อยใหม่…</option>}
              </select>
            </label>
            <label>เดือน/ปี ที่นำเข้าระบบ (MMYY)
              <input value={mmyy} onChange={(e) => setMmyy(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="เช่น 1126" />
            </label>
          </> : (
            <label>รหัส GG / Group
              <select value={gg} onChange={(e) => setGg(e.target.value)}>
                <option value="">– เลือก –</option>
                {npCodes.map((n) => <option key={n.gg} value={n.gg}>{n.gg} · {n.group} — {n.desc}</option>)}
              </select>
            </label>
          )}
        </div>
        {sub === NEW_SUB && (
          <div className="restore-box">
            {typeof proposedSub === 'string' ? <>
              <p>หมวดย่อยใหม่ของ {group}: <b className="mono">{proposedSub}</b></p>
              <div className="row-actions">
                <input value={newSubName} onChange={(e) => setNewSubName(e.target.value)} placeholder="ชื่อหมวดย่อย เช่น หลอด UV" style={{ flex: 1 }} />
                <AsyncButton className="btn btn-primary" onClick={openSub}>เปิดหมวด {proposedSub}</AsyncButton>
              </div>
            </> : <p className="error">{proposedSub?.message}</p>}
          </div>
        )}
        {codeError && <p className="error">{codeError}</p>}
        {proposal && (
          <p className="code-preview">รหัสที่จะได้ <b className="mono">{proposal.code}</b> <span className="muted small">(ลำดับล่าสุดในหมวด {proposal.last || 'ยังไม่มี'})</span></p>
        )}
      </section>

      <section className="card">
        <h2>2. ชื่อ <small>(ประเภท → ชนิด/คุณสมบัติ → รุ่น → สเปก → ยี่ห้อ)</small></h2>
        <div className="form form-cols">
          <label>1 ประเภท *<input value={parts.type} onChange={p('type')} placeholder="เช่น สายไฟ, มอเตอร์, เบรกเกอร์กันดูด" /></label>
          <label>2 ชนิด / คุณสมบัติ<input value={parts.kind} onChange={p('kind')} placeholder="เช่น THW สีดำ, FCU" /></label>
          <label>3 รุ่น<input value={parts.model} onChange={p('model')} placeholder="เช่น Model: PM4110363, DSE201C" /></label>
          <label>4 สเปก<input value={parts.spec} onChange={p('spec')} placeholder="เช่น 1x2.5 SQMM., 16A, 18W" /></label>
          <label>5 ยี่ห้อ
            <input list="nc-brands" value={parts.brand} onChange={p('brand')} placeholder="พิมพ์หรือเลือก" />
            <datalist id="nc-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
          </label>
        </div>
        <div className="name-preview">{name || <span className="muted">ชื่อจะแสดงที่นี่</span>}</div>
        {check.errors.map((e) => <p key={e} className="error small">⛔ {e}</p>)}
        {check.warnings.length > 0 && <ul className="warn small check-list">{check.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        {name && !check.errors.length && !check.warnings.length && <p className="note small">✓ ชื่อตรงตามมาตรฐาน</p>}
        {check.similar.length > 0 && (
          <details>
            <summary>รายการที่คล้ายกัน {check.similar.length} รายการ — ตรวจว่าไม่ใช่อะไหล่ตัวเดียวกัน</summary>
            <ul className="change-list">{check.similar.map((s) => <li key={s.id}><span className="mono">{s.code}</span> {s.m?.name || s.g?.name}</li>)}</ul>
          </details>
        )}
      </section>

      <section className="card">
        <h2>3. ข้อมูลอื่น</h2>
        <div className="form form-cols">
          <label>หน่วยนับ *
            <input list="nc-units" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="เช่น ตัว, เส้น, ชุด" />
            <datalist id="nc-units">{units.map((u) => <option key={u} value={u} />)}</datalist>
          </label>
          <label>หมายเหตุ<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <div className="row-actions">
          <AsyncButton className="btn btn-primary" onClick={reserve} disabled={!proposal || !parts.type.trim() || !unit.trim() || check.errors.length > 0}>
            จองรหัส {proposal?.code || ''}
          </AsyncButton>
        </div>
      </section>

      {done && (
        <section className="card done-box">
          <h2>✓ จองรหัสแล้ว — นำไปเพิ่มใน Genedia</h2>
          <dl className="kv">
            <dt>รหัส</dt><dd className="mono"><b>{done.code}</b> <CopyBtn text={done.code} label="รหัส" /></dd>
            <dt>ชื่อ</dt><dd>{done.name} <CopyBtn text={done.name} label="ชื่อ" /></dd>
            <dt>หน่วย</dt><dd>{done.unit} <CopyBtn text={done.unit} label="หน่วย" /></dd>
            <dt>Group</dt><dd>{done.group}</dd>
          </dl>
          <div className="row-actions">
            <button className="btn" onClick={() => setOpenId(done.id)}>เพิ่มรูป / Vendor / หมายเหตุ</button>
            <button className="btn btn-ghost" onClick={() => setDone(null)}>ปิด</button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>รหัสที่จองไว้ รอเพิ่มใน Genedia <small>({pending.length})</small></h2>
        {!pending.length ? <Empty>ไม่มีรหัสที่รอเพิ่ม</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>รหัส</th><th>ชื่อ</th><th>หน่วย</th><th>Group</th><th>จองเมื่อ</th><th /></tr></thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id}>
                    <td className="mono nowrap"><button className="linklike" onClick={() => setOpenId(r.id)}>{r.code}</button></td>
                    <td className="name-cell">{r.v.name}</td>
                    <td>{r.v.unit}</td>
                    <td className="small">{r.group}</td>
                    <td className="small nowrap">{fmtDateTime(r.pending.at)}<div className="muted">{r.pending.by}</div></td>
                    <td className="row-actions nowrap">
                      <CopyBtn text={r.code} label="รหัส" />
                      <CopyBtn text={r.v.name} label="ชื่อ" />
                      <AsyncButton className="btn btn-sm btn-ghost" onClick={() => cancelReserve(r)}>ยกเลิกการจอง</AsyncButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small"><Badge color="blue">รอเพิ่มใน Genedia</Badge> จะเปลี่ยนเป็นสถานะปกติเองเมื่อนำเข้าไฟล์ Store Part List ที่มีรหัสนั้น</p>
      </section>

      {openItem && <ItemDrawer item={openItem} onClose={() => setOpenId(null)} />}
    </div>
  );
}
