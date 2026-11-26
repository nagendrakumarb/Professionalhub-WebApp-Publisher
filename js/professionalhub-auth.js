const googleCredentialKey = 'professionalhub.google.credential';
const googleNonceKey = 'professionalhub.google.nonce';
// Remembered sign-in. Google's ID token only lives ~1 hour and sessionStorage dies with the tab, so the
// verified identity (never the raw token) is kept in localStorage for a sliding window.
const sessionKey = 'professionalhub.session.v1';
const SESSION_DAYS = 30;
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;
let googleSigningKeysPromise;

function callbackUri() {
    const base = new URL(document.querySelector('base')?.getAttribute('href') || '/', window.location.origin);
    return new URL('auth/callback/google', base).toString();
}

function loadGoogleIdentity() {
    if (window.google?.accounts?.id) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-professionalhub-google]');
        if (existing) {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', () => reject(new Error('Google sign-in could not be loaded.')), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.dataset.professionalhubGoogle = 'true';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
        document.head.appendChild(script);
    });
}

async function signInWithGoogle(config) {
    if (!config?.clientId) throw new Error('Google sign-in is not set up for this site yet. Contact the site owner.');
    await loadGoogleIdentity();
    const fallbackHost = document.getElementById('google-signin-fallback');
    if (fallbackHost) { fallbackHost.hidden = true; fallbackHost.replaceChildren(); }
    const nonce = crypto.randomUUID();
    sessionStorage.setItem(googleNonceKey, nonce);
    return new Promise((resolve, reject) => {
        window.google.accounts.id.initialize({
            client_id: config.clientId,
            nonce,
            auto_select: false,
            cancel_on_tap_outside: false,
            callback: response => {
                if (!response?.credential) {
                    reject(new Error('Google did not return a sign-in credential.'));
                    return;
                }
                sessionStorage.setItem(googleCredentialKey, response.credential);
                window.location.assign(callbackUri());
                resolve();
            }
        });
        window.google.accounts.id.prompt(notification => {
            if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
                const host = fallbackHost;
                if (host) {
                    host.hidden = false;
                    host.replaceChildren();
                    window.google.accounts.id.renderButton(host, {
                        type: 'standard', theme: 'outline', size: 'large',
                        text: 'continue_with', shape: 'rectangular', width: 320
                    });
                }
                reject(new Error('Google did not show its quick sign-in prompt. Use the Google sign-in button displayed below.'));
            }
        });
    });
}

function readSession() {
    try {
        const raw = localStorage.getItem(sessionKey);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function writeSession(identity, clientId, previous) {
    const now = Date.now();
    const session = {
        identity,
        clientId,
        issuedAt: previous?.issuedAt ?? now,
        refreshedAt: now,
        expiresAt: now + SESSION_DAYS * 24 * 60 * 60 * 1000
    };
    try { localStorage.setItem(sessionKey, JSON.stringify(session)); } catch { /* storage full or blocked */ }
    return session;
}

function clearSession() {
    try { localStorage.removeItem(sessionKey); } catch { }
    sessionStorage.removeItem(googleCredentialKey);
    sessionStorage.removeItem(googleNonceKey);
}

async function requestPersistentStorage() {
    // Asks the browser not to evict IndexedDB (exams, attempts, certificates, resume history).
    try { await navigator.storage?.persist?.(); } catch { }
}

function decodeBase64Url(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function readGoogleIdentity(credential, expectedNonce, clientId) {
    const parts = credential.split('.');
    if (parts.length !== 3) throw new Error('Google returned an invalid sign-in credential.');
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    if (header.alg !== 'RS256' || !header.kid) throw new Error('Google returned an unsupported sign-in credential.');
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
        || claims.aud !== clientId || !claims.sub || Number(claims.exp) <= Date.now() / 1000
        || claims.nonce !== expectedNonce)
        throw new Error('Google sign-in could not be validated for this site.');

    googleSigningKeysPromise ??= fetch('https://www.googleapis.com/oauth2/v3/certs').then(response => {
        if (!response.ok) throw new Error('Google sign-in could not be validated right now.');
        return response.json();
    }).catch(error => { googleSigningKeysPromise = null; throw error; });
    const keys = await googleSigningKeysPromise;
    const jwk = keys.keys?.find(key => key.kid === header.kid && key.alg === 'RS256');
    if (!jwk) throw new Error('Google sign-in used an unknown signing key.');
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decodeBase64Url(parts[2]), signed);
    if (!valid) throw new Error('Google sign-in credential signature is invalid.');
    return {
        subject: claims.sub,
        name: claims.name || claims.given_name || '',
        email: claims.email || '',
        phone: claims.phone_number || '',
        address: typeof claims.address === 'string' ? claims.address : (claims.address?.formatted || ''),
        picture: claims.picture || '',
        provider: 'google'
    };
}

export async function signIn(provider, config) {
    if (provider !== 'google') throw new Error('Only Google sign-in is supported.');
    return signInWithGoogle(config.google);
}

export async function completeSignIn(provider, config) {
    if (provider !== 'google') throw new Error('Only Google sign-in is supported.');
    const credential = sessionStorage.getItem(googleCredentialKey);
    const nonce = sessionStorage.getItem(googleNonceKey);
    if (!credential || !nonce) throw new Error('Google sign-in could not be completed. Please try again.');
    const identity = await readGoogleIdentity(credential, nonce, config.google.clientId);
    writeSession(identity, config.google.clientId, null);
    // The one-time credential is no longer needed once the identity is verified and remembered.
    sessionStorage.removeItem(googleCredentialKey);
    sessionStorage.removeItem(googleNonceKey);
    await requestPersistentStorage();
    return identity;
}

export async function getUser(config) {
    const clientId = config?.google?.clientId;
    if (!clientId) return null;
    const session = readSession();
    if (session?.identity?.subject) {
        if (session.clientId !== clientId || Number(session.expiresAt) <= Date.now()) {
            clearSession();
            return null;
        }
        // Sliding expiry: stay signed in as long as the site is used at least once a month.
        if (Date.now() - Number(session.refreshedAt || 0) > SESSION_REFRESH_MS)
            writeSession(session.identity, clientId, session);
        return session.identity;
    }
    // Sign-in completed by an older build and not yet migrated.
    const credential = sessionStorage.getItem(googleCredentialKey);
    const nonce = sessionStorage.getItem(googleNonceKey);
    if (!credential || !nonce) return null;
    try {
        const identity = await readGoogleIdentity(credential, nonce, clientId);
        writeSession(identity, clientId, null);
        return identity;
    } catch {
        clearSession();
        return null;
    }
}

export async function signOut() {
    clearSession();
    window.google?.accounts?.id?.disableAutoSelect?.();
    return true;
}
