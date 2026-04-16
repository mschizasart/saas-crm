import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DraftReplyContext {
  subject: string;
  previousMessages: Array<{ from: string; message: string; date: string }>;
  tone?: 'professional' | 'friendly' | 'formal';
  instructions?: string;
}

@Injectable()
export class AiComposerService {
  constructor(private config: ConfigService) {}

  async draftReply(context: DraftReplyContext): Promise<string> {
    // If ANTHROPIC_API_KEY is set, use Claude API
    const apiKey = this.config.get('ANTHROPIC_API_KEY');
    if (apiKey) {
      return this.callClaude(apiKey, context);
    }
    // Fallback: simple template-based response
    return this.generateTemplate(context);
  }

  private async callClaude(
    apiKey: string,
    context: DraftReplyContext,
  ): Promise<string> {
    const messages = context.previousMessages
      .map((m) => `${m.from}: ${m.message}`)
      .join('\n');

    const prompt = `You are a helpful customer service agent. Draft a ${context.tone || 'professional'} reply to this conversation.

Subject: ${context.subject}

Conversation:
${messages}

${context.instructions ? `Additional instructions: ${context.instructions}` : ''}

Write ONLY the reply text, no greeting prefix or signature.`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      return data.content?.[0]?.text || this.generateTemplate(context);
    } catch {
      return this.generateTemplate(context);
    }
  }

  private generateTemplate(context: DraftReplyContext): string {
    const lastMsg =
      context.previousMessages[context.previousMessages.length - 1];
    if (!lastMsg)
      return 'Thank you for reaching out. How can I help you today?';

    const templates = [
      `Thank you for your message regarding "${context.subject}". I've reviewed your request and would like to help you with this.\n\nCould you please provide more details so I can assist you better?`,
      `I appreciate you reaching out about "${context.subject}". Let me look into this for you.\n\nI'll get back to you shortly with a solution.`,
      `Thank you for contacting us. I understand your concern about "${context.subject}" and I'm here to help.\n\nLet me work on this and update you as soon as possible.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }
}
