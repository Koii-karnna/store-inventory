import { useState } from 'react';
import { serverTimestamp } from 'firebase/firestore';
import { useData } from '../state.jsx';
import { Modal, AsyncButton, Badge, toast } from '../ui.jsx';
import { commit } from '../lib/db.js';
import { createAuthUser, USERNAME_RE } from '../firebase.js';
import { fmtDateTime } from '../lib/model.js';

const ROLE = { admin: 'Admin', viewer: 'Viewer' };

export default function Users() {
  const { users, user } = useData();
  const [add, setAdd] = useState(null);
  const list = [...users].sort((a, b) => (a.username || '').localeCompare(b.username || '') || Number(b.active) - Number(a.active));
  const activeAdmins = users.filter((u) => u.role === 'admin' && u.active).length;

  const create = async () => {
    const username = (add.username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error('Username ใช้ a-z, 0-9, จุด, ขีด ความยาว 3–30 ตัว');
    if (users.some((u) => u.username === username && u.active)) throw new Error('Username นี้ใช้งานอยู่ — ถ้าผู้ใช้ลืมรหัสผ่าน ให้กด "ปิดบัญชี" ก่อน');
    if ((add.password || '').length < 6) throw new Error('Password ต้องยาวอย่างน้อย 6 ตัวอักษร');
    let uid;
    try {
      uid = await createAuthUser(username, add.password);
    } catch (e) {
      if (e?.code?.includes('email-already-in-use')) {
        throw new Error(`ยังต้องลบบัญชีเดิมใน Firebase Console ก่อน: Authentication → Users → ${username}@store-inventory.local → ⋮ → Delete account`);
      }
      throw e;
    }
    const data = { username, name: (add.name || '').trim() || username, role: add.role || 'viewer', active: true, createdAt: serverTimestamp(), createdBy: user.name };
    await commit(user, [{ type: 'set', path: ['users', uid], data }], [{ action: 'user', summary: `สร้างผู้ใช้ ${username} (${ROLE[data.role]})` }]);
    toast(`สร้างผู้ใช้ ${username} แล้ว — แจ้ง Username/Password ให้ผู้ใช้`);
    setAdd(null);
  };

  const update = async (u, patch, summary) => {
    if (u.id === user.uid && (patch.active === false || patch.role === 'viewer')) throw new Error('แก้สิทธิ์ของตัวเองไม่ได้ ให้ Admin คนอื่นทำ');
    if (u.role === 'admin' && (patch.active === false || patch.role === 'viewer') && activeAdmins <= 1) throw new Error('ต้องมี Admin อย่างน้อย 1 คน');
    await commit(user, [{ type: 'update', path: ['users', u.id], data: patch }], [{ action: 'user', summary }]);
    toast('บันทึกแล้ว');
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>ผู้ใช้</h1>
        <button className="btn btn-primary" onClick={() => setAdd({ role: 'viewer' })}>+ เพิ่มผู้ใช้</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Username</th><th>ชื่อ</th><th>สิทธิ์</th><th>สถานะ</th><th>สร้างเมื่อ</th><th /></tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td className="mono">{u.username}</td>
                <td>{u.name}</td>
                <td><Badge color={u.role === 'admin' ? 'blue' : 'gray'}>{ROLE[u.role]}</Badge></td>
                <td>{u.active ? <Badge color="green">ใช้งาน</Badge> : <Badge color="red">ปิด</Badge>}</td>
                <td className="small">{fmtDateTime(u.createdAt)}</td>
                <td className="row-actions nowrap">
                  <AsyncButton className="btn btn-sm" onClick={() => update(u, { role: u.role === 'admin' ? 'viewer' : 'admin' }, `เปลี่ยนสิทธิ์ ${u.username} เป็น ${u.role === 'admin' ? 'Viewer' : 'Admin'}`)}>
                    เปลี่ยนเป็น {u.role === 'admin' ? 'Viewer' : 'Admin'}
                  </AsyncButton>
                  <AsyncButton className="btn btn-sm btn-ghost" onClick={() => update(u, { active: !u.active }, `${u.active ? 'ปิด' : 'เปิด'}บัญชี ${u.username}`)}>
                    {u.active ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                  </AsyncButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card small">
        <b>ผู้ใช้ลืมรหัสผ่าน</b> (Firebase แผนฟรีไม่ให้ Admin ตั้งรหัสผ่านแทน)
        <ol>
          <li>หน้านี้: กด <b>ปิดบัญชี</b> ของผู้ใช้นั้น</li>
          <li>Firebase Console → <b>Authentication → Users</b> → ค้นหา <code>username@store-inventory.local</code> → ⋮ → <b>Delete account</b></li>
          <li>หน้านี้: กด <b>+ เพิ่มผู้ใช้</b> ด้วย Username เดิม และรหัสผ่านใหม่</li>
        </ol>
        ประวัติใน Log ของบัญชีเดิมยังอยู่ครบ · ผู้ใช้ที่จำรหัสได้ เปลี่ยนรหัสเองได้ที่ปุ่ม "เปลี่ยนรหัสผ่าน" ด้านบน · ควรมี Admin อย่างน้อย 2 คน
      </div>
      {add && (
        <Modal title="เพิ่มผู้ใช้" onClose={() => setAdd(null)}
          footer={<><button className="btn" onClick={() => setAdd(null)}>ยกเลิก</button><AsyncButton className="btn btn-primary" onClick={create}>สร้าง</AsyncButton></>}>
          <div className="form">
            <label>Username<input value={add.username || ''} onChange={(e) => setAdd({ ...add, username: e.target.value })} autoComplete="off" placeholder="เช่น somchai" /></label>
            <label>ชื่อที่แสดง<input value={add.name || ''} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></label>
            <label>Password (อย่างน้อย 6 ตัว)<input type="text" value={add.password || ''} onChange={(e) => setAdd({ ...add, password: e.target.value })} autoComplete="off" /></label>
            <label>สิทธิ์
              <select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>
                <option value="viewer">Viewer — ดูได้อย่างเดียว</option>
                <option value="admin">Admin — นำเข้า แก้ไข ทำใบขอซื้อ จัดการผู้ใช้</option>
              </select>
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}
