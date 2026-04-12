import { sendPush, type APNsConfig } from "./apns";

interface Env {
  OUTSPIRE_KV: KVNamespace;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_PRIVATE_KEY: string;
  APNS_BUNDLE_ID: string;
  GITHUB_CALENDAR_URL: string;
  HOLIDAY_CN_URL: string;
}

// --- Types ---

interface RegisterBody {
  deviceId: string;
  pushStartToken: string;
  pushUpdateToken: string;
  track: "ibdp" | "alevel";
  entryYear: string;
  schedule: Record<string, ClassPeriod[]>; // "1"..  "5" -> periods
}

interface ClassPeriod {
  start: string; // "08:15"
  end: string; // "08:55"
  name: string;
  room: string;
}

interface StoredRegistration {
  pushStartToken: string;
  pushUpdateToken: string;
  track: "ibdp" | "alevel";
  entryYear: string;
  schedule: Record<string, ClassPeriod[]>;
  paused: boolean;
  resumeDate?: string; // "YYYY-MM-DD"
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

// --- Helpers ---

function todayCST(): string {
  const now = new Date();
  // UTC+8
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return cst.toISOString().slice(0, 10);
}

function currentTimeCST(): { hours: number; minutes: number } {
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return { hours: cst.getUTCHours(), minutes: cst.getUTCMinutes() };
}

function weekdayCST(): number {
  // 1=Mon..7=Sun
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = cst.getUTCDay(); // 0=Sun, 1=Mon
  return day === 0 ? 7 : day;
}

function parseTime(timeStr: string): { h: number; m: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { h, m };
}

function specialDayApplies(
  sd: SpecialDay,
  track: string,
  entryYear: string
): boolean {
  const trackMatch = sd.track === "all" || sd.track === track;
  const gradeMatch =
    sd.grades.includes("all") || sd.grades.includes(entryYear);
  return trackMatch && gradeMatch;
}

function apnsConfig(env: Env): APNsConfig {
  return {
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    privateKey: env.APNS_PRIVATE_KEY,
    bundleId: env.APNS_BUNDLE_ID,
  };
}

// --- Fetch external data (cached in KV for 1 hour) ---

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

async function fetchSchoolCalendar(
  env: Env,
  year: string
): Promise<SchoolCalendar | null> {
  const cacheKey = `cache:school-cal:${year}`;
  const cached = await env.OUTSPIRE_KV.get(cacheKey, "json");
  if (cached) return cached as SchoolCalendar;

  const resp = await fetch(`${env.GITHUB_CALENDAR_URL}/${year}.json`);
  if (!resp.ok) return null;
  const data: SchoolCalendar = await resp.json();

  // Short TTL (5 min) so same-day calendar updates propagate quickly
  await env.OUTSPIRE_KV.put(cacheKey, JSON.stringify(data), {
    expirationTtl: 300,
  });
  return data;
}

// --- Decision logic ---

interface DayDecision {
  shouldSendPushes: boolean;
  eventName?: string;
  cancelsClasses: boolean;
  useWeekday: number; // 1=Mon..5=Fri, which schedule to use
}

async function decideTodayForUser(
  env: Env,
  reg: StoredRegistration
): Promise<DayDecision> {
  const today = todayCST();
  const year = today.slice(0, 4);
  const wd = weekdayCST();

  // 1. Check pause
  if (reg.paused) {
    if (reg.resumeDate && today >= reg.resumeDate) {
      // Auto-resume — caller should clear pause flag
    } else {
      return { shouldSendPushes: false, cancelsClasses: false, useWeekday: wd };
    }
  }

  // 2. Fetch school calendar
  const cal = await fetchSchoolCalendar(env, year);
  if (cal) {
    // Check semester range
    const inSemester = cal.semesters.some(
      (s) => today >= s.start && today <= s.end
    );
    if (!inSemester) {
      return { shouldSendPushes: false, cancelsClasses: false, useWeekday: wd };
    }

    // Check specialDays
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

  // 3. Check holiday-cn
  const holidays = await fetchHolidayCN(env, year);
  const holiday = holidays.find((d) => d.date === today);
  if (holiday) {
    if (holiday.isOffDay) {
      return { shouldSendPushes: false, cancelsClasses: false, useWeekday: wd };
    }
    // 调休补班 — school calendar might have followsWeekday, otherwise use Monday
    const calMakeup = cal?.specialDays.find(
      (sd) => sd.date === today && sd.type === "makeup"
    );
    const useWd = calMakeup?.followsWeekday ?? 1;
    return {
      shouldSendPushes: true,
      cancelsClasses: false,
      useWeekday: useWd,
    };
  }

  // 4. Weekend?
  if (wd >= 6) {
    return { shouldSendPushes: false, cancelsClasses: false, useWeekday: wd };
  }

  // 5. Normal school day
  return { shouldSendPushes: true, cancelsClasses: false, useWeekday: wd };
}

// --- Push scheduling ---

interface ScheduledPush {
  time: string; // "HH:MM"
  event: "start" | "update" | "end";
  contentState?: Record<string, unknown>;
}

function buildPushSchedule(
  periods: ClassPeriod[],
  decision: DayDecision
): ScheduledPush[] {
  if (decision.cancelsClasses) {
    // Send one event push at 7:45
    return [
      {
        time: "07:45",
        event: "start",
        contentState: {
          className: decision.eventName ?? "No Classes",
          roomNumber: "",
          status: "event",
          periodStart: 0,
          periodEnd: 0,
          nextClassName: null,
        },
      },
      { time: "17:00", event: "end" },
    ];
  }

  if (periods.length === 0) return [];

  const pushes: ScheduledPush[] = [];

  // Start LA 30 min before first class
  const firstStart = parseTime(periods[0].start);
  const startH = firstStart.m >= 30 ? firstStart.h : firstStart.h - 1;
  const startM = (firstStart.m + 30) % 60;
  pushes.push({
    time: `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`,
    event: "start",
    contentState: {
      className: periods[0].name,
      roomNumber: periods[0].room,
      status: "upcoming",
      periodStart: periods[0].start,
      periodEnd: periods[0].end,
      nextClassName: periods.length > 1 ? periods[1].name : null,
    },
  });

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const next = i + 1 < periods.length ? periods[i + 1] : null;

    // Class starts -> ongoing
    pushes.push({
      time: p.start,
      event: "update",
      contentState: {
        className: p.name,
        roomNumber: p.room,
        status: "ongoing",
        periodStart: p.start,
        periodEnd: p.end,
        nextClassName: next?.name ?? null,
      },
    });

    // 5 min before end -> ending
    const endTime = parseTime(p.end);
    const endingM = endTime.m >= 5 ? endTime.m - 5 : endTime.m + 55;
    const endingH = endTime.m >= 5 ? endTime.h : endTime.h - 1;
    pushes.push({
      time: `${String(endingH).padStart(2, "0")}:${String(endingM).padStart(2, "0")}`,
      event: "update",
      contentState: {
        className: p.name,
        roomNumber: p.room,
        status: "ending",
        periodStart: p.start,
        periodEnd: p.end,
        nextClassName: next?.name ?? null,
      },
    });

    // Class ends -> break (if next class exists)
    if (next) {
      pushes.push({
        time: p.end,
        event: "update",
        contentState: {
          className: next.name,
          roomNumber: next.room,
          status: "break",
          periodStart: p.end,
          periodEnd: next.start,
          nextClassName: next.name,
        },
      });
    }
  }

  // End LA after last class
  const lastEnd = periods[periods.length - 1].end;
  pushes.push({ time: lastEnd, event: "end" });

  return pushes;
}

// --- HTTP Handlers ---

async function handleRegister(
  request: Request,
  env: Env
): Promise<Response> {
  const body: RegisterBody = await request.json();

  if (!body.deviceId || !body.pushStartToken || !body.schedule) {
    return new Response("Missing required fields", { status: 400 });
  }

  const registration: StoredRegistration = {
    pushStartToken: body.pushStartToken,
    pushUpdateToken: body.pushUpdateToken,
    track: body.track,
    entryYear: body.entryYear,
    schedule: body.schedule,
    paused: false,
  };

  await env.OUTSPIRE_KV.put(
    `reg:${body.deviceId}`,
    JSON.stringify(registration),
    { expirationTtl: 30 * 24 * 60 * 60 } // 30 days
  );

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}

async function handlePause(request: Request, env: Env): Promise<Response> {
  const body: { deviceId: string; resumeDate?: string } =
    await request.json();

  const key = `reg:${body.deviceId}`;
  const existing = await env.OUTSPIRE_KV.get(key, "json");
  if (!existing) return new Response("Not found", { status: 404 });

  const reg = existing as StoredRegistration;
  reg.paused = true;
  reg.resumeDate = body.resumeDate;

  await env.OUTSPIRE_KV.put(key, JSON.stringify(reg), {
    expirationTtl: 30 * 24 * 60 * 60,
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleResume(request: Request, env: Env): Promise<Response> {
  const body: { deviceId: string } = await request.json();

  const key = `reg:${body.deviceId}`;
  const existing = await env.OUTSPIRE_KV.get(key, "json");
  if (!existing) return new Response("Not found", { status: 404 });

  const reg = existing as StoredRegistration;
  reg.paused = false;
  reg.resumeDate = undefined;

  await env.OUTSPIRE_KV.put(key, JSON.stringify(reg), {
    expirationTtl: 30 * 24 * 60 * 60,
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleUnregister(
  request: Request,
  env: Env
): Promise<Response> {
  const body: { deviceId: string } = await request.json();

  if (!body.deviceId) {
    return new Response("Missing deviceId", { status: 400 });
  }

  await env.OUTSPIRE_KV.delete(`reg:${body.deviceId}`);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}

// --- Cron Handler ---

async function handleCron(env: Env): Promise<void> {
  const { hours, minutes } = currentTimeCST();
  const nowTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  // List all registered tokens
  const list = await env.OUTSPIRE_KV.list({ prefix: "reg:" });

  for (const key of list.keys) {
    const regData = await env.OUTSPIRE_KV.get(key.name, "json");
    if (!regData) continue;

    const reg = regData as StoredRegistration;

    // Decide if today is a school day for this user
    const decision = await decideTodayForUser(env, reg);

    // Auto-resume if needed
    if (reg.paused && reg.resumeDate && todayCST() >= reg.resumeDate) {
      reg.paused = false;
      reg.resumeDate = undefined;
      await env.OUTSPIRE_KV.put(key.name, JSON.stringify(reg), {
        expirationTtl: 30 * 24 * 60 * 60,
      });
    }

    if (!decision.shouldSendPushes) continue;

    // Get schedule for today's weekday
    const wdKey = String(decision.useWeekday);
    const periods = reg.schedule[wdKey] ?? [];

    // Build push schedule
    const pushSchedule = buildPushSchedule(periods, decision);

    // Find pushes due now (matching current minute)
    const duePushes = pushSchedule.filter((p) => p.time === nowTime);

    for (const push of duePushes) {
      const config = apnsConfig(env);
      const topic = `${env.APNS_BUNDLE_ID}.push-type.liveactivity`;

      if (push.event === "start" && reg.pushStartToken) {
        // Use pushToStartToken to start Live Activity
        await sendPush(config, {
          token: reg.pushStartToken,
          pushType: "liveactivity",
          topic,
          payload: {
            aps: {
              timestamp: Math.floor(Date.now() / 1000),
              event: "start",
              "content-state": push.contentState,
              "attributes-type": "ClassActivityAttributes",
              attributes: { startDate: Math.floor(Date.now() / 1000) },
            },
          },
        });
      } else if (push.event === "update" && reg.pushUpdateToken) {
        await sendPush(config, {
          token: reg.pushUpdateToken,
          pushType: "liveactivity",
          topic,
          payload: {
            aps: {
              timestamp: Math.floor(Date.now() / 1000),
              event: "update",
              "content-state": push.contentState,
            },
          },
        });
      } else if (push.event === "end" && reg.pushUpdateToken) {
        await sendPush(config, {
          token: reg.pushUpdateToken,
          pushType: "liveactivity",
          topic,
          payload: {
            aps: {
              timestamp: Math.floor(Date.now() / 1000),
              event: "end",
              "dismissal-date": Math.floor(Date.now() / 1000) + 900,
            },
          },
        });
      }
    }
  }
}

// --- Main export ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST") {
      switch (url.pathname) {
        case "/register":
          return handleRegister(request, env);
        case "/unregister":
          return handleUnregister(request, env);
        case "/pause":
          return handlePause(request, env);
        case "/resume":
          return handleResume(request, env);
      }
    }

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, time: todayCST() }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleCron(env));
  },
} satisfies ExportedHandler<Env>;
