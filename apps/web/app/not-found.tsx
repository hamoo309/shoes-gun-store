import Link from 'next/link';
export default function NotFound(){return <div className="container error-page"><h1>404</h1><h2>الخطوة دي مش موجودة.</h2><p>الصفحة اتنقلت أو الرابط مش صحيح. نرجع للتشكيلة؟</p><Link className="button red" href="/products">اكتشف الأحذية ←</Link></div>;}
