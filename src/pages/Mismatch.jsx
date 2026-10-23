import { useMemo, useState } from 'react';
import { useData } from '../state.jsx';
import { Empty, AsyncButton } from '../ui.jsx';
import { mismatches, MISMATCH_TYPES } from '../lib/model.js';
import { buildMismatchExcel, download } from '../lib/excel.js';
import ItemDrawer from './ItemDrawer.jsx';

export default function Mismatch() {
  const { byBuilding, building } = useData();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const rows = byBuilding[building];

  const all = useMemo(() => rows.flatMap((r) => mismatches(r).map((m) => ({ ...m, code: r.code, id: r.id })))
    .sort((a, b) => a.code.localeCompare(b.code)), [rows]);
  const counts = useMemo(() => all.reduce((c, x) => ({ ...c, [x.type]: (c[x.type] || 0) + 1 }), {}), [all]);
  const itemCount = new Set(all.map((x) => x.id)).size;
  const ql = q.trim().toLowerCase();
  const list = all.filter((x) => (!type || x.type === type) && (!ql || [x.code, x.genedia, x.master].some((s) => String(s).toLowerCase().includes(ql))));

  const exportXlsx = async () => {
    const data = list.map((x) => ({ code: x.code, type: MISMATCH_TYPES[x.type], genedia: x.genedia, master: x.master }));
    download(await buildMismatchExcel(data, building), `แก้ใน_Genedia_${building}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const openItem = openId && rows.find((r) => r.id === openId);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Genedia ยังไม่ตรงกับ Master · {building}</h1>
        <span className="muted">{itemCount.toLocaleString('th-TH')} รายการที่ต้องแก้</span>
      </div>
      <p className="muted">หน้านี้ใช้ติดตามงานแก้ไขในระบบ Genedia — เมื่อ IT แก้แล้วและนำเข้าไฟล์ใหม่ รายการจะหายจากหน้านี้เอง</p>

      <div className="chips">
        <button className={`chip ${!type ? 'chip-on' : ''}`} onClick={() => setType('')}>ทั้งหมด <b>{all.length}</b></button>
        {Object.entries(MISMATCH_TYPES).filter(([k]) => counts[k]).map(([k, label]) => (
          <button key={k} className={`chip ${type === k ? 'chip-on' : ''}`} onClick={() => setType(k)}>{label} <b>{counts[k]}</b></button>
        ))}
      </div>
      <div className="filters">
        <input type="search" placeholder="ค้นหา" value={q} onChange={(e) => setQ(e.target.value)} />
        {list.length > 0 && <AsyncButton className="btn" onClick={exportXlsx}>Export Excel ส่ง IT ({list.length})</AsyncButton>}
      </div>

      {!list.length ? <Empty>{all.length ? 'ไม่พบตามตัวกรอง' : 'Genedia ตรงกับ Master ทั้งหมดแล้ว 🎉'}</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>รหัส</th><th>เรื่อง</th><th>Genedia (ปัจจุบัน)</th><th>Master (ต้องแก้เป็น)</th></tr></thead>
            <tbody>
              {list.slice(0, 1000).map((x) => (
                <tr key={`${x.id}-${x.type}`} className="clickable" onClick={() => setOpenId(x.id)}>
                  <td className="mono nowrap">{x.code}</td>
                  <td className="nowrap">{MISMATCH_TYPES[x.type]}</td>
                  <td>{x.genedia || <span className="muted">–</span>}</td>
                  <td>{x.master || <span className="muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > 1000 && <p className="muted">แสดง 1,000 แถวแรก — ใช้ตัวกรองหรือ Export Excel เพื่อดูทั้งหมด</p>}
        </div>
      )}
      {openItem && <ItemDrawer item={openItem} onClose={() => setOpenId(null)} />}
    </div>
  );
}
