// One IndexedDB database is shared by the job ledger (folder handle + key) and the resume-analysis history.
// Both must create *every* store: whichever opened first used to create the database without the other's
// stores, which made saved analyses and the mapped folder disappear. Version 3 repairs existing databases.
const PH_DB_NAME = "professional-hub";
const PH_DB_VERSION = 3;
function openProfessionalHubDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(PH_DB_NAME, PH_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains("analyses"))
                db.createObjectStore("analyses", { keyPath: "id", autoIncrement: true });
            if (!db.objectStoreNames.contains("settings"))
                db.createObjectStore("settings");
            if (!db.objectStoreNames.contains("cryptoKeys"))
                db.createObjectStore("cryptoKeys");
        };
        request.onsuccess = () => {
            const db = request.result;
            // If another tab upgrades the schema, close so it is not blocked.
            db.onversionchange = () => db.close();
            resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => console.warn("Professional Hub storage update is waiting for other open tabs to close.");
    });
}

window.professionalHub = {
    // ---------------------------------------------------------------------------
    // Browser file downloads
    // ---------------------------------------------------------------------------
    files: {
        downloadBase64: function (fileName, contentType, base64) {
            if (!fileName || typeof base64 !== "string") return false;
            const binary = atob(base64);
            const chunks = [];
            const chunkSize = 0x8000;
            for (let offset = 0; offset < binary.length; offset += chunkSize) {
                const slice = binary.slice(offset, offset + chunkSize);
                const bytes = new Uint8Array(slice.length);
                for (let index = 0; index < slice.length; index++)
                    bytes[index] = slice.charCodeAt(index);
                chunks.push(bytes);
            }
            const blob = new Blob(chunks, { type: contentType || "application/octet-stream" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = fileName;
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            return true;
        }
    },

    // ---------------------------------------------------------------------------
    // Encrypted Job Ledger Storage
    // ---------------------------------------------------------------------------
    jobLedger: {
        fileName: "applied-jobs.phjob",

        openDb: function () {
            return openProfessionalHubDb();
        },

        getValue: async function (storeName, key) {
            const db = await this.openDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, "readonly");
                const request = tx.objectStore(storeName).get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                tx.oncomplete = () => db.close();
                tx.onabort = () => db.close();
            });
        },

        setValue: async function (storeName, key, value) {
            const db = await this.openDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, "readwrite");
                const store = tx.objectStore(storeName);
                store.put(value, key);
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => { db.close(); reject(tx.error); };
                tx.onabort = () => { db.close(); reject(tx.error); };
            });
        },

        permission: async function (handle, request) {
            if (!handle) return false;
            const options = { mode: "readwrite" };
            try {
                if ((await handle.queryPermission(options)) === "granted") return true;
                return request && (await handle.requestPermission(options)) === "granted";
            } catch (err) {
                console.warn("Permission query failed", err);
                return false;
            }
        },

        getState: async function () {
            if (!window.showDirectoryPicker) {
                return {
                    supported: false,
                    configured: false,
                    permissionGranted: false,
                    message: "Folder storage requires a Chromium browser such as Edge or Chrome."
                };
            }

            const handle = await this.getValue("settings", "jobLedgerFolder");
            if (!handle) {
                return {
                    supported: true,
                    configured: false,
                    permissionGranted: false,
                    message: "Choose a folder to store encrypted applied-job records."
                };
            }

            const granted = await this.permission(handle, false);
            return {
                supported: true,
                configured: true,
                permissionGranted: granted,
                message: granted
                    ? `Mapped folder: ${handle.name}`
                    : `Folder ${handle.name} is mapped; click Map local folder to restore permission.`
            };
        },

        // Browsers drop folder permission between sessions; it can only be re-granted from a click.
        restoreAccess: async function () {
            const handle = await this.getValue("settings", "jobLedgerFolder");
            if (!handle) return this.getState();
            await this.permission(handle, true);
            return this.getState();
        },

        chooseFolder: async function () {
            if (!window.showDirectoryPicker) {
                return { supported: false, configured: false, permissionGranted: false, message: "Folder storage requires Edge or Chrome." };
            }
            const handle = await window.showDirectoryPicker({ id: "professionalhub-applied-jobs", mode: "readwrite" });
            if (!(await this.permission(handle, true))) throw new Error("Read/write folder permission was not granted.");
            await this.setValue("settings", "jobLedgerFolder", handle);
            await this.getKey();
            return { supported: true, configured: true, permissionGranted: true, message: `Mapped folder: ${handle.name}` };
        },

        getKey: async function () {
            let key = await this.getValue("cryptoKeys", "jobLedgerAesKey");
            if (!key) {
                key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
                await this.setValue("cryptoKeys", "jobLedgerAesKey", key);
            }
            return key;
        },

        toBase64: function (bytes) {
            let binary = "";
            const len = bytes.byteLength;
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
        },

        fromBase64: function (value) {
            const binary = atob(value);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return bytes;
        },

        encrypt: async function (record, key) {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const data = new TextEncoder().encode(JSON.stringify(record));
            const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
            return { iv: this.toBase64(iv), cipher: this.toBase64(cipher) };
        },

        decrypt: async function (chunk, key) {
            const plain = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: this.fromBase64(chunk.iv) },
                key,
                this.fromBase64(chunk.cipher)
            );
            return JSON.parse(new TextDecoder().decode(plain));
        },

        encryptDocument: async function (base64, key) {
            const chunks = [];
            const size = 256 * 1024;
            for (let offset = 0, index = 0; offset < base64.length; offset += size, index++) {
                chunks.push(await this.encrypt({ index, data: base64.slice(offset, offset + size) }, key));
            }
            return chunks;
        },

        decryptDocument: async function (chunks, key) {
            const parts = [];
            for (const chunk of chunks || []) parts.push(await this.decrypt(chunk, key));
            return parts.sort((left, right) => left.index - right.index).map(part => part.data).join("");
        },

        readDateFolder: async function (directory, key, strict = false) {
            try {
                const fileHandle = await directory.getFileHandle(this.fileName);
                const file = await fileHandle.getFile();
                if (!file.size) return { records: [], documents: {} };
                const envelope = JSON.parse(await file.text());
                const records = [];
                for (const chunk of envelope.chunks || []) {
                    try {
                        records.push(await this.decrypt(chunk, key));
                    } catch (error) {
                        if (strict) throw error;
                        console.warn("Skipped an unreadable applied-job chunk.", error);
                    }
                }
                return { records, documents: envelope.documents || {} };
            } catch (error) {
                if (error.name === "NotFoundError") return { records: [], documents: {} };
                throw error;
            }
        },

        readAll: async function (requestPermission) {
            const handle = await this.getValue("settings", "jobLedgerFolder");
            if (!handle) throw new Error("Map a local folder before saving or filtering applied jobs.");
            if (!(await this.permission(handle, requestPermission))) {
                throw new Error("Folder permission is required. Click Map local folder.");
            }
            const key = await this.getKey();
            const records = [];
            try {
                for await (const [name, entry] of handle.entries()) {
                    if (entry.kind === "directory" && /^\d{4}-\d{2}-\d{2}$/.test(name)) {
                        const content = await this.readDateFolder(entry, key);
                        records.push(...content.records);
                    }
                }
            } catch (error) {
                console.error("Failed reading ledger directories.", error);
            }
            return { handle, key, records };
        },

        exportPortable: async function () {
            const handle = await this.getValue("settings", "jobLedgerFolder");
            if (!handle || !(await this.permission(handle, false)))
                throw new Error("Map the folder and restore its permission before backing up application records.");
            const key = await this.getKey();
            const records = [];
            const documents = {};
            for await (const [date, entry] of handle.entries()) {
                if (entry.kind !== "directory" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
                const content = await this.readDateFolder(entry, key, true);
                records.push(...content.records);
                for (const [fingerprint, document] of Object.entries(content.documents || {})) {
                    documents[fingerprint] = {
                        fileName: document.fileName || "Job-Tailored-Resume.docx",
                        contentType: document.contentType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        base64: await this.decryptDocument(document.chunks, key)
                    };
                }
            }
            return { records, documents };
        },

        importPortable: async function (portable) {
            const incoming = portable?.records || [];
            const incomingDocuments = portable?.documents || {};
            if (!Array.isArray(incoming) || !incoming.every(record => record?.fingerprint && record?.postedDate))
                throw new Error("The backup contains invalid application records.");
            const handle = await this.getValue("settings", "jobLedgerFolder");
            if (!handle || !(await this.permission(handle, true)))
                throw new Error("Map the destination folder and grant access before restoring application records.");
            const key = await this.getKey();
            const groups = new Map();
            for (const record of incoming) {
                const date = /^\d{4}-\d{2}-\d{2}$/.test(record.postedDate)
                    ? record.postedDate : new Date().toISOString().slice(0, 10);
                if (!groups.has(date)) groups.set(date, []);
                groups.get(date).push(record);
            }
            for (const fingerprint of Object.keys(incomingDocuments)) {
                const record = incoming.find(item => item.fingerprint === fingerprint);
                if (record) {
                    const date = /^\d{4}-\d{2}-\d{2}$/.test(record.postedDate)
                        ? record.postedDate : new Date().toISOString().slice(0, 10);
                    if (!groups.has(date)) groups.set(date, []);
                }
            }

            const prepared = [];
            for (const [date, records] of groups) {
                let directory = null;
                let existing = { records: [], documents: {} };
                try {
                    directory = await handle.getDirectoryHandle(date);
                    existing = await this.readDateFolder(directory, key, true);
                } catch (error) {
                    if (error?.name !== "NotFoundError")
                        throw new Error("This folder has records encrypted by a different browser key. To restore safely, choose a new empty folder and restore the backup there. The existing files were left unchanged.");
                }
                const merged = new Map(existing.records.map(record => [record.fingerprint, record]));
                const documents = { ...(existing.documents || {}) };
                for (const record of records) merged.set(record.fingerprint, record);
                for (const record of merged.values()) {
                    const document = incomingDocuments[record.fingerprint];
                    if (!document?.base64) continue;
                    documents[record.fingerprint] = {
                        fileName: document.fileName || "Job-Tailored-Resume.docx",
                        contentType: document.contentType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        chunks: await this.encryptDocument(document.base64, key)
                    };
                }
                const chunks = [];
                for (const record of merged.values()) chunks.push(await this.encrypt(record, key));
                prepared.push({ date, directory, chunks, documents });
            }
            for (const item of prepared) {
                const directory = item.directory || await handle.getDirectoryHandle(item.date, { create: true });
                const file = await directory.getFileHandle(this.fileName, { create: true });
                const writable = await file.createWritable();
                await writable.write(JSON.stringify({ version: 2, algorithm: "AES-GCM-256", chunks: item.chunks, documents: item.documents }));
                await writable.close();
            }
            return { recordsImported: incoming.length, resumesImported: Object.keys(incomingDocuments).length };
        },

        loadFingerprints: async function () {
            const state = await this.getState();
            if (!state.configured || !state.permissionGranted) return [];
            const ledger = await this.readAll(false);
            return [...new Set(ledger.records.map(record => record.fingerprint).filter(Boolean))];
        },

        list: async function () {
            const ledger = await this.readAll(false);
            const results = [];
            for await (const [date, entry] of ledger.handle.entries()) {
                if (entry.kind !== "directory" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
                const content = await this.readDateFolder(entry, ledger.key);
                for (const record of content.records) {
                    const document = content.documents[record.fingerprint];
                    results.push({
                        fingerprint: record.fingerprint,
                        providerJobId: record.providerJobId || "",
                        title: record.title || "",
                        company: record.company || "",
                        location: record.location || "",
                        url: record.url || "",
                        source: record.source || "",
                        postedAt: record.postedAt || "",
                        postedDate: record.postedDate || date,
                        skills: record.skills || [],
                        status: record.status || "",
                        recordedAt: record.recordedAt || "",
                        hasResume: !!document,
                        resumeFileName: document?.fileName || ""
                    });
                }
            }
            return results.sort((left, right) => (right.recordedAt || "").localeCompare(left.recordedAt || ""));
        },

        getResume: async function (postedDate, fingerprint) {
            const ledger = await this.readAll(false);
            const directory = await ledger.handle.getDirectoryHandle(postedDate);
            const content = await this.readDateFolder(directory, ledger.key);
            const document = content.documents[fingerprint];
            if (!document) throw new Error("No tailored resume is stored for this job.");
            return {
                fileName: document.fileName || "Job-Tailored-Resume.docx",
                base64: await this.decryptDocument(document.chunks, ledger.key)
            };
        },

        save: async function (records) {
            const ledger = await this.readAll(true);
            const incomingRecords = Array.isArray(records)
                ? records
                : records && typeof records === "object"
                    ? [records]
                    : [];

            if (!incomingRecords.length) {
                throw new Error("No valid job records were supplied for saving.");
            }

            const groups = new Map();
            for (const record of incomingRecords) {
                const date = /^\d{4}-\d{2}-\d{2}$/.test(record.postedDate)
                    ? record.postedDate
                    : new Date().toISOString().slice(0, 10);
                if (!groups.has(date)) groups.set(date, []);
                groups.get(date).push(record);
            }

            let saved = 0, updated = 0, total = 0;
            const verifiedFiles = [];

            for (const [date, incoming] of groups) {
                const directory = await ledger.handle.getDirectoryHandle(date, { create: true });
                const content = await this.readDateFolder(directory, ledger.key);
                const byId = new Map(content.records.map(record => [record.fingerprint, record]));
                const documents = content.documents || {};

                for (const record of incoming) {
                    if (byId.has(record.fingerprint)) updated++;
                    else saved++;

                    const storedRecord = { ...record };
                    delete storedRecord.resumeBase64;
                    delete storedRecord.resumeFileName;

                    byId.set(record.fingerprint, storedRecord);

                    if (record.resumeBase64) {
                        documents[record.fingerprint] = {
                            fileName: record.resumeFileName || "Job-Tailored-Resume.docx",
                            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                            chunks: await this.encryptDocument(record.resumeBase64, ledger.key)
                        };
                    }
                }

                const chunks = [];
                for (const record of byId.values()) {
                    chunks.push(await this.encrypt(record, ledger.key));
                }

                const fileHandle = await directory.getFileHandle(this.fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(JSON.stringify({ version: 2, algorithm: "AES-GCM-256", chunks, documents }));
                await writable.close();

                const writtenFile = await fileHandle.getFile();
                if (!writtenFile.size) {
                    throw new Error(`The browser created ${date}/${this.fileName}, but the file is empty.`);
                }

                const verification = await this.readDateFolder(directory, ledger.key);
                const verifiedById = new Map(verification.records.map(record => [record.fingerprint, record]));
                const missing = incoming.filter(record => {
                    const stored = verifiedById.get(record.fingerprint);
                    return !stored || stored.status !== record.status;
                });

                if (missing.length) {
                    throw new Error(`The encrypted ledger could not be verified after writing ${date}/${this.fileName}.`);
                }

                verifiedFiles.push(`${date}/${this.fileName}`);
                total += byId.size;
            }

            return {
                saved,
                updated,
                total,
                message: `${saved} job(s) saved and ${updated} updated. Verified: ${verifiedFiles.join(", ")}.`
            };
        }
    },

    // ---------------------------------------------------------------------------
    // History Store
    // ---------------------------------------------------------------------------
    history: {
        open: function () {
            return openProfessionalHubDb();
        },

        save: async function (record) {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction("analyses", "readwrite");
                tx.objectStore("analyses").add(record);
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => { db.close(); reject(tx.error); };
                tx.onabort = () => { db.close(); reject(tx.error); };
            });
        },

        getAll: async function () {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction("analyses", "readonly");
                const request = tx.objectStore("analyses").getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                tx.oncomplete = () => db.close();
                tx.onabort = () => db.close();
            });
        }
    }
};

