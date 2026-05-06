/**
 * Shared YouTube metadata + transcript fetch for MCP /call and orchestration routes.
 */

export function extractYouTubeVideoId(input) {
  let parsed;
  try {
    parsed = new URL(String(input));
  } catch (_) {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || null;
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
    if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2] || null;
    if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2] || null;
  }
  return null;
}

export function isYouTubeWatchUrl(url) {
  return Boolean(extractYouTubeVideoId(url));
}

function extractInitialPlayerResponse(html) {
  const marker = 'var ytInitialPlayerResponse = ';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const after = html.slice(idx + marker.length);
  const end = after.indexOf(';</script>');
  if (end === -1) return null;
  const jsonRaw = after.slice(0, end).trim();
  try {
    return JSON.parse(jsonRaw);
  } catch (_) {
    return null;
  }
}

function selectCaptionTrack(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  return (
    tracks.find((t) => t.languageCode === 'en')
    || tracks.find((t) => !t.kind || t.kind !== 'asr')
    || tracks[0]
  );
}

function parseYouTubeTranscriptXml(xml) {
  const out = [];
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    const chunk = decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim();
    if (chunk) out.push(chunk);
  }
  return out.join(' ').trim();
}

function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {{ url: string, includeTranscript?: boolean }} input
 */
export async function fetchYouTubeVideoContent({ url, includeTranscript = true }) {
  if (!url) throw new Error('input.url is required');

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) throw new Error('Could not parse YouTube video ID from url');

  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const pageRes = await fetch(watchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; OpheliaMCP/1.0)'
    }
  });
  if (!pageRes.ok) throw new Error(`YouTube page fetch failed (${pageRes.status})`);

  const html = await pageRes.text();
  const player = extractInitialPlayerResponse(html);
  if (!player) throw new Error('Unable to parse YouTube player response from page');

  const details = player.videoDetails || {};
  const micro = player.microformat?.playerMicroformatRenderer || {};
  const result = {
    platform: 'youtube.com',
    videoId,
    url: watchUrl,
    title: details.title || null,
    description: details.shortDescription || micro.description?.simpleText || null,
    channelTitle: details.author || micro.ownerChannelName || null,
    channelId: details.channelId || micro.externalChannelId || null,
    lengthSeconds: toNumber(details.lengthSeconds),
    viewCount: toNumber(details.viewCount),
    publishDate: micro.publishDate || null,
    isLive: Boolean(details.isLiveContent),
    keywords: Array.isArray(details.keywords) ? details.keywords : []
  };

  if (!includeTranscript) return result;

  const captionTracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const selected = selectCaptionTrack(captionTracks);
  if (!selected?.baseUrl) {
    return { ...result, transcript: null, transcriptStatus: 'unavailable' };
  }

  const transcriptRes = await fetch(`${selected.baseUrl}&fmt=srv3`);
  if (!transcriptRes.ok) {
    return { ...result, transcript: null, transcriptStatus: `fetch_failed_${transcriptRes.status}` };
  }

  const transcriptXml = await transcriptRes.text();
  return {
    ...result,
    transcriptLanguage: selected.languageCode || null,
    transcriptStatus: 'ok',
    transcript: parseYouTubeTranscriptXml(transcriptXml)
  };
}
