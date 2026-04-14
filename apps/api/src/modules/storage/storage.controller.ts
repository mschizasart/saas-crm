import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Storage')
@Controller({ version: '1', path: 'storage' })
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(private service: StorageService) {}
}
