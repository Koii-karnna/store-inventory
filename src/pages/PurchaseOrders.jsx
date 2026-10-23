import { useMemo } from 'react';
import { doc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useData } from '../state.jsx';
import { go, Thumb, Empty, Badge, AsyncButton, toast } from '../ui.jsx';
import { suggestQty, fmtNum, fmtDateTime } from '../lib/model.js';
import { commit, getImage } from '../lib/db.js';
import { buildPoExcel, download } from '../lib/excel.js';

const PO_STATUS = { ordering: ['กำลังสั่ง', 'blue'], rejected: ['ไม่อนุมัติ', 'gray'], done: ['ปิดแล้ว', 'green'] };

export default function PurchaseOrders({ params }) {
  const tab = params.tab || 'draft';
  const { building } = useData();
  return (
    <div className="page">
      <div className="page-head">
        <h1>ใบขอสั่งซื้อ อาคาร {building}</h1>
        <div className="seg-tabs">
          <button className={tab === 'draft' ? 'active' : ''} onClick={() => go('/po')}>ใบร่าง</button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => go('/po', { tab: 'history' })}>ประวัติ</button>
        </div>
      </div>
      {tab === 'draft' ? <Draft /> : <History />}
    </div>
  );
}

async function loadImages(itemIds) {
  const entries = await Promise.all(itemIds.map(async (id) => [id, await getImage(id).catch(() => null)]));
  return Object.fromEntries(entries.filter(([, d]) => d));
}

const fileName = (building, d) => `ใบขอสั่งซื้อ_${building}_${d.toISOString().slice(0, 10)}.xlsx`;

function Draft() {
  const { building, drafts, setDrafts, byBuilding, isAdmin, user } = useData();
  const rowsById = useMemo(() => Object.fromEntries(byBuilding[building].map((r) => [r.id, r])), [byBuilding, building]);
  const draft = (drafts[building] || []).filter((l) => rowsById[l.itemId]);
  const lines = draft.map((l) => {
    const it = rowsById[l.itemId];
    // ราคาตั้งต้น = ราคา/หน่วย จาก Genedia (แก้ได้)
    return { ...l, it, qty: l.qty ?? suggestQty(it), price: l.price ?? (it.v.price ? Math.round(it.v.price * 100) / 100 : null) };
  });
  const groups = [...new Set(lines.map((l) => l.it.group || 'ไม่ระบุ Group'))].sort();
  const total = lines.reduce((s, l) => s + (l.price ? l.qty * l.price : 0), 0);

  const setLine = (itemId, patch) => setDrafts((d) => ({ ...d, [building]: d[building].map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)) }));
  const remove = (itemId) => setDrafts((d) => ({ ...d, [building]: d[building].filter((l) => l.itemId !== itemId) }));
  const numOrNull = (v) => (v === '' ? null : Math.max(0, Number(v)));

  const exportPo = async () => {
    if (lines.some((l) => !l.qty || l.qty <= 0)) throw new Error('กรุณาใส่จำนวนสั่งให้ครบทุกรายการ');
    const already = lines.filter((l) => l.it.ordering);
    if (already.length && !confirm(`มี ${already.length} รายการที่ "กำลังสั่ง" อยู่แล้ว ต้องการสั่งซ้ำหรือไม่?`)) return;
    const now = new Date();
    const snapshot = lines.map(({ it, qty, price }) => ({
      itemId: it.id, code: it.code, name: it.v.name, brand: it.brand || '', unit: it.v.unit, stock: it.v.stock,
      min: it.v.min, max: it.v.max, group: it.group || '', sub: it.sub || '', qty, price: price ?? null,
    }));
    const images = await loadImages(snapshot.map((l) => l.itemId));
    const buf = await buildPoExcel({ building, date: now, lines: snapshot, images });

    const poId = doc(collection(db, 'pos')).id;
    const ops = [
      { type: 'set', path: ['pos', poId], data: { building, createdAt: serverTimestamp(), createdBy: user.uid, createdByName: user.name, status: 'ordering', lines: snapshot, total } },
      ...snapshot.map((l) => ({ type: 'update', path: ['items', l.itemId], data: { ordering: { poId, at: now, stockAtOrder: l.stock ?? 0 } } })),
    ];
    const logs = [
      { action: 'po', building, summary: `สร้างใบขอซื้อ ${snapshot.length} รายการ`, poId },
      ...snapshot.map((l) => ({ action: 'po', building, code: l.code, itemId: l.itemId, poId, changes: [{ field: 'ordering', from: null, to: `ใบขอซื้อ จำนวน ${l.qty}` }] })),
    ];
    await commit(user, ops, logs);
    download(buf, fileName(building, now));
    setDrafts((d) => ({ ...d, [building]: [] }));
    toast('Export ใบขอซื้อแล้ว รายการถูกติดป้าย "กำลังสั่ง"');
  };

  if (!lines.length) {
    return <Empty>ใบร่างยังว่าง — ไปที่ <a href="#/alerts">แจ้งเตือน</a> หรือ <a href="#/items">รายการอะไหล่</a> แล้วติ๊กเลือกรายการที่ต้องการสั่ง</Empty>;
  }
  return (
    <>
      <p className="muted">จำนวนสั่งตั้งต้น = Max − คงเหลือ · ราคา/หน่วย ตั้งต้นจาก Genedia (ช่องว่าง = Genedia ไม่มีราคา) · แก้ได้ทั้งสองช่อง · ไม่รวม VAT</p>
      <div className="table-wrap">
        <table className="table po-table">
          <thead>
            <tr>
              <th>รูป</th><th>รหัส</th><th>ชื่อ</th><th>ยี่ห้อ</th><th>หน่วย</th><th className="num">คงเหลือ</th>
              <th className="num">Min/Max</th><th className="num">จำนวนสั่ง</th><th className="num">ราคา/หน่วย</th><th className="num">รวม</th><th />
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g}>
              <tr className="group-row"><td colSpan={11}>{g}</td></tr>
              {lines.filter((l) => (l.it.group || 'ไม่ระบุ Group') === g).map((l) => (
                <tr key={l.itemId}>
                  <td><Thumb src={l.it.thumb} /></td>
                  <td className="mono nowrap">{l.it.code}</td>
                  <td className="name-cell">{l.it.v.name}{l.it.ordering && <> <Badge color="blue">กำลังสั่ง</Badge></>}</td>
                  <td>{l.it.brand || '–'}</td>
                  <td>{l.it.v.unit}</td>
                  <td className="num">{fmtNum(l.it.v.stock)}</td>
                  <td className="num">{fmtNum(l.it.v.min)}/{fmtNum(l.it.v.max)}</td>
                  <td className="num"><input className="num-input" type="number" min="1" value={l.qty ?? ''} disabled={!isAdmin} onChange={(e) => setLine(l.itemId, { qty: numOrNull(e.target.value) })} aria-label="จำนวนสั่ง" /></td>
                  <td className="num"><input className="num-input" type="number" min="0" step="0.01" value={l.price ?? ''} placeholder="0.00" disabled={!isAdmin} onChange={(e) => setLine(l.itemId, { price: numOrNull(e.target.value) })} aria-label="ราคาต่อหน่วย" /></td>
                  <td className="num">{l.price ? fmtNum(l.qty * l.price) : '–'}</td>
                  <td>{isAdmin && <button className="icon-btn" onClick={() => remove(l.itemId)} aria-label="เอาออก">✕</button>}</td>
                </tr>
              ))}
            </tbody>
          ))}
          <tfoot>
            <tr><td colSpan={9} className="num"><b>รวมทั้งสิ้น (ไม่รวม VAT)</b></td><td className="num"><b>{fmtNum(total)}</b></td><td /></tr>
          </tfoot>
        </table>
      </div>
      {isAdmin && (
        <div className="row-actions">
          <AsyncButton className="btn btn-primary" onClick={exportPo}>Export Excel และติดป้าย "กำลังสั่ง"</AsyncButton>
          <button className="btn btn-ghost" onClick={() => confirm('ล้างใบร่างทั้งหมด?') && setDrafts((d) => ({ ...d, [building]: [] }))}>ล้างใบร่าง</button>
        </div>
      )}
    </>
  );
}

function History() {
  const { pos, building, byBuilding, isAdmin, user } = useData();
  const list = pos.filter((p) => p.building === building);
  const items = Object.fromEntries(byBuilding[building].map((r) => [r.id, r]));

  const redownload = async (po) => {
    const images = await loadImages(po.lines.map((l) => l.itemId));
    const date = po.createdAt?.toDate?.() || new Date();
    download(await buildPoExcel({ building: po.building, date, lines: po.lines, images }), fileName(po.building, date));
  };

  // ไม่อนุมัติ / ปิดใบ: ปลดป้าย "กำลังสั่ง" ของรายการที่ยังผูกกับใบนี้
  const close = async (po, status) => {
    const label = status === 'rejected' ? 'ไม่อนุมัติ' : 'ปิดใบ (ได้รับของแล้ว)';
    if (!confirm(`${label} — ปลดป้าย "กำลังสั่ง" ของรายการในใบนี้?`)) return;
    const flagged = po.lines.filter((l) => items[l.itemId]?.ordering?.poId === po.id);
    await commit(user, [
      { type: 'update', path: ['pos', po.id], data: { status, closedAt: serverTimestamp(), closedBy: user.name } },
      ...flagged.map((l) => ({ type: 'update', path: ['items', l.itemId], data: { ordering: null } })),
    ], [
      { action: 'po', building: po.building, poId: po.id, summary: `${label} ใบขอซื้อ ${po.lines.length} รายการ` },
      ...flagged.map((l) => ({ action: 'po', building: po.building, code: l.code, itemId: l.itemId, poId: po.id, changes: [{ field: 'ordering', from: 'กำลังสั่ง', to: null }] })),
    ]);
    toast(`${label} แล้ว`);
  };

  if (!list.length) return <Empty>ยังไม่มีใบขอซื้อ</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>วันที่</th><th>ผู้จัดทำ</th><th className="num">รายการ</th><th className="num">ยังกำลังสั่ง</th><th className="num">รวม (บาท)</th><th>สถานะ</th><th /></tr></thead>
        <tbody>
          {list.map((po) => {
            const [label, color] = PO_STATUS[po.status] || [po.status, 'gray'];
            const open = po.lines.filter((l) => items[l.itemId]?.ordering?.poId === po.id).length;
            return (
              <tr key={po.id}>
                <td className="nowrap">{fmtDateTime(po.createdAt)}</td>
                <td>{po.createdByName}</td>
                <td className="num">{po.lines.length}</td>
                <td className="num">{po.status === 'ordering' ? open : '–'}</td>
                <td className="num">{po.total ? fmtNum(po.total) : '–'}</td>
                <td><Badge color={color}>{label}</Badge></td>
                <td className="row-actions nowrap">
                  <AsyncButton className="btn btn-sm" onClick={() => redownload(po)}>ดาวน์โหลด Excel</AsyncButton>
                  {isAdmin && po.status === 'ordering' && <>
                    <AsyncButton className="btn btn-sm btn-ghost" onClick={() => close(po, 'rejected')}>ไม่อนุมัติ</AsyncButton>
                    <AsyncButton className="btn btn-sm btn-ghost" onClick={() => close(po, 'done')}>ปิดใบ</AsyncButton>
                  </>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">ป้าย "กำลังสั่ง" จะหายเองเมื่อนำเข้าไฟล์แล้วคงเหลือเพิ่มขึ้นจากตอนสั่ง หรือกด "ไม่อนุมัติ" / "ปิดใบ" / ยกเลิกรายตัวในหน้ารายละเอียด</p>
    </div>
  );
}
