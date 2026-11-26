import type { Metadata } from 'next';
import './globals.css';
import './workflow.css';
import { LanguageProvider } from './language-provider';

export const metadata: Metadata = {
  title: 'Glory Navy | EVE Online Tools / 实用工具',
  description: 'Bilingual EVE Online LP store, appraisal, industry, reprocessing, battle scan, attendance and capital jump range tools. / EVE Online 双语 LP、合同、制造、化矿、战场扫描、出勤统计与旗舰跳跃工具。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="space-atmosphere" aria-hidden="true">
          <span className="space-atmosphere__aurora space-atmosphere__aurora--cyan" />
          <span className="space-atmosphere__aurora space-atmosphere__aurora--violet" />
          <span className="space-atmosphere__radar" />
          <span className="space-atmosphere__scan" />
        </div>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
