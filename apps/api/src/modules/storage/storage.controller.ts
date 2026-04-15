import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';

@ApiTags('Storage')
@Controller({ version: '1', path: 'storage' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class StorageController {
  constructor(private service: StorageService) {}

  @Get('files')
  @ApiOperation({ summary: 'List files in a folder' })
  list(@CurrentOrg() org: any, @Query('folder') folder?: string) {
    return this.service.listFiles(org.id, folder);
  }

  @Post('upload')
  @ApiOperation({ summary: 'Upload a file (multipart/form-data)' })
  async upload(@CurrentOrg() org: any, @Req() req: any) {
    // Expect fastify with @fastify/multipart registered.
    if (typeof req.file !== 'function' && typeof req.parts !== 'function') {
      throw new BadRequestException(
        'Multipart not supported — @fastify/multipart not registered',
      );
    }

    let folder = '';
    let filename = '';
    let mimeType = 'application/octet-stream';
    let buffer: Buffer | null = null;

    // Iterate all multipart parts (fields + file).
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        filename = part.filename;
        mimeType = part.mimetype || 'application/octet-stream';
        buffer = await part.toBuffer();
      } else if (part.type === 'field') {
        if (part.fieldname === 'folder') folder = String(part.value || '');
      }
    }

    if (!buffer || !filename) {
      throw new BadRequestException('No file in request');
    }
    return this.service.uploadFile(org.id, folder, filename, buffer, mimeType);
  }

  @Delete('files')
  @ApiOperation({ summary: 'Delete a file' })
  async remove(@CurrentOrg() org: any, @Body() body: { path: string }) {
    if (!body?.path) throw new BadRequestException('path is required');
    await this.service.deleteFile(org.id, body.path);
    return { ok: true };
  }

  @Get('url')
  @ApiOperation({ summary: 'Get a presigned URL for a private file' })
  async signedUrl(
    @CurrentOrg() org: any,
    @Query('path') path: string,
    @Query('expiresIn') expiresIn?: string,
  ) {
    if (!path) throw new BadRequestException('path is required');
    const url = await this.service.getSignedUrl(
      org.id,
      path,
      expiresIn ? Number(expiresIn) : 3600,
    );
    return { url };
  }
}
