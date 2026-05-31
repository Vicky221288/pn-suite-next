import 'server-only';
import type { MessagingProvider } from './provider';
import { MockProvider } from './mock';
import { AiSensyProvider } from './aisensy';

/**
 * Provider selector. Defaults to the mock adapter; live AiSensy is opt-in via
 * MESSAGING_PROVIDER=aisensy once Vicky completes the BSP/Meta setup (deferred).
 * The rest of the app depends only on the MessagingProvider interface.
 */
export function getProvider(): MessagingProvider {
  switch (process.env.MESSAGING_PROVIDER) {
    case 'aisensy':
      return AiSensyProvider;
    case 'mock':
    case undefined:
    case '':
      return MockProvider;
    default:
      throw new Error(`Unknown MESSAGING_PROVIDER: ${process.env.MESSAGING_PROVIDER}`);
  }
}

export * from './provider';
export { sign, verifySignature } from './webhook';
