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
    await sendReply(guestPhone, "I'm alerting our team right now - help is on the way. If this is life-threatening, please also call 112.", hotel.hotelId);
    await notifyGM(hotel.hotelId, 'EMERGENCY from ' + guestPhone + ': "' + text + '"');
    await notifyFrontDesk(hotel.hotelId, "EMERGENCY - go to guest " + guestPhone);
    log.warn("safety: emergency handled", { phone: guestPhone, hotelId: hotel.hotelId });
    return { handled: true, reason: "emergency" };
  }

  if (isSensitive(text)) {
    await sendReply(guestPhone, "That's outside what I can help with - please speak to our front desk, or a medical professional. Emergencies: 112.", hotel.hotelId);
    await notifyFrontDesk(hotel.hotelId, "Sensitive/dangerous query from " + guestPhone);
    return { handled: true, reason: "sensitive" };
  }

  if (isGuestConflict(text)) {
    await sendReply(guestPhone, "I'm sorry this is affecting your stay - I've alerted our front desk team to address it right now.", hotel.hotelId);
    await notifyFrontDesk(hotel.hotelId, "Guest-vs-guest issue reported by " + guestPhone);
    await notifyGM(hotel.hotelId, "Guest-vs-guest issue reported by " + guestPhone);
    return { handled: true, reason: "guest_conflict" };
  }

  if (isGuestInfoFishing(text)) {
    await sendReply(guestPhone, "I'm not able to share information about other guests - for anything like that please speak with our front desk directly.", hotel.hotelId);
    await notifyFrontDesk(hotel.hotelId, 'Possible guest-info fishing from ' + guestPhone + ': "' + text + '"');
    await notifyGM(hotel.hotelId, "Possible guest-info fishing from " + guestPhone);
    return { handled: true, reason: "info_fishing" };
  }

  if (hotel.emergencyMode) {
    await sendReply(guestPhone, "We're currently managing an emergency situation. Please contact our front desk or come to the lobby - our team is here to help.", hotel.hotelId);
    return { handled: true, reason: "emergency_mode" };
  }

  return { handled: false };
}
