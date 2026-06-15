import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, Loader2, X, AlertTriangle, RotateCw } from 'lucide-react';
import type { IPTVChannel } from '../utils/m3uParser';

const getProxiedUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return `/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
};

interface VideoPlayerProps {
  channel: IPTVChannel;
  onClose?: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ channel, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [reloadKey, setReloadKey] = useState(0); // Incremented to reload the stream
  const controlsTimeoutRef = useRef<number | null>(null);

  // Reset state on channel change
  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setIsPlaying(false);
  }, [channel.url, reloadKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    setIsLoading(true);
    setError(null);

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => setIsLoading(false);
    const handleError = () => {
      if (!hls) {
        setError('Failed to load video stream. The source might be offline.');
        setIsLoading(false);
      }
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('error', handleError);

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hls.loadSource(getProxiedUrl(channel.url));
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch((err) => {
          console.warn('Playback block check:', err);
          setIsPlaying(false);
          setIsLoading(false);
        });
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('HLS Network error, retrying...');
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('HLS Media error, recovering...');
              hls?.recoverMediaError();
              break;
            default:
              console.error('Fatal HLS error:', data);
              setError('Stream offline or incompatible. Please try another channel or hit reload.');
              setIsLoading(false);
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Support for Safari
      video.src = getProxiedUrl(channel.url);
      video.addEventListener('loadedmetadata', () => {
        video.play().catch((err) => {
          console.warn('Native playback failure:', err);
          setIsPlaying(false);
          setIsLoading(false);
        });
      });
    } else {
      setError('Your browser does not support HLS streaming.');
      setIsLoading(false);
    }

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('error', handleError);

      if (hls) {
        hls.destroy();
      }
    };
  }, [channel.url, reloadKey]);

  // Adjust volume
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  // Handle controls visibility timeout
  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      window.clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  useEffect(() => {
    resetControlsTimeout();
    return () => {
      if (controlsTimeoutRef.current) {
        window.clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isPlaying]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(() => {});
    }
    resetControlsTimeout();
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    resetControlsTimeout();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (val > 0 && isMuted) {
      setIsMuted(false);
    }
    resetControlsTimeout();
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        console.error('Fullscreen request error:', err);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      });
    }
    resetControlsTimeout();
  };

  const reloadStream = (e: React.MouseEvent) => {
    e.stopPropagation();
    setReloadKey(prev => prev + 1);
  };

  // Keyboard Shortcuts (Space, M, F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid triggering when user is typing in inputs
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') {
        return;
      }

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPlaying, isMuted, volume]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`video-player-container ${isFullscreen ? 'fullscreen' : ''}`}
      onMouseMove={resetControlsTimeout}
      onClick={togglePlay}
    >
      <video
        ref={videoRef}
        className="video-element"
        playsInline
      />

      {/* Loading overlay */}
      {isLoading && !error && (
        <div className="player-overlay loading-overlay">
          <Loader2 className="spinner" size={48} />
          <span>Loading live video stream...</span>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="player-overlay error-overlay" onClick={(e) => e.stopPropagation()}>
          <AlertTriangle className="error-icon" size={48} />
          <span>{error}</span>
          <button className="load-btn" style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }} onClick={reloadStream}>
            <RotateCw size={16} />
            Reload Stream
          </button>
        </div>
      )}

      {/* Header bar */}
      <div className={`player-header ${showControls ? 'visible' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="channel-info-display">
          {channel.logo ? (
            <img
              src={channel.logo}
              alt={channel.name}
              className="player-channel-logo"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="player-channel-logo-placeholder">
              {channel.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="player-channel-text">
            <h3>{channel.name}</h3>
            <span>{channel.group}</span>
          </div>
        </div>
        {onClose && (
          <button className="close-player-btn" onClick={onClose} title="Close Player">
            <X size={20} />
          </button>
        )}
      </div>

      {/* Controls Overlay */}
      <div className={`player-controls ${showControls ? 'visible' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="controls-row">
          <button className="control-btn" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>

          <div className="live-indicator">
            <span className="live-dot"></span>
            LIVE
          </div>

          <button 
            className="control-btn" 
            onClick={reloadStream} 
            title="Reload/Restart Stream"
            style={{ marginRight: '0.5rem' }}
          >
            <RotateCw size={18} />
          </button>

          <div className="volume-control">
            <button className="control-btn" onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
              {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="volume-slider"
            />
          </div>

          <div className="spacer"></div>

          <div className="shortcuts-tip">
            Space: Play/Pause | M: Mute | F: Fullscreen
          </div>

          <button className="control-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
};
