#!/usr/bin/env python3
"""Generate PNG icons for the browser extension."""

import struct
import zlib
import os

def create_icon(size, output_path):
    """Create a simple YouTube-themed icon as a PNG."""
    pixels = []
    center_x = size / 2
    center_y = size / 2
    
    # Background radius
    bg_radius = size * 0.42
    
    # Play button rectangle (YouTube logo style)
    rect_w = size * 0.52
    rect_h = size * 0.38
    rect_x1 = center_x - rect_w / 2
    rect_y1 = center_y - rect_h / 2
    rect_x2 = center_x + rect_w / 2
    rect_y2 = center_y + rect_h / 2
    rect_r = size * 0.08  # corner radius
    
    # Play triangle
    tri_x1 = center_x - size * 0.08
    tri_y1 = center_y - size * 0.12
    tri_x2 = center_x + size * 0.14
    tri_y2 = center_y
    tri_x3 = center_x - size * 0.08
    tri_y3 = center_y + size * 0.12
    
    for y in range(size):
        row = []
        for x in range(size):
            # Distance from center
            dx = x - center_x
            dy = y - center_y
            dist = (dx * dx + dy * dy) ** 0.5
            
            # Background circle (dark)
            if dist <= bg_radius:
                # Check if inside the red rounded rectangle
                in_rect = False
                # Simple rounded rect check
                if rect_x1 + rect_r <= x <= rect_x2 - rect_r and rect_y1 <= y <= rect_y2:
                    in_rect = True
                elif rect_x1 <= x <= rect_x2 and rect_y1 + rect_r <= y <= rect_y2 - rect_r:
                    in_rect = True
                else:
                    # Check corners
                    corners = [
                        (rect_x1 + rect_r, rect_y1 + rect_r),
                        (rect_x2 - rect_r, rect_y1 + rect_r),
                        (rect_x1 + rect_r, rect_y2 - rect_r),
                        (rect_x2 - rect_r, rect_y2 - rect_r),
                    ]
                    for cx_c, cy_c in corners:
                        cdx = x - cx_c
                        cdy = y - cy_c
                        if cdx * cdx + cdy * cdy <= rect_r * rect_r:
                            in_rect = True
                            break
                
                if in_rect:
                    # Check if inside the white play triangle
                    # Using barycentric coordinates
                    def sign(p1x, p1y, p2x, p2y, p3x, p3y):
                        return (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y)
                    
                    d1 = sign(x, y, tri_x1, tri_y1, tri_x2, tri_y2)
                    d2 = sign(x, y, tri_x2, tri_y2, tri_x3, tri_y3)
                    d3 = sign(x, y, tri_x3, tri_y3, tri_x1, tri_y1)
                    
                    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
                    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
                    
                    if not (has_neg and has_pos):
                        # Inside triangle — white
                        row.extend([255, 255, 255, 255])
                    else:
                        # Red rectangle
                        row.extend([255, 68, 68, 255])
                else:
                    # Dark background circle
                    row.extend([21, 24, 32, 255])
            else:
                # Transparent
                row.extend([0, 0, 0, 0])
        
        pixels.append(bytes(row))
    
    # Write PNG
    write_png(output_path, size, size, pixels)


def write_png(path, width, height, rows):
    """Write a minimal PNG file."""
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = zlib.crc32(c) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + c + struct.pack('>I', crc)
    
    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    
    # IDAT
    raw_data = b''
    for row in rows:
        raw_data += b'\x00' + row  # filter byte 0 (None) per row
    
    compressed = zlib.compress(raw_data, 9)
    
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', ihdr_data))
        f.write(chunk(b'IDAT', compressed))
        f.write(chunk(b'IEND', b''))


if __name__ == '__main__':
    icons_dir = os.path.join(os.path.dirname(__file__), 'icons')
    os.makedirs(icons_dir, exist_ok=True)
    
    for size in [16, 48, 128]:
        path = os.path.join(icons_dir, f'icon{size}.png')
        create_icon(size, path)
        print(f'Created {path}')
