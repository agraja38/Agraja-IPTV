export interface IPTVChannel {
  id: string;
  name: string;
  url: string;
  logo: string;
  group: string;
  tvgId: string;
}

export function parseM3U(content: string): IPTVChannel[] {
  const lines = content.split(/\r?\n/);
  const channels: IPTVChannel[] = [];
  let currentMeta: Partial<IPTVChannel> | null = null;
  let idCounter = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      // Parse metadata
      // Format: #EXTINF:-1 tvg-id="id" tvg-logo="url" group-title="group",Channel Name
      const extinfRegex = /^#EXTINF:[-0-9\s]*(.*),(.*)$/;
      const match = line.match(extinfRegex);

      if (match) {
        const attributesStr = match[1];
        const name = match[2].trim();

        // Extract key-value pairs like key="value"
        const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
        let attrMatch;
        const attrs: Record<string, string> = {};

        while ((attrMatch = attrRegex.exec(attributesStr)) !== null) {
          attrs[attrMatch[1]] = attrMatch[2];
        }

        currentMeta = {
          id: `channel-${idCounter++}`,
          name: name || 'Unknown Channel',
          logo: attrs['tvg-logo'] || '',
          group: attrs['group-title'] || 'Other',
          tvgId: attrs['tvg-id'] || '',
        };
      }
    } else if (line.startsWith('#')) {
      // Other tags we ignore
      continue;
    } else {
      // It's a URL line
      if (currentMeta) {
        const channel: IPTVChannel = {
          id: currentMeta.id || `channel-${idCounter++}`,
          name: currentMeta.name || 'Unknown Channel',
          url: line,
          logo: currentMeta.logo || '',
          group: currentMeta.group || 'Other',
          tvgId: currentMeta.tvgId || '',
        };
        channels.push(channel);
        currentMeta = null;
      }
    }
  }

  return channels;
}
