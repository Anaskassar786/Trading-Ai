import NewAnalysisForm from "@/components/ClientForm";

export const metadata = { title: "New Analysis — Trading AI AK" };

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">New Analysis</h1>
      <p className="muted">Upload a chart screenshot, set instrument/timeframe/risk, then run the 10-agent council.</p>
      <NewAnalysisForm />
    </div>
  );
}
