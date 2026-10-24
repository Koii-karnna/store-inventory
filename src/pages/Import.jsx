import { useState } from 'react';
import { doc, collection, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useData } from '../state.jsx';
import { AsyncButton, toast } from '../ui.jsx';
import { commit, describeChange, slimChange } from '../lib/db.js';
import { planImport } from '../lib/importPlan.js';
import ImageImport from './ImageImport.jsx';

const KIND_LABEL = {
  store: 'Store Part List (คงเหลือ/Min/Max/สถานะ)',
  report: 'Part List Report (หน่วยนับ/Group ใน Genedia)',
  master: 'Master (ชื่อ/Group/หมวดย่อย/ยี่ห้อ ตามมาตรฐาน)',
  unknown: 'ไม่รู้จักไฟล์นี้',
};

export default function ImportPage() {
  const { rows, taxonomy, user } = useData();
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

  const valid = files.filter((f) => f.parsed.kind !== 'unknown');
  const stores = valid.filter((f) => f.parsed.kind === 'store');
  const dupBuilding = ['CMC', 'NP'].find((b) => stores.filter((f) => f.parsed.building === b).length > 1);
  const hasMaster = valid.some((f) => f.parsed.kind === 'master');
  const missingBuilding = stores.some((f) => !f.parsed.building);

  const check = async () => {
    const existing = rows.map(({ v, lv, ...rest }) => rest); // eslint-disable-line no-unused-vars
    setPlan(planImport(existing, valid.map((f) => f.parsed), taxonomy, { overwriteWeb }));
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
    setProgress({ done: 0, total: ops.length + logs.length });
    try {
      await commit(user, ops, logs, (done, total) => setProgress({ done, total }));
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
                  <td className={f.parsed.kind === 'unknown' ? 't-red' : ''}>{KIND_LABEL[f.parsed.kind]}{f.error && ` (${f.error})`}</td>
                  <td>
                    {f.parsed.kind === 'store' ? (
                      <select value={f.parsed.building || ''} onChange={(e) => setBuilding(f.name, e.target.value)}>
                        <option value="">– เลือก –</option><option value="CMC">CMC</option><option value="NP">NP (CMA)</option>
                      </select>
                    ) : f.parsed.kind === 'report' ? 'CMC + NP' : f.parsed.kind === 'master' ? 'CMC + NP' : '–'}
                    {f.parsed.kind === 'store' && !f.parsed.buildingFromName && f.parsed.building && <div className="small t-orange">เดาจากรหัส กรุณาตรวจ</div>}
                  </td>
                  <td className="num">{f.parsed.items?.length ?? '–'}</td>
                  <td><button className="icon-btn" onClick={() => removeFile(f.name)} aria-label="เอาออก">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
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
          ) : !creates.length && <p className="muted">ไม่มีการเปลี่ยนแปลงของอาคาร {showB}</p>}

          <div className="row-actions">
            {progress
              ? <div className="progress"><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /><span>กำลังบันทึก {progress.done}/{progress.total}</span></div>
              : <AsyncButton className="btn btn-primary" onClick={confirmImport} disabled={!plan.creates.length && !plan.updates.length && !plan.taxonomy && !stores.length}>ยืนยันนำเข้า</AsyncButton>}
          </div>
        </div>
      )}

      <ImageImport />
    </div>
  );
}
