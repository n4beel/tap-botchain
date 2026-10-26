"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ConnectButton from "@/components/ui/ConnectButton";
import NetworkBadge from "@/components/botchain/NetworkBadge";
import BuiltOnBotChain from "@/components/botchain/BuiltOnBotChain";
import { footerLinks } from "@/lib/botchain/chain";
import { app } from "@/lib/app-config";
import { DOCK_ITEMS } from "@/lib/nav";

interface PageShellProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
}

export default function PageShell({ children, title, description }: PageShellProps) {
  const pathname = usePathname();
  const { site, explorer } = footerLinks();

  return (
    <div
      className="min-h-[100dvh] flex flex-col justify-between overflow-x-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      {/* Centred Phone-First App Column (max 480px) */}
      <div className="w-full max-w-[480px] mx-auto min-h-[100dvh] flex flex-col justify-between px-4 pb-28 pt-3 relative">
        {/* Slim Top Header */}
        <header className="flex items-center justify-between gap-2 py-2 mb-4">
          <Link
            href="/"
            className="flex items-center gap-2 group no-underline text-white font-extrabold text-[20px] tracking-tight"
          >
            <span className="text-[22px] group-hover:scale-110 transition-transform inline-block">
              💧
            </span>
            <span>{app.name}</span>
          </Link>

          <div className="flex items-center gap-2">
            <NetworkBadge />
            <div className="w-[140px]">
              <ConnectButton />
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col gap-4">
          {(title || description) && (
            <div className="px-1 mb-1">
              {title && (
                <h1 className="text-[26px] font-extrabold tracking-tight text-white leading-tight">
                  {title}
                </h1>
              )}
              {description && (
                <p className="mt-1 text-[13px] leading-relaxed text-[#C9D5F8]">
                  {description}
                </p>
              )}
            </div>
          )}

          {children}
        </main>

        {/* Ecosystem Footer */}
        <footer className="mt-8 pt-4 pb-2 border-t border-white/15 text-center flex flex-col items-center gap-2">
          <div className="flex items-center justify-center gap-2 text-[11px] uppercase tracking-wider text-[#C9D5F8]">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: "var(--accent)" }}
            />
            <BuiltOnBotChain />
          </div>

          <div className="flex items-center justify-center gap-3 text-[11px] text-[#C9D5F8]/80">
            <a
              href={site}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-white"
            >
              botchain.ai
            </a>
            <span>·</span>
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-white"
            >
              Explorer
            </a>
          </div>
        </footer>

        {/* Fixed Bottom Dock (Archetype N) */}
        <div
          className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pointer-events-none px-4"
          style={{
            paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          }}
        >
          <nav
            aria-label="Main Navigation Dock"
            className="dock-pill pointer-events-auto w-full max-w-[440px] bg-white rounded-full p-1.5 flex items-center justify-around border border-[#CBD8F7]/80 shadow-2xl"
          >
            {DOCK_ITEMS.map((item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "dock-link flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-full text-[13px] font-bold transition-all duration-150 no-underline select-none min-h-[44px]",
                    active
                      ? "bg-[#1946D6] text-white shadow-md"
                      : "text-[#0B1B4D] hover:bg-[#F4F7FE]",
                  ].join(" ")}
                >
                  {item.icon === "taps" && <span className="text-[14px]">💧</span>}
                  {item.icon === "new" && <span className="text-[14px]">➕</span>}
                  {item.icon === "mine" && <span className="text-[14px]">👤</span>}
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}
