import { Module } from '@nestjs/common';
import { CustomObjectsController } from './custom-objects.controller';
import { CustomRecordsController } from './custom-records.controller';
import { CustomObjectsService } from './custom-objects.service';
import { CustomRecordsService } from './custom-records.service';

/**
 * Wave D3 — Custom Objects. Lets tenants define their own entity types
 * at runtime. Records are stored as rows in `custom_records` with a
 * jsonb `data` column (NOT as real Postgres tables per object).
 *
 * PrismaService comes from the global DatabaseModule, so we don't need
 * to import it here.
 */
@Module({
  controllers: [CustomObjectsController, CustomRecordsController],
  providers: [CustomObjectsService, CustomRecordsService],
  exports: [CustomObjectsService, CustomRecordsService],
})
export class CustomObjectsModule {}
