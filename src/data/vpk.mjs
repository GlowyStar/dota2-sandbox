// Read-only Valve VPK (v1/v2) directory reader. Opens files with shared read access only;
// never writes to, locks or modifies the game install.
import fs from 'node:fs';
import path from 'node:path';

export class Vpk {
  constructor(dirFile) {
    this.dirFile = dirFile;
    this.base = dirFile.replace(/_dir\.vpk$/i, '');
    const buf = fs.readFileSync(dirFile);
    if (buf.readUInt32LE(0) !== 0x55aa1234) throw new Error(`not a VPK directory file: ${dirFile}`);
    this.version = buf.readUInt32LE(4);
    const treeSize = buf.readUInt32LE(8);
    const headerSize = this.version === 2 ? 28 : 12;
    this.dataOffset = headerSize + treeSize;
    this.entries = new Map();
    let p = headerSize;
    const str = () => {
      const e = buf.indexOf(0, p);
      const s = buf.toString('utf8', p, e);
      p = e + 1;
      return s;
    };
    for (;;) {
      const ext = str();
      if (ext === '') break;
      for (;;) {
        const dir = str();
        if (dir === '') break;
        for (;;) {
          const name = str();
          if (name === '') break;
          const preloadBytes = buf.readUInt16LE(p + 4);
          const archiveIndex = buf.readUInt16LE(p + 6);
          const offset = buf.readUInt32LE(p + 8);
          const length = buf.readUInt32LE(p + 12);
          p += 18;
          const preloadAt = p;
          p += preloadBytes;
          const full = (dir === ' ' ? '' : dir + '/') + name + (ext === ' ' ? '' : '.' + ext);
          this.entries.set(full, { archiveIndex, offset, length, preloadAt, preloadBytes });
        }
      }
    }
    this._dir = buf;
  }

  has(file) { return this.entries.has(file); }

  list(prefix = '', suffix = '') {
    const out = [];
    for (const k of this.entries.keys()) if (k.startsWith(prefix) && k.endsWith(suffix)) out.push(k);
    return out.sort();
  }

  read(file) {
    const e = this.entries.get(file);
    if (!e) throw new Error(`not in VPK: ${file}`);
    const out = Buffer.allocUnsafe(e.preloadBytes + e.length);
    if (e.preloadBytes) this._dir.copy(out, 0, e.preloadAt, e.preloadAt + e.preloadBytes);
    if (e.length) {
      if (e.archiveIndex === 0x7fff) {
        this._dir.copy(out, e.preloadBytes, this.dataOffset + e.offset, this.dataOffset + e.offset + e.length);
      } else {
        const arc = `${this.base}_${String(e.archiveIndex).padStart(3, '0')}.vpk`;
        const fd = fs.openSync(arc, 'r');
        try { fs.readSync(fd, out, e.preloadBytes, e.length, e.offset); } finally { fs.closeSync(fd); }
      }
    }
    return out;
  }
}

// A plain folder with the same relative layout (extracted game files) behaves like a VPK.
export class FolderSource {
  constructor(root) { this.root = root; }
  has(file) { return fs.existsSync(path.join(this.root, file)); }
  list(prefix = '', suffix = '') {
    const dir = path.join(this.root, prefix);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(suffix)).map((f) => prefix + f).sort();
  }
  read(file) { return fs.readFileSync(path.join(this.root, file)); }
}
