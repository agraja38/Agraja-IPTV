import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Tv, Search, Loader2, Heart, Globe, RefreshCw, Power } from 'lucide-react';
import { parseM3U, type IPTVChannel } from './utils/m3uParser';
import { VideoPlayer } from './components/VideoPlayer';
import { ChannelStatusDot } from './components/ChannelStatusDot';

const PLAYLIST_PRESETS = [
  { name: 'Global (All)', url: 'https://iptv-org.github.io/iptv/index.m3u' },
  { name: 'News', url: 'https://iptv-org.github.io/iptv/categories/news.m3u' },
  { name: 'Sports', url: 'https://iptv-org.github.io/iptv/categories/sports.m3u' },
  { name: 'Movies', url: 'https://iptv-org.github.io/iptv/categories/movies.m3u' },
  { name: 'Music', url: 'https://iptv-org.github.io/iptv/categories/music.m3u' },
  { name: 'Entertainment', url: 'https://iptv-org.github.io/iptv/categories/comedy.m3u' },
  { name: 'United States', url: 'https://iptv-org.github.io/iptv/countries/us.m3u' },
  { name: 'United Kingdom', url: 'https://iptv-org.github.io/iptv/countries/uk.m3u' },
  { name: 'Canada', url: 'https://iptv-org.github.io/iptv/countries/ca.m3u' },
  { name: 'India', url: 'https://iptv-org.github.io/iptv/countries/in.m3u' },
];

const CACHE_EXPIRATION_TIME = 2 * 60 * 60 * 1000; // 2 hours
const INITIAL_VISIBLE_COUNT = 80;
const LOAD_MORE_COUNT = 40;

function App() {
  const [playlistUrl, setPlaylistUrl] = useState(PLAYLIST_PRESETS[0].url);
  const [customUrl, setCustomUrl] = useState('');
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [channels, setChannels] = useState<IPTVChannel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<IPTVChannel | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState<string>('');
  
  // Filtering States
  const [isFavoritesOnly, setIsFavoritesOnly] = useState(false);
  const [showOnlineOnly, setShowOnlineOnly] = useState(false);
  const [isOnlineFilterActive, setIsOnlineFilterActive] = useState(false);
  const [hasShutDown, setHasShutDown] = useState(false);

  const handleQuit = async () => {
    if (window.confirm("Are you sure you want to stop the server and quit Horizon IPTV?")) {
      try {
        setHasShutDown(true);
        fetch('/shutdown', { method: 'POST' }).catch(() => {});
      } catch (e) {
        console.error(e);
      }
      setTimeout(() => {
        window.close();
      }, 500);
    }
  };

  // Central Statuses State
  const [statuses, setStatuses] = useState<Record<string, 'checking' | 'online' | 'offline'>>({});
  const activeChecks = useRef<Set<string>>(new Set());

  // Infinite Scroll State for main grid
  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_VISIBLE_COUNT);
  const containerRef = useRef<HTMLDivElement>(null);

  // Favorites State
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('iptv-favorites');
    return saved ? JSON.parse(saved) : [];
  });

  // Save favorites to localStorage
  useEffect(() => {
    localStorage.setItem('iptv-favorites', JSON.stringify(favorites));
  }, [favorites]);

  // Debounced search logic
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset pagination count on search/preset change
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [debouncedSearchQuery, isFavoritesOnly, showOnlineOnly, isOnlineFilterActive]);

  // Load cache helper
  const loadCache = (url: string): IPTVChannel[] | null => {
    try {
      const cacheUrl = localStorage.getItem('iptv-cache-url');
      if (cacheUrl !== url) return null;

      const cacheTimestamp = localStorage.getItem('iptv-cache-time');
      if (!cacheTimestamp) return null;

      const age = Date.now() - parseInt(cacheTimestamp, 10);
      if (age > CACHE_EXPIRATION_TIME) return null;

      const cacheData = localStorage.getItem('iptv-cache-data');
      if (cacheData) {
        return JSON.parse(cacheData);
      }
    } catch (err) {
      console.warn('Cache read failed:', err);
    }
    return null;
  };

  // Set cache helper
  const setCache = (url: string, data: IPTVChannel[]) => {
    try {
      localStorage.setItem('iptv-cache-url', url);
      localStorage.setItem('iptv-cache-time', Date.now().toString());
      localStorage.setItem('iptv-cache-data', JSON.stringify(data));
    } catch (err) {
      console.warn('Cache write failed:', err);
    }
  };

  const getProxiedUrl = (url: string, raw = false) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return `/proxy?url=${encodeURIComponent(url)}${raw ? '&raw=true' : ''}`;
    }
    return url;
  };

  // Fetch playlist function
  const fetchPlaylist = async (url: string, bypassCache = false) => {
    setIsLoading(true);
    setError(null);
    setSelectedChannel(null);
    setIsFavoritesOnly(false);
    setIsOnlineFilterActive(false);

    // Reset status check queue and states
    checkQueue.current = [];
    activeChecks.current.clear();
    activeCheckCount.current = 0;
    checkedUrls.current = {};
    setStatuses({});

    // Try loading cache first for instant startup
    if (!bypassCache) {
      const cached = loadCache(url);
      if (cached) {
        setChannels(cached);
        setIsLoading(false);
        // Silently revalidate in the background
        revalidatePlaylistInBackground(url);
        return;
      }
    }
    
    try {
      const response = await fetch(getProxiedUrl(url, true));
      if (!response.ok) {
        throw new Error(`Failed to fetch playlist: ${response.statusText}`);
      }
      const text = await response.text();
      const parsedChannels = parseM3U(text);
      
      if (parsedChannels.length === 0) {
        throw new Error('No channels found. Please ensure the playlist format is valid.');
      }
      
      setChannels(parsedChannels);
      setCache(url, parsedChannels);
    } catch (err: any) {
      console.error(err);
      setError(
        err.message || 
        'Failed to fetch playlist. It may be due to CORS blocking or an invalid URL.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Silently revalidate playlist content in the background
  const revalidatePlaylistInBackground = async (url: string) => {
    try {
      const response = await fetch(getProxiedUrl(url, true));
      if (response.ok) {
        const text = await response.text();
        const parsedChannels = parseM3U(text);
        if (parsedChannels.length > 0) {
          setChannels(parsedChannels);
          setCache(url, parsedChannels);
        }
      }
    } catch (err) {
      console.log('Background revalidation skipped:', err);
    }
  };

  // Fetch playlist on URL change
  useEffect(() => {
    fetchPlaylist(playlistUrl);
  }, [playlistUrl]);

  // Central Status Checking Cache ref and Queue
  const checkedUrls = useRef<Record<string, 'checking' | 'online' | 'offline'>>({});
  const checkQueue = useRef<string[]>([]);
  const activeCheckCount = useRef<number>(0);
  const CONCURRENCY_LIMIT = 5;

  const processQueue = useCallback(async () => {
    if (activeCheckCount.current >= CONCURRENCY_LIMIT || checkQueue.current.length === 0) {
      return;
    }

    const url = checkQueue.current.shift();
    if (!url) return;

    activeChecks.current.add(url);
    activeCheckCount.current++;
    setStatuses(prev => ({ ...prev, [url]: 'checking' }));

    try {
      const res = await fetch(`/check?url=${encodeURIComponent(url)}`);
      if (res.ok) {
        const data = await res.json();
        const finalStatus = data.online ? 'online' : 'offline';
        checkedUrls.current[url] = finalStatus;
        setStatuses(prev => ({ ...prev, [url]: finalStatus }));
      } else {
        checkedUrls.current[url] = 'offline';
        setStatuses(prev => ({ ...prev, [url]: 'offline' }));
      }
    } catch {
      checkedUrls.current[url] = 'offline';
      setStatuses(prev => ({ ...prev, [url]: 'offline' }));
    } finally {
      activeChecks.current.delete(url);
      activeCheckCount.current--;
      // Process next in queue
      processQueue();
    }

    // See if we can start more workers up to limit
    processQueue();
  }, []);

  // Central Status Checking Trigger function
  const triggerStatusCheck = useCallback((url: string) => {
    if (checkedUrls.current[url] || checkQueue.current.includes(url) || activeChecks.current.has(url)) {
      return;
    }

    checkQueue.current.push(url);
    
    // Attempt to start processing up to the limit
    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
      processQueue();
    }
  }, [processQueue]);

  // Filter channels based on presets, favorites, search, and online status
  const filteredChannels = useMemo(() => {
    return channels.filter(channel => {
      // Top Preset Online Filter (online only, no checking/offline)
      if (isOnlineFilterActive) {
        if (statuses[channel.url] !== 'online') return false;
      } else if (showOnlineOnly) {
        // Normal Category check filter: hide verified offline, show checking/online
        const status = statuses[channel.url];
        if (status === 'offline') return false;
      }

      // Favorites filter
      if (isFavoritesOnly) {
        if (!favorites.includes(channel.id)) return false;
      }

      // Search query filter
      if (debouncedSearchQuery.trim() !== '') {
        const query = debouncedSearchQuery.toLowerCase();
        const nameMatch = channel.name.toLowerCase().includes(query);
        const groupMatch = channel.group?.toLowerCase().includes(query);
        return nameMatch || groupMatch;
      }

      return true;
    });
  }, [channels, isFavoritesOnly, isOnlineFilterActive, showOnlineOnly, statuses, debouncedSearchQuery, favorites]);

  // Dynamic Online Streams Count
  const onlineCount = useMemo(() => {
    return channels.filter(ch => statuses[ch.url] === 'online').length;
  }, [channels, statuses]);

  // Slice EPG sidebar channel switcher list to a small window centered around the playing stream
  const sidebarChannels = useMemo(() => {
    if (!selectedChannel) return [];
    const activeIndex = filteredChannels.findIndex(ch => ch.id === selectedChannel.id);
    if (activeIndex === -1) return filteredChannels.slice(0, 60);

    const start = Math.max(0, activeIndex - 30);
    const end = Math.min(filteredChannels.length, activeIndex + 30);
    return filteredChannels.slice(start, end);
  }, [filteredChannels, selectedChannel]);

  // Get only visible subset of filtered channels (lazy loading)
  const visibleChannels = useMemo(() => {
    return filteredChannels.slice(0, visibleCount);
  }, [filteredChannels, visibleCount]);

  // Infinite Scroll Handler
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    
    if (scrollBottom < 250 && visibleCount < filteredChannels.length) {
      setVisibleCount(prev => Math.min(prev + LOAD_MORE_COUNT, filteredChannels.length));
    }
  };

  const toggleFavorite = (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      if (prev.includes(channelId)) {
        return prev.filter(id => id !== channelId);
      } else {
        return [...prev, channelId];
      }
    });
  };

  const handlePresetSelect = (url: string) => {
    setPlaylistUrl(url);
    setShowCustomForm(false);
    setIsFavoritesOnly(false);
    setIsOnlineFilterActive(false);
  };

  const handleCustomUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customUrl.trim()) {
      fetchPlaylist(customUrl.trim());
    }
  };

  if (hasShutDown) {
    return (
      <div className="loading-screen" style={{ background: 'var(--bg-primary)', height: '100vh', justifyContent: 'center' }}>
        <div style={{ padding: '2.5rem', background: 'var(--bg-card)', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--border-color)', maxWidth: '450px', textAlign: 'center', boxShadow: 'var(--shadow-neon)' }}>
          <h2 style={{ marginBottom: '1rem', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <Power size={24} />
            Agraja IPTV Shut Down
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.95rem', lineHeight: '1.5' }}>
            The local server has terminated. You can safely close this browser tab now.
          </p>
          <button 
            onClick={() => window.close()} 
            className="load-btn"
            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
          >
            Close Tab
          </button>
          <div style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Created by Agraja
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">
            <Tv size={22} />
          </div>
          <div>
            <h1>Agraja IPTV</h1>
            <span>Smart Player</span>
          </div>
        </div>

        {/* Search Input */}
        <div className="search-bar-container">
          <Search className="search-icon" size={18} />
          <input
            type="text"
            placeholder="Search channel or category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        {/* Global actions */}
        <div className="header-actions" style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            onClick={() => fetchPlaylist(showCustomForm ? customUrl : playlistUrl, true)} 
            className="load-btn" 
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            title="Force Refresh current playlist"
            disabled={isLoading}
          >
            <RefreshCw size={14} className={isLoading ? 'spinner' : ''} />
            Refresh
          </button>

          <button 
            onClick={handleQuit} 
            className="load-btn" 
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#fca5a5' }}
            title="Quit IPTV Player & Shutdown Server"
          >
            <Power size={14} />
            Quit
          </button>
        </div>
      </header>

      {/* Preset Pills Carousel Bar */}
      <div className="preset-carousel-container">
        <span className="preset-carousel-label">Playlists:</span>
        <div className="preset-carousel">
          {PLAYLIST_PRESETS.map((preset) => (
            <button
              key={preset.url}
              onClick={() => handlePresetSelect(preset.url)}
              className={`preset-pill ${playlistUrl === preset.url && !showCustomForm && !isFavoritesOnly && !isOnlineFilterActive ? 'active' : ''}`}
              disabled={isLoading}
            >
              {preset.name}
            </button>
          ))}

          <button
            onClick={() => {
              setIsOnlineFilterActive(true);
              setIsFavoritesOnly(false);
              setShowCustomForm(false);
            }}
            className={`preset-pill ${isOnlineFilterActive ? 'active' : ''}`}
          >
            Online Channels [{onlineCount}]
          </button>
          
          <button
            onClick={() => {
              setIsFavoritesOnly(true);
              setShowCustomForm(false);
              setIsOnlineFilterActive(false);
            }}
            className={`preset-pill ${isFavoritesOnly ? 'active' : ''}`}
          >
            My Favorites ({favorites.length})
          </button>

          <button
            onClick={() => {
              setShowCustomForm(true);
              setPlaylistUrl('custom');
              setIsFavoritesOnly(false);
              setIsOnlineFilterActive(false);
            }}
            className={`preset-pill ${showCustomForm ? 'active' : ''}`}
            disabled={isLoading}
          >
            Custom M3U URL...
          </button>
        </div>

        {showCustomForm && (
          <form onSubmit={handleCustomUrlSubmit} style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
            <input
              type="url"
              placeholder="Paste M3U Playlist URL..."
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              className="playlist-input"
              required
            />
            <button type="submit" className="load-btn" disabled={isLoading}>
              Load
            </button>
          </form>
        )}
      </div>

      {/* Main Layout (Sidebar Removed, occupies full screen width) */}
      <div className="main-content">
        <main className="dashboard-view">
          {isLoading && channels.length === 0 ? (
            <div className="loading-screen">
              <Loader2 className="spinner" size={48} />
              <p>Loading channel playlist data, please wait...</p>
            </div>
          ) : error && channels.length === 0 ? (
            <div className="empty-screen">
              <p style={{ color: 'var(--danger)', fontSize: '1.1rem', fontWeight: 600 }}>Error Loading Playlist</p>
              <p style={{ maxWidth: '450px', fontSize: '0.9rem' }}>{error}</p>
              <button 
                onClick={() => handlePresetSelect(PLAYLIST_PRESETS[0].url)} 
                className="load-btn"
                style={{ marginTop: '1rem' }}
              >
                Reset to Global Preset
              </button>
            </div>
          ) : (
            <div 
              ref={containerRef}
              className="channels-container"
              onScroll={handleScroll}
            >
              {/* Split Screen Twitch/YouTube style layout when a channel is playing */}
              {selectedChannel && (
                <div className="theater-layout">
                  {/* Left: Video Player */}
                  <div className="player-main">
                    <VideoPlayer 
                      channel={selectedChannel} 
                      onClose={() => setSelectedChannel(null)} 
                    />
                  </div>

                  {/* Right: Quick Channel Switcher Sidebar */}
                  <div className="player-sidebar">
                    <div className="player-sidebar-header">
                      <h3>Now Playing - Switcher</h3>
                      <span>{filteredChannels.length} streams</span>
                    </div>
                    <ul className="player-sidebar-list">
                      {sidebarChannels.map((channel) => {
                        const isChannelActive = selectedChannel.id === channel.id;
                        return (
                          <SidebarItem
                            key={`sidebar-${channel.id}`}
                            channel={channel}
                            status={statuses[channel.url]}
                            isActive={isChannelActive}
                            onClick={() => setSelectedChannel(channel)}
                            triggerCheck={triggerStatusCheck}
                          />
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}

              {/* Main Catalog Header */}
              <div className="section-header">
                <h2>
                  {isFavoritesOnly ? 'Favorites' : 'Channel'} Catalog
                  {debouncedSearchQuery && ` - search results for "${debouncedSearchQuery}"`}
                </h2>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                  {/* Show Online Only Filter Toggle */}
                  <label className="online-filter-toggle">
                    <input 
                      type="checkbox" 
                      checked={showOnlineOnly}
                      onChange={(e) => setShowOnlineOnly(e.target.checked)}
                    />
                    <span>Show Online Only</span>
                  </label>

                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Showing {visibleChannels.length} of {filteredChannels.length} channels
                  </span>
                </div>
              </div>

              {/* Grid channels */}
              {filteredChannels.length === 0 ? (
                <div className="empty-screen" style={{ minHeight: '300px' }}>
                  <Globe size={48} style={{ color: 'var(--text-muted)' }} />
                  <p>No streams match your filters or search.</p>
                </div>
              ) : (
                <div className="channels-grid">
                  {visibleChannels.map((channel) => {
                    const isFav = favorites.includes(channel.id);
                    const isChannelActive = selectedChannel?.id === channel.id;
                    return (
                      <ChannelGridCard
                        key={channel.id}
                        channel={channel}
                        status={statuses[channel.url]}
                        isFav={isFav}
                        onToggleFav={toggleFavorite}
                        onClick={() => {
                          setSelectedChannel(channel);
                          const player = document.querySelector('.video-player-container');
                          if (player) {
                            player.scrollIntoView({ behavior: 'smooth', block: 'end' });
                          } else {
                            if (containerRef.current) containerRef.current.scrollTop = 0;
                          }
                        }}
                        isActive={isChannelActive}
                        triggerCheck={triggerStatusCheck}
                      />
                    );
                  })}
                </div>
              )}

              {/* Bottom loading spinner for lazy loading */}
              {visibleCount < filteredChannels.length && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0', color: 'var(--text-muted)', gap: '0.5rem', alignItems: 'center' }}>
                  <Loader2 className="spinner" size={20} />
                  <span>Loading more streams...</span>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
      <footer style={{ textAlign: 'center', padding: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', background: 'rgba(10, 11, 16, 0.4)', zIndex: 10 }}>
        Created by Agraja
      </footer>
    </div>
  );
}

// Child presentational components to delegate lifecycle checks

interface ChannelCardProps {
  channel: IPTVChannel;
  status: 'checking' | 'online' | 'offline' | undefined;
  isFav: boolean;
  onToggleFav: (channelId: string, e: React.MouseEvent) => void;
  onClick: () => void;
  isActive: boolean;
  triggerCheck: (url: string) => void;
}

const ChannelGridCard: React.FC<ChannelCardProps> = ({
  channel,
  status,
  isFav,
  onToggleFav,
  onClick,
  isActive,
  triggerCheck,
}) => {
  useEffect(() => {
    triggerCheck(channel.url);
  }, [channel.url, triggerCheck]);

  return (
    <div 
      className={`channel-card ${isActive ? 'active-card' : ''}`}
      onClick={onClick}
    >
      {/* Stream Status Indicator Dot */}
      <ChannelStatusDot status={status} />

      {/* Favorite Button */}
      <button
        className={`card-fav-btn ${isFav ? 'is-fav' : ''}`}
        onClick={(e) => onToggleFav(channel.id, e)}
        title={isFav ? 'Remove from Favorites' : 'Add to Favorites'}
      >
        <Heart size={16} fill={isFav ? 'var(--danger)' : 'none'} />
      </button>

      {/* Logo */}
      <div className="channel-card-logo-container">
        {channel.logo ? (
          <img 
            src={channel.logo} 
            alt="" 
            className="channel-card-logo"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              const parent = (e.target as HTMLImageElement).parentElement;
              if (parent && !parent.querySelector('.channel-card-logo-placeholder')) {
                const placeholder = document.createElement('div');
                placeholder.className = 'channel-card-logo-placeholder';
                placeholder.innerText = channel.name.slice(0, 2).toUpperCase();
                parent.appendChild(placeholder);
              }
            }}
          />
        ) : (
          <div className="channel-card-logo-placeholder">
            {channel.name.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>

      {/* Card metadata */}
      <div className="channel-card-details">
        <div className="channel-card-name" title={channel.name}>
          {channel.name}
        </div>
        <div className="channel-card-group">
          {channel.group || 'Other'}
        </div>
      </div>
    </div>
  );
};

interface SidebarItemProps {
  channel: IPTVChannel;
  status: 'checking' | 'online' | 'offline' | undefined;
  isActive: boolean;
  onClick: () => void;
  triggerCheck: (url: string) => void;
}

const SidebarItem: React.FC<SidebarItemProps> = ({
  channel,
  status,
  isActive,
  onClick,
  triggerCheck,
}) => {
  useEffect(() => {
    triggerCheck(channel.url);
  }, [channel.url, triggerCheck]);

  return (
    <li 
      className={`sidebar-channel-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
      <div className="sidebar-channel-logo-container">
        {channel.logo ? (
          <img 
            src={channel.logo} 
            alt="" 
            className="sidebar-channel-logo"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              const parent = (e.target as HTMLImageElement).parentElement;
              if (parent && !parent.querySelector('.sidebar-channel-logo-placeholder')) {
                const placeholder = document.createElement('div');
                placeholder.className = 'sidebar-channel-logo-placeholder';
                placeholder.innerText = channel.name.slice(0, 2).toUpperCase();
                parent.appendChild(placeholder);
              }
            }}
          />
        ) : (
          <div className="sidebar-channel-logo-placeholder">
            {channel.name.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
      <div className="sidebar-channel-details">
        <div className="sidebar-channel-name" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <ChannelStatusDot status={status} />
          {channel.name}
        </div>
        <div className="sidebar-channel-group">{channel.group || 'Other'}</div>
      </div>
    </li>
  );
};

export default App;
