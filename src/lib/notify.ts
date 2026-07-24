import { log } from "./logger";

export async function sendReply(phone: string, text: string, hotelId: string): Promise<void> {
  log.info("outbound reply", { phone, hotelId, body: text });
}
export async function notifyGM(hotelId: string, text: string): Promise<void> {
  log.warn("notify GM", { hotelId, detail: text });
}
export async function notifyFrontDesk(hotelId: string, text: string): Promise<void> {
  log.warn("notify front desk", { hotelId, detail: text });
}
export async function notifyDepartment(hotelId: string, dept: string, text: string): Promise<void> {
  log.info("notify department", { hotelId, dept, detail: text });
}
