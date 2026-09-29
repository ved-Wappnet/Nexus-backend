import "dotenv/config";
import "reflect-metadata";
import { ACCESS_TOKEN, Environments } from "@core/constants";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DocumentBuilder,
  SwaggerCustomOptions,
  SwaggerDocumentOptions,
  SwaggerModule,
} from "@nestjs/swagger";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(json({ limit: "25mb" }));
  app.use(urlencoded({ extended: true, limit: "25mb" }));
  const config = app.get(ConfigService);
  const port = Number(config.get("app.port") ?? 3000);
  const environment = (config.get<string>("app.environment") ??
    Environments.DEVELOPMENT) as Environments;
  const appName = config.get<string>("app.name") ?? "Nexus API";

  app.enableCors({
    origin: config.get<string>("app.frontend.origin")?.split(",") ?? [
      "http://localhost:4200",
    ],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  if (environment !== Environments.PRODUCTION) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(appName)
      .setDescription("Nexus Market API")
      .setVersion("1.0")
      .addBearerAuth(
        { type: "http", scheme: "bearer", bearerFormat: "JWT", in: "header" },
        ACCESS_TOKEN,
      )
      .build();

    const options: SwaggerDocumentOptions = {
      operationIdFactory: (_: string, methodKey: string) => methodKey,
    };
    const document = SwaggerModule.createDocument(app, swaggerConfig, options);
    const swaggerCustomOptions: SwaggerCustomOptions = {
      swaggerOptions: {
        displayRequestDuration: true,
        persistAuthorization: true,
      },
    };
    SwaggerModule.setup("/", app, document, swaggerCustomOptions);
  }

  await app.listen(port);
  console.log(`Nexus API listening on http://localhost:${port}/`);
  if (environment !== Environments.PRODUCTION) {
    console.log(`Swagger docs at http://localhost:${port}/`);
  }
}

bootstrap();
