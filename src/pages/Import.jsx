import { useState } from 'react';
import { doc, collection, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useData } from '../state.jsx';
import { AsyncButton, toast } from '../ui.jsx';
import { commit, describeChange, slimChange } from '../lib/db.js';
import { planImport } from '../lib/importPlan.js';
import { planUsage, usageDocId, USAGE_META_ID } from '../lib/usage.js';
import { loadUsageDoc, clearUsageCache } from '../lib/usageStore.js';
import { planReceive, receiveItemPatches, receiveDocId, RECEIVE_META_ID } from '../lib/receive.js';
import { loadReceiveDoc, clearReceiveCache } from '../lib/receiveStore.js';
import ImageImport from './ImageImport.jsx';

const KIND_LABEL = {
  store: 'Store Part List (คงเหลือ/Min/Max/สถานะ)',
  report: 'Part List Report (หน่วยนับ/Group ใน Genedia)',
  master: 'Master (ชื่อ/Group/หมวดย่อย/ยี่ห้อ ตามมาตรฐาน)',
  usageReport: 'Part Usage Report (การเบิกอะไหล่)',
  usageBaseline: 'ประวัติการเบิกที่ตรวจแล้ว (ตั้งต้น — แทนที่ข้อมูลการเบิกทั้งหมด)',
  g1Usage: 'รายงานการใช้อะไหล่ระบบ G1 (เดิม) — ไม่ต้องนำเข้า',
  receiveReport: 'Part Receive Report (การรับเข้าอะไหล่)',
  unknown: 'ไม่รู้จักไฟล์นี้',
};
const NOT_IN_MASTER = 'รหัสไม่อยู่ใน Master (เก็บเป็นประวัติ)';

export default function ImportPage() {
  const { rows, byBuilding, taxonomy, user, usageMeta, receiveMeta } = useData();
  const [files, setFiles] = useState([]);
  const [overwriteWeb, setOverwriteWeb] = useState(false);
  const [plan, setPlan] = useState(null);
  const [progress, setProgress] = useState(null);
  const [showB, setShowB] = useState('CMC');
  const [drag, setDrag] = useState(false);

  const addFiles = async (list) => {
    setPlan(null);
    const { readWorkbook, parseFile } = await import('../lib/parse.js');
    const parsed = await Promise.all([...list].map(async (file) => {
      try { return { name: file.name, parsed: parseFile(file.name, readWorkbook(await file.arrayBuffer())) }; } catch (e) { return { name: file.name, parsed: { kind: 'unknown' }, error: e.message }; }
    }));
    setFiles((cur) => [...cur.filter((c) => !parsed.some((p) => p.name === c.name)), ...parsed]);
  };
  const setBuilding = (name, b) => { setPlan(null); setFiles((fs) => fs.map((f) => (f.name === name ? { ...f, parsed: { ...f.parsed, building: b } } : f))); };
  const removeFile = (name) => { setPlan(null); setFiles((fs) => fs.filter((f) => f.name !== name)); };

  const valid = files.filter((f) => !['unknown', 'g1Usage'].includes(f.parsed.kind));
  const hasG1 = files.some((f) => f.parsed.kind === 'g1Usage');
  const stores = valid.filter((f) => f.parsed.kind === 'store');
  const dupBuilding = ['CMC', 'NP'].find((b) => stores.filter((f) => f.parsed.building === b).length > 1);
  const hasMaster = valid.some((f) => f.parsed.kind === 'master');
  const missingBuilding = stores.some((f) => !f.parsed.building);

  const check = async () => {
    const existing = rows.map(({ v, lv, ...rest }) => rest); // eslint-disable-line no-unused-vars
    const p = planImport(existing, valid.map((f) => f.parsed), taxonomy, { overwriteWeb });

    // ข้อมูลการเบิก: ไฟล์ตั้งต้นแทนที่ทั้งหมด · Part Usage Report เพิ่มเฉพาะบรรทัดใหม่
    const baseline = valid.find((f) => f.parsed.kind === 'usageBaseline')?.parsed;
    const reports = valid.filter((f) => f.parsed.kind === 'usageReport').map((f) => f.parsed);
    if (baseline || reports.length) {
      const inMaster = new Set(rows.filter((r) => r.m).map((r) => r.id));
      const incoming = [
        ...(baseline?.usage || []),
        ...reports.flatMap((r) => r.usage).map(({ building, lines }) => ({
          building,
          lines: lines.map((ln) => (inMaster.has(`${building}_${ln.c}`) ? ln : { ...ln, x: NOT_IN_MASTER })),
        })),
      ];
      const existingDocs = {};
      if (!baseline) {
        for (const b of ['CMC', 'NP']) {
          for (const y of usageMeta?.years?.[b] || []) existingDocs[usageDocId(b, y)] = await loadUsageDoc(b, y);
        }
      }
      p.usage = { ...planUsage(existingDocs, incoming, { replace: !!baseline }), baseline: !!baseline, noMinMax: baseline?.noMinMax };
    }

    // ข้อมูลรับเข้า: เพิ่มเฉพาะบรรทัดใหม่ → อัปเดตรับเข้าล่าสุด (เมื่อใหม่กว่า) และปลดป้ายกำลังสั่ง
    const receives = valid.filter((f) => f.parsed.kind === 'receiveReport').flatMap((f) => f.parsed.receive);
    if (receives.length) {
      const existingDocs = {};
      if (receiveMeta?.version) for (const b of ['CMC', 'NP']) existingDocs[receiveDocId(b)] = await loadReceiveDoc(b);
      const pr = planReceive(existingDocs, receives);
      const patches = ['CMC', 'NP'].flatMap((b) => receiveItemPatches(pr.docs[receiveDocId(b)] || [], byBuilding[b]));
      p.receive = { ...pr, patches };
    }
    setPlan(p);
  };

  const confirmImport = async () => {
    const importId = doc(collection(db, 'imports')).id;
    const buildings = [...new Set(stores.map((f) => f.parsed.building))];
    const ops = [
      ...plan.creates.map(({ id, data }) => {
        const { id: _drop, ...rest } = data; // eslint-disable-line no-unused-vars
        return { type: 'set', path: ['items', id], data: { ...rest, createdAt: serverTimestamp(), updatedAt: serverTimestamp() } };
      }),
      ...plan.updates.map((u) => ({ type: 'update', path: ['items', u.id], data: { ...u.patch, updatedAt: serverTimestamp() } })),
      { type: 'set', path: ['imports', importId], data: { at: serverTimestamp(), uid: user.uid, user: user.name, files: valid.map((f) => f.name), buildings, summary: plan.summary } },
    ];
    if (plan.taxonomy) ops.push({ type: 'set', path: ['config', 'taxonomy'], data: plan.taxonomy });
    if (plan.brands?.length) ops.push({ type: 'set', path: ['config', 'brands'], data: { list: arrayUnion(...plan.brands) }, merge: true });
    const s = plan.summary;
    const logs = [
      { action: 'import', importId, summary: `นำเข้า ${valid.map((f) => f.name).join(', ')} · CMC ใหม่ ${s.CMC.created} แก้ ${s.CMC.updated} · NP ใหม่ ${s.NP.created} แก้ ${s.NP.updated}` },
      ...plan.updates.map((u) => ({ action: 'import', importId, building: u.building, code: u.code, itemId: u.id, changes: u.changes.map(slimChange) })),
    ];

    // ข้อมูลการเบิก: เขียนเฉพาะเอกสาร (อาคาร-ปี) ที่เปลี่ยน + meta
    const usageOps = [];
    if (plan.usage) {
      const u = plan.usage;
      for (const id of u.changed) {
        const [, b, y] = id.split('_');
        usageOps.push({ type: 'set', path: ['config', id], data: { building: b, year: Number(y), lines: u.docs[id], updatedAt: serverTimestamp() } });
      }
      const years = { CMC: [], NP: [] };
      for (const id of Object.keys(u.docs)) { const [, b, y] = id.split('_'); if (u.docs[id].length) years[b].push(Number(y)); }
      for (const b of Object.keys(years)) years[b].sort();
      usageOps.push({
        type: 'set', path: ['config', USAGE_META_ID], merge: true,
        data: { years, version: Date.now(), lastImport: { at: serverTimestamp(), by: user.name, files: valid.filter((f) => f.parsed.kind.startsWith('usage')).map((f) => f.name) }, ...(u.baseline ? { noMinMax: u.noMinMax || [] } : {}) },
      });
      const us = u.summary;
      logs.push({ action: 'import', importId, summary: `ข้อมูลการเบิก${u.baseline ? ' (ตั้งต้น แทนที่ทั้งหมด)' : ''}: ${Object.entries(us).map(([b, x]) => `${b} เพิ่ม ${x.added} บรรทัด ซ้ำ ${x.duplicate}`).join(' · ')}` });
    }
    if (plan.receive) {
      const r = plan.receive;
      for (const id of r.changed) {
        usageOps.push({ type: 'set', path: ['config', id], data: { building: id.split('_')[1], lines: r.docs[id], updatedAt: serverTimestamp() } });
      }
      usageOps.push({
        type: 'set', path: ['config', RECEIVE_META_ID], merge: true,
        data: { version: Date.now(), lastImport: { at: serverTimestamp(), by: user.name, files: valid.filter((f) => f.parsed.kind === 'receiveReport').map((f) => f.name) } },
      });
      for (const { item, patch } of r.patches) {
        ops.push({ type: 'update', path: ['items', item.id], data: { ...patch, updatedAt: serverTimestamp() } });
        logs.push({
          action: 'import', importId, building: item.building, code: item.code, itemId: item.id,
          changes: Object.entries(patch).map(([k, v]) => slimChange({ field: k, from: k === 'ordering' ? 'กำลังสั่ง' : item[k] ?? null, to: k === 'ordering' ? 'รับเข้าแล้ว' : v })),
        });
      }
      logs.push({ action: 'import', importId, summary: `ข้อมูลรับเข้า: ${Object.entries(r.summary).map(([b, x]) => `${b} เพิ่ม ${x.added} บรรทัด ซ้ำ ${x.duplicate}`).join(' · ')} · อัปเดต ${r.patches.length} รายการ` });
    }
    setProgress({ done: 0, total: ops.length + logs.length + usageOps.length });
    try {
      // เอกสารการเบิกมีขนาดใหญ่ บันทึกทีละเอกสาร
      for (const [i, op] of usageOps.entries()) { await commit(user, [op]); setProgress({ done: i + 1, total: ops.length + logs.length + usageOps.length }); }
      await commit(user, ops, logs, (done, total) => setProgress({ done: done + usageOps.length, total: total + usageOps.length }));
      clearUsageCache();
      clearReceiveCache();
      toast('นำเข้าเรียบร้อย');
      setFiles([]); setPlan(null);
    } finally {
      setProgress(null);
    }
  };

  const updates = plan ? plan.updates.filter((u) => u.building === showB) : [];
  const creates = plan ? plan.creates.filter((c) => c.data.building === showB) : [];

  return (
    <div className="page">
      <div className="page-head"><h1>นำเข้าไฟล์จาก Genedia</h1></div>

      <ol className="steps muted">
        <li>Export จาก Genedia: <b>Store Part List [CMC].xls</b>, <b>Store Part List [CMA].xls</b> และ <b>Part List Report</b></li>
        <li>ลากไฟล์ทั้งหมดมาวางพร้อมกัน (ครั้งแรกให้ใส่ไฟล์ <b>Master</b> ด้วย)</li>
        <li>กด "ตรวจสอบ" ดูว่ามีอะไรเปลี่ยน แล้วกด "ยืนยันนำเข้า"</li>
        <li>การเบิก / รับเข้า: ใส่ <b>Part Usage Report</b> และ <b>Part Receive Report</b> ของ CMC และ NP (ไม่ต้องกรองวันที่) — ระบบตัดบรรทัดที่เคยนำเข้าแล้วให้เอง</li>
      </ol>

      <label
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
      >
        <input type="file" multiple accept=".xls,.xlsx" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <b>ลากไฟล์ Excel มาวางที่นี่</b> หรือคลิกเพื่อเลือกไฟล์
      </label>

      {files.length > 0 && (
        <div className="card">
          <table className="table">
            <thead><tr><th>ไฟล์</th><th>ประเภท</th><th>อาคาร</th><th className="num">แถว</th><th /></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name}>
                  <td>{f.name}</td>
                  <td className={f.parsed.kind === 'unknown' ? 't-red' : f.parsed.kind === 'g1Usage' ? 't-orange' : ''}>{KIND_LABEL[f.parsed.kind]}{f.error && ` (${f.error})`}</td>
                  <td>
                    {f.parsed.kind === 'store' ? (
                      <select value={f.parsed.building || ''} onChange={(e) => setBuilding(f.name, e.target.value)}>
                        <option value="">– เลือก –</option><option value="CMC">CMC</option><option value="NP">NP (CMA)</option>
                      </select>
                    ) : ['usageReport', 'receiveReport'].includes(f.parsed.kind) ? (f.parsed.building || '–')
                      : ['report', 'master', 'usageBaseline'].includes(f.parsed.kind) ? 'CMC + NP' : '–'}
                    {f.parsed.kind === 'store' && !f.parsed.buildingFromName && f.parsed.building && <div className="small t-orange">เดาจากรหัส กรุณาตรวจ</div>}
                  </td>
                  <td className="num">{f.parsed.items?.length ?? '–'}</td>
                  <td><button className="icon-btn" onClick={() => removeFile(f.name)} aria-label="เอาออก">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasG1 && (
            <p className="warn">
              ไฟล์ G1 (สรุปการใช้อะไหล่ 2023–2026) รวมอยู่ในไฟล์ <b>Usage_Reconciliation_2023-2026_…_v2.xlsx</b> แล้ว
              (อยู่ในโฟลเดอร์ <b>Store Part list\Output</b>) พร้อมการปรับที่ตรวจสอบแล้ว — ให้นำเข้าไฟล์นั้นแทน ไฟล์ G1 จะไม่ถูกนำเข้า
            </p>
          )}
          {!taxonomy && !hasMaster && <p className="warn">ยังไม่เคยนำเข้าไฟล์ Master — ครั้งแรกควรใส่ไฟล์ Master ด้วย เพื่อตั้งต้น Group/หมวดย่อย/ยี่ห้อ</p>}
          {dupBuilding && <p className="error">มีไฟล์ Store Part List ของอาคาร {dupBuilding} มากกว่า 1 ไฟล์</p>}
          {missingBuilding && <p className="error">กรุณาเลือกอาคารของไฟล์ Store Part List</p>}
          {hasMaster && rows.length > 0 && (
            <label className="inline">
              <input type="checkbox" checked={overwriteWeb} onChange={(e) => { setOverwriteWeb(e.target.checked); setPlan(null); }} />
              ให้ Master ทับ Group / หมวดย่อย / ยี่ห้อ ที่แก้ในเว็บไปแล้วด้วย (ปกติไม่ต้องติ๊ก: จะเติมเฉพาะช่องที่ว่าง)
            </label>
          )}
          <div className="row-actions">
            <AsyncButton className="btn btn-primary" onClick={check} disabled={!valid.length || dupBuilding || missingBuilding}>ตรวจสอบการเปลี่ยนแปลง</AsyncButton>
          </div>
        </div>
      )}

      {plan && (
        <div className="card">
          <h2>ผลการตรวจสอบ</h2>
          <table className="table compact">
            <thead><tr><th>อาคาร</th><th className="num">รายการใหม่</th><th className="num">มีการเปลี่ยน</th><th className="num">คงเหลือเปลี่ยน</th><th className="num">รอตรวจ Group</th><th className="num">หายจาก Genedia</th><th className="num">ปลดป้ายกำลังสั่ง</th></tr></thead>
            <tbody>
              {['CMC', 'NP'].map((b) => {
                const s = plan.summary[b];
                return <tr key={b}><td>{b}</td><td className="num">{s.created}</td><td className="num">{s.updated}</td><td className="num">{s.stockChanged}</td><td className="num">{s.needReview}</td><td className="num">{s.missing}</td><td className="num">{s.orderCleared}</td></tr>;
              })}
            </tbody>
          </table>

          <div className="seg-tabs">
            {['CMC', 'NP'].map((b) => <button key={b} className={showB === b ? 'active' : ''} onClick={() => setShowB(b)}>{b}</button>)}
          </div>
          {creates.length > 0 && (
            <details>
              <summary>รายการใหม่ {creates.length} รายการ</summary>
              <ul className="change-list">{creates.slice(0, 300).map((c) => <li key={c.id}><span className="mono">{c.data.code}</span> {c.data.m?.name || c.data.g?.name} <span className="muted">→ {c.data.group || 'ไม่ระบุ Group'}{c.data.review && ' (รอตรวจ)'}</span></li>)}</ul>
            </details>
          )}
          {updates.length > 0 ? (
            <details open={updates.length <= 50}>
              <summary>มีการเปลี่ยน {updates.length} รายการ</summary>
              <ul className="change-list">
                {updates.slice(0, 300).map((u) => <li key={u.id}><span className="mono">{u.code}</span> — {u.changes.map(describeChange).join(' · ')}</li>)}
                {updates.length > 300 && <li className="muted">…และอีก {updates.length - 300} รายการ</li>}
              </ul>
            </details>
          ) : !creates.length && <p className="muted">ไม่มีการเปลี่ยนแปลงของรายการอาคาร {showB}</p>}

          {plan.usage && (
            <>
              <h4>ข้อมูลการเบิก{plan.usage.baseline && <span className="t-orange"> — ไฟล์ตั้งต้น: จะแทนที่ข้อมูลการเบิกเดิมทั้งหมด</span>}</h4>
              <table className="table compact">
                <thead><tr><th>อาคาร</th><th className="num">บรรทัดใหม่</th><th className="num">ซ้ำ (ข้าม)</th><th className="num">จำนวนเบิกที่เพิ่ม</th><th className="num">ไม่นับ (รหัสไม่อยู่ใน Master ฯลฯ)</th><th className="num">วันที่ผิดปกติ</th></tr></thead>
                <tbody>
                  {Object.entries(plan.usage.summary).map(([b, x]) => (
                    <tr key={b}><td>{b}</td><td className="num">{x.added}</td><td className="num">{x.duplicate}</td><td className="num">{Math.round(x.qty * 1000) / 1000}</td><td className="num">{x.notCounted}</td><td className="num">{x.badDate ? <b className="t-red">{x.badDate}</b> : 0}</td></tr>
                  ))}
                </tbody>
              </table>
              {Object.values(plan.usage.summary).some((x) => x.badDate) && <p className="warn small">มีบรรทัดที่วันที่ปิดงานก่อนปี 2023 — นำเข้าตามต้นทาง ควรตรวจใน Genedia</p>}
            </>
          )}

          {plan.receive && (
            <>
              <h4>ข้อมูลรับเข้า</h4>
              <table className="table compact">
                <thead><tr><th>อาคาร</th><th className="num">บรรทัดใหม่</th><th className="num">ซ้ำ (ข้าม)</th><th className="num">อัปเดตรับเข้าล่าสุด</th><th className="num">ปลดป้ายกำลังสั่ง</th></tr></thead>
                <tbody>
                  {Object.entries(plan.receive.summary).map(([b, x]) => {
                    const ps = plan.receive.patches.filter((p) => p.item.building === b);
                    return <tr key={b}><td>{b}</td><td className="num">{x.added}</td><td className="num">{x.duplicate}</td><td className="num">{ps.filter((p) => 'lastInDate' in p.patch).length}</td><td className="num">{ps.filter((p) => 'ordering' in p.patch).length}</td></tr>;
                  })}
                </tbody>
              </table>
              <p className="muted small">วันที่/จำนวนรับเข้าล่าสุดจะทับค่าเดิมเฉพาะเมื่อวันที่ในไฟล์ใหม่กว่า · ราคาในไฟล์เก็บไว้ดูเท่านั้น ยังไม่นำไปใช้</p>
            </>
          )}

          <div className="row-actions">
            {progress
              ? <div className="progress"><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /><span>กำลังบันทึก {progress.done}/{progress.total}</span></div>
              : <AsyncButton className="btn btn-primary" onClick={confirmImport} disabled={!plan.creates.length && !plan.updates.length && !plan.taxonomy && !stores.length && !plan.usage?.changed.length && !plan.receive?.changed.length && !plan.receive?.patches.length}>ยืนยันนำเข้า</AsyncButton>}
          </div>
        </div>
      )}

      <ImageImport />
    </div>
  );
}
