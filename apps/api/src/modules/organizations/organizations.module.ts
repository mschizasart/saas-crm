import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { PublicBrandingController } from './public-branding.controller';
import { OrganizationsService } from './organizations.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [OrganizationsController, PublicBrandingController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
