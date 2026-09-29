export type PasswordResetOtpTemplateParams = {
  appName: string;
  userName: string;
  otp: string;
  expiresMinutes: number;
  frontendUrl?: string;
};

const COLORS = {
  pageBg: '#09090b',
  cardBg: '#18181b',
  cardBorder: '#27272a',
  headerBg: '#1e1b4b',
  accent: '#6366f1',
  accentSoft: '#312e81',
  textPrimary: '#fafafa',
  textSecondary: '#d4d4d8',
  textMuted: '#a1a1aa',
  textSubtle: '#71717a',
  textFooter: '#52525b',
  otpBg: '#09090b',
  otpCellBg: '#27272a',
  otpCellBorder: '#3f3f46',
  noticeBg: '#18181b',
  noticeBorder: '#27272a',
} as const;

export function passwordResetOtpTemplate({
  appName,
  userName,
  otp,
  expiresMinutes,
  frontendUrl,
}: PasswordResetOtpTemplateParams): string {
  const safeApp = escapeHtml(appName);
  const safeName = escapeHtml(userName || 'there');
  const digits = otp.split('');
  const year = new Date().getFullYear();
  const authLink = frontendUrl ? escapeHtml(frontendUrl.replace(/\/$/, '')) : '';

  const otpCells = digits
    .map(
      (digit, index) => `
        ${index > 0 ? `<td width="8" class="otp-spacer" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>` : ''}
        <td
          width="44"
          height="56"
          align="center"
          valign="middle"
          class="otp-cell"
          style="width:44px;height:56px;background-color:${COLORS.otpCellBg};border:1px solid ${COLORS.otpCellBorder};border-radius:10px;font-size:28px;font-weight:700;line-height:56px;color:${COLORS.textPrimary};font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace;mso-line-height-rule:exactly;"
        >
          ${escapeHtml(digit)}
        </td>`,
    )
    .join('');

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${safeApp} password reset</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    #outlook a { padding: 0; }
    body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td {
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    img {
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
      -ms-interpolation-mode: bicubic;
    }
    @media only screen and (max-width: 620px) {
      .wrapper { padding: 24px 12px !important; }
      .container { width: 100% !important; max-width: 100% !important; }
      .content { padding-left: 20px !important; padding-right: 20px !important; }
      .header { padding: 28px 20px 22px !important; }
      .otp-cell {
        width: 38px !important;
        height: 48px !important;
        font-size: 24px !important;
        line-height: 48px !important;
      }
      .otp-spacer { width: 6px !important; }
      .title { font-size: 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.pageBg};color:${COLORS.textPrimary};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${COLORS.pageBg};">
    <tr>
      <td align="center" class="wrapper" style="padding:40px 16px;">
        <table role="presentation" class="container" width="560" cellspacing="0" cellpadding="0" border="0" style="width:560px;max-width:560px;background-color:${COLORS.cardBg};border:1px solid ${COLORS.cardBorder};border-radius:16px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td class="header" align="center" style="padding:36px 32px 28px;background-color:${COLORS.headerBg};border-bottom:1px solid ${COLORS.cardBorder};">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                <tr>
                  <td width="56" height="56" align="center" valign="middle" style="width:56px;height:56px;background-color:${COLORS.accentSoft};border-radius:14px;border:1px solid ${COLORS.accent};font-size:22px;font-weight:700;line-height:56px;color:#e0e7ff;font-family:Arial,Helvetica,sans-serif;mso-line-height-rule:exactly;">
                    N
                  </td>
                </tr>
              </table>
              <h1 class="title" style="margin:18px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.3;font-weight:700;color:${COLORS.textPrimary};">
                Reset your password
              </h1>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${COLORS.textMuted};max-width:420px;">
                Use the verification code below to finish resetting your ${safeApp} account.
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="content" style="padding:28px 32px 8px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${COLORS.textSecondary};">
                Hi ${safeName},
              </p>
              <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:${COLORS.textMuted};">
                Enter this one-time code on the reset screen. For your security, it expires in
                <strong style="color:${COLORS.textSecondary};">${expiresMinutes} minutes</strong>.
              </p>

              <!-- OTP box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" style="padding:22px 16px;background-color:${COLORS.otpBg};border:1px solid ${COLORS.cardBorder};border-radius:14px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                      <tr>
                        ${otpCells}
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;">
                <tr>
                  <td style="padding:14px 16px;background-color:${COLORS.noticeBg};border:1px solid ${COLORS.noticeBorder};border-radius:12px;">
                    <p style="margin:0;font-size:13px;line-height:1.6;color:${COLORS.textSubtle};text-align:center;">
                      If you did not request a password reset, you can safely ignore this email. Your password will not change.
                    </p>
                  </td>
                </tr>
              </table>

              ${
                authLink
                  ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:${COLORS.textSubtle};text-align:center;">
                      Return to <a href="${authLink}/auth" style="color:${COLORS.accent};text-decoration:none;font-weight:600;">${safeApp}</a>
                    </p>`
                  : ''
              }
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid ${COLORS.cardBorder};text-align:center;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${COLORS.textFooter};">
                &copy; ${year} ${safeApp}
              </p>
              <p style="margin:0;font-size:11px;line-height:1.5;color:${COLORS.textFooter};">
                Secure marketplace access
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
