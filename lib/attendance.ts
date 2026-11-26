import { normalizeScanName, type ScanMember } from './battle-scan';

export const ATTENDANCE_STORAGE_KEY = 'glory-navy.attendance.v1';
export const ATTENDANCE_MAX_MEMBERS = 250;

export type AttendanceMember = {
  characterId: number;
  name: string;
  attendanceCount: number;
  firstSeen: string;
  lastSeen: string;
};

export type AttendanceSession = {
  id: string;
  occurredAt: string;
  memberIds: number[];
};

export type AttendanceCorporation = {
  corporationId: number;
  corporation: string;
  sessions: number;
  lastSessionAt: string;
  attendanceSessions: AttendanceSession[];
  members: AttendanceMember[];
};

export type AttendanceStore = {
  v: 1;
  corporations: Record<string, AttendanceCorporation>;
};

export type AttendanceCorporationGroup = {
  corporationId: number;
  corporation: string;
  members: ScanMember[];
};

export const emptyAttendanceStore = (): AttendanceStore => ({
  v: 1,
  corporations: {},
});

export function mostRecentAttendanceCorporation(store: AttendanceStore): AttendanceCorporation | null {
  return Object.values(store.corporations).sort((a, b) =>
    b.lastSessionAt.localeCompare(a.lastSessionAt) || a.corporation.localeCompare(b.corporation))[0] ?? null;
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function validateAttendanceStore(raw: unknown): AttendanceStore | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.v !== 1 || !candidate.corporations || typeof candidate.corporations !== 'object') return null;
  const corporations: Record<string, AttendanceCorporation> = {};
  for (const [key, value] of Object.entries(candidate.corporations as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') return null;
    const corporation = value as Record<string, unknown>;
    if (
      !validId(corporation.corporationId)
      || key !== String(corporation.corporationId)
      || typeof corporation.corporation !== 'string'
      || !corporation.corporation.trim()
      || corporation.corporation.length > 200
      || !Number.isSafeInteger(corporation.sessions)
      || Number(corporation.sessions) < 1
      || !validDate(corporation.lastSessionAt)
      || !Array.isArray(corporation.members)
      || corporation.members.length > 10_000
    ) return null;
    const members: AttendanceMember[] = [];
    const ids = new Set<number>();
    for (const value of corporation.members) {
      if (!value || typeof value !== 'object') return null;
      const member = value as Record<string, unknown>;
      if (
        !validId(member.characterId)
        || ids.has(member.characterId)
        || typeof member.name !== 'string'
        || !member.name.trim()
        || member.name.length > 100
        || !Number.isSafeInteger(member.attendanceCount)
        || Number(member.attendanceCount) < 1
        || !validDate(member.firstSeen)
        || !validDate(member.lastSeen)
      ) return null;
      ids.add(member.characterId);
      members.push({
        characterId: member.characterId,
        name: member.name,
        attendanceCount: member.attendanceCount as number,
        firstSeen: member.firstSeen,
        lastSeen: member.lastSeen,
      });
    }
    const attendanceSessions: AttendanceSession[] = [];
    const sessionIds = new Set<string>();
    const savedSessions = corporation.attendanceSessions ?? [];
    if (!Array.isArray(savedSessions) || savedSessions.length > 10_000 || savedSessions.length > Number(corporation.sessions)) return null;
    for (const value of savedSessions) {
      if (!value || typeof value !== 'object') return null;
      const session = value as Record<string, unknown>;
      if (
        typeof session.id !== 'string'
        || !session.id
        || session.id.length > 80
        || sessionIds.has(session.id)
        || !validDate(session.occurredAt)
        || !Array.isArray(session.memberIds)
        || !session.memberIds.length
        || session.memberIds.length > ATTENDANCE_MAX_MEMBERS
        || !session.memberIds.every((id) => validId(id) && ids.has(id))
        || new Set(session.memberIds).size !== session.memberIds.length
      ) return null;
      sessionIds.add(session.id);
      attendanceSessions.push({
        id: session.id,
        occurredAt: session.occurredAt,
        memberIds: session.memberIds,
      });
    }
    corporations[key] = {
      corporationId: corporation.corporationId,
      corporation: corporation.corporation,
      sessions: corporation.sessions as number,
      lastSessionAt: corporation.lastSessionAt,
      attendanceSessions,
      members,
    };
  }
  return { v: 1, corporations };
}

export function groupAttendanceCorporations(members: ScanMember[]): AttendanceCorporationGroup[] {
  const groups = new Map<number, AttendanceCorporationGroup>();
  for (const member of members) {
    if (member.status !== 'resolved' || !member.id || !member.corporationId) continue;
    const current = groups.get(member.corporationId) ?? {
      corporationId: member.corporationId,
      corporation: member.corporation ?? `ID ${member.corporationId}`,
      members: [],
    };
    if (!current.members.some((item) => item.id === member.id)) current.members.push(member);
    groups.set(member.corporationId, current);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      members: group.members.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.members.length - a.members.length || a.corporation.localeCompare(b.corporation));
}

export function recordAttendance(
  store: AttendanceStore,
  group: AttendanceCorporationGroup,
  occurredAt: string,
): AttendanceStore {
  if (!validDate(occurredAt) || !validId(group.corporationId)) throw new Error('INVALID_ATTENDANCE');
  const previous = store.corporations[String(group.corporationId)];
  const sessionNumber = (previous?.sessions ?? 0) + 1;
  const attendanceIds = [...new Set(group.members
    .filter((member) => member.status === 'resolved' && member.id && member.corporationId === group.corporationId)
    .map((member) => member.id as number))];
  const members = new Map<number, AttendanceMember>(
    (previous?.members ?? []).map((member) => [member.characterId, { ...member }]),
  );
  for (const member of group.members) {
    if (member.status !== 'resolved' || !member.id || member.corporationId !== group.corporationId) continue;
    const current = members.get(member.id);
    members.set(member.id, current
      ? { ...current, name: member.name, attendanceCount: current.attendanceCount + 1, lastSeen: occurredAt }
      : { characterId: member.id, name: member.name, attendanceCount: 1, firstSeen: occurredAt, lastSeen: occurredAt });
  }
  if (!members.size) throw new Error('EMPTY_ATTENDANCE');
  const corporation: AttendanceCorporation = {
    corporationId: group.corporationId,
    corporation: group.corporation,
    sessions: sessionNumber,
    lastSessionAt: occurredAt,
    attendanceSessions: [{
      id: `${occurredAt}:${sessionNumber}`,
      occurredAt,
      memberIds: attendanceIds,
    }, ...(previous?.attendanceSessions ?? [])],
    members: [...members.values()].sort((a, b) =>
      b.attendanceCount - a.attendanceCount || normalizeScanName(a.name).localeCompare(normalizeScanName(b.name))),
  };
  return {
    v: 1,
    corporations: { ...store.corporations, [String(group.corporationId)]: corporation },
  };
}
