import { Global, Module } from '@nestjs/common';
import { EmailSettingsController } from './email-settings.controller';
import { EmailSettingsService } from './email-settings.service';
import { GoogleOAuthService } from './oauth/google-oauth.service';
import { MicrosoftOAuthService } from './oauth/microsoft-oauth.service';
import { EmailOAuthService } from './oauth/email-oauth.service';

/**
 * Exported as @Global so `EmailsService` (and any other mail sender) can
 * inject `EmailSettingsService` / `EmailOAuthService` to resolve per-org
 * SMTP or OAuth config without every feature module importing it explicitly.
 */
@Global()
@Module({
  controllers: [EmailSettingsController],
  providers: [
    EmailSettingsService,
    GoogleOAuthService,
    MicrosoftOAuthService,
    EmailOAuthService,
  ],
  exports: [EmailSettingsService, EmailOAuthService],
})
export class EmailSettingsModule {}
