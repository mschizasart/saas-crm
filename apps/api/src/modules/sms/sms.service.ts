import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private client: any;
  private fromNumber = '';

  constructor(private config: ConfigService) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const twilio = require('twilio');
      const sid = this.config.get('TWILIO_ACCOUNT_SID');
      const token = this.config.get('TWILIO_AUTH_TOKEN');
      if (sid && token) {
        this.client = twilio(sid, token);
        this.fromNumber = this.config.get('TWILIO_FROM_NUMBER', '');
        this.logger.log('Twilio SMS client initialized');
      } else {
        this.logger.warn('Twilio credentials not configured — SMS disabled');
      }
    } catch (e: any) {
      this.logger.warn(`Twilio package not available: ${e.message}`);
    }
  }

  async send(to: string, body: string) {
    if (!this.client) {
      this.logger.warn(`SMS skipped (Twilio not configured): ${to}`);
      return;
    }
    try {
      const message = await this.client.messages.create({
        from: this.fromNumber,
        to,
        body,
      });
      this.logger.log(`SMS sent to ${to}: ${message.sid}`);
      return message;
    } catch (e: any) {
      this.logger.error(`SMS send failed to ${to}`, e);
      throw e;
    }
  }

  @OnEvent('invoice.overdue')
  async onInvoiceOverdue(payload: { invoice: any }) {
    const phone =
      payload.invoice?.client?.phone ||
      payload.invoice?.client?.contacts?.[0]?.phone;
    if (!phone) return;
    await this.send(
      phone,
      `Reminder: Invoice ${payload.invoice.number} is overdue. Please pay at ${process.env.APP_URL}/portal/invoices/${payload.invoice.id}`,
    );
  }

  @OnEvent('ticket.assigned')
  async onTicketAssigned(payload: { ticket: any; assignee: any }) {
    if (!payload.assignee?.phoneMobile) return;
    await this.send(
      payload.assignee.phoneMobile,
      `New ticket assigned to you: ${payload.ticket.subject}`,
    );
  }
}
