// ─── Logger ────────────────────────────────────────────────────────────────────
import pino from 'pino';

const transport =
  process.env.NODE_ENV === 'development'
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          destination: 2 // stderr
        }
      })
    : pino.destination(2); // stderr

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    name: 'mobile-pentest-mcp',
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport as any,
);
