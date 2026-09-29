const port = parseInt(process.env.PORT ?? '3000', 10) || 3000;

export const appConfig = () => ({
  app: {
    port,
    environment: process.env.NODE_ENV || 'development',
    name: process.env.APP_NAME || 'Nexus',
    publicUrl: process.env.PUBLIC_URL || process.env.API_PUBLIC_URL || `http://localhost:${port}`,
    jwt: {
      secret: process.env.JWT_SECRET || 'nexus-dev-secret-change-me',
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    },
    frontend: {
      origin: process.env.FRONTEND_ORIGIN || process.env.NEXUS_FRONTEND_URL || 'http://localhost:4200',
      url: process.env.NEXUS_FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:4200',
    },
  },
});
