"""
YouTube Playlist Link Extractor — Backend API

Uses yt-dlp to extract video metadata from a YouTube playlist
without downloading any video content.
"""

import re
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import yt_dlp
import os

app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), '..', 'frontend'))
CORS(app)

# ── Regex to validate YouTube playlist URLs ──────────────────────────────────
PLAYLIST_PATTERN = re.compile(
    r'(https?://)?(www\.)?(youtube\.com|youtu\.be)/.*(list=)(PL[\w-]+|UU[\w-]+|OL[\w-]+|LL[\w-]+|FL[\w-]+|WL|HL|[\w-]{10,})',
    re.IGNORECASE,
)


def extract_playlist_id(url: str) -> str | None:
    """Return the playlist ID from a YouTube URL, or None if invalid."""
    match = re.search(r'[?&]list=([^&]+)', url)
    return match.group(1) if match else None


@app.route('/')
def serve_frontend():
    """Serve the frontend index.html."""
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def serve_static(path):
    """Serve static frontend assets."""
    return send_from_directory(app.static_folder, path)


@app.route('/api/extract', methods=['POST'])
def extract_playlist():
    """
    Accept a YouTube playlist URL, extract all video URLs and titles
    using yt-dlp (flat extraction — no downloads), and return them as JSON.
    """
    data = request.get_json(silent=True) or {}
    url = data.get('url', '').strip()

    if not url:
        return jsonify({'error': 'No URL provided.'}), 400

    playlist_id = extract_playlist_id(url)
    if not playlist_id:
        return jsonify({'error': 'Invalid YouTube playlist URL. Make sure the URL contains a "list=" parameter.'}), 400

    # Normalise to a clean playlist URL so yt-dlp always treats it as a playlist
    clean_url = f'https://www.youtube.com/playlist?list={playlist_id}'

    # yt-dlp options: flat extraction only — never download any media
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': True,       # Only extract metadata, no actual downloads
        'skip_download': True,       # Extra safety: never download
        'ignoreerrors': True,        # Skip unavailable / private videos
        'no_color': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(clean_url, download=False)

        if info is None:
            return jsonify({'error': 'Could not retrieve playlist information. The playlist may be private or unavailable.'}), 404

        entries = info.get('entries') or []
        playlist_title = info.get('title', 'Unknown Playlist')

        videos = []
        for idx, entry in enumerate(entries, start=1):
            if entry is None:
                continue
            video_id = entry.get('id') or entry.get('url', '')
            title = entry.get('title') or f'Video {idx}'
            video_url = f'https://www.youtube.com/watch?v={video_id}' if video_id else None
            if video_url:
                videos.append({
                    'number': idx,
                    'title': title,
                    'url': video_url,
                })

        if not videos:
            return jsonify({
                'playlist_title': playlist_title,
                'count': 0,
                'videos': [],
                'message': 'The playlist is empty or all videos are unavailable.',
            })

        return jsonify({
            'playlist_title': playlist_title,
            'count': len(videos),
            'videos': videos,
        })

    except yt_dlp.utils.DownloadError as e:
        return jsonify({'error': f'yt-dlp error: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'An unexpected error occurred: {str(e)}'}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)
