import { readFileSync, readdirSync, writeFileSync } from "node:fs";

// A deterministic, uncompressed ZIP: no extra build dependency or shell utility.
const source = new URL("../examples/ezgraph-starter/", import.meta.url);
const files = readdirSync(source).filter((name) => /\.(ts|json|md)$/.test(name)).sort();
const local = [];
const central = [];
let offset = 0;
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
for (const file of files) {
  const name = Buffer.from(`ezgraph-starter/${file}`);
  const data = readFileSync(new URL(file, source));
  const crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x5d49, 12); // 2026-10-09, midnight (DOS date).
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(0x5d49, 14);
  directory.writeUInt32LE(crc, 16);
  directory.writeUInt32LE(data.length, 20);
  directory.writeUInt32LE(data.length, 24);
  directory.writeUInt16LE(name.length, 28);
  directory.writeUInt32LE(offset, 42);
  local.push(header, name, data);
  central.push(directory, name);
  offset += header.length + name.length + data.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(new URL("../src/assets/ezgraph/ezgraph-starter.zip", import.meta.url), Buffer.concat([...local, directory, end]));
console.log(`Packaged EZGraph starter (${files.length} files).`);
