from __future__ import annotations

import asyncio
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import cv2
import numpy as np
from rapidocr_onnxruntime import RapidOCR
import edge_tts


ROOT = Path(__file__).resolve().parents[1]
SHOT_DIR = ROOT / "tmp" / "marketing-shots-dev"
SAFE_SHOT_DIR = ROOT / "tmp" / "marketing-shots-dev-safe"
OUT_DIR = ROOT / "marketing" / "ad-crm-impacto-2026-04-26-v2"
SCENE_DIR = OUT_DIR / "scenes"
FFMPEG = ROOT / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"
FFPROBE = FFMPEG.parent / "ffprobe.exe"
FONT_BOLD = "C\\:/Windows/Fonts/segoeuib.ttf"
FONT_REGULAR = "C\\:/Windows/Fonts/segoeui.ttf"
VOICE = "es-MX-DaliaNeural"
VOICE_RATE = "-8%"
FPS = 30
MASTER_DURATION = 120.0


@dataclass
class Scene:
    file: str
    duration: float
    caption: str
    voice: str
    focus_start: tuple[float, float]
    focus_end: tuple[float, float]
    zoom_start: float = 1.0
    zoom_end: float = 1.18


SCENES: list[Scene] = [
    Scene(
        file="01-dashboard.png",
        duration=7.5,
        caption="Operacion comercial en tiempo real",
        voice=(
            "Este CRM esta pensado para equipos que venden y atienden por WhatsApp "
            "todos los dias, con contexto comercial en tiempo real."
        ),
        focus_start=(0.47, 0.46),
        focus_end=(0.55, 0.52),
        zoom_start=1.00,
        zoom_end=1.12,
    ),
    Scene(
        file="02-inbox.png",
        duration=7.5,
        caption="Inbox unificado: IA y humano",
        voice=(
            "En el dashboard priorizas actividad, embudos y pendientes para que el equipo "
            "enfoque su energia en oportunidades reales de cierre."
        ),
        focus_start=(0.36, 0.44),
        focus_end=(0.58, 0.54),
        zoom_start=1.00,
        zoom_end=1.20,
    ),
    Scene(
        file="03-inbox-contact-panel.png",
        duration=7.5,
        caption="Contexto del contacto al instante",
        voice=(
            "El inbox centraliza conversaciones, adjuntos y notas, y en paralelo el panel "
            "lateral revela historial para responder mejor desde el primer mensaje."
        ),
        focus_start=(0.52, 0.45),
        focus_end=(0.73, 0.54),
        zoom_start=1.02,
        zoom_end=1.22,
    ),
    Scene(
        file="04-brain-config.png",
        duration=7.5,
        caption="Cerebro IA configurable",
        voice=(
            "Con Cerebro IA defines personalidad, reglas y limites operativos para automatizar "
            "respuestas sin perder el tono comercial de tu marca."
        ),
        focus_start=(0.20, 0.48),
        focus_end=(0.36, 0.51),
        zoom_start=1.00,
        zoom_end=1.19,
    ),
    Scene(
        file="05-brain-knowledge.png",
        duration=7.5,
        caption="Conocimiento editable y reutilizable",
        voice=(
            "La base de conocimiento acepta texto directo y mantiene una version editable para "
            "que ajustes rapidamente lo que aprende el bot."
        ),
        focus_start=(0.45, 0.38),
        focus_end=(0.67, 0.45),
        zoom_start=1.00,
        zoom_end=1.20,
    ),
    Scene(
        file="06-brain-catalog.png",
        duration=7.5,
        caption="Catalogo y fuentes listas para indexar",
        voice=(
            "Tambien indexas fuentes web y catalogo operativo para convertir documentacion "
            "interna en respuestas utiles para ventas y soporte."
        ),
        focus_start=(0.44, 0.40),
        focus_end=(0.64, 0.46),
        zoom_start=1.00,
        zoom_end=1.20,
    ),
    Scene(
        file="07-pipeline.png",
        duration=7.5,
        caption="Pipeline visual con foco en conversion",
        voice=(
            "El pipeline visual permite mover oportunidades por etapa, identificar cuellos "
            "de botella y saber exactamente donde actuar primero."
        ),
        focus_start=(0.34, 0.46),
        focus_end=(0.59, 0.48),
        zoom_start=1.00,
        zoom_end=1.21,
    ),
    Scene(
        file="08-pipeline-detail.png",
        duration=7.5,
        caption="Detalle de oportunidad y seguimiento",
        voice=(
            "Cada oportunidad concentra seguimiento comercial, notas y proximos pasos para "
            "avanzar con orden y aumentar la tasa de cierre."
        ),
        focus_start=(0.50, 0.42),
        focus_end=(0.67, 0.46),
        zoom_start=1.02,
        zoom_end=1.24,
    ),
    Scene(
        file="09-calendar.png",
        duration=7.5,
        caption="Agenda comercial sincronizada",
        voice=(
            "Con la agenda integrada coordinas citas, recordatorios y compromisos sin perder "
            "ritmo en el proceso de ventas."
        ),
        focus_start=(0.40, 0.46),
        focus_end=(0.58, 0.52),
        zoom_start=1.00,
        zoom_end=1.19,
    ),
    Scene(
        file="10-contacts.png",
        duration=7.5,
        caption="Vista 360 de cada contacto",
        voice=(
            "La seccion de contactos centraliza perfil, etiquetas y contexto para ejecutar "
            "seguimiento personalizado y campañas mejor segmentadas."
        ),
        focus_start=(0.30, 0.43),
        focus_end=(0.53, 0.52),
        zoom_start=1.00,
        zoom_end=1.21,
    ),
    Scene(
        file="11-templates.png",
        duration=7.5,
        caption="Plantillas para responder mas rapido",
        voice=(
            "Las plantillas reducen tiempos de respuesta, estandarizan comunicacion y liberan "
            "a tu equipo para conversaciones de mayor valor."
        ),
        focus_start=(0.44, 0.40),
        focus_end=(0.64, 0.48),
        zoom_start=1.00,
        zoom_end=1.20,
    ),
    Scene(
        file="12-campaigns.png",
        duration=7.5,
        caption="Campanas masivas con control",
        voice=(
            "Desde campanas masivas ejecutas envios segmentados, mides resultados y mejoras "
            "la operacion sin sacrificar control."
        ),
        focus_start=(0.45, 0.44),
        focus_end=(0.66, 0.49),
        zoom_start=1.01,
        zoom_end=1.22,
    ),
    Scene(
        file="13-settings.png",
        duration=7.5,
        caption="Configuracion centralizada",
        voice=(
            "En configuracion concentras usuarios, permisos y parametros del sistema para "
            "escala ordenada a medida que crece el equipo."
        ),
        focus_start=(0.30, 0.44),
        focus_end=(0.43, 0.48),
        zoom_start=1.00,
        zoom_end=1.18,
    ),
    Scene(
        file="14-settings-whatsapp.png",
        duration=7.5,
        caption="Conexion WhatsApp por QR",
        voice=(
            "La conexion de WhatsApp por QR te permite habilitar lineas con rapidez y mantener "
            "la continuidad del canal comercial."
        ),
        focus_start=(0.44, 0.43),
        focus_end=(0.69, 0.47),
        zoom_start=1.02,
        zoom_end=1.23,
    ),
    Scene(
        file="15-settings-calendar.png",
        duration=7.5,
        caption="Google Calendar integrado",
        voice=(
            "Con Google Calendar integrado, ventas y agenda trabajan sincronizadas para evitar "
            "fricciones en citas y seguimientos."
        ),
        focus_start=(0.46, 0.43),
        focus_end=(0.70, 0.47),
        zoom_start=1.02,
        zoom_end=1.23,
    ),
    Scene(
        file="01-dashboard.png",
        duration=7.5,
        caption="De chats sueltos a cierres predecibles",
        voice=(
            "Resultado: pasas de conversaciones dispersas a una operacion comercial completa, "
            "medible y lista para escalar con IA."
        ),
        focus_start=(0.52, 0.49),
        focus_end=(0.57, 0.54),
        zoom_start=1.00,
        zoom_end=1.17,
    ),
]

PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d().\-\s]{7,}\d)(?!\w)")
PHONE_JID_RE = re.compile(r"\b\d{9,15}@s\.whatsapp\.net\b", re.IGNORECASE)
PHONE_HINT_RE = re.compile(r"\b(tel|telefono|cel|celular|phone|whatsapp|movil|contacto)\b", re.IGNORECASE)
CURRENCY_HINT_RE = re.compile(r"[$€£%]|mxn|usd|eur|total|saldo|monto|precio|iva", re.IGNORECASE)
LETTER_RE = re.compile(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]")
DIGIT_RE = re.compile(r"\d")


def normalize_points(points: Iterable) -> tuple[int, int, int, int]:
    arr = np.array(points, dtype=np.float32).reshape(-1, 2)
    x1 = int(np.floor(arr[:, 0].min()))
    y1 = int(np.floor(arr[:, 1].min()))
    x2 = int(np.ceil(arr[:, 0].max()))
    y2 = int(np.ceil(arr[:, 1].max()))
    return x1, y1, x2, y2


def blur_rect(image: np.ndarray, rect: tuple[int, int, int, int], pad: int = 6) -> None:
    h, w = image.shape[:2]
    x1, y1, x2, y2 = rect
    x1 = max(0, x1 - pad)
    y1 = max(0, y1 - pad)
    x2 = min(w, x2 + pad)
    y2 = min(h, y2 + pad)
    if x2 <= x1 or y2 <= y1:
        return
    roi = image[y1:y2, x1:x2]
    if roi.size == 0:
        return
    image[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (0, 0), sigmaX=10, sigmaY=10)


def looks_like_phone(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False

    lower = t.lower()
    if PHONE_JID_RE.search(lower):
        return True

    if "@" in lower and "whatsapp" not in lower:
        return False

    if CURRENCY_HINT_RE.search(lower):
        return False

    digits = re.sub(r"\D", "", t)
    if len(digits) < 10 or len(digits) > 15:
        return False

    has_separators = bool(re.search(r"[+\-()\s]", t))

    if not has_separators:
        return bool(re.fullmatch(r"\d{10,13}", digits))

    if PHONE_RE.search(t):
        return True

    compact = re.sub(r"[^\d+]", "", t)
    return bool(re.fullmatch(r"\+?\d{9,15}", compact))


def extract_ocr_lines(engine: RapidOCR, image: np.ndarray) -> list[dict]:
    result, _ = engine(image)
    lines: list[dict] = []
    if not result:
        return lines

    for item in result:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        points = item[0]
        text = str(item[1] or "").strip()
        if not text:
            continue
        x1, y1, x2, y2 = normalize_points(points)
        lines.append({"text": text, "rect": (x1, y1, x2, y2)})
    return lines


def auto_blur_phone_numbers(engine: RapidOCR, src: Path, dst: Path) -> int:
    image = cv2.imread(str(src))
    if image is None:
        raise RuntimeError(f"No se pudo abrir imagen: {src}")

    lines = extract_ocr_lines(engine, image)
    blurred = 0
    for line in lines:
        if looks_like_phone(line["text"]):
            rect = adjust_phone_rect(line["text"], line["rect"])
            blur_rect(image, rect, pad=3)
            blurred += 1

    dst.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dst), image)
    return blurred


def adjust_phone_rect(text: str, rect: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = rect
    if x2 <= x1 or y2 <= y1:
        return rect

    if LETTER_RE.search(text) and DIGIT_RE.search(text):
        width = x2 - x1
        x1 = x1 + int(width * 0.42)
    return x1, y1, x2, y2


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def probe_duration(path: Path) -> float:
    if FFPROBE.exists():
        result = subprocess.run(
            [
                str(FFPROBE),
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        try:
            return float(result.stdout.strip())
        except ValueError:
            return 0.0

    result = subprocess.run(
        [str(FFMPEG), "-i", str(path)],
        check=False,
        capture_output=True,
        text=True,
    )
    joined = f"{result.stdout}\n{result.stderr}"
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", joined)
    if not match:
        return 0.0
    hours = int(match.group(1))
    minutes = int(match.group(2))
    seconds = float(match.group(3))
    return (hours * 3600) + (minutes * 60) + seconds


def escape_drawtext(text: str) -> str:
    text = text.replace("\\", r"\\")
    text = text.replace(":", r"\:")
    text = text.replace("'", r"\'")
    text = text.replace("%", r"\%")
    text = text.replace("\n", r"\\n")
    return text


def wrap_caption(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def build_scene_filter(scene: Scene, frames: int) -> str:
    duration = max(1.0, scene.duration)
    frame_span = max(1, frames - 1)
    zoom_delta = scene.zoom_end - scene.zoom_start
    fx0, fy0 = scene.focus_start
    fx1, fy1 = scene.focus_end

    zoom_expr = f"({scene.zoom_start:.6f}+({zoom_delta:.6f})*(on/{frame_span}))"
    fx_expr = f"({fx0:.6f}+({fx1 - fx0:.6f})*(on/{frame_span}))"
    fy_expr = f"({fy0:.6f}+({fy1 - fy0:.6f})*(on/{frame_span}))"
    pan_x = f"max(0,min(iw-iw/zoom,(({fx_expr})*iw)-iw/zoom/2))"
    pan_y = f"max(0,min(ih-ih/zoom,(({fy_expr})*ih)-ih/zoom/2))"

    caption = escape_drawtext(wrap_caption(scene.caption))
    fade_out_start = max(0.0, scene.duration - 0.36)

    filters = [
        "scale=-1:1920:flags=lanczos",
        (
            "zoompan="
            f"z='{zoom_expr}':"
            f"x='{pan_x}':"
            f"y='{pan_y}':"
            f"d={frames}:"
            "s=1080x1920:"
            f"fps={FPS}"
        ),
        "scale=1080:1920:flags=lanczos",
        "eq=saturation=1.06:contrast=1.04:brightness=0.01",
        "drawbox=x=0:y=0:w=iw:h=286:color=0x061225CC:t=fill",
        "drawbox=x=0:y=ih-320:w=iw:h=320:color=0x061225CC:t=fill",
        (
            "drawtext="
            f"fontfile='{FONT_BOLD}':"
            f"text='{caption}':"
            "fontcolor=white:"
            "fontsize=54:"
            "line_spacing=8:"
            "x=(w-text_w)/2:"
            "y=84:"
            "shadowcolor=0x000000CC:"
            "shadowx=2:"
            "shadowy=2"
        ),
        (
            "drawtext="
            f"fontfile='{FONT_REGULAR}':"
            "text='ZenCRM | WhatsApp + IA + Ventas':"
            "fontcolor=0x9FDBFF:"
            "fontsize=36:"
            "x=(w-text_w)/2:"
            "y=h-184:"
            "shadowcolor=0x000000AA:"
            "shadowx=1:"
            "shadowy=1"
        ),
        "drawbox=x=84:y=h-126:w=912:h=6:color=0x1B3B63AA:t=fill",
        f"drawbox=x=84:y=h-126:w=912*(t/{duration:.6f}):h=6:color=0x36B8FFDD:t=fill",
        "fade=t=in:st=0:d=0.32",
        f"fade=t=out:st={fade_out_start:.6f}:d=0.36",
        "format=yuv420p",
    ]
    return ",".join(filters)


def build_scene_clip(scene: Scene, index: int) -> Path:
    src = SAFE_SHOT_DIR / scene.file
    if not src.exists():
        raise FileNotFoundError(f"Falta screenshot: {src}")

    out_file = SCENE_DIR / f"scene_{index + 1:02d}.mp4"
    frames = max(2, int(round(scene.duration * FPS)))
    vf = build_scene_filter(scene, frames=frames)
    run(
        [
            str(FFMPEG),
            "-y",
            "-loop",
            "1",
            "-i",
            str(src),
            "-vf",
            vf,
            "-frames:v",
            str(frames),
            "-r",
            str(FPS),
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-movflags",
            "+faststart",
            str(out_file),
        ]
    )
    return out_file


def write_concat_file(files: list[Path], target: Path) -> None:
    lines: list[str] = []
    for file in files:
        lines.append(f"file '{file.resolve().as_posix()}'")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")


def concat_scene_clips(files: list[Path], out_file: Path) -> None:
    concat_file = OUT_DIR / "concat_master.txt"
    write_concat_file(files, concat_file)
    run(
        [
            str(FFMPEG),
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-r",
            str(FPS),
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-movflags",
            "+faststart",
            str(out_file),
        ]
    )


def build_voice_text() -> str:
    intro = (
        "Cuando tu negocio depende de WhatsApp, necesitas algo mas que una bandeja de entrada. "
        "Necesitas control comercial, automatizacion y seguimiento en un solo lugar."
    )
    body = " ".join(scene.voice for scene in SCENES)
    outro = (
        "Con ZenCRM conviertes conversaciones en oportunidades reales y escalas tu operacion "
        "sin perder velocidad ni calidad de atencion."
    )
    return f"{intro} {body} {outro}"


async def save_voiceover(text: str, out_file: Path) -> None:
    out_file.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(text=text, voice=VOICE, rate=VOICE_RATE)
    await communicate.save(str(out_file))


def mux_voiceover(video_file: Path, narration_file: Path, out_file: Path, duration: float) -> None:
    filter_complex = (
        "[1:a]"
        "highpass=f=80,"
        "lowpass=f=12000,"
        "acompressor=threshold=-20dB:ratio=2.4:attack=15:release=180,"
        "alimiter=limit=0.95,"
        "apad=pad_dur=4"
        "[a]"
    )

    run(
        [
            str(FFMPEG),
            "-y",
            "-i",
            str(video_file),
            "-i",
            str(narration_file),
            "-filter_complex",
            filter_complex,
            "-map",
            "0:v:0",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-t",
            f"{duration:.3f}",
            str(out_file),
        ]
    )


def build_vertical_cut(master_file: Path, out_file: Path, start: float, duration: float) -> None:
    run(
        [
            str(FFMPEG),
            "-y",
            "-ss",
            f"{start:.3f}",
            "-i",
            str(master_file),
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(out_file),
        ]
    )


def ensure_safe_shots() -> None:
    SAFE_SHOT_DIR.mkdir(parents=True, exist_ok=True)
    ocr_engine = RapidOCR()

    source_files = sorted({scene.file for scene in SCENES})
    for name in source_files:
        src = SHOT_DIR / name
        if not src.exists():
            raise FileNotFoundError(f"No existe screenshot requerido: {src}")
        dst = SAFE_SHOT_DIR / name
        blurred = auto_blur_phone_numbers(ocr_engine, src, dst)
        print(f"[safe] {name}: {blurred} posible(s) telefono(s) ofuscado(s)")


def main() -> None:
    if not FFMPEG.exists():
        raise RuntimeError(f"No se encontro ffmpeg en: {FFMPEG}")
    if not SHOT_DIR.exists():
        raise RuntimeError(f"No existe carpeta de screenshots: {SHOT_DIR}")

    total_scene_duration = sum(scene.duration for scene in SCENES)
    if abs(total_scene_duration - MASTER_DURATION) > 0.2:
        raise RuntimeError(
            f"Duracion objetivo invalida: escenas={total_scene_duration:.3f}s, esperada={MASTER_DURATION:.3f}s"
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SCENE_DIR.mkdir(parents=True, exist_ok=True)

    ensure_safe_shots()

    scene_clips: list[Path] = []
    for idx, scene in enumerate(SCENES):
        print(f"[scene] {idx + 1:02d}/{len(SCENES)} -> {scene.file}")
        scene_clips.append(build_scene_clip(scene, idx))

    base_video = OUT_DIR / "zencrm-ad-120s-vertical-phone-safe-base.mp4"
    concat_scene_clips(scene_clips, base_video)

    narration_text = build_voice_text()
    narration_file = OUT_DIR / "zencrm-ad-120s-voice.mp3"
    asyncio.run(save_voiceover(narration_text, narration_file))

    voice_duration = probe_duration(narration_file)
    print(f"[voice] duracion aproximada: {voice_duration:.2f}s")

    master = OUT_DIR / "zencrm-ad-120s-vertical-phone-safe.mp4"
    mux_voiceover(base_video, narration_file, master, duration=MASTER_DURATION)

    tiktok = OUT_DIR / "zencrm-ad-tiktok-vertical-phone-safe-58s.mp4"
    youtube_shorts = OUT_DIR / "zencrm-ad-youtube-shorts-vertical-phone-safe-58s.mp4"
    build_vertical_cut(master, tiktok, start=0.0, duration=58.0)
    build_vertical_cut(master, youtube_shorts, start=22.0, duration=58.0)

    print("OK: anuncios v2 generados")
    print(f"MASTER: {master}")
    print(f"TIKTOK: {tiktok}")
    print(f"SHORTS: {youtube_shorts}")


if __name__ == "__main__":
    main()
