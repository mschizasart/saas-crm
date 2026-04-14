import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Contracts')
@Controller({ version: '1', path: 'contracts' })
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(private service: ContractsService) {}
}
