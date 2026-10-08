import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { loadTsModule } from "./helpers/load-ts-module.mts";
import * as policy from "../src/lib/chat-media-policy.ts";
import { runMediaFfmpeg } from "../src/lib/ffmpeg-runtime.ts";
import * as routing from "../src/lib/tenant-request-routing.ts";
import * as adminPolicy from "../src/lib/platform-admin-policy.ts";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");
type Upload = (request: Request) => Promise<Response>;
type MediaRoute = (request: Request, context: { params: Promise<{ filename: string }> }) => Promise<Response>;

test("actual upload/media routes: >10MB MP4, real WebM→Opus, images/documents, owner checks, signed GET/HEAD and seeking", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "crm-media-route-test-"));
    let actor: { user: { id: string; authScope: string } } | null = { user: { id: "test-user", authScope: "control" } };
    let tenantId = "tenant-a";
    process.env.AUTH_SECRET = "test-only-route-signing-secret-that-is-not-a-real-key";
    const mocks = {
        "@/lib/auth": { auth: async () => actor },
        "@/lib/active-tenant-context": { getActiveTenantRuntimeContext: async () => ({ tenantId }) },
        "@/lib/authz": { getSessionUserId: () => actor?.user.id, getSessionAccessSubject: () => actor?.user },
        "@/lib/permissions": { hasAnyPermission: () => true },
        "@/lib/chat-media-policy": policy,
        "@/lib/ffmpeg-runtime": { runMediaFfmpeg },
    };
    const globals = { process: { ...process, cwd: () => root } };
    const upload = loadTsModule("src/app/api/upload/route.ts", mocks, globals).POST as Upload;
    const media = loadTsModule("src/app/api/media/[filename]/route.ts", mocks, globals);
    const get = media.GET as MediaRoute;
    const head = media.HEAD as MediaRoute;
    async function put(name: string, type: string, bytes: Buffer) {
        const form = new FormData();
        form.set("file", new File([Uint8Array.from(bytes)], name, { type }));
        form.set("purpose", "chat");
        const response = await upload(new NextRequest("https://app.test/api/upload", { method: "POST", body: form }));
        return { response, payload: await response.json() as { url: string; mediaCategory: string; mimeType: string; fileName: string; error?: string } };
    }
    async function read(filename: string, query = "", method = "GET", range?: string) {
        return (method === "HEAD" ? head : get)(new NextRequest(`https://app.test/api/media/${filename}${query ? `?${query}` : ""}`, {
            method, headers: range ? { range } : {},
        }), { params: Promise.resolve({ filename }) });
    }
    try {
        // Optional local original allows verifying Joel's real MP4 without sending it anywhere.
        const tinyVideo = path.join(root, "tiny.mp4");
        await runMediaFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", tinyVideo]);
        const padding = Buffer.alloc(10 * 1024 * 1024 + 1024);
        padding.writeUInt32BE(padding.length, 0); padding.write("free", 4);
        const videoBytes = process.env.CRM_TEST_VIDEO ? await fs.readFile(process.env.CRM_TEST_VIDEO) : Buffer.concat([await fs.readFile(tinyVideo), padding]);
        assert.ok(videoBytes.length > 10 * 1024 * 1024);
        const video = await put("demo.mp4", "video/mp4", videoBytes);
        assert.equal(video.response.status, 200);
        assert.equal(video.payload.mediaCategory, "video");
        const filename = video.payload.url.split("/").pop()!;
        const finalSize = (await fs.stat(path.join(root, "public", "uploads", filename))).size;
        assert.ok(finalSize <= 16 * 1024 * 1024);
        assert.ok(filename.startsWith(`private-t-${policy.tenantMediaNamespace("tenant-a")}-`));
        let response = await read(filename, "", "GET", "bytes=0-15");
        assert.equal(response.status, 206);
        assert.equal((await response.arrayBuffer()).byteLength, 16);
        tenantId = "tenant-b";
        assert.equal((await read(filename)).status, 404);
        actor = null;
        assert.equal((await read(filename)).status, 401);
        const signed = policy.signMediaDownload(filename);
        response = await read(filename, signed, "HEAD");
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-length"), String(finalSize));
        assert.equal((await response.arrayBuffer()).byteLength, 0);
        assert.equal((await read(filename, signed, "GET", `bytes=${finalSize}-`)).status, 416);
        const invalidSignature = new URLSearchParams(signed);
        invalidSignature.set("signature", "0".repeat(64));
        assert.equal((await read(filename, invalidSignature.toString())).status, 401);
        actor = { user: { id: "test-user", authScope: "control" } }; tenantId = "tenant-a";

        // Actual codec conversion, not simply renaming .webm to .ogg.
        const source = path.join(root, "voice.webm");
        await runMediaFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", "-c:a", "libopus", source]);
        const audio = await put("voice.webm", "audio/webm;codecs=opus", await fs.readFile(source));
        assert.equal(audio.response.status, 200);
        assert.equal(audio.payload.mediaCategory, "audio");
        assert.equal(audio.payload.mimeType, "audio/ogg");
        const audioFile = audio.payload.url.split("/").pop()!;
        const storedAudio = await fs.readFile(path.join(root, "public", "uploads", audioFile));
        assert.equal(storedAudio.subarray(0, 4).toString(), "OggS");
        assert.ok(storedAudio.includes(Buffer.from("OpusHead")));

        // An attached MP3 stays an audio file, while the microphone path above remains Opus.
        const mp3Source = path.join(root, "audio.mp3");
        await runMediaFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", "-c:a", "libmp3lame", mp3Source]);
        const mp3Bytes = await fs.readFile(process.env.CRM_TEST_AUDIO || mp3Source);
        const mp3 = await put("song.mp3", "audio/mpeg", mp3Bytes);
        assert.equal(mp3.response.status, 200);
        assert.equal(mp3.payload.mimeType, "audio/mpeg");
        assert.equal(mp3.payload.mediaCategory, "audio");
        assert.equal(mp3.payload.fileName, "song.mp3");
        assert.ok(mp3.payload.url.endsWith(".mp3"));
        assert.deepEqual(await fs.readFile(path.join(root, "public", "uploads", mp3.payload.url.split("/").pop()!)), mp3Bytes);
        assert.equal((await put("invalid.mp3", "audio/mpeg", Buffer.from("not an audio file"))).response.status, 422);

        const sharp = require("sharp");
        const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#4B5F25" } }).webp().toBuffer();
        const convertedImage = await put("image.webp", "image/webp", webp);
        assert.equal(convertedImage.response.status, 200);
        assert.equal(convertedImage.payload.mimeType, "image/png");
        const imageFile = convertedImage.payload.url.split("/").pop()!;
        assert.equal((await sharp(await fs.readFile(path.join(root, "public", "uploads", imageFile))).metadata()).format, "png");

        for (const [name, type, category] of [["image.png", "image/png", "image"], ["slides.pptx", "application/octet-stream", "document"], ["list.csv", "", "document"], ["files.zip", "application/zip", "document"]]) {
            const result = await put(name, type, Buffer.from("test"));
            assert.equal(result.response.status, 200, result.payload.error);
            assert.equal(result.payload.mediaCategory, category);
        }
        const blocked = await put("malicious.html", "text/html", Buffer.from("<script>bad</script>"));
        assert.equal(blocked.response.status, 415);
        const invalidAudio = await put("bad.webm", "audio/webm", Buffer.from("not an audio file"));
        assert.equal(invalidAudio.response.status, 422);
        const config = await fs.readFile("next.config.ts", "utf8");
        assert.match(config, /proxyClientMaxBodySize:\s*'105mb'/);
    } finally {
        assert.ok(path.basename(root).startsWith("crm-media-route-test-"));
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("media routes preserve sanitized tenant context, and static uploads cannot bypass private authorization", async () => {
    const proxy = loadTsModule("src/proxy.ts", {
        "@/lib/platform-admin-policy": adminPolicy,
        "@/lib/platform-support": { getPlatformSupportGrant: async () => null },
        "next-auth/jwt": { getToken: async () => ({ id: "owner", authScope: "control" }) },
        "@/lib/permissions": { hasPermission: () => true },
        "@/lib/tenant-request-routing": routing,
    });
    const run = proxy.proxy as (req: Request) => Promise<Response>;
    const response = await run(new NextRequest("https://app.test/uploads/private-file.png", { headers: { cookie: "synapselogik-active-business=tenant-a", "x-synapselogik-business": "forged-b" } }));
    assert.equal(response.headers.get("x-middleware-rewrite"), "https://app.test/api/media/private-file.png");
    assert.equal(response.headers.get("x-middleware-request-x-synapselogik-business"), "tenant-a");
    assert.equal(response.headers.get("x-middleware-request-x-synapselogik-user"), "owner");
});

test("the durable worker endpoint reaches its own secret guard without a browser session; forged headers are stripped", async () => {
    const loaded = loadTsModule("src/proxy.ts", {
        "@/lib/platform-admin-policy": adminPolicy,
        "@/lib/platform-support": { getPlatformSupportGrant: async () => null },
        "next-auth/jwt": { getToken: async () => null },
        "@/lib/permissions": { hasPermission: () => false },
        "@/lib/tenant-request-routing": routing,
    });
    const proxy = loaded.proxy as (req: Request) => Promise<Response>;
    const response = await proxy(new NextRequest("https://app.test/api/internal/tenant-inbound-message", { method: "POST", headers: { "x-synapselogik-business": "forged", "x-synapselogik-user": "forged" } }));
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(response.headers.get("x-middleware-request-x-synapselogik-business"), null);
    const endpoint = loadTsModule("src/app/api/internal/tenant-inbound-message/route.ts", {
        "@/lib/multitenant-features": { isMultitenantRuntimeEnabled: () => true },
        "@/lib/tenant-inbound-processing": { processTenantInboundWebhookEvent: async () => ({ duplicate: false }) },
    }, { process: { ...process, env: { SECURITY_HASH_SALT: "test-only-worker-secret" } } });
    const post = endpoint.POST as Upload;
    const denied = await post(new NextRequest("https://app.test/api/internal/tenant-inbound-message", { method: "POST", body: JSON.stringify({ tenantId: "a", webhookEventId: "event" }), headers: { "content-type": "application/json" } }));
    assert.equal(denied.status, 404);
    const allowed = await post(new NextRequest("https://app.test/api/internal/tenant-inbound-message", { method: "POST", body: JSON.stringify({ tenantId: "a", webhookEventId: "event" }), headers: { "content-type": "application/json", "x-tenant-worker-secret": "test-only-worker-secret" } }));
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).success, true);
});
