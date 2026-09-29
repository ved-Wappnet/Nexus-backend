import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { passwordResetOtpTemplate } from './templates/password-reset-otp.template';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendPasswordResetOtp(to: string, userName: string, otp: string) {
    const appName = this.config.get<string>('app.name') ?? 'Nexus';
    const expiresMinutes = 10;
    const frontendUrl = this.config.get<string>('app.frontend.url');
    const html = passwordResetOtpTemplate({ appName, userName, otp, expiresMinutes, frontendUrl });
    await this.send({
      to,
      subject: `${appName} password reset code: ${otp}`,
      html,
      text: [
        `${appName} — Password reset`,
        '',
        `Hi ${userName || 'there'},`,
        '',
        `Your verification code is: ${otp}`,
        `This code expires in ${expiresMinutes} minutes.`,
        '',
        'If you did not request a password reset, you can ignore this email.',
        frontendUrl ? `\nSign in: ${frontendUrl.replace(/\/$/, '')}/auth` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  async send(options: { to: string; subject: string; html: string; text: string }) {
    const host = this.config.get<string>('smtp.host');
    const port = this.config.get<number>('smtp.port');
    const user = this.config.get<string>('smtp.user');
    const pass = this.config.get<string>('smtp.pass');
    const from = this.config.get<string>('smtp.from');
    const secure = this.config.get<boolean>('smtp.secure');

    if (!host || !user || !pass) {
      throw new InternalServerErrorException(
        'Email service is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.',
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    try {
      await transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
    } catch (error) {
      this.logger.error('Failed to send email', error instanceof Error ? error.stack : String(error));
      throw new InternalServerErrorException('Unable to send email right now. Please try again later.');
    }
  }
}
