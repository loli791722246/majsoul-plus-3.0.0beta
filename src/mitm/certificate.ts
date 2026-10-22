import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as tls from 'tls'
import * as forge from 'node-forge'

/**
 * 本地中间人 CA。
 *
 * 参考 MajsoulMax 使用的 mitmproxy：由本地生成一张根证书，随后按访问的域名
 * 动态签发叶子证书，从而可以解密 HTTPS / WSS 流量并修改其中的 protobuf 消息。
 */
export class CertificateAuthority {
  private caCert: forge.pki.Certificate
  private caKey: forge.pki.rsa.PrivateKey
  private leafKeys: forge.pki.rsa.KeyPair
  private contextCache: Map<string, tls.SecureContext> = new Map()
  private certificateCache: Map<string, { key: string; cert: string }> = new Map()

  constructor(private readonly storeDir: string) {}

  /**
   * 载入或生成根证书。首次调用会生成 2048 位 RSA 密钥，耗时约数百毫秒。
   */
  init() {
    const certPath = path.join(this.storeDir, 'majsoul-plus-ca.crt')
    const keyPath = path.join(this.storeDir, 'majsoul-plus-ca.key')
    const leafPath = path.join(this.storeDir, 'majsoul-plus-leaf.key')

    fs.mkdirSync(this.storeDir, { recursive: true })

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      this.caCert = forge.pki.certificateFromPem(
        fs.readFileSync(certPath, 'utf-8')
      )
      this.caKey = forge.pki.privateKeyFromPem(
        fs.readFileSync(keyPath, 'utf-8')
      )
    } else {
      const keys = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' }
      })
      const cert = forge.pki.createCertificate()
      cert.publicKey = forge.pki.publicKeyFromPem(keys.publicKey)
      cert.serialNumber = randomSerial()
      cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000)
      cert.validity.notAfter = new Date(
        Date.now() + 10 * 365 * 24 * 3600 * 1000
      )
      const attrs = [
        { name: 'commonName', value: 'Majsoul Plus MITM CA' },
        { name: 'organizationName', value: 'Majsoul Plus' }
      ]
      cert.setSubject(attrs)
      cert.setIssuer(attrs)
      cert.setExtensions([
        { name: 'basicConstraints', cA: true, critical: true },
        {
          name: 'keyUsage',
          keyCertSign: true,
          cRLSign: true,
          digitalSignature: true,
          critical: true
        },
        { name: 'subjectKeyIdentifier' }
      ])
      cert.sign(forge.pki.privateKeyFromPem(keys.privateKey), forge.md.sha256.create())

      fs.writeFileSync(certPath, forge.pki.certificateToPem(cert))
      fs.writeFileSync(keyPath, keys.privateKey)
      this.caCert = cert
      this.caKey = forge.pki.privateKeyFromPem(keys.privateKey)
    }

    if (fs.existsSync(leafPath)) {
      const privateKey = forge.pki.privateKeyFromPem(
        fs.readFileSync(leafPath, 'utf-8')
      )
      this.leafKeys = {
        privateKey,
        publicKey: forge.pki.setRsaPublicKey(
          (privateKey as forge.pki.rsa.PrivateKey).n,
          (privateKey as forge.pki.rsa.PrivateKey).e
        )
      }
    } else {
      const keys = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' }
      })
      fs.writeFileSync(leafPath, keys.privateKey)
      this.leafKeys = {
        privateKey: forge.pki.privateKeyFromPem(keys.privateKey),
        publicKey: forge.pki.publicKeyFromPem(keys.publicKey)
      }
    }
  }

  get caCertificatePath() {
    return path.join(this.storeDir, 'majsoul-plus-ca.crt')
  }

  /**
   * 取得某个域名对应的服务端证书（PEM），结果会被缓存。
   */
  getHostCertificate(host: string): { key: string; cert: string } {
    const cached = this.certificateCache.get(host)
    if (cached) return cached

    const cert = forge.pki.createCertificate()
    cert.publicKey = this.leafKeys.publicKey
    cert.serialNumber = randomSerial()
    cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000)
    cert.validity.notAfter = new Date(
      Date.now() + 2 * 365 * 24 * 3600 * 1000
    )

    cert.setSubject([{ name: 'commonName', value: host }])
    cert.setIssuer(this.caCert.subject.attributes)
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      {
        name: 'keyUsage',
        digitalSignature: true,
        keyEncipherment: true,
        critical: true
      },
      { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: host },
          ...(isIp(host) ? [{ type: 7, ip: host }] : [])
        ]
      },
      { name: 'subjectKeyIdentifier' }
    ])
    cert.sign(this.caKey, forge.md.sha256.create())

    const result = {
      key: forge.pki.privateKeyToPem(this.leafKeys.privateKey),
      cert:
        forge.pki.certificateToPem(cert) +
        forge.pki.certificateToPem(this.caCert)
    }
    this.certificateCache.set(host, result)
    return result
  }

  /**
   * 取得某个域名对应的服务端证书上下文，结果会被缓存。
   */
  getSecureContext(host: string): tls.SecureContext {
    const cached = this.contextCache.get(host)
    if (cached) return cached

    const { key, cert } = this.getHostCertificate(host)
    const context = tls.createSecureContext({ key, cert })
    this.contextCache.set(host, context)
    return context
  }
}

function randomSerial(): string {
  return crypto.randomBytes(16).toString('hex')
}

function isIp(host: string): boolean {
  return /^[\d.:]+$/.test(host)
}
