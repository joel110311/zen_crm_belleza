import test from "node:test";
import assert from "node:assert/strict";
import { validateMetaMedia } from "../src/lib/meta-media-policy.ts";
import { metaCustomerWindowExpiry } from "../src/lib/meta-customer-window.ts";

test("Meta accepts its official media types and rejects QR-only formats or oversized files", () => {
    for (const [type, filename] of [["image","file.jpg"],["image","file.png"],["video","file.mp4"],["audio","file.mp3"],["audio","file.m4a"],["audio","file.aac"],["audio","file.amr"],["document","file.pdf"],["document","file.docx"],["document","file.xlsx"],["document","file.pptx"],["document","file.txt"]]) {
        assert.ok(validateMetaMedia(type, filename, 100));
    }
    for (const [type, filename] of [["image","file.webp"],["image","file.gif"],["video","file.mov"],["audio","file.wav"],["document","file.zip"],["document","file.rar"],["document","file.csv"]]) {
        assert.throws(() => validateMetaMedia(type, filename, 100), /formato/i);
    }
    for (const [type, filename, mb] of [["image","file.jpg",6],["audio","file.mp3",17],["video","file.mp4",17],["document","file.pdf",101]] as const) {
        assert.throws(() => validateMetaMedia(type, filename, mb*1024*1024), /MB/);
    }
});

test("OGG must contain mono Opus; neither Vorbis nor stereo is mislabeled as supported", () => {
    const opus = Buffer.concat([Buffer.from("OggS-OpusHead"), Buffer.from([1,1])]);
    assert.equal(validateMetaMedia("audio", "file.ogg", 100, opus), "audio/ogg; codecs=opus");
    assert.throws(() => validateMetaMedia("audio", "file.ogg", 100, Buffer.from("OggS-vorbis")), /Opus/);
    const stereo = Buffer.from(opus); stereo[stereo.length - 1] = 2;
    assert.throws(() => validateMetaMedia("audio", "file.ogg", 100, stereo), /canal/);
});

test("delayed customer messages cannot reopen a window; future timestamps cannot extend it", () => {
    const now = Date.UTC(2026,9,8,6);
    const day = 24*60*60*1000;
    assert.equal(metaCustomerWindowExpiry(new Date(now - 2*day), now).getTime(), now-day);
    assert.equal(metaCustomerWindowExpiry(new Date(now + day), now).getTime(), now+day);
    assert.equal(metaCustomerWindowExpiry(undefined, now).getTime(), now+day);
    assert.equal(metaCustomerWindowExpiry(new Date(0), now).getTime(), day);
});
