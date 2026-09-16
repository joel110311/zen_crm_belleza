import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL is required for this integration test");
}

const suffix = randomUUID();
const queueName = `bot-reply-integration-${suffix}`;
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue(queueName, { connection });
const lockKey = `bot-reply:test-lock:${suffix}`;

try {
  await queue.add(
    "process-conversation",
    { conversationId: "conversation-1", revision: 1 },
    {
      delay: 60_000,
      deduplication: {
        id: "conversation-1",
        ttl: 120_000,
        extend: true,
        replace: true,
      },
    },
  );

  await queue.add(
    "process-conversation",
    { conversationId: "conversation-1", revision: 2 },
    {
      delay: 60_000,
      deduplication: {
        id: "conversation-1",
        ttl: 120_000,
        extend: true,
        replace: true,
      },
    },
  );

  const delayed = await queue.getJobs(["delayed"]);
  assert.equal(delayed.length, 1, "only one delayed job should remain per conversation");
  assert.equal(delayed[0]?.data.revision, 2, "the delayed job should contain the newest batch data");

  const firstLock = await connection.set(lockKey, "worker-1", "PX", 120_000, "NX");
  const competingLock = await connection.set(lockKey, "worker-2", "PX", 120_000, "NX");
  assert.equal(firstLock, "OK", "the first worker should acquire the lock");
  assert.equal(competingLock, null, "a competing worker must not acquire the same lock");

  const released = await connection.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    lockKey,
    "worker-1",
  );
  assert.equal(released, 1, "only the lock owner should release the lock");

  const lockAfterRelease = await connection.set(lockKey, "worker-2", "PX", 120_000, "NX");
  assert.equal(lockAfterRelease, "OK", "another worker may acquire the lock after release");

  console.log("Redis/BullMQ integration checks passed");
} finally {
  await connection.del(lockKey);
  await queue.obliterate({ force: true });
  await queue.close();
  connection.disconnect();
}
