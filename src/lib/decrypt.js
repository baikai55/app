'use strict';

const KEY_B64 = btoa('f5d965df75336270'); // "f5d965df75336270"
const IV_B64 = btoa('97b60394abc2fbe1'); // "97b60394abc2fbe1"

let keyPromise = null;
function aesKey() {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('f5d965df75336270'),
      { name: 'AES-CBC' },
      false,
      ['decrypt'],
    );
  }
  return keyPromise;
}

async function decryptImageBytes(bytes) {
  const key = await aesKey();
  const iv = new TextEncoder().encode('97b60394abc2fbe1');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, bytes);
    return new Uint8Array(plain);
  } catch {
    // fall through: not encrypted or wrong key
    return bytes;
  }
}

export { decryptImageBytes };
