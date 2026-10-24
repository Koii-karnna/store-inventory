import { useState } from 'react';
import { serverTimestamp } from 'firebase/firestore';
import { useData } from '../state.jsx';
import { AsyncButton, toast } from '../ui.jsx';
import { commit } from '../lib/db.js';
import { fmtDateTime } from '../lib/model.js';

export const BACKUP_REMIND_DAYS = 30;

export const backupAgeDays = (info) => (info?.at?.toDate ? (Date.now() - info.at.toDate().getTime()) / 86400000 : null);

/** สำรอง / กู้คืนข้อมูล (หน้าตั้งค่า) */
export default function Backup() {
  const { user, backupInfo } = useData();
  const [status, setStatus] = useState(null);
  const [restore, setRestore] = useState(null);
  const age = backupAgeDays(backupInfo);

  const backup = async () => {
    const { createBackup } = await import('../lib/backup.js');
    const { download } = await import('../lib/excel.js');
    try {
      const { blob, manifest } = await createBackup((msg, i, n) => setStatus(`${msg}… (${i}/${n})`));
      const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
      download(blob, `store-backup_${stamp}.zip`);
      await commit(user,
        [{ type: 'set', path: ['settings', 'backup'], data: { at: serverTimestamp(), by: user.name, counts: manifest.counts, sizeKB: Math.round(blob.size / 1024) } }],
        [{ action: 'backup', summary: `สำรองข้อมูล ${Math.round(blob.size / 1024).toLocaleString('th-TH')} KB · รายการ ${manifest.counts.items} · รูป ${manifest.counts.images}` }]);
      toast('ดาวน์โหลดไฟล์สำรองแล้ว — เก็บไว้ใน OneDrive / Shared Drive ของหน่วยงาน');
    } finally {
      setStatus(null);
    }
  };

  const pick = async (file) => {
    const { readBackup, restoreOps, COLLECTION_LABELS } = await import('../lib/backup.js');
    try {
      const data = await readBackup(file);
      setRestore({ name: file.name, ...data, ops: restoreOps(data.collections), labels: COLLECTION_LABELS });
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const doRestore = async () => {
    const created = new Date(restore.manifest.createdAt).toLocaleString('th-TH');
    if (!confirm(`กู้คืนข้อมูลจากไฟล์สำรองวันที่ ${created}?\n\nข้อมูลในไฟล์จะเขียนทับข้อมูลปัจจุบันของรายการเดียวกัน`)) return;
    if (!confirm('ยืนยันอีกครั้ง: ข้อมูลที่แก้หลังจากวันที่สำรอง (ของรายการที่อยู่ในไฟล์) จะหายไป')) return;
    const { small, images } = restore.ops;
    const total = small.length + images.length;
    let done = 0;
    const step = (n) => { done += n; setStatus(`กำลังกู้คืน ${done}/${total}`); };
    try {
      for (let i = 0; i < small.length; i += 400) { await commit(user, small.slice(i, i + 400)); step(Math.min(400, small.length - i)); }
      for (let i = 0; i < images.length; i += 40) { await commit(user, images.slice(i, i + 40)); step(Math.min(40, images.length - i)); }
      await commit(user, [], [{ action: 'backup', summary: `กู้คืนข้อมูลจาก ${restore.name} (สำรองเมื่อ ${created}) ${total} รายการข้อมูล` }]);
      toast('กู้คืนข้อมูลเรียบร้อย');
      setRestore(null);
    } finally {
      setStatus(null);
    }
  };

  return (
    <section className="card">
      <h2>สำรองข้อมูล</h2>
      <p className={age === null || age > BACKUP_REMIND_DAYS ? 'warn' : 'muted'}>
        สำรองล่าสุด: {backupInfo?.at ? `${fmtDateTime(backupInfo.at)} โดย ${backupInfo.by}` : 'ยังไม่เคยสำรอง'}
        {age !== null && age > BACKUP_REMIND_DAYS && ` · เกิน ${BACKUP_REMIND_DAYS} วันแล้ว`}
      </p>
      <p className="muted small">
        ไฟล์สำรองรวมทุกอย่าง: รายการ รูป Vendor หมายเหตุ ใบขอซื้อ ผู้ใช้ ตั้งค่า และ Log ·
        แนะนำให้สำรองเดือนละครั้ง (หรือก่อนนำเข้า Master / แก้ข้อมูลจำนวนมาก) แล้วเก็บไฟล์ไว้ใน OneDrive หรือ Shared Drive ของหน่วยงาน
      </p>
      {status ? <p className="note">{status}</p> : (
        <div className="row-actions">
          <AsyncButton className="btn btn-primary" onClick={backup}>ดาวน์โหลดไฟล์สำรอง</AsyncButton>
          <label className="btn btn-ghost">
            <input type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) pick(f); }} />
            กู้คืนจากไฟล์สำรอง…
          </label>
        </div>
      )}
      {restore && !status && (
        <div className="restore-box">
          <h4>ไฟล์ {restore.name}</h4>
          <p className="small">สำรองเมื่อ {new Date(restore.manifest.createdAt).toLocaleString('th-TH')} · โปรเจกต์ {restore.manifest.projectId}</p>
          <table className="table compact">
            <tbody>
              {Object.entries(restore.manifest.counts).map(([k, n]) => (
                <tr key={k}><td>{restore.labels[k] || k}</td><td className="num">{n.toLocaleString('th-TH')}</td><td className="muted small">{k === 'logs' ? 'เก็บไว้ในไฟล์ ไม่เขียนกลับ' : ''}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            การกู้คืนจะเขียนข้อมูลในไฟล์ทับข้อมูลเดิมของรายการเดียวกัน · รายการที่เพิ่มหลังวันสำรองจะยังอยู่ (ไม่ถูกลบ) ·
            บัญชี login และรหัสผ่านไม่ได้อยู่ในไฟล์ (ถ้าบัญชีถูกลบไปแล้ว ต้องสร้างใหม่)
          </p>
          <div className="row-actions">
            <AsyncButton className="btn btn-primary" onClick={doRestore}>กู้คืนข้อมูล</AsyncButton>
            <button className="btn btn-ghost" onClick={() => setRestore(null)}>ยกเลิก</button>
          </div>
        </div>
      )}
    </section>
  );
}
