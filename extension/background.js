/**
 * YouTube Playlist Link Extractor — Background Service Worker
 *
 * Runs tasks in the background so closing the popup doesn't cancel
 * long operations like batch transcript fetching or downloading.
 */

let activeJob = null; // { type: 'transcripts', mode: 'download'|'copy', progress: 0, total: 0, result: null, isDone: false, error: null }

const YT_CLIENT_CONTEXT = {
  client: {
    clientName: 'WEB',
    clientVersion: '2.20240101.00.00',
    hl: 'en',
    gl: 'US',
  },
};

// ── declarativeNetRequest setup ──────────────────────────────────────────────
async function setupWebRequestRules() {
  if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest) {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [1, 2, 3, 4, 5],
        addRules: [
          {
            id: 1,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'Origin', operation: 'set', value: 'https://www.youtube.com' },
                { header: 'Referer', operation: 'set', value: 'https://www.youtube.com/' }
              ]
            },
            condition: {
              urlFilter: '||youtube.com/youtubei/v1/browse*',
              resourceTypes: ['xmlhttprequest']
            }
          },
          {
            id: 2,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'Referer', operation: 'set', value: 'https://www.youtube.com/' }
              ]
            },
            condition: {
              urlFilter: '||youtube.com/playlist*',
              resourceTypes: ['xmlhttprequest']
            }
          },
          {
            id: 3,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'Origin', operation: 'set', value: 'https://www.youtube.com' },
                { header: 'Referer', operation: 'set', value: 'https://www.youtube.com/' }
              ]
            },
            condition: {
              urlFilter: '||youtube.com/youtubei/v1/get_transcript*',
              resourceTypes: ['xmlhttprequest']
            }
          },
          {
            id: 4,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'Referer', operation: 'set', value: 'https://www.youtube.com/' }
              ]
            },
            condition: {
              urlFilter: '||youtube.com/watch*',
              resourceTypes: ['xmlhttprequest']
            }
          },
          {
            id: 5,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'Origin', operation: 'set', value: 'https://www.youtube.com' },
                { header: 'Referer', operation: 'set', value: 'https://www.youtube.com/' }
              ]
            },
            condition: {
              urlFilter: '||youtube.com/api/timedtext*',
              resourceTypes: ['xmlhttprequest']
            }
          }
        ]
      });
    } catch (err) {
      console.error('Failed to register request rules in background:', err);
    }
  }
}

// Ensure rules are active on startup
chrome.runtime.onInstalled.addListener(setupWebRequestRules);
chrome.runtime.onStartup.addListener(setupWebRequestRules);

// ── Transcript Fetching Helpers ──────────────────────────────────────────────
function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function fetchTranscript(videoId) {
  // 1. Try InnerTube ANDROID Player API (Fastest & direct!)
  try {
    const playerResp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
          },
        },
        videoId: videoId,
      }),
    });

    if (playerResp.ok) {
      const data = await playerResp.json();
      const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (captionTracks && captionTracks.length > 0) {
        const selectedTrack = captionTracks.find(t => t.languageCode === 'en' || t.vssId?.includes('.en')) || captionTracks[0];
        let trackUrl = selectedTrack.baseUrl;
        if (!trackUrl.includes('fmt=')) trackUrl += '&fmt=srv3';
        const capResp = await fetch(trackUrl);
        if (capResp.ok) {
          const capText = await capResp.text();
          const segments = parseCaptionStream(capText);
          if (segments && segments.length > 0) return segments;
        }
      }
    }
  } catch (err) {
    console.warn(`InnerTube player API fetch failed for video ${videoId}, trying HTML fallback:`, err.message);
  }

  // 2. Fallback: Parse watch page HTML
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const watchResp = await fetch(watchUrl, {
    credentials: 'omit',
    headers: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  if (!watchResp.ok) {
    throw new Error(`Failed to fetch video page (HTTP ${watchResp.status}).`);
  }

  const watchHtml = await watchResp.text();

  const startIdx = watchHtml.indexOf('"captionTracks":');
  if (startIdx === -1) {
    throw new Error('No captions available for this video.');
  }

  const arrStart = watchHtml.indexOf('[', startIdx);
  if (arrStart === -1) {
    throw new Error('No captions available for this video.');
  }

  let depth = 0;
  let arrEnd = arrStart;
  for (let i = arrStart; i < watchHtml.length; i++) {
    if (watchHtml[i] === '[') depth++;
    else if (watchHtml[i] === ']') {
      depth--;
      if (depth === 0) {
        arrEnd = i + 1;
        break;
      }
    }
  }

  let tracks = null;
  try {
    tracks = JSON.parse(watchHtml.substring(arrStart, arrEnd));
  } catch (e) {
    throw new Error('Failed to parse caption data.');
  }

  if (!tracks || !tracks.length) {
    throw new Error('No captions available for this video.');
  }

  const selectedTrack = tracks.find(t => t.languageCode === 'en' || t.vssId?.includes('.en')) || tracks[0];
  let trackUrl = selectedTrack.baseUrl;

  if (!trackUrl.includes('fmt=')) {
    trackUrl += '&fmt=srv3';
  }

  const capResp = await fetch(trackUrl);
  if (!capResp.ok) {
    throw new Error(`Failed to fetch caption data (HTTP ${capResp.status}).`);
  }

  const capText = await capResp.text();
  const segments = parseCaptionStream(capText);

  if (!segments.length) {
    throw new Error('Transcript is empty.');
  }

  return segments;
}

function parseCaptionStream(capText) {
  function unescapeHtml(str) {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }

  const segments = [];
  let parsedJson = false;
  try {
    const capData = JSON.parse(capText);
    if (capData && capData.events) {
      parsedJson = true;
      for (const ev of capData.events) {
        if (ev.segs) {
          const text = ev.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
          const startMs = ev.tStartMs || 0;
          if (text && text !== '\n') {
            segments.push({ time: formatTime(startMs), text: unescapeHtml(text) });
          }
        }
      }
    }
  } catch (e) {}

  if (!parsedJson) {
    const textNodeRegex = /<text\s+([^>]*)>([\s\S]*?)<\/text>/gi;
    let match;
    while ((match = textNodeRegex.exec(capText)) !== null) {
      const attrStr = match[1];
      const rawText = match[2];

      const startMatch = attrStr.match(/start="([\d.]+)"/i) || attrStr.match(/start='([\d.]+)'/i);
      const startSec = startMatch ? parseFloat(startMatch[1]) : 0;

      const cleanText = unescapeHtml(rawText.replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim());
      if (cleanText) {
        segments.push({ time: formatTime(startSec * 1000), text: cleanText });
      }
    }
  }

  return segments;
}

// ── Batch Process Transcripts ───────────────────────────────────────────────
async function runBatchTranscriptsJob({ videos, mode, filename }) {
  activeJob = {
    type: 'transcripts',
    mode,
    progress: 0,
    total: videos.length,
    result: null,
    isDone: false,
    error: null,
    successCount: 0,
    failCount: 0
  };

  const allTranscripts = [];

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    activeJob.progress = i + 1;

    try {
      const segments = await fetchTranscript(video.id);
      const transcriptText = segments.map(s => `[${s.time}] ${s.text}`).join('\n');
      allTranscripts.push(`=== ${video.number}. ${video.title} ===\n${video.url}\n\n${transcriptText}`);
      activeJob.successCount++;
    } catch (err) {
      console.warn(`Background transcript fetch failed for "${video.title}":`, err.message);
      allTranscripts.push(`=== ${video.number}. ${video.title} ===\n${video.url}\n\n[Transcript unavailable: ${err.message}]`);
      activeJob.failCount++;
    }

    if (i < videos.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const combinedText = allTranscripts.join('\n\n\n');
  activeJob.result = combinedText;
  activeJob.isDone = true;

  if (mode === 'download') {
    // Automatically trigger Chrome file download in background!
    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(combinedText);
    chrome.downloads.download({
      url: dataUrl,
      filename: filename || 'transcripts.txt',
      saveAs: false
    });
  }
}

// ── Message Listener ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_BATCH_TRANSCRIPTS') {
    if (activeJob && !activeJob.isDone) {
      sendResponse({ status: 'already_running', job: activeJob });
      return true;
    }
    runBatchTranscriptsJob(request.data);
    sendResponse({ status: 'started', job: activeJob });
    return true;
  }

  if (request.type === 'GET_JOB_STATUS') {
    sendResponse({ job: activeJob });
    return true;
  }

  if (request.type === 'CLEAR_JOB') {
    activeJob = null;
    sendResponse({ status: 'cleared' });
    return true;
  }
});

