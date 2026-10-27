import { useMemo } from 'react';
import { doc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useData, useLocal } from '../state.jsx';
import { go, Thumb, Empty, Badge, AsyncButton, toast } from '../ui.jsx';
import { suggestQty, fmtNum, fmtDateTime, fmtLastIn } from '../lib/model.js';
import { commit, getImage } from '../lib/db.js';
import { buildPoExcel, download, groupLines } from '../lib/excel.js';
import { useUsageStats } from '../lib/usageStore.js';
import { checkOrderQty, USAGE_RULES } from '../lib/usage.js';
import { useReceiveLines } from '../lib/receiveStore.js';
import { lastBuyPrice } from '../lib/receive.js';
import { useOrderingQty } from './Usage.jsx';

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

/**
 * สถิติการใช้ ณ วันที่สร้างใบขอซื้อ (เก็บไว้กับใบ เพื่อดาวน์โหลดซ้ำได้ตัวเลขเดิม)
 * → { info: ค่าระดับใบ, use(itemId): ค่ารายบรรทัด } · ไม่มีข้อมูลการเบิก → null
 */
function usageSnapshot(usage) {
  if (!usage.hasData || !usage.result) return null;
  const { stats, endMonth, windowMonths, years, gaps } = usage.result;
  return {
    info: { endMonth, window: USAGE_RULES.windowMonths, months: windowMonths, years, gaps },
    use: (itemId) => {
      const s = stats[itemId];
      if (!s || !s.total) return null;
      return { y: Object.fromEntries(Object.entries(s.byYear).map(([y, q]) => [y, Math.round(q * 100) / 100])), avg: Math.round(s.avg * 100) / 100, um: !!s.unitMismatch, idle: !!s.proposal?.idle };
    },
  };
}

const useSubNames = () => {
  const { taxonomy } = useData();
  return useMemo(() => Object.fromEntries((taxonomy?.subs || []).map((s) => [s.code, s.name])), [taxonomy]);
};

/** ตรวจจำนวนสั่งเทียบการใช้จริง (แสดงในเว็บเท่านั้น) */
function UsageCheck({ item, qty, usage, other }) {
  if (!usage.hasData) return <span className="muted">–</span>;
  if (usage.loading || !usage.result) return <span className="muted">…</span>;
  const s = usage.result.stats[item.id];
  const c = checkOrderQty(item, s, qty || 0, other);
  if (!c) return <span className="muted">{s?.unitMismatch ? 'หน่วยตอนเบิกไม่ตรง' : '–'}</span>;
  const r1 = (n) => Math.round(n * 10) / 10;
  return (
    <>
      <div>ใช้ {fmtNum(r1(c.avg))}/ด. · แนะนำ {c.suggest ?? '–'}</div>
      {c.after !== null && <div className="muted">หลังสั่งพอใช้ {fmtNum(r1(c.after))} ด. (รอบ {c.cycle} ด.)</div>}
      {c.warn && <Badge color={c.warn.startsWith('สั่งมาก') ? 'orange' : 'yellow'}>{c.warn}</Badge>}
    </>
  );
}

function Draft() {
  const { building, drafts, setDrafts, byBuilding, isAdmin, user } = useData();
  const subNames = useSubNames();
  const usage = useUsageStats(building);
  const receive = useReceiveLines(building);
  const orderingQty = useOrderingQty(building);
  const [projects, setProjects] = useLocal(`si.poProject.${user.uid}`, { CMC: '', NP: '' });
  const project = projects[building] || '';
  const rowsById = useMemo(() => Object.fromEntries(byBuilding[building].map((r) => [r.id, r])), [byBuilding, building]);
  const draft = (drafts[building] || []).filter((l) => rowsById[l.itemId]);
  const lines = draft.map((l) => {
    const it = rowsById[l.itemId];
    // ค่าตั้งต้น (แก้ได้): ราคา = ต้นทุน/หน่วย จาก Genedia (ถ้า 0 ใช้ราคา/หน่วย) · หมายเหตุ = หมายเหตุของรายการ
    return {
      ...l, it,
      qty: l.qty ?? suggestQty(it),
      price: l.price ?? (it.v.unitPrice ? Math.round(it.v.unitPrice * 100) / 100 : null),
      note: l.note ?? (it.note || ''),
      lastIn: fmtLastIn(it, it.v.unit),
    };
  });
  const sections = groupLines(lines, (l) => l.it.group, (l) => l.it.sub, (l) => l.it.code);
  const total = lines.reduce((s, l) => s + (l.price ? l.qty * l.price : 0), 0);

  const setLine = (itemId, patch) => setDrafts((d) => ({ ...d, [building]: d[building].map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)) }));
  const remove = (itemId) => setDrafts((d) => ({ ...d, [building]: d[building].filter((l) => l.itemId !== itemId) }));
  const numOrNull = (v) => (v === '' ? null : Math.max(0, Number(v)));

  const exportPo = async () => {
    if (lines.some((l) => !l.qty || l.qty <= 0)) throw new Error('กรุณาใส่จำนวนสั่งให้ครบทุกรายการ');
    const already = lines.filter((l) => l.it.ordering);
    if (already.length && !confirm(`มี ${already.length} รายการที่ "กำลังสั่ง" อยู่แล้ว ต้องการสั่งซ้ำหรือไม่?`)) return;
    if ((usage.hasData && (usage.loading || !usage.result)) || receive.loading) throw new Error('กำลังโหลดข้อมูลการเบิก/รับเข้า กรุณารอสักครู่แล้วกดอีกครั้ง');
    const now = new Date();
    const us = usageSnapshot(usage);
    const receivedByCode = {};
    for (const l of receive.lines) (receivedByCode[l.c] ??= []).push(l);
    const snapshot = lines.map(({ it, qty, price, note, lastIn }) => ({
      itemId: it.id, code: it.code, name: it.v.name, brand: it.brand || '', unit: it.v.unit, stock: it.v.stock,
      min: it.v.min, max: it.v.max, group: it.group || '', sub: it.sub || '', lastIn, qty, price: price ?? null, note: note.trim(),
      lastBuy: lastBuyPrice(receivedByCode[it.code], it),
      ...(us && { use: us.use(it.id) }),
    }));
    const images = await loadImages(snapshot.map((l) => l.itemId));
    const buf = await buildPoExcel({ building, date: now, project, lines: snapshot, images, subNames, usage: us?.info });

    const poId = doc(collection(db, 'pos')).id;
    const ops = [
      { type: 'set', path: ['pos', poId], data: { building, createdAt: serverTimestamp(), createdBy: user.uid, createdByName: user.name, status: 'ordering', project: project.trim(), lines: snapshot, total, ...(us && { usage: us.info }) } },
      ...snapshot.map((l) => ({ type: 'update', path: ['items', l.itemId], data: { ordering: { poId, at: now, stockAtOrder: l.stock ?? 0 } } })),
    ];
    const logs = [
      { action: 'po', building, summary: `สร้างใบขอซื้อ ${snapshot.length} รายการ`, poId },
      ...snapshot.map((l) => ({ action: 'po', building, code: l.code, itemId: l.itemId, poId, changes: [{ field: 'ordering', from: null, to: `ใบขอซื้อ จำนวน ${l.qty}` }] })),
    ];
    await commit(user, ops, logs);
    download(buf, fileName(building, now));
    setDrafts((d) => ({ ...d, [building]: [] }));
    setProjects((p) => ({ ...p, [building]: '' }));
    toast('Export ใบขอซื้อแล้ว รายการถูกติดป้าย "กำลังสั่ง"');
  };

  if (!lines.length) {
    return <Empty>ใบร่างยังว่าง — ไปที่ <a href="#/alerts">แจ้งเตือน</a> หรือ <a href="#/items">รายการอะไหล่</a> แล้วติ๊กเลือกรายการที่ต้องการสั่ง</Empty>;
  }
  return (
    <>
      <label className="project-field">โครงการ / วัตถุประสงค์
        <input value={project} onChange={(e) => setProjects((p) => ({ ...p, [building]: e.target.value }))} disabled={!isAdmin} placeholder="เช่น สำรองอะไหล่ประจำไตรมาส 4/2569" />
      </label>
      <p className="muted">จำนวนสั่งตั้งต้น = Max − คงเหลือ · ราคา/หน่วย ตั้งต้น = ต้นทุน/หน่วยใน Genedia (ถ้าเป็น 0 ใช้ราคา/หน่วย · ช่องว่าง = ไม่มีราคา) · หมายเหตุตั้งต้นจากหมายเหตุของรายการ · แก้ได้ทุกช่อง · ไม่รวม VAT · ไฟล์ Excel มีชีต "สถิติการใช้" (Min/Max, รับเข้าล่าสุด, ราคาซื้อล่าสุด{usage.hasData && ', ใช้รายปี, เฉลี่ย/เดือน'}) แนบประกอบการขออนุมัติ</p>
      <div className="table-wrap">
        <table className="table po-table">
          <thead>
            <tr>
              <th>รูป</th><th>รหัส</th><th>ชื่อ</th><th>ยี่ห้อ</th><th>หน่วย</th><th className="num">คงเหลือ</th>
              <th className="num">Min/Max</th><th>รับเข้าล่าสุด</th><th className="num">จำนวนสั่ง</th><th>ตรวจตามการใช้</th><th className="num">ราคา/หน่วย</th><th className="num">รวม</th><th>หมายเหตุ</th><th />
            </tr>
          </thead>
          {sections.map(({ group, subs }) => (
            <tbody key={group}>
              <tr className="group-row"><td colSpan={14}>{group}</td></tr>
              {subs.flatMap(({ sub, items }) => [
                sub !== null && <tr key={`sub-${sub}`} className="sub-row"><td colSpan={14}><span className="mono">{sub || '–'}</span> {subNames[sub] || (sub ? '' : 'ไม่ระบุหมวดย่อย')}</td></tr>,
                ...items.map((l) => (
                <tr key={l.itemId}>
                  <td><Thumb src={l.it.thumb} /></td>
                  <td className="mono nowrap">{l.it.code}</td>
                  <td className="name-cell">{l.it.v.name}{l.it.ordering && <> <Badge color="blue">กำลังสั่ง</Badge></>}</td>
                  <td>{l.it.brand || '–'}</td>
                  <td>{l.it.v.unit}</td>
                  <td className="num">{fmtNum(l.it.v.stock)}</td>
                  <td className="num">{fmtNum(l.it.v.min)}/{fmtNum(l.it.v.max)}</td>
                  <td className="small nowrap">{l.lastIn || <span className="muted">–</span>}</td>
                  <td className="num"><input className="num-input" type="number" min="1" value={l.qty ?? ''} disabled={!isAdmin} onChange={(e) => setLine(l.itemId, { qty: numOrNull(e.target.value) })} aria-label="จำนวนสั่ง" /></td>
                  <td className="small usage-check"><UsageCheck item={l.it} qty={l.qty} usage={usage} other={l.it.ordering ? orderingQty[l.itemId] || 0 : 0} /></td>
                  <td className="num"><input className="num-input" type="number" min="0" step="0.01" value={l.price ?? ''} placeholder="0.00" disabled={!isAdmin} onChange={(e) => setLine(l.itemId, { price: numOrNull(e.target.value) })} aria-label="ราคาต่อหน่วย" /></td>
                  <td className="num">{l.price ? fmtNum(l.qty * l.price) : '–'}</td>
                  <td><input className="note-input" value={l.note} disabled={!isAdmin} onChange={(e) => setLine(l.itemId, { note: e.target.value })} aria-label="หมายเหตุ" /></td>
                  <td>{isAdmin && <button className="icon-btn" onClick={() => remove(l.itemId)} aria-label="เอาออก">✕</button>}</td>
                </tr>
                )),
              ])}
            </tbody>
          ))}
          <tfoot>
            <tr><td colSpan={11} className="num"><b>รวมทั้งสิ้น (ไม่รวม VAT)</b></td><td className="num"><b>{fmtNum(total)}</b></td><td colSpan={2} /></tr>
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
  const subNames = useSubNames();
  const list = pos.filter((p) => p.building === building);
  const items = Object.fromEntries(byBuilding[building].map((r) => [r.id, r]));

  const redownload = async (po) => {
    const images = await loadImages(po.lines.map((l) => l.itemId));
    const date = po.createdAt?.toDate?.() || new Date();
    // ใบที่สร้างก่อนมีชีตสถิติการใช้: ไม่มีตัวเลขการใช้/ราคาซื้อล่าสุด ณ วันที่สร้าง → ช่องเหล่านั้นว่าง
    download(await buildPoExcel({ building: po.building, date, project: po.project, lines: po.lines, images, subNames, usage: po.usage }), fileName(po.building, date));
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
