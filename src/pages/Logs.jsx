import { useEffect, useState } from 'react';
import { useData } from '../state.jsx';
import { AsyncButton, Empty, errorText } from '../ui.jsx';
import { recentLogs, describeChange, ACTIONS } from '../lib/db.js';
import { fmtDateTime } from '../lib/model.js';

export default function Logs() {
  const { users } = useData();
  const [rows, setRows] = useState(null);
  const [last, setLast] = useState(null);
  const [err, setErr] = useState('');
  const [action, setAction] = useState('');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    recentLogs().then((r) => { setRows(r.rows); setLast(r.last); }).catch((e) => setErr(errorText(e)));
  }, []);
  const more = async () => { const r = await recentLogs(last); setRows((x) => [...x, ...r.rows]); setLast(r.rows.length ? r.last : null); };

  if (err) return <div className="page"><p className="error">{err}</p></div>;
  if (!rows) return <div className="page"><Empty>กำลังโหลด…</Empty></div>;

  const ql = q.trim().toLowerCase();
  const list = rows.filter((r) => (!action || r.action === action) && (!who || r.uid === who)
    && (!ql || [r.code, r.summary, r.building].some((s) => s && String(s).toLowerCase().includes(ql))));

  return (
    <div className="page">
      <div className="page-head"><h1>Log การแก้ไข</h1></div>
      <div className="filters">
        <input type="search" placeholder="ค้นหา รหัส / รายละเอียด" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="ประเภท">
          <option value="">ทุกประเภท</option>
          {Object.entries(ACTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="ผู้ใช้">
          <option value="">ทุกคน</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.username}</option>)}
        </select>
      </div>
      {!list.length ? <Empty>ไม่พบ log</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>ประเภท</th><th>อาคาร</th><th>รหัส</th><th>รายละเอียด</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap small">{fmtDateTime(r.ts)}</td>
                  <td>{r.user}</td>
                  <td className="nowrap">{ACTIONS[r.action] || r.action}</td>
                  <td>{r.building || ''}</td>
                  <td className="mono nowrap">{r.code || ''}</td>
                  <td className="small">
                    {r.summary && <div>{r.summary}</div>}
                    {(r.changes || []).map((c, i) => <div key={i}>{describeChange(c)}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {last && <AsyncButton className="btn more" onClick={more}>โหลดเพิ่ม</AsyncButton>}
    </div>
  );
}
