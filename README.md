# 🛡️ Nexus API — Scalable B2B/B2C Marketplace Backend

A robust, enterprise-grade REST and WebSocket backend powering the **Nexus Marketplace Platform**, built with **NestJS**, **TypeORM**, **PostgreSQL**, **Cloudinary**, and **OpenAI**.

---

## 🚀 Key Highlights & Modules

- **🔐 Enterprise Authentication & RBAC**: JWT access tokens, Passport strategies, password hashing with bcrypt, OTP-based password reset via Nodemailer, and role-based guards (`ADMIN`, `SUPPLIER`, `BUYER`, `DELIVERY_PARTNER`).
- **📦 Comprehensive Catalog & Inventory**:
  - Categories, tiered product pricing, and live inventory control.
  - Image upload with Cloudinary integration.
  - Semantic vector search powered by `@xenova/transformers` embeddings.
  - Automated AI-assisted product review moderation.
- **💼 B2B RFQ Negotiation Engine**:
  - Request for Quote (RFQ) generation, quote proposals, price counter-offers.
  - Real-time quote communication via WebSockets (`@nestjs/websockets`).
- **🛡️ Secure Escrow & Order Lifecycle**:
  - Full order state-machine (Pending, Paid, Processing, Shipped, Delivered, Completed, Disputed).
  - 72-hour escrow inspection protection, dispute management, and settlement resolution.
  - PDF invoice & packing slip generation via `pdfkit`.
- **🚚 Delivery Partner & Telemetry Portal**:
  - Driver onboarding, identity document verification, and order assignment.
  - QR Code verification (`qrcode`) for secure proof-of-delivery (POD).
  - Real-time GPS coordinate telemetry pings broadcast over WebSockets.
- **🤖 AI Marketing & Assistant Suite**:
  - AI Assistant Chatbot powered by OpenAI API (`gpt-4o-mini`).
  - Automated recovery campaign analytics for Cart Abandonment and Wishlist drops.
  - Email pixel tracking telemetry & conversion attribution.
- **📜 Audit Trail**: Structured event logging recording actor, entity, IP address, and payload metadata.

---

## 🛠️ Tech Stack

| Domain | Technology |
|---|---|
| **Framework** | NestJS 12 (Node.js / TypeScript) |
| **Database & ORM** | PostgreSQL 15+, TypeORM |
| **Realtime** | Socket.IO, `@nestjs/websockets` |
| **AI / Machine Learning**| OpenAI SDK, Xenova Transformers (Embeddings) |
| **Cloud Storage** | Cloudinary (Multi-part image uploads) |
| **Email & Documents** | Nodemailer (SMTP), PDFKit, QRCode |
| **API Documentation** | Swagger / OpenAPI (`@nestjs/swagger`) |

---

## 📦 Project Structure

```text
nexus_backend/
├── scripts/                # Database creation, admin seed, and product seeders
├── src/
│   ├── core/               # Global guards, decorators, entities, and shared interfaces
│   │   ├── decorators/     # Custom auth and role decorators
│   │   ├── entities/       # TypeORM database models & relationships
│   │   ├── guards/         # JWT and Role guards
│   │   └── utils/          # Mappers and utility helpers
│   ├── database/           # Database module and connection lifecycle
│   ├── domain/             # Core business domains:
│   │   ├── audit-logs/     # Audit tracking and compliance logs
│   │   ├── auth/           # Login, registration, OTP reset, JWT strategy
│   │   ├── catalog/        # Category management & support ticket gateway
│   │   ├── chatbot/        # OpenAI chatbot streaming and FAQs
│   │   ├── currency/       # Real-time FX exchange rate conversion
│   │   ├── dashboard/      # Executive KPIs, SLAs, and charts
│   │   ├── delivery-partners/ # Partner management, POD & GPS telemetry
│   │   ├── marketing/      # Abandonment campaigns & telemetry engine
│   │   ├── notifications/  # Notification service & gateway
│   │   ├── orders/         # Order state machine, escrow & disputes, payouts
│   │   ├── payments/       # Payment handling & Stripe integration
│   │   ├── products/       # Products, semantic search & AI reviews
│   │   └── quotes/         # RFQ negotiation & chat gateway
│   ├── migrations/         # SQL migration scripts
│   ├── shared/             # Cloudinary, health check, and mailer services
│   └── main.ts             # Application entrypoint & Swagger setup
└── nest-cli.json           # NestJS CLI configuration
```

---

## ⚙️ Getting Started

### Prerequisites

- **Node.js**: `v20.x` or higher
- **PostgreSQL**: `v14+` running locally or via remote instance

### Installation

```bash
# Navigate to the backend directory
cd nexus_backend

# Install dependencies
npm install
```

### Environment Configuration

Copy the example environment configuration:

```bash
cp .env.example .env
```

Configure your `.env` variables:

```env
# Application
PORT=3000
NODE_ENV=development
APP_NAME=Nexus

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_NAME=nexus

# JWT Authentication
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRES_IN=7d

# Frontend CORS
FRONTEND_ORIGIN=http://localhost:4200
NEXUS_FRONTEND_URL=http://localhost:4200

# Cloudinary (Product Images)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_FOLDER=nexus/products

# SMTP (OTP password reset)
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=587
SMTP_USER=your_user
SMTP_PASS=your_password
SMTP_FROM="Nexus Support <no-reply@nexus.local>"
SMTP_SECURE=false

# OpenAI (AI Chatbot)
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
```

---

## 🗄️ Database Setup & Seeding

1. **Create the Database:**
   ```bash
   npm run db:create
   ```
2. **Start the Application** (TypeORM will automatically synchronize schema tables on startup):
   ```bash
   npm run start:dev
   ```
3. **Seed Initial Data** (Admin user & default categories):
   ```bash
   npm run db:seed
   ```

   **Default Admin Credentials:**
   - **Email:** `admin.nexus@yopmail.com`
   - **Password:** `Admin@123`

---

## 🏃 Running the Application

```bash
# Development mode with hot-reload
npm run start:dev

# Production build
npm run build
npm run start:prod
```

### 📖 API Documentation & Health Checks

- **Swagger API Docs**: [http://localhost:3000/api](http://localhost:3000/api) (or `http://localhost:3000/`)
- **Health Check**: [http://localhost:3000/health](http://localhost:3000/health)

---

## 🤝 Contribution & Branching Strategy

- **`main`**: Production releases only.
- **`develop`**: Active development branch. Branch feature work off `develop` and submit PRs back into `develop`.
