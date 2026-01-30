// server.js - Versão REAL com downloads do YouTube
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const ytdl = require('ytdl-core');
const {
    extractVideoId,
    sanitizeFilename,
    ensureDownloadsDir,
    cleanupOldDownloads
} = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Cache para informações de vídeos (1h)
const videoCache = new NodeCache({ stdTTL: 3600, checkperiod: 1800 });

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: NODE_ENV === 'production' ? 30 : 60,
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

// Função para formatar bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Função para formatar duração
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Função para obter informações detalhadas do vídeo
async function getDetailedVideoInfo(url) {
    try {
        const info = await ytdl.getInfo(url);
        
        // Calcular tamanho estimado para cada formato
        const audioFormats = info.formats
            .filter(f => f.hasAudio && !f.hasVideo)
            .map(f => ({
                quality: f.audioBitrate ? `${f.audioBitrate}kbps` : '128kbps',
                format: 'MP3',
                itag: f.itag,
                size: formatBytes(f.contentLength || 0),
                bitrate: f.audioBitrate || 128,
                duration: info.videoDetails.lengthSeconds
            }))
            .filter((f, i, arr) => arr.findIndex(x => x.quality === f.quality) === i)
            .slice(0, 3);

        const videoFormats = info.formats
            .filter(f => f.hasVideo && f.hasAudio)
            .map(f => ({
                quality: f.qualityLabel || `${f.height}p`,
                format: 'MP4',
                itag: f.itag,
                size: formatBytes(f.contentLength || 0),
                resolution: f.height || 720,
                fps: f.fps || 30,
                duration: info.videoDetails.lengthSeconds
            }))
            .filter((f, i, arr) => arr.findIndex(x => x.quality === f.quality) === i)
            .slice(0, 3);

        return {
            title: info.videoDetails.title,
            author: info.videoDetails.author.name,
            thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
            duration: formatDuration(info.videoDetails.lengthSeconds),
            views: info.videoDetails.viewCount ? info.videoDetails.viewCount.toLocaleString('pt-BR') : 'Desconhecido',
            lengthSeconds: info.videoDetails.lengthSeconds,
            audioOptions: audioFormats.length > 0 ? audioFormats : [
                { quality: '128kbps', format: 'MP3', itag: 'audio-128', size: '3-8 MB', bitrate: 128 },
                { quality: '192kbps', format: 'MP3', itag: 'audio-192', size: '5-12 MB', bitrate: 192 },
                { quality: '256kbps', format: 'MP3', itag: 'audio-256', size: '8-20 MB', bitrate: 256 }
            ],
            videoOptions: videoFormats.length > 0 ? videoFormats : [
                { quality: '360p', format: 'MP4', itag: 'video-360', size: '15-50 MB', resolution: 360 },
                { quality: '720p', format: 'MP4', itag: 'video-720', size: '40-150 MB', resolution: 720 },
                { quality: '1080p', format: 'MP4', itag: 'video-1080', size: '100-400 MB', resolution: 1080 }
            ]
        };
    } catch (error) {
        log('error', 'Erro ao obter informações detalhadas', { error: error.message });
        throw error;
    }
}

// API endpoint com informações reais
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

        log('info', 'Buscando informações detalhadas', { videoId });
        
        const videoInfo = await getDetailedVideoInfo(url);
        
        const response = {
            ...videoInfo,
            downloadMethod: 'ytdl-core-real',
            cached: false
        };

        videoCache.set(cacheKey, response);
        
        log('success', 'Informações reais obtidas', { videoId, method: response.downloadMethod });
        res.json(response);
        
    } catch (error) {
        log('error', 'Erro em video-info', { error: error.message });
        res.status(500).json({ error: 'Erro ao buscar informações do vídeo: ' + error.message });
    }
});

// Download REAL do YouTube
app.get('/api/download', async (req, res) => {
    try {
        const { url, itag, type } = req.query;
        const videoId = extractVideoId(url);
        
        if (!videoId) {
            return res.status(400).json({ error: 'URL inválido' });
        }

        log('info', 'Iniciando download REAL', { videoId, itag, type });

        // Obter informações do vídeo para o nome do arquivo
        let videoTitle = videoId;
        try {
            const info = await ytdl.getInfo(url);
            videoTitle = sanitizeFilename(info.videoDetails.title) || videoId;
        } catch (e) {
            log('warn', 'Usando ID como nome', { videoId });
        }

        const cleanTitle = videoTitle.substring(0, 50);
        const filename = `${cleanTitle}.${type === 'audio' ? 'mp3' : 'mp4'}`;
        
        // Configurar headers para download
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'public, max-age=3600');

        // Iniciar stream real do YouTube
        const stream = ytdl(url, {
            quality: itag,
            filter: type === 'audio' ? 'audioonly' : 'audioandvideo'
        });

        // Pipe direto para o response
        stream.pipe(res);

        stream.on('progress', (chunkLength, downloaded, total) => {
            const progress = Math.round((downloaded / total) * 100);
            const downloadedMB = formatBytes(downloaded);
            const totalMB = formatBytes(total);
            
            log('info', 'Download progress', {
                videoId,
                progress: `${progress}%`,
                downloaded: downloadedMB,
                total: totalMB
            });
        });

        stream.on('error', (error) => {
            log('error', 'Erro no stream', { error: error.message });
            if (!res.headersSent) {
                res.status(500).json({ error: 'Erro no download: ' + error.message });
            }
        });

        stream.on('end', () => {
            log('success', 'Download REAL concluído', { videoId, filename });
        });
        
    } catch (error) {
        log('error', 'Erro no download', { error: error.message });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erro ao processar download: ' + error.message });
        }
    }
});

// Iniciar servidor
const server = app.listen(PORT, () => {
    log('success', 'Servidor REAL iniciado', { 
        port: PORT, 
        environment: NODE_ENV,
        method: 'ytdl-core-real'
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('info', 'SIGTERM recebido, fechando servidor');
    server.close(() => {
        log('info', 'Servidor fechado com sucesso');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    log('info', 'SIGINT recebido, fechando servidor');
    server.close(() => {
        log('info', 'Servidor fechado com sucesso');
        process.exit(0);
    });
});

// Error handling
process.on('uncaughtException', (error) => {
    log('error', 'Uncaught Exception', { error: error.message });
});

process.on('unhandledRejection', (reason, promise) => {
    log('error', 'Unhandled Rejection', { reason });
});
