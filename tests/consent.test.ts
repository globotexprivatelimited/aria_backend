import { isWithdrawalKeyword, looksLikeOptOut } from "../src/privacy/consent";

describe("consent is withdrawn and messages are stopped on intent, not exact words", () => {
  test("no more messages - English, Hindi, Bengali", () => {
    for (const t of ["please stop messaging me", "don't text me anymore", "no more messages please", "never contact me again", "message mat karo", "mujhe msg mat bhejo", "aar message korben na", "message pathaben na"]) expect(looksLikeOptOut(t)).toBe(true);
    for (const t of ["stop", "2 samosa bhej do", "message received, thanks", "stop the music please"]) expect(looksLikeOptOut(t)).toBe(false);
  });
  test("erase everything - a bare STOP or an explicit ask", () => {
    for (const t of ["STOP", "stop.", "unsubscribe", "please delete my data", "forget me", "mera data delete kar do", "amar number delete korun"]) expect(isWithdrawalKeyword(t)).toBe(true);
    for (const t of ["please stop messaging me", "stop the music", "delete the extra samosa from my order"]) expect(isWithdrawalKeyword(t)).toBe(false);
  });
});
