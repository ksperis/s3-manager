/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
function decode(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return bytes.buffer;
}

function encode(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type JsonCredentialOptions = Record<string, unknown> & {
  challenge: string;
  user?: { id: string };
  allowCredentials?: Array<Record<string, unknown> & { id: string }>;
  excludeCredentials?: Array<Record<string, unknown> & { id: string }>;
};

export async function createPasskey(options: JsonCredentialOptions): Promise<Record<string, unknown>> {
  const publicKey = {
    ...options,
    challenge: decode(options.challenge),
    user: options.user ? { ...options.user, id: decode(options.user.id) } : undefined,
    excludeCredentials: options.excludeCredentials?.map((entry) => ({ ...entry, id: decode(entry.id) })),
  } as PublicKeyCredentialCreationOptions;
  const credential = await navigator.credentials.create({ publicKey });
  if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAttestationResponse)) {
    throw new Error("Passkey registration was cancelled");
  }
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      attestationObject: encode(credential.response.attestationObject),
      clientDataJSON: encode(credential.response.clientDataJSON),
      transports: credential.response.getTransports?.() ?? [],
    },
  };
}

export async function authenticatePasskey(options: JsonCredentialOptions): Promise<Record<string, unknown>> {
  const publicKey = {
    ...options,
    challenge: decode(options.challenge),
    allowCredentials: options.allowCredentials?.map((entry) => ({ ...entry, id: decode(entry.id) })),
  } as PublicKeyCredentialRequestOptions;
  const credential = await navigator.credentials.get({ publicKey });
  if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAssertionResponse)) {
    throw new Error("Passkey authentication was cancelled");
  }
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      authenticatorData: encode(credential.response.authenticatorData),
      clientDataJSON: encode(credential.response.clientDataJSON),
      signature: encode(credential.response.signature),
      userHandle: credential.response.userHandle ? encode(credential.response.userHandle) : null,
    },
  };
}
