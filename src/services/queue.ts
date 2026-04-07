import { maestro } from './maestro';
import { channelDb, threadDb } from '../db';
import { splitMessage } from '../utils/splitMessage';
import { downloadAttachments, formatAttachmentRefs } from '../utils/attachments';
import { logger } from './logger';
import { createQueue } from './queueFactory';

export { createQueue } from './queueFactory';
export type { QueueDeps } from './queueFactory';

const defaultQueue = createQueue({
  maestro,
  channelDb,
  threadDb,
  splitMessage,
  downloadAttachments,
  formatAttachmentRefs,
  logger,
});

export const enqueue = defaultQueue.enqueue;
