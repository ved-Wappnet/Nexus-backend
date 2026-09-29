export const dbConfig = () => ({
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10) || 5432,
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    name: process.env.DB_NAME || 'nexus',
    // Prefer discrete DB_* fields; URL is optional fallback (encode special chars in passwords).
    url: process.env.DATABASE_URL,
  },
});
