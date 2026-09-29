import { roleFromAccountType, UserRoles } from '@core/constants';
import { UserRole } from '@core/interfaces';
import { DatabaseService } from '@database/database.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from '@domain/auth/dtos';
import { LoginViewModel } from '@domain/auth/vms';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '@shared/mail/mail.service';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
  password_hash?: string;
  reset_otp_hash?: string | null;
  reset_otp_expires_at?: Date | null;
};

const OTP_EXPIRY_MINUTES = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  async login(dto: LoginDto): Promise<LoginViewModel> {
    const { rows } = await this.db.query(
      `SELECT id, name, email, password_hash, role, is_active, created_at FROM users WHERE lower(email) = lower($1)`,
      [dto.email],
    );
    const user = rows[0] as UserRow | undefined;
    if (!user || !user.is_active) throw new UnauthorizedException('Invalid email or password');
    const match = await bcrypt.compare(dto.password, user.password_hash ?? '');
    if (!match) throw new UnauthorizedException('Invalid email or password');

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
       VALUES ($1, 'USER_LOGGED_IN', 'users', $1)`,
      [user.id],
    );

    return this.session(user);
  }

  async register(dto: RegisterDto): Promise<LoginViewModel> {
    const existing = await this.db.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [dto.email]);
    if (existing.rowCount) throw new ConflictException('Email already registered');

    const role: UserRole = roleFromAccountType(dto.accountType);
    const hash = await bcrypt.hash(dto.password, 10);
    const name = dto.name.trim();
    const user = await this.db.tx(null, async (client) => {
      const inserted = await client.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, role, is_active, created_at`,
        [name, dto.email.toLowerCase(), hash, role],
      );
      const row = inserted.rows[0];
      if (role === UserRoles.SUPPLIER) {
        const store = `${name} Store`;
        await client.query(
          `INSERT INTO suppliers (user_id, store_name, commission_rate) VALUES ($1, $2, 12)`,
          [row.id, store],
        );
      } else if (role === UserRoles.DELIVERY_PARTNER) {
        const phone = dto.phone?.trim() || '+1 (555) 000-0000';
        const vehicleType = dto.vehicleType?.trim() || 'CARGO_VAN';
        const vehiclePlate = dto.vehiclePlateNumber?.trim() || '';
        const country = dto.country?.trim() || 'United States';
        const regionState = dto.regionState?.trim() || 'California';
        const city = dto.city?.trim() || 'San Francisco';
        const postalCodes = dto.servicePostalCodes?.trim() || '';

        await client.query(
          `INSERT INTO delivery_partners (
            user_id, full_name, phone, vehicle_type, vehicle_plate_number,
            country, region_state, city, service_postal_codes, verification_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING_SUBMISSION')
          ON CONFLICT (user_id) DO NOTHING`,
          [row.id, name, phone, vehicleType, vehiclePlate, country, regionState, city, postalCodes],
        );
      }
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
         VALUES ($1, 'USER_REGISTERED', 'users', $1)`,
        [row.id],
      );
      return row;
    });
    return this.session(user as UserRow);
  }

  async forgot(dto: ForgotPasswordDto) {
    const genericMessage = 'If that account exists, a verification code is on its way.';
    const { rows } = await this.db.query(
      `SELECT id, name, email, is_active FROM users WHERE lower(email) = lower($1)`,
      [dto.email],
    );
    const user = rows[0] as Pick<UserRow, 'id' | 'name' | 'email' | 'is_active'> | undefined;
    if (!user?.is_active) return { message: genericMessage };

    const otp = String(randomInt(100000, 1000000));
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await this.db.query(
      `UPDATE users SET reset_otp_hash = $2, reset_otp_expires_at = $3 WHERE id = $1`,
      [user.id, otpHash, expiresAt],
    );

    await this.mail.sendPasswordResetOtp(user.email, user.name || 'there', otp);

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
       VALUES ($1, 'PASSWORD_RESET_REQUESTED', 'users', $1)`,
      [user.id],
    );

    return { message: genericMessage };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const { rows } = await this.db.query(
      `SELECT id, name, email, password_hash, role, is_active, created_at, reset_otp_hash, reset_otp_expires_at
       FROM users WHERE lower(email) = lower($1)`,
      [dto.email],
    );
    const user = rows[0] as UserRow | undefined;
    if (!user?.is_active || !user.reset_otp_hash || !user.reset_otp_expires_at) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    if (new Date(user.reset_otp_expires_at).getTime() < Date.now()) {
      throw new BadRequestException('Verification code has expired. Request a new one.');
    }

    const otpValid = await bcrypt.compare(dto.otp, user.reset_otp_hash);
    if (!otpValid) throw new BadRequestException('Invalid or expired verification code');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.db.query(
      `UPDATE users
       SET password_hash = $2, reset_otp_hash = NULL, reset_otp_expires_at = NULL
       WHERE id = $1`,
      [user.id, passwordHash],
    );

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
       VALUES ($1, 'PASSWORD_RESET_COMPLETED', 'users', $1)`,
      [user.id],
    );

    return { message: 'Password updated. You can sign in with your new password.' };
  }

  async me(userId: string) {
    const { rows } = await this.db.query(
      `SELECT id, name, email, role, is_active, created_at FROM users WHERE id = $1`,
      [userId],
    );
    if (!rows[0]) throw new UnauthorizedException('Session expired');
    return this.toPublic(rows[0] as UserRow);
  }

  async logout(userId: string) {
    if (userId) {
      await this.db.query(
        `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
         VALUES ($1, 'USER_LOGGED_OUT', 'users', $1)`,
        [userId],
      );
    }
    return { success: true, message: 'Logged out' };
  }

  private session(user: UserRow): LoginViewModel {
    const token = this.jwt.sign({ sub: user.id, email: user.email, role: user.role, name: user.name });
    return { token, user: this.toPublic(user) };
  }

  private toPublic(user: UserRow) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.is_active,
      createdAt: user.created_at,
    };
  }
}
