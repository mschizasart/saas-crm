import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';

export interface StorageFile {
  name: string;
  path: string;
  size: number;
  type: string;
  lastModified: Date | null;
  url: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: any;
  private bucket: string;
  private endpoint: string;
  private port: number;
  private useSSL: boolean;
  private available = false;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.bucket = this.config.get('MINIO_BUCKET', 'crm-uploads');
    this.endpoint = this.config.get('MINIO_ENDPOINT', 'minio');
    this.port = parseInt(this.config.get('MINIO_PORT', '9000') as string);
    this.useSSL = this.config.get('MINIO_USE_SSL') === 'true';

    try {
      // Lazy-require so a missing `minio` package does not crash the API.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Client: MinioClient } = require('minio');
      this.client = new MinioClient({
        endPoint: this.endpoint,
        port: this.port,
        useSSL: this.useSSL,
        accessKey: this.config.get('MINIO_ACCESS_KEY'),
        secretKey: this.config.get('MINIO_SECRET_KEY'),
      });
      this.available = true;
    } catch (e: any) {
      this.logger.warn(`MinIO client not available: ${e.message}`);
    }
  }

  async onModuleInit() {
    if (!this.available) return;
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket, 'us-east-1');
        this.logger.log(`Created MinIO bucket: ${this.bucket}`);
      }
    } catch (e: any) {
      this.logger.warn(`MinIO bucket check failed: ${e.message}`);
    }
  }

  private prefix(orgId: string, folder?: string) {
    const f = (folder || '').replace(/^\/+|\/+$/g, '');
    return f ? `orgs/${orgId}/${f}/` : `orgs/${orgId}/`;
  }

  private assertOrgPath(orgId: string, filePath: string) {
    if (!filePath.startsWith(`orgs/${orgId}/`)) {
      throw new BadRequestException('Invalid file path');
    }
  }

  private publicUrl(objectName: string) {
    const scheme = this.useSSL ? 'https' : 'http';
    const portPart =
      (this.useSSL && this.port === 443) || (!this.useSSL && this.port === 80)
        ? ''
        : `:${this.port}`;
    return `${scheme}://${this.endpoint}${portPart}/${this.bucket}/${objectName}`;
  }

  async listFiles(orgId: string, folder?: string): Promise<StorageFile[]> {
    if (!this.available) return [];
    const prefix = this.prefix(orgId, folder);
    const results: StorageFile[] = [];

    return new Promise((resolve, reject) => {
      const stream = this.client.listObjectsV2(this.bucket, prefix, false);
      stream.on('data', (obj: any) => {
        if (!obj.name) return;
        const baseName = obj.name.substring(prefix.length);
        results.push({
          name: baseName,
          path: obj.name,
          size: obj.size ?? 0,
          type: this.guessMime(baseName),
          lastModified: obj.lastModified ?? null,
          url: this.publicUrl(obj.name),
        });
      });
      stream.on('end', () => resolve(results));
      stream.on('error', (err: any) => reject(err));
    });
  }

  async uploadFile(
    orgId: string,
    folder: string,
    filename: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ path: string; url: string }> {
    if (!this.available) {
      throw new BadRequestException('Storage backend not available');
    }
    const safeName = filename.replace(/[^\w.\-]+/g, '_');
    const objectName = `${this.prefix(orgId, folder)}${safeName}`;
    await this.client.putObject(this.bucket, objectName, buffer, buffer.length, {
      'Content-Type': mimeType || 'application/octet-stream',
    });
    return { path: objectName, url: this.publicUrl(objectName) };
  }

  async deleteFile(orgId: string, filePath: string): Promise<void> {
    if (!this.available) return;
    this.assertOrgPath(orgId, filePath);
    await this.client.removeObject(this.bucket, filePath);
  }

  async getSignedUrl(
    orgId: string,
    filePath: string,
    expiresIn = 3600,
  ): Promise<string> {
    if (!this.available) {
      throw new BadRequestException('Storage backend not available');
    }
    this.assertOrgPath(orgId, filePath);
    return this.client.presignedGetObject(this.bucket, filePath, expiresIn);
  }

  async getFileInfo(orgId: string, filePath: string) {
    if (!this.available) return null;
    this.assertOrgPath(orgId, filePath);
    const stat = await this.client.statObject(this.bucket, filePath);
    return {
      path: filePath,
      size: stat.size,
      lastModified: stat.lastModified,
      etag: stat.etag,
      metaData: stat.metaData,
    };
  }

  private guessMime(name: string) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      csv: 'text/csv',
      txt: 'text/plain',
      zip: 'application/zip',
    };
    return map[ext] || 'application/octet-stream';
  }
}
