import { useState } from 'react';
import { useData } from '../state.jsx';
import { AsyncButton, toast } from '../ui.jsx';
import { commit } from '../lib/db.js';
import Backup from './Backup.jsx';

export default function Settings() {
  const { settings, user } = useData();
  const [form, setForm] = useState(settings);

  const save = async () => {
    const nearPct = Number(form.nearPct);
    if (!(nearPct >= 0 && nearPct <= 200)) throw new Error('% ใกล้ Min ต้องอยู่ระหว่าง 0–200');
    const next = { preferMaster: !!form.preferMaster, nearPct };
    const changes = [
      settings.preferMaster !== next.preferMaster && { field: 'แสดงชื่อ/หน่วยตาม Master', from: settings.preferMaster, to: next.preferMaster },
      settings.nearPct !== next.nearPct && { field: '% ใกล้ Min', from: settings.nearPct, to: next.nearPct },
    ].filter(Boolean);
    if (!changes.length) return toast('ไม่มีการเปลี่ยนแปลง');
    await commit(user, [{ type: 'set', path: ['settings', 'app'], data: next, merge: true }], [{ action: 'settings', changes }]);
    toast('บันทึกการตั้งค่าแล้ว');
  };

  return (
    <div className="page narrow">
      <div className="page-head"><h1>ตั้งค่า</h1></div>
      <section className="card">
        <h2>ช่วงเปลี่ยนผ่าน (IT กำลังแก้ Genedia)</h2>
        <label className="inline">
          <input type="checkbox" checked={!!form.preferMaster} onChange={(e) => setForm({ ...form, preferMaster: e.target.checked })} />
          แสดง <b>ชื่อ / หน่วยนับ</b> ตาม Master
        </label>
        <p className="muted small">
          เปิดไว้ระหว่างที่ IT ยังแก้ Genedia ไม่เสร็จ — เมื่อหน้า "ไม่ตรง Master" เหลือน้อยหรือหมดแล้ว ให้ปิด เว็บจะแสดงตาม Genedia ทั้งหมด
          (คงเหลือ / Min / Max แสดงตาม Genedia เสมอ · สถานะ: ยกเลิกใน Genedia หรือ Master อย่างใดอย่างหนึ่ง = ยกเลิก)
        </p>
      </section>
      <section className="card">
        <h2>การแจ้งเตือน</h2>
        <label>ระดับ "ใกล้ Min" = คงเหลือไม่เกิน Min + <input className="num-input" type="number" min="0" max="200" value={form.nearPct} onChange={(e) => setForm({ ...form, nearPct: e.target.value })} /> %</label>
        <p className="muted small">ตัวอย่าง Min 10 และ 20% → คงเหลือ 11–12 = ใกล้ Min · 1–10 = ถึง Min · 0 = หมด · รายการที่ Min ว่างหรือเป็น 0 ถือว่า "ไม่มี Min" ไม่แจ้งเตือน</p>
      </section>
      <AsyncButton className="btn btn-primary" onClick={save}>บันทึกการตั้งค่า</AsyncButton>
      <Backup />
    </div>
  );
}
