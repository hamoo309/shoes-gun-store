import type { Metadata } from 'next';
import './admin.css';

export const metadata: Metadata = {
  title: 'إدارة SHOES GUN',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-root" dir="rtl">{children}</div>;
}
