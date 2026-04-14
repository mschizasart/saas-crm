import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class CreditNotesService {
  constructor(private prisma: PrismaService) {}
  // TODO: implement in Phase 2+
}
