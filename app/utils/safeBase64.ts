export function decodeBase64(input: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const bin = atob(input)
    const buf = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
    return buf
  }
  // Node fallback
  return Uint8Array.from(Buffer.from(input, 'base64'))
}
