import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  private configured = false;

  constructor(private readonly config: ConfigService) {
    const cloudName = this.config.get<string>('cloudinary.cloudName');
    const apiKey = this.config.get<string>('cloudinary.apiKey');
    const apiSecret = this.config.get<string>('cloudinary.apiSecret');
    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
      this.configured = true;
    }
  }

  async uploadProductImage(file: Express.Multer.File): Promise<string> {
    if (!this.configured) {
      throw new BadRequestException(
        'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      );
    }
    const folder = this.config.get<string>('cloudinary.folder') ?? 'nexus/products';

    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (error, result) => {
          if (error) reject(error);
          else resolve(result!.secure_url);
        },
      );
      stream.end(file.buffer);
    });
  }

  async uploadAttachment(file: Express.Multer.File): Promise<{ url: string; name: string; size: number; mimeType: string }> {
    const name = file.originalname || 'attachment';
    const size = file.size || file.buffer.length;
    const mimeType = file.mimetype || 'application/octet-stream';

    if (!this.configured) {
      const base64 = file.buffer.toString('base64');
      return { url: `data:${mimeType};base64,${base64}`, name, size, mimeType };
    }

    const folder = 'nexus/ticket_attachments';
    const isImage = mimeType.startsWith('image/');
    const resourceType = isImage ? 'image' : 'raw';

    return new Promise((resolve) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: resourceType },
        (error, result) => {
          if (error || !result?.secure_url) {
            const base64 = file.buffer.toString('base64');
            resolve({ url: `data:${mimeType};base64,${base64}`, name, size, mimeType });
          } else {
            resolve({ url: result.secure_url, name, size, mimeType });
          }
        },
      );
      stream.end(file.buffer);
    });
  }
}
