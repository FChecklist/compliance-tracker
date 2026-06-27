export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-xl font-bold text-blue-600">ComplianceTrack</span>
          <a
            href="/login"
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Sign In
          </a>
        </div>
      </nav>
      {children}
    </div>
  );
}