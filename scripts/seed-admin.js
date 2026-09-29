require('dotenv').config();
const bcrypt = require('bcrypt');
const { Client } = require('pg');

const ADMIN = {
  name: 'Nexus Admin',
  email: 'admin.nexus@yopmail.com',
  password: 'Admin@123',
  role: 'ADMIN',
};

/** Root categories, then children keyed by parent slug. */
const CATEGORIES = [
  { name: 'Electronics', slug: 'electronics' },
  { name: 'Fashion', slug: 'fashion' },
  { name: 'Home & Living', slug: 'home-living' },
  { name: 'Sports & Outdoors', slug: 'sports-outdoors' },
  { name: 'Phones', slug: 'phones', parentSlug: 'electronics' },
  { name: 'Computers', slug: 'computers', parentSlug: 'electronics' },
  { name: 'Men', slug: 'men', parentSlug: 'fashion' },
  { name: 'Women', slug: 'women', parentSlug: 'fashion' },
  { name: 'Furniture', slug: 'furniture', parentSlug: 'home-living' },
  { name: 'Fitness', slug: 'fitness', parentSlug: 'sports-outdoors' },
];

async function seedAdmin(client) {
  const hash = await bcrypt.hash(ADMIN.password, 10);
  const email = ADMIN.email.toLowerCase();
  const existing = await client.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [email]);

  if (existing.rowCount) {
    await client.query(
      `UPDATE users
       SET name = $1, password_hash = $2, role = $3, is_active = true
       WHERE lower(email) = lower($4)`,
      [ADMIN.name, hash, ADMIN.role, email],
    );
    console.log(`Updated admin user: ${email}`);
  } else {
    await client.query(
      `INSERT INTO users (name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [ADMIN.name, email, hash, ADMIN.role],
    );
    console.log(`Created admin user: ${email}`);
  }
}

async function seedCategories(client) {
  const bySlug = new Map();
  const { rows } = await client.query(`SELECT id, slug FROM categories`);
  for (const row of rows) bySlug.set(row.slug, row.id);

  let created = 0;
  let skipped = 0;

  for (const cat of CATEGORIES) {
    if (bySlug.has(cat.slug)) {
      skipped += 1;
      continue;
    }

    let parentId = null;
    if (cat.parentSlug) {
      parentId = bySlug.get(cat.parentSlug) ?? null;
      if (!parentId) {
        console.warn(`Skipping ${cat.slug}: parent "${cat.parentSlug}" not found`);
        continue;
      }
    }

    const inserted = await client.query(
      `INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING id, slug`,
      [cat.name, cat.slug, parentId],
    );
    bySlug.set(inserted.rows[0].slug, inserted.rows[0].id);
    created += 1;
  }

  console.log(`Categories: ${created} created, ${skipped} already present`);
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nexus',
  });

  await client.connect();
  await seedAdmin(client);
  await seedCategories(client);
  await client.end();
}

main().catch((err) => {
  console.error('Failed to seed:', err.message);
  process.exit(1);
});
