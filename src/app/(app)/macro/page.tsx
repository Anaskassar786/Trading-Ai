import DataFetch from "@/components/DataFetch";
export const metadata = { title: "Macro — Trading AI AK" };
export default function Page() {
  return <div>
    <h1 className="text-2xl font-bold mb-1">Macro</h1>
    <p className="muted mb-4">Macroeconomic series from FRED (Treasury yields, Fed Funds, inflation expectations, USD index, VIX). FRED is not used as a gold price feed.</p>
    <DataFetch kind="macro" />
  </div>;
}
