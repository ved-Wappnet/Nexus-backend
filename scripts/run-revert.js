// scripts/run-revert.js
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const sqlPath = path.join(__dirname, '..', 'src', 'migrations', '20230916_revert_supplier_payouts_and_rfq_metrics.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    // Load environment variables from .env
require('dotenv').config();

// Validate required environment variables (DB_ prefix)
const requiredEnv = ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME'];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    console.error(`Missing required env var ${key}`);
    process.exit(1);
  }
});

const client = new Client({
  host: process.env.DB_HOST,
  user: process.env.DB_USERNAME,
  database: process.env.DB_NAME,
  password: String(process.env.DB_PASSWORD), // ensure string
  port: parseInt(process.env.DB_PORT, 10),
});
    await client.connect();
    await client.query(sql);
    await client.end();
    // console.log('Revert migration applied successfully');
  } catch (err) {
    // console.error('Error applying revert migration:', err);
    process.exit(1);
  }
})();
