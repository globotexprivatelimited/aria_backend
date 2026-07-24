import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../db";

export const dashboardRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const key = process.env.ADMIN_API_KEY ?? "";
  if (!key || req.header("x-admin-key") !== key) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

function hotelIdOf(req: Request): string {
  return String(req.query.hotelId ?? "demo");
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

dashboardRouter.use("/api/dashboard", requireAdmin);

/** 1. Overview - the numbers a GM checks first */
dashboardRouter.get("/api/dashboard/overview", async (req, res) => {
  const hotelId = hotelIdOf(req);
  const today = startOfToday();

  const [activeGuests, prospects, flagged, openRequests, todayRequests, todayMessages, pendingDining] =
    await Promise.all([
      prisma.session.count({ where: { hotelId, state: "active" } }),
      prisma.session.count({ where: { hotelId, state: "prospect" } }),
      prisma.session.count({ where: { hotelId, state: "flagged" } }),
      prisma.request.count({ where: { hotelId, status: { in: ["received", "in_progress"] } } }),
      prisma.request.count({ where: { hotelId, createdAt: { gte: today } } }),
      prisma.message.count({ where: { hotelId, createdAt: { gte: today } } }),
      prisma.diningBooking.count({ where: { hotelId, status: "pending" } }),
    ]);

  const byDept = await prisma.request.groupBy({
    by: ["department"],
    where: { hotelId, status: { in: ["received", "in_progress"] } },
    _count: true,
  });

  res.json({
    hotelId,
    guests: { active: activeGuests, prospects, flagged },
    requests: { open: openRequests, today: todayRequests },
    openByDepartment: byDept.map((d) => ({ department: d.department, count: d._count })),
    messagesToday: todayMessages,
    diningPendingConfirmation: pendingDining,
  });
});

/** 2. Live request queue */
dashboardRouter.get("/api/dashboard/requests", async (req, res) => {
  const hotelId = hotelIdOf(req);
  const { status, department, priority } = req.query;
  const take = Math.min(Number(req.query.limit ?? 50), 200);

  const rows = await prisma.request.findMany({
    where: {
      hotelId,
      ...(status ? { status: String(status) as never } : {}),
      ...(department ? { department: String(department) as never } : {}),
      ...(priority ? { priority: String(priority) as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
  });

  res.json({ count: rows.length, requests: rows });
});

/** 3. In-house guests */
dashboardRouter.get("/api/dashboard/guests", async (req, res) => {
  const hotelId = hotelIdOf(req);
  const rows = await prisma.session.findMany({
    where: { hotelId, state: { in: ["active", "flagged"] } },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
  });

  res.json({
    count: rows.length,
    guests: rows.map((s) => ({
      sessionId: s.id,
      phone: s.guestPhone,
      room: s.roomNumber,
      name: s.claimedGuestName,
      state: s.state,
      verified: s.roomVerified,
      verificationMethod: s.verificationMethod,
      checkInDate: s.checkInDate,
      lastMessageAt: s.lastMessageAt,
    })),
  });
});

/** 4. Full conversation thread - the dispute record */
dashboardRouter.get("/api/dashboard/conversations/:phone", async (req, res) => {
  const hotelId = hotelIdOf(req);
  const guestPhone = req.params.phone;

  const [session, messages] = await Promise.all([
    prisma.session.findFirst({ where: { hotelId, guestPhone }, orderBy: { createdAt: "desc" } }),
    prisma.message.findMany({ where: { hotelId, guestPhone }, orderBy: { createdAt: "asc" }, take: 500 }),
  ]);

  res.json({
    phone: guestPhone,
    session: session
      ? { state: session.state, room: session.roomNumber, name: session.claimedGuestName, verified: session.roomVerified }
      : null,
    messageCount: messages.length,
    messages: messages.map((m) => ({
      at: m.createdAt,
      direction: m.direction,
      type: m.messageType,
      body: m.body,
    })),
  });
});

/** 5. Things needing attention */
dashboardRouter.get("/api/dashboard/alerts", async (req, res) => {
  const hotelId = hotelIdOf(req);

  const [flaggedSessions, unverifiedActive, urgentRequests, hotel] = await Promise.all([
    prisma.session.findMany({ where: { hotelId, state: "flagged" }, orderBy: { lastMessageAt: "desc" }, take: 50 }),
    prisma.session.findMany({ where: { hotelId, state: "active", roomVerified: false }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.request.findMany({ where: { hotelId, priority: "urgent", status: { in: ["received", "in_progress"] } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.hotel.findUnique({ where: { hotelId } }),
  ]);

  res.json({
    emergencyMode: hotel ? hotel.emergencyMode : false,
    flaggedSessions: flaggedSessions.map((s) => ({ phone: s.guestPhone, room: s.roomNumber, lastMessageAt: s.lastMessageAt })),
    unverifiedActiveGuests: unverifiedActive.map((s) => ({ phone: s.guestPhone, room: s.roomNumber, name: s.claimedGuestName })),
    urgentRequests: urgentRequests.map((r) => ({ id: r.id, room: r.roomNumber, intent: r.intent, department: r.department, detail: r.requestDetail, priority: r.priority, createdAt: r.createdAt })),
  });
});

/** 6. Revenue-driving bookings */
dashboardRouter.get("/api/dashboard/revenue", async (req, res) => {
  const hotelId = hotelIdOf(req);
  const since = new Date(Date.now() - 30 * 86400 * 1000);

  const [dining, activities] = await Promise.all([
    prisma.diningBooking.findMany({ where: { hotelId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.activityBooking.findMany({ where: { hotelId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);

  const diningByStatus: Record<string, number> = {};
  for (const d of dining) diningByStatus[d.status] = (diningByStatus[d.status] ?? 0) + 1;

  res.json({
    windowDays: 30,
    dining: { total: dining.length, byStatus: diningByStatus },
    activities: { total: activities.length },
    bookings: {
      dining: dining.map((d) => ({ id: d.id, room: d.roomNumber, status: d.status, createdAt: d.createdAt })),
      activities: activities.map((a) => ({ id: a.id, room: a.roomNumber, status: a.status, createdAt: a.createdAt })),
    },
  });
});
