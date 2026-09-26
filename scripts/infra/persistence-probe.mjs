import { connect, StorageType } from 'nats';
import { createClient } from 'redis';
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', () => {});
const nc = await connect({ servers: process.env.NATS_URL, token: process.env.NATS_TOKEN });
try {
  await redis.connect();
  const manager = await nc.jetstreamManager();
  const stream = 'INFRA_PERSISTENCE';
  if (process.argv[2] === 'write') {
    try {
      await manager.streams.info(stream);
    } catch {
      await manager.streams.add({
        name: stream,
        subjects: ['infra.persistence'],
        storage: StorageType.File,
      });
    }
    await nc.jetstream().publish('infra.persistence', new TextEncoder().encode('restart-marker'));
    await redis.set('infra:persistence', 'restart-marker');
  } else {
    const message = await manager.streams.getMessage(stream, { last_by_subj: 'infra.persistence' });
    if (
      new TextDecoder().decode(message.data) !== 'restart-marker' ||
      (await redis.get('infra:persistence')) !== 'restart-marker'
    )
      throw new Error('Persistent marker missing');
    await manager.streams.delete(stream);
    await redis.del('infra:persistence');
  }
} finally {
  redis.destroy();
  await nc.close();
}
