import { OrderStatuses, ProductStatuses, UserRoles } from '@core/constants';
import { Actor } from '@core/interfaces';
import { mapProduct, mapReview, slugify } from '@core/utils';
import { DatabaseService } from '@database/database.service';
import { CreateReviewDto, ListReviewsQueryDto, ModerateDto, StockDto, UpsertProductDto } from '@domain/products/dtos';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { CloudinaryService } from '@shared/cloudinary/cloudinary.service';
import { SemanticSearchService } from './semantic-search.service';

const PRODUCT_VIEW = `
  SELECT p.*, s.store_name, c.name AS category_name,
         COALESCE(r.avg_rating, 0)::float AS avg_rating,
         COALESCE(r.review_count, 0)::int AS review_count
  FROM products p
  JOIN suppliers s ON s.id = p.supplier_id
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN (
    SELECT product_id, ROUND(AVG(rating)::numeric, 1) AS avg_rating, COUNT(*)::int AS review_count
    FROM product_reviews
    GROUP BY product_id
  ) r ON r.product_id = p.id
`;

@Injectable()
export class ProductsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly cloudinary: CloudinaryService,
    private readonly semanticSearch: SemanticSearchService,
  ) {}

  async onModuleInit() {
    await this.ensureReviewsTable();
  }

  private async imagesFromUpload(file: Express.Multer.File | undefined, alt: string) {
    if (!file) return undefined;
    const url = await this.cloudinary.uploadProductImage(file);
    return [{ url, alt, isPrimary: true }];
  }

  async list(
    actor: Actor | undefined,
    query: {
      q?: string;
      categoryId?: string;
      supplierId?: string;
      minPrice?: string;
      maxPrice?: string;
      status?: string;
      page?: string;
      pageSize?: string;
    },
  ) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 12);
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (query.status) add('p.status = ?', query.status);
    if (query.categoryId) {
      params.push(query.categoryId);
      where.push(
        `p.category_id IN (
          WITH RECURSIVE tree AS (
            SELECT id FROM categories WHERE id = $${params.length}
            UNION ALL
            SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id
          ) SELECT id FROM tree
        )`,
      );
    }
    if (query.supplierId) add('p.supplier_id = ?', query.supplierId);
    if (query.minPrice) add('p.price >= ?', Number(query.minPrice));
    if (query.maxPrice) add('p.price <= ?', Number(query.maxPrice));
    let orderBy = 'ORDER BY p.created_at DESC';

    if (query.q) {
      const qLower = query.q.toLowerCase().trim();
      
      const qCleanNumeric = qLower.replace(/[\$,\s]/g, '');
      const parsedNum = parseFloat(qCleanNumeric);

      params.push(`%${qLower}%`);
      const textParamIdx = params.length;

      let priceCond = '1=0';
      if (!isNaN(parsedNum) && /^\d+(\.\d+)?$/.test(qCleanNumeric)) {
        params.push(parsedNum);
        const exactPriceIdx = params.length;

        const numPrefix = qCleanNumeric.replace(/\.00$/, '');
        params.push(`${numPrefix}%`);
        const prefixIdx = params.length;

        priceCond = `(p.price = $${exactPriceIdx} OR TRUNC(p.price) = TRUNC($${exactPriceIdx}::numeric) OR p.price::text LIKE $${prefixIdx})`;
      }

      const exactMatchCond = `(lower(p.title) LIKE $${textParamIdx} OR lower(p.description) LIKE $${textParamIdx} OR lower(s.store_name) LIKE $${textParamIdx} OR ${priceCond})`;

      // Attempt Semantic Search
      const semanticResults = await this.semanticSearch.searchProductsByQuery(qLower, 50);
      
      if (semanticResults.length > 0) {
        const ids = semanticResults.map(r => r.id);
        const placeholders = ids.map((_, i) => `$${params.length + i + 1}`).join(',');
        params.push(...ids);
        
        where.push(`(${exactMatchCond} OR p.id IN (${placeholders}))`);
        
        // Preserve semantic score ordering, but put exact matches first (array_position is NULL for non-semantic matches, so COALESCE to 0 makes them rank first in ASC sort)
        const uuidArrayStr = `ARRAY[${ids.map(id => `'${id}'::uuid`).join(',')}]`;
        orderBy = `ORDER BY COALESCE(array_position(${uuidArrayStr}, p.id), 0) ASC`;
      } else {
        // Fallback to basic text search if no semantic results
        where.push(exactMatchCond);
      }
    }
    const whereSql = where.join(' AND ');
    const count = await this.db.query(
      `SELECT count(*)::int AS total FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${whereSql}`,
      params,
      actor,
    );
    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await this.db.query(
      `${PRODUCT_VIEW} WHERE ${whereSql} ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
      actor,
    );
    return {
      items: rows.map((r) => mapProduct(r)),
      total: count.rows[0]?.total ?? 0,
      page,
      pageSize,
    };
  }

  async priceBounds(actor: Actor | undefined) {
    const { rows } = await this.db.query(
      `SELECT COALESCE(MIN(price), 0)::float AS min_price, COALESCE(MAX(price), 1000)::float AS max_price FROM products`,
      [],
      actor,
    );
    const minPrice = Math.floor(Number(rows[0]?.min_price ?? 0));
    const maxPrice = Math.ceil(Number(rows[0]?.max_price ?? 1000));
    return {
      minPrice,
      maxPrice: maxPrice > minPrice ? maxPrice : minPrice + 100,
    };
  }

  async bySlug(actor: Actor | undefined, slug: string) {
    const { rows } = await this.db.query(`${PRODUCT_VIEW} WHERE p.slug = $1`, [slug], actor);
    if (!rows[0]) throw new NotFoundException('Product not found');
    return mapProduct(rows[0]);
  }

  async getSimilarProducts(actor: Actor | undefined, id: string) {
    const similarIds = this.semanticSearch.getSimilarProducts(id, 4);
    if (!similarIds || !similarIds.length) return [];
    
    const { rows } = await this.db.query(
      `${PRODUCT_VIEW} WHERE p.id = ANY($1)`,
      [similarIds],
      actor
    );
    
    const productMap = new Map(rows.map(r => [r.id, mapProduct(r)]));
    return similarIds.map(sid => productMap.get(sid)).filter(Boolean);
  }

  async create(actor: Actor, dto: UpsertProductDto, image?: Express.Multer.File) {
    if (actor.role !== UserRoles.SUPPLIER && actor.role !== UserRoles.ADMIN) throw new ForbiddenException();

    let supplierId: string | undefined;
    if (actor.role === UserRoles.ADMIN) {
      if (!dto.supplierId) {
        throw new BadRequestException('Select a supplier when creating a product as admin');
      }
      const supplier = await this.db.query(`SELECT id FROM suppliers WHERE id = $1`, [dto.supplierId], actor);
      if (!supplier.rowCount) throw new NotFoundException('Supplier not found');
      supplierId = dto.supplierId;
    } else {
      supplierId = (
        await this.db.query(`SELECT id FROM suppliers WHERE user_id = $1`, [actor.userId], actor)
      ).rows[0]?.id;
      if (!supplierId) throw new ForbiddenException('Supplier profile missing');
    }

    const status = actor.role === UserRoles.ADMIN ? ProductStatuses.APPROVED : ProductStatuses.PENDING_APPROVAL;
    const images = (await this.imagesFromUpload(image, dto.title ?? '')) ?? dto.images ?? [];
    const { rows } = await this.db.query(
      `INSERT INTO products (supplier_id, category_id, title, slug, description, price, platform_fee_percent, stock_quantity, status, images, attributes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
       RETURNING *`,
      [
        supplierId,
        dto.categoryId,
        dto.title,
        slugify(dto.title ?? 'product'),
        dto.description ?? '',
        dto.price ?? 0,
        dto.platformFeePercent ?? 10.0,
        dto.stockQuantity ?? 0,
        status,
        JSON.stringify(images),
        JSON.stringify(dto.attributes ?? {}),
      ],
      actor,
    );
    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id) VALUES ($1,'PRODUCT_CREATED','products',$2)`,
      [actor.userId, rows[0].id],
      actor,
    );
    return this.byId(actor, rows[0].id);
  }

  async update(actor: Actor, id: string, dto: UpsertProductDto, image?: Express.Multer.File) {
    const current = await this.byId(actor, id);
    const images = (await this.imagesFromUpload(image, String(dto.title ?? current.title ?? ''))) ?? dto.images;
    const { rows } = await this.db.query(
      `UPDATE products SET
         title = COALESCE($2, title),
         category_id = COALESCE($3, category_id),
         description = COALESCE($4, description),
         price = COALESCE($5, price),
         platform_fee_percent = COALESCE($6, platform_fee_percent),
         stock_quantity = COALESCE($7, stock_quantity),
         images = COALESCE($8::jsonb, images),
         attributes = COALESCE($9::jsonb, attributes),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        dto.title ?? null,
        dto.categoryId ?? null,
        dto.description ?? null,
        dto.price ?? null,
        dto.platformFeePercent ?? null,
        dto.stockQuantity ?? null,
        images ? JSON.stringify(images) : null,
        dto.attributes ? JSON.stringify(dto.attributes) : null,
      ],
      actor,
    );
    if (!rows[0]) throw new NotFoundException('Product not found');
    return this.byId(actor, id) ?? current;
  }

  async moderate(actor: Actor, id: string, dto: ModerateDto) {
    if (actor.role !== UserRoles.SUBADMIN && actor.role !== UserRoles.ADMIN) throw new ForbiddenException();
    const { rows } = await this.db.query(
      `UPDATE products SET status = $2, updated_at = now() WHERE id = $1 RETURNING id`,
      [id, dto.status],
      actor,
    );
    if (!rows[0]) throw new NotFoundException('Product not found');
    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
       VALUES ($1, $2, 'products', $3)`,
      [actor.userId, dto.status === ProductStatuses.APPROVED ? 'PRODUCT_APPROVED' : 'PRODUCT_REJECTED', id],
      actor,
    );
    return this.byId(actor, id);
  }

  async setStock(actor: Actor, id: string, dto: StockDto) {
    const { rows } = await this.db.query(
      `UPDATE products SET stock_quantity = $2, updated_at = now() WHERE id = $1 RETURNING id`,
      [id, dto.stockQuantity],
      actor,
    );
    if (!rows[0]) throw new NotFoundException('Product not found');
    return this.byId(actor, id);
  }

  async remove(actor: Actor, id: string) {
    if (actor.role !== UserRoles.SUPPLIER && actor.role !== UserRoles.ADMIN) {
      throw new ForbiddenException('Only suppliers or admins can delete products');
    }

    const product = await this.byId(actor, id);

    if (actor.role === UserRoles.SUPPLIER) {
      const supplier = await this.db.query(
        `SELECT id FROM suppliers WHERE user_id = $1`,
        [actor.userId],
        actor,
      );
      const supplierId = supplier.rows[0]?.id;
      if (product.supplierId !== supplierId) {
        throw new ForbiddenException('You can only delete products belonging to your store');
      }
    }

    // Check if there are active, unfulfilled order items associated with this product
    const { rows: activeOrders } = await this.db.query(
      `SELECT count(*)::int AS count FROM order_items WHERE product_id = $1 AND status NOT IN ('${OrderStatuses.DELIVERED}', '${OrderStatuses.CANCELLED}')`,
      [id],
      actor,
    );

    const activeCount = Number(activeOrders[0]?.count ?? 0);
    if (activeCount > 0) {
      throw new BadRequestException(
        `Cannot delete product "${product.title}": There are ${activeCount} active unshipped order(s) for this item. Please fulfill or cancel these orders before deleting.`,
      );
    }

    try {
      await this.db.query(`DELETE FROM products WHERE id = $1`, [id], actor);
    } catch (err) {
      // Fallback: If foreign keys exist for historical delivered/cancelled orders, mark as REJECTED/inactive
      await this.db.query(`UPDATE products SET status = '${ProductStatuses.REJECTED}' WHERE id = $1`, [id], actor);
    }

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id) VALUES ($1, 'PRODUCT_DELETED', 'products', $2)`,
      [actor.userId, id],
      actor,
    );

    return { success: true, message: `Product "${product.title}" has been deleted.` };
  }

  private async byId(actor: Actor, id: string) {
    const { rows } = await this.db.query(`${PRODUCT_VIEW} WHERE p.id = $1`, [id], actor);
    if (!rows[0]) throw new NotFoundException('Product not found');
    return mapProduct(rows[0]);
  }

  async ensureReviewsTable(actor?: Actor) {
    try {
      await this.db.query(
        `CREATE TABLE IF NOT EXISTS product_reviews (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
          title VARCHAR(255) DEFAULT NULL,
          comment TEXT NOT NULL DEFAULT '',
          is_verified_buyer BOOLEAN NOT NULL DEFAULT false,
          helpful_count INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_product_reviews_product_user UNIQUE (product_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id ON product_reviews(product_id);
        CREATE INDEX IF NOT EXISTS idx_product_reviews_user_id ON product_reviews(user_id);`,
        [],
        actor,
      );
    } catch {
      // Table may already exist or concurrent creation
    }
  }

  async getReviews(productId: string, query: ListReviewsQueryDto) {
    await this.ensureReviewsTable();
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 10);
    const where: string[] = ['pr.product_id = $1'];
    const params: unknown[] = [productId];

    if (query.rating) {
      params.push(Number(query.rating));
      where.push(`pr.rating = $${params.length}`);
    }

    if (query.verifiedOnly === true || query.verifiedOnly === 'true') {
      where.push(`pr.is_verified_buyer = true`);
    }

    const whereSql = where.join(' AND ');

    const countRes = await this.db.query(
      `SELECT count(*)::int AS total FROM product_reviews pr WHERE ${whereSql}`,
      params,
    );
    const total = countRes.rows[0]?.total ?? 0;

    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await this.db.query(
      `SELECT pr.*, u.name AS user_name, u.role AS user_role
       FROM product_reviews pr
       JOIN users u ON u.id = pr.user_id
       WHERE ${whereSql}
       ORDER BY pr.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      items: rows.map(mapReview),
      total,
      page,
      pageSize,
    };
  }

  async getReviewSummary(productId: string, actor?: Actor) {
    await this.ensureReviewsTable();

    // 1. Overall Average & Total Count
    const statsRes = await this.db.query(
      `SELECT
         COUNT(*)::int AS total_reviews,
         COALESCE(ROUND(AVG(rating)::numeric, 1), 0)::float AS average_rating,
         COUNT(*) FILTER (WHERE rating >= 4)::int AS positive_reviews
       FROM product_reviews
       WHERE product_id = $1`,
      [productId],
    );
    const totalReviews = statsRes.rows[0]?.total_reviews ?? 0;
    const averageRating = statsRes.rows[0]?.average_rating ?? 0;
    const positiveReviews = statsRes.rows[0]?.positive_reviews ?? 0;
    const recommendedPercent = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) * 100) : 100;

    // 2. Star Distribution (5 to 1)
    const distRes = await this.db.query(
      `SELECT rating, COUNT(*)::int AS count
       FROM product_reviews
       WHERE product_id = $1
       GROUP BY rating`,
      [productId],
    );
    const countMap: Record<number, number> = {};
    for (const r of distRes.rows) {
      countMap[Number(r.rating)] = Number(r.count);
    }

    const breakdown = [5, 4, 3, 2, 1].map((star) => {
      const count = countMap[star] || 0;
      const percentage = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;
      return { star, count, percentage };
    });

    // 3. User Review (if logged in)
    let userReview = null;
    let isVerifiedBuyer = false;
    if (actor && actor.userId) {
      const uRes = await this.db.query(
        `SELECT pr.*, u.name AS user_name, u.role AS user_role
         FROM product_reviews pr
         JOIN users u ON u.id = pr.user_id
         WHERE pr.product_id = $1 AND pr.user_id = $2`,
        [productId, actor.userId],
      );
      if (uRes.rows[0]) {
        userReview = mapReview(uRes.rows[0]);
      }

      // Check purchase history for verified buyer
      const purchaseCheck = await this.db.query(
        `SELECT 1 FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.product_id = $1 AND o.customer_id = $2
           AND o.status IN ('${OrderStatuses.PROCESSING}', '${OrderStatuses.SHIPPED}', '${OrderStatuses.OUT_FOR_DELIVERY}', '${OrderStatuses.DELIVERED}')
         LIMIT 1`,
        [productId, actor.userId],
      );
      isVerifiedBuyer = Boolean(purchaseCheck.rows.length > 0);
    }

    return {
      averageRating,
      totalReviews,
      recommendedPercent,
      breakdown,
      userReview,
      isVerifiedBuyer,
    };
  }

  async submitReview(actor: Actor, productId: string, dto: CreateReviewDto) {
    await this.ensureReviewsTable();

    // Check product existence
    const productCheck = await this.db.query(`SELECT id, title, supplier_id FROM products WHERE id = $1`, [productId]);
    if (!productCheck.rows[0]) {
      throw new NotFoundException('Product not found');
    }

    // Check purchase history for Verified Buyer status
    const purchaseCheck = await this.db.query(
      `SELECT 1 FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_id = $1 AND o.customer_id = $2
         AND o.status IN ('${OrderStatuses.PROCESSING}', '${OrderStatuses.SHIPPED}', '${OrderStatuses.OUT_FOR_DELIVERY}', '${OrderStatuses.DELIVERED}')
       LIMIT 1`,
      [productId, actor.userId],
    );
    const isVerifiedBuyer = Boolean(purchaseCheck.rows.length > 0);

    const { rows } = await this.db.query(
      `INSERT INTO product_reviews (product_id, user_id, rating, title, comment, is_verified_buyer, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (product_id, user_id)
       DO UPDATE SET
         rating = EXCLUDED.rating,
         title = EXCLUDED.title,
         comment = EXCLUDED.comment,
         is_verified_buyer = EXCLUDED.is_verified_buyer,
         updated_at = NOW()
       RETURNING *`,
      [productId, actor.userId, dto.rating, dto.title || null, dto.comment.trim(), isVerifiedBuyer],
      actor,
    );

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id) VALUES ($1, 'PRODUCT_REVIEWED', 'products', $2)`,
      [actor.userId, productId],
      actor,
    );

    const userRes = await this.db.query(`SELECT name, role FROM users WHERE id = $1`, [actor.userId]);
    const u = userRes.rows[0] || {};
    return mapReview({
      ...rows[0],
      user_name: u.name,
      user_role: u.role,
    });
  }

  async getSupplierTrustScore(supplierId: string) {
    await this.ensureReviewsTable();

    const supplierRes = await this.db.query(
      `SELECT id, store_name, created_at FROM suppliers WHERE id = $1`,
      [supplierId],
    );
    if (!supplierRes.rows[0]) {
      throw new NotFoundException('Supplier not found');
    }
    const sup = supplierRes.rows[0];

    // Ratings across all supplier's products
    const reviewStats = await this.db.query(
      `SELECT
         COUNT(pr.id)::int AS total_reviews,
         COALESCE(ROUND(AVG(pr.rating)::numeric, 1), 0)::float AS average_rating
       FROM products p
       JOIN product_reviews pr ON pr.product_id = p.id
       WHERE p.supplier_id = $1`,
      [supplierId],
    );
    const totalReviews = reviewStats.rows[0]?.total_reviews ?? 0;
    const avgRating = reviewStats.rows[0]?.average_rating ?? 0;

    // Fulfillment / Order success rate
    const orderStats = await this.db.query(
      `SELECT
         COUNT(*)::int AS total_orders,
         COUNT(*) FILTER (WHERE status != '${OrderStatuses.CANCELLED}')::int AS successful_orders
       FROM order_items
       WHERE supplier_id = $1`,
      [supplierId],
    );
    const totalOrders = orderStats.rows[0]?.total_orders ?? 0;
    const successfulOrders = orderStats.rows[0]?.successful_orders ?? 0;
    const fulfillmentRate = totalOrders > 0
      ? Math.round((successfulOrders / totalOrders) * 1000) / 10
      : 100.0;

    // Dynamic Trust Score calculation:
    // If no reviews yet, baseline rating factor is 96%
    const ratingFactor = totalReviews > 0 ? (avgRating / 5.0) * 100 : 96.0;
    const fulfillmentFactor = fulfillmentRate;

    // 60% rating weight + 40% fulfillment weight
    const rawScore = Math.round(0.6 * ratingFactor + 0.4 * fulfillmentFactor);
    const trustScore = Math.min(99, Math.max(70, rawScore));

    let tier: 'TOP_RATED' | 'VERIFIED' | 'STANDARD' = 'STANDARD';
    let badgeLabel = 'Verified Vendor';

    if (trustScore >= 95) {
      tier = 'TOP_RATED';
      badgeLabel = 'Top Rated Supplier';
    } else if (trustScore >= 85) {
      tier = 'VERIFIED';
      badgeLabel = 'Verified Supplier';
    } else {
      tier = 'STANDARD';
      badgeLabel = 'Standard Vendor';
    }

    const memberSinceYear = sup.created_at ? new Date(sup.created_at).getFullYear() : 2025;

    return {
      supplierId: sup.id,
      storeName: sup.store_name,
      trustScore,
      rating: totalReviews > 0 ? avgRating : 5.0,
      totalReviews,
      totalOrders,
      fulfillmentRate,
      tier,
      badgeLabel,
      verifiedSince: String(memberSinceYear),
    };
  }
}
