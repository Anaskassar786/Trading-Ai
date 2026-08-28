import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import EnvironmentBanner from "@/components/EnvironmentBanner";

export const metadata: Metadata = {
  title: "Trading AI AK — Position Trading Analysis Council",
  description: "Private multi-agent trading-analysis tool for Gold & Forex. No fake data.",
};

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/new-analysis", label: "New Analysis" },
  { href: "/history", label: "Trade History" },
  { href: "/performance", label: "AI Performance" },
  { href: "/market-data", label: "Market Data" },
  { href: "/news", label: "News" },
  { href: "/macro", label: "Macro" },
  { href: "/api-health", label: "API Health" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-bg-border bg-bg-panel sticky top-0 z-30">
            <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4 flex-wrap">
              <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
                <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-blue-600 grid place-items-center text-white text-sm font-black">AK</span>
                <span className="text-base">Trading AI <span className="text-emerald-400">AK</span></span>
              </Link>
              <nav className="flex gap-1 flex-wrap text-sm">
                {NAV_LINKS.map((l) => (
                  <Link key={l.href} href={l.href} className="px-2.5 py-1.5 rounded-md hover:bg-bg-soft text-slate-300 hover:text-white transition-colors">
                    {l.label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto flex items-center gap-2">
                <span className="chip chip-muted">NO LIVE TRADES</span>
                <span className="chip chip-muted">ANALYSIS ONLY</span>
              </div>
            </div>
          </header>
          <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">
            <div className="mb-4"><EnvironmentBanner /></div>
            {children}
          </main>
          <footer className="border-t border-bg-border text-xs text-slate-500 p-4 text-center">
            Trading AI AK is a private decision-support analysis tool. Not a broker. Does not place live trades. Never guarantees profit.
          </footer>
        </div>
      </body>
    </html>
  );
}
