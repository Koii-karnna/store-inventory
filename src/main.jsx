import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// เว็บถูกอัปเดตระหว่างที่เปิดค้างไว้ → ไฟล์ส่วนย่อยรุ่นเก่าถูกลบ ให้โหลดหน้าใหม่ (ใบร่างเก็บในเครื่อง ไม่หาย)
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  const last = Number(sessionStorage.getItem('si.reloadAt') || 0);
  if (Date.now() - last > 10000) {
    sessionStorage.setItem('si.reloadAt', String(Date.now()));
    window.location.reload();
  }
});

createRoot(document.getElementById('root')).render(<App />);
