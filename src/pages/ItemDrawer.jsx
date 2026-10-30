import { useEffect, useRef, useState } from 'react';
import { serverTimestamp, arrayUnion } from 'firebase/firestore';
import { useData } from '../state.jsx';
import { Drawer, LevelBadge, Badge, AsyncButton, toast } from '../ui.jsx';
import { fmtNum, fmtDateTime, mismatches, MISMATCH_TYPES } from '../lib/model.js';
import { updateItem, commit, getImage, itemHistory, describeChange, ACTIONS } from '../lib/db.js';
import { processImage } from '../lib/image.js';
import UsageSection from './UsageSection.jsx';
import ReceiveSection from './ReceiveSection.jsx';

export default function ItemDrawer({ item, onClose }) {
  const { isAdmin, user, taxonomy, brands, vendors, settings } = useData();
  const [img, setImg] = useState(null);
  const [history, setHistory] = useState(null);
  const [form, setForm] = useState(() => pick(item));
  const fileRef = useRef(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(pick(item));

  useEffect(() => { setForm(pick(item)); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    setImg(null);
    if (item.hasImage) getImage(item.id).then((d) => live && setImg(d)).catch(() => {});
    return () => { live = false; };
  }, [item.id, item.hasImage, item.thumb]);
  useEffect(() => {
    let live = true;
    itemHistory(item.id).then((h) => live && setHistory(h)).catch((e) => { console.error(e); live && setHistory([]); });
    return () => { live = false; };
  }, [item.id, item.updatedAt?.seconds]);

  const groups = [...new Set([...(taxonomy?.groups?.[item.building] || []), item.group].filter(Boolean))].sort();
  const subs = (taxonomy?.subs || []).filter((s) => s.group === form.group && (!s.closed || s.code === form.sub));
  // ปิดช่วงเปลี่ยนผ่านแล้ว (Genedia เป็นข้อมูลหลัก) → ไม่ต้องเทียบกับ Master
  const mm = settings.preferMaster ? mismatches(item) : [];
  const webItem = item.m?.source === 'web';
  const f = (k) => (e) => setForm((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    const brand = form.brand.trim().toUpperCase() || null;
    const lastInQty = form.lastInQty === '' ? null : Number(form.lastInQty);
    if (lastInQty !== null && !(lastInQty >= 0)) throw new Error('จำนวนที่รับเข้าล่าสุดต้องเป็นตัวเลข');
    const patch = {
      group: form.group || null, sub: item.building === 'CMC' ? form.sub || null : null, brand, note: form.note.trim(), vendors: form.vendors,
      lastInDate: form.lastInDate || null, lastInQty,
    };
    if (patch.group && item.review) patch.review = false;
    // รายการที่ออกรหัสในเว็บ: แก้ชื่อ/หน่วยมาตรฐานได้ (Group/ยี่ห้อ ให้ตรงกันด้วย)
    if (webItem) {
      if (!form.mName.trim() || !form.mUnit.trim()) throw new Error('ชื่อและหน่วยนับห้ามว่าง');
      const m = { ...item.m, name: form.mName.trim().replace(/\s+/g, ' '), unit: form.mUnit.trim(), group: patch.group, brand };
      if (JSON.stringify(m) !== JSON.stringify(item.m)) patch.m = m;
    }
    const changed = await updateItem(user, item, patch);
    if (brand && !brands.includes(brand)) {
      await commit(user, [{ type: 'set', path: ['config', 'brands'], data: { list: arrayUnion(brand) }, merge: true }]);
    }
    toast(changed ? 'บันทึกแล้ว' : 'ไม่มีการเปลี่ยนแปลง');
  };

  const upload = async (file) => {
    const { full, thumb, bytes } = await processImage(file);
    await commit(user, [
      { type: 'set', path: ['images', item.id], data: { data: full, at: serverTimestamp(), by: user.name } },
      { type: 'update', path: ['items', item.id], data: { thumb, hasImage: true, updatedAt: serverTimestamp() } },
    ], [{ action: 'image', building: item.building, code: item.code, itemId: item.id, changes: [{ field: 'image', from: item.hasImage ? 'มีรูป' : null, to: `รูปใหม่ ${Math.round(bytes / 1024)} KB` }] }]);
    toast(`บันทึกรูปแล้ว (${Math.round(bytes / 1024)} KB)`);
  };

  const removeImage = async () => {
    if (!confirm('ลบรูปของรายการนี้?')) return;
    await commit(user, [
      { type: 'delete', path: ['images', item.id] },
      { type: 'update', path: ['items', item.id], data: { thumb: null, hasImage: false, updatedAt: serverTimestamp() } },
    ], [{ action: 'image', building: item.building, code: item.code, itemId: item.id, changes: [{ field: 'image', from: 'มีรูป', to: null }] }]);
    toast('ลบรูปแล้ว');
  };

  const clearOrdering = async () => {
    if (!confirm('ยกเลิกป้าย "กำลังสั่ง" ของรายการนี้? (เช่น ใบขอซื้อไม่ได้รับอนุมัติ)')) return;
    await updateItem(user, item, { ordering: null }, 'po');
    toast('ยกเลิกป้ายกำลังสั่งแล้ว');
  };

  const setVendors = (vs) => setForm((x) => ({ ...x, vendors: vs }));
  const vendorName = (id) => vendors.find((v) => v.id === id)?.name || '(Vendor ถูกลบ)';

  return (
    <Drawer title={item.code} onClose={onClose}>
      <div className="item-head">
        <div className="item-img">
          {img ? <img src={img} alt={item.v.name} /> : item.thumb ? <img src={item.thumb} alt="" /> : <div className="img-none">ไม่มีรูป</div>}
          {isAdmin && (
            <div className="img-actions">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
                const file = e.target.files[0]; e.target.value = '';
                if (file) try { await upload(file); } catch (err) { toast(err.message, 'err'); }
              }} />
              <button className="btn btn-sm" onClick={() => fileRef.current.click()}>{item.hasImage ? 'เปลี่ยนรูป' : 'เพิ่มรูป'}</button>
              {item.hasImage && <AsyncButton className="btn btn-sm btn-ghost" onClick={removeImage}>ลบรูป</AsyncButton>}
            </div>
          )}
        </div>
        <div>
          <h2 className="item-name">{item.v.name}</h2>
          <div className="badges">
            <LevelBadge level={item.lv} />
            {item.ordering && <Badge color="blue">กำลังสั่ง ตั้งแต่ {fmtDateTime(item.ordering.at)}</Badge>}
            {item.review && <Badge color="orange-soft">รอตรวจ Group</Badge>}
          </div>
          {item.ordering && isAdmin && <AsyncButton className="btn btn-sm btn-ghost" onClick={clearOrdering}>ยกเลิกป้ายกำลังสั่ง</AsyncButton>}
        </div>
      </div>

      <section>
        <h4>ข้อมูลจาก Genedia <small className="muted">(แก้ไขใน Genedia แล้วนำเข้าใหม่)</small></h4>
        <dl className="kv">
          <dt>คงเหลือ</dt><dd><b>{fmtNum(item.v.stock)}</b> {item.v.unit}</dd>
          <dt>Min / Max</dt><dd>{fmtNum(item.v.min)} / {fmtNum(item.v.max)}</dd>
          <dt>สถานะ</dt><dd>{item.v.active ? 'ใช้งาน' : 'ยกเลิกใช้งาน'}</dd>
          <dt>หน่วยนับ</dt><dd>{item.v.unit || '–'}</dd>
        </dl>
      </section>

      <UsageSection item={item} />
      <ReceiveSection item={item} />

      {mm.length > 0 && (
        <section>
          <h4>Genedia ยังไม่ตรงกับ Master</h4>
          <table className="table compact">
            <thead><tr><th>เรื่อง</th><th>Genedia</th><th>Master</th></tr></thead>
            <tbody>{mm.map((x) => <tr key={x.type}><td>{MISMATCH_TYPES[x.type]}</td><td>{x.genedia || '–'}</td><td>{x.master || '–'}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      <section>
        <h4>ข้อมูลในเว็บ</h4>
        <div className="form">
          {webItem && <>
            <label>ชื่อมาตรฐาน (ออกรหัสในเว็บ){item.pending && ' — แก้ก่อนเพิ่มใน Genedia'}<input value={form.mName} onChange={f('mName')} disabled={!isAdmin} /></label>
            <label>หน่วยนับ<input value={form.mUnit} onChange={f('mUnit')} disabled={!isAdmin} /></label>
          </>}
          <label>Group
            <select value={form.group} onChange={(e) => setForm((x) => ({ ...x, group: e.target.value, sub: '' }))} disabled={!isAdmin}>
              <option value="">– ไม่ระบุ –</option>
              {groups.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          {item.building === 'CMC' && (
            <label>หมวดย่อย
              <select value={form.sub} onChange={f('sub')} disabled={!isAdmin}>
                <option value="">– ไม่ระบุ –</option>
                {subs.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}
              </select>
            </label>
          )}
          <label>ยี่ห้อ
            <input list="brand-list" value={form.brand} onChange={f('brand')} disabled={!isAdmin} placeholder="พิมพ์หรือเลือก (ภาษาอังกฤษพิมพ์ใหญ่)" />
            <datalist id="brand-list">{brands.map((b) => <option key={b} value={b} />)}</datalist>
          </label>
          <div className="field">
            <span>Vendor</span>
            {form.vendors.length === 0 && <span className="muted small">ยังไม่ระบุ</span>}
            {form.vendors.map((v) => (
              <div key={v.id} className="vendor-line">
                <label className="inline">
                  <input type="radio" name="mainVendor" checked={!!v.main} disabled={!isAdmin}
                    onChange={() => setVendors(form.vendors.map((x) => ({ ...x, main: x.id === v.id })))} />
                  {vendorName(v.id)} {v.main && <Badge color="blue-soft">หลัก</Badge>}
                </label>
                {isAdmin && <button className="icon-btn" onClick={() => setVendors(form.vendors.filter((x) => x.id !== v.id))} aria-label="เอาออก">✕</button>}
              </div>
            ))}
            {isAdmin && (
              <select value="" onChange={(e) => e.target.value && setVendors([...form.vendors, { id: e.target.value, main: form.vendors.length === 0 }])}>
                <option value="">+ เพิ่ม Vendor</option>
                {vendors.filter((v) => !form.vendors.some((x) => x.id === v.id)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            )}
            {isAdmin && vendors.length === 0 && <span className="muted small">ยังไม่มี Vendor ในระบบ — เพิ่มที่เมนู Vendor</span>}
          </div>
          <div className="field-pair">
            <label>วันที่รับเข้าล่าสุด<input type="date" value={form.lastInDate} onChange={f('lastInDate')} disabled={!isAdmin} /></label>
            <label>จำนวนที่รับเข้าล่าสุด{item.v.unit && ` (${item.v.unit})`}<input type="number" min="0" value={form.lastInQty} onChange={f('lastInQty')} disabled={!isAdmin} /></label>
          </div>
          <label>หมายเหตุ<textarea rows={3} value={form.note} onChange={f('note')} disabled={!isAdmin} /></label>
        </div>
        {isAdmin && (
          <div className="row-actions">
            <AsyncButton className="btn btn-primary" onClick={save} disabled={!dirty}>บันทึก</AsyncButton>
            {dirty && <button className="btn btn-ghost" onClick={() => setForm(pick(item))}>ยกเลิกการแก้ไข</button>}
          </div>
        )}
      </section>

      <section>
        <h4>ประวัติการแก้ไข</h4>
        {history === null ? <p className="muted">กำลังโหลด…</p> : history.length === 0 ? <p className="muted">ยังไม่มีประวัติ</p> : (
          <ul className="history">
            {history.map((h) => (
              <li key={h.id}>
                <div className="muted small">{fmtDateTime(h.ts)} · {h.user} · {ACTIONS[h.action] || h.action}</div>
                {(h.changes || []).map((c, i) => <div key={i}>{describeChange(c)}</div>)}
                {h.summary && <div>{h.summary}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Drawer>
  );
}

function pick(item) {
  return {
    group: item.group || '', sub: item.sub || '', brand: item.brand || '', note: item.note || '', vendors: item.vendors || [],
    lastInDate: item.lastInDate || '', lastInQty: item.lastInQty ?? '',
    mName: item.m?.name || '', mUnit: item.m?.unit || '',
  };
}
