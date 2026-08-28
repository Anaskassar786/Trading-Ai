import DataFetch from "@/components/DataFetch";
export const metadata = { title: "Market Data — Trading AI AK" };
export default function Page() {
  return <div>
    <h1 className="text-2xl font-bold mb-1">Market Data</h1>
    <p className="muted mb-4">Live query to Twelve Data. If a symbol/timeframe is unsupported you will see DATA_UNAVAILABLE — never fake prices.</p>
    <DataFetch kind="market" />
  </div>;
}
