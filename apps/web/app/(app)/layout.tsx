import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { ErrorBoundary } from "@/components/error-boundary";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-gray-50">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <AppTopbar />
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
    </ErrorBoundary>
  );
}