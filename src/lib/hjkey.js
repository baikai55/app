'use strict';

/**
 * 海角 AES key 二次变换（等价于 jquery_key wasm）：
 *   derived[i] = rawKey[i] XOR seed[i % seed_len]
 * seed 是 m3u8 同路径 companion .jpg 文本（base64 编码）解码后的字节。
 */

/** base64 文本 → bytes（去空白补 padding） */
function decodeSeedText(text) {
  const bin = atob(String(text || '').trim().replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * 用 companion .jpg 种子字节对 16 字节原始 AES key 做 XOR 变换。
 * 返回 16 字节 derived key；参数无效返回 null。
 */
function deriveKey(rawKey, seedBytes) {
  if (!rawKey || rawKey.length !== 16 || !seedBytes || !seedBytes.length) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = rawKey[i] ^ seedBytes[i % seedBytes.length];
  }
  return out;
}

export { deriveKey, decodeSeedText };
