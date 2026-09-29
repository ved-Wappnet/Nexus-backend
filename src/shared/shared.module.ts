import { Module } from '@nestjs/common';
import { CloudinaryService } from './cloudinary/cloudinary.service';
import { HealthModule } from './health/health.module';
import { MailService } from './mail/mail.service';

@Module({
  imports: [HealthModule],
  providers: [CloudinaryService, MailService],
  exports: [CloudinaryService, MailService],
})
export class SharedModule {}
