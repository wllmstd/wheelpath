import type { Metadata } from 'next';
import AdminApp from '@/components/admin/AdminApp';

export const metadata: Metadata = { title: 'WheelPath admin', robots: { index: false } };
export default function AdminPage() { return <AdminApp />; }
