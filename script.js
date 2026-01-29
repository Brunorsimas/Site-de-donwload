// script.js - Frontend do Video Downloader
// Funciona em conjunto com server.js e utils.js

class VideoDownloader {
    constructor() {
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
        this.videoDuration = document.getElementById('videoDuration');
        this.videoViews = document.getElementById('videoViews');
        this.audioOptions = document.getElementById('audioOptions');
        this.videoOptions = document.getElementById('videoOptions');
    }

    bindEvents() {
        this.searchBtn.addEventListener('click', () => this.searchVideo());
        this.videoUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.searchVideo();
            }
        });
    }

    async searchVideo() {
        const url = this.videoUrlInput.value.trim();
        
        if (!url) {
            this.showError('Por favor, insira um URL válido');
            return;
        }

        if (!this.isValidUrl(url)) {
            this.showError('URL inválido. Por favor, insira um link válido');
            return;
        }

        this.showLoading(true);
        this.hideError();
        this.hideVideoInfo();

        try {
            const videoData = await this.fetchVideoInfo(url);
            this.displayVideoInfo(videoData);
        } catch (error) {
            this.showError('Erro ao buscar informações do vídeo. Tente novamente.');
            console.error('Error:', error);
        } finally {
            this.showLoading(false);
        }
    }

    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    async fetchVideoInfo(url) {
        try {
            console.log('🔍 Buscando informações do vídeo:', url);
            
            const response = await fetch('/api/video-info', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url })
            });

            console.log('📊 Resposta da API:', response.status, response.statusText);

            if (!response.ok) {
                const errorData = await response.json();
                console.error('❌ Erro da API:', errorData);
                throw new Error(errorData.error || `Erro ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('✅ Dados recebidos:', data);
            return data;
        } catch (error) {
            console.error('❌ Erro completo em fetchVideoInfo:', error);
            throw error;
        }
    }


    displayVideoInfo(videoData) {
        this.videoThumbnail.src = videoData.thumbnail;
        this.videoTitle.textContent = videoData.title;
        this.videoDuration.textContent = `<i class="fas fa-clock"></i> Duração: ${videoData.duration}`;
        this.videoViews.textContent = `<i class="fas fa-eye"></i> ${videoData.views}`;

        this.displayDownloadOptions(videoData.audioOptions, this.audioOptions, 'audio');
        this.displayDownloadOptions(videoData.videoOptions, this.videoOptions, 'video');

        this.showVideoInfo();
    }

    displayDownloadOptions(options, container, type) {
        container.innerHTML = '';
        
        options.forEach((option, index) => {
            const button = document.createElement('button');
            button.className = `download-btn ${type}`;
            button.innerHTML = `
                <i class="fas fa-${type === 'audio' ? 'music' : 'video'}"></i>
                <span>${option.quality} - ${option.format}</span>
                <small>(${option.size})</small>
            `;
            
            button.addEventListener('click', () => this.downloadFile(option, type));
            container.appendChild(button);
        });
    }

    async downloadFile(option, type) {
        const url = this.videoUrlInput.value.trim();
        
        if (!url) {
            this.showError('URL não encontrado');
            return;
        }

        this.showDownloadNotification(`Iniciando download: ${option.quality} - ${option.format}`);

        try {
            // Criar URL de download com parâmetros corretos
            const downloadUrl = `/api/download?url=${encodeURIComponent(url)}&itag=${option.itag}&type=${type}`;
            
            // Fazer download usando fetch para melhor controle
            const response = await fetch(downloadUrl);
            
            if (!response.ok) {
                throw new Error('Erro ao baixar arquivo');
            }

            // Obter o nome do arquivo do header Content-Disposition
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = `video.${type === 'audio' ? 'mp3' : 'mp4'}`;
            
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                if (filenameMatch && filenameMatch[1]) {
                    filename = filenameMatch[1].replace(/['"]/g, '');
                }
            }

            // Converter resposta para blob
            const blob = await response.blob();
            
            // Criar URL temporária para o blob
            const blobUrl = window.URL.createObjectURL(blob);
            
            // Criar link de download seguindo as regras do navegador
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename; // Isso faz o navegador abrir o diálogo "Salvar como"
            link.style.display = 'none';
            
            // Adicionar ao DOM, clicar e remover
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Limpar URL temporária após um pequeno delay
            setTimeout(() => {
                window.URL.revokeObjectURL(blobUrl);
                this.showDownloadNotification(`Download concluído: ${option.quality} - ${option.format}`, 'success');
            }, 1000);
            
        } catch (error) {
            console.error('Erro no download:', error);
            this.showDownloadNotification('Erro ao baixar arquivo. Tente novamente.', 'error');
        }
    }

    showDownloadNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = 'download-notification';
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'download'}"></i>
            <span>${message}</span>
        `;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#28a745' : '#17a2b8'};
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.2);
            z-index: 1000;
            animation: slideIn 0.3s ease;
            max-width: 300px;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
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

const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    
    .download-notification {
        display: flex;
        align-items: center;
        gap: 10px;
    }
`;
document.head.appendChild(style);
