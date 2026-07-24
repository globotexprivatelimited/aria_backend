import { prisma } from "../db";

export async function verifyStaffSender(
  phone: string,
  hotelId: string,
  department?: string
): Promise<{ verified: true; staffName: string } | { verified: false }> {
  const staff = await prisma.staffContact.findFirst({
    where: {
      hotelId,
      whatsappNumber: phone,
      isActive: true,
      ...(department ? { department: department as never } : {}),
    },
  });
  return staff ? { verified: true, staffName: staff.staffName ?? "staff" } : { verified: false };
}
