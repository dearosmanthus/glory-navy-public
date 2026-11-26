'use client';

import { Activity, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetch-json';
import { formatLocalizedNumber, languageLocale, translate, useLanguage } from './language-provider';

type EsiStatus = {
  players: number;
  server_version: string;
  start_time: string;
  vip?: boolean;
};

type StatusPhase = 'loading' | 'online' | 'vip' | 'unavailable';

type StatusSnapshot = {
  phase: StatusPhase;
  players: number | null;
  serverVersion: string;
  updatedAt: Date | null;
};

const playerNumber = { format: (value: number) => formatLocalizedNumber(value, { maximumFractionDigits: 0 }) };

export default function ServerStatus() {
  useLanguage();
  const [snapshot, setSnapshot] = useState<StatusSnapshot>({
    phase: 'loading',
    players: null,
    serverVersion: '',
    updatedAt: null,
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let timer: number | undefined;

    async function refresh() {
      try {
        const status = await fetchJson<EsiStatus>(
          '/api/status',
          { signal: controller.signal },
        );
        if (!Number.isInteger(status.players) || status.players < 0) throw new Error('Invalid player count');
        if (!cancelled) {
          setSnapshot({
            phase: status.vip ? 'vip' : 'online',
            players: status.players,
            serverVersion: status.server_version,
            updatedAt: new Date(),
          });
        }
      } catch {
        if (!cancelled) {
          setSnapshot((current) => ({ ...current, phase: 'unavailable', players: null }));
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void refresh(), 60_000);
      }
    }

    void refresh();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const statusLabel =
    snapshot.phase === 'online'
      ? translate('服务器正常', 'Server online')
      : snapshot.phase === 'vip'
        ? translate('VIP 维护模式', 'VIP mode')
        : snapshot.phase === 'unavailable'
          ? translate('状态未知', 'Status unavailable')
          : translate('正在同步', 'Syncing');
  const title = [
    snapshot.serverVersion ? translate(`版本 ${snapshot.serverVersion}`, `Version ${snapshot.serverVersion}`) : '',
    snapshot.updatedAt ? translate(`更新于 ${snapshot.updatedAt.toLocaleTimeString(languageLocale())}`, `Updated ${snapshot.updatedAt.toLocaleTimeString(languageLocale())}`) : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="server-status" aria-live="polite" aria-label={`${statusLabel} · ${snapshot.players === null ? '—' : playerNumber.format(snapshot.players)} ${translate('在线飞行员', 'pilots online')}`} title={title || translate('正在读取 EVE 服务器状态', 'Loading EVE server status')}>
      <div className="server-status__item">
        <span className="server-status__dot" data-state={snapshot.phase} aria-hidden="true" />
        <div>
          <span className="server-status__label">TRANQUILITY</span>
          <strong>{statusLabel}</strong>
        </div>
      </div>
      <div className="server-status__divider" aria-hidden="true" />
      <div className="server-status__item">
        {snapshot.players === null ? <Activity aria-hidden="true" /> : <Users aria-hidden="true" />}
        <div>
          <span className="server-status__label">{translate('在线飞行员', 'PILOTS ONLINE')}</span>
          <strong className="font-mono tabular-nums">
            {snapshot.players === null ? '—' : playerNumber.format(snapshot.players)}
          </strong>
        </div>
      </div>
    </div>
  );
}
