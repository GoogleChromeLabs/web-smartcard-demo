import * as crypto from 'crypto';
import * as x509 from '@peculiar/x509';

/**
 * Generates a valid, self-signed RSA-2048 X.509 certificate.
 * Returns the raw DER bytes as a Hex string.
 */
export async function generateSelfSignedCertHex() {
  x509.cryptoProvider.set(crypto.webcrypto);
  
  const keys = await crypto.webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 },
    true, ["sign", "verify"]
  );

  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: "CN=Dynamic Test Card",
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 86400000 * 365), // 1 year
    signingAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    keys: keys,
  });

  return Buffer.from(cert.rawData).toString('hex');
}

/**
 * Wraps valueBytes in a BER-TLV structure with the given tag.
 * Handles short and long form length encoding automatically.
 */
export function constructBerTlv(tag, valueBytes) {
    const len = valueBytes.length;
    let lengthBytes;

    if (len < 128) {
        lengthBytes = Buffer.from([len]);
    } else if (len < 256) {
        lengthBytes = Buffer.from([0x81, len]);
    } else {
        lengthBytes = Buffer.from([0x82, (len >> 8) & 0xFF, len & 0xFF]);
    }

    return Buffer.concat([
        Buffer.from([tag]),
        lengthBytes,
        valueBytes
    ]);
}
