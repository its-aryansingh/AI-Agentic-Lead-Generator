import crypto from 'node:crypto'

const VERSION = 'v1'
function key(secret: string) {
  if (secret.length < 24) throw new Error('Credential encryption secret must be at least 24 characters.')
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('salesengai-credentials'), Buffer.from('aes-256-gcm'), 32))
}
export function credentialSecret() {
  const secret = process.env.CONNECTION_ENCRYPTION_KEY ?? process.env.MAILBOX_STATE_SECRET
  if (!secret) throw new Error('CONNECTION_ENCRYPTION_KEY is not configured.')
  return secret
}
export function encryptCredential(plaintext: string, secret = credentialSecret()) {
  if (!plaintext) throw new Error('Credential is empty.')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION,iv.toString('base64url'),tag.toString('base64url'),ciphertext.toString('base64url')].join('.')
}
export function decryptCredential(payload: string, secret = credentialSecret()) {
  const [version,iv,tag,ciphertext] = payload.split('.')
  if (version!==VERSION||!iv||!tag||!ciphertext) throw new Error('Unsupported encrypted credential.')
  const decipher=crypto.createDecipheriv('aes-256-gcm',key(secret),Buffer.from(iv,'base64url'))
  decipher.setAuthTag(Buffer.from(tag,'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64url')),decipher.final()]).toString('utf8')
}
