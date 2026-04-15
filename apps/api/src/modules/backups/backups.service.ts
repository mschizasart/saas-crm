import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as archiver from 'archiver';
import { PassThrough } from 'stream';
import { PrismaService } from '../../database/prisma.service';

// Tenant tables that contain organizationId and should be backed up
const TENANT_TABLES = [
  'users',
  'roles',
  'clients',
  'client_groups',
  'vault_entries',
  'currencies',
  'taxes',
  'payment_modes',
  'lead_statuses',
  'lead_sources',
  'leads',
  'lead_notes',
  'invoices',
  'invoice_items',
  'payments',
  'credit_notes',
  'credit_note_items',
  'estimates',
  'estimate_items',
  'proposals',
  'proposal_items',
  'proposal_comments',
  'expense_categories',
  'expenses',
  'client_subscriptions',
  'projects',
  'project_members',
  'milestones',
  'tasks',
  'time_entries',
  'project_discussions',
  'project_files',
  'project_notes',
  'departments',
  'tickets',
  'ticket_replies',
  'ticket_attachments',
  'contract_types',
  'contracts',
  'contract_comments',
  'knowledge_base_groups',
  'knowledge_base_articles',
  'custom_fields',
  'custom_field_values',
  'notifications',
  'activity_log',
  'email_templates',
  'surveys',
  'survey_questions',
  'survey_submissions',
  'goals',
  'announcements',
  'events',
  'todos',
];

@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);
  private s3: S3Client;
  private bucket: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.bucket = this.config.get<string>('MINIO_BUCKET', 'backups');
    this.s3 = new S3Client({
      endpoint: this.config.get<string>(
        'MINIO_ENDPOINT',
        'http://localhost:9000',
      ),
      region: this.config.get<string>('MINIO_REGION', 'us-east-1'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.get<string>('MINIO_ACCESS_KEY', 'minioadmin'),
        secretAccessKey: this.config.get<string>(
          'MINIO_SECRET_KEY',
          'minioadmin',
        ),
      },
    });
  }

  // ─── Create a full backup for an organization ──────────────
  async createBackup(orgId: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}.zip`;
    const key = `${orgId}/${filename}`;

    this.logger.log(`Creating backup ${key}`);

    const dump: Record<string, any[]> = {};
    // Dump every tenant table filtered by organizationId
    await this.prisma.withOrganization(orgId, async (tx) => {
      for (const table of TENANT_TABLES) {
        try {
          // Tables like `invoice_items` don't have organizationId themselves
          // but are protected via RLS on their parent — try both forms.
          let rows: any[] = [];
          try {
            rows = await tx.$queryRawUnsafe<any[]>(
              `SELECT * FROM "${table}" WHERE "organizationId" = $1`,
              orgId,
            );
          } catch {
            rows = await tx.$queryRawUnsafe<any[]>(`SELECT * FROM "${table}"`);
          }
          dump[table] = rows;
        } catch (err: any) {
          this.logger.warn(`Skipping table ${table}: ${err.message}`);
          dump[table] = [];
        }
      }
    });

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    const manifest = {
      organizationId: orgId,
      organizationName: org?.name ?? null,
      createdAt: new Date().toISOString(),
      tableCounts: Object.fromEntries(
        Object.entries(dump).map(([k, v]) => [k, v.length]),
      ),
      version: 1,
    };

    // Build a ZIP in-memory, stream into S3
    const archive = archiver('zip', { zlib: { level: 9 } });
    const pass = new PassThrough();
    archive.pipe(pass);
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.append(
      JSON.stringify(dump, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2),
      { name: 'data.json' },
    );
    archive.append(
      `SaaS CRM backup for org ${orgId} (${org?.name ?? ''})\nCreated: ${new Date().toISOString()}\n`,
      { name: 'README.txt' },
    );

    // Collect into buffer to get a known length for S3 PUT
    const chunks: Buffer[] = [];
    pass.on('data', (chunk) => chunks.push(chunk as Buffer));
    const done = new Promise<void>((resolve, reject) => {
      pass.on('end', () => resolve());
      pass.on('error', reject);
      archive.on('error', reject);
    });
    await archive.finalize();
    await done;
    const body = Buffer.concat(chunks);

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/zip',
        Metadata: {
          orgid: orgId,
          createdat: manifest.createdAt,
        },
      }),
    );

    this.logger.log(
      `Backup ${key} uploaded (${(body.length / 1024 / 1024).toFixed(2)} MB)`,
    );

    return {
      filename,
      key,
      size: body.length,
      createdAt: manifest.createdAt,
      tableCounts: manifest.tableCounts,
    };
  }

  // ─── List backups for an organization ──────────────────────
  async listBackups(orgId: string) {
    const res = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${orgId}/`,
      }),
    );
    return (res.Contents ?? [])
      .map((obj) => ({
        filename: obj.Key!.replace(`${orgId}/`, ''),
        key: obj.Key!,
        size: obj.Size ?? 0,
        lastModified: obj.LastModified?.toISOString() ?? null,
      }))
      .sort((a, b) => (b.lastModified ?? '').localeCompare(a.lastModified ?? ''));
  }

  // ─── Download URL ──────────────────────────────────────────
  async downloadBackup(orgId: string, filename: string) {
    const key = `${orgId}/${filename}`;
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const url = await getSignedUrl(this.s3, cmd, { expiresIn: 300 });
    return { url, filename, expiresIn: 300 };
  }

  // ─── Delete ────────────────────────────────────────────────
  async deleteBackup(orgId: string, filename: string) {
    const key = `${orgId}/${filename}`;
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return { deleted: true, filename };
  }

  // ─── Scheduled: backup every org that opted in ─────────────
  async scheduledBackup() {
    this.logger.log('Scheduled backup run started');
    const orgs = await this.prisma.organization.findMany({
      select: { id: true, name: true, settings: true },
    });
    let ok = 0;
    let failed = 0;
    for (const org of orgs) {
      const enabled = (org.settings as any)?.backups?.enabled === true;
      if (!enabled) continue;
      try {
        await this.createBackup(org.id);
        ok++;
      } catch (err: any) {
        this.logger.error(
          `Scheduled backup failed for ${org.id}: ${err.message}`,
        );
        failed++;
      }
    }
    this.logger.log(`Scheduled backup done — ok=${ok} failed=${failed}`);
    return { ok, failed };
  }
}
