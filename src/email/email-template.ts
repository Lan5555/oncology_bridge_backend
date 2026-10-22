export interface EmailTemplate {
  heading: string;
  text: string;
  eyebrow?: string;
  preheader?: string;
  badge?: string;
  action?: { label: string; url: string };
  note?: { title: string; text: string };
  showFallbackLink?: boolean;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );
}

// Tables and inline styles are intentional: the message remains readable when
// an email client removes the responsive styles or does not support web fonts.
export function renderEmailTemplate(options: EmailTemplate): string {
  const escape = escapeHtml;
  let action = '';
  if (options.action) {
    const url = new URL(options.action.url);
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname)
        ))
    ) {
      throw new Error('Email actions require a secure URL');
    }
    const href = escape(url.toString());
    action = `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:30px 0 0;"><tr><td bgcolor="#087f75" style="border-radius:8px;text-align:center;mso-padding-alt:16px 28px;">
      <a href="${href}" style="display:inline-block;border:1px solid #087f75;border-radius:8px;padding:16px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;mso-padding-alt:0;"><!--[if mso]><i style="mso-font-width:140%;mso-text-raise:24pt;" hidden>&emsp;</i><![endif]-->${escape(options.action.label)}<!--[if mso]><i style="mso-font-width:140%;" hidden>&emsp;&#8203;</i><![endif]--></a>
    </td></tr></table>`;
    if (options.showFallbackLink) {
      action += `<p style="margin:22px 0 0;font-size:12px;line-height:20px;color:#64748b;">Button not working? Copy this link into your browser:<br><a href="${href}" style="color:#087f75;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${href}</a></p>`;
    }
  }
  const paragraphs = options.text
    .split(/\n\s*\n/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:27px;color:#475569;">${escape(paragraph).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
  const note = options.note
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;"><tr><td bgcolor="#f0f7f6" style="padding:18px 20px;border-left:3px solid #087f75;border-radius:0 8px 8px 0;">
    <p style="margin:0 0 5px;font-size:13px;line-height:20px;font-weight:700;color:#155e59;">${escape(options.note.title)}</p>
    <p style="margin:0;font-size:13px;line-height:21px;color:#476762;">${escape(options.note.text)}</p>
  </td></tr></table>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escape(options.heading)} | OncoSourz</title>
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <style>
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    table { border-collapse:collapse; }
    a:focus-visible { outline:3px solid #0f172a; outline-offset:4px; }
    @media only screen and (max-width:620px) {
      .outer-pad { padding:24px 12px !important; }
      .content-pad { padding:30px 24px !important; }
      .email-heading { font-size:29px !important; line-height:36px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#eef3f4;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;font-size:1px;line-height:1px;color:#eef3f4;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escape(options.preheader ?? options.heading)}${'&#8199;&#8204;'.repeat(30)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef3f4"><tr><td class="outer-pad" align="center" style="padding:48px 20px;">
    <!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;margin:0 auto;">
      <tr><td style="padding:0 8px 24px;">
        <p style="margin:0;font-size:26px;line-height:32px;font-weight:700;letter-spacing:-1px;color:#142f3a;">Onco<span style="color:#087f75;">Sourz</span><span style="color:#087f75;">.</span></p>
        <p style="margin:5px 0 0;font-size:11px;line-height:18px;letter-spacing:1.5px;color:#64748b;">CONNECTED CARE. SHARED PURPOSE.</p>
      </td></tr>
      <tr><td bgcolor="#ffffff" style="border:1px solid #dce6e7;border-radius:16px;overflow:hidden;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><td bgcolor="#087f75" height="5" style="height:5px;font-size:1px;line-height:5px;">&nbsp;</td></tr>
          <tr><td class="content-pad" style="padding:40px;">
            <p style="margin:0 0 18px;font-size:11px;line-height:18px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#087f75;">${escape(options.eyebrow ?? 'YOUR ONCOSOURZ ACCOUNT')}</p>
            ${options.badge ? `<p style="margin:0 0 18px;"><span style="display:inline-block;padding:5px 11px;background-color:#edf7f5;border:1px solid #cfe6df;border-radius:20px;font-size:11px;line-height:17px;font-weight:700;color:#155e59;">${escape(options.badge)}</span></p>` : ''}
            <h1 class="email-heading" style="margin:0 0 20px;font-size:34px;line-height:41px;font-weight:700;letter-spacing:-1px;color:#142f3a;">${escape(options.heading)}</h1>
            ${paragraphs}
            ${action}
            ${note}
            <p style="margin:32px 0 0;font-size:14px;line-height:23px;color:#64748b;">With care,<br><strong style="font-weight:700;color:#142f3a;">The OncoSourz team</strong></p>
          </td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:24px 20px 0;">
        <p style="margin:0;font-size:12px;line-height:20px;color:#64748b;">Sent by OncoSourz &middot; Your oncology care network</p>
        <p style="margin:6px 0 0;font-size:11px;line-height:18px;color:#64748b;">Please keep your account details private. We will never ask for your password by email.</p>
      </td></tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr></table>
</body>
</html>`;
}
