import { createClient } from 'redis';

export function createRedisClient(url: string, onError: (error: unknown) => void) {
  return createClient({
    url,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 512,
    socket: { connectTimeout: 2000 },
  }).on('error', onError);
}

export type RedisClient = ReturnType<typeof createRedisClient>;

export async function connectRedis(client: RedisClient): Promise<void> {
  await runRedisCommand(() => client.connect(), 4000);
}

export class RedisCommandTimeout extends Error {
  constructor() {
    super('Redis command timed out');
    this.name = 'RedisCommandTimeout';
  }
}

export async function runRedisCommand<T>(operation: () => Promise<T>, budgetMs: number): Promise<T> {
  if (budgetMs <= 0) throw new RedisCommandTimeout();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RedisCommandTimeout()), budgetMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
