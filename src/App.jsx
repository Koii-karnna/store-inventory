import { useEffect, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, writeBatch, serverTimestamp } from 'firebase/firestore';
import { auth, db, configured, toEmail, USERNAME_RE } from './firebase.js';
import { DataProvider, useData } from './state.jsx';
import { useRoute, ToastHost, toast, Modal, AsyncButton, errorText } from './ui.jsx';
import { needsOrder } from './lib/model.js';
import Dashboard from './pages/Dashboard.jsx';
import Items from './pages/Items.jsx';
import PurchaseOrders from './pages/PurchaseOrders.jsx';
import Mismatch from './pages/Mismatch.jsx';
import Usage from './pages/Usage.jsx';
import Review from './pages/Review.jsx';
import ImportPage from './pages/Import.jsx';
import NewCode from './pages/NewCode.jsx';
import Vendors from './pages/Vendors.jsx';
import Logs from './pages/Logs.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  const [fbUser, setFbUser] = useState(undefined);
  const [profile, setProfile] = useState(undefined);

  useEffect(() => (configured ? onAuthStateChanged(auth, setFbUser) : undefined), []);
  useEffect(() => {
    if (!fbUser) { setProfile(fbUser === null ? null : undefined); return; }
    return onSnapshot(doc(db, 'users', fbUser.uid), (s) => setProfile(s.exists() ? s.data() : null), () => setProfile(null));
  }, [fbUser]);

  if (!configured) return <NotConfigured />;
  if (fbUser === undefined || (fbUser && profile === undefined)) return <div className="center-screen">กำลังโหลด…</div>;
  if (!fbUser) return <><LoginScreen /><ToastHost /></>;
  if (!profile || !profile.active) {
    return (
      <div className="center-screen">
        <div className="card login-card">
          <h2>ไม่สามารถใช้งานได้</h2>
          <p>{profile ? 'บัญชีนี้ถูกปิดการใช้งาน' : 'ไม่พบข้อมูลผู้ใช้'} กรุณาติดต่อ Admin</p>
          <button className="btn" onClick={() => signOut(auth)}>ออกจากระบบ</button>
        </div>
      </div>
    );
  }
  const user = { uid: fbUser.uid, name: profile.name || profile.username, username: profile.username, role: profile.role };
  return (
    <DataProvider user={user}>
      <Shell />
      <ToastHost />
    </DataProvider>
  );
}

function NotConfigured() {
  return (
    <div className="center-screen">
      <div className="card login-card">
        <h2>ยังไม่ได้เชื่อมต่อ Firebase</h2>
        <p>ใส่ค่าการเชื่อมต่อในไฟล์ <code>src/firebase-config.js</code> ตามขั้นตอนใน README.md</p>
      </div>
    </div>
  );
}

function LoginScreen() {
  const [hasAdmin, setHasAdmin] = useState(null);
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'config', 'bootstrap')).then((s) => setHasAdmin(s.exists())).catch((x) => {
      console.error(x);
      setHasAdmin(true);
      setErr(x?.code === 'permission-denied'
        ? 'ยังไม่ได้ตั้งกติกา Firestore (Rules) — วางไฟล์ firestore.rules ใน Firebase Console ตาม README ก่อน'
        : errorText(x));
    });
  }, []);

  const login = async (e) => {
    e.preventDefault(); setErr('');
    try { await signInWithEmailAndPassword(auth, toEmail(u), p); } catch (x) { setErr(errorText(x)); }
  };

  // ตั้ง Admin คนแรก (ทำได้ครั้งเดียว)
  const bootstrap = async (e) => {
    e.preventDefault(); setErr('');
    const username = u.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) return setErr('Username ใช้ a-z, 0-9, จุด, ขีด ความยาว 3–30 ตัว');
    try {
      const cred = await createUserWithEmailAndPassword(auth, toEmail(username), p);
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', cred.user.uid), { username, name: name.trim() || username, role: 'admin', active: true, createdAt: serverTimestamp() });
      batch.set(doc(db, 'config', 'bootstrap'), { at: serverTimestamp(), uid: cred.user.uid });
      await batch.commit();
      toast('สร้าง Admin เรียบร้อย');
    } catch (x) { setErr(errorText(x)); }
  };

  if (hasAdmin === null) return <div className="center-screen">กำลังโหลด…</div>;
  return (
    <div className="center-screen">
      <form className="card login-card" onSubmit={hasAdmin ? login : bootstrap}>
        <div className="brand-lg">คลังอะไหล่ <span>CMC · NP</span></div>
        {!hasAdmin && <p className="note">ระบบยังไม่มีผู้ใช้ — สร้างบัญชี <b>Admin คนแรก</b> (ทำได้ครั้งเดียว)</p>}
        <label>Username<input autoFocus value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" required /></label>
        {!hasAdmin && <label>ชื่อที่แสดง<input value={name} onChange={(e) => setName(e.target.value)} /></label>}
        <label>Password<input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete={hasAdmin ? 'current-password' : 'new-password'} required minLength={6} /></label>
        {err && <div className="error">{err}</div>}
        <button className="btn btn-primary" type="submit">{hasAdmin ? 'เข้าสู่ระบบ' : 'สร้าง Admin'}</button>
      </form>
    </div>
  );
}

const NAV = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/items', label: 'รายการอะไหล่' },
  { path: '/alerts', label: 'แจ้งเตือน', badge: 'alerts' },
  { path: '/po', label: 'ใบขอซื้อ', badge: 'draft' },
  { path: '/usage', label: 'การใช้อะไหล่' },
  { path: '/review', label: 'ทบทวน' },
  { path: '/mismatch', label: 'ไม่ตรง Master' },
  { path: '/vendors', label: 'Vendor' },
  { path: '/import', label: 'นำเข้าไฟล์', admin: true },
  { path: '/newcode', label: 'ออกรหัสใหม่', admin: true },
  { path: '/logs', label: 'Log' },
  { path: '/users', label: 'ผู้ใช้', admin: true },
  { path: '/settings', label: 'ตั้งค่า', admin: true },
];

export function Shell() {
  const { path, params } = useRoute();
  const { user, isAdmin, building, setBuilding, byBuilding, drafts, loading } = useData();
  const [pwOpen, setPwOpen] = useState(false);
  const alertCount = (b) => byBuilding[b].filter((r) => needsOrder(r.lv, r)).length;
  const badges = { alerts: alertCount(building), draft: drafts[building]?.length || 0 };

  let page;
  if (loading) page = <div className="empty">กำลังโหลดข้อมูล…</div>;
  else if (path === '/items') page = <Items key="items" params={params} />;
  else if (path === '/alerts') page = <Items key="alerts" params={{ level: 'need', ...params }} alerts />;
  else if (path === '/po') page = <PurchaseOrders params={params} />;
  else if (path === '/mismatch') page = <Mismatch />;
  else if (path === '/usage') page = <Usage />;
  else if (path === '/review') page = <Review params={params} />;
  else if (path === '/vendors') page = <Vendors />;
  else if (path === '/logs') page = <Logs />;
  else if (path === '/import' && isAdmin) page = <ImportPage />;
  else if (path === '/newcode' && isAdmin) page = <NewCode />;
  else if (path === '/users' && isAdmin) page = <Users />;
  else if (path === '/settings' && isAdmin) page = <Settings />;
  else page = <Dashboard />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">คลังอะไหล่</div>
        <div className="bld-tabs" role="tablist" aria-label="อาคาร">
          {['CMC', 'NP'].map((b) => (
            <button key={b} role="tab" aria-selected={building === b} className={building === b ? 'active' : ''} onClick={() => setBuilding(b)}>
              {b}{alertCount(b) > 0 && <span className="dot">{alertCount(b)}</span>}
            </button>
          ))}
        </div>
        <div className="user-menu">
          <span className="user-name">{user.name} · {isAdmin ? 'Admin' : 'Viewer'}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setPwOpen(true)}>เปลี่ยนรหัสผ่าน</button>
          <button className="btn btn-ghost btn-sm" onClick={() => signOut(auth)}>ออก</button>
        </div>
      </header>
      <nav className="nav">
        {NAV.filter((n) => !n.admin || isAdmin).map((n) => (
          <a key={n.path} href={`#${n.path}`} className={path === n.path || (path === '/' && n.path === '/dashboard') ? 'active' : ''}>
            {n.label}
            {n.badge && badges[n.badge] > 0 && <span className={`count ${n.badge === 'alerts' ? 'count-red' : ''}`}>{badges[n.badge]}</span>}
          </a>
        ))}
      </nav>
      <main className="main">{page}</main>
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
    </div>
  );
}

function ChangePassword({ onClose }) {
  const [cur, setCur] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const submit = async () => {
    if (p1.length < 6) throw new Error('Password ใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร');
    if (p1 !== p2) throw new Error('Password ใหม่ทั้งสองช่องไม่ตรงกัน');
    const u = auth.currentUser;
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, cur));
    await updatePassword(u, p1);
    toast('เปลี่ยนรหัสผ่านเรียบร้อย');
    onClose();
  };
  return (
    <Modal title="เปลี่ยนรหัสผ่าน" onClose={onClose} footer={<><button className="btn" onClick={onClose}>ยกเลิก</button><AsyncButton className="btn btn-primary" onClick={submit}>บันทึก</AsyncButton></>}>
      <div className="form">
        <label>Password ปัจจุบัน<input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></label>
        <label>Password ใหม่<input type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" /></label>
        <label>ยืนยัน Password ใหม่<input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></label>
      </div>
    </Modal>
  );
}
