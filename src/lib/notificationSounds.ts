// Notification sound generator using Web Audio API
// All sounds are generated programmatically - zero copyright issues

export type NotificationSoundType = "gentle" | "bright" | "soft";

export const NOTIFICATION_SOUNDS: { id: NotificationSoundType; name: string; description: string }[] = [
    { id: "gentle", name: "Suave", description: "Tono gentil y melodioso" },
    { id: "bright", name: "Brillante", description: "Tono brillante y claro" },
    { id: "soft", name: "Burbuja", description: "Efecto tipo burbuja" },
];

// Storage keys
const PREFS_KEY = "talosflow_notification_prefs";

export interface NotificationPrefs {
    enabled: boolean;
    soundType: NotificationSoundType;
    volume: number; // 0-1
}

const DEFAULT_PREFS: NotificationPrefs = {
    enabled: true,
    soundType: "gentle",
    volume: 0.5,
};

export function getNotificationPrefs(): NotificationPrefs {
    if (typeof window === "undefined") return DEFAULT_PREFS;
    try {
        const stored = localStorage.getItem(PREFS_KEY);
        if (stored) return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
    } catch { }
    return DEFAULT_PREFS;
}

export function saveNotificationPrefs(prefs: NotificationPrefs): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// Audio context singleton
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
    if (!audioCtx || audioCtx.state === "closed") {
        audioCtx = new AudioContext();
    }
    return audioCtx;
}

// Play a gentle melodic notification (two ascending notes)
function playGentle(volume: number) {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    // Note 1: C5 (523 Hz)
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523, now);
    osc1.connect(gain);

    // Note 2: E5 (659 Hz)
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(659, now + 0.12);
    osc2.connect(gain);

    // Volume envelope
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume * 0.4, now + 0.02);
    gain.gain.linearRampToValueAtTime(volume * 0.3, now + 0.1);
    gain.gain.linearRampToValueAtTime(volume * 0.4, now + 0.14);
    gain.gain.linearRampToValueAtTime(0, now + 0.4);

    osc1.start(now);
    osc1.stop(now + 0.12);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.4);
}

// Play a bright two-tone chime (like a door chime)
function playBright(volume: number) {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Two simultaneous tones with harmonics
    const frequencies = [
        { freq: 880, delay: 0, duration: 0.15 },   // A5
        { freq: 1109, delay: 0.08, duration: 0.2 }, // C#6
        { freq: 1319, delay: 0.16, duration: 0.25 }, // E6
    ];

    frequencies.forEach(({ freq, delay, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + delay);
        gain.gain.setValueAtTime(0, now + delay);
        gain.gain.linearRampToValueAtTime(volume * 0.3, now + delay + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + duration);
    });
}

// Play a soft bubble pop sound
function playSoft(volume: number) {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Main bubble tone
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume * 0.35, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(volume * 0.15, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);

    // Subtle overtone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1200, now + 0.03);
    osc2.frequency.exponentialRampToValueAtTime(1600, now + 0.1);

    gain2.gain.setValueAtTime(0, now + 0.03);
    gain2.gain.linearRampToValueAtTime(volume * 0.1, now + 0.04);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.03);
    osc2.stop(now + 0.2);
}

export function playNotificationSound(type: NotificationSoundType = "gentle", volume = 0.5): void {
    try {
        const ctx = getAudioContext();
        // Resume if suspended (browser autoplay policy)
        if (ctx.state === "suspended") {
            ctx.resume();
        }

        switch (type) {
            case "gentle": playGentle(volume); break;
            case "bright": playBright(volume); break;
            case "soft": playSoft(volume); break;
        }
    } catch (err) {
        console.error("Failed to play notification sound:", err);
    }
}

// Play notification if preferences allow
export function maybePlayNotification(isChatMuted: boolean): void {
    const prefs = getNotificationPrefs();
    if (!prefs.enabled || isChatMuted) return;
    playNotificationSound(prefs.soundType, prefs.volume);
}
