import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { StorageService } from './storage.service';
import { PrismaService } from '../../database/prisma.service';

/**
 * StorageService instantiates a real `minio.Client` in its constructor. We
 * stub the module so we can swap in a deterministic mock client.
 */
const minioMockClient = {
  bucketExists: jest.fn().mockResolvedValue(true),
  makeBucket: jest.fn().mockResolvedValue(undefined),
  putObject: jest.fn().mockResolvedValue({ etag: 'abc' }),
  removeObject: jest.fn().mockResolvedValue(undefined),
  presignedGetObject: jest.fn().mockResolvedValue('https://signed/url'),
  statObject: jest.fn().mockResolvedValue({
    size: 100,
    lastModified: new Date('2025-01-01T00:00:00Z'),
    etag: 'etag',
    metaData: {},
  }),
  listObjectsV2: jest.fn(),
};
jest.mock('minio', () => ({
  Client: jest.fn(() => minioMockClient),
}));

describe('StorageService', () => {
  let service: StorageService;
  let prisma: DeepMocked<PrismaService>;
  let config: DeepMocked<ConfigService>;

  const ORG_ID = 'org_abc';

  beforeEach(() => {
    jest.clearAllMocks();
    minioMockClient.bucketExists.mockResolvedValue(true);
    prisma = createMock<PrismaService>();
    config = createMock<ConfigService>();
    config.get.mockImplementation((key: string, fallback?: any) => {
      const map: Record<string, any> = {
        MINIO_BUCKET: 'crm-uploads',
        MINIO_ENDPOINT: 'minio.local',
        MINIO_PORT: '9000',
        MINIO_USE_SSL: 'false',
        MINIO_ACCESS_KEY: 'ak',
        MINIO_SECRET_KEY: 'sk',
      };
      return map[key] ?? fallback;
    });
    service = new StorageService(prisma, config);
  });

  describe('uploadFile', () => {
    it('writes the file at orgs/<orgId>/<folder>/<safeName>', async () => {
      const r = await service.uploadFile(
        ORG_ID,
        'invoices',
        'My File!.pdf',
        Buffer.from('hello'),
        'application/pdf',
      );

      expect(minioMockClient.putObject).toHaveBeenCalledWith(
        'crm-uploads',
        `orgs/${ORG_ID}/invoices/My_File_.pdf`,
        Buffer.from('hello'),
        5,
        { 'Content-Type': 'application/pdf' },
      );
      expect(r.path).toBe(`orgs/${ORG_ID}/invoices/My_File_.pdf`);
      expect(r.url).toContain(`orgs/${ORG_ID}/invoices/My_File_.pdf`);
    });

    it('falls back to application/octet-stream when no mime is given', async () => {
      await service.uploadFile(ORG_ID, 'misc', 'x.bin', Buffer.from('x'), '');
      expect(minioMockClient.putObject).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Buffer),
        1,
        { 'Content-Type': 'application/octet-stream' },
      );
    });

    it('places files with no folder under orgs/<orgId>/', async () => {
      await service.uploadFile(ORG_ID, '', 'flat.txt', Buffer.from('x'), 'text/plain');
      expect(minioMockClient.putObject).toHaveBeenCalledWith(
        'crm-uploads',
        `orgs/${ORG_ID}/flat.txt`,
        expect.any(Buffer),
        expect.any(Number),
        expect.any(Object),
      );
    });
  });

  describe('deleteFile', () => {
    it('refuses to delete a path outside the org prefix', async () => {
      await expect(
        service.deleteFile(ORG_ID, 'orgs/org_other/file.png'),
      ).rejects.toThrow(BadRequestException);
      expect(minioMockClient.removeObject).not.toHaveBeenCalled();
    });

    it('deletes the object when the path is org-scoped', async () => {
      await service.deleteFile(ORG_ID, `orgs/${ORG_ID}/foo/bar.png`);
      expect(minioMockClient.removeObject).toHaveBeenCalledWith(
        'crm-uploads',
        `orgs/${ORG_ID}/foo/bar.png`,
      );
    });
  });

  describe('getSignedUrl', () => {
    it('refuses cross-org paths', async () => {
      await expect(
        service.getSignedUrl(ORG_ID, 'orgs/other_org/x.png'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns the presigned URL when the path is org-scoped', async () => {
      const r = await service.getSignedUrl(
        ORG_ID,
        `orgs/${ORG_ID}/private/x.png`,
        600,
      );
      expect(r).toBe('https://signed/url');
      expect(minioMockClient.presignedGetObject).toHaveBeenCalledWith(
        'crm-uploads',
        `orgs/${ORG_ID}/private/x.png`,
        600,
      );
    });
  });

  describe('getFileInfo', () => {
    it('refuses cross-org paths', async () => {
      await expect(
        service.getFileInfo(ORG_ID, 'orgs/foreign/x.png'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns the stat metadata for an in-scope path', async () => {
      const r: any = await service.getFileInfo(
        ORG_ID,
        `orgs/${ORG_ID}/x.png`,
      );
      expect(r.size).toBe(100);
      expect(r.etag).toBe('etag');
    });
  });

  describe('listFiles', () => {
    it('streams objects, strips the prefix from the basename, and resolves with the result list', async () => {
      const fakeStream = {
        on: (event: string, cb: any) => {
          if (event === 'data') {
            cb({
              name: `orgs/${ORG_ID}/uploads/foo.png`,
              size: 42,
              lastModified: new Date('2025-01-01T00:00:00Z'),
            });
          }
          if (event === 'end') {
            // Async-ish — fire on next tick so ordering matches real streams
            setTimeout(cb, 0);
          }
          return fakeStream;
        },
      };
      minioMockClient.listObjectsV2.mockReturnValue(fakeStream);

      const r = await service.listFiles(ORG_ID, 'uploads');
      expect(r).toEqual([
        expect.objectContaining({
          name: 'foo.png',
          path: `orgs/${ORG_ID}/uploads/foo.png`,
          size: 42,
          type: 'image/png',
        }),
      ]);
    });
  });

  describe('mime guessing', () => {
    it('maps common extensions to canonical types via uploaded URL response', async () => {
      // No way to call guessMime directly — exercise via listFiles fakes
      const fakeStream = {
        on: (event: string, cb: any) => {
          if (event === 'data') {
            cb({ name: `orgs/${ORG_ID}/x.csv`, size: 1, lastModified: null });
            cb({ name: `orgs/${ORG_ID}/y.unknown`, size: 1, lastModified: null });
          }
          if (event === 'end') setTimeout(cb, 0);
          return fakeStream;
        },
      };
      minioMockClient.listObjectsV2.mockReturnValue(fakeStream);

      const r = await service.listFiles(ORG_ID);
      expect(r.find((f) => f.name === 'x.csv')?.type).toBe('text/csv');
      expect(r.find((f) => f.name === 'y.unknown')?.type).toBe(
        'application/octet-stream',
      );
    });
  });

  describe('availability fallback', () => {
    it('uploadFile throws BadRequestException when MinIO client never initialised', async () => {
      // Force unavailable
      (service as any).available = false;
      await expect(
        service.uploadFile(ORG_ID, 'x', 'y.png', Buffer.from('z'), 'image/png'),
      ).rejects.toThrow(BadRequestException);
    });

    it('listFiles returns [] when storage is unavailable', async () => {
      (service as any).available = false;
      const r = await service.listFiles(ORG_ID);
      expect(r).toEqual([]);
    });
  });
});
