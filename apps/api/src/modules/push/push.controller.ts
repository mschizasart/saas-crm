import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { Public } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PushService } from './push.service';

class SubscribeKeysDto {
  @IsString()
  p256dh!: string;

  @IsString()
  auth!: string;
}

class SubscribeDto {
  @IsString()
  endpoint!: string;

  @IsObject()
  keys!: SubscribeKeysDto;

  @IsOptional()
  @IsString()
  userAgent?: string;
}

class UnsubscribeDto {
  @IsString()
  endpoint!: string;
}

@ApiTags('Push')
@Controller({ version: '1', path: 'push' })
export class PushController {
  constructor(private readonly push: PushService) {}

  /**
   * Public — clients need this BEFORE they can subscribe (the VAPID
   * public key is what PushManager.subscribe() takes as
   * applicationServerKey). It's not a secret.
   */
  @Get('public-key')
  @Public()
  getPublicKey() {
    return {
      publicKey: this.push.getPublicKey(),
      configured: this.push.isConfigured(),
    };
  }

  @Post('subscribe')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async subscribe(
    @CurrentUser() user: any,
    @Body() dto: SubscribeDto,
    @Headers('user-agent') uaHeader?: string,
  ) {
    const orgId = user.orgId ?? user.organizationId;
    await this.push.saveSubscription({
      organizationId: orgId,
      userId: user.id ?? user.userId,
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      // Prefer client-supplied UA (it's what THEY see); fall back to header.
      userAgent: dto.userAgent ?? uaHeader ?? '',
    });
    return { success: true };
  }

  @Delete('subscribe')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async unsubscribe(@CurrentUser() user: any, @Body() dto: UnsubscribeDto) {
    await this.push.deleteSubscription(user.id ?? user.userId, dto.endpoint);
  }

  /**
   * Sends a "this is a test" push to every subscription belonging to the
   * caller. Useful for the settings page button.
   */
  @Post('test')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async test(@CurrentUser() user: any) {
    const result = await this.push.sendToUser(user.id ?? user.userId, {
      title: 'AppoinlyCRM test',
      body: 'Push notifications are working — you can close this.',
      url: '/dashboard',
      tag: 'push-test',
    });
    return result;
  }
}
