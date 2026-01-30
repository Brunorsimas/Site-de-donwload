// server-render.js - Versão simplificada para Render
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const {
    extractVideoId,
    sanitizeFilename,
    getVideoInfo,
    extractQuality,
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
    windowMs: 15 * 60 * 1000,
    max: NODE_ENV === 'production' ? 50 : 100,
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

// Função para criar arquivo de demonstração funcional
function createDemoFile(title, type, videoId) {
    if (type === 'audio') {
        // Criar arquivo MP3 funcional
        const mp3Header = Buffer.from([
            0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x54, 0x49, 0x54, 0x32, 0x00, 0x00, 0x00, 0x0F, 0x00, 0x00
        ]);
        
        const titleData = Buffer.from(title || `YouTube Audio (${videoId})`, 'utf8');
        const audioData = Buffer.alloc(1024 * 500, 0); // 500KB
        
        return Buffer.concat([mp3Header, titleData, audioData]);
    } else {
        // Criar arquivo MP4 funcional
        const mp4Header = Buffer.from([
            0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
            0x69, 0x73, 0x6F, 0x6D, 0x00, 0x01, 0x00, 0x01
        ]);
        
        const videoData = Buffer.alloc(1024 * 1000, 0); // 1MB
        
        return Buffer.concat([mp4Header, videoData]);
    }
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

        const response = {
            title: videoInfo.title,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration,
            views: videoInfo.views,
            audioOptions: [
                { quality: '128kbps', format: 'MP3', itag: 'audio-128', size: 'Demo' },
                { quality: '192kbps', format: 'MP3', itag: 'audio-192', size: 'Demo' },
                { quality: '256kbps', format: 'MP3', itag: 'audio-256', size: 'Demo' }
            ],
            videoOptions: [
                { quality: '360p', format: 'MP4', itag: 'video-360', size: 'Demo' },
                { quality: '720p', format: 'MP4', itag: 'video-720', size: 'Demo' },
                { quality: '1080p', format: 'MP4', itag: 'video-1080', size: 'Demo' }
            ],
            downloadMethod: 'demo-only',
            ffmpegAvailable: false,
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

// Download endpoint simplificado
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
        
        // Criar arquivo demo
        const demoFile = createDemoFile(filename, type, videoId);
        
        res.setHeader('Content-Type', type === 'audio' ? 'audio/mpeg' : 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(demoFile);
        
        log('success', 'Demo file sent', { videoId, method: 'demo-only', size: demoFile.length });
        
    } catch (error) {
        log('error', 'Erro no download', { error: error.message });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erro ao processar download: ' + error.message });
        }
    }
});

// Iniciar servidor
const server = app.listen(PORT, () => {
    log('success', 'Servidor simplificado iniciado', { 
        port: PORT, 
        environment: NODE_ENV,
        method: 'demo-only'
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
