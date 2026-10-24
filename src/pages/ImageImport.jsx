import { useState } from 'react';
import { serverTimestamp } from 'firebase/firestore';
import { useData } from '../state.jsx';
import { AsyncButton, toast } from '../ui.jsx';
import { commit } from '../lib/db.js';
import { processImage } from '../lib/image.js';

const CHUNK = 20; // รูปต่อการบันทึก 1 ครั้ง (ไม่ให้เกินขนาดที่ Firestore รับได้)

/** นำเข้ารูปจากไฟล์ Excel ที่มีคอลัมน์รหัส (Code) — รูปวางในเซลล์ หรือลอยบนเซลล์ */
export default function ImageImport() {
  const { rows, user } = useData();
  const [scan, setScan] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  const read = async (file) => {
    setResult(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setScan({ needXlsx: true, name: file.name });
      return;
    }
    setScan({ loading: true, name: file.name });
    try {
      const { extractCellImages } = await import('../lib/cellImages.js');
      const { images, noCode } = await extractCellImages(file);
      const byCode = {};
      for (const r of rows) (byCode[r.code] ??= []).push(r);
      const matches = [], notFound = [], ambiguous = [];
      for (const img of images) {
        const found = byCode[img.code] || [];
        if (found.length === 1) matches.push({ img, item: found[0] });
        else (found.length ? ambiguous : notFound).push(img.code);
      }
      setScan({ name: file.name, total: images.length, noCode, matches, notFound, ambiguous });
    } catch (e) {
      console.error(e);
      setScan(null);
      toast(`อ่านไฟล์ไม่ได้: ${e.message}`, 'err');
    }
  };

  const todo = scan?.matches ? scan.matches.filter((m) => overwrite || !m.item.hasImage) : [];
  const existing = scan?.matches ? scan.matches.filter((m) => m.item.hasImage).length : 0;
  const byB = (b) => todo.filter((m) => m.item.building === b).length;

  const run = async () => {
    const failed = [];
    let done = 0;
    setProgress({ done, total: todo.length });
    for (let i = 0; i < todo.length; i += CHUNK) {
      const ops = [], logs = [];
      for (const { img, item } of todo.slice(i, i + CHUNK)) {
        try {
          const { full, thumb, bytes } = await processImage(await img.blob());
          ops.push(
            { type: 'set', path: ['images', item.id], data: { data: full, at: serverTimestamp(), by: user.name } },
            { type: 'update', path: ['items', item.id], data: { thumb, hasImage: true, updatedAt: serverTimestamp() } },
          );
          logs.push({ action: 'image', building: item.building, code: item.code, itemId: item.id, changes: [{ field: 'image', from: item.hasImage ? 'มีรูป' : null, to: `รูปจาก Excel ${Math.round(bytes / 1024)} KB` }] });
        } catch (e) {
          failed.push(`${img.code} (${e.message})`);
        }
      }
      if (ops.length) await commit(user, ops, logs);
      done = Math.min(i + CHUNK, todo.length);
      setProgress({ done, total: todo.length });
    }
    const ok = todo.length - failed.length;
    await commit(user, [], [{ action: 'image', summary: `นำเข้ารูปจาก ${scan.name} ${ok} รูป${failed.length ? ` (ไม่สำเร็จ ${failed.length})` : ''}` }]);
    setProgress(null);
    setResult({ ok, failed });
    setScan(null);
    toast(`นำเข้ารูปแล้ว ${ok} รูป`);
  };

  return (
    <div className="card">
      <h2>นำเข้ารูปจาก Excel</h2>
      <p className="muted small">
        สำหรับไฟล์ Excel (.xlsx) ที่มีรูปอยู่ในแถวเดียวกับรหัส (หัวตาราง <b>Code</b> หรือ <b>รหัส</b>) — รูปแบบ <b>วางในเซลล์</b> หรือ <b>ลอยบนเซลล์</b> ก็ได้ ·
        ระบบย่อรูปให้อัตโนมัติ (ไม่เกิน 80 KB) · ไฟล์ .xls ให้ Save As เป็น .xlsx ก่อน
      </p>
      {!progress && (
        <label className="btn">
          <input type="file" accept=".xlsx,.xls" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) read(f); }} />
          เลือกไฟล์ Excel ที่มีรูป
        </label>
      )}
      {scan?.loading && <p className="muted">กำลังอ่าน {scan.name}…</p>}
      {scan?.needXlsx && (
        <div className="warn" style={{ marginTop: 12 }}>
          <b>{scan.name}</b> เป็นไฟล์ Excel รุ่นเก่า (.xls) ซึ่งเว็บอ่านรูปไม่ได้ ให้แปลงก่อน:
          <ol>
            <li>เปิดไฟล์ใน Excel</li>
            <li><b>File → Save As</b> → ช่อง Save as type เลือก <b>Excel Workbook (*.xlsx)</b> → Save</li>
            <li>กลับมาเลือกไฟล์ .xlsx ที่ได้</li>
          </ol>
        </div>
      )}
      {scan?.matches && (
        <div className="form" style={{ marginTop: 12 }}>
          <table className="table compact">
            <tbody>
              <tr><td>รูปในไฟล์ {scan.name}</td><td className="num">{scan.total}</td></tr>
              <tr><td>ตรงกับรายการในระบบ</td><td className="num">{scan.matches.length}</td></tr>
              <tr><td>รายการนี้มีรูปอยู่แล้ว</td><td className="num">{existing}</td></tr>
              <tr><td>ไม่พบรหัสในระบบ</td><td className="num">{scan.notFound.length}</td></tr>
              {scan.ambiguous.length > 0 && <tr><td>รหัสซ้ำทั้ง CMC และ NP (ข้าม)</td><td className="num">{scan.ambiguous.length}</td></tr>}
              {scan.noCode > 0 && <tr><td>รูปที่ไม่มีรหัสในแถว (ข้าม)</td><td className="num">{scan.noCode}</td></tr>}
            </tbody>
          </table>
          {scan.notFound.length > 0 && <details><summary>รหัสที่ไม่พบ</summary><p className="mono small">{scan.notFound.join(', ')}</p></details>}
          {existing > 0 && (
            <label className="inline">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              แทนที่รูปเดิมที่มีอยู่แล้ว ({existing} รายการ)
            </label>
          )}
          <div className="row-actions">
            <AsyncButton className="btn btn-primary" onClick={run} disabled={!todo.length}>
              นำเข้า {todo.length} รูป (CMC {byB('CMC')} · NP {byB('NP')})
            </AsyncButton>
            <button className="btn btn-ghost" onClick={() => setScan(null)}>ยกเลิก</button>
          </div>
        </div>
      )}
      {progress && (
        <div className="progress"><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /><span>กำลังย่อและบันทึกรูป {progress.done}/{progress.total}</span></div>
      )}
      {result && (
        <p className={result.failed.length ? 'warn' : 'note'}>
          นำเข้าสำเร็จ {result.ok} รูป{result.failed.length > 0 && <> · ไม่สำเร็จ {result.failed.length}: {result.failed.join(', ')}</>}
        </p>
      )}
    </div>
  );
}
