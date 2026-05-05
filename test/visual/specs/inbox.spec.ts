/**
 * Visual: /inbox
 *
 * The inbox holds a long-poll/websocket connection so we DO NOT wait for
 * networkidle (it would never fire). We rely on the stable selector + a
 * short skeleton wait.
 *
 * Message bodies and timestamps are masked. We always snapshot the
 * full inbox shell — empty-state vs populated state will look different
 * but both are valid baselines as long as the layout is stable.
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

test.describe('Visual: inbox', () => {
  test('renders consistently across themes and viewports', async ({ page }) => {
    await snapshotMatrix(page, {
      name: 'inbox',
      url: '/inbox',
      stableSelector: 'h1, [data-testid="inbox-list"]',
      waitForNetworkIdle: false, // long-poll keeps net active
      extraCss: `
        /* Hide message preview content & timestamps */
        [data-testid="inbox-list-item"] [data-testid="preview"],
        [data-testid="inbox-list-item"] [data-testid="from"],
        [data-testid="inbox-list-item"] time,
        [data-testid="message-body"],
        [data-testid="message-meta"] { visibility: hidden !important; }
      `,
    });
  });
});
