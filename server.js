// server.js - Backend do Video Downloader (YouTube)
// Uses youtubei.js for metadata + yt-dlp for actual downloads
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import { Innertube } from 'youtubei.js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure ffmpeg binary path
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const MAX_CONCURRENT_JOBS = Number(process.env.MAX_CONCURRENT_JOBS) || 3;

// ─── Constants & Utils ───────────────────────────────────────

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// Domínios permitidos para download (SSRF protection)
const ALLOWED_HOSTS = [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
];

/**
 * Valida se a URL fornecida pertence a um domínio permitido.
 */
function validateVideoUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return { valid: false, reason: 'URL não fornecida.' };
    }
    if (rawUrl.length > 2048) {
        return { valid: false, reason: 'URL muito longa.' };
    }
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return { valid: false, reason: 'URL inválida.' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { valid: false, reason: 'Protocolo não permitido.' };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.includes(hostname)) {
        return { valid: false, reason: 'Apenas links do YouTube são suportados.' };
    }
    return { valid: true };
}

/**
 * Extrai o ID do vídeo a partir de uma URL do YouTube.
 */
function extractVideoId(url) {
    const match = url.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\n?#]+)/
    );
    return match ? match[1] : null;
}

/**
 * Remove caracteres perigosos de nomes de arquivo.
 */
function sanitizeFilename(filename) {
    if (!filename) return 'download';
    return filename
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .replace(/[\s]+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^[._]+|[._]+$/g, '')
        .substring(0, 80) || 'download';
}

/**
 * Gera um valor seguro para o header Content-Disposition.
 */
function buildContentDisposition(filename) {
    const safe = sanitizeFilename(filename);
    const asciiName = safe.replace(/[^\x20-\x7E]/g, '_');
    const encoded = encodeURIComponent(safe);
    return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

/**
 * Formata bytes em representação legível.
 */
function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return 'Tamanho desconhecido';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Formata duração em segundos para string legível.
 */
function formatDuration(seconds) {
    const s = Math.floor(Number(seconds) || 0);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Determina extensão e label de formato a partir do mimeType.
 */
function resolveFormat(mimeType, type) {
    const mime = (mimeType || '').toLowerCase();
    if (type === 'audio') {
        if (mime.includes('mp4') || mime.includes('m4a')) {
            return { extension: 'm4a', label: 'M4A', contentType: 'audio/mp4' };
        }
        return { extension: 'webm', label: 'WebM', contentType: 'audio/webm' };
    }
    if (mime.includes('webm')) {
        return { extension: 'webm', label: 'WebM', contentType: 'video/webm' };
    }
    return { extension: 'mp4', label: 'MP4', contentType: 'video/mp4' };
}

/**
 * Extrai o nome do codec de um mimeType.
 */
function extractCodecName(mimeType) {
    const mime = (mimeType || '').toLowerCase();
    if (mime.includes('avc1')) return 'H.264';
    if (mime.includes('av01')) return 'AV1';
    if (mime.includes('vp9')) return 'VP9';
    if (mime.includes('vp8')) return 'VP8';
    if (mime.includes('opus')) return 'Opus';
    if (mime.includes('mp4a')) return 'AAC';
    if (mime.includes('vorbis')) return 'Vorbis';
    return 'Unknown';
}

/**
 * Garante que o diretório de downloads existe.
 */
function ensureDownloadsDir() {
    if (!fs.existsSync(DOWNLOADS_DIR)) {
        fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
        console.log('📁 Diretório de downloads criado:', DOWNLOADS_DIR);
    }
    return DOWNLOADS_DIR;
}

/**
 * Gera um caminho temporário único dentro de downloads/.
 */
function generateTempPath(extension) {
    ensureDownloadsDir();
    return path.join(DOWNLOADS_DIR, `${uuidv4()}.${extension}`);
}

/**
 * Remove arquivos temporários de forma segura.
 */
function cleanupFiles(...filePaths) {
    for (const fp of filePaths) {
        if (!fp) continue;
        try {
            if (fs.existsSync(fp)) {
                fs.unlinkSync(fp);
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error(`Erro ao remover ${path.basename(fp)}:`, err.message);
            }
        }
    }
}

/**
 * Remove arquivos mais antigos que maxAge do diretório de downloads.
 */
function cleanupOldDownloads(maxAge = 3600000) {
    if (!fs.existsSync(DOWNLOADS_DIR)) return;
    let files;
    try {
        files = fs.readdirSync(DOWNLOADS_DIR);
    } catch {
        return;
    }
    const now = Date.now();
    for (const file of files) {
        const filePath = path.join(DOWNLOADS_DIR, file);
        try {
            const stats = fs.statSync(filePath);
            if (now - stats.mtime.getTime() > maxAge) {
                fs.unlinkSync(filePath);
                console.log(`🗑️ Arquivo antigo removido: ${file}`);
            }
        } catch (error) {
            console.error(`Erro ao remover arquivo ${file}:`, error.message);
        }
    }
}

/**
 * Extrai a taxa de bits de áudio (em kbps) de um formato adaptativo.
 */
function getAudioBitrateKbps(format) {
    if (format.average_bitrate) return Math.round(format.average_bitrate / 1000);
    if (format.bitrate) return Math.round(format.bitrate / 1000);
    return 0;
}

// ─── yt-dlp Integration ────────────────────────────────────

/**
 * Finds the yt-dlp executable path.
 */
async function findYtDlp() {
    // Check if yt-dlp is in PATH
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    try {
        const { stdout } = await execFileAsync(cmd, ['yt-dlp']);
        return stdout.trim().split('\n')[0].trim();
    } catch {
        // Fallback: check common locations
        const commonPaths = [
            path.join(__dirname, 'yt-dlp'),
            path.join(__dirname, 'yt-dlp.exe'),
        ];
        for (const p of commonPaths) {
            if (fs.existsSync(p)) return p;
        }
        return 'yt-dlp'; // Hope it's in PATH
    }
}

let ytDlpPath = null;

/**
 * Downloads a YouTube video/audio via yt-dlp to a temp file.
 * @param {string} url - YouTube URL
 * @param {object} options
 * @param {string} options.format - yt-dlp format spec (e.g., 'bestaudio', '137+140')
 * @param {string} options.outputPath - final output file path
 * @param {AbortSignal} [options.signal] - abort signal for cancellation
 * @returns {Promise<string>} path to downloaded file
 */
function ytDlpDownload(url, { format, outputPath, signal }) {
    return new Promise((resolve, reject) => {
        const args = [
            '--no-playlist',
            '--js-runtimes', 'node',
            '--no-warnings',
            '--no-progress',
            '-f', format,
            '-o', outputPath,
            '--ffmpeg-location', ffmpegPath,
            url,
        ];

        log('info', 'yt-dlp download started', { format, outputPath: path.basename(outputPath) });

        const child = spawn(ytDlpPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });

        let stderr = '';

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        // Handle abort signal
        if (signal) {
            signal.addEventListener('abort', () => {
                child.kill('SIGTERM');
                reject(new Error('Download cancelled'));
            }, { once: true });
        }

        child.on('close', (code) => {
            if (code === 0) {
                // yt-dlp may add extension, find the actual file
                const actualPath = findActualFile(outputPath);
                resolve(actualPath);
            } else {
                reject(new Error(`yt-dlp exited with code ${code}: ${stderr.substring(0, 300)}`));
            }
        });

        child.on('error', (err) => {
            reject(new Error(`yt-dlp spawn error: ${err.message}`));
        });
    });
}

/**
 * yt-dlp may change the extension. Find the actual downloaded file.
 */
function findActualFile(expectedPath) {
    if (fs.existsSync(expectedPath)) return expectedPath;
    // Check with common extensions
    const dir = path.dirname(expectedPath);
    const base = path.basename(expectedPath, path.extname(expectedPath));
    const extensions = ['.m4a', '.webm', '.mp4', '.opus', '.ogg', '.mp3', '.mkv'];
    for (const ext of extensions) {
        const candidate = path.join(dir, base + ext);
        if (fs.existsSync(candidate)) return candidate;
    }
    return expectedPath;
}

/**
 * Downloads via yt-dlp and transcodes to MP3 using ffmpeg.
 */
async function ytDlpDownloadMp3(url, audioFormat, signal) {
    // Download best audio first
    const tempAudioPath = generateTempPath('m4a');
    const downloadedPath = await ytDlpDownload(url, {
        format: audioFormat,
        outputPath: tempAudioPath,
        signal,
    });

    // Transcode to MP3
    const mp3Path = generateTempPath('mp3');
    await transcodeToMp3(downloadedPath, mp3Path);
    cleanupFiles(downloadedPath);
    return mp3Path;
}

// --- Helper: ffmpeg transcode to MP3 ---

function transcodeToMp3(inputPath, outputPath, bitrate = 192) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioCodec('libmp3lame')
            .audioBitrate(bitrate)
            .toFormat('mp3')
            .output(outputPath)
            .on('error', (err) => reject(new Error(`ffmpeg transcode error: ${err.message}`)))
            .on('end', () => resolve())
            .run();
    });
}

// ─── Server Configuration ────────────────────────────────────

// Cache para informações de vídeos
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS) || 3600;
const videoCache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: Math.floor(CACHE_TTL / 2) });

// Active processing jobs tracker
let activeJobs = 0;

// YouTube client (singleton for metadata)
let ytClient = null;

async function getYtClient() {
    if (!ytClient) {
        ytClient = await Innertube.create({
            lang: 'pt',
            location: 'BR',
            retrieve_player: true, // Needed for format metadata even if we don't use it for download
        });
    }
    return ytClient;
}

// --- Logging ---
const log = (level, message, data = {}) => {
    const timestamp = new Date().toISOString();
    const safeData = NODE_ENV === 'production'
        ? Object.fromEntries(
            Object.entries(data).filter(([k]) => !['error', 'stack'].includes(k))
        )
        : data;
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, safeData);
};

// --- Middleware ---

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

const RATE_LIMIT_WINDOW = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || (NODE_ENV === 'production' ? 50 : 100);

const limiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW,
    max: RATE_LIMIT_MAX,
    message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : true;
app.use(cors({ origin: corsOrigins, credentials: true }));

app.use(express.json({ limit: '1kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Startup ---
ensureDownloadsDir();

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
setInterval(() => {
    log('info', 'Executando limpeza de arquivos temporários');
    cleanupOldDownloads();
}, CLEANUP_INTERVAL_MS);

// Pre-initialize YouTube client and find yt-dlp
(async () => {
    try {
        ytDlpPath = await findYtDlp();
        log('info', 'yt-dlp encontrado', { path: ytDlpPath });
    } catch (err) {
        log('error', 'yt-dlp não encontrado — downloads não funcionarão', { error: err.message });
    }
    try {
        await getYtClient();
        log('info', 'YouTube client inicializado');
    } catch (err) {
        log('error', 'Falha ao inicializar YouTube client', { error: err.message });
    }
})();

// --- Routes ---

app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        activeJobs,
        maxConcurrentJobs: MAX_CONCURRENT_JOBS,
        ytDlpAvailable: !!ytDlpPath,
    });
});

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- API: Video Info ---
app.post('/api/video-info', async (req, res) => {
    try {
        const { url } = req.body;

        const validation = validateVideoUrl(url);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.reason });
        }

        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({ error: 'Não foi possível identificar o vídeo nesta URL.' });
        }

        const cacheKey = `video-${videoId}`;
        const cachedData = videoCache.get(cacheKey);
        if (cachedData) {
            log('info', 'Cache hit', { videoId });
            return res.json({ ...cachedData, cached: true });
        }

        log('info', 'Buscando informações do vídeo', { videoId });
        const yt = await getYtClient();
        const info = await yt.getBasicInfo(videoId);
        const details = info.basic_info;

        // Get streaming formats (metadata only — URLs are not decipherable)
        const adaptiveFormats = info.streaming_data?.adaptive_formats || [];

        // Find audio-only adaptive streams
        const audioOnlyStreams = adaptiveFormats
            .filter(f => f.has_audio && !f.has_video)
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

        // Find video-only adaptive streams
        const videoOnlyStreams = adaptiveFormats
            .filter(f => f.has_video && !f.has_audio && (f.height || 0) >= 360);

        // ─── Build audio options ───
        // MP3 options (via yt-dlp download + ffmpeg transcode)
        const mp3Options = audioOnlyStreams
            .filter(f => getAudioBitrateKbps(f) > 0)
            .slice(0, 2)
            .map(f => {
                const rawSize = Number(f.content_length) || 0;
                const estimatedSize = Math.round(rawSize * 0.85);
                const bitrateKbps = getAudioBitrateKbps(f);
                return {
                    quality: `${bitrateKbps}kbps`,
                    format: 'MP3',
                    extension: 'mp3',
                    contentType: 'audio/mpeg',
                    codec: 'LAME',
                    itag: f.itag,
                    size: formatBytes(estimatedSize),
                    bitrate: bitrateKbps,
                    outputFormat: 'mp3',
                };
            });

        // Native audio options
        const nativeAudioOptions = audioOnlyStreams.map(f => {
            const fmt = resolveFormat(f.mime_type, 'audio');
            const bitrateKbps = getAudioBitrateKbps(f);
            return {
                quality: bitrateKbps ? `${bitrateKbps}kbps` : 'Padrão',
                format: fmt.label,
                extension: fmt.extension,
                contentType: fmt.contentType,
                codec: extractCodecName(f.mime_type),
                itag: f.itag,
                size: formatBytes(Number(f.content_length) || 0),
                bitrate: bitrateKbps,
                outputFormat: fmt.extension,
            };
        });

        const audioOptions = [...mp3Options, ...nativeAudioOptions]
            .filter((f, i, arr) => arr.findIndex(x =>
                x.quality === f.quality && x.format === f.format
            ) === i)
            .sort((a, b) => b.bitrate - a.bitrate)
            .slice(0, 6);

        // ─── Build video options ───
        const bestAudioSize = Number(audioOnlyStreams[0]?.content_length) || 0;

        const videoOptions = videoOnlyStreams
            .map(f => {
                const videoSize = Number(f.content_length) || 0;
                const totalSize = videoSize + bestAudioSize;
                return {
                    quality: f.quality_label || `${f.height}p`,
                    format: 'MP4',
                    extension: 'mp4',
                    contentType: 'video/mp4',
                    codec: extractCodecName(f.mime_type),
                    itag: f.itag,
                    size: formatBytes(totalSize),
                    resolution: f.height || 0,
                    fps: f.fps || 30,
                };
            })
            .sort((a, b) => {
                if (b.resolution !== a.resolution) return b.resolution - a.resolution;
                return b.fps - a.fps;
            })
            .filter((f, i, arr) => arr.findIndex(x =>
                x.resolution === f.resolution && x.fps === f.fps
            ) === i)
            .slice(0, 8);

        const thumbnails = details.thumbnail || [];
        const response = {
            title: details.title,
            author: details.author || 'Desconhecido',
            thumbnail: thumbnails.length > 0
                ? thumbnails[thumbnails.length - 1].url
                : '',
            duration: formatDuration(details.duration),
            views: details.view_count
                ? Number(details.view_count).toLocaleString('pt-BR')
                : 'Desconhecido',
            audioOptions,
            videoOptions,
        };

        videoCache.set(cacheKey, response);
        log('info', 'Informações obtidas com sucesso', { videoId });
        res.json({ ...response, cached: false });

    } catch (error) {
        log('error', 'Erro em /api/video-info', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Erro ao buscar informações do vídeo. Tente novamente mais tarde.' });
    }
});

// --- API: Download ---
app.post('/api/download', async (req, res) => {
    const tempFiles = [];

    const releaseJob = () => {
        activeJobs = Math.max(0, activeJobs - 1);
    };

    try {
        const { url, itag, type, outputFormat } = req.body;

        const validation = validateVideoUrl(url);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.reason });
        }

        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({ error: 'URL inválida.' });
        }

        if (!ytDlpPath) {
            return res.status(503).json({ error: 'yt-dlp não disponível no servidor.' });
        }

        const downloadType = type === 'audio' ? 'audio' : 'video';

        // ─── Concurrency check ──────
        if (activeJobs >= MAX_CONCURRENT_JOBS) {
            return res.status(503).json({
                error: 'Servidor ocupado. Tente novamente em alguns segundos.',
            });
        }
        activeJobs++;

        log('info', 'Iniciando processamento', {
            videoId, type: downloadType, itag, outputFormat, activeJobs,
        });

        // Get video title for filename
        const yt = await getYtClient();
        const info = await yt.getBasicInfo(videoId);
        const videoTitle = sanitizeFilename(info.basic_info.title) || videoId;
        const cleanTitle = videoTitle.substring(0, 60);

        // ─── Client disconnect cleanup ─────
        let clientDisconnected = false;
        const abortController = new AbortController();

        req.on('close', () => {
            if (!res.writableEnded) {
                clientDisconnected = true;
                abortController.abort();
                log('info', 'Cliente desconectou, limpando arquivos temporários', { videoId });
                cleanupFiles(...tempFiles);
                releaseJob();
            }
        });

        let finalFilePath;
        const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

        if (downloadType === 'audio') {
            // ── Audio download flow ──
            const itagNum = Number(itag);
            const ytdlpFormat = itagNum > 0 ? String(itagNum) : 'bestaudio[ext=m4a]/bestaudio';

            if (outputFormat === 'mp3') {
                // Download via yt-dlp then transcode to MP3
                finalFilePath = await ytDlpDownloadMp3(
                    youtubeUrl,
                    ytdlpFormat,
                    abortController.signal
                );
                tempFiles.push(finalFilePath);

                if (clientDisconnected) return;

                const filename = `${cleanTitle}.mp3`;
                res.setHeader('Content-Disposition', buildContentDisposition(filename));
                res.setHeader('Content-Type', 'audio/mpeg');
            } else {
                // Download native audio via yt-dlp
                const tempPath = generateTempPath('m4a');
                finalFilePath = await ytDlpDownload(youtubeUrl, {
                    format: ytdlpFormat,
                    outputPath: tempPath,
                    signal: abortController.signal,
                });
                tempFiles.push(finalFilePath);

                if (clientDisconnected) return;

                // Determine actual extension
                const ext = path.extname(finalFilePath).slice(1) || 'm4a';
                const fmt = resolveFormat(ext === 'webm' ? 'audio/webm' : 'audio/mp4', 'audio');
                const filename = `${cleanTitle}.${ext}`;
                res.setHeader('Content-Disposition', buildContentDisposition(filename));
                res.setHeader('Content-Type', fmt.contentType);
            }
        } else {
            // ── Video download flow ── (merge video+audio via yt-dlp)
            const itagNum = Number(itag);
            // yt-dlp format: video itag + best audio, merged to mp4
            const ytdlpFormat = itagNum > 0
                ? `${itagNum}+bestaudio[ext=m4a]/bestaudio`
                : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';

            const tempPath = generateTempPath('mp4');
            finalFilePath = await ytDlpDownload(youtubeUrl, {
                format: ytdlpFormat,
                outputPath: tempPath,
                signal: abortController.signal,
            });
            tempFiles.push(finalFilePath);

            if (clientDisconnected) return;

            const filename = `${cleanTitle}.mp4`;
            res.setHeader('Content-Disposition', buildContentDisposition(filename));
            res.setHeader('Content-Type', 'video/mp4');
        }

        if (clientDisconnected) return;

        // ─── Stream final file to client ─────
        const stat = fs.statSync(finalFilePath);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Cache-Control', 'no-store');

        const readStream = fs.createReadStream(finalFilePath);

        readStream.on('error', (err) => {
            log('error', 'Erro ao enviar arquivo', { error: err.message, videoId });
            if (!res.headersSent) {
                res.status(500).json({ error: 'Erro ao enviar arquivo.' });
            }
            cleanupFiles(...tempFiles);
            releaseJob();
        });

        readStream.on('end', () => {
            log('info', 'Download concluído', { videoId, size: formatBytes(stat.size) });
            setTimeout(() => cleanupFiles(...tempFiles), 1000);
            releaseJob();
        });

        readStream.pipe(res);

    } catch (error) {
        log('error', 'Erro no endpoint /api/download', { error: error.message, stack: error.stack });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erro ao processar download. Tente novamente.' });
        }
        cleanupFiles(...tempFiles);
        releaseJob();
    }
});

// --- Start server ---
const server = app.listen(PORT, () => {
    log('info', 'Servidor iniciado', {
        port: PORT,
        environment: NODE_ENV,
        ffmpegPath,
        maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    });
});

// Graceful shutdown
const shutdown = (signal) => {
    log('info', `${signal} recebido, fechando servidor`);
    server.close(() => {
        log('info', 'Servidor fechado com sucesso');
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error) => {
    log('error', 'Uncaught Exception', { error: error.message, stack: error.stack });
    if (NODE_ENV === 'production') process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    log('error', 'Unhandled Rejection', { reason: String(reason) });
});
