import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';

@Injectable()
export class PdfService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private browser: Browser | null = null;

  async onModuleInit() {
    try {
      const launchOpts: any = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      };
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }
      this.browser = await puppeteer.launch(launchOpts);
      this.logger.log('Puppeteer browser launched');
    } catch (e) {
      this.logger.error('Failed to launch puppeteer', e as any);
    }
  }

  async onModuleDestroy() {
    if (this.browser) await this.browser.close();
  }

  async generatePdf(html: string, options?: { format?: 'A4' | 'Letter' }): Promise<Buffer> {
    if (!this.browser) throw new Error('Puppeteer not initialized');
    const page = await this.browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: options?.format ?? 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }
}
