import React from 'react';

interface ChannelStatusDotProps {
  status: 'checking' | 'online' | 'offline' | undefined;
}

export const ChannelStatusDot: React.FC<ChannelStatusDotProps> = ({ status = 'checking' }) => {
  const tooltipText = 
    status === 'checking' ? 'Checking stream...' :
    status === 'online' ? 'Stream online' : 'Stream offline / unreachable';

  return (
    <span 
      className={`status-dot ${status}`} 
      title={tooltipText}
    />
  );
};
