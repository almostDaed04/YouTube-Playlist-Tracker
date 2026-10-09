/**
 * YouTube Playlist Link Extractor — Frontend Logic
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
  const loadingOverlay = document.getElementById('loading-overlay');
  const emptyState     = document.getElementById('empty-state');
  const emptyStateText = document.getElementById('empty-state-text');

  // ── State ─────────────────────────────────────────────────────────────────
  let currentVideos = [];

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Simple YouTube playlist URL validation */
  function isValidPlaylistUrl(url) {
    try {
      const u = new URL(url);
      const isYouTube = /^(www\.)?youtube\.com$/i.test(u.hostname);
      const hasList = u.searchParams.has('list');
      return isYouTube && hasList;
    } catch {
      return false;
    }
  }

  /** Show an inline error below the input */
  function showError(message) {
    inputError.textContent = message;
  }

  /** Clear the inline error */
  function clearError() {
    inputError.textContent = '';
  }

  /** Toggle the loading overlay */
  function setLoading(on) {
    loadingOverlay.classList.toggle('hidden', !on);
    extractBtn.classList.toggle('loading', on);
    extractBtn.disabled = on;
    urlInput.disabled = on;
  }

  /** Show a brief toast notification */
  function showToast(message) {
    // Remove existing toasts
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    // Trigger reflow then show
    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  /** Copy text to clipboard */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function renderResults(data) {
    currentVideos = data.videos;

    // Header info
    playlistTitle.textContent = data.playlist_title || 'Playlist';
    videoCount.textContent = `${data.count} video${data.count !== 1 ? 's' : ''} found`;

    // Build video list
    videoList.innerHTML = '';
    data.videos.forEach((video, i) => {
      const li = document.createElement('li');
      li.className = 'video-item';
      li.style.animationDelay = `${Math.min(i * 0.03, 0.8)}s`;

      li.innerHTML = `
        <span class="video-item__number">${video.number}</span>
        <div class="video-item__info">
          <div class="video-item__title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
          <a class="video-item__url" href="${escapeHtml(video.url)}" target="_blank" rel="noopener">${escapeHtml(video.url)}</a>
        </div>
        <button class="video-item__copy" title="Copy link" data-url="${escapeHtml(video.url)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      `;

      videoList.appendChild(li);
    });

    // Show results, hide empty state
    resultsSection.classList.remove('hidden');
    emptyState.classList.add('hidden');
  }

  function showEmpty(message) {
    resultsSection.classList.add('hidden');
    emptyState.classList.remove('hidden');
    emptyStateText.textContent = message || 'The playlist is empty or all videos are unavailable.';
  }

  function hideAll() {
    resultsSection.classList.add('hidden');
    emptyState.classList.add('hidden');
    currentVideos = [];
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Core: Extract Playlist ────────────────────────────────────────────────

  async function extractPlaylist() {
    clearError();
    const url = urlInput.value.trim();

    if (!url) {
      showError('Please paste a YouTube playlist URL.');
      urlInput.focus();
      return;
    }

    if (!isValidPlaylistUrl(url)) {
      showError('Invalid URL. Please use a YouTube playlist URL containing "list=" parameter.');
      urlInput.focus();
      return;
    }

    setLoading(true);
    hideAll();

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok) {
        showError(data.error || 'An unexpected error occurred.');
        return;
      }

      if (data.count === 0) {
        showEmpty(data.message);
        return;
      }

      renderResults(data);
    } catch (err) {
      showError('Network error. Make sure the backend server is running.');
      console.error('Extraction failed:', err);
    } finally {
      setLoading(false);
    }
  }

  // ── Event Listeners ───────────────────────────────────────────────────────

  extractBtn.addEventListener('click', extractPlaylist);

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      extractPlaylist();
    }
  });

  // Clear error on input change
  urlInput.addEventListener('input', clearError);

  // Copy All Links
  copyBtn.addEventListener('click', async () => {
    if (!currentVideos.length) return;
    const text = currentVideos.map(v => v.url).join('\n');
    const ok = await copyToClipboard(text);
    if (ok) {
      copyBtn.classList.add('copied');
      copyBtn.querySelector('span').textContent = 'Copied!';
      showToast(`${currentVideos.length} link${currentVideos.length !== 1 ? 's' : ''} copied to clipboard`);
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.querySelector('span').textContent = 'Copy All';
      }, 2000);
    }
  });

  // Download as TXT
  downloadBtn.addEventListener('click', () => {
    if (!currentVideos.length) return;
    const lines = currentVideos.map(v => `${v.number}. ${v.title}\n   ${v.url}`);
    const content = lines.join('\n\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'playlist_links.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Download started');
  });

  // Clear
  clearBtn.addEventListener('click', () => {
    hideAll();
    urlInput.value = '';
    clearError();
    urlInput.focus();
  });

  // Individual video copy
  videoList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.video-item__copy');
    if (!btn) return;
    const url = btn.dataset.url;
    const ok = await copyToClipboard(url);
    if (ok) {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1500);
      showToast('Link copied');
    }
  });
})();
