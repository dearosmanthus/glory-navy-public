'use client';

import { Truck } from 'lucide-react';
import ServerStatus from './server-status';
import ToolNavigation, { type ToolId } from './tool-navigation';
import { translate, useLanguage } from './language-provider';
import { CourierQuote } from './courier-quote';

export default function CourierTool({ onSwitch }: { onSwitch: (tool: ToolId) => void }) {
  useLanguage();
  return (
    <main className="site-shell min-h-screen text-foreground">
      <div className="scanline" aria-hidden="true" />
      <header className="site-header border-b border-border/80 bg-card/80 backdrop-blur-xl">
        <div className="site-header-grid mx-auto max-w-[1500px] px-4 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="brand-mark grid size-10 place-items-center border border-cyan-400/40 bg-cyan-400/10 text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,.12)]">
              <Truck className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="glory-wordmark font-mono text-xs uppercase tracking-[0.24em] text-cyan-300">Glory Navy</p>
              <h1 className="text-lg font-semibold tracking-tight">{translate('快递计算终端', 'Courier Calculator')}</h1>
            </div>
          </div>
          <ServerStatus />
          <ToolNavigation active="courier" onSelect={onSwitch} />
        </div>
      </header>

      <div className="site-content mx-auto max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8">
        <CourierQuote standalone />
      </div>
    </main>
  );
}
