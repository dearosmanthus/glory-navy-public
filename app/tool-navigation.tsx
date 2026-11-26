'use client';

import { CircleDollarSign, ClipboardList, Factory, FileText, FlaskConical, Radar, Route, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LanguageToggle, translate, useLanguage } from './language-provider';

export type ToolId = 'lp' | 'industry' | 'contract' | 'courier' | 'reprocessing' | 'dscan' | 'jump' | 'attendance';

const tools = [
  { id: 'lp', zh: 'LP 查询', en: 'LP Store', icon: CircleDollarSign },
  { id: 'industry', zh: '工业制造', en: 'Industry', icon: Factory },
  { id: 'contract', zh: '合同计价', en: 'Appraisal', icon: FileText },
  { id: 'courier', zh: '快递计算', en: 'Courier', icon: Truck },
  { id: 'reprocessing', zh: '独立化矿', en: 'Refining', icon: FlaskConical },
  { id: 'dscan', zh: '战场扫描', en: 'Battle Scan', icon: Radar },
  { id: 'jump', zh: '一跳可达', en: 'Jump Range', icon: Route },
  { id: 'attendance', zh: '出勤统计', en: 'Attendance', icon: ClipboardList },
] as const;

export default function ToolNavigation({ active, onSelect }: { active: ToolId; onSelect: (tool: ToolId) => void }) {
  useLanguage();
  return (
    <nav className="site-header-actions flex flex-wrap items-center gap-2" aria-label={translate('功能导航', 'Tool navigation')}>
      {tools.map((tool) => {
        const Icon = tool.icon;
        const selected = tool.id === active;
        return (
          <Button
            key={tool.id}
            size="sm"
            variant={selected ? 'default' : 'outline'}
            className={`tool-nav-button ${selected ? 'bg-cyan-400 text-slate-950 hover:bg-cyan-300' : ''}`}
            aria-current={selected ? 'page' : undefined}
            onClick={() => { if (!selected) onSelect(tool.id); }}
          >
            <Icon data-icon="inline-start" />{translate(tool.zh, tool.en)}
          </Button>
        );
      })}
      <LanguageToggle />
    </nav>
  );
}
