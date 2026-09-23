import { isEmergency } from "./emergency";
import { isSensitive } from "./sensitive";
import { isGuestConflict } from "./guestConflict";
import { isGuestInfoFishing } from "./guestInfoFishing";
import { sendReply, notifyGM, notifyFrontDesk } from "../lib/notify";
import { log } from "../lib/logger";

export { verifyStaffSender } from "./staffVerification";

type SafetyHotel = { hotelId: string; name: string; emergencyMode: boolean };
type SafetyResult = { handled: boolean; reason?: string };

export async function runSafetyChecks(
  text: string,
  hotel: SafetyHotel,
  guestPhone: string
): Promise<SafetyResult> {
  if (isEmergency(text)) {
    await sendReply(guestPhone, "Our team has been alerted and is on the way to you now. If this is life-threatening, please call 112 immediately \u2014 I'll stay here.", hotel.hotelId);
    await notifyGM(hotel.hotelId, 'EMERGENCY from ' + guestPhone + ': "' + text + '"');
    await notifyFrontDesk(hotel.hotelId, "EMERGENCY - go to guest " + guestPhone);
    log.warn("safety: emergency handled", { phone: guestPhone, hotelId: hotel.hotelId });
    return { handled: true, reason: "emergency" };
  }

  if (isSensitive(text)) {
    await sendReply(guestPhone, "That's not something I can advise on. Our front desk can help, or a medical professional \u2014 and for an emergency, please call 112.", hotel.hotelId);
    await notifyFrontDesk(hotel.hotelId, "Sensitive/dangerous query from " + guestPhone);
    return { handled: true, reason: "sensitive" };
  }

  if (isGuestConflict(text)) {
    await sendReply(guestPhone, "I'm sorry \u2014 that shouldn't be part of your stay. Our front desk has been alerted and is dealing with it now.", hotel.hotelId);
    await notifyFrontDesk(hotel.hotelId, "Guest-vs-guest issue reported by " + guestPhone);
    await notifyGM(hotel.hotelId, "Guest-vs-guest issue reported by " + guestPhone);
    return { handled: true, reason: "guest_conflict" };
  }

  if (isGuestInfoFishing(text)) {
    await sendReply(guestPhone, "I'm not able to share anything about other guests \u2014 their privacy matters as much as yours. Our front desk can help if it's something they can pass on.", hotel.hotelId);
    await notifyFrontDesk(hotel.hotelId, 'Possible guest-info fishing from ' + guestPhone + ': "' + text + '"');
    await notifyGM(hotel.hotelId, "Possible guest-info fishing from " + guestPhone);
    return { handled: true, reason: "info_fishing" };
  }

  if (hotel.emergencyMode) {
    await sendReply(guestPhone, "We're handling an emergency in the hotel at the moment. Please come to the lobby or call the front desk \u2014 our team is there and ready to help you.", hotel.hotelId);
    return { handled: true, reason: "emergency_mode" };
  }

  return { handled: false };
}
