import type { Server } from 'node:http';

export function drainOnSignal(server: Server, onDrain?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      onDrain?.();
      server.close((error) => (error ? reject(error) : resolve()));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
