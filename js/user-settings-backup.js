const BACKUP_MAGIC = 'ProfessionalHub.SettingsBackup';
const BACKUP_VERSION = 1;
const KDF_ITERATIONS = 310000;
const MAX_PLAINTEXT_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_TEXT_CHARS = 96 * 1024 * 1024;

function toBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
}

function fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function deriveKey(password, salt) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function parseOptionalJson(value, label) {
    if (!value) return null;
    try { return JSON.parse(value); }
    catch { throw new Error(`Saved ${label} could not be read. Save it again before creating a backup.`); }
}

function validatePayload(payload) {
    if (!payload || payload.magic !== BACKUP_MAGIC || payload.version !== BACKUP_VERSION)
        throw new Error('This is not a supported Professional Hub settings backup.');
    if (payload.searchOptions) {
        const roleGroups = payload.searchOptions.roleGroups ?? payload.searchOptions.RoleGroups;
        const locations = payload.searchOptions.locations ?? payload.searchOptions.Locations;
        if (!Array.isArray(roleGroups) || !Array.isArray(locations))
            throw new Error('The backup has invalid search preferences.');
    }
    if (payload.resumePreferences && (typeof payload.resumePreferences.showCorrectionOptions !== 'boolean' ||
        typeof payload.resumePreferences.showJobMatchImprovements !== 'boolean'))
        throw new Error('The backup has invalid resume preferences.');
    if (payload.jobCacheSettings && (typeof payload.jobCacheSettings.enabled !== 'boolean' ||
        !Number.isInteger(payload.jobCacheSettings.retentionDays) || payload.jobCacheSettings.retentionDays < 1 ||
        payload.jobCacheSettings.retentionDays > 90))
        throw new Error('The backup has invalid personal job-cache settings.');
    if (payload.providerConfiguration !== null && payload.providerConfiguration !== undefined) {
        let providers;
        try { providers = JSON.parse(payload.providerConfiguration)?.providers; }
        catch { throw new Error('The backup has invalid provider settings.'); }
        if (!Array.isArray(providers)) throw new Error('The backup has invalid provider settings.');
    }
    if (!payload.appliedJobs || !Array.isArray(payload.appliedJobs.records) ||
        !payload.appliedJobs.documents || typeof payload.appliedJobs.documents !== 'object')
        throw new Error('The backup has invalid application records.');
    if (Object.keys(payload.appliedJobs.documents).some(id =>
        !payload.appliedJobs.records.some(record => record.fingerprint === id)))
        throw new Error('A resume in the backup does not match an application record.');
}

export async function exportBackup(password, searchOptionsKey, resumePreferencesKey) {
    if (typeof password !== 'string' || password.length < 12)
        throw new Error('Create a backup password with at least 12 characters.');

    const state = await window.professionalHub.jobLedger.getState();
    let providerConfiguration = null;
    let appliedJobs = { records: [], documents: {} };
    let searchOptions = null;
    let jobCacheSettings = null;
    if (state.configured) {
        if (!state.permissionGranted)
            throw new Error('The mapped folder is not available. Choose Map local folder to restore access before backing it up.');
        providerConfiguration = await window.professionalHub.secureStore.read('job-providers');
        appliedJobs = await window.professionalHub.jobLedger.exportPortable();
        searchOptions = parseOptionalJson(await window.professionalHub.secureStore.readSearchOptions(), 'search options');
        jobCacheSettings = parseOptionalJson(await window.professionalHub.secureStore.readJobCacheSettings(), 'job cache settings');
    }

    const payload = {
        magic: BACKUP_MAGIC,
        version: BACKUP_VERSION,
        createdUtc: new Date().toISOString(),
        searchOptions,
        jobCacheSettings,
        providerConfiguration,
        appliedJobs
    };
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    if (plaintext.length > MAX_PLAINTEXT_BYTES)
        throw new Error('The backup is larger than 64 MiB. Remove large tailored resume records and try again.');

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
    const file = {
        magic: BACKUP_MAGIC,
        version: BACKUP_VERSION,
        algorithm: 'AES-256-GCM',
        kdf: 'PBKDF2-SHA-256',
        iterations: KDF_ITERATIONS,
        salt: toBase64(salt),
        iv: toBase64(iv),
        ciphertext: toBase64(ciphertext)
    };
    const blob = new Blob([JSON.stringify(file)], { type: 'application/vnd.professionalhub.settings-backup' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ProfessionalHub-Settings-${new Date().toISOString().slice(0, 10)}.phbackup`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return {
        searchOptionsIncluded: !!payload.searchOptions,
        resumePreferencesIncluded: false,
        jobCacheSettingsIncluded: !!payload.jobCacheSettings,
        providerSettingsIncluded: !!providerConfiguration,
        applicationsIncluded: appliedJobs.records.length,
        resumesIncluded: Object.keys(appliedJobs.documents).length
    };
}

export async function importBackup(encryptedText, password, searchOptionsKey, resumePreferencesKey) {
    if (typeof password !== 'string' || password.length < 1)
        throw new Error('Enter the password used to create this backup.');
    if (typeof encryptedText !== 'string' || encryptedText.length > MAX_BACKUP_TEXT_CHARS)
        throw new Error('The selected backup is too large or invalid.');

    let file;
    try { file = JSON.parse(encryptedText); }
    catch { throw new Error('The selected file is not a valid settings backup.'); }
    if (file?.magic !== BACKUP_MAGIC || file?.version !== BACKUP_VERSION || file?.algorithm !== 'AES-256-GCM' ||
        file?.kdf !== 'PBKDF2-SHA-256' || file?.iterations !== KDF_ITERATIONS || !file?.salt || !file?.iv || !file?.ciphertext)
        throw new Error('This file is not a supported encrypted settings backup.');

    let plaintext;
    try {
        const key = await deriveKey(password, fromBase64(file.salt));
        plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromBase64(file.iv) }, key, fromBase64(file.ciphertext));
    } catch {
        throw new Error('The password is incorrect, or the backup file is damaged.');
    }
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(plaintext)); }
    catch { throw new Error('The decrypted backup content is invalid.'); }
    validatePayload(payload);

    const needsFolder = !!payload.searchOptions || !!payload.jobCacheSettings ||
        !!payload.providerConfiguration || payload.appliedJobs.records.length > 0 ||
        Object.keys(payload.appliedJobs.documents).length > 0;
    const state = await window.professionalHub.jobLedger.getState();
    if (state.configured && !state.permissionGranted)
        throw new Error('The mapped folder is remembered but access is not granted. Choose Map local folder before restoring.');
    if (needsFolder && (!state.configured || !state.permissionGranted))
        throw new Error('Map the destination folder and grant access before restoring provider keys or application records.');

    if (payload.appliedJobs.records.length || Object.keys(payload.appliedJobs.documents).length)
        await window.professionalHub.jobLedger.importPortable(payload.appliedJobs);
    if (payload.providerConfiguration)
        await window.professionalHub.secureStore.write('job-providers', payload.providerConfiguration);

    let searchOptionsSavedToFolder = false;
    if (payload.searchOptions) {
        const groups = payload.searchOptions.roleGroups ?? payload.searchOptions.RoleGroups;
        const locations = payload.searchOptions.locations ?? payload.searchOptions.Locations;
        const normalized = {
            RoleGroups: groups.map(group => ({
                Name: group.name ?? group.Name ?? 'My roles',
                Roles: group.roles ?? group.Roles ?? []
            })),
            Locations: locations
        };
        const value = JSON.stringify(normalized);
        if (state.configured && state.permissionGranted) {
            await window.professionalHub.secureStore.writeSearchOptions(value);
            searchOptionsSavedToFolder = true;
        }
        localStorage.removeItem(searchOptionsKey);
    }
    if (payload.jobCacheSettings)
        await window.professionalHub.secureStore.writeJobCacheSettings(JSON.stringify(payload.jobCacheSettings));

    return {
        searchOptionsImported: !!payload.searchOptions,
        searchOptionsSavedToFolder,
        resumePreferencesImported: false,
        jobCacheSettingsImported: !!payload.jobCacheSettings,
        providerSettingsImported: !!payload.providerConfiguration,
        applicationsImported: payload.appliedJobs.records.length,
        resumesImported: Object.keys(payload.appliedJobs.documents).length,
        createdUtc: payload.createdUtc || ''
    };
}
