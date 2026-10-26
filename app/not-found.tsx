import Link from "next/link";
import PageShell from "@/components/layout/PageShell";
import Panel from "@/components/ui/Panel";

export default function NotFound() {
  return (
    <PageShell title="Tap Not Found" description="The requested community tap does not exist.">
      <div className="py-8">
        <Panel className="text-center py-12 space-y-4 bg-white/90 border-[#CBD8F7]">
          <div className="text-4xl">💧</div>
          <h2 className="text-xl font-black text-[#0B1B4D]">
            Tap Not Found
          </h2>
          <p className="text-xs text-[#3E5285] max-w-xs mx-auto">
            The community tap or faucet you requested does not exist or has closed.
          </p>
          <div className="pt-4">
            <Link
              href="/"
              className="inline-flex items-center px-4 py-2 text-xs font-bold rounded-full bg-[#1946D6] text-white hover:bg-[#153BB5] transition-colors"
            >
              ← Back to community taps
            </Link>
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
