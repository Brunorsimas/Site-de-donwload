// server-production.js - Servidor corrigido para downloads completos
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const {
    extractVideoId,
    sanitizeFilename,
    getVideoInfo,
    extractQuality,
    checkYtDlpAvailable,
    ensureDownloadsDir,
    cleanupOldDownloads
} = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Cache para informações de vídeos (24h)
const videoCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: NODE_ENV === 'production' ? 50 : 100, // limite por IP
    message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Middleware
app.use(limiter);
app.use(cors({
    origin: NODE_ENV === 'production' 
        ? ['https://seusite.com', 'https://www.seusite.com'] 
        : true,
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));

// Logging
const log = (level, message, data = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data);
};

// Garantir diretório de downloads
ensureDownloadsDir();

// Limpar arquivos antigos
setInterval(() => cleanupOldDownloads(), 3600000);

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cache: videoCache.stats()
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Função corrigida para download REAL do YouTube
async function downloadVideoReal(url, type, quality, res, filename) {
    log('info', `Iniciando download REAL do YouTube`, { type, quality, filename });
    
    return new Promise((resolve, reject) => {
        const downloadsDir = ensureDownloadsDir();
        
        // Função para verificar se yt-dlp está disponível
        function checkYtDlpAvailable() {
            try {
                const fs = require('fs');
                const path = require('path');
                const ytDlpPath = path.join(__dirname, 'yt-dlp');
                return fs.existsSync(ytDlpPath);
            } catch (e) {
                return false;
            }
        }

        // Verificar se yt-dlp está disponível
        if (!checkYtDlpAvailable()) {
            log('error', 'yt-dlp não está disponível');
            return reject(new Error('yt-dlp não encontrado.'));
        }
        
        let args = [
            url,
            '--no-playlist',
            '--newline',
            '--no-warnings',
            '--ffmpeg-location', ffmpegPath,
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            '--referer', 'https://www.youtube.com/',
            '--socket-timeout', '120',
            '--retries', '5',
            '--fragment-retries', '5',
            '--keep-fragments',
            '--no-part',
            '--embed-thumbnail',
            '--embed-metadata'
        ];
        
        if (type === 'audio') {
            args.push(
                '--extract-audio',
                '--audio-format', 'mp3',
                '--audio-quality', quality === '256kbps' ? '256K' : quality === '192kbps' ? '192K' : '128K',
                '--output', path.join(downloadsDir, `${filename}.%(ext)s`)
            );
        } else {
            let formatSelector;
            switch(quality) {
                case '1080p': formatSelector = 'best[height<=1080][ext=mp4]'; break;
                case '720p': formatSelector = 'best[height<=720][ext=mp4]'; break;
                case '360p': formatSelector = 'best[height<=480][ext=mp4]'; break;
                default: formatSelector = 'best[height<=720][ext=mp4]';
            }
            args.push(
                '--format', formatSelector,
                '--output', path.join(downloadsDir, `${filename}.%(ext)s`)
            );
        }
        
        const ytDlp = spawn('./yt-dlp', args);
        let downloadedFile = null;
        let downloadProgress = 0;
        
        const timeout = setTimeout(() => {
            ytDlp.kill();
            reject(new Error('Timeout do download (3 minutos)'));
        }, 180000);
        
        ytDlp.stdout.on('data', (data) => {
            const output = data.toString();
            log('info', 'yt-dlp output', { output: output.trim() });
            
            const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
            if (progressMatch) {
                downloadProgress = parseFloat(progressMatch[1]);
                log('info', 'Download progress', { progress: downloadProgress });
            }
            
            const match = output.match(/\[download\] Destination: (.+)/);
            if (match) {
                downloadedFile = match[1].trim();
                log('info', 'File destination', { file: downloadedFile });
            }
        });
        
        ytDlp.stderr.on('data', (data) => {
            const error = data.toString();
            if (!error.includes('WARNING')) {
                log('error', 'yt-dlp stderr', { error: error.trim() });
            }
        });
        
        ytDlp.on('close', (code) => {
            clearTimeout(timeout);
            
            if (code === 0 && downloadedFile && fs.existsSync(downloadedFile)) {
                const stats = fs.statSync(downloadedFile);
                log('success', 'Download concluído', { 
                    file: downloadedFile, 
                    size: stats.size,
                    method: 'yt-dlp-real'
                });
                
                const ext = path.extname(downloadedFile).toLowerCase();
                res.setHeader('Content-Type', ext === '.mp3' ? 'audio/mpeg' : 'video/mp4');
                res.setHeader('Content-Disposition', `attachment; filename="${path.basename(downloadedFile)}"`);
                res.setHeader('Content-Length', stats.size);
                res.setHeader('Cache-Control', 'public, max-age=3600');
                
                const fileStream = fs.createReadStream(downloadedFile);
                fileStream.pipe(res);
                
                fileStream.on('end', () => {
                    setTimeout(() => {
                        if (fs.existsSync(downloadedFile)) {
                            fs.unlinkSync(downloadedFile);
                            log('info', 'Arquivo temporário removido', { file: downloadedFile });
                        }
                    }, 30000);
                });
                
                resolve({ success: true, size: stats.size, path: downloadedFile, method: 'yt-dlp-real' });
            } else {
                log('error', 'Download falhou', { code, file: downloadedFile, exists: downloadedFile ? fs.existsSync(downloadedFile) : false });
                reject(new Error(`Download falhou com código ${code}`));
            }
        });
        
        ytDlp.on('error', (err) => {
            clearTimeout(timeout);
            log('error', 'Erro no yt-dlp', { error: err.message });
            reject(new Error(`Erro no yt-dlp: ${err.message}`));
        });
    });
}

// API endpoint com cache
app.post('/api/video-info', async (req, res) => {
    try {
        const { url } = req.body;
        const videoId = extractVideoId(url);
        
        if (!videoId) {
            return res.status(400).json({ error: 'URL inválido. Use um link do YouTube.' });
        }

        const cacheKey = `video-${videoId}`;
        let cachedData = videoCache.get(cacheKey);
        
        if (cachedData) {
            log('info', 'Cache hit', { videoId });
            return res.json(cachedData);
        }

        log('info', 'Buscando informações', { videoId });
        
        let videoInfo;
        try {
            videoInfo = await getVideoInfo(url);
        } catch (error) {
            log('warn', 'getVideoInfo falhou, usando fallback', { error: error.message });
            videoInfo = {
                title: `Vídeo do YouTube (${videoId})`,
                author: 'Canal do YouTube',
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                duration: 'Desconhecido',
                views: 'Desconhecido'
            };
        }

        const ytDlpAvailable = checkYtDlpAvailable();
        
        const response = {
            title: videoInfo.title,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration,
            views: videoInfo.views,
            audioOptions: [
                { quality: '128kbps', format: 'MP3', itag: 'audio-128', size: '3-8 MB' },
                { quality: '192kbps', format: 'MP3', itag: 'audio-192', size: '5-12 MB' },
                { quality: '256kbps', format: 'MP3', itag: 'audio-256', size: '8-20 MB' }
            ],
            videoOptions: [
                { quality: '360p', format: 'MP4', itag: 'video-360', size: '15-50 MB' },
                { quality: '720p', format: 'MP4', itag: 'video-720', size: '40-150 MB' },
                { quality: '1080p', format: 'MP4', itag: 'video-1080', size: '100-400 MB' }
            ],
            downloadMethod: ytDlpAvailable ? 'yt-dlp-real' : 'unavailable',
            ffmpegAvailable: !!ffmpegPath,
            cached: false
        };

        videoCache.set(cacheKey, response);
        
        log('success', 'Informações obtidas', { videoId, method: response.downloadMethod });
        res.json(response);
        
    } catch (error) {
        log('error', 'Erro em video-info', { error: error.message });
        res.status(500).json({ error: 'Erro ao buscar informações do vídeo: ' + error.message });
    }
});

// Download endpoint corrigido
app.get('/api/download', async (req, res) => {
    try {
        const { url, itag, type } = req.query;
        const videoId = extractVideoId(url);
        
        if (!videoId) {
            return res.status(400).json({ error: 'URL inválido' });
        }

        let videoTitle = videoId;
        try {
            const videoInfo = await getVideoInfo(url);
            videoTitle = sanitizeFilename(videoInfo.title) || videoId;
        } catch (e) {
            log('warn', 'Usando ID como nome', { videoId });
        }

        const cleanTitle = videoTitle.substring(0, 50);
        const filename = `${cleanTitle}.${type === 'audio' ? 'mp3' : 'mp4'}`;
        
        const quality = extractQuality(itag, type);
        
        // Download REAL do YouTube
        const result = await downloadVideoReal(url, type, quality, res, filename);
        
        log('success', 'Download concluído com sucesso', { 
            videoId, 
            method: result.method, 
            size: result.size 
        });
        
    } catch (error) {
        log('error', 'Erro no download', { error: error.message });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erro ao processar download: ' + error.message });
        }
    }
});

// Iniciar servidor
app.listen(PORT, () => {
    log('success', 'Servidor iniciado', { 
        port: PORT, 
        environment: NODE_ENV,
        ytDlpAvailable: checkYtDlpAvailable(),
        ffmpegAvailable: !!ffmpegPath
    });
});

// Error handling robusto
process.on('uncaughtException', (error) => {
    log('error', 'Uncaught Exception', { error: error.message, stack: error.stack });
});

process.on('unhandledRejection', (reason, promise) => {
    log('error', 'Unhandled Rejection', { reason });
});
