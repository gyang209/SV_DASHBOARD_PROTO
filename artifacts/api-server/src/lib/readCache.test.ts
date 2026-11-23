import assert from "node:assert/strict";
import test from "node:test";
import { createReadCache } from "./readCache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("cold reads coalesce and stale reads return immediately during one refresh", async () => {
  let time = 0;
  let calls = 0;
  let next = deferred<number>();
  const cache = createReadCache(() => { calls++; return next.promise; }, {
    freshMs: 20, staleMs: 40, now: () => time, onRefreshError: assert.fail,
  });
  const first = cache.get();
  const second = cache.get();
  next.resolve(1);
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(calls, 1);
  next = deferred<number>();
  time = 21;
  assert.deepEqual(await Promise.all([cache.get(), cache.get()]), [1, 1]);
  assert.equal(calls, 2);
  next.resolve(2);
  // An expired read waits for the in-flight refresh.
  time = 61;
  assert.equal(await cache.get(), 2);
});

test("invalidation prevents an older in-flight read from repopulating the cache", async () => {
  const old = deferred<number>();
  const fresh = deferred<number>();
  let calls = 0;
  const cache = createReadCache(() => (++calls === 1 ? old.promise : fresh.promise), {
    freshMs: 20, staleMs: 40, onRefreshError: assert.fail,
  });
  const original = cache.get();
  await Promise.resolve();
  cache.invalidate();
  const current = cache.get();
  fresh.resolve(2);
  assert.equal(await current, 2);
  old.resolve(1);
  assert.equal(await original, 1);
  assert.equal(await cache.get(), 2);
  assert.equal(calls, 2);
});

test("forced reads bypass cached data", async () => {
  let value = 0;
  const cache = createReadCache(async () => ++value, {
    freshMs: 20, staleMs: 40, onRefreshError: assert.fail,
  });
  assert.equal(await cache.get(), 1);
  assert.equal(await cache.get(true), 2);
});

test("background failures are reported and expired reads reject instead of serving stale data", async () => {
  let time = 0;
  let fail = false;
  const errors: unknown[] = [];
  const cache = createReadCache(async () => {
    if (fail) throw new Error("Upstream unavailable");
    return 1;
  }, { freshMs: 20, staleMs: 40, now: () => time, onRefreshError: (err) => errors.push(err) });
  await cache.get();
  fail = true;
  time = 21;
  assert.equal(await cache.get(), 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  time = 60;
  await assert.rejects(cache.get(), /Upstream unavailable/);
});

test("rate limits serve bounded stale data and back off retries", async () => {
  let time = 0;
  let calls = 0;
  let fail = false;
  let value = "fresh";
  const cache = createReadCache(async () => {
    calls += 1;
    if (fail) throw Object.assign(new Error("Too many requests"), { status: 429 });
    return value;
  }, {
    freshMs: 20,
    staleMs: 20,
    maxStaleMs: 200,
    rateLimitBackoffMs: 50,
    now: () => time,
    onRefreshError: () => {},
  });

  assert.equal(await cache.get(), "fresh");
  fail = true;
  time = 41;
  assert.equal(await cache.get(), "fresh");
  assert.equal(calls, 2);
  time = 60;
  assert.equal(await cache.get(), "fresh");
  assert.equal(calls, 2);

  value = "recovered";
  fail = false;
  time = 92;
  assert.equal(await cache.get(), "recovered");
  assert.equal(calls, 3);
});

test("rate-limit fallback expires at its configured maximum age", async () => {
  let time = 0;
  const cache = createReadCache(async () => {
    if (time > 0) throw Object.assign(new Error("Too many requests"), { status: 429 });
    return "cached";
  }, {
    freshMs: 10,
    staleMs: 10,
    maxStaleMs: 50,
    rateLimitBackoffMs: 5,
    now: () => time,
    onRefreshError: () => {},
  });

  assert.equal(await cache.get(), "cached");
  time = 51;
  await assert.rejects(cache.get(), /Too many requests/);
});

test("cold rate limits are negatively cached during the backoff window", async () => {
  let calls = 0;
  const cache = createReadCache(async () => {
    calls += 1;
    throw Object.assign(new Error("Too many requests"), { status: 429 });
  }, {
    freshMs: 10,
    staleMs: 10,
    maxStaleMs: 50,
    rateLimitBackoffMs: 100,
    now: () => 0,
    onRefreshError: () => {},
  });

  await assert.rejects(cache.get(), /Too many requests/);
  await assert.rejects(cache.get(), /Too many requests/);
  assert.equal(calls, 1);
});
