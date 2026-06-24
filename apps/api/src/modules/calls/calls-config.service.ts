import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { decrypt, isEncrypted } from '../../common/crypto/encrypt';

/**
 * Resolves usable Twilio credentials for the calling feature.
 *
 * Calling DELIBERATELY reuses the org's existing SMS Twilio account
 * (the `sms_settings` row) — there is no separate calling-credentials
 * table. A tenant configures Twilio once under Settings → SMS and both
 * SMS and click-to-call work. Falls back to the optional platform-env
 * creds (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER)
 * the same way SmsConfigService does.
 *
 * Mirrors SmsConfigService.resolveConfig but does NOT require the org's
 * `enabled` SMS toggle to be on — enabling SMS sending is a separate
 * concern from placing a call with the same account.
 */
@Injectable()
export class CallsConfigService {
  private readonly logger = new Logger(CallsConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private encKey(): string | undefined {
    return this.config.get<string>('ENCRYPTION_KEY');
  }

  /**
   * Resolve Twilio creds for the org. `source`:
   *   - 'org'  : the org's own sms_settings creds (accountSid + authToken + fromNumber)
   *   - 'env'  : the platform-env TWILIO_* fallback
   *   - 'none' : nothing usable configured
   * When source==='none' the credential fields are null.
   */
  async resolveTwilio(orgId: string): Promise<{
    accountSid: string | null;
    authToken: string | null;
    fromNumber: string | null;
    source: 'org' | 'env' | 'none';
  }> {
    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.smsSettings.findUnique({ where: { organizationId: orgId } }),
    );

    if (row && row.accountSid && row.authToken && row.fromNumber) {
      let token: string | null = null;
      try {
        token = isEncrypted(row.authToken)
          ? decrypt(row.authToken, this.encKey())
          : row.authToken;
      } catch (e) {
        this.logger.error(
          `Failed to decrypt Twilio auth token for org ${orgId}: ${(e as Error).message}`,
        );
        token = null;
      }
      if (token) {
        return {
          accountSid: row.accountSid,
          authToken: token,
          fromNumber: row.fromNumber,
          source: 'org',
        };
      }
    }

    const envSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const envToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const envFrom = this.config.get<string>('TWILIO_FROM_NUMBER');
    if (envSid && envToken && envFrom) {
      return {
        accountSid: envSid,
        authToken: envToken,
        fromNumber: envFrom,
        source: 'env',
      };
    }

    return {
      accountSid: null,
      authToken: null,
      fromNumber: null,
      source: 'none',
    };
  }

  /**
   * Decrypted auth token for the org's saved SMS settings — used by the
   * public webhooks to validate the Twilio request signature. Returns
   * null when the org has no saved token (falls back to env token for
   * signature validation when the org has none).
   */
  async getAuthTokenForOrg(orgId: string): Promise<string | null> {
    const resolved = await this.resolveTwilio(orgId);
    return resolved.authToken;
  }
}
