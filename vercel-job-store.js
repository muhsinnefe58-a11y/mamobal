import { Redis } from '@upstash/redis';

const TTL_SECONDS = 60 * 60;

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = url && token ? new Redis({ url, token }) : null;

const kv = redis
  ? {
      async get(key) {
        return await redis.get(key);
      },
      async set(key, value, ttl) {
        await redis.set(key, value, { ex: ttl });
      },
    }
  : (() => {
      const map = new Map();
      return {
        async get(key) {
          return map.get(key);
        },
        async set(key, value, ttl) {
          map.set(key, value);
          setTimeout(() => map.delete(key), ttl * 1000);
        },
      };
    })();

const JOB_PREFIX = 'job:';

export const jobStore = {
  async create(url) {
    const job = {
      id: crypto.randomUUID(),
      status: 'queued',
      url,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await kv.set(JOB_PREFIX + job.id, job, TTL_SECONDS);
    return job;
  },

  async get(id) {
    return await kv.get(JOB_PREFIX + id) || undefined;
  },

  async update(id, updates) {
    const job = await kv.get(JOB_PREFIX + id);
    if (!job) return undefined;
    Object.assign(job, updates, { updatedAt: Date.now() });
    await kv.set(JOB_PREFIX + job.id, job, TTL_SECONDS);
    return job;
  },
};
