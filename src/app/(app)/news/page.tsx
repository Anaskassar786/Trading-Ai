import DataFetch from "@/components/DataFetch";
export const metadata = { title: "News — Trading AI AK" };
export default function Page() {
  return <div>
    <h1 className="text-2xl font-bold mb-1">News</h1>
    <p className="muted mb-4">Live query to News API. Only articles returned by the API are shown.</p>
    <DataFetch kind="news" />
  </div>;
}
