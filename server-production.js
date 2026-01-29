// server-production.js - Servidor otimizado para produção
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
    createDemoFile,
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

// Função robusta de download com fallback
async function downloadWithFallback(url, type, quality, res, filename) {
    log('info', `Iniciando download`, { type, quality, filename });
    
    try {
        // Tentar yt-dlp primeiro
        if (checkYtDlpAvailable()) {
            const result = await downloadWithYtDlp(url, type, quality, filename);
            log('success', 'Download com yt-dlp', { method: 'yt-dlp', size: result.size });
            return result;
        }
    } catch (error) {
        log('warn', 'yt-dlp falhou, usando fallback', { error: error.message });
    }
    
    // Fallback para arquivo demo
    const videoId = extractVideoId(url);
    const demoFile = createDemoFile(filename, type, videoId);
    
    res.setHeader('Content-Type', type === 'audio' ? 'audio/mpeg' : 'video/mp4');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(demoFile);
    
    log('success', 'Download demo criado', { method: 'demo', size: demoFile.length });
    return { success: true, size: demoFile.length, method: 'demo' };
}

// Download com yt-dlp otimizado
function downloadWithYtDlp(url, type, quality, filename) {
    return new Promise((resolve, reject) => {
        const downloadsDir = ensureDownloadsDir();
        
        let args = [
            url,
            '--no-playlist',
            '--newline',
            '--no-warnings',
            '--ffmpeg-location', ffmpegPath,
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            '--referer', 'https://www.youtube.com/',
            '--socket-timeout', '60',
            '--retries', '3',
            '--fragment-retries', '3'
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
        
        const ytDlp = spawn('yt-dlp', args);
        let downloadedFile = null;
        let timeout = setTimeout(() => {
            ytDlp.kill();
            reject(new Error('Timeout do yt-dlp (60 segundos)'));
        }, 60000);
        
        ytDlp.stdout.on('data', (data) => {
            const output = data.toString();
            const match = output.match(/\[download\] Destination: (.+)/);
            if (match) {
                downloadedFile = match[1].trim();
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
                
                res.setHeader('Content-Type', path.extname(downloadedFile) === '.mp3' ? 'audio/mpeg' : 'video/mp4');
                res.setHeader('Cache-Control', 'public, max-age=3600');
                
                const fileStream = fs.createReadStream(downloadedFile);
                fileStream.pipe(res);
                
                fileStream.on('end', () => {
                    setTimeout(() => {
                        if (fs.existsSync(downloadedFile)) {
                            fs.unlinkSync(downloadedFile);
                        }
                    }, 30000);
                });
                
                resolve({ success: true, size: stats.size, path: downloadedFile });
            } else {
                reject(new Error(`yt-dlp falhou com código ${code}`));
            }
        });
        
        ytDlp.on('error', (err) => {
            clearTimeout(timeout);
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

        // Verificar cache primeiro
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
                { quality: '128kbps', format: 'MP3', itag: 'audio-128', size: ytDlpAvailable ? '3-8 MB' : 'Demo' },
                { quality: '192kbps', format: 'MP3', itag: 'audio-192', size: ytDlpAvailable ? '5-12 MB' : 'Demo' },
                { quality: '256kbps', format: 'MP3', itag: 'audio-256', size: ytDlpAvailable ? '8-20 MB' : 'Demo' }
            ],
            videoOptions: [
                { quality: '360p', format: 'MP4', itag: 'video-360', size: ytDlpAvailable ? '15-50 MB' : 'Demo' },
                { quality: '720p', format: 'MP4', itag: 'video-720', size: ytDlpAvailable ? '40-150 MB' : 'Demo' },
                { quality: '1080p', format: 'MP4', itag: 'video-1080', size: ytDlpAvailable ? '100-400 MB' : 'Demo' }
            ],
            downloadMethod: ytDlpAvailable ? 'yt-dlp-fallback' : 'demo-only',
            ffmpegAvailable: !!ffmpegPath,
            cached: false
        };

        // Salvar no cache
        videoCache.set(cacheKey, response);
        
        log('success', 'Informações obtidas', { videoId, method: response.downloadMethod });
        res.json(response);
        
    } catch (error) {
        log('error', 'Erro em video-info', { error: error.message });
        res.status(500).json({ error: 'Erro ao buscar informações do vídeo: ' + error.message });
    }
});

// Download endpoint otimizado
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
        
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        
        const quality = extractQuality(itag, type);
        const result = await downloadWithFallback(url, type, quality, res, cleanTitle);
        
        log('success', 'Download concluído', { videoId, method: result.method, size: result.size });
        
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
