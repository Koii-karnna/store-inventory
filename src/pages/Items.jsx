import { useMemo, useState } from 'react';
import { useData } from '../state.jsx';
import { go, LevelBadge, Badge, Thumb, Empty, toast } from '../ui.jsx';
import { needsOrder, fmtNum } from '../lib/model.js';
import ItemDrawer from './ItemDrawer.jsx';

const LEVEL_FILTERS = [
  ['', 'ทุกระดับ'], ['need', 'ต้องสั่ง (หมด + ถึง Min)'], ['out', 'หมด'], ['low', 'ถึง Min'], ['near', 'ใกล้ Min'],
  ['ok', 'ปกติ'], ['nomin', 'ไม่มี Min'], ['ordering', 'กำลังสั่ง'], ['review', 'รอตรวจ Group'], ['nodata', 'ไม่มีใน Genedia'],
];
const LEVEL_ORDER = { out: 0, low: 1, near: 2, ok: 3, nomin: 4, nodata: 5, inactive: 6 };
const PAGE = 300;

export default function Items({ params, alerts }) {
  const { byBuilding, building, taxonomy, vendors, isAdmin, addToDraft, drafts } = useData();
  const [openId, setOpenId] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [sort, setSort] = useState(alerts ? 'level' : 'code');
  const [shown, setShown] = useState(PAGE);
  const base = alerts ? '/alerts' : '/items';
  const p = { q: '', group: '', sub: '', level: '', status: '', brand: '', vendor: '', ...params };
  const status = p.status || (['review', 'nodata', 'ordering'].includes(p.level) ? 'all' : 'active');
  const set = (k, v) => { setShown(PAGE); go(base, { ...params, [k]: v, ...(k === 'group' ? { sub: '' } : {}) }); };

  const rows = byBuilding[building];
  const groups = useMemo(() => [...new Set(rows.map((r) => r.group).filter(Boolean))].sort(), [rows]);
  const subs = useMemo(() => (taxonomy?.subs || []).filter((s) => !p.group || s.group === p.group), [taxonomy, p.group]);
  const subNames = useMemo(() => Object.fromEntries((taxonomy?.subs || []).map((s) => [s.code, s.name])), [taxonomy]);
  const usedBrands = useMemo(() => [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort(), [rows]);

  const list = useMemo(() => {
    const q = p.q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (status === 'active' && !r.v.active) return false;
      if (status === 'inactive' && r.v.active) return false;
      if (p.group && r.group !== p.group) return false;
      if (p.sub && r.sub !== p.sub) return false;
      if (p.brand && r.brand !== p.brand) return false;
      if (p.vendor && !(r.vendors || []).some((v) => v.id === p.vendor)) return false;
      if (p.level === 'need' && !needsOrder(r.lv, r)) return false;
      if (p.level === 'ordering' && !r.ordering) return false;
      if (p.level === 'review' && !r.review) return false;
      if (p.level && !['need', 'ordering', 'review'].includes(p.level) && r.lv !== p.level) return false;
      if (q && ![r.code, r.v.name, r.g?.name, r.m?.name, r.brand].some((s) => s && s.toLowerCase().includes(q))) return false;
      return true;
    });
    const cmp = {
      code: (a, b) => a.code.localeCompare(b.code),
      name: (a, b) => a.v.name.localeCompare(b.v.name, 'th'),
      stock: (a, b) => (a.v.stock ?? -1) - (b.v.stock ?? -1),
      level: (a, b) => LEVEL_ORDER[a.lv] - LEVEL_ORDER[b.lv] || a.code.localeCompare(b.code),
    }[sort];
    return out.sort(cmp);
  }, [rows, p.q, p.group, p.sub, p.brand, p.vendor, p.level, status, sort]);

  const selectable = (r) => isAdmin && r.v.active && r.inGenedia !== false;
  const inDraft = new Set((drafts[building] || []).map((l) => l.itemId));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const visible = list.slice(0, shown);
  const allSel = visible.filter(selectable).every((r) => sel.has(r.id)) && visible.some(selectable);
  const toggleAll = () => setSel(allSel ? new Set() : new Set(visible.filter(selectable).map((r) => r.id)));

  const addSelected = () => {
    addToDraft(building, [...sel]);
    toast(`เพิ่ม ${sel.size} รายการลงใบขอซื้อ ${building} แล้ว`);
    setSel(new Set());
  };
  const selectAllNeed = () => setSel(new Set(list.filter((r) => selectable(r) && needsOrder(r.lv, r) && !inDraft.has(r.id)).map((r) => r.id)));

  const th = (key, label, cls = '') => (
    <th className={`sortable ${cls}`} onClick={() => setSort(key)} aria-sort={sort === key ? 'ascending' : 'none'}>
      {label}{sort === key && ' ▾'}
    </th>
  );
  const openItem = openId && rows.find((r) => r.id === openId);

  return (
    <div className="page">
      <div className="page-head">
        <h1>{alerts ? `แจ้งเตือนสั่งซื้อ อาคาร ${building}` : `รายการอะไหล่ อาคาร ${building}`}</h1>
        <span className="muted">{list.length.toLocaleString('th-TH')} รายการ</span>
      </div>

      <div className="filters">
        <input type="search" placeholder="ค้นหา รหัส / ชื่อ / ยี่ห้อ" value={p.q} onChange={(e) => set('q', e.target.value)} />
        <select value={p.group} onChange={(e) => set('group', e.target.value)} aria-label="Group">
          <option value="">ทุก Group</option>
          {groups.map((g) => <option key={g}>{g}</option>)}
        </select>
        {building === 'CMC' && (
          <select value={p.sub} onChange={(e) => set('sub', e.target.value)} aria-label="หมวดย่อย">
            <option value="">ทุกหมวดย่อย</option>
            {subs.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}
          </select>
        )}
        <select value={p.level} onChange={(e) => set('level', e.target.value)} aria-label="ระดับแจ้งเตือน">
          {LEVEL_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={status} onChange={(e) => set('status', e.target.value)} aria-label="สถานะ">
          <option value="active">ใช้งาน</option>
          <option value="inactive">ยกเลิกใช้งาน</option>
          <option value="all">ทุกสถานะ</option>
        </select>
        <select value={p.brand} onChange={(e) => set('brand', e.target.value)} aria-label="ยี่ห้อ">
          <option value="">ทุกยี่ห้อ</option>
          {usedBrands.map((b) => <option key={b}>{b}</option>)}
        </select>
        {vendors.length > 0 && (
          <select value={p.vendor} onChange={(e) => set('vendor', e.target.value)} aria-label="Vendor">
            <option value="">ทุก Vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
        {Object.values(params).some(Boolean) && <button className="btn btn-ghost btn-sm" onClick={() => go(base)}>ล้างตัวกรอง</button>}
      </div>

      {isAdmin && (
        <div className="selbar">
          {alerts && <button className="btn btn-sm" onClick={selectAllNeed}>เลือกทุกรายการที่ต้องสั่ง</button>}
          <span>{sel.size ? `เลือก ${sel.size} รายการ` : 'ติ๊กเลือกรายการเพื่อสร้างใบขอซื้อ'}</span>
          {sel.size > 0 && <>
            <button className="btn btn-primary btn-sm" onClick={addSelected}>เพิ่มลงใบขอซื้อ</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSel(new Set())}>ยกเลิกที่เลือก</button>
          </>}
          {inDraft.size > 0 && <a className="btn btn-sm" href="#/po">ไปที่ใบขอซื้อ ({inDraft.size})</a>}
        </div>
      )}

      {!list.length ? <Empty>ไม่พบรายการตามตัวกรอง</Empty> : (
        <div className="table-wrap">
          <table className="table items-table">
            <thead>
              <tr>
                {isAdmin && <th className="chk"><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="เลือกทั้งหมด" /></th>}
                <th>รูป</th>
                {th('code', 'รหัส')}
                {th('name', 'ชื่อ')}
                <th>ยี่ห้อ</th>
                <th>Group / หมวดย่อย</th>
                <th>หน่วย</th>
                {th('stock', 'คงเหลือ', 'num')}
                <th className="num">Min</th>
                <th className="num">Max</th>
                {th('level', 'สถานะ')}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                  {isAdmin && (
                    <td className="chk" onClick={(e) => e.stopPropagation()}>
                      {selectable(r) && <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`เลือก ${r.code}`} />}
                    </td>
                  )}
                  <td><Thumb src={r.thumb} /></td>
                  <td className="mono nowrap">{r.code}</td>
                  <td className="name-cell">{r.v.name}</td>
                  <td>{r.brand || <span className="muted">–</span>}</td>
                  <td className="small">
                    {r.group || <span className="t-orange">ไม่ระบุ</span>}
                    {r.sub && <div className="muted sub-name" title={r.sub}>{subNames[r.sub] || r.sub}</div>}
                  </td>
                  <td>{r.v.unit}</td>
                  <td className="num"><b>{fmtNum(r.v.stock)}</b></td>
                  <td className="num">{fmtNum(r.v.min)}</td>
                  <td className="num">{fmtNum(r.v.max)}</td>
                  <td>
                    <div className="badges">
                      <LevelBadge level={r.lv} />
                      {r.ordering && <Badge color="blue">กำลังสั่ง</Badge>}
                      {inDraft.has(r.id) && <Badge color="blue-soft">ในใบร่าง</Badge>}
                      {r.review && <Badge color="orange-soft">รอตรวจ Group</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > shown && <button className="btn more" onClick={() => setShown((n) => n + PAGE)}>แสดงเพิ่ม ({list.length - shown} รายการ)</button>}
        </div>
      )}

      {openItem && <ItemDrawer item={openItem} onClose={() => setOpenId(null)} />}
    </div>
  );
}
