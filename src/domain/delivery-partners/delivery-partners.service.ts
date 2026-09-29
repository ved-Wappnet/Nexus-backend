import {
  DeliveryPartnerVerificationStatuses,
  OrderStatuses,
  UserRoles,
} from '@core/constants';
import { v2 as cloudinary } from 'cloudinary';
import { Actor } from '@core/interfaces';
import { DatabaseService } from '@database/database.service';
import { NotificationsService } from '@domain/notifications/notifications.service';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { OrdersGateway } from '@domain/orders/orders.gateway';
import { AssignOrderDto } from './dtos/assign-order.dto';
import { UpdateTaskStatusDto } from './dtos/update-task.dto';
import { UploadDocumentDto } from './dtos/upload-document.dto';
import { VerifyPartnerDto } from './dtos/verify-partner.dto';
import { LocationPingDto } from './dtos/location-ping.dto';
import { SubmitProofOfDeliveryDto } from './dtos/submit-pod.dto';

export interface DeliveryPartnerRow {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  vehicle_type: string;
  vehicle_plate_number: string;
  country: string;
  region_state: string;
  city: string;
  service_postal_codes: string;
  verification_status: DeliveryPartnerVerificationStatuses;
  rejection_reason: string | null;
  documents: any[];
  is_available: boolean;
  rating: string;
  completed_trips: number;
  approved_at: Date | null;
  approved_by: string | null;
  created_at: Date;
  updated_at: Date;
  email?: string;
  user_name?: string;
}

export interface AdminPartnerListResult {
  partners: DeliveryPartnerRow[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  stats: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
}

export interface EligiblePartnersResult {
  orderId: string;
  destinationArea: {
    city: string;
    region: string;
    country: string;
  };
  eligiblePartners: any[];
}

export interface MyTasksResult {
  partnerStatus: string;
  rejectionReason?: string | null;
  isApproved: boolean;
  message?: string;
  partnerProfile?: {
    id: string;
    fullName: string;
    phone: string;
    vehicleType: string;
    vehiclePlate: string;
    rating: string;
    completedTrips: number;
  };
  tasks: any[];
}

@Injectable()
export class DeliveryPartnersService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => OrdersGateway))
    @Optional()
    private readonly ordersGateway?: OrdersGateway,
  ) {}

  async onModuleInit() {
    await this.ensureDeliveryPartnersSchema();
  }

  private async ensureDeliveryPartnersSchema() {
    try {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS delivery_partners (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          full_name VARCHAR(255) NOT NULL,
          phone VARCHAR(64) NOT NULL,
          vehicle_type VARCHAR(64) NOT NULL DEFAULT 'CARGO_VAN',
          vehicle_plate_number VARCHAR(64) NOT NULL DEFAULT '',
          country VARCHAR(128) NOT NULL DEFAULT 'United States',
          region_state VARCHAR(128) NOT NULL DEFAULT 'California',
          city VARCHAR(128) NOT NULL DEFAULT 'San Francisco',
          service_postal_codes TEXT NOT NULL DEFAULT '',
          verification_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL',
          rejection_reason TEXT,
          documents JSONB NOT NULL DEFAULT '[]'::jsonb,
          is_available BOOLEAN NOT NULL DEFAULT true,
          rating NUMERIC(3, 2) NOT NULL DEFAULT 4.90,
          completed_trips INT NOT NULL DEFAULT 0,
          approved_at TIMESTAMPTZ,
          approved_by UUID REFERENCES users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_delivery_partners_user_id ON delivery_partners(user_id);
        CREATE INDEX IF NOT EXISTS idx_delivery_partners_status ON delivery_partners(verification_status);
        CREATE INDEX IF NOT EXISTS idx_delivery_partners_geo ON delivery_partners(country, region_state, city);

        ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_partner_id UUID REFERENCES delivery_partners(id);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_country VARCHAR(128) DEFAULT 'United States';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_region VARCHAR(128) DEFAULT 'California';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_city VARCHAR(128) DEFAULT 'San Francisco';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_address TEXT DEFAULT '100 Nexus Distribution Way, Dock 4';
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_latitude NUMERIC(10, 7);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS destination_longitude NUMERIC(10, 7);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS arrival_alert_sent_at TIMESTAMPTZ;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_latitude NUMERIC(10, 7);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_longitude NUMERIC(10, 7);
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_heading NUMERIC(6, 2) DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_speed NUMERIC(6, 2) DEFAULT 0;
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_last_ping_at TIMESTAMPTZ;
      `);

      // Update existing applicants with 0 documents from PENDING_APPROVAL to PENDING_SUBMISSION
      await this.db.query(`
        UPDATE delivery_partners
        SET verification_status = '${DeliveryPartnerVerificationStatuses.PENDING_SUBMISSION}'
        WHERE (verification_status = '${DeliveryPartnerVerificationStatuses.PENDING_APPROVAL}' OR verification_status IS NULL)
          AND (documents IS NULL OR jsonb_array_length(documents) = 0);
      `);

      // Remove any erroneous admin/subadmin accounts from delivery_partners table
      await this.db.query(`
        DELETE FROM delivery_partners
        WHERE user_id IN (SELECT id FROM users WHERE role IN ('${UserRoles.ADMIN}', '${UserRoles.SUBADMIN}'));
      `);

      // Seed a verified demo fleet partner if none exists to guarantee immediate out-of-the-box experience
      const { rowCount } = await this.db.query(`SELECT 1 FROM delivery_partners LIMIT 1`);
      if (rowCount === 0) {
        const { rows: userRows } = await this.db.query(
          `SELECT id FROM users WHERE email = 'courier@nexus.local'`,
        );
        let courierUserId = userRows[0]?.id;
        if (!courierUserId) {
          const { rows: newUserRows } = await this.db.query(`
            INSERT INTO users (name, email, password_hash, role)
            VALUES ('Rajesh Kumar (Express Fleet)', 'courier@nexus.local', '$2b$10$wE9l1o9e.Kj6i9Q5oZ4HXe2qY2dD9q1zE0sX.5kL4lJ2m8n7p6q0O', '${UserRoles.DELIVERY_PARTNER}')
            RETURNING id
          `);
          courierUserId = newUserRows[0]?.id;
        }

        if (courierUserId) {
          const sampleDocs = [
            {
              id: 'doc-dl-01',
              type: 'DRIVING_LICENSE',
              name: 'Commercial_Driver_License_DL99482.pdf',
              url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=800&q=80',
              fileSize: '1.8 MB',
              status: 'VERIFIED',
              uploadedAt: new Date().toISOString(),
            },
            {
              id: 'doc-rc-01',
              type: 'VEHICLE_RC',
              name: 'Vehicle_Registration_Certificate_E-Van.pdf',
              url: 'https://images.unsplash.com/photo-1580273916550-e323be2ae537?auto=format&fit=crop&w=800&q=80',
              fileSize: '2.1 MB',
              status: 'VERIFIED',
              uploadedAt: new Date().toISOString(),
            },
            {
              id: 'doc-id-01',
              type: 'GOVT_ID',
              name: 'National_Identity_Passport.pdf',
              url: 'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=800&q=80',
              fileSize: '950 KB',
              status: 'VERIFIED',
              uploadedAt: new Date().toISOString(),
            },
            {
              id: 'doc-ins-01',
              type: 'TRANSIT_INSURANCE',
              name: 'Goods_Transit_Commercial_Insurance_Policy.pdf',
              url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=800&q=80',
              fileSize: '1.4 MB',
              status: 'VERIFIED',
              uploadedAt: new Date().toISOString(),
            },
          ];

          await this.db.query(`
            INSERT INTO delivery_partners (
              user_id, full_name, phone, vehicle_type, vehicle_plate_number,
              country, region_state, city, service_postal_codes,
              verification_status, documents, rating, completed_trips, approved_at
            ) VALUES (
              $1, 'Rajesh Kumar', '+1 (555) 392-8819', 'E-Cargo Van', 'DL-04-NX-2026',
              'United States', 'California', 'San Francisco', '94102, 94103, 94107, 94110',
              '${DeliveryPartnerVerificationStatuses.APPROVED}', $2, 4.95, 1280, NOW()
            )
            ON CONFLICT (user_id) DO NOTHING
          `, [courierUserId, JSON.stringify(sampleDocs)]);
        }
      }
    } catch (err) {
      console.warn('Could not auto-run delivery partner schema migrations:', err);
    }

    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
    }
  }

  /**
   * Fetch current delivery partner profile
   */
  async getMe(actor: Actor): Promise<DeliveryPartnerRow> {
    // If Admin/Subadmin is previewing the driver portal, return preview profile without creating a DB entry
    if (actor.role === UserRoles.ADMIN || actor.role === UserRoles.SUBADMIN) {
      const { rows: demoRows } = await this.db.query(
        `SELECT dp.*, u.email, u.name as user_name
         FROM delivery_partners dp
         JOIN users u ON u.id = dp.user_id
         WHERE u.role = '${UserRoles.DELIVERY_PARTNER}'
         ORDER BY dp.created_at ASC LIMIT 1`,
      );
      if (demoRows[0]) return demoRows[0] as DeliveryPartnerRow;

      return {
        id: '00000000-0000-0000-0000-000000000000',
        user_id: actor.userId,
        full_name: 'Nexus Courier Fleet (Admin Preview)',
        phone: '+1 (555) 019-8800',
        vehicle_type: 'Cargo Van',
        vehicle_plate_number: 'NX-FLEET-01',
        country: 'United States',
        region_state: 'California',
        city: 'San Francisco',
        service_postal_codes: '94102, 94103, 94107',
        verification_status: DeliveryPartnerVerificationStatuses.APPROVED,
        rejection_reason: null,
        documents: [],
        is_available: true,
        rating: 5.0,
        completed_trips: 100,
        approved_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
        email: actor.email,
        user_name: actor.email,
      } as any;
    }

    const { rows } = await this.db.query(
      `SELECT dp.*, u.email, u.name as user_name
       FROM delivery_partners dp
       JOIN users u ON u.id = dp.user_id
       WHERE dp.user_id = $1`,
      [actor.userId],
    );

    if (rows[0]) return rows[0] as DeliveryPartnerRow;

    // If partner row wasn't created yet for a delivery partner user, auto-provision from user profile
    const { rows: userRows } = await this.db.query(
      `SELECT name, email, phone FROM users WHERE id = $1`,
      [actor.userId],
    );
    const user = userRows[0];

    const { rows: newRows } = await this.db.query(
      `INSERT INTO delivery_partners (
         user_id, full_name, phone, vehicle_type, vehicle_plate_number,
         country, region_state, city, verification_status
       ) VALUES ($1, $2, $3, 'CARGO_VAN', '', 'United States', 'California', 'San Francisco', '${DeliveryPartnerVerificationStatuses.PENDING_SUBMISSION}')
       RETURNING *`,
      [
        actor.userId,
        user?.name || actor.email.split('@')[0] || 'Delivery Partner',
        user?.phone || '+1 (555) 0199',
      ],
    );
    return newRows[0] as DeliveryPartnerRow;
  }

  /**
   * Upload / append KYC document for current partner
   */
  async uploadDocument(actor: Actor, dto: UploadDocumentDto): Promise<DeliveryPartnerRow> {
    const partner = await this.getMe(actor);

    let docUrl = dto.url;
    // If client uploaded a data URL (e.g. from local file picker), upload to Cloudinary for CDN delivery
    if (docUrl && docUrl.startsWith('data:')) {
      try {
        const uploadRes = await cloudinary.uploader.upload(docUrl, {
          folder: 'nexus/delivery_partners',
          resource_type: 'auto',
        });
        if (uploadRes && uploadRes.secure_url) {
          docUrl = uploadRes.secure_url;
        }
      } catch (cloudErr) {
        console.warn('Cloudinary upload fallback to data URL:', cloudErr);
      }
    }

    const newDoc = {
      id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: dto.type,
      name: dto.name,
      url: docUrl,
      fileSize: dto.fileSize || '1.2 MB',
      status: 'PENDING',
      uploadedAt: new Date().toISOString(),
    };

    // Safely parse existing documents
    let docsList: any[] = [];
    if (Array.isArray(partner.documents)) {
      docsList = partner.documents;
    } else if (typeof partner.documents === 'string') {
      try {
        const parsed = JSON.parse(partner.documents);
        docsList = Array.isArray(parsed) ? parsed : [];
      } catch {
        docsList = [];
      }
    }

    // Filter out existing document of same type if re-uploading
    const existingDocs = docsList.filter((d: any) => d && d.type !== dto.type);
    const updatedDocs = [...existingDocs, newDoc];

    // Calculate updated partner status based on all document states
    const { status: newStatus, rejectionReason } = this.calculatePartnerStatus(
      updatedDocs,
      partner.verification_status,
    );

    const { rows } = await this.db.query(
      `UPDATE delivery_partners
       SET documents = $1::jsonb,
           verification_status = $2,
           rejection_reason = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [JSON.stringify(updatedDocs), newStatus, rejectionReason, partner.id],
    );

    try {
      await this.db.query(
        `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata)
         VALUES ($1, 'DELIVERY_PARTNER_DOCUMENT_UPLOADED', 'delivery_partners', $2, $3)`,
        [actor.userId, partner.id, JSON.stringify({ type: dto.type, docId: newDoc.id })],
      );
    } catch (auditErr) {
      console.warn('Audit log write failed for document upload:', auditErr);
    }

    const updatedPartner = rows[0] as DeliveryPartnerRow;
    this.ordersGateway?.broadcastDeliveryPartnerUpdated(updatedPartner);
    return updatedPartner;
  }

  /**
   * Update partner profile / service area details
   */
  async updateProfile(actor: Actor, payload: {
    fullName?: string;
    phone?: string;
    vehicleType?: string;
    vehiclePlateNumber?: string;
    country?: string;
    regionState?: string;
    city?: string;
    servicePostalCodes?: string;
  }): Promise<DeliveryPartnerRow> {
    const partner = await this.getMe(actor);

    const { rows } = await this.db.query(
      `UPDATE delivery_partners
       SET full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone),
           vehicle_type = COALESCE($3, vehicle_type),
           vehicle_plate_number = COALESCE($4, vehicle_plate_number),
           country = COALESCE($5, country),
           region_state = COALESCE($6, region_state),
           city = COALESCE($7, city),
           service_postal_codes = COALESCE($8, service_postal_codes),
           updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        payload.fullName || null,
        payload.phone || null,
        payload.vehicleType || null,
        payload.vehiclePlateNumber || null,
        payload.country || null,
        payload.regionState || null,
        payload.city || null,
        payload.servicePostalCodes || null,
        partner.id,
      ],
    );
    const updatedProfile = rows[0] as DeliveryPartnerRow;
    this.ordersGateway?.broadcastDeliveryPartnerUpdated(updatedProfile);
    return updatedProfile;
  }

  /**
   * Admin: List delivery partners with filter & stats
   */
  async getAdminList(query: {
    status?: string;
    search?: string;
    city?: string;
    country?: string;
    page?: number;
    limit?: number;
  }): Promise<AdminPartnerListResult> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = [
      `u.role = '${UserRoles.DELIVERY_PARTNER}'`,
      `dp.verification_status != '${DeliveryPartnerVerificationStatuses.PENDING_SUBMISSION}'`,
      `(dp.documents IS NOT NULL AND jsonb_array_length(dp.documents) >= 4)`,
    ];
    const params: any[] = [];
    let idx = 1;

    if (query.status && query.status !== 'ALL') {
      conditions.push(`dp.verification_status = $${idx++}`);
      params.push(query.status);
    }
    if (query.city) {
      conditions.push(`LOWER(dp.city) = LOWER($${idx++})`);
      params.push(query.city);
    }
    if (query.country) {
      conditions.push(`LOWER(dp.country) = LOWER($${idx++})`);
      params.push(query.country);
    }
    if (query.search) {
      conditions.push(
        `(LOWER(dp.full_name) LIKE LOWER($${idx}) OR LOWER(u.email) LIKE LOWER($${idx}) OR LOWER(dp.vehicle_plate_number) LIKE LOWER($${idx}))`,
      );
      params.push(`%${query.search.trim()}%`);
      idx++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const listQuery = `
      SELECT dp.*, u.email, u.name as user_name
      FROM delivery_partners dp
      JOIN users u ON u.id = dp.user_id
      ${whereClause}
      ORDER BY dp.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    const countQuery = `
      SELECT COUNT(*)::int as total
      FROM delivery_partners dp
      JOIN users u ON u.id = dp.user_id
      ${whereClause}
    `;

    const [listRes, countRes, statsRes] = await Promise.all([
      this.db.query(listQuery, [...params, limit, offset]),
      this.db.query(countQuery, params),
      this.db.query(`
        SELECT
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE dp.verification_status = '${DeliveryPartnerVerificationStatuses.PENDING_APPROVAL}')::int as pending,
          COUNT(*) FILTER (WHERE dp.verification_status = '${DeliveryPartnerVerificationStatuses.APPROVED}')::int as approved,
          COUNT(*) FILTER (WHERE dp.verification_status = '${DeliveryPartnerVerificationStatuses.REJECTED}')::int as rejected
        FROM delivery_partners dp
        JOIN users u ON u.id = dp.user_id
        WHERE u.role = '${UserRoles.DELIVERY_PARTNER}'
          AND dp.verification_status != '${DeliveryPartnerVerificationStatuses.PENDING_SUBMISSION}'
          AND (dp.documents IS NOT NULL AND jsonb_array_length(dp.documents) >= 4)
      `),
    ]);

    return {
      partners: listRes.rows as DeliveryPartnerRow[],
      pagination: {
        total: countRes.rows[0]?.total ?? 0,
        page,
        limit,
        totalPages: Math.ceil((countRes.rows[0]?.total ?? 0) / limit),
      },
      stats: (statsRes.rows[0] as { total: number; pending: number; approved: number; rejected: number }) ?? {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
      },
    };
  }

  /**
   * Helper: Calculate partner verification status from documents array
   */
  calculatePartnerStatus(docs: any[], currentStatus?: string): {
    status: DeliveryPartnerVerificationStatuses;
    rejectionReason: string | null;
  } {
    if (!docs || docs.length < 4) {
      return {
        status: DeliveryPartnerVerificationStatuses.PENDING_SUBMISSION,
        rejectionReason: null,
      };
    }

    const rejectedDocs = docs.filter((d: any) => d && d.status === 'REJECTED');
    if (rejectedDocs.length > 0) {
      const reasons = rejectedDocs
        .map((d: any) => `${d.type}: ${d.rejectionReason || 'Requires re-upload'}`)
        .join('; ');
      return {
        status: DeliveryPartnerVerificationStatuses.REJECTED,
        rejectionReason: reasons,
      };
    }

    const allVerified = docs.every((d: any) => d && d.status === 'VERIFIED');
    if (allVerified || currentStatus === DeliveryPartnerVerificationStatuses.APPROVED) {
      return {
        status: DeliveryPartnerVerificationStatuses.APPROVED,
        rejectionReason: null,
      };
    }

    return {
      status: DeliveryPartnerVerificationStatuses.PENDING_APPROVAL,
      rejectionReason: null,
    };
  }

  /**
   * Admin: Approve or Reject a specific KYC compliance document
   */
  async verifyDocument(
    adminActor: Actor,
    partnerId: string,
    docId: string,
    dto: { status: 'VERIFIED' | 'REJECTED'; rejectionReason?: string },
  ): Promise<DeliveryPartnerRow> {
    const { rows } = await this.db.query(`SELECT * FROM delivery_partners WHERE id = $1`, [partnerId]);
    const partner = rows[0];
    if (!partner) throw new NotFoundException('Delivery partner applicant not found');

    let docsList: any[] = [];
    if (Array.isArray(partner.documents)) {
      docsList = partner.documents;
    } else if (typeof partner.documents === 'string') {
      try {
        const parsed = JSON.parse(partner.documents);
        docsList = Array.isArray(parsed) ? parsed : [];
      } catch {
        docsList = [];
      }
    }

    const docIndex = docsList.findIndex((d: any) => d && (d.id === docId || d.type === docId));
    if (docIndex === -1) {
      throw new NotFoundException(`Document with ID/Type '${docId}' not found for partner`);
    }

    const targetDoc = { ...docsList[docIndex] };
    targetDoc.status = dto.status;
    targetDoc.rejectionReason =
      dto.status === 'REJECTED'
        ? (dto.rejectionReason?.trim() || 'Document does not meet verification standards.')
        : null;
    targetDoc.reviewedAt = new Date().toISOString();
    targetDoc.reviewedBy = adminActor.userId;

    docsList[docIndex] = targetDoc;

    const { status: newPartnerStatus, rejectionReason } = this.calculatePartnerStatus(docsList, partner.verification_status);

    const approvedAt = newPartnerStatus === DeliveryPartnerVerificationStatuses.APPROVED ? new Date() : null;
    const approvedBy = newPartnerStatus === DeliveryPartnerVerificationStatuses.APPROVED ? adminActor.userId : null;

    const { rows: updatedRows } = await this.db.query(
      `UPDATE delivery_partners
       SET documents = $1::jsonb,
           verification_status = $2,
           rejection_reason = $3,
           approved_at = $4,
           approved_by = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [JSON.stringify(docsList), newPartnerStatus, rejectionReason, approvedAt, approvedBy, partnerId],
    );

    // Audit log
    try {
      await this.db.query(
        `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata)
         VALUES ($1, 'DELIVERY_PARTNER_DOCUMENT_VERIFIED', 'delivery_partners', $2, $3)`,
        [adminActor.userId, partnerId, JSON.stringify({ docId: targetDoc.id, docType: targetDoc.type, status: dto.status, rejectionReason: targetDoc.rejectionReason })],
      );
    } catch (auditErr) {
      console.warn('Audit log write failed for document verification:', auditErr);
    }

    // Notify delivery partner
    try {
      if (dto.status === 'REJECTED') {
        const docLabel = (targetDoc.name || targetDoc.type).replace(/_/g, ' ');
        await this.notifications.create(partner.user_id, {
          title: `⚠️ ${docLabel} Requires Attention`,
          message: `Your uploaded ${docLabel} was not approved: ${targetDoc.rejectionReason}. Please re-upload an updated copy.`,
          type: 'ORDER',
          metadata: { partnerId, docId: targetDoc.id, docType: targetDoc.type },
        });
      } else if (newPartnerStatus === DeliveryPartnerVerificationStatuses.APPROVED) {
        await this.notifications.create(partner.user_id, {
          title: '🎉 All KYC Documents Approved - Welcome to Active Fleet!',
          message: `All 4 verification credentials have been approved. You are now authorized to accept order dispatches.`,
          type: 'ORDER',
          metadata: { partnerId },
        });
      }
    } catch {
      // continue
    }

    const updatedVerifiedDoc = updatedRows[0] as DeliveryPartnerRow;
    this.ordersGateway?.broadcastDeliveryPartnerUpdated(updatedVerifiedDoc);
    return updatedVerifiedDoc;
  }

  /**
   * Admin: Approve or Reject a Delivery Partner application
   */
  async verifyPartner(adminActor: Actor, partnerId: string, dto: VerifyPartnerDto): Promise<DeliveryPartnerRow> {
    const { rows } = await this.db.query(`SELECT * FROM delivery_partners WHERE id = $1`, [partnerId]);
    const partner = rows[0];
    if (!partner) throw new NotFoundException('Delivery partner applicant not found');

    const docCount = Array.isArray(partner.documents) ? partner.documents.length : 0;
    if (
      docCount < 4 ||
      partner.verification_status === DeliveryPartnerVerificationStatuses.PENDING_SUBMISSION
    ) {
      throw new BadRequestException(
        'Cannot approve or reject an applicant who has not submitted all 4 required KYC compliance documents (CDL, Vehicle RC, Govt ID, Insurance) yet.',
      );
    }

    const isApproved = dto.status === DeliveryPartnerVerificationStatuses.APPROVED;
    const rejectionReason = isApproved
      ? null
      : (dto.rejectionReason?.trim() || 'Documents do not satisfy verification standards.');

    let docsList: any[] = [];
    if (Array.isArray(partner.documents)) {
      docsList = partner.documents;
    } else if (typeof partner.documents === 'string') {
      try {
        const parsed = JSON.parse(partner.documents);
        docsList = Array.isArray(parsed) ? parsed : [];
      } catch {
        docsList = [];
      }
    }

    // Sync per-document status
    if (isApproved) {
      docsList = docsList.map((d: any) => ({
        ...d,
        status: 'VERIFIED',
        rejectionReason: null,
        reviewedAt: new Date().toISOString(),
        reviewedBy: adminActor.userId,
      }));
    } else {
      docsList = docsList.map((d: any) => ({
        ...d,
        status: d.status === 'VERIFIED' ? 'VERIFIED' : 'REJECTED',
        rejectionReason: d.status === 'VERIFIED' ? null : rejectionReason,
        reviewedAt: new Date().toISOString(),
        reviewedBy: adminActor.userId,
      }));
    }

    const approvedAt = isApproved ? new Date() : null;
    const approvedBy = isApproved ? adminActor.userId : null;

    const { rows: updatedRows } = await this.db.query(
      `UPDATE delivery_partners
       SET documents = $1::jsonb,
           verification_status = $2,
           rejection_reason = $3,
           approved_at = $4,
           approved_by = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [JSON.stringify(docsList), dto.status, rejectionReason, approvedAt, approvedBy, partnerId],
    );

    // Audit log
    try {
      await this.db.query(
        `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata)
         VALUES ($1, 'DELIVERY_PARTNER_VERIFIED', 'delivery_partners', $2, $3)`,
        [adminActor.userId, partnerId, JSON.stringify({ status: dto.status, rejectionReason })],
      );
    } catch (auditErr) {
      console.warn('Audit log write failed for partner verification:', auditErr);
    }

    // Notify the delivery partner user
    const title = isApproved
      ? '🎉 Delivery Partner Application Approved!'
      : '⚠️ Delivery Partner Verification Update Required';
    const message = isApproved
      ? `Congratulations! Your credentials have been verified by Nexus Admin. You are now authorized to accept and be assigned deliveries in ${partner.city}, ${partner.country}.`
      : `Your delivery partner application was not approved: ${rejectionReason}. Please update your credentials.`;

    try {
      await this.notifications.create(partner.user_id, {
        title,
        message,
        type: 'ORDER',
        metadata: { partnerId, status: dto.status, rejectionReason },
      });
    } catch {
      // continue
    }

    const updatedVerifiedPartner = updatedRows[0] as DeliveryPartnerRow;
    this.ordersGateway?.broadcastDeliveryPartnerUpdated(updatedVerifiedPartner);
    return updatedVerifiedPartner;
  }

  /**
   * Fetch approved delivery partners eligible for a given order's geographic destination/area
   */
  async getEligiblePartnersForOrder(orderId: string, locationFilter?: { city?: string; region?: string; country?: string }): Promise<EligiblePartnersResult> {
    const { rows: ordRows } = await this.db.query(
      `SELECT id, destination_city, destination_region, destination_country FROM orders WHERE id = $1`,
      [orderId],
    );
    const order = ordRows[0];
    if (!order) throw new NotFoundException('Order not found');

    const destCity = locationFilter?.city || order.destination_city || 'San Francisco';
    const destRegion = locationFilter?.region || order.destination_region || 'California';
    const destCountry = locationFilter?.country || order.destination_country || 'United States';

    // Strict security rule: ONLY APPROVED PARTNERS!
    // Priority: Exact City match > Region match > Country match
    const { rows: partners } = await this.db.query(
      `SELECT id, full_name, phone, vehicle_type, vehicle_plate_number,
              city, region_state, country, rating, completed_trips, is_available,
              CASE
                WHEN LOWER(city) = LOWER($1) THEN 1
                WHEN LOWER(region_state) = LOWER($2) THEN 2
                WHEN LOWER(country) = LOWER($3) THEN 3
                ELSE 4
              END as match_priority
       FROM delivery_partners
       WHERE verification_status = '${DeliveryPartnerVerificationStatuses.APPROVED}'
         AND is_available = true
         AND (
           LOWER(city) = LOWER($1)
           OR LOWER(region_state) = LOWER($2)
           OR LOWER(country) = LOWER($3)
         )
       ORDER BY match_priority ASC, rating DESC, completed_trips DESC
       LIMIT 20`,
      [destCity, destRegion, destCountry],
    );

    return {
      orderId,
      destinationArea: {
        city: destCity,
        region: destRegion,
        country: destCountry,
      },
      eligiblePartners: partners,
    };
  }

  /**
   * Assign an order to an approved Delivery Partner
   */
  async assignOrderToPartner(actor: Actor, orderId: string, dto: AssignOrderDto): Promise<Record<string, unknown>> {
    // 1. Fetch order
    const { rows: ordRows } = await this.db.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
    const order = ordRows[0];
    if (!order) throw new NotFoundException('Order not found');

    // 2. Fetch delivery partner and verify strictly
    const { rows: partnerRows } = await this.db.query(
      `SELECT * FROM delivery_partners WHERE id = $1`,
      [dto.deliveryPartnerId],
    );
    const partner = partnerRows[0];
    if (!partner) throw new NotFoundException('Delivery partner not found');

    if (partner.verification_status !== DeliveryPartnerVerificationStatuses.APPROVED) {
      throw new BadRequestException(
        `Cannot assign order: Delivery partner ${partner.full_name} is in ${partner.verification_status} status. Only Admin-Approved partners can be assigned.`,
      );
    }

    const carrierName = `Nexus Fleet (${partner.full_name})`;
    const trackingNumber = `NX-DP-${partner.vehicle_plate_number.replace(/[^A-Za-z0-9]/g, '') || partner.id.slice(0, 6).toUpperCase()}-${order.id.slice(0, 6).toUpperCase()}`;

    const newEvent = {
      status: OrderStatuses.OUT_FOR_DELIVERY,
      location: `${partner.city}, ${partner.country}`,
      description: dto.assignmentNote || `Assigned to verified local delivery partner ${partner.full_name} (${partner.vehicle_type} • ${partner.vehicle_plate_number})`,
      timestamp: new Date().toISOString(),
    };

    // Update order with partner assignment
    const { rows: updatedRows } = await this.db.query(
      `UPDATE orders
       SET delivery_partner_id = $1,
           carrier = $2,
           tracking_number = $3,
           status = CASE WHEN status = '${OrderStatuses.PENDING}' THEN '${OrderStatuses.PROCESSING}' ELSE status END,
           tracking_events = COALESCE(tracking_events, '[]'::jsonb) || $4::jsonb,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [partner.id, carrierName, trackingNumber, JSON.stringify([newEvent]), orderId],
    );

    // Audit log
    try {
      await this.db.query(
        `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata)
         VALUES ($1, 'ORDER_ASSIGNED_TO_DELIVERY_PARTNER', 'orders', $2, $3)`,
        [actor.userId, orderId, JSON.stringify({ partnerId: partner.id, partnerName: partner.full_name })],
      );
    } catch (auditErr) {
      console.warn('Audit log write failed for order assignment:', auditErr);
    }

    // Notify delivery partner
    try {
      await this.notifications.create(partner.user_id, {
        title: '📦 New Delivery Dispatch Assigned',
        message: `Order #NX-${orderId.slice(0, 8).toUpperCase()} in ${order.destination_city || partner.city} has been assigned to you.`,
        type: 'ORDER',
        metadata: { orderId, partnerId: partner.id },
      });
    } catch {
      // continue
    }

    // Notify customer
    try {
      await this.notifications.create(order.customer_id, {
        title: '🚚 Courier Dispatched for Delivery',
        message: `Delivery partner ${partner.full_name} (${partner.vehicle_type} • ${partner.vehicle_plate_number}) has been dispatched for Order #NX-${orderId.slice(0, 8).toUpperCase()}.`,
        type: 'ORDER',
        metadata: { orderId, partnerId: partner.id, trackingNumber },
      });
    } catch {
      // continue
    }

    // Broadcast real-time dispatch and status update
    try {
      const suppUserIds = await this.getOrderSupplierUserIds(orderId);
      const dispatchPayload = {
        orderId,
        partnerId: partner.id,
        partnerName: partner.full_name,
        vehicleType: partner.vehicle_type,
        vehiclePlateNumber: partner.vehicle_plate_number,
        trackingNumber,
        destinationAddress: order.destination_address,
        destinationCity: order.destination_city,
        dispatchedAt: new Date().toISOString(),
      };
      this.ordersGateway?.broadcastDriverDispatched(orderId, order.customer_id, suppUserIds, dispatchPayload);
      this.ordersGateway?.broadcastOrderStatusUpdated(orderId, order.customer_id, suppUserIds, {
        orderId,
        previousStatus: order.status,
        newStatus: OrderStatuses.OUT_FOR_DELIVERY,
        carrier: carrierName,
        trackingNumber,
        checkpointLocation: `${partner.city}, ${partner.country}`,
        checkpointNote: newEvent.description,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Non-blocking
    }

    return updatedRows[0] as Record<string, unknown>;
  }

  /**
   * Delivery Partner: Fetch assigned tasks / active deliveries
   */
  async getMyTasks(actor: Actor): Promise<MyTasksResult> {
    const partner = await this.getMe(actor);

    if (partner.verification_status !== DeliveryPartnerVerificationStatuses.APPROVED) {
      return {
        partnerStatus: partner.verification_status,
        rejectionReason: partner.rejection_reason,
        isApproved: false,
        message: 'Your account is under admin review. Once verified, assigned orders will appear here.',
        tasks: [],
      };
    }

    const { rows: tasks } = await this.db.query(
      `SELECT o.id, o.status, o.total_amount, o.carrier, o.tracking_number,
              o.destination_address, o.destination_city, o.destination_region, o.destination_country,
              o.created_at, o.delivery_qr_token,
              u.name as customer_name, u.email as customer_email,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', oi.id,
                    'quantity', oi.quantity,
                    'unit_price', oi.unit_price,
                    'status', oi.status,
                    'product_title', p.title,
                    'product_image', COALESCE(p.images->0->>'url', '')
                  )
                ) FILTER (WHERE oi.id IS NOT NULL),
                '[]'
              ) as items
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.delivery_partner_id = $1
       GROUP BY o.id, u.name, u.email
       ORDER BY
         CASE
           WHEN o.status = '${OrderStatuses.OUT_FOR_DELIVERY}' THEN 1
           WHEN o.status = '${OrderStatuses.SHIPPED}' THEN 2
           WHEN o.status = '${OrderStatuses.PROCESSING}' THEN 3
           ELSE 4
         END ASC,
         o.created_at DESC`,
      [partner.id],
    );

    return {
      partnerStatus: partner.verification_status,
      isApproved: true,
      partnerProfile: {
        id: partner.id,
        fullName: partner.full_name,
        phone: partner.phone,
        vehicleType: partner.vehicle_type,
        vehiclePlate: partner.vehicle_plate_number,
        rating: partner.rating,
        completedTrips: partner.completed_trips,
      },
      tasks,
    };
  }

  /**
   * Delivery Partner: Update assigned task status (Accept run, Start run, Confirm delivery)
   */
  async updateTaskStatus(actor: Actor, orderId: string, dto: UpdateTaskStatusDto): Promise<Record<string, unknown>> {
    const partner = await this.getMe(actor);

    if (partner.verification_status !== DeliveryPartnerVerificationStatuses.APPROVED) {
      throw new ForbiddenException('Only approved delivery partners can execute delivery tasks.');
    }

    const { rows: ordRows } = await this.db.query(
      `SELECT * FROM orders WHERE id = $1 AND delivery_partner_id = $2`,
      [orderId, partner.id],
    );
    const order = ordRows[0];
    if (!order) throw new NotFoundException('Order not assigned to your partner account');

    const checkpointLocation = dto.checkpointLocation || `${partner.city}, ${partner.country}`;
    const checkpointNote =
      dto.checkpointNote ||
      (dto.status === OrderStatuses.OUT_FOR_DELIVERY
        ? `Delivery Partner ${partner.full_name} is en route with your package`
        : `Package safely delivered by ${partner.full_name}. ${dto.proofNote || ''}`);

    const newEvent = {
      status: dto.status,
      location: checkpointLocation,
      description: checkpointNote,
      timestamp: new Date().toISOString(),
    };

    let deliveredClause = '';
    if (dto.status === OrderStatuses.DELIVERED) {
      deliveredClause = `, delivered_at = NOW(), inspection_started_at = NOW(), inspection_expires_at = NOW() + INTERVAL '72 hours', inspection_status = 'ACTIVE_COUNTDOWN'`;
    }

    const { rows: updatedRows } = await this.db.query(
      `UPDATE orders
       SET status = $1,
           tracking_events = COALESCE(tracking_events, '[]'::jsonb) || $2::jsonb
           ${deliveredClause},
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [dto.status, JSON.stringify([newEvent]), orderId],
    );

    // If delivered, increment partner completed trips
    if (dto.status === OrderStatuses.DELIVERED) {
      await this.db.query(
        `UPDATE delivery_partners SET completed_trips = completed_trips + 1 WHERE id = $1`,
        [partner.id],
      );
    }

    // Audit log
    try {
      await this.db.query(
        `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata)
         VALUES ($1, 'DELIVERY_PARTNER_TASK_UPDATED', 'orders', $2, $3)`,
        [actor.userId, orderId, JSON.stringify({ status: dto.status, note: checkpointNote })],
      );
    } catch (auditErr) {
      console.warn('Audit log write failed for task status update:', auditErr);
    }

    // Broadcast real-time order status update
    try {
      const suppUserIds = await this.getOrderSupplierUserIds(orderId);
      this.ordersGateway?.broadcastOrderStatusUpdated(orderId, order.customer_id, suppUserIds, {
        orderId,
        previousStatus: order.status,
        newStatus: dto.status,
        checkpointLocation,
        checkpointNote,
        updatedAt: new Date().toISOString(),
      });

      if (dto.status === OrderStatuses.OUT_FOR_DELIVERY) {
        const dispatchPayload = {
          orderId,
          partnerId: partner.id,
          partnerName: partner.full_name,
          vehicleType: partner.vehicle_type,
          vehiclePlateNumber: partner.vehicle_plate_number,
          trackingNumber: order.tracking_number,
          destinationAddress: order.destination_address,
          destinationCity: order.destination_city,
          dispatchedAt: new Date().toISOString(),
        };
        this.ordersGateway?.broadcastDriverDispatched(orderId, order.customer_id, suppUserIds, dispatchPayload);

        void this.notifications.create(order.customer_id, {
          title: '🚚 Courier En Route to Delivery Dock',
          message: `Delivery partner ${partner.full_name} has departed and is en route with Order #NX-${orderId.slice(0, 8).toUpperCase()}.`,
          type: 'ORDER',
          metadata: { orderId, partnerId: partner.id },
        });
      }
    } catch {
      // Non-blocking
    }

    return updatedRows[0] as Record<string, unknown>;
  }

  /**
   * Helper: Get distinct supplier user IDs for an order
   */
  private async getOrderSupplierUserIds(orderId: string): Promise<string[]> {
    try {
      const res = await this.db.query(
        `SELECT DISTINCT s.user_id 
         FROM order_items oi 
         JOIN suppliers s ON s.id = oi.supplier_id 
         WHERE oi.order_id = $1 AND s.user_id IS NOT NULL`,
        [orderId],
      );
      return res.rows.map((r: any) => r.user_id);
    } catch {
      return [];
    }
  }

  /**
   * Helper: Calculate Haversine distance in meters between two coordinates
   */
  private calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Delivery Partner: Send real-time GPS location beacon ping with proximity radar tracking (<500m to dock)
   */
  async updateDriverLocationPing(actor: Actor, dto: LocationPingDto): Promise<Record<string, unknown>> {
    const partner = await this.getMe(actor);

    await this.db.query(
      `UPDATE delivery_partners
       SET current_latitude = $1, current_longitude = $2, last_location_ping_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [dto.latitude, dto.longitude, partner.id],
    );

    let customerId = '';
    let targetOrder: any = null;

    if (dto.orderId) {
      const { rows: ordRows } = await this.db.query(
        `UPDATE orders
         SET driver_latitude = $1,
             driver_longitude = $2,
             driver_heading = $3,
             driver_speed = $4,
             driver_last_ping_at = NOW()
         WHERE id = $5 AND delivery_partner_id = $6
         RETURNING id, customer_id, status, destination_address, destination_city,
                   destination_latitude, destination_longitude, delivery_qr_token, arrival_alert_sent_at`,
        [dto.latitude, dto.longitude, dto.heading || 0, dto.speed || 0, dto.orderId, partner.id],
      );
      if (ordRows[0]) {
        targetOrder = ordRows[0];
        customerId = targetOrder.customer_id;
      }
    } else {
      // Find active out-for-delivery order if orderId wasn't passed directly in ping
      const { rows: activeOrdRows } = await this.db.query(
        `SELECT id, customer_id, status, destination_address, destination_city,
                destination_latitude, destination_longitude, delivery_qr_token, arrival_alert_sent_at
         FROM orders
         WHERE delivery_partner_id = $1 AND status = '${OrderStatuses.OUT_FOR_DELIVERY}'
         ORDER BY updated_at DESC LIMIT 1`,
        [partner.id],
      );
      if (activeOrdRows[0]) {
        targetOrder = activeOrdRows[0];
        customerId = targetOrder.customer_id;
      }
    }

    // Proximity Radar Check: Trigger dock arrival alert if courier is within 500m
    if (targetOrder && targetOrder.status === OrderStatuses.OUT_FOR_DELIVERY) {
      // Default to San Francisco Nexus Hub (37.7749, -122.4194) if destination coords are unset
      const destLat = targetOrder.destination_latitude ? Number(targetOrder.destination_latitude) : 37.7749;
      const destLng = targetOrder.destination_longitude ? Number(targetOrder.destination_longitude) : -122.4194;
      const distMeters = this.calculateDistanceMeters(Number(dto.latitude), Number(dto.longitude), destLat, destLng);

      // If courier is within 500m of dock and alert has not been triggered yet
      if (distMeters <= 500 && !targetOrder.arrival_alert_sent_at) {
        await this.db.query(
          `UPDATE orders SET arrival_alert_sent_at = NOW() WHERE id = $1`,
          [targetOrder.id],
        );

        const approachingPayload = {
          orderId: targetOrder.id,
          partnerId: partner.id,
          partnerName: partner.full_name,
          vehicleType: partner.vehicle_type,
          vehiclePlateNumber: partner.vehicle_plate_number,
          distanceMeters: Math.round(distMeters),
          estimatedArrivalMinutes: Math.max(1, Math.round(distMeters / 250)),
          destinationAddress: targetOrder.destination_address || '100 Nexus Distribution Way, Dock 4',
          destinationCity: targetOrder.destination_city || 'San Francisco',
          deliveryQrToken: targetOrder.delivery_qr_token,
          arrivedAt: new Date().toISOString(),
        };

        this.ordersGateway?.broadcastDriverApproachingDock(targetOrder.id, customerId, approachingPayload);

        // Send in-app notification to buyer
        void this.notifications.create(customerId, {
          title: '🚨 Courier Approaching Receiving Dock',
          message: `${partner.full_name} (${partner.vehicle_type} • ${partner.vehicle_plate_number}) is within ${Math.round(distMeters)}m of the delivery dock. Please prepare your delivery QR code for electronic handover.`,
          type: 'ORDER',
          metadata: {
            orderId: targetOrder.id,
            distanceMeters: Math.round(distMeters),
            qrToken: targetOrder.delivery_qr_token,
          },
        });
      }
    }

    const payload = {
      orderId: dto.orderId || targetOrder?.id || '',
      partnerId: partner.id,
      partnerName: partner.full_name,
      vehicleType: partner.vehicle_type,
      latitude: Number(dto.latitude),
      longitude: Number(dto.longitude),
      heading: Number(dto.heading || 0),
      speed: Number(dto.speed || 0),
      updatedAt: new Date().toISOString(),
    };

    this.ordersGateway?.broadcastDriverLocation(dto.orderId || targetOrder?.id || '', customerId, payload);

    return { success: true, payload };
  }

  /**
   * Delivery Partner: Submit Proof of Delivery (POD) with signature, photo, recipient & notes
   */
  async submitProofOfDelivery(
    actor: Actor,
    orderId: string,
    dto: SubmitProofOfDeliveryDto,
  ): Promise<Record<string, unknown>> {
    const partner = await this.getMe(actor);

    if (partner.verification_status !== DeliveryPartnerVerificationStatuses.APPROVED) {
      throw new ForbiddenException('Only approved delivery partners can complete deliveries.');
    }

    const { rows: ordRows } = await this.db.query(
      `SELECT * FROM orders WHERE id = $1 AND delivery_partner_id = $2`,
      [orderId, partner.id],
    );
    const order = ordRows[0];
    if (!order) throw new NotFoundException('Order not assigned to your partner account');

    const recipientName = dto.recipientName || order.recipient_name || 'Designated Receiving Officer';
    const podNote = dto.notes || `Signed and accepted by ${recipientName}. Physical package inspection handed over safely.`;
    const checkpointLocation = `${partner.city}, ${partner.country}`;

    const newEvent = {
      id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).substring(2),
      status: OrderStatuses.DELIVERED,
      location: checkpointLocation,
      description: `📦 Proof of Delivery (POD) Confirmed: Signed by ${recipientName}. ${podNote}`,
      timestamp: new Date().toISOString(),
      metadata: {
        hasSignature: Boolean(dto.signatureDataUrl),
        hasPhoto: Boolean(dto.photoUrl),
        recipientName,
        partnerName: partner.full_name,
        completedAt: new Date().toISOString(),
      },
    };

    const { rows: updatedRows } = await this.db.query(
      `UPDATE orders
       SET status = '${OrderStatuses.DELIVERED}',
           delivered_at = NOW(),
           inspection_started_at = NOW(),
           inspection_expires_at = NOW() + INTERVAL '72 hours',
           inspection_status = 'ACTIVE_COUNTDOWN',
           proof_of_delivery_signature = $1,
           proof_of_delivery_photo = $2,
           proof_of_delivery_notes = $3,
           pod_recipient_name = $4,
           pod_completed_at = NOW(),
           driver_latitude = COALESCE($5, driver_latitude),
           driver_longitude = COALESCE($6, driver_longitude),
           tracking_events = COALESCE(tracking_events, '[]'::jsonb) || $7::jsonb,
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        dto.signatureDataUrl || null,
        dto.photoUrl || null,
        podNote,
        recipientName,
        dto.latitude || null,
        dto.longitude || null,
        JSON.stringify([newEvent]),
        orderId,
      ],
    );

    // Increment partner completed trips
    await this.db.query(
      `UPDATE delivery_partners SET completed_trips = completed_trips + 1, updated_at = NOW() WHERE id = $1`,
      [partner.id],
    );

    const updatedOrder = updatedRows[0];

    // Broadcast WebSocket events
    const suppUserIds = await this.getOrderSupplierUserIds(orderId);
    this.ordersGateway?.broadcastOrderStatusUpdated(orderId, order.customer_id, suppUserIds, {
      orderId,
      previousStatus: order.status,
      newStatus: OrderStatuses.DELIVERED,
      checkpointLocation,
      checkpointNote: `Proof of Delivery confirmed by ${partner.full_name}`,
      updatedAt: new Date().toISOString(),
    });

    this.ordersGateway?.broadcastProofOfDelivery(orderId, order.customer_id, suppUserIds, {
      orderId,
      recipientName,
      hasSignature: Boolean(dto.signatureDataUrl),
      hasPhoto: Boolean(dto.photoUrl),
      notes: podNote,
      completedAt: new Date().toISOString(),
      deliveredAt: updatedOrder.delivered_at,
      inspectionExpiresAt: updatedOrder.inspection_expires_at,
    });

    // In-app notifications for Customer and Admin
    const shortId = orderId.substring(0, 8).toUpperCase();
    void this.notifications?.create(order.customer_id, {
      title: 'Package Delivered & Signed (POD)',
      message: `Order #NX-${shortId} has arrived! Signed by ${recipientName}. 72-Hour Inspection Window is now active.`,
      type: 'ORDER',
      linkUrl: '/orders',
      metadata: { orderId, podCompletedAt: new Date().toISOString() },
    }).catch(() => {});

    return updatedOrder as Record<string, unknown>;
  }

  /**
   * Delivery Partner: Fetch unassigned orders available in the partner's service area
   */
  async getAvailableOrdersForPartner(actor: Actor): Promise<{
    partnerStatus: string;
    isApproved: boolean;
    serviceArea: {
      city: string;
      region: string;
      country: string;
      postalCodes: string;
    };
    availableOrders: Array<Record<string, unknown>>;
  }> {
    const partner = await this.getMe(actor);

    if (partner.verification_status !== DeliveryPartnerVerificationStatuses.APPROVED) {
      return {
        partnerStatus: partner.verification_status,
        isApproved: false,
        serviceArea: {
          city: partner.city,
          region: partner.region_state,
          country: partner.country,
          postalCodes: partner.service_postal_codes || '',
        },
        availableOrders: [],
      };
    }

    const { rows: orders } = await this.db.query(
      `SELECT o.id, o.status, o.total_amount, o.created_at,
              o.destination_address, o.destination_city, o.destination_region,
              o.destination_country, o.destination_postal_code,
              o.recipient_name, o.recipient_phone,
              u.name as customer_name, u.email as customer_email,
              CASE
                WHEN LOWER(TRIM(COALESCE(o.destination_city, ''))) = LOWER(TRIM($1)) THEN 'EXACT_CITY'
                WHEN LOWER(TRIM(COALESCE(o.destination_region, ''))) = LOWER(TRIM($2)) THEN 'REGION_MATCH'
                WHEN LOWER(TRIM(COALESCE(o.destination_country, ''))) = LOWER(TRIM($3)) THEN 'COUNTRY_MATCH'
                ELSE 'ZONE_PROXIMITY'
              END as match_type,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', oi.id,
                    'quantity', oi.quantity,
                    'unit_price', oi.unit_price,
                    'status', oi.status,
                    'product_title', p.title,
                    'product_image', COALESCE(p.images->0->>'url', '')
                  )
                ) FILTER (WHERE oi.id IS NOT NULL),
                '[]'
              ) as items
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.delivery_partner_id IS NULL
         AND o.status NOT IN ('${OrderStatuses.CANCELLED}', '${OrderStatuses.DELIVERED}')
         AND (
           LOWER(TRIM(COALESCE(o.destination_city, ''))) = LOWER(TRIM($1))
           OR LOWER(TRIM(COALESCE(o.destination_region, ''))) = LOWER(TRIM($2))
           OR LOWER(TRIM(COALESCE(o.destination_country, ''))) = LOWER(TRIM($3))
         )
       GROUP BY o.id, u.name, u.email
       ORDER BY
         CASE
           WHEN LOWER(TRIM(COALESCE(o.destination_city, ''))) = LOWER(TRIM($1)) THEN 1
           WHEN LOWER(TRIM(COALESCE(o.destination_region, ''))) = LOWER(TRIM($2)) THEN 2
           ELSE 3
         END ASC,
         o.created_at DESC
       LIMIT 30`,
      [partner.city, partner.region_state, partner.country],
    );

    return {
      partnerStatus: partner.verification_status,
      isApproved: true,
      serviceArea: {
        city: partner.city,
        region: partner.region_state,
        country: partner.country,
        postalCodes: partner.service_postal_codes || '',
      },
      availableOrders: orders,
    };
  }

  /**
   * Delivery Partner: Accept / claim an available unassigned order in their service territory
   */
  async acceptAvailableOrder(actor: Actor, orderId: string): Promise<Record<string, unknown>> {
    const partner = await this.getMe(actor);

    if (partner.verification_status !== DeliveryPartnerVerificationStatuses.APPROVED) {
      throw new ForbiddenException('Only Admin-Approved delivery partners can accept delivery dispatches.');
    }

    const { rows: ordRows } = await this.db.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
    const order = ordRows[0];
    if (!order) throw new NotFoundException('Order not found');

    if (order.delivery_partner_id) {
      if (order.delivery_partner_id === partner.id) {
        return order as Record<string, unknown>;
      }
      throw new BadRequestException('This delivery dispatch has already been claimed by another delivery partner.');
    }

    if (order.status === OrderStatuses.CANCELLED || order.status === OrderStatuses.DELIVERED) {
      throw new BadRequestException(`Cannot accept order in ${order.status} status.`);
    }

    const carrierName = `Nexus Fleet (${partner.full_name})`;
    const plateClean = (partner.vehicle_plate_number || '').replace(/[^A-Za-z0-9]/g, '');
    const trackingNumber = `NX-DP-${plateClean || partner.id.slice(0, 6).toUpperCase()}-${order.id.slice(0, 6).toUpperCase()}`;

    const newEvent = {
      status: OrderStatuses.OUT_FOR_DELIVERY,
      location: `${partner.city}, ${partner.country}`,
      description: `Delivery dispatch accepted by verified local partner ${partner.full_name} (${partner.vehicle_type} • ${partner.vehicle_plate_number})`,
      timestamp: new Date().toISOString(),
    };

    const { rows: updatedRows } = await this.db.query(
      `UPDATE orders
       SET delivery_partner_id = $1,
           carrier = $2,
           tracking_number = $3,
           status = '${OrderStatuses.OUT_FOR_DELIVERY}',
           tracking_events = COALESCE(tracking_events, '[]'::jsonb) || $4::jsonb,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [partner.id, carrierName, trackingNumber, JSON.stringify([newEvent]), orderId],
    );

    // Audit log
    try {
      await this.db.query(
        `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id, metadata)
         VALUES ($1, 'DELIVERY_PARTNER_CLAIMED_ORDER', 'orders', $2, $3)`,
        [actor.userId, orderId, JSON.stringify({ partnerId: partner.id, partnerName: partner.full_name })],
      );
    } catch (auditErr) {
      console.warn('Audit log write failed for order claim:', auditErr);
    }

    // Notify customer
    try {
      await this.notifications.create(order.customer_id, {
        title: '🚚 Your Order is Out for Delivery',
        message: `Delivery partner ${partner.full_name} (${partner.vehicle_type}) has accepted your order #NX-${orderId.slice(0, 8).toUpperCase()} and is en route.`,
        type: 'ORDER',
        metadata: { orderId, partnerId: partner.id, trackingNumber },
      });
    } catch {
      // continue
    }

    // Broadcast real-time dispatch and status update
    try {
      const suppUserIds = await this.getOrderSupplierUserIds(orderId);
      const dispatchPayload = {
        orderId,
        partnerId: partner.id,
        partnerName: partner.full_name,
        vehicleType: partner.vehicle_type,
        vehiclePlateNumber: partner.vehicle_plate_number,
        trackingNumber,
        destinationAddress: order.destination_address,
        destinationCity: order.destination_city,
        dispatchedAt: new Date().toISOString(),
      };
      this.ordersGateway?.broadcastDriverDispatched(orderId, order.customer_id, suppUserIds, dispatchPayload);
      this.ordersGateway?.broadcastOrderStatusUpdated(orderId, order.customer_id, suppUserIds, {
        orderId,
        previousStatus: order.status,
        newStatus: OrderStatuses.OUT_FOR_DELIVERY,
        carrier: carrierName,
        trackingNumber,
        checkpointLocation: `${partner.city}, ${partner.country}`,
        checkpointNote: newEvent.description,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Non-blocking
    }

    return updatedRows[0] as Record<string, unknown>;
  }
}
