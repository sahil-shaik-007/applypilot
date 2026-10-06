// Generates the PWA icons from build/icon.png with no native deps (pure zlib PNG decode/encode).
//   public/icons/icon-512.png           512x512 (copy)
//   public/icons/icon-192.png           192x192 (area-averaged downscale)
//   public/icons/apple-touch-icon.png   180x180
//   public/icons/icon-maskable-512.png  512x512, icon at 80% on the app background (maskable safe zone)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../../../build/icon.png');
const OUT = path.resolve(here, '../public/icons');

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG');
  let off = 8; let w = 0; let h = 0; let ct = 0; let bd = 0; let interlace = 0; let palette = null; let trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bd !== 8 || interlace) throw new Error(`Unsupported PNG (bit depth ${bd}, interlace ${interlace})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r; let g; let bl; let al = 255;
    if (ct === 6) { r = px[i * 4]; g = px[i * 4 + 1]; bl = px[i * 4 + 2]; al = px[i * 4 + 3]; }
    else if (ct === 2) { r = px[i * 3]; g = px[i * 3 + 1]; bl = px[i * 3 + 2]; }
    else if (ct === 0) { r = g = bl = px[i]; }
    else if (ct === 4) { r = g = bl = px[i * 2]; al = px[i * 2 + 1]; }
    else { const k = px[i]; r = palette[k * 3]; g = palette[k * 3 + 1]; bl = palette[k * 3 + 2]; al = trns && k < trns.length ? trns[k] : 255; }
    rgba.set([r, g, bl, al], i * 4);
  }
  return { w, h, rgba };
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng({ w, h, rgba }) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Area-averaging resize with premultiplied alpha (no dark fringes).
function resize(img, W, H) {
  const out = Buffer.alloc(W * H * 4);
  const sx = img.w / W; const sy = img.h / H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x0 = x * sx; const x1 = x0 + sx; const y0 = y * sy; const y1 = y0 + sy;
      let r = 0; let g = 0; let b = 0; let a = 0; let wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          const k = wx * wy; const i = (yy * img.w + xx) * 4; const al = img.rgba[i + 3] / 255;
          r += img.rgba[i] * al * k; g += img.rgba[i + 1] * al * k; b += img.rgba[i + 2] * al * k; a += al * k; wsum += k;
        }
      }
      const o = (y * W + x) * 4;
      out[o + 3] = Math.round((a / wsum) * 255);
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
    }
  }
  return { w: W, h: H, rgba: out };
}

function onBackground(img, size, scale, bg = [10, 10, 10]) {
  const inner = resize(img, Math.round(size * scale), Math.round(size * scale));
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) out.set([...bg, 255], i * 4);
  const off = Math.floor((size - inner.w) / 2);
  for (let y = 0; y < inner.h; y++) {
    for (let x = 0; x < inner.w; x++) {
      const s = (y * inner.w + x) * 4; const d = ((y + off) * size + x + off) * 4; const a = inner.rgba[s + 3] / 255;
      for (let c = 0; c < 3; c++) out[d + c] = Math.round(inner.rgba[s + c] * a + out[d + c] * (1 - a));
    }
  }
  return { w: size, h: size, rgba: out };
}

const src = decodePng(fs.readFileSync(SRC));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon-512.png'), encodePng(src.w === 512 ? src : resize(src, 512, 512)));
fs.writeFileSync(path.join(OUT, 'icon-192.png'), encodePng(resize(src, 192, 192)));
fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), encodePng(onBackground(src, 180, 1)));
fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), encodePng(onBackground(src, 512, 0.8)));
console.log(`icons written to ${path.relative(process.cwd(), OUT)} (from ${src.w}x${src.h})`);
