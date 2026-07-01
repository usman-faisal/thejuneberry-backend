import Medusa from '@medusajs/js-sdk';

declare const __BACKEND_URL__: string | undefined;
declare const __AUTH_TYPE__: 'session' | 'jwt' | undefined;
declare const __JWT_TOKEN_STORAGE_KEY__: string | undefined;

const backendUrl =
  typeof __BACKEND_URL__ !== 'undefined' ? __BACKEND_URL__ : '/';
const authType = typeof __AUTH_TYPE__ !== 'undefined' ? __AUTH_TYPE__ : 'session';
const jwtTokenStorageKey =
  typeof __JWT_TOKEN_STORAGE_KEY__ !== 'undefined'
    ? __JWT_TOKEN_STORAGE_KEY__
    : undefined;

export const sdk = new Medusa({
  baseUrl: backendUrl,
  auth: {
    type: authType,
    jwtTokenStorageKey,
  },
});
