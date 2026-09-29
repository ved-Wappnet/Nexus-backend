export const smtpConfig = () => ({
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10) || 587,
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'noreply@nexus.local',
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
  },
});
