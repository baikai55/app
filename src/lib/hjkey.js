'use strict';

import { WASM_B64 } from './hjkey-wasm.js';

let wasmPromise = null;

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function loadWasm() {
  if (wasmPromise) return wasmPromise;
  wasmPromise = (async () => {
    const imports = {
      env: {
        _abort_js() {
          throw new Error('视频密钥模块异常');
        },
        emscripten_resize_heap() {
          return 0;
        },
      },
      wasi_snapshot_preview1: {
        fd_close() {
          return 0;
        },
        fd_write() {
          return 0;
        },
        fd_seek() {
          return 0;
        },
      },
    };
    const bytes = base64ToBytes(WASM_B64);
    const { instance } = await WebAssembly.instantiate(bytes, imports);
    const ex = instance.exports;
    if (!ex.memory || !ex.malloc || !ex.free || !ex.jquery_key) {
      throw new Error('视频密钥模块不完整');
    }
    if (ex.emscripten_stack_init) ex.emscripten_stack_init();
    if (ex.__wasm_call_ctors) ex.__wasm_call_ctors();
    return ex;
  })().catch((error) => {
    wasmPromise = null;
    throw error;
  });
  return wasmPromise;
}

/** base64 文本 → bytes（去空白补 padding） */
function decodeSeedText(text) {
  const bin = atob(String(text || '').trim().replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * 用 companion .jpg 种子（base64 文本）对原始 AES key 做 jquery_key 变换。
 * 返回 16 字节 derived key，解密失败返回 null。
 */
async function deriveKey(rawKey, seedBytes) {
  if (!rawKey || rawKey.length !== 16 || !seedBytes || !seedBytes.length) return null;
  try {
    const ex = await loadWasm();
    const keyPointer = ex.malloc(rawKey.length);
    const seedPointer = ex.malloc(seedBytes.length);
    if (!keyPointer || !seedPointer) throw new Error('视频密钥内存分配失败');
    try {
      const heap = new Uint8Array(ex.memory.buffer);
      heap.set(rawKey, keyPointer);
      heap.set(seedBytes, seedPointer);
      ex.jquery_key(keyPointer, rawKey.length, seedPointer, seedBytes.length);
      return new Uint8Array(ex.memory.buffer, keyPointer, rawKey.length).slice();
    } finally {
      ex.free(keyPointer);
      ex.free(seedPointer);
    }
  } catch {
    return null;
  }
}

export { deriveKey, decodeSeedText, base64ToBytes };
