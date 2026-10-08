import test from "node:test";
import assert from "node:assert/strict";
import { localMediaFilename, mediaOwnedByTenant, parseMediaRange, signMediaDownload, tenantMediaNamespace, verifyMediaDownload } from "../src/lib/chat-media-policy.ts";

test("temporary provider URLs bind filename and expiration, cannot be reused for another tenant's file", () => {
    process.env.AUTH_SECRET = "test-only-media-signing-secret-that-is-not-a-real-key";
    const filename = `private-t-${tenantMediaNamespace("a")}-id.mp4`;
    const now = Date.now();
    const query = new URLSearchParams(signMediaDownload(filename, now));
    assert.equal(verifyMediaDownload(filename, query, now), true);
    assert.equal(verifyMediaDownload(filename.replace("id.mp4", "other.mp4"), query, now), false);
    assert.equal(verifyMediaDownload(filename, query, now + 3_601_000), false);
    query.set("expires", "9999999999999");
    assert.equal(verifyMediaDownload(filename, query, now), false);
    assert.equal(mediaOwnedByTenant(filename, "a"), true);
    assert.equal(mediaOwnedByTenant(filename, "b"), false);
    assert.equal(mediaOwnedByTenant(filename, null), false);
});

test("only same-origin media paths resolve from disk; no traversal, remote aliases or query confusion", () => {
    assert.equal(localMediaFilename("https://app.test/api/media/a.mp4?signature=x", "https://app.test"), "a.mp4");
    assert.equal(localMediaFilename("/uploads/a.ogg", "https://app.test"), "a.ogg");
    assert.equal(localMediaFilename("https://other.test/api/media/a.mp4", "https://app.test"), null);
    assert.equal(localMediaFilename("/api/media/%2E%2E%2Fsecret", "https://app.test"), null);
    assert.equal(localMediaFilename("/etc/passwd", "https://app.test"), null);
});

test("audio/video ranges support seeking and reject invalid/multiple ranges", () => {
    assert.deepEqual(parseMediaRange("bytes=20-29", 100), { start: 20, end: 29 });
    assert.deepEqual(parseMediaRange("bytes=-10", 100), { start: 90, end: 99 });
    assert.deepEqual(parseMediaRange("bytes=95-", 100), { start: 95, end: 99 });
    assert.equal(parseMediaRange("bytes=100-", 100), false);
    assert.equal(parseMediaRange("bytes=20-10", 100), false);
    assert.equal(parseMediaRange("bytes=0-2,5-8", 100), false);
});
