import { sendPush, type APNsConfig } from "./apns";

interface Env {
  OUTSPIRE_KV: KVNamespace;
  OUTSPIRE_DB: D1Database;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_PRIVATE_KEY: string;
  APNS_BUNDLE_ID: string;
  APNS_AUTH_SECRET: string;
  GITHUB_CALENDAR_URL: string;
  HOLIDAY_CN_URL: string;
}

interface RegisterBody {
  deviceId: string;
  pushStartToken: string;
  sandbox?: boolean;
  track: "ibdp" | "alevel";
  entryYear: string;
  schedule: Record<string, ClassPeriod[]>;
}

interface ActivityTokenBody {
  deviceId: string;
  activityId: string;
  dayKey: string;
  pushUpdateToken: string;
  owner: "app" | "worker";
}

interface ActivityEndedBody {
  deviceId: string;
  activityId: string;
  dayKey: string;
}

interface ClassPeriod {
  periodNumber: number;
  start: string;
  end: string;
  name: string;
  room: string;
  isSelfStudy: boolean;
}

interface ActivityRecord {
  activityId: string;
  dayKey: string;
  pushUpdateToken: string;
  owner: "app" | "worker";
  lastSequence: number;
  updatedAt: number;
}

interface StoredRegistration {
  pushStartToken: string;
  sandbox: boolean;
  track: "ibdp" | "alevel";
  entryYear: string;
  schedule: Record<string, ClassPeriod[]>;
  paused: boolean;
  resumeDate?: string;
  currentActivity?: ActivityRecord;
}

interface HolidayCNDay {
  name: string;
  date: string;
  isOffDay: boolean;
}

interface HolidayCNData {
  year: number;
  days: HolidayCNDay[];
}

interface SchoolCalendar {
  semesters: { start: string; end: string }[];
  specialDays: SpecialDay[];
}

interface SpecialDay {
  date: string;
  type: string;
  name: string;
  cancelsClasses: boolean;
  track: string;
  grades: string[];
  followsWeekday?: number;
}

type JobKind = "start" | "update" | "end";

interface PushJob {
  deviceId: string;
  token: string;
  sandbox: boolean;
  pushType: "liveactivity";
  topic: string;
  payload: Record<string, unknown>;
  kind: JobKind;
  dayKey: string;
}

interface DayDecision {
  shouldSendPushes: boolean;
  eventName?: string;
  cancelsClasses: boolean;
  useWeekday: number;
}

type ActivityPhase =
  | "upcoming"
  | "ongoing"
  | "ending"
  | "break"
  | "event"
  | "done";

interface SnapshotState {
  dayKey: string;
  phase: ActivityPhase;
  title: string;
  subtitle: string;
  rangeStart: number;
  rangeEnd: number;
  nextTitle?: string;
  sequence: number;
}

interface RegistrationRow {
  device_id: string;
  push_start_token: string;
  sandbox: number;
  track: "ibdp" | "alevel";
  entry_year: string;
  schedule_json: string;
  paused: number;
  resume_date: string | null;
  current_activity_json: string | null;
}

interface DispatchJobRow {
  day_key: string;
  time: string;
  device_id: string;
  kind: JobKind;
  token: string;
  sandbox: number;
  push_type: "liveactivity";
  topic: string;
  payload_json: string;
}

const APPLE_REFERENCE_DATE = 978307200;
const REG_TTL = 30 * 24 * 60 * 60;
const REGISTRATION_RETENTION_SECONDS = REG_TTL;

let storageReadyPromise: Promise<void> | null = null;

function nowCSTDate(): Date {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

function todayCST(): string {
  return nowCSTDate().toISOString().slice(0, 10);
}

function currentTimeCST(): { hours: number; minutes: number } {
  const cst = nowCSTDate();
  return { hours: cst.getUTCHours(), minutes: cst.getUTCMinutes() };
}

function weekdayCST(): number {
  const day = nowCSTDate().getUTCDay();
  return day === 0 ? 7 : day;
}

function parseTime(timeStr: string): { h: number; m: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { h, m };
}

function formatTime(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function minutesFor(timeStr: string): number {
  const { h, m } = parseTime(timeStr);
  return h * 60 + m;
}

function timeToAppleDate(dayKey: string, timeStr: string): number {
  const { h, m } = parseTime(timeStr);
  const utcMs = Date.parse(`${dayKey}T${formatTime(h, m)}:00+08:00`);
  return Math.floor(utcMs / 1000) - APPLE_REFERENCE_DATE;
}

function unixFor(dayKey: string, timeStr: string): number {
  return Math.floor(Date.parse(`${dayKey}T${timeStr}:00+08:00`) / 1000);
}

function subtractMinutes(timeStr: string, minutes: number): string {
  const total = minutesFor(timeStr) - minutes;
  const clamped = Math.max(total, 0);
  return formatTime(Math.floor(clamped / 60), clamped % 60);
}

function isAuthorized(request: Request, env: Env): boolean {
  return request.headers.get("x-auth-secret") === env.APNS_AUTH_SECRET;
}

function apnsConfig(env: Env): APNsConfig {
  return {
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    privateKey: env.APNS_PRIVATE_KEY,
    bundleId: env.APNS_BUNDLE_ID,
  };
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function decodeJSON<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  return JSON.parse(raw) as T;
}

function encodeBool(value: boolean): number {
  return value ? 1 : 0;
}

function decodeBool(value: number | string | null | undefined): boolean {
  return Number(value ?? 0) === 1;
}

function registrationFromRow(row: RegistrationRow): StoredRegistration {
  return {
    pushStartToken: row.push_start_token,
    sandbox: decodeBool(row.sandbox),
    track: row.track,
    entryYear: row.entry_year,
    schedule: decodeJSON<Record<string, ClassPeriod[]>>(row.schedule_json) ?? {},
    paused: decodeBool(row.paused),
    resumeDate: row.resume_date ?? undefined,
    currentActivity: decodeJSON<ActivityRecord>(row.current_activity_json),
  };
}

function dispatchJobFromRow(row: DispatchJobRow): PushJob {
  return {
    deviceId: row.device_id,
    token: row.token,
    sandbox: decodeBool(row.sandbox),
    pushType: row.push_type,
    topic: row.topic,
    payload: decodeJSON<Record<string, unknown>>(row.payload_json) ?? {},
    kind: row.kind,
    dayKey: row.day_key,
  };
}


async function ensureStorageReady(env: Env): Promise<void> {
  if (!storageReadyPromise) {
    storageReadyPromise = initializeStorage(env).catch((error) => {
      storageReadyPromise = null;
      throw error;
    });
  }
  await storageReadyPromise;
}

async function initializeStorage(env: Env): Promise<void> {
  await env.OUTSPIRE_DB.batch([
    env.OUTSPIRE_DB.prepare(`
      CREATE TABLE IF NOT EXISTS registrations (
        device_id TEXT PRIMARY KEY,
        push_start_token TEXT NOT NULL,
        sandbox INTEGER NOT NULL DEFAULT 0,
        track TEXT NOT NULL,
        entry_year TEXT NOT NULL,
        schedule_json TEXT NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0,
        resume_date TEXT,
        current_activity_json TEXT,
        updated_at INTEGER NOT NULL
      )
    `),
    env.OUTSPIRE_DB.prepare(`
      CREATE TABLE IF NOT EXISTS dispatch_jobs (
        day_key TEXT NOT NULL,
        time TEXT NOT NULL,
        device_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        token TEXT NOT NULL,
        sandbox INTEGER NOT NULL DEFAULT 0,
        push_type TEXT NOT NULL,
        topic TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (day_key, time, device_id, kind)
      )
    `),
    env.OUTSPIRE_DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_slot
      ON dispatch_jobs(day_key, time)
    `),
    env.OUTSPIRE_DB.prepare(`
      CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_device_day
      ON dispatch_jobs(day_key, device_id)
    `),
  ]);
}

async function getRegistration(
  env: Env,
  deviceId: string
): Promise<StoredRegistration | null> {
  const row = await env.OUTSPIRE_DB.prepare(`
    SELECT
      device_id,
      push_start_token,
      sandbox,
      track,
      entry_year,
      schedule_json,
      paused,
      resume_date,
      current_activity_json
    FROM registrations
    WHERE device_id = ?
  `)
    .bind(deviceId)
    .first<RegistrationRow>();
  return row ? registrationFromRow(row) : null;
}

async function listRegistrations(
  env: Env
): Promise<Array<{ deviceId: string; reg: StoredRegistration }>> {
  const result = await env.OUTSPIRE_DB.prepare(`
    SELECT
      device_id,
      push_start_token,
      sandbox,
      track,
      entry_year,
      schedule_json,
      paused,
      resume_date,
      current_activity_json
    FROM registrations
  `).all<RegistrationRow>();

  return (result.results ?? []).map((row) => ({
    deviceId: row.device_id,
    reg: registrationFromRow(row),
  }));
}

async function putRegistration(
  env: Env,
  deviceId: string,
  reg: StoredRegistration
): Promise<void> {
  await env.OUTSPIRE_DB.prepare(`
    INSERT INTO registrations (
      device_id,
      push_start_token,
      sandbox,
      track,
      entry_year,
      schedule_json,
      paused,
      resume_date,
      current_activity_json,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      push_start_token = excluded.push_start_token,
      sandbox = excluded.sandbox,
      track = excluded.track,
      entry_year = excluded.entry_year,
      schedule_json = excluded.schedule_json,
      paused = excluded.paused,
      resume_date = excluded.resume_date,
      current_activity_json = excluded.current_activity_json,
      updated_at = excluded.updated_at
  `)
    .bind(
      deviceId,
      reg.pushStartToken,
      encodeBool(reg.sandbox),
      reg.track,
      reg.entryYear,
      JSON.stringify(reg.schedule),
      encodeBool(reg.paused),
      reg.resumeDate ?? null,
      reg.currentActivity ? JSON.stringify(reg.currentActivity) : null,
      nowUnix()
    )
    .run();
}

async function deleteRegistration(env: Env, deviceId: string): Promise<void> {
  await env.OUTSPIRE_DB.prepare("DELETE FROM registrations WHERE device_id = ?")
    .bind(deviceId)
    .run();
}

async function fetchDispatchJobsForSlot(
  env: Env,
  dayKey: string,
  time: string
): Promise<PushJob[]> {
  const result = await env.OUTSPIRE_DB.prepare(`
    SELECT
      day_key,
      time,
      device_id,
      kind,
      token,
      sandbox,
      push_type,
      topic,
      payload_json
    FROM dispatch_jobs
    WHERE day_key = ? AND time = ?
    ORDER BY device_id, kind
  `)
    .bind(dayKey, time)
    .all<DispatchJobRow>();

  return (result.results ?? []).map(dispatchJobFromRow);
}

async function writeJobsForToday(
  env: Env,
  jobs: Array<{ time: string; job: PushJob }>
): Promise<void> {
  if (jobs.length === 0) return;

  const statements = jobs.map(({ time, job }) =>
    env.OUTSPIRE_DB.prepare(`
      INSERT INTO dispatch_jobs (
        day_key,
        time,
        device_id,
        kind,
        token,
        sandbox,
        push_type,
        topic,
        payload_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day_key, time, device_id, kind) DO UPDATE SET
        token = excluded.token,
        sandbox = excluded.sandbox,
        push_type = excluded.push_type,
        topic = excluded.topic,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).bind(
      job.dayKey,
      time,
      job.deviceId,
      job.kind,
      job.token,
      encodeBool(job.sandbox),
      job.pushType,
      job.topic,
      JSON.stringify(job.payload),
      nowUnix()
    )
  );

  for (let i = 0; i < statements.length; i += 50) {
    await env.OUTSPIRE_DB.batch(statements.slice(i, i + 50));
  }
}

type RemovalMode = "all" | "startOnly" | "nonStart";

async function removePendingJobsForDevice(
  env: Env,
  deviceId: string,
  dayKey: string = todayCST(),
  mode: RemovalMode = "all"
): Promise<void> {
  const sqlBase = "DELETE FROM dispatch_jobs WHERE day_key = ? AND device_id = ?";
  switch (mode) {
    case "startOnly":
      await env.OUTSPIRE_DB.prepare(`${sqlBase} AND kind = 'start'`)
        .bind(dayKey, deviceId)
        .run();
      return;
    case "nonStart":
      await env.OUTSPIRE_DB.prepare(`${sqlBase} AND kind != 'start'`)
        .bind(dayKey, deviceId)
        .run();
      return;
    default:
      await env.OUTSPIRE_DB.prepare(sqlBase).bind(dayKey, deviceId).run();
  }
}

async function replaceDispatchJobsForSlot(
  env: Env,
  dayKey: string,
  time: string,
  jobs: PushJob[]
): Promise<void> {
  await env.OUTSPIRE_DB.prepare(
    "DELETE FROM dispatch_jobs WHERE day_key = ? AND time = ?"
  )
    .bind(dayKey, time)
    .run();

  if (jobs.length > 0) {
    await writeJobsForToday(
      env,
      jobs.map((job) => ({ time, job }))
    );
  }
}

async function deleteDispatchJobsForDay(env: Env, dayKey: string): Promise<void> {
  await env.OUTSPIRE_DB.prepare("DELETE FROM dispatch_jobs WHERE day_key = ?")
    .bind(dayKey)
    .run();
}

async function cleanupStaleData(env: Env): Promise<void> {
  const today = todayCST();
  const staleRegistrationThreshold = nowUnix() - REGISTRATION_RETENTION_SECONDS;

  await env.OUTSPIRE_DB.batch([
    env.OUTSPIRE_DB.prepare("DELETE FROM dispatch_jobs WHERE day_key < ?").bind(today),
    env.OUTSPIRE_DB.prepare(`
      DELETE FROM registrations
      WHERE updated_at < ?
        AND (
          current_activity_json IS NULL
          OR json_extract(current_activity_json, '$.dayKey') IS NULL
          OR json_extract(current_activity_json, '$.dayKey') < ?
        )
    `).bind(staleRegistrationThreshold, today),
  ]);
}

async function fetchHolidayCN(
  env: Env,
  year: string
): Promise<HolidayCNDay[]> {
  const cacheKey = `cache:holiday-cn:${year}`;
  const cached = await env.OUTSPIRE_KV.get(cacheKey, "json");
  if (cached) return cached as HolidayCNDay[];

  const resp = await fetch(`${env.HOLIDAY_CN_URL}/${year}.json`);
  if (!resp.ok) return [];
  const data: HolidayCNData = await resp.json();

  await env.OUTSPIRE_KV.put(cacheKey, JSON.stringify(data.days), {
    expirationTtl: 3600,
  });
  return data.days;
}

async function fetchSchoolCalendarByAcademicYear(
  env: Env,
  academicYear: string
): Promise<SchoolCalendar | null> {
  const cacheKey = `cache:school-cal:${academicYear}`;
  const cached = await env.OUTSPIRE_KV.get(cacheKey, "json");
  if (cached) return cached as SchoolCalendar;

  const resp = await fetch(`${env.GITHUB_CALENDAR_URL}/${academicYear}.json`);
  if (!resp.ok) return null;
  const data: SchoolCalendar = await resp.json();

  await env.OUTSPIRE_KV.put(cacheKey, JSON.stringify(data), {
    expirationTtl: 300,
  });
  return data;
}

async function fetchSchoolCalendar(
  env: Env,
  year: string
): Promise<SchoolCalendar | null> {
  const y = parseInt(year, 10);
  const [a, b] = await Promise.all([
    fetchSchoolCalendarByAcademicYear(env, `${y - 1}-${y}`),
    fetchSchoolCalendarByAcademicYear(env, `${y}-${y + 1}`),
  ]);
  if (!a && !b) return null;
  return {
    semesters: [...(a?.semesters ?? []), ...(b?.semesters ?? [])],
    specialDays: [...(a?.specialDays ?? []), ...(b?.specialDays ?? [])],
  };
}

function specialDayApplies(
  sd: SpecialDay,
  track: string,
  entryYear: string
): boolean {
  const trackMatch = sd.track === "all" || sd.track === track;
  const gradeMatch = sd.grades.includes("all") || sd.grades.includes(entryYear);
  return trackMatch && gradeMatch;
}

async function decideTodayForUser(
  env: Env,
  reg: StoredRegistration
): Promise<DayDecision> {
  const today = todayCST();
  const year = today.slice(0, 4);
  const wd = weekdayCST();

  if (reg.paused) {
    if (!reg.resumeDate || today < reg.resumeDate) {
      return { shouldSendPushes: false, cancelsClasses: false, useWeekday: wd };
    }
  }

  const cal = await fetchSchoolCalendar(env, year);
  if (cal) {
    const inSemester = cal.semesters.some(
      (s) => today >= s.start && today <= s.end
    );
    if (!inSemester) {
      return { shouldSendPushes: false, cancelsClasses: false, useWeekday: wd };
    }

    const special = cal.specialDays.find(
      (sd) =>
        sd.date === today && specialDayApplies(sd, reg.track, reg.entryYear)
    );
    if (special) {
      if (special.cancelsClasses) {
        return {
          shouldSendPushes: true,
          eventName: special.name,
          cancelsClasses: true,
          useWeekday: wd,
        };
      }
      if (special.type === "makeup" && special.followsWeekday) {
        return {
          shouldSendPushes: true,
          eventName: special.name,
          cancelsClasses: false,
          useWeekday: special.followsWeekday,
        };
      }
    }
  }

  const holidays = await fetchHolidayCN(env, year);
  const holiday = holidays.find((d) => d.date === today);
  if (holiday) {
    if (holiday.isOffDay) {
      return { shouldSendPushes: false, cancelsClasses: false, useWeekday: wd };
    }
    const calMakeup = cal?.specialDays.find(
      (sd) => sd.date === today && sd.type === "makeup"
    );
    return {
      shouldSendPushes: true,
      cancelsClasses: false,
      useWeekday: calMakeup?.followsWeekday ?? 1,
    };
  }

  if (wd >= 6) {
    return { shouldSendPushes: false, cancelsClasses: false, useWeekday: wd };
  }

  return { shouldSendPushes: true, cancelsClasses: false, useWeekday: wd };
}

function breakTitle(current: ClassPeriod, next: ClassPeriod): string {
  return current.periodNumber === 4 && next.periodNumber === 5
    ? "Lunch Break"
    : "Break";
}

function buildStateTransitions(
  dayKey: string,
  periods: ClassPeriod[],
  decision: DayDecision
): Array<{ time: string; state: SnapshotState; kind: JobKind }> {
  if (decision.cancelsClasses) {
    const state: SnapshotState = {
      dayKey,
      phase: "event",
      title: decision.eventName ?? "No Classes",
      subtitle: "Classes are cancelled today",
      rangeStart: timeToAppleDate(dayKey, "07:45"),
      rangeEnd: timeToAppleDate(dayKey, "08:45"),
      sequence: 1,
    };

    return [
      { time: "07:45", state, kind: "start" },
      {
        time: "08:45",
        state: {
          ...state,
          phase: "done",
          title: "Schedule Complete",
          subtitle: "",
          sequence: 2,
        },
        kind: "end",
      },
    ];
  }

  if (periods.length === 0) return [];

  const transitions: Array<{
    time: string;
    state: SnapshotState;
    kind: JobKind;
  }> = [];
  const first = periods[0];
  const upcomingStart = subtractMinutes(first.start, 30);

  transitions.push({
    time: upcomingStart,
    kind: "start",
    state: {
      dayKey,
      phase: "upcoming",
      title: first.name,
      subtitle: first.isSelfStudy ? first.room || "Class-Free Period" : first.room,
      rangeStart: timeToAppleDate(dayKey, upcomingStart),
      rangeEnd: timeToAppleDate(dayKey, first.start),
      nextTitle: periods[1]?.name,
      sequence: 0,
    },
  });

  periods.forEach((period, index) => {
    transitions.push({
      time: period.start,
      kind: "update",
      state: {
        dayKey,
        phase: "ongoing",
        title: period.name,
        subtitle: period.isSelfStudy
          ? period.room || "Class-Free Period"
          : period.room,
        rangeStart: timeToAppleDate(dayKey, period.start),
        rangeEnd: timeToAppleDate(dayKey, period.end),
        nextTitle: periods[index + 1]?.name,
        sequence: index * 3 + 1,
      },
    });

    transitions.push({
      time: subtractMinutes(period.end, 5),
      kind: "update",
      state: {
        dayKey,
        phase: "ending",
        title: period.name,
        subtitle: period.isSelfStudy
          ? period.room || "Class-Free Period"
          : period.room,
        rangeStart: timeToAppleDate(dayKey, period.start),
        rangeEnd: timeToAppleDate(dayKey, period.end),
        nextTitle: periods[index + 1]?.name,
        sequence: index * 3 + 2,
      },
    });

    if (periods[index + 1]) {
      const next = periods[index + 1];
      transitions.push({
        time: period.end,
        kind: "update",
        state: {
          dayKey,
          phase: "break",
          title: breakTitle(period, next),
          subtitle: `Next: ${next.name}`,
          rangeStart: timeToAppleDate(dayKey, period.end),
          rangeEnd: timeToAppleDate(dayKey, next.start),
          nextTitle: next.name,
          sequence: index * 3 + 3,
        },
      });
    }
  });

  const last = periods[periods.length - 1];
  transitions.push({
    time: last.end,
    kind: "end",
    state: {
      dayKey,
      phase: "done",
      title: "Schedule Complete",
      subtitle: "",
      rangeStart: timeToAppleDate(dayKey, last.end),
      rangeEnd: timeToAppleDate(dayKey, last.end) + 900,
      sequence: periods.length * 3 + 1,
    },
  });

  return transitions;
}

function finalDismissalUnix(
  dayKey: string,
  periods: ClassPeriod[],
  decision: DayDecision
): number {
  if (decision.cancelsClasses) {
    return unixFor(dayKey, "08:45");
  }
  if (periods.length === 0) {
    return unixFor(dayKey, "23:59");
  }
  const last = periods[periods.length - 1];
  return unixFor(dayKey, last.end) + 900;
}

function buildStartJob(
  deviceId: string,
  reg: StoredRegistration,
  state: SnapshotState,
  bundleId: string,
  staleDateUnix: number
): PushJob {
  const topic = `${bundleId}.push-type.liveactivity`;

  return {
    deviceId,
    token: reg.pushStartToken,
    sandbox: reg.sandbox,
    pushType: "liveactivity",
    topic,
    kind: "start",
    dayKey: state.dayKey,
    payload: {
      aps: {
        timestamp: 0,
        event: "start",
        "content-state": state,
        "stale-date": staleDateUnix,
        alert: {
          title: state.title,
          body: state.subtitle || "Today's schedule is now live",
        },
        "attributes-type": "ClassActivityAttributes",
        attributes: {
          startDate: state.rangeStart,
        },
      },
    },
  };
}

function buildUpdateJob(
  deviceId: string,
  reg: StoredRegistration,
  token: string,
  state: SnapshotState,
  bundleId: string,
  staleDateUnix: number
): PushJob {
  return {
    deviceId,
    token,
    sandbox: reg.sandbox,
    pushType: "liveactivity",
    topic: `${bundleId}.push-type.liveactivity`,
    kind: "update",
    dayKey: state.dayKey,
    payload: {
      aps: {
        timestamp: 0,
        event: "update",
        "content-state": state,
        "stale-date": staleDateUnix,
      },
    },
  };
}

function buildEndJob(
  deviceId: string,
  reg: StoredRegistration,
  token: string,
  state: SnapshotState,
  bundleId: string
): PushJob {
  const dismissalDate = state.rangeEnd + APPLE_REFERENCE_DATE;

  return {
    deviceId,
    token,
    sandbox: reg.sandbox,
    pushType: "liveactivity",
    topic: `${bundleId}.push-type.liveactivity`,
    kind: "end",
    dayKey: state.dayKey,
    payload: {
      aps: {
        timestamp: 0,
        event: "end",
        "content-state": state,
        "dismissal-date": dismissalDate,
      },
    },
  };
}

function stampTimestamp(payload: Record<string, unknown>): Record<string, unknown> {
  const aps = payload.aps as Record<string, unknown> | undefined;
  if (!aps) return payload;
  return {
    ...payload,
    aps: {
      ...aps,
      timestamp: nowUnix(),
    },
  };
}

async function scheduleStartJobsForRegistration(
  env: Env,
  deviceId: string,
  reg: StoredRegistration
): Promise<{ pushed: boolean; reason?: string }> {
  const today = todayCST();
  if (reg.currentActivity?.dayKey === today) {
    return { pushed: false, reason: "activity_already_exists" };
  }

  const decision = await decideTodayForUser(env, reg);
  if (!decision.shouldSendPushes) {
    return { pushed: false, reason: "no_classes_today" };
  }

  const periods = reg.schedule[String(decision.useWeekday)] ?? [];
  const transitions = buildStateTransitions(today, periods, decision);
  const startTransition = transitions.find((item) => item.kind === "start");
  if (!startTransition) {
    return { pushed: false, reason: "no_remaining_classes" };
  }
  const staleDateUnix = finalDismissalUnix(today, periods, decision);

  const { hours, minutes } = currentTimeCST();
  const nowMinutes = hours * 60 + minutes;
  const startMinutes = minutesFor(startTransition.time);
  const startJob = buildStartJob(
    deviceId,
    reg,
    startTransition.state,
    env.APNS_BUNDLE_ID,
    staleDateUnix
  );

  if (startMinutes > nowMinutes) {
    await writeJobsForToday(env, [{ time: startTransition.time, job: startJob }]);
    return { pushed: false, reason: "scheduled" };
  }

  const pushResult = await sendPush(
    { ...apnsConfig(env), useSandbox: reg.sandbox },
    {
      token: startJob.token,
      pushType: startJob.pushType,
      topic: startJob.topic,
      payload: stampTimestamp(startJob.payload),
    }
  );

  return {
    pushed: pushResult.ok,
    reason: pushResult.ok ? undefined : "start_push_failed",
  };
}

async function scheduleUpdateJobsForActivity(
  env: Env,
  deviceId: string,
  reg: StoredRegistration
): Promise<void> {
  const activity = reg.currentActivity;
  if (!activity || activity.dayKey !== todayCST()) return;

  const decision = await decideTodayForUser(env, reg);
  if (!decision.shouldSendPushes) return;

  const periods = reg.schedule[String(decision.useWeekday)] ?? [];
  const transitions = buildStateTransitions(todayCST(), periods, decision);
  const staleDateUnix = finalDismissalUnix(todayCST(), periods, decision);
  const { hours, minutes } = currentTimeCST();
  const nowMinutes = hours * 60 + minutes;

  const jobs: Array<{ time: string; job: PushJob }> = [];
  for (const transition of transitions) {
    if (transition.kind === "start") continue;
    if (transition.state.sequence <= activity.lastSequence) continue;
    if (minutesFor(transition.time) < nowMinutes) continue;

    const job =
      transition.kind === "end"
        ? buildEndJob(
            deviceId,
            reg,
            activity.pushUpdateToken,
            transition.state,
            env.APNS_BUNDLE_ID
          )
        : buildUpdateJob(
            deviceId,
            reg,
            activity.pushUpdateToken,
            transition.state,
            env.APNS_BUNDLE_ID,
            staleDateUnix
          );
    jobs.push({ time: transition.time, job });
  }

  await removePendingJobsForDevice(env, deviceId, todayCST(), "nonStart");
  if (jobs.length > 0) {
    await writeJobsForToday(env, jobs);
  }
}

async function handleDailyPlan(env: Env): Promise<void> {
  await ensureStorageReady(env);
  await cleanupStaleData(env);

  const today = todayCST();
  const yesterday = nowCSTDate();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yKey = yesterday.toISOString().slice(0, 10);

  await deleteDispatchJobsForDay(env, yKey);

  const registrations = await listRegistrations(env);
  const jobs: Array<{ time: string; job: PushJob }> = [];

  for (const { deviceId, reg } of registrations) {
    if (reg.currentActivity && reg.currentActivity.dayKey !== today) {
      reg.currentActivity = undefined;
      await putRegistration(env, deviceId, reg);
    }

    const decision = await decideTodayForUser(env, reg);
    if (!decision.shouldSendPushes) continue;
    if (reg.currentActivity?.dayKey === today) continue;

    const periods = reg.schedule[String(decision.useWeekday)] ?? [];
    const transitions = buildStateTransitions(today, periods, decision);
    const startTransition = transitions.find((item) => item.kind === "start");
    if (!startTransition) continue;
    const staleDateUnix = finalDismissalUnix(today, periods, decision);

    jobs.push({
      time: startTransition.time,
      job: buildStartJob(
        deviceId,
        reg,
        startTransition.state,
        env.APNS_BUNDLE_ID,
        staleDateUnix
      ),
    });
  }

  await writeJobsForToday(env, jobs);
}

async function handleMinuteDispatch(env: Env): Promise<void> {
  await ensureStorageReady(env);

  const now = currentTimeCST();
  const dayKey = todayCST();
  const slotTime = formatTime(now.hours, now.minutes);
  const jobs = await fetchDispatchJobsForSlot(env, dayKey, slotTime);
  if (jobs.length === 0) return;

  const config = apnsConfig(env);
  const remaining: PushJob[] = [];

  for (const job of jobs) {
    const reg = await getRegistration(env, job.deviceId);
    if (!reg) continue;

    if (job.kind === "start" && reg.currentActivity?.dayKey === todayCST()) {
      continue;
    }

    if (job.kind !== "start") {
      if (!reg.currentActivity || reg.currentActivity.dayKey !== todayCST()) {
        continue;
      }
      if (job.token !== reg.currentActivity.pushUpdateToken) {
        continue;
      }
    }

    const result = await sendPush(
      { ...config, useSandbox: job.sandbox },
      {
        token: job.token,
        pushType: job.pushType,
        topic: job.topic,
        payload: stampTimestamp(job.payload),
      }
    );

    if (!result.ok) {
      console.error(
        `APNs push failed for device ${job.deviceId}: ${result.status} ${result.body}`
      );
      if (result.status !== 410) {
        remaining.push(job);
      } else {
        await deleteRegistration(env, job.deviceId);
        await removePendingJobsForDevice(env, job.deviceId, dayKey);
      }
      continue;
    }

    const aps = job.payload.aps as Record<string, unknown> | undefined;
    const contentState = aps?.["content-state"] as
      | { sequence?: number }
      | undefined;

    if (
      reg.currentActivity &&
      job.kind !== "start" &&
      typeof contentState?.sequence === "number"
    ) {
      reg.currentActivity.lastSequence = contentState.sequence;
      reg.currentActivity.updatedAt = nowUnix();
      await putRegistration(env, job.deviceId, reg);
    }

    if (job.kind === "end" && reg.currentActivity?.dayKey === todayCST()) {
      reg.currentActivity = undefined;
      await putRegistration(env, job.deviceId, reg);
    }
  }

  await replaceDispatchJobsForSlot(env, dayKey, slotTime, remaining);
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  await ensureStorageReady(env);

  const body: RegisterBody = await request.json();
  if (!body.deviceId || !body.pushStartToken || !body.schedule) {
    return new Response("Missing required fields", { status: 400 });
  }

  const existing = await getRegistration(env, body.deviceId);

  const registration: StoredRegistration = {
    pushStartToken: body.pushStartToken,
    sandbox: body.sandbox ?? false,
    track: body.track,
    entryYear: body.entryYear,
    schedule: body.schedule,
    paused: existing?.paused ?? false,
    resumeDate: existing?.resumeDate,
    currentActivity: existing?.currentActivity,
  };

  await putRegistration(env, body.deviceId, registration);

  const result = await scheduleStartJobsForRegistration(
    env,
    body.deviceId,
    registration
  );

  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleActivityToken(
  request: Request,
  env: Env
): Promise<Response> {
  await ensureStorageReady(env);

  const body: ActivityTokenBody = await request.json();
  if (!body.deviceId || !body.activityId || !body.dayKey || !body.pushUpdateToken) {
    return new Response("Missing required fields", { status: 400 });
  }

  const reg = await getRegistration(env, body.deviceId);
  if (!reg) return new Response("Not found", { status: 404 });

  reg.currentActivity = {
    activityId: body.activityId,
    dayKey: body.dayKey,
    pushUpdateToken: body.pushUpdateToken,
    owner: body.owner,
    lastSequence:
      reg.currentActivity?.activityId === body.activityId
        ? reg.currentActivity.lastSequence
        : -1,
    updatedAt: nowUnix(),
  };

  await putRegistration(env, body.deviceId, reg);

  await removePendingJobsForDevice(env, body.deviceId, body.dayKey, "startOnly");
  await scheduleUpdateJobsForActivity(env, body.deviceId, reg);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleActivityEnded(
  request: Request,
  env: Env
): Promise<Response> {
  await ensureStorageReady(env);

  const body: ActivityEndedBody = await request.json();
  if (!body.deviceId || !body.activityId || !body.dayKey) {
    return new Response("Missing required fields", { status: 400 });
  }

  const reg = await getRegistration(env, body.deviceId);
  if (!reg) return new Response("Not found", { status: 404 });

  if (reg.currentActivity?.activityId === body.activityId) {
    reg.currentActivity = undefined;
    await putRegistration(env, body.deviceId, reg);
  }

  await removePendingJobsForDevice(env, body.deviceId, body.dayKey);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleUnregister(request: Request, env: Env): Promise<Response> {
  await ensureStorageReady(env);

  const body: { deviceId: string } = await request.json();
  if (!body.deviceId) return new Response("Missing deviceId", { status: 400 });

  await deleteRegistration(env, body.deviceId);
  await removePendingJobsForDevice(env, body.deviceId);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}

async function handlePause(request: Request, env: Env): Promise<Response> {
  await ensureStorageReady(env);

  const body: { deviceId: string; resumeDate?: string } = await request.json();
  const reg = await getRegistration(env, body.deviceId);
  if (!reg) return new Response("Not found", { status: 404 });

  reg.paused = true;
  reg.resumeDate = body.resumeDate;
  await putRegistration(env, body.deviceId, reg);

  await removePendingJobsForDevice(env, body.deviceId);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleResume(request: Request, env: Env): Promise<Response> {
  await ensureStorageReady(env);

  const body: { deviceId: string } = await request.json();
  const reg = await getRegistration(env, body.deviceId);
  if (!reg) return new Response("Not found", { status: 404 });

  reg.paused = false;
  reg.resumeDate = undefined;
  await putRegistration(env, body.deviceId, reg);

  const result = await scheduleStartJobsForRegistration(env, body.deviceId, reg);
  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await ensureStorageReady(env);

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, date: todayCST() }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (request.method === "POST") {
      if (!isAuthorized(request, env)) {
        return new Response("Unauthorized", { status: 401 });
      }

      switch (url.pathname) {
        case "/register":
          return handleRegister(request, env);
        case "/activity-token":
          return handleActivityToken(request, env);
        case "/activity-ended":
          return handleActivityEnded(request, env);
        case "/unregister":
          return handleUnregister(request, env);
        case "/pause":
          return handlePause(request, env);
        case "/resume":
          return handleResume(request, env);
      }
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ) {
    if (controller.cron === "30 22 * * *") {
      ctx.waitUntil(handleDailyPlan(env));
    } else {
      ctx.waitUntil(handleMinuteDispatch(env));
    }
  },
} satisfies ExportedHandler<Env>;
