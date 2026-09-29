require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT || 5432);
  const user = process.env.DB_USERNAME || 'postgres';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'nexus';

  const admin = new Client({ host, port, user, password, database: 'postgres' });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (!exists.rowCount) {
    await admin.query(`CREATE DATABASE "${database}"`);
    console.log(`Created database "${database}"`);
  } else {
    console.log(`Database "${database}" already exists`);
  }
  await admin.end();
}

main().catch((err) => {
  console.error('Failed to create database:', err.message);
  process.exit(1);
});
