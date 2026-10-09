/**
 * YouTube Playlist Link Extractor — Browser Extension (Manifest V3)
 *
 * Extracts video URLs from YouTube playlists entirely client-side.
 * Uses declarativeNetRequest to bypass YouTube CORS / Origin checks
 * for first-party lookups, allowing direct fetches from the popup context.
 * No backend, no API key, no downloads.
 */

(() => {
  'use strict';

  // ── DOM Elements ──────────────────────────────────────────────────────────
  const urlInput       = document.getElementById('playlist-url');
  const extractBtn     = document.getElementById('extract-btn');
  const inputError     = document.getElementById('input-error');
  const resultsSection = document.getElementById('results-section');
  const playlistTitle  = document.getElementById('playlist-title');
  const videoCount     = document.getElementById('video-count');
  const videoList      = document.getElementById('video-list');
  const copyBtn        = document.getElementById('copy-btn');
  const downloadBtn    = document.getElementById('download-btn');
  const clearBtn       = document.getElementById('clear-btn');
  const loadingState   = document.getElementById('loading-state');
  const loadingHint    = document.getElementById('loading-hint');
  const emptyState     = document.getElementById('empty-state');
  const emptyStateText = document.getElementById('empty-state-text');
  
  // Range Copy Elements
  const rangeFrom      = document.getElementById('range-from');
  const rangeTo        = document.getElementById('range-to');
  const copyRangeBtn   = document.getElementById('copy-range-btn');

  // Search / Filter Elements
  const searchFilter   = document.getElementById('search-filter');
  const searchClearBtn = document.getElementById('search-clear-btn');

  // Transcript Elements
  const copyTranscriptsBtn     = document.getElementById('copy-transcripts-btn');
  const downloadTranscriptsBtn = document.getElementById('download-transcripts-btn');
  const transcriptModal        = document.getElementById('transcript-modal');
  const transcriptModalTitle   = document.getElementById('transcript-modal-title');
  const transcriptContent      = document.getElementById('transcript-content');
  const transcriptLangSelect   = document.getElementById('transcript-lang-select');
  const transcriptCopyBtn      = document.getElementById('transcript-copy-btn');
  const transcriptDownloadBtn  = document.getElementById('transcript-download-btn');
  const transcriptCloseBtn     = document.getElementById('transcript-close-btn');
  const transcriptBackdrop     = document.querySelector('.transcript-modal__backdrop');
  
  // Current Video Card Elements
  const currentVideoCard         = document.getElementById('current-video-card');
  const currentVideoIndex        = document.getElementById('current-video-index');
  const currentVideoTitle        = document.getElementById('current-video-title');
  const currentVideoUrl          = document.getElementById('current-video-url');
  const currentCopyLinkBtn       = document.getElementById('current-copy-link-btn');
  const currentCopyTranscriptBtn = document.getElementById('current-copy-transcript-btn');
  const currentViewTranscriptBtn = document.getElementById('current-view-transcript-btn');

  let currentTranscriptText = '';
  let activeVideoIdForModal = null;
  let availableTracksForModal = [];
  let currentVideos = [];
  let activeTabVideoId = null;

  // ── YouTube Client Context for browse API ─────────────────────────────────
  const YT_CLIENT_CONTEXT = {
    client: {
      clientName: 'WEB',
      clientVersion: '2.20241001.00.00',
      hl: 'en',
      gl: 'US',
    },
  };

  // ── Init: Auto-fill URL & Active Video ID from current tab ──────────────────
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url) {
      const vId = extractVideoIdFromUrl(tabs[0].url);
      if (vId) activeTabVideoId = vId;
      if (isValidPlaylistUrl(tabs[0].url)) {
        urlInput.value = tabs[0].url;
      }
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function extractVideoIdFromUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      if (u.searchParams.has('v')) {
        return u.searchParams.get('v');
      }
    } catch { return null; }
    return null;
  }

  function isValidPlaylistUrl(url) {
    try {
      const u = new URL(url);
      return /^(www\.)?youtube\.com$/i.test(u.hostname) && u.searchParams.has('list');
    } catch {
      return false;
    }
  }

  function extractPlaylistId(url) {
    try { return new URL(url).searchParams.get('list'); }
    catch { return null; }
  }

  function showError(msg) { inputError.textContent = msg; }
  function clearError()   { inputError.textContent = ''; }

  function setLoading(on, hint) {
    loadingState.classList.toggle('hidden', !on);
    extractBtn.classList.toggle('loading', on);
    extractBtn.disabled = on;
    urlInput.disabled = on;
    if (hint) loadingHint.textContent = hint;
  }

  function showToast(msg) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 250);
    }, 1800);
  }

  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { return false; }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function parseCaptionStream(capText) {
    function unescapeHtml(str) {
      return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
    }
    function formatTime(ms) {
      const totalSeconds = Math.floor(ms / 1000);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;
      if (h > 0) return h + ":" + String(m).padStart(2, '0') + ":" + String(s).padStart(2, '0');
      return m + ":" + String(s).padStart(2, '0');
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
            if (text && text !== '\n') segments.push({ time: formatTime(ev.tStartMs || 0), text: unescapeHtml(text) });
          }
        }
      }
    } catch (e) {}

    if (!parsedJson) {
      const textNodeRegex = /<(?:text|p)\s+([^>]*)>([\s\S]*?)<\/(?:text|p)>/gi;
      let match;
      while ((match = textNodeRegex.exec(capText)) !== null) {
        const attrStr = match[1];
        let startSec = 0;
        const startMatch = attrStr.match(/(?:start|t)="([\d.]+)"/i) || attrStr.match(/(?:start|t)='([\d.]+)'/i);
        if (startMatch) startSec = parseFloat(startMatch[1]);
        if (attrStr.includes('t=')) startSec = startSec / 1000;
        let text = match[2].replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim();
        if (text) segments.push({ time: formatTime(Math.round(startSec * 1000)), text: unescapeHtml(text) });
      }
    }
    return segments;
  }

  async function fetchTranscript(videoId, preferredLangCode = null) {
    if (!videoId) throw new Error("Invalid video ID.");

    // 1. Primary: Direct InnerTube Player API call from extension popup
    try {
      const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
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

      if (resp.ok) {
        const data = await resp.json();
        const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (captionTracks.length > 0) {
          const trackList = captionTracks.map(t => ({
            code: t.languageCode,
            name: t.name?.runs?.[0]?.text || t.name?.simpleText || t.languageCode,
            isAuto: t.vssId?.startsWith('a.') || false,
            url: t.baseUrl
          }));

          let selectedTrack = null;
          if (preferredLangCode) {
            selectedTrack = captionTracks.find(t => t.languageCode === preferredLangCode);
          }
          if (!selectedTrack) {
            selectedTrack = captionTracks.find(t => t.languageCode === 'en' || t.vssId?.includes('.en')) || captionTracks[0];
          }

          let trackUrl = selectedTrack.baseUrl;
          if (!trackUrl.includes('fmt=')) trackUrl += '&fmt=srv3';

          const capResp = await fetch(trackUrl);
          if (capResp.ok) {
            const capText = await capResp.text();
            const segments = parseCaptionStream(capText);
            if (segments && segments.length > 0) {
              return { segments, tracks: trackList, selectedLang: selectedTrack.languageCode };
            }
          }
        }
      }
    } catch (err) {
      console.warn('Direct player API transcript fetch failed, trying tab execution:', err);
    }

    // 2. Secondary: In-tab execution fallback
    let targetTabId = null;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length && tabs[0].id) {
      targetTabId = tabs[0].id;
    } else {
      const ytTabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
      if (ytTabs && ytTabs.length) targetTabId = ytTabs[0].id;
    }

    if (!targetTabId) throw new Error("Could not find an active browser tab.");

    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: async (vid, targetLang) => {
        try {
          const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
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
              videoId: vid,
            }),
          });
          if (!resp.ok) throw new Error("Failed to query player API (HTTP " + resp.status + ")");
          const data = await resp.json();
          const captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
          if (!captionTracks.length) throw new Error('No captions available for this video.');

          const trackList = captionTracks.map(t => ({
            code: t.languageCode,
            name: t.name?.runs?.[0]?.text || t.name?.simpleText || t.languageCode,
            isAuto: t.vssId?.startsWith('a.') || false,
            url: t.baseUrl
          }));

          let selectedTrack = null;
          if (targetLang) {
            selectedTrack = captionTracks.find(t => t.languageCode === targetLang);
          }
          if (!selectedTrack) {
            selectedTrack = captionTracks.find(t => t.languageCode === 'en' || t.vssId?.includes('.en')) || captionTracks[0];
          }

          let trackUrl = selectedTrack.baseUrl;
          if (!trackUrl.includes('fmt=')) trackUrl += '&fmt=srv3';
          const capResp = await fetch(trackUrl);
          if (!capResp.ok) throw new Error('Failed to download subtitle stream.');
          const capText = await capResp.text();

          function unescapeHtml(str) { return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' '); }
          function formatTime(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const h = Math.floor(totalSeconds / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = totalSeconds % 60;
            if (h > 0) return h + ":" + String(m).padStart(2, '0') + ":" + String(s).padStart(2, '0');
            return m + ":" + String(s).padStart(2, '0');
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
                  if (text && text !== '\n') segments.push({ time: formatTime(ev.tStartMs || 0), text: unescapeHtml(text) });
                }
              }
            }
          } catch (e) {}

          if (!parsedJson) {
            const textNodeRegex = /<(?:text|p)\s+([^>]*)>([\s\S]*?)<\/(?:text|p)>/gi;
            let match;
            while ((match = textNodeRegex.exec(capText)) !== null) {
              const attrStr = match[1];
              let startSec = 0;
              const startMatch = attrStr.match(/(?:start|t)="([\d.]+)"/i) || attrStr.match(/(?:start|t)='([\d.]+)'/i);
              if (startMatch) startSec = parseFloat(startMatch[1]);
              if (attrStr.includes('t=')) startSec = startSec / 1000;
              let text = match[2].replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim();
              if (text) segments.push({ time: formatTime(Math.round(startSec * 1000)), text: unescapeHtml(text) });
            }
          }
          if (segments.length === 0) throw new Error('Failed to parse transcript format.');
          return { success: true, res: { segments, tracks: trackList, selectedLang: selectedTrack.languageCode } };
        } catch (err) {
          return { success: false, error: err.message };
        }
      },
      args: [videoId, preferredLangCode]
    });

    if (!results || !results.length) throw new Error("Failed to execute script in tab.");
    const res = results[0].result;
    if (!res.success) throw new Error(res.error);
    return res.res;
  }

  function hideAll() {
    resultsSection.classList.add('hidden');
    emptyState.classList.add('hidden');
    loadingState.classList.add('hidden');
    currentVideos = [];
  }

  // ── declarativeNetRequest Setup ───────────────────────────────────────────

  async function setupWebRequestRules() {
    if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest) {
      try {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [1, 2],
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
            }
          ]
        });
      } catch (err) {
        console.error('Failed to register request rules:', err);
      }
    }
  }

  // ── YouTube Data Extraction ───────────────────────────────────────────────

  function parseYtInitialDataFromHtml(html) {
    const marker = 'ytInitialData =';
    const idx = html.indexOf(marker);
    if (idx === -1) throw new Error('Could not find ytInitialData in YouTube HTML page.');
    const startBrace = html.indexOf('{', idx);
    if (startBrace === -1) throw new Error('Could not find start brace for ytInitialData.');

    let depth = 0;
    let inString = false;
    let escape = false;
    let endBrace = -1;

    for (let i = startBrace; i < html.length; i++) {
      const ch = html[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (!inString) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { endBrace = i + 1; break; }
        }
      }
    }

    if (endBrace === -1) throw new Error('Malformed playlist data structure.');
    return JSON.parse(html.substring(startBrace, endBrace));
  }

  function extractTubeConfig(html) {
    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
    const apiKey = apiKeyMatch ? apiKeyMatch[1] : '';

    const clientVerMatch = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
    const clientVersion = clientVerMatch ? clientVerMatch[1] : '2.20241001.00.00';

    return { apiKey, clientVersion };
  }

  function parseYtData(data) {
    const videos = [];
    let continuationToken = null;
    const seenIds = new Set();

    function walk(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const item of obj) walk(item);
        return;
      }

      if (obj.lockupViewModel) {
        const lvm = obj.lockupViewModel;
        const videoId = lvm.contentId;
        const title = lvm.metadata?.lockupMetadataViewModel?.title?.content || 'Untitled';
        if (videoId && !seenIds.has(videoId)) {
          seenIds.add(videoId);
          videos.push({ id: videoId, title });
        }
      }

      if (obj.playlistVideoRenderer) {
        const pvr = obj.playlistVideoRenderer;
        const videoId = pvr.videoId;
        const title = pvr.title?.runs?.[0]?.text || pvr.title?.simpleText || 'Untitled';
        if (videoId && !seenIds.has(videoId)) {
          seenIds.add(videoId);
          videos.push({ id: videoId, title });
        }
      }

      if (obj.continuationCommand?.token) {
        continuationToken = obj.continuationCommand.token;
      } else if (obj.continuationEndpoint?.continuationCommand?.token) {
        continuationToken = obj.continuationEndpoint.continuationCommand.token;
      }

      for (const key of Object.keys(obj)) {
        walk(obj[key]);
      }
    }

    walk(data);

    let playlistTitle = 'YouTube Playlist';
    if (data?.metadata?.playlistMetadataRenderer?.title) {
      playlistTitle = data.metadata.playlistMetadataRenderer.title;
    } else if (data?.header?.playlistHeaderRenderer?.title) {
      const t = data.header.playlistHeaderRenderer.title;
      playlistTitle = t.simpleText || t.runs?.[0]?.text || playlistTitle;
    } else if (data?.header?.playlistCustomHeaderRenderer?.title) {
      const t = data.header.playlistCustomHeaderRenderer.title;
      playlistTitle = t.simpleText || t.runs?.[0]?.text || playlistTitle;
    }

    return { videos, continuationToken, playlistTitle };
  }

  async function fetchContinuation(token, apiKey, clientVersion) {
    const browseUrl = apiKey
      ? `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`
      : 'https://www.youtube.com/youtubei/v1/browse';

    const response = await fetch(browseUrl, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: clientVersion || '2.20241001.00.00',
            hl: 'en',
            gl: 'US',
          },
        },
        continuation: token,
      }),
    });

    if (!response.ok) throw new Error(`Continuation request failed (HTTP ${response.status}).`);
    return await response.json();
  }

  async function extractViaTab(playlistId) {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    let targetTabId = null;
    let createdTempTab = false;

    if (activeTabs[0]?.url && /youtube\.com/i.test(activeTabs[0].url)) {
      targetTabId = activeTabs[0].id;
    } else {
      const ytTabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
      if (ytTabs.length > 0) {
        targetTabId = ytTabs[0].id;
      }
    }

    if (!targetTabId) {
      const tempTab = await chrome.tabs.create({
        url: `https://www.youtube.com/playlist?list=${playlistId}`,
        active: false,
      });
      targetTabId = tempTab.id;
      createdTempTab = true;

      await new Promise((resolve) => {
        const listener = (tId, changeInfo) => {
          if (tId === tempTab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(resolve, 4000);
      });
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: async (targetPlaylistId) => {
          function parseYtInitialDataFromHtml(html) {
            const marker = 'ytInitialData =';
            const idx = html.indexOf(marker);
            if (idx === -1) throw new Error('ytInitialData marker not found.');
            const startBrace = html.indexOf('{', idx);
            if (startBrace === -1) throw new Error('Start brace not found.');

            let depth = 0, inString = false, escape = false, endBrace = -1;
            for (let i = startBrace; i < html.length; i++) {
              const ch = html[i];
              if (escape) { escape = false; continue; }
              if (ch === '\\') { escape = true; continue; }
              if (ch === '"') { inString = !inString; continue; }
              if (!inString) {
                if (ch === '{') depth++;
                else if (ch === '}') {
                  depth--;
                  if (depth === 0) { endBrace = i + 1; break; }
                }
              }
            }
            if (endBrace === -1) throw new Error('Malformed JSON.');
            return JSON.parse(html.substring(startBrace, endBrace));
          }

          function extractTubeConfig(html) {
            const apiKeyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
            const apiKey = apiKeyMatch ? apiKeyMatch[1] : (typeof window !== 'undefined' && window.ytcfg ? window.ytcfg.get('INNERTUBE_API_KEY') : '');

            const clientVerMatch = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
            const clientVersion = clientVerMatch ? clientVerMatch[1] : (typeof window !== 'undefined' && window.ytcfg ? window.ytcfg.get('INNERTUBE_CLIENT_VERSION') : '2.20241001.00.00');

            return { apiKey, clientVersion };
          }

          function parseYtData(data) {
            const videos = [];
            let continuationToken = null;
            const seenIds = new Set();

            function walk(obj) {
              if (!obj || typeof obj !== 'object') return;
              if (Array.isArray(obj)) { for (const item of obj) walk(item); return; }

              if (obj.lockupViewModel) {
                const lvm = obj.lockupViewModel;
                const videoId = lvm.contentId;
                const title = lvm.metadata?.lockupMetadataViewModel?.title?.content || 'Untitled';
                if (videoId && !seenIds.has(videoId)) {
                  seenIds.add(videoId);
                  videos.push({ id: videoId, title });
                }
              }

              if (obj.playlistVideoRenderer) {
                const pvr = obj.playlistVideoRenderer;
                const videoId = pvr.videoId;
                const title = pvr.title?.runs?.[0]?.text || pvr.title?.simpleText || 'Untitled';
                if (videoId && !seenIds.has(videoId)) {
                  seenIds.add(videoId);
                  videos.push({ id: videoId, title });
                }
              }

              if (obj.continuationCommand?.token) {
                continuationToken = obj.continuationCommand.token;
              } else if (obj.continuationEndpoint?.continuationCommand?.token) {
                continuationToken = obj.continuationEndpoint.continuationCommand.token;
              }

              for (const key of Object.keys(obj)) walk(obj[key]);
            }

            walk(data);

            let playlistTitle = 'YouTube Playlist';
            if (data?.metadata?.playlistMetadataRenderer?.title) {
              playlistTitle = data.metadata.playlistMetadataRenderer.title;
            } else if (data?.header?.playlistHeaderRenderer?.title) {
              const t = data.header.playlistHeaderRenderer.title;
              playlistTitle = t.simpleText || t.runs?.[0]?.text || playlistTitle;
            } else if (data?.header?.playlistCustomHeaderRenderer?.title) {
              const t = data.header.playlistCustomHeaderRenderer.title;
              playlistTitle = t.simpleText || t.runs?.[0]?.text || playlistTitle;
            }

            return { videos, continuationToken, playlistTitle };
          }

          async function fetchContinuationInTab(token, apiKey, clientVersion) {
            const browseUrl = apiKey
              ? `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`
              : 'https://www.youtube.com/youtubei/v1/browse';

            const response = await fetch(browseUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
              },
              body: JSON.stringify({
                context: {
                  client: {
                    clientName: 'WEB',
                    clientVersion: clientVersion || '2.20241001.00.00',
                    hl: 'en',
                    gl: 'US',
                  },
                },
                continuation: token,
              }),
            });

            if (!response.ok) throw new Error(`Continuation request failed (HTTP ${response.status}).`);
            return await response.json();
          }

          try {
            let initialData = null;
            let apiKey = '';
            let clientVersion = '2.20241001.00.00';

            if (typeof window !== 'undefined' && window.ytInitialData && window.location.href.includes(targetPlaylistId)) {
              initialData = window.ytInitialData;
              if (window.ytcfg) {
                apiKey = window.ytcfg.get('INNERTUBE_API_KEY') || '';
                clientVersion = window.ytcfg.get('INNERTUBE_CLIENT_VERSION') || clientVersion;
              }
            }

            if (!initialData) {
              const resp = await fetch(`https://www.youtube.com/playlist?list=${targetPlaylistId}`);
              if (!resp.ok) throw new Error(`Failed to fetch playlist (HTTP ${resp.status}).`);
              const html = await resp.text();
              initialData = parseYtInitialDataFromHtml(html);
              const cfg = extractTubeConfig(html);
              if (cfg.apiKey) apiKey = cfg.apiKey;
              if (cfg.clientVersion) clientVersion = cfg.clientVersion;
            }

            const parsed = parseYtData(initialData);
            let allVideos = [...parsed.videos];
            let continuation = parsed.continuationToken;

            while (continuation) {
              const contData = await fetchContinuationInTab(continuation, apiKey, clientVersion);
              const contParsed = parseYtData(contData);
              if (!contParsed.videos.length && !contParsed.continuationToken) break;
              allVideos = allVideos.concat(contParsed.videos);
              continuation = contParsed.continuationToken;
            }

            return { success: true, playlistTitle: parsed.playlistTitle, videos: allVideos };
          } catch (err) {
            return { success: false, error: err.message };
          }
        },
        args: [playlistId],
      });

      if (createdTempTab) {
        chrome.tabs.remove(targetTabId);
      }

      if (results && results[0]?.result) {
        const res = results[0].result;
        if (res.success && res.videos.length > 0) {
          return res;
        }
      }
    } catch (err) {
      if (createdTempTab) {
        chrome.tabs.remove(targetTabId);
      }
    }

    return null;
  }

  async function extractAllVideos(playlistId) {
    setLoading(true, 'Connecting to YouTube...');
    await setupWebRequestRules();

    setLoading(true, 'Extracting playlist metadata...');
    const tabResult = await extractViaTab(playlistId);
    if (tabResult && tabResult.videos?.length) {
      return { playlistTitle: tabResult.playlistTitle, videos: tabResult.videos };
    }

    setLoading(true, 'Fetching playlist page...');
    const response = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, {
      credentials: 'omit',
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    });

    if (!response.ok) {
      if (response.status === 404) throw new Error('Playlist not found. It may be private or deleted.');
      throw new Error(`Failed to fetch playlist (HTTP ${response.status}).`);
    }

    const html = await response.text();
    const { apiKey, clientVersion } = extractTubeConfig(html);
    const initialData = parseYtInitialDataFromHtml(html);
    const parsed = parseYtData(initialData);

    let allVideos = [...parsed.videos];
    let continuation = parsed.continuationToken;
    let page = 1;

    while (continuation) {
      page++;
      setLoading(true, `Loading page ${page}... (${allVideos.length} videos so far)`);
      const contData = await fetchContinuation(continuation, apiKey, clientVersion);
      const contParsed = parseYtData(contData);
      if (!contParsed.videos.length && !contParsed.continuationToken) break;
      allVideos = allVideos.concat(contParsed.videos);
      continuation = contParsed.continuationToken;
    }

    return { playlistTitle: parsed.playlistTitle, videos: allVideos };
  }

  // ── Rendering & Live Search ───────────────────────────────────────────────

  function applySearchFilter() {
    const query = searchFilter.value.trim().toLowerCase();
    searchClearBtn.classList.toggle('hidden', query.length === 0);

    if (!currentVideos || !currentVideos.length) return;

    let filtered = currentVideos;
    if (query.length > 0) {
      filtered = currentVideos.filter(v => v.title.toLowerCase().includes(query) || v.url.toLowerCase().includes(query));
    }

    if (query.length > 0) {
      videoCount.textContent = `${filtered.length} of ${currentVideos.length} videos`;
    } else {
      videoCount.textContent = `${currentVideos.length} video${currentVideos.length !== 1 ? 's' : ''} found`;
    }

    renderVideoItems(filtered);
  }

  searchFilter.addEventListener('input', applySearchFilter);
  searchClearBtn.addEventListener('click', () => {
    searchFilter.value = '';
    applySearchFilter();
    searchFilter.focus();
  });

  function renderVideoItems(videosToRender) {
    videoList.innerHTML = '';
    if (!videosToRender || videosToRender.length === 0) {
      const li = document.createElement('li');
      li.style.cssText = 'padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.8rem;';
      li.textContent = 'No videos match your filter query.';
      videoList.appendChild(li);
      return;
    }

    const currentVidId = activeTabVideoId || extractVideoIdFromUrl(urlInput.value.trim());

    for (const video of videosToRender) {
      const isCurrent = currentVidId && video.id === currentVidId;
      const li = document.createElement('li');
      li.className = isCurrent ? 'video-item video-item--current' : 'video-item';
      li.innerHTML = `
        <span class="video-item__number">${video.number}</span>
        <div class="video-item__info">
          <div class="video-item__title" title="${escapeHtml(video.title)}">
            ${escapeHtml(video.title)}
            ${isCurrent ? '<span class="badge badge--success" style="margin-left: 6px; font-size: 0.65rem;">NOW PLAYING</span>' : ''}
          </div>
          <a class="video-item__url" href="${escapeHtml(video.url)}" target="_blank" rel="noopener">${escapeHtml(video.url)}</a>
        </div>
        <div class="video-item__actions">
          <button class="video-item__copy" title="Copy video link" data-url="${escapeHtml(video.url)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="video-item__transcript-copy" title="Extract & Copy Transcript" data-video-id="${escapeHtml(video.id)}" data-video-title="${escapeHtml(video.title)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </button>
        </div>
      `;
      videoList.appendChild(li);
    }
  }

  function renderResults(data) {
    const videos = data.videos.map((v, i) => ({
      number: i + 1,
      id: v.id,
      title: v.title,
      url: `https://www.youtube.com/watch?v=${v.id}`,
    }));

    currentVideos = videos;
    playlistTitle.textContent = data.playlistTitle;
    searchFilter.value = '';
    searchClearBtn.classList.add('hidden');
    videoCount.textContent = `${videos.length} video${videos.length !== 1 ? 's' : ''} found`;

    // Initialize Range Inputs
    rangeFrom.value = 1;
    rangeFrom.min = 1;
    rangeFrom.max = videos.length;
    rangeTo.value = videos.length;
    rangeTo.min = 1;
    rangeTo.max = videos.length;

    // Check if input URL or active tab has a specific video ID (v=)
    const targetVidId = activeTabVideoId || extractVideoIdFromUrl(urlInput.value.trim());
    const currentVideoObj = targetVidId ? videos.find(v => v.id === targetVidId) : null;

    if (currentVideoObj) {
      currentVideoCard.classList.remove('hidden');
      currentVideoIndex.textContent = `#${currentVideoObj.number} of ${videos.length}`;
      currentVideoTitle.textContent = currentVideoObj.title;
      currentVideoTitle.title = currentVideoObj.title;
      currentVideoUrl.textContent = currentVideoObj.url;
      currentVideoUrl.href = currentVideoObj.url;

      currentCopyLinkBtn.onclick = async () => {
        const ok = await copyToClipboard(currentVideoObj.url);
        if (ok) {
          showToast('Current video link copied!');
          const btnSpan = currentCopyLinkBtn.querySelector('span');
          btnSpan.textContent = 'Copied!';
          setTimeout(() => { btnSpan.textContent = 'Copy Link'; }, 1500);
        }
      };

      currentCopyTranscriptBtn.onclick = async () => {
        if (currentCopyTranscriptBtn.classList.contains('loading')) return;
        currentCopyTranscriptBtn.classList.add('loading');
        const btnSpan = currentCopyTranscriptBtn.querySelector('span');
        const origText = btnSpan.textContent;
        btnSpan.textContent = 'Fetching...';

        try {
          const res = await fetchTranscript(currentVideoObj.id);
          const fullText = res.segments.map(s => `[${s.time}] ${s.text}`).join('\n');
          const ok = await copyToClipboard(fullText);
          if (ok) {
            btnSpan.textContent = 'Copied!';
            showToast('Current video transcript copied!');
          } else {
            btnSpan.textContent = 'Failed';
          }
        } catch (err) {
          showToast(`Transcript error: ${err.message}`);
          btnSpan.textContent = 'Error';
        } finally {
          setTimeout(() => {
            currentCopyTranscriptBtn.classList.remove('loading');
            btnSpan.textContent = origText;
          }, 1800);
        }
      };

      currentViewTranscriptBtn.onclick = () => {
        openTranscriptModal(currentVideoObj.title, currentVideoObj.id);
      };
    } else {
      currentVideoCard.classList.add('hidden');
    }

    renderVideoItems(videos);

    resultsSection.classList.remove('hidden');
    emptyState.classList.add('hidden');
  }

  function showEmpty(msg) {
    resultsSection.classList.add('hidden');
    emptyState.classList.remove('hidden');
    emptyStateText.textContent = msg || 'The playlist is empty or all videos are unavailable.';
  }

  // ── Main Handler ──────────────────────────────────────────────────────────

  async function handleExtract() {
    clearError();
    const url = urlInput.value.trim();

    if (!url) {
      showError('Please paste a YouTube playlist URL.');
      urlInput.focus();
      return;
    }

    if (!isValidPlaylistUrl(url)) {
      showError('Invalid URL. Must be a YouTube playlist URL with "list=" parameter.');
      urlInput.focus();
      return;
    }

    const playlistId = extractPlaylistId(url);
    if (!playlistId) {
      showError('Could not extract playlist ID from URL.');
      return;
    }

    hideAll();

    try {
      const result = await extractAllVideos(playlistId);
      if (!result.videos.length) {
        showEmpty('The playlist is empty or all videos are unavailable.');
        return;
      }
      renderResults(result);
    } catch (err) {
      console.error('Extraction error:', err);
      showError(err.message || 'Failed to extract playlist links.');
    } finally {
      setLoading(false);
    }
  }

  // ── Event Listeners ───────────────────────────────────────────────────────

  extractBtn.addEventListener('click', handleExtract);

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleExtract(); }
  });

  urlInput.addEventListener('input', clearError);

  copyBtn.addEventListener('click', async () => {
    if (!currentVideos.length) return;
    const text = currentVideos.map(v => v.url).join('\n');
    const ok = await copyToClipboard(text);
    if (ok) {
      copyBtn.classList.add('copied');
      copyBtn.querySelector('span').textContent = 'Copied!';
      showToast(`${currentVideos.length} link${currentVideos.length !== 1 ? 's' : ''} copied`);
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.querySelector('span').textContent = 'Copy All';
      }, 1800);
    }
  });

  downloadBtn.addEventListener('click', () => {
    if (!currentVideos.length) return;
    const lines = currentVideos.map(v => `${v.number}. ${v.title}\n   ${v.url}`);
    const content = lines.join('\n\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: 'playlist_links.txt', saveAs: true }, () => {
      URL.revokeObjectURL(url);
    });
    showToast('Download started');
  });

  // ── Range Helper ──────────────────────────────────────────────────────────
  function getRangeVideos() {
    if (!currentVideos || !currentVideos.length) {
      showToast('No videos available');
      return [];
    }

    let fromVal = parseInt(rangeFrom.value, 10);
    let toVal = parseInt(rangeTo.value, 10);

    if (isNaN(fromVal) || fromVal < 1) fromVal = 1;
    if (isNaN(toVal) || toVal > currentVideos.length) toVal = currentVideos.length;

    if (fromVal > toVal) {
      showToast('Error: "From" must be less than or equal to "To"');
      return [];
    }

    return currentVideos.filter(v => v.number >= fromVal && v.number <= toVal);
  }

  // ── Copy Range Links ──────────────────────────────────────────────────────
  copyRangeBtn.addEventListener('click', async () => {
    const rangeVideos = getRangeVideos();
    if (!rangeVideos.length) return;

    const text = rangeVideos.map(v => v.url).join('\n');
    const ok = await copyToClipboard(text);
    if (ok) {
      copyRangeBtn.classList.add('copied');
      const btnSpan = copyRangeBtn.querySelector('span');
      const originalText = btnSpan.textContent;
      btnSpan.textContent = 'Copied!';
      showToast(`${rangeVideos.length} link${rangeVideos.length !== 1 ? 's' : ''} copied (videos ${rangeVideos[0].number}-${rangeVideos[rangeVideos.length - 1].number})`);
      setTimeout(() => {
        copyRangeBtn.classList.remove('copied');
        btnSpan.textContent = originalText;
      }, 1800);
    } else {
      showToast('Failed to copy links');
    }
  });

  // ── Copy Range Transcripts ────────────────────────────────────────────────
  copyTranscriptsBtn.addEventListener('click', async () => {
    const rangeVideos = getRangeVideos();
    if (!rangeVideos.length) return;

    if (copyTranscriptsBtn.classList.contains('loading')) return;
    copyTranscriptsBtn.classList.add('loading');
    const btnSpan = copyTranscriptsBtn.querySelector('span');
    const originalLabel = btnSpan.textContent;

    const allTranscripts = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < rangeVideos.length; i++) {
      const video = rangeVideos[i];
      btnSpan.textContent = `${i + 1}/${rangeVideos.length}...`;

      try {
        const res = await fetchTranscript(video.id);
        const transcriptText = res.segments.map(s => `[${s.time}] ${s.text}`).join('\n');
        allTranscripts.push(`=== ${video.number}. ${video.title} ===\n${video.url}\n\n${transcriptText}`);
        successCount++;
      } catch (err) {
        console.warn(`Transcript fetch failed for "${video.title}":`, err.message);
        allTranscripts.push(`=== ${video.number}. ${video.title} ===\n${video.url}\n\n[Transcript unavailable: ${err.message}]`);
        failCount++;
      }

      if (i < rangeVideos.length - 1) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    copyTranscriptsBtn.classList.remove('loading');
    const combinedText = allTranscripts.join('\n\n\n');
    const ok = await copyToClipboard(combinedText);

    if (ok) {
      copyTranscriptsBtn.classList.add('copied');
      btnSpan.textContent = 'Copied!';
      const failMsg = failCount > 0 ? ` (${failCount} unavailable)` : '';
      showToast(`${successCount} transcript${successCount !== 1 ? 's' : ''} copied${failMsg}`);
      setTimeout(() => {
        copyTranscriptsBtn.classList.remove('copied');
        btnSpan.textContent = originalLabel;
      }, 2000);
    } else {
      btnSpan.textContent = originalLabel;
      showToast('Failed to copy transcripts');
    }
  });

  // ── Download Range Transcripts as TXT ──────────────────────────────────────
  downloadTranscriptsBtn.addEventListener('click', async () => {
    const rangeVideos = getRangeVideos();
    if (!rangeVideos.length) return;

    if (downloadTranscriptsBtn.classList.contains('loading')) return;
    downloadTranscriptsBtn.classList.add('loading');
    const btnSpan = downloadTranscriptsBtn.querySelector('span');
    const originalLabel = btnSpan.textContent;

    const allTranscripts = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < rangeVideos.length; i++) {
      const video = rangeVideos[i];
      btnSpan.textContent = `${i + 1}/${rangeVideos.length}...`;

      try {
        const res = await fetchTranscript(video.id);
        const transcriptText = res.segments.map(s => `[${s.time}] ${s.text}`).join('\n');
        allTranscripts.push(`=== ${video.number}. ${video.title} ===\n${video.url}\n\n${transcriptText}`);
        successCount++;
      } catch (err) {
        console.warn(`Transcript fetch failed for "${video.title}":`, err.message);
        allTranscripts.push(`=== ${video.number}. ${video.title} ===\n${video.url}\n\n[Transcript unavailable: ${err.message}]`);
        failCount++;
      }

      if (i < rangeVideos.length - 1) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    downloadTranscriptsBtn.classList.remove('loading');
    btnSpan.textContent = originalLabel;

    const combinedText = allTranscripts.join('\n\n\n');
    const blob = new Blob([combinedText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const playlistName = playlistTitle.textContent.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${playlistName}_transcripts_${rangeVideos[0].number}_to_${rangeVideos[rangeVideos.length - 1].number}.txt`;

    chrome.downloads.download({ url, filename, saveAs: true }, () => {
      URL.revokeObjectURL(url);
    });

    const failMsg = failCount > 0 ? ` (${failCount} unavailable)` : '';
    showToast(`Download started! ${successCount} transcript${successCount !== 1 ? 's' : ''}${failMsg}`);
  });

  // Clear
  clearBtn.addEventListener('click', () => {
    hideAll();
    urlInput.value = '';
    clearError();
    urlInput.focus();
  });

  // Modal handlers
  function openTranscriptModal(title, videoId, preferredLang = null) {
    transcriptModalTitle.textContent = title;
    transcriptContent.innerHTML = '<div class="transcript-loading"><div class="spinner-large"></div><p>Fetching transcript...</p></div>';
    transcriptModal.classList.remove('hidden');
    currentTranscriptText = '';
    activeVideoIdForModal = videoId;

    fetchTranscript(videoId, preferredLang).then(({ segments, tracks, selectedLang }) => {
      const text = segments.map(s => `[${s.time}] ${s.text}`).join('\n');
      currentTranscriptText = text;
      transcriptContent.innerHTML = `<pre style="white-space: pre-wrap; font-family: var(--font-mono); font-size: 12px;">${escapeHtml(text)}</pre>`;

      // Populate language selector
      availableTracksForModal = tracks || [];
      transcriptLangSelect.innerHTML = '';
      if (availableTracksForModal.length > 0) {
        for (const tr of availableTracksForModal) {
          const opt = document.createElement('option');
          opt.value = tr.code;
          opt.textContent = tr.isAuto ? `${tr.name} (Auto)` : tr.name;
          if (tr.code === selectedLang) opt.selected = true;
          transcriptLangSelect.appendChild(opt);
        }
        transcriptLangSelect.classList.remove('hidden');
      } else {
        transcriptLangSelect.classList.add('hidden');
      }
    }).catch(err => {
      currentTranscriptText = '';
      transcriptContent.innerHTML = `<div style="color: #ef4444; padding: 20px;">[Transcript unavailable: ${escapeHtml(err.message)}]</div>`;
    });
  }

  function closeTranscriptModal() {
    transcriptModal.classList.add('hidden');
    currentTranscriptText = '';
    activeVideoIdForModal = null;
  }

  transcriptCloseBtn.addEventListener('click', closeTranscriptModal);
  if (transcriptBackdrop) transcriptBackdrop.addEventListener('click', closeTranscriptModal);

  transcriptLangSelect.addEventListener('change', () => {
    const newLang = transcriptLangSelect.value;
    if (activeVideoIdForModal) {
      openTranscriptModal(transcriptModalTitle.textContent, activeVideoIdForModal, newLang);
    }
  });

  transcriptCopyBtn.addEventListener('click', async () => {
    if (!currentTranscriptText) return showToast('No transcript to copy');
    if (await copyToClipboard(currentTranscriptText)) {
      transcriptCopyBtn.classList.add('copied');
      transcriptCopyBtn.querySelector('span').textContent = 'Copied!';
      showToast('Transcript copied to clipboard');
      setTimeout(() => {
        transcriptCopyBtn.classList.remove('copied');
        transcriptCopyBtn.querySelector('span').textContent = 'Copy';
      }, 1800);
    }
  });

  transcriptDownloadBtn.addEventListener('click', () => {
    if (!currentTranscriptText) return showToast('No transcript to download');
    const blob = new Blob([currentTranscriptText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    let title = transcriptModalTitle.textContent.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    chrome.downloads.download({ url, filename: `${title}.txt`, saveAs: true }, () => URL.revokeObjectURL(url));
  });

  videoList.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.video-item__copy');
    if (copyBtn) {
      const url = copyBtn.dataset.url;
      const ok = await copyToClipboard(url);
      if (ok) {
        copyBtn.classList.add('copied');
        setTimeout(() => copyBtn.classList.remove('copied'), 1500);
        showToast('Link copied');
      }
      return;
    }
    
    const transBtn = e.target.closest('.video-item__transcript-copy');
    if (transBtn) {
      openTranscriptModal(transBtn.dataset.videoTitle, transBtn.dataset.videoId);
    }
  });
})();
