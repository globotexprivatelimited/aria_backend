import nodemailer from "nodemailer";

const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";

// Gmail SMTP transporter (uses an app password, not the account password)
function getTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function sendPasswordResetEmail(toEmail: string, resetLink: string, hotelName: string): Promise<{ ok: boolean; error?: string }> {
  if (!SMTP_USER || !SMTP_PASS) return { ok: false, error: "Email is not configured (SMTP_USER/SMTP_PASS missing)." };
  if (!toEmail) return { ok: false, error: "No destination email." };
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #F6F7F4; border-radius: 12px;">
        <h2 style="color: #0F5F4C; margin: 0 0 8px;">Reset your Aria password</h2>
        <p style="color: #444; font-size: 14px;">A password reset was requested for the manager account at <b>${hotelName}</b>.</p>
        <p style="color: #444; font-size: 14px;">Click the button below to set a new password. This link expires in 1 hour.</p>
        <a href="${resetLink}" style="display: inline-block; margin: 20px 0; padding: 13px 28px; background: #0F5F4C; color: #fff; text-decoration: none; border-radius: 10px; font-weight: 600;">Reset password</a>
        <p style="color: #888; font-size: 12px;">If you did not request this, you can ignore this email &mdash; your password will stay the same.</p>
        <p style="color: #aaa; font-size: 11px; margin-top: 24px;">Aria Hotel Intelligence</p>
      </div>`;
    await getTransport().sendMail({
      from: `"Aria" <${SMTP_USER}>`,
      to: toEmail,
      subject: "Reset your Aria password",
      html,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to send email." };
  }
}

export async function sendVerificationEmail(toEmail: string, link: string, hotelName: string): Promise<{ ok: boolean; error?: string }> {
  if (!SMTP_USER || !SMTP_PASS) return { ok: false, error: "Email is not configured (SMTP_USER/SMTP_PASS missing)." };
  if (!toEmail) return { ok: false, error: "No destination email." };
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #F6F7F4; border-radius: 12px;">
        <h2 style="color: #0F5F4C; margin: 0 0 8px;">Confirm this email for ${hotelName}</h2>
        <p style="color: #444; font-size: 14px;">You are receiving this because ${hotelName} was registered on Aria with this address.</p>
        <p style="color: #444; font-size: 14px;">Confirm it so we can send you password resets and important notices. The link works for 24 hours.</p>
        <a href="${link}" style="display: inline-block; margin: 20px 0; padding: 13px 28px; background: #0F5F4C; color: #fff; text-decoration: none; border-radius: 10px; font-weight: 600;">Confirm this email</a>
        <p style="color: #888; font-size: 12px;">If you did not register a hotel on Aria, ignore this message and nothing will happen.</p>
        <p style="color: #aaa; font-size: 11px; margin-top: 24px;">Aria Hotel Intelligence</p>
      </div>`;
    await getTransport().sendMail({ from: `"Aria" <${SMTP_USER}>`, to: toEmail, subject: "Confirm your email for " + hotelName, html });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to send email." };
  }
}