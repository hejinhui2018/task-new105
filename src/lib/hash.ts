// 轻量非加密哈希（FNV-1a / 32 位）。验收台只需要稳定、可复现、
// 可肉眼比对的指纹，不依赖浏览器 crypto 的异步 API。

export function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 文件指纹：版本号 + 全部页标签的规范化串联 */
export function docFingerprint(version: number, pages: string[]): string {
  const canonical = `DOC|v${version}|${pages.map((p) => `P:${p}`).join('|')}`;
  return '0x' + fnv1a32(canonical);
}

/** 单个决定的哈希：把动作、角色、时刻、指纹与前序哈希全部压进去 */
export function decisionHash(input: {
  action: string;
  actor: string;
  at: number;
  fingerprint: string;
  prevHash: string;
  result: string;
  reasonCode: string;
  detail: string;
}): string {
  const canonical = [
    'DEC',
    input.action,
    input.actor,
    input.at,
    input.fingerprint,
    input.prevHash,
    input.result,
    input.reasonCode,
    input.detail,
  ].join('|');
  return '0x' + fnv1a32(canonical);
}

export function genesisHash(fingerprint: string, order: string[]): string {
  return '0x' + fnv1a32(`GENESIS|${fingerprint}|${order.join('>')}`);
}

export function short(hash: string | null | undefined): string {
  if (!hash) return '—';
  return hash.length > 9 ? hash.slice(0, 9) + '…' : hash;
}
