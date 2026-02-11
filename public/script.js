// script.js - Frontend do Video Downloader

class VideoDownloader {
    constructor() {
        this.isSearching = false;
        this.isDownloading = false;
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        this.videoUrlInput = document.getElementById('videoUrl');
        this.searchBtn = document.getElementById('searchBtn');
        this.loadingSpinner = document.getElementById('loadingSpinner');
        this.errorMessage = document.getElementById('error-message');
        this.videoInfo = document.getElementById('videoInfo');
        this.videoThumbnail = document.getElementById('videoThumbnail');
        this.videoTitle = document.getElementById('videoTitle');
        this.videoDurationText = document.getElementById('videoDurationText');
        this.videoViewsText = document.getElementById('videoViewsText');
        this.audioOptions = document.getElementById('audioOptions');
        this.videoOptions = document.getElementById('videoOptions');
        this.processingOverlay = document.getElementById('processingOverlay');
        this.processingText = document.getElementById('processingText');
    }

    bindEvents() {
        this.searchBtn.addEventListener('click', () => this.searchVideo());
        this.videoUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.searchVideo();
            }
        });
    }

    // --- URL Validation ---
    isValidYouTubeUrl(url) {
        try {
            const parsed = new URL(url);
            const allowed = [
                'youtube.com', 'www.youtube.com', 'm.youtube.com',
                'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
            ];
            return ['http:', 'https:'].includes(parsed.protocol)
                && allowed.includes(parsed.hostname.toLowerCase());
        } catch {
            return false;
        }
    }

    // --- Search ---
    async searchVideo() {
        if (this.isSearching) return;

        const url = this.videoUrlInput.value.trim();

        if (!url) {
            this.showError('Por favor, insira um URL válido.');
            return;
        }

        if (!this.isValidYouTubeUrl(url)) {
            this.showError('URL inválido. Insira um link do YouTube.');
            return;
        }

        this.isSearching = true;
        this.showLoading(true);
        this.hideError();
        this.hideVideoInfo();

        try {
            const videoData = await this.fetchVideoInfo(url);
            this.displayVideoInfo(videoData);
        } catch (error) {
            const message = error.message || 'Erro ao buscar informações do vídeo. Tente novamente.';
            this.showError(message);
            console.error('Erro na busca:', error);
        } finally {
            this.isSearching = false;
            this.showLoading(false);
        }
    }

    // --- Fetch Video Info ---
    async fetchVideoInfo(url) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch('/api/video-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Erro ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('A busca demorou muito. Tente novamente.');
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    // --- Display Video Info ---
    displayVideoInfo(videoData) {
        if (videoData.thumbnail) {
            this.videoThumbnail.src = videoData.thumbnail;
            this.videoThumbnail.alt = videoData.title || 'Thumbnail do vídeo';
        }

        this.videoTitle.textContent = videoData.title || 'Título indisponível';
        this.videoDurationText.textContent = `Duração: ${videoData.duration || 'Desconhecida'}`;
        this.videoViewsText.textContent = videoData.views || 'Desconhecido';

        this.displayAudioOptions(videoData.audioOptions);
        this.displayVideoOptions(videoData.videoOptions);

        this.showVideoInfo();
    }

    // --- Display Audio Options ---
    displayAudioOptions(options) {
        this.audioOptions.innerHTML = '';

        if (!options || options.length === 0) {
            const msg = document.createElement('p');
            msg.className = 'no-options';
            msg.textContent = 'Nenhuma opção disponível para este formato.';
            this.audioOptions.appendChild(msg);
            return;
        }

        options.forEach((option) => {
            const button = document.createElement('button');
            button.className = 'download-btn audio';

            const icon = document.createElement('i');
            icon.className = 'fas fa-music';

            const label = document.createElement('span');
            label.className = 'btn-label';
            label.textContent = `${option.quality} ${option.format}`;

            const details = document.createElement('small');
            details.className = 'btn-details';
            details.textContent = `${option.codec} · ${option.size}`;

            button.appendChild(icon);
            button.appendChild(label);
            button.appendChild(details);

            button.addEventListener('click', () => this.downloadFile({
                audioItag: option.audioItag,
                type: 'audio',
                outputFormat: option.outputFormat,
                displayLabel: `${option.quality} ${option.format}`,
            }, button));

            this.audioOptions.appendChild(button);
        });
    }

    // --- Display Video Options ---
    displayVideoOptions(options) {
        this.videoOptions.innerHTML = '';

        if (!options || options.length === 0) {
            const msg = document.createElement('p');
            msg.className = 'no-options';
            msg.textContent = 'Nenhuma opção disponível para este formato.';
            this.videoOptions.appendChild(msg);
            return;
        }

        options.forEach((option) => {
            const button = document.createElement('button');
            button.className = 'download-btn video';

            const icon = document.createElement('i');
            icon.className = 'fas fa-video';

            const label = document.createElement('span');
            label.className = 'btn-label';
            label.textContent = `${option.quality} ${option.format}`;

            const details = document.createElement('small');
            details.className = 'btn-details';
            const fpsInfo = option.fps > 30 ? ` · ${option.fps}fps` : '';
            const mergeInfo = option.needsMerge ? ' · ⚙️' : '';
            details.textContent = `${option.codec}${fpsInfo} · ${option.size}${mergeInfo}`;

            button.appendChild(icon);
            button.appendChild(label);
            button.appendChild(details);

            button.addEventListener('click', () => this.downloadFile({
                videoItag: option.videoItag,
                audioItag: option.audioItag,
                type: 'video',
                outputFormat: option.extension,
                displayLabel: `${option.quality} ${option.format}`,
            }, button));

            this.videoOptions.appendChild(button);
        });
    }

    // --- Download File ---
    async downloadFile(downloadInfo, clickedButton) {
        if (this.isDownloading) return;
        this.isDownloading = true;

        const url = this.videoUrlInput.value.trim();
        if (!url) {
            this.showError('URL não encontrado.');
            this.isDownloading = false;
            return;
        }

        // Save original button content for restoration
        const originalHTML = clickedButton.innerHTML;

        // Disable all download buttons
        this.setDownloadButtonsDisabled(true);
        clickedButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Preparando...</span>';

        this.showProcessing(`Processando: ${downloadInfo.displayLabel}`);
        this.showNotification(`Iniciando download: ${downloadInfo.displayLabel}`, 'info');

        try {
            // Use POST for download (server-side processing)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 min timeout

            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    videoItag: downloadInfo.videoItag || null,
                    audioItag: downloadInfo.audioItag,
                    type: downloadInfo.type,
                    outputFormat: downloadInfo.outputFormat,
                }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Erro ao baixar arquivo.');
            }

            // Extract filename from Content-Disposition header
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = `download.${downloadInfo.outputFormat || 'mp4'}`;

            if (contentDisposition) {
                const utf8Match = contentDisposition.match(/filename\*=UTF-8''(.+?)(?:;|$)/i);
                const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/);
                if (utf8Match) {
                    filename = decodeURIComponent(utf8Match[1]);
                } else if (basicMatch) {
                    filename = basicMatch[1].replace(/['"]/g, '');
                }
            }

            clickedButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Baixando...</span>';

            // Stream response to blob and trigger download
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setTimeout(() => window.URL.revokeObjectURL(blobUrl), 5000);

            this.showNotification(`Download concluído: ${downloadInfo.displayLabel}`, 'success');

        } catch (error) {
            console.error('Erro no download:', error);
            const msg = error.name === 'AbortError'
                ? 'O download demorou muito. Tente novamente.'
                : (error.message || 'Erro ao baixar arquivo. Tente novamente.');
            this.showNotification(msg, 'error');
        } finally {
            this.isDownloading = false;
            this.setDownloadButtonsDisabled(false);
            clickedButton.innerHTML = originalHTML;
            this.hideProcessing();
        }
    }

    // --- UI Helpers ---

    setDownloadButtonsDisabled(disabled) {
        document.querySelectorAll('.download-btn').forEach(btn => {
            btn.disabled = disabled;
        });
    }

    showProcessing(text) {
        if (this.processingOverlay) {
            this.processingText.textContent = text || 'Processando...';
            this.processingOverlay.classList.remove('hidden');
        }
    }

    hideProcessing() {
        if (this.processingOverlay) {
            this.processingOverlay.classList.add('hidden');
        }
    }

    showNotification(message, type = 'info') {
        document.querySelectorAll('.download-notification').forEach(n => n.remove());

        const notification = document.createElement('div');
        notification.className = `download-notification ${type}`;

        const icon = document.createElement('i');
        const iconMap = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-download' };
        icon.className = `fas ${iconMap[type] || iconMap.info}`;

        const span = document.createElement('span');
        span.textContent = message;

        notification.appendChild(icon);
        notification.appendChild(span);
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 4000);
    }

    showLoading(show) {
        if (show) {
            this.loadingSpinner.classList.remove('hidden');
            this.searchBtn.disabled = true;
            this.searchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando...';
        } else {
            this.loadingSpinner.classList.add('hidden');
            this.searchBtn.disabled = false;
            this.searchBtn.innerHTML = '<i class="fas fa-search"></i> Buscar';
        }
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.classList.remove('hidden');
    }

    hideError() {
        this.errorMessage.classList.add('hidden');
    }

    showVideoInfo() {
        this.videoInfo.classList.remove('hidden');
    }

    hideVideoInfo() {
        this.videoInfo.classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new VideoDownloader();
});
