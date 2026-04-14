import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CustomFieldsService } from './custom-fields.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('CustomFields')
@Controller({ version: '1', path: 'custom-fields' })
@UseGuards(JwtAuthGuard)
export class CustomFieldsController {
  constructor(private service: CustomFieldsService) {}
}
