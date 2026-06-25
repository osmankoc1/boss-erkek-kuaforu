import { verifySession } from "@/lib/dal";
import AdminSidebar from "@/components/admin/AdminSidebar";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  await verifySession();
  return (
    <div className="flex min-h-screen bg-[#0a0a0a]">
      <AdminSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
