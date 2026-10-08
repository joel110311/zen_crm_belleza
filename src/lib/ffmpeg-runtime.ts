import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

/** The runner installs Alpine's ffmpeg; the npm static Linux binary may require glibc. */
export function ffmpegExecutable() {
    return process.env.FFMPEG_PATH?.trim() || (process.platform === "linux" ? "ffmpeg" : ffmpegStatic || "ffmpeg");
}
export async function runMediaFfmpeg(args: string[]) {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(/* turbopackIgnore: true */ ffmpegExecutable(), ["-nostdin", "-hide_banner", "-loglevel", "error", ...args]);
        let stderr = "";
        const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("La conversión multimedia excedió el tiempo máximo.")); }, 120_000);
        child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
        child.on("error", error => { clearTimeout(timer); reject(error); });
        child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(stderr || `FFmpeg terminó con código ${code}`)); });
    });
}
