const DB_NAME = 'professionalhub-open-exams';
const DB_VERSION = 3;

let persistRequested = false;
function requestPersistence() {
    // Ask the browser to keep this origin's IndexedDB (exams, attempts, certificates) instead of evicting it.
    if (persistRequested) return;
    persistRequested = true;
    try { navigator.storage?.persist?.(); } catch { }
}

export async function getStorageStatus() {
    try {
        const persisted = await navigator.storage?.persisted?.();
        const estimate = await navigator.storage?.estimate?.();
        return { persisted: !!persisted, usage: estimate?.usage ?? 0, quota: estimate?.quota ?? 0 };
    } catch { return { persisted: false, usage: 0, quota: 0 }; }
}

function openDb() {
    requestPersistence();
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('exams')) db.createObjectStore('exams', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('attempts')) db.createObjectStore('attempts', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
            if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('certificates')) db.createObjectStore('certificates', { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Could not open the local exam library.'));
    });
}

async function request(storeName, mode, action) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        try { result = action(store); }
        catch (error) { db.close(); reject(error); return; }
        tx.oncomplete = () => { db.close(); resolve(result?.result); };
        tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Local exam storage failed.')); };
        tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Local exam storage was interrupted.')); };
    });
}

let localKeyPromise;

async function getLocalDataKey() {
    if (!localKeyPromise) {
        localKeyPromise = (async () => {
            const db = await openDb();
            const existing = await new Promise((resolve, reject) => {
                const tx = db.transaction('keys', 'readonly');
                const req = tx.objectStore('keys').get('local-data-key');
                req.onsuccess = () => resolve(req.result?.value ?? null);
                req.onerror = () => reject(req.error);
                tx.oncomplete = () => db.close();
                tx.onerror = () => { db.close(); reject(tx.error); };
            });
            if (existing) return existing;

            const generated = await crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
            const writeDb = await openDb();
            return new Promise((resolve, reject) => {
                const tx = writeDb.transaction('keys', 'readwrite');
                const store = tx.objectStore('keys');
                const req = store.get('local-data-key');
                let selected = generated;
                req.onsuccess = () => {
                    if (req.result?.value) selected = req.result.value;
                    else store.put({ id: 'local-data-key', value: generated });
                };
                req.onerror = () => { try { tx.abort(); } catch { } };
                tx.oncomplete = () => { writeDb.close(); resolve(selected); };
                tx.onerror = () => { writeDb.close(); reject(tx.error); };
                tx.onabort = () => { writeDb.close(); reject(tx.error ?? new Error('Could not initialise local encryption.')); };
            });
        })();
    }
    try { return await localKeyPromise; }
    catch (error) { localKeyPromise = undefined; throw error; }
}

async function encryptRecord(record) {
    const key = await getLocalDataKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { ...(record.id !== undefined ? { id: record.id } : { key: record.key }), __encrypted: true, iv: toBase64(iv), payload: toBase64(new Uint8Array(ciphertext)) };
}

async function decryptRecord(record) {
    if (!record?.__encrypted) return record; // Existing version-1 records are migrated on read.
    const key = await getLocalDataKey();
    const bytes = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(record.iv) }, key, fromBase64(record.payload));
    return JSON.parse(new TextDecoder().decode(bytes));
}

async function getAllDecrypted(storeName) {
    const db = await openDb();
    const raw = await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
    // One damaged record must not hide every other record (that made the Dashboard look empty).
    const settled = await Promise.allSettled(raw.map(decryptRecord));
    const records = [];
    settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') records.push(outcome.value);
        else console.warn(`Skipping unreadable ${storeName} record`, raw[index]?.id ?? raw[index]?.key, outcome.reason);
    });
    const legacy = raw.filter(x => !x?.__encrypted);
    for (const item of legacy) await putEncrypted(storeName, item);
    return records;
}

async function putEncrypted(storeName, record) {
    const encrypted = await encryptRecord(record);
    await request(storeName, 'readwrite', store => store.put(encrypted));
}

export async function getExams() { return getAllDecrypted('exams'); }
export async function saveExam(exam) { await putEncrypted('exams', exam); }
export async function removeExam(id) { await request('exams', 'readwrite', s => s.delete(id)); }
export async function getAttempts() { return getAllDecrypted('attempts'); }
export async function saveAttempt(attempt) { await putEncrypted('attempts', attempt); }
export async function getCertificates() { return getAllDecrypted('certificates'); }
export async function saveCertificate(certificate) { await putEncrypted('certificates', certificate); }
export async function getSetting(key) {
    const settings = await getAllDecrypted('settings');
    return settings.find(x => x.key === key)?.value ?? null;
}
export async function saveSetting(key, value) { await putEncrypted('settings', { key, value }); }

export async function clearAttempts() { await request('attempts', 'readwrite', s => s.clear()); }


const PROFILE_MAGIC = 'PROFESSIONALHUB_PROFILE';
const PROFILE_VERSION = 1;
const PROFILE_ITERATIONS = 310000;
const MAX_PROFILE_BYTES = 64 * 1024 * 1024;
const MAX_PROFILE_PLAINTEXT_BYTES = 45 * 1024 * 1024;

function toBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize)
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    return btoa(binary);
}

function fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function deriveProfileKey(password, salt) {
    const material = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: PROFILE_ITERATIONS, hash: 'SHA-256' },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function readAll(storeName) { return getAllDecrypted(storeName); }

async function writeImportedRecords(payload) {
    const [exams, attempts, certificates, settings] = await Promise.all([
        Promise.all(payload.exams.map(encryptRecord)),
        Promise.all(payload.attempts.map(encryptRecord)),
        Promise.all((payload.certificates ?? []).map(encryptRecord)),
        Promise.all(payload.settings.map(encryptRecord))
    ]);
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['exams', 'attempts', 'certificates', 'settings'], 'readwrite');
        for (const item of exams) tx.objectStore('exams').put(item);
        for (const item of attempts) tx.objectStore('attempts').put(item);
        for (const item of certificates) tx.objectStore('certificates').put(item);
        for (const item of settings) tx.objectStore('settings').put(item);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not restore the profile.')); };
        tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Profile restore was interrupted.')); };
    });
}

function validateProfilePayload(payload) {
    if (!payload || payload.magic !== PROFILE_MAGIC || payload.version !== PROFILE_VERSION)
        throw new Error('This is not a supported Professional Hub profile file.');
    if (!Array.isArray(payload.exams) || !Array.isArray(payload.attempts) || !Array.isArray(payload.settings) || (payload.certificates !== undefined && !Array.isArray(payload.certificates)))
        throw new Error('The profile file is incomplete or damaged.');
    if (payload.exams.some(x => !x || typeof x.id !== 'string' || typeof x.dataBase64 !== 'string') ||
        payload.attempts.some(x => !x || typeof x.id !== 'string') ||
        (payload.certificates ?? []).some(x => !x || typeof x.id !== 'string') ||
        payload.settings.some(x => !x || typeof x.key !== 'string'))
        throw new Error('The profile contains invalid records and was not imported.');
}

export async function exportProfile(password) {
    if (typeof password !== 'string' || password.length < 12)
        throw new Error('Use a profile password with at least 12 characters.');
    const payload = {
        magic: PROFILE_MAGIC,
        version: PROFILE_VERSION,
        createdUtc: new Date().toISOString(),
        exams: await readAll('exams'),
        attempts: await readAll('attempts'),
        certificates: await readAll('certificates'),
        settings: await readAll('settings')
    };
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveProfileKey(password, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    if (plaintext.length > MAX_PROFILE_PLAINTEXT_BYTES) throw new Error('The profile data is too large for a 64 MiB encrypted export file.');
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const file = {
        magic: PROFILE_MAGIC,
        version: PROFILE_VERSION,
        algorithm: 'AES-256-GCM',
        kdf: 'PBKDF2-SHA-256',
        iterations: PROFILE_ITERATIONS,
        salt: toBase64(salt),
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(encrypted))
    };
    const blob = new Blob([JSON.stringify(file)], { type: 'application/vnd.professionalhub.profile+json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ProfessionalHub-${new Date().toISOString().slice(0, 10)}.phprofile`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function importProfile(encryptedText, password) {
    if (typeof password !== 'string' || password.length < 1)
        throw new Error('Enter the password used when this profile was exported.');
    if (typeof encryptedText !== 'string' || encryptedText.length > MAX_PROFILE_BYTES)
        throw new Error('The selected profile file is too large or invalid.');
    let file;
    try { file = JSON.parse(encryptedText); }
    catch { throw new Error('The selected file is not a valid Professional Hub profile.'); }
    if (file?.magic !== PROFILE_MAGIC || file?.version !== PROFILE_VERSION ||
        file?.algorithm !== 'AES-256-GCM' || file?.kdf !== 'PBKDF2-SHA-256' ||
        file?.iterations !== PROFILE_ITERATIONS || !file?.salt || !file?.iv || !file?.ciphertext)
        throw new Error('This file is not a supported encrypted Professional Hub profile.');
    let plaintext;
    try {
        const key = await deriveProfileKey(password, fromBase64(file.salt));
        plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromBase64(file.iv) }, key, fromBase64(file.ciphertext));
    } catch {
        throw new Error('The password is incorrect, or the profile file has been changed or damaged.');
    }
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(plaintext)); }
    catch { throw new Error('The decrypted profile content is invalid.'); }
    validateProfilePayload(payload);
    await writeImportedRecords(payload);
    return {
        examsImported: payload.exams.length,
        attemptsImported: payload.attempts.length,
        certificatesImported: (payload.certificates ?? []).length,
        createdUtc: payload.createdUtc ?? ''
    };
}


export async function printCertificate(certificate) {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
    const popup = window.open('', '_blank', 'width=900,height=700');
    if (!popup) throw new Error('Allow pop-ups to print your certificate.');
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Professional Hub Certificate</title>
<style>
@page{size:landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:Georgia,serif;color:#17324d;background:#f4f7fb}
.certificate{position:relative;min-height:185mm;border:2px solid #b68b35;outline:8px double #17324d;outline-offset:-12px;padding:12mm 20mm;text-align:center;display:flex;flex-direction:column;justify-content:center;background:linear-gradient(135deg,#fff 0%,#fbfaf5 55%,#f2f6f9 100%);overflow:hidden}
.banner{position:absolute;top:0;left:0;right:0;height:7mm;background:linear-gradient(90deg,#17324d,#0f766e,#17324d)}
.seal{position:absolute;top:17mm;right:24mm;width:25mm;height:25mm;border:2px solid #b68b35;border-radius:50%;display:grid;place-items:center;color:#b68b35;font:700 10px Arial,sans-serif;letter-spacing:.1em;transform:rotate(12deg)}
.brand{font:700 12px Arial,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#0f766e}
h1{font-size:34px;letter-spacing:.08em;margin:10px 0 6px;text-transform:uppercase}
.subtitle{font:14px Arial,sans-serif;color:#52667a}
.name{font-size:34px;font-weight:bold;margin:20px 0;border-bottom:1px solid #9fb3c8;padding-bottom:10px}
.detail{font:15px Arial,sans-serif;line-height:1.7}
.score{font-size:22px;font-weight:bold;margin:12px}
.signatures{display:flex;justify-content:space-around;gap:28mm;margin:16px auto 0;max-width:145mm;font:11px Arial,sans-serif;color:#52667a}
.signatures div{min-width:55mm;border-top:1px solid #8395a7;padding-top:6px}
.footer{display:flex;justify-content:space-between;margin-top:16px;font:11px Arial,sans-serif;color:#52667a}
.disclaimer{margin-top:16px;font:10px Arial,sans-serif;color:#718096}
.candidate-photo{width:34mm;height:34mm;object-fit:cover;border:2px solid #9fb3c8;border-radius:50%;margin:0 auto 8px}
</style></head><body><section class="certificate">
<div class="banner"></div><div class="seal">ACHIEVEMENT<br>RECORD</div>
<div class="brand">Professional Hub · Open Exam Suite</div><h1>Certificate of Achievement</h1>
${certificate.photoDataUrl ? `<img class="candidate-photo" src="${escape(certificate.photoDataUrl)}" alt="Candidate photograph">` : ''}
<div class="subtitle">This records that</div><div class="name">${escape(certificate.candidateName)}</div>
<div class="detail">has successfully completed the examination<br><strong>${escape(certificate.examTitle)}</strong></div>
<div class="score">${escape(certificate.percent)}% · PASS</div>
${certificate.candidateEmail || certificate.candidatePhone || certificate.candidateAddress ? `<div class="detail">${[certificate.candidateEmail, certificate.candidatePhone, certificate.candidateAddress].filter(Boolean).map(escape).join('<br>')}</div>` : ''}
<div class="detail">Completed on ${escape(new Date(certificate.completedUtc).toLocaleDateString())}</div>
<div class="signatures"><div>Authorized issuer<br><strong>Professional Hub</strong></div><div>Candidate<br><strong>${escape(certificate.candidateName)}</strong></div></div>
<div class="footer"><span>Certificate No: ${escape(certificate.certificateNumber)}</span><span>Issued: ${escape(new Date(certificate.completedUtc).toLocaleDateString())}</span></div>
<div class="disclaimer">Personal achievement record generated in this browser. Independent verification or accreditation requires issuer review and publication.</div>
</section><script>window.onload=()=>window.print();</script></body></html>`);
    popup.document.close();
}

export async function prepareResultEmail(result, recipient, password) {
    if (typeof password !== 'string' || password.length < 12) throw new Error('A password of at least 12 characters is required.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveProfileKey(password, salt);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(result)));
    const file = {
        magic: 'PROFESSIONALHUB_RESULT', version: 1, algorithm: 'AES-256-GCM',
        kdf: 'PBKDF2-SHA-256', iterations: PROFILE_ITERATIONS,
        salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(encrypted))
    };
    const blob = new Blob([JSON.stringify(file)], { type: 'application/vnd.professionalhub.result+json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ProfessionalHub-Exam-Result-${new Date().toISOString().slice(0, 10)}.phresult`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    const subject = encodeURIComponent('Professional Hub exam result submission');
    const body = encodeURIComponent('Hello,\n\nI have attached my exam result file. I will share its password separately. If I passed, please publish my certificate and send me its public link at my profile email address.\n\nThank you.');
    // Open the mail app with a link click (no pop-up window, which browsers block after async work).
    const mail = document.createElement('a');
    mail.href = `mailto:${encodeURIComponent(recipient)}?subject=${subject}&body=${body}`;
    setTimeout(() => mail.click(), 300);
}
