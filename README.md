# Nexus Market API

NestJS backend. This folder is a complete app and can be its own git remote.

PostgreSQL must already be installed and running on your machine (no Docker).

## One-time database setup

PostgreSQL must already be installed and running. Create the DB from `.env`:

```bash
cp .env.example .env
# edit DB_* credentials
npm run db:create
```

Tables are created automatically on app start via TypeORM `synchronize: true`.

After the first app start (so tables exist), seed the default admin and categories:

```bash
npm run db:seed
```

| Seed | Value |
|------|--------|
| Admin email | `admin.nexus@yopmail.com` |
| Admin password | `Admin@123` |
| Categories | Electronics, Fashion, Home & Living, Sports & Outdoors (+ children) |

## Run

```bash
npm install
npm run start:dev
```

API / Swagger: `http://localhost:3000/`  
Health: `http://localhost:3000/health`

## Product images (Cloudinary)

Product uploads are stored in Cloudinary. Add these to `.env`:

| Variable | Description |
|----------|-------------|
| `CLOUDINARY_CLOUD_NAME` | Cloud name from your Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | API key |
| `CLOUDINARY_API_SECRET` | API secret |
| `CLOUDINARY_FOLDER` | Optional upload folder (default: `nexus/products`) |

## Password reset (SMTP)

Forgot-password sends a 6-digit OTP email via SMTP. Configure:

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | SMTP server host |
| `SMTP_PORT` | SMTP port (default `587`) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | From address (defaults to `SMTP_USER`) |
| `SMTP_SECURE` | Set `true` for port `465` |
# Nexus-backend
