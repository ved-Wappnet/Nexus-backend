require('dotenv').config();
const { Client } = require('pg');

async function fixPrices() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nexus',
  });

  await client.connect();

  console.log('--- Normalizing Product Prices to USD ---');
  // Divide any unscaled prices (> 500) by 100 to get proper USD decimal values ($1,299.99 instead of $129,999.00)
  const res = await client.query(`
    UPDATE products 
    SET price = CASE 
      WHEN price > 500 THEN ROUND(price / 100.0, 2)
      ELSE price 
    END
    RETURNING title, price;
  `);

  console.log(`Updated ${res.rowCount} products to USD prices:`);
  for (const row of res.rows) {
    console.log(` - ${row.title}: $${row.price}`);
  }

  await client.end();
}

fixPrices().catch((err) => {
  console.error('Failed to update product prices:', err);
  process.exit(1);
});
