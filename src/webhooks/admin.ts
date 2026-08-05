import { Router } from "express";
import { prisma } from "../db";
import { WatiInbound } from "../lib/schemas";
import { verifyStaffSender } from "../safety";
import { sendReply } from "../lib/notify";
import { parseAdminCommand } from "../lib/adminCommands";
import { checkInGuest, checkOutGuest } from "../lib/frontdesk";
import { confirmBooking, offerAlternative, declineBooking } from "../dining";
import { confirmActivity, waitlistActivity, declineActivity, cancelActivity } from "../activities";
import { acceptRequest, declineRequest, proposeAlternative, claimRequest, completeRequest, problemRequest } from "../executor/actions";
import { log } from "../lib/logger";

export const adminRouter = Router();

adminRouter.post("/webhooks/admin/:hotelToken", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
    const hotel = await prisma.hotel.findUnique({ where: { webhookToken: req.params.hotelToken } });
    if (!hotel) {
      log.warn("admin: unknown hotel token");
      return;
    }

    const parsed = WatiInbound.safeParse(req.body);
    if (!parsed.success) return;
    const sender = parsed.data.waId;
    const text = (parsed.data.text ?? "").trim();
    if (!sender || !text) return;

    const staff = await verifyStaffSender(sender, hotel.hotelId);
    if (!staff.verified) {
      await sendReply(sender, "Sorry, this number isn't authorized for staff commands.", hotel.hotelId);
      log.warn("admin: unauthorized sender", { phone: sender, hotelId: hotel.hotelId });
      return;
    }

    const cmd = parseAdminCommand(text);
    if (cmd.kind === "emergency_on") {
      await prisma.hotel.update({ where: { hotelId: hotel.hotelId }, data: { emergencyMode: true } });
      await sendReply(sender, "Emergency mode is now ON - all guests will receive the emergency notice.", hotel.hotelId);
    } else if (cmd.kind === "emergency_off") {
      await prisma.hotel.update({ where: { hotelId: hotel.hotelId }, data: { emergencyMode: false } });
      await sendReply(sender, "Emergency mode is now OFF - Aria is back to normal.", hotel.hotelId);
    } else if (cmd.kind === "checkin") {
      await checkInGuest(hotel.hotelId, cmd.room, cmd.name, cmd.phone);
      await sendReply(sender, "Checked in " + cmd.name + " to Room " + cmd.room + ".", hotel.hotelId);
    } else if (cmd.kind === "checkout") {
      const isPhone = /^\+?\d{5,}$/.test(cmd.target);
      const s = await checkOutGuest(hotel.hotelId, isPhone ? { phone: cmd.target } : { room: cmd.target });
      await sendReply(sender, s ? "Checked out " + cmd.target + "." : "No active guest found for " + cmd.target + ".", hotel.hotelId);
    } else if (cmd.kind === "confirm") {
      let r = await confirmBooking(hotel.hotelId, cmd.ref, staff.staffName, cmd.revenue);
      if (!r.ok) r = await confirmActivity(hotel.hotelId, cmd.ref, staff.staffName, cmd.revenue);
      await sendReply(sender, r.message, hotel.hotelId);
    } else if (cmd.kind === "alt") {
      const r = await offerAlternative(hotel.hotelId, cmd.ref, cmd.time, staff.staffName);
      await sendReply(sender, r.message, hotel.hotelId);
    } else if (cmd.kind === "decline") {
      let r = await declineBooking(hotel.hotelId, cmd.ref, staff.staffName, cmd.reason);
      if (!r.ok) r = await declineActivity(hotel.hotelId, cmd.ref, staff.staffName, cmd.reason);
      await sendReply(sender, r.message, hotel.hotelId);
    } else if (cmd.kind === "waitlist") {
      const r = await waitlistActivity(hotel.hotelId, cmd.ref, staff.staffName);
      await sendReply(sender, r.message, hotel.hotelId);
    } else if (cmd.kind === "cancel") {
      const r = await cancelActivity(hotel.hotelId, cmd.ref, staff.staffName);
      await sendReply(sender, r.message, hotel.hotelId);
    } else if (cmd.kind === "accept") {
      const r = await acceptRequest(hotel.hotelId, cmd.ref, staff.staffName);
      await sendReply(sender, r.message, hotel.hotelId);
    } else if (cmd.kind === "decline_req") {
      const r = await declineRequest(hotel.hotelId, cmd.ref, staff.staffName, cmd.reason);
      await sendReply(sender, r.message, hotel.hotelId);
    } else if (cmd.kind === "alternative") {
      const r = await proposeAlternative(hotel.hotelId, cmd.ref, staff.staffName, cmd.option);
      await sendReply(sender, r.message, hotel.hotelId);
    } else if (cmd.kind === "claim") {
      const r = await claimRequest(hotel.hotelId, cmd.ref, staff.staffName);
      await sendReply(sender, r.message, hotel.hotelId);
    } else if (cmd.kind === "done") {
      const r = await completeRequest(hotel.hotelId, cmd.ref, staff.staffName);
      await sendReply(sender, r.message, hotel.hotelId);
    } else if (cmd.kind === "problem") {
      const r = await problemRequest(hotel.hotelId, cmd.ref, staff.staffName, cmd.reason);
      await sendReply(sender, r.message, hotel.hotelId);
    } else if (cmd.kind === "help") {
      await sendReply(sender, "Commands: EMERGENCY MODE ON/OFF | CHECKIN <room> <phone> <name> | CHECKOUT <room-or-phone> | CONFIRM <ref> [amount] | ALT <ref> <time> | DECLINE <ref> [reason] | WAITLIST <ref> | CANCEL <ref> | ACCEPT <ref> | REJECT <ref> <reason> | ALTERNATIVE <ref> <option> | CLAIM <ref> | DONE <ref> | PROBLEM <ref>", hotel.hotelId);
    } else {
      await sendReply(sender, "Command not recognized. Text HELP for the list.", hotel.hotelId);
    }
  } catch (err) {
    log.error("admin handler error", { detail: err instanceof Error ? err.message : String(err) });
  }
});
