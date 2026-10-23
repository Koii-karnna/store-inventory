import { useState } from 'react';
import { doc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useData } from '../state.jsx';
import { Modal, AsyncButton, Empty, go, toast } from '../ui.jsx';
import { commit } from '../lib/db.js';

const FIELDS = [['name', 'ชื่อบริษัท / ร้าน *'], ['contact', 'ผู้ติดต่อ'], ['phone', 'โทรศัพท์'], ['email', 'อีเมล'], ['note', 'หมายเหตุ']];

export default function Vendors() {
  const { vendors, rows, isAdmin, user } = useData();
  const [edit, setEdit] = useState(null);
  const usage = (id) => rows.filter((r) => (r.vendors || []).some((v) => v.id === id)).length;

  const save = async () => {
    const data = Object.fromEntries(FIELDS.map(([k]) => [k, (edit[k] || '').trim()]));
    if (!data.name) throw new Error('กรุณาใส่ชื่อ Vendor');
    const isNew = !edit.id;
    const id = edit.id || doc(collection(db, 'vendors')).id;
    const old = vendors.find((v) => v.id === id) || {};
    const changes = FIELDS.filter(([k]) => (old[k] || '') !== data[k]).map(([k, label]) => ({ field: label, from: old[k] || null, to: data[k] || null }));
    if (!changes.length) return setEdit(null);
    await commit(user,
      [{ type: 'set', path: ['vendors', id], data: { ...data, updatedAt: serverTimestamp(), ...(isNew ? { createdAt: serverTimestamp() } : {}) }, merge: true }],
      [{ action: 'vendor', vendorId: id, summary: `${isNew ? 'เพิ่ม' : 'แก้ไข'} Vendor ${data.name}`, changes }]);
    toast('บันทึก Vendor แล้ว');
    setEdit(null);
  };

  const remove = async (v) => {
    if (usage(v.id)) return toast('ยังมีรายการที่ผูกกับ Vendor นี้ เอาออกจากรายการก่อน', 'err');
    if (!confirm(`ลบ Vendor ${v.name}?`)) return;
    await commit(user, [{ type: 'delete', path: ['vendors', v.id] }], [{ action: 'vendor', vendorId: v.id, summary: `ลบ Vendor ${v.name}` }]);
    toast('ลบแล้ว');
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Vendor</h1>
        {isAdmin && <button className="btn btn-primary" onClick={() => setEdit({})}>+ เพิ่ม Vendor</button>}
      </div>
      {!vendors.length ? <Empty>ยังไม่มี Vendor</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>ชื่อ</th><th>ผู้ติดต่อ</th><th>โทรศัพท์</th><th>อีเมล</th><th>หมายเหตุ</th><th className="num">รายการ</th><th /></tr></thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id}>
                  <td><b>{v.name}</b></td><td>{v.contact}</td><td className="nowrap">{v.phone}</td><td>{v.email}</td><td>{v.note}</td>
                  <td className="num"><a href="#/items" onClick={(e) => { e.preventDefault(); go('/items', { vendor: v.id, status: 'all' }); }}>{usage(v.id)}</a></td>
                  <td className="row-actions nowrap">{isAdmin && <>
                    <button className="btn btn-sm" onClick={() => setEdit(v)}>แก้ไข</button>
                    <AsyncButton className="btn btn-sm btn-ghost" onClick={() => remove(v)}>ลบ</AsyncButton>
                  </>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? 'แก้ไข Vendor' : 'เพิ่ม Vendor'} onClose={() => setEdit(null)}
          footer={<><button className="btn" onClick={() => setEdit(null)}>ยกเลิก</button><AsyncButton className="btn btn-primary" onClick={save}>บันทึก</AsyncButton></>}>
          <div className="form">
            {FIELDS.map(([k, label]) => (
              <label key={k}>{label}
                {k === 'note'
                  ? <textarea rows={2} value={edit[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                  : <input value={edit[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} type={k === 'email' ? 'email' : 'text'} />}
              </label>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
