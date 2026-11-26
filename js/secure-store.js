// Encrypted configuration storage inside the user-mapped local folder.
// Reuses the folder handle and non-extractable AES-GCM key created by professionalHub.jobLedger,
// so provider API keys, publishing tokens and applied-job records share one mapped folder.
// Files are written to <mapped folder>/config/<name>.phcfg as { version, algorithm, iv, cipher }.
window.professionalHub = window.professionalHub || {};
window.professionalHub.secureStore = {
    directoryName: "config",
    searchOptionsFile: "search-options.txt",
    resumePreferencesFile: "resume-preferences.txt",
    jobCacheSettingsFile: "job-search-cache-settings.txt",
    jobCacheDirectory: "job-search-cache",

    async getFolder(requestPermission) {
        const ledger = window.professionalHub.jobLedger;
        if (!window.showDirectoryPicker) throw new Error("Folder storage requires a Chromium browser such as Edge or Chrome.");
        const handle = await ledger.getValue("settings", "jobLedgerFolder");
        if (!handle) throw new Error("Map a local folder in Configuration > Local Folder & Encrypted Storage first.");
        if (!(await ledger.permission(handle, requestPermission))) throw new Error("Folder permission is required. Re-map the folder in Configuration.");
        return handle;
    },

    async write(name, text) {
        const ledger = window.professionalHub.jobLedger;
        const root = await this.getFolder(true);
        const key = await ledger.getKey();
        const dir = await root.getDirectoryHandle(this.directoryName, { create: true });
        const sealed = await ledger.encrypt({ text }, key);
        const file = await dir.getFileHandle(name + ".phcfg", { create: true });
        const writable = await file.createWritable();
        await writable.write(JSON.stringify({ version: 1, algorithm: "AES-GCM-256", ...sealed }));
        await writable.close();
        return true;
    },

    async read(name) {
        const ledger = window.professionalHub.jobLedger;
        const root = await this.getFolder(false);
        const key = await ledger.getKey();
        try {
            const dir = await root.getDirectoryHandle(this.directoryName);
            const file = await (await dir.getFileHandle(name + ".phcfg")).getFile();
            if (!file.size) return null;
            const envelope = JSON.parse(await file.text());
            const plain = await ledger.decrypt(envelope, key);
            return plain.text;
        } catch (error) {
            if (error && error.name === "NotFoundError") return null;
            throw error;
        }
    },

    async remove(name) {
        const root = await this.getFolder(true);
        try {
            const dir = await root.getDirectoryHandle(this.directoryName);
            await dir.removeEntry(name + ".phcfg");
        } catch (error) {
            if (!error || error.name !== "NotFoundError") throw error;
        }
        return true;
    },

    encodeSearchOptions(options) {
        const lines = ["PROFESSIONAL HUB SEARCH OPTIONS v1", ""];
        for (const group of options.roleGroups || options.RoleGroups || []) {
            lines.push(`# Group: ${String(group.name || group.Name || "My roles").replace(/[\r\n]/g, " ")}`);
            for (const role of group.roles || group.Roles || []) {
                const value = String(role).replace(/[\r\n]/g, " ");
                lines.push(value.startsWith("#") ? `\\${value}` : value);
            }
            lines.push("");
        }
        lines.push("# Locations");
        for (const location of options.locations || options.Locations || []) {
            const value = String(location).replace(/[\r\n]/g, " ");
            lines.push(value.startsWith("#") ? `\\${value}` : value);
        }
        return lines.join("\n") + "\n";
    },

    decodeSearchOptions(text) {
        if (!text?.startsWith("PROFESSIONAL HUB SEARCH OPTIONS v1"))
            return JSON.parse(text);
        const roleGroups = [];
        const locations = [];
        let groupName = "My roles";
        let groupRoles = [];
        let isLocations = false;
        const flush = () => {
            if (groupRoles.length) roleGroups.push({ name: groupName, roles: groupRoles });
            groupRoles = [];
        };
        for (const rawLine of text.split(/\r?\n/).slice(1)) {
            if (!rawLine.trim()) continue;
            if (rawLine === "# Locations") {
                flush();
                isLocations = true;
                continue;
            }
            if (rawLine.startsWith("# Group: ")) {
                flush();
                groupName = rawLine.slice("# Group: ".length).trim() || "My roles";
                isLocations = false;
                continue;
            }
            const line = rawLine.startsWith("\\#") ? rawLine.slice(1) : rawLine;
            if (isLocations) locations.push(line);
            else groupRoles.push(line);
        }
        flush();
        return {
            RoleGroups: roleGroups.map(group => ({ Name: group.name, Roles: group.roles })),
            Locations: locations
        };
    },

    async readSearchOptions() {
        const root = await this.getFolder(false);
        try {
            const dir = await root.getDirectoryHandle(this.directoryName);
            const file = await (await dir.getFileHandle(this.searchOptionsFile)).getFile();
            if (!file.size) return null;
            return JSON.stringify(this.decodeSearchOptions(await file.text()));
        } catch (error) {
            if (error?.name === "NotFoundError") return null;
            throw error;
        }
    },

    async writeSearchOptions(json) {
        const options = JSON.parse(json);
        const root = await this.getFolder(true);
        const dir = await root.getDirectoryHandle(this.directoryName, { create: true });
        const file = await dir.getFileHandle(this.searchOptionsFile, { create: true });
        const writable = await file.createWritable();
        await writable.write(this.encodeSearchOptions(options));
        await writable.close();
        return true;
    },

    async readResumePreferences() {
        const root = await this.getFolder(false);
        try {
            const dir = await root.getDirectoryHandle(this.directoryName);
            const file = await (await dir.getFileHandle(this.resumePreferencesFile)).getFile();
            const lines = (await file.text()).split(/\r?\n/);
            if (lines[0]?.trim() !== "PROFESSIONAL HUB RESUME PREFERENCES v1") return null;
            const values = Object.fromEntries(lines.slice(1)
                .filter(line => line.includes("="))
                .map(line => {
                    const index = line.indexOf("=");
                    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
                }));
            if (!/^(true|false)$/i.test(values.showCorrectionOptions || "") ||
                !/^(true|false)$/i.test(values.showJobMatchImprovements || "")) return null;
            return JSON.stringify({
                showCorrectionOptions: values.showCorrectionOptions.toLowerCase() === "true",
                showJobMatchImprovements: values.showJobMatchImprovements.toLowerCase() === "true"
            });
        } catch (error) {
            if (error?.name === "NotFoundError") return null;
            throw error;
        }
    },

    async writeResumePreferences(json) {
        const preferences = JSON.parse(json);
        const root = await this.getFolder(true);
        const dir = await root.getDirectoryHandle(this.directoryName, { create: true });
        const file = await dir.getFileHandle(this.resumePreferencesFile, { create: true });
        const writable = await file.createWritable();
        await writable.write([
            "PROFESSIONAL HUB RESUME PREFERENCES v1",
            `showCorrectionOptions=${preferences.showCorrectionOptions === true}`,
            `showJobMatchImprovements=${preferences.showJobMatchImprovements === true}`,
            ""
        ].join("\n"));
        await writable.close();
        return true;
    },

    async readJobCacheSettings() {
        const root = await this.getFolder(false);
        try {
            const dir = await root.getDirectoryHandle(this.directoryName);
            const file = await (await dir.getFileHandle(this.jobCacheSettingsFile)).getFile();
            const lines = (await file.text()).split(/\r?\n/);
            if (lines[0]?.trim() !== "PROFESSIONAL HUB JOB CACHE SETTINGS v1") return null;
            const values = Object.fromEntries(lines.slice(1)
                .filter(line => line.includes("="))
                .map(line => {
                    const index = line.indexOf("=");
                    return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
                }));
            const retentionDays = Number.parseInt(values.retentionDays, 10);
            if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) return null;
            return JSON.stringify({ enabled: values.enabled === "true", retentionDays });
        } catch (error) {
            if (error?.name === "NotFoundError") return null;
            throw error;
        }
    },

    async writeJobCacheSettings(json) {
        const settings = JSON.parse(json);
        const enabled = settings.enabled ?? settings.Enabled;
        const retentionDays = Number(settings.retentionDays ?? settings.RetentionDays);
        if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90)
            throw new Error("Choose a cache retention period between 1 and 90 days.");
        const root = await this.getFolder(true);
        const dir = await root.getDirectoryHandle(this.directoryName, { create: true });
        const file = await dir.getFileHandle(this.jobCacheSettingsFile, { create: true });
        const writable = await file.createWritable();
        await writable.write([
            "PROFESSIONAL HUB JOB CACHE SETTINGS v1",
            `enabled=${enabled === true}`,
            `retentionDays=${retentionDays}`,
            ""
        ].join("\n"));
        await writable.close();
        return true;
    },

    async loadJobCache(searchKey, retentionDays) {
        const root = await this.getFolder(false);
        let dir;
        try { dir = await root.getDirectoryHandle(this.jobCacheDirectory); }
        catch (error) {
            if (error?.name === "NotFoundError") return null;
            throw error;
        }
        const now = Date.now();
        const maxAge = Math.max(1, Math.min(90, Number(retentionDays) || 1)) * 24 * 60 * 60 * 1000;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(searchKey));
        const targetName = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") + ".phcache";
        let matching = null;
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind !== "file" || !name.endsWith(".phcache")) continue;
            let entry;
            try { entry = JSON.parse(await (await handle.getFile()).text()); }
            catch { continue; }
            const fetchedAt = Date.parse(entry.fetchedAtUtc || "");
            if (!Number.isFinite(fetchedAt) || now - fetchedAt > maxAge) {
                await dir.removeEntry(name);
                continue;
            }
            if (name === targetName) matching = entry;
        }
        return matching ? JSON.stringify(matching) : null;
    },

    async saveJobCache(searchKey, jobs, retentionDays) {
        const root = await this.getFolder(true);
        const dir = await root.getDirectoryHandle(this.jobCacheDirectory, { create: true });
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(searchKey));
        const fileName = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") + ".phcache";
        const now = new Date();
        const entry = { fetchedAtUtc: now.toISOString(), retentionDays, jobs };
        const file = await dir.getFileHandle(fileName, { create: true });
        const writable = await file.createWritable();
        await writable.write(JSON.stringify(entry));
        await writable.close();
        // Prune expired entries on every successful cache update.
        await this.loadJobCache("", retentionDays);
        return true;
    }
};

// Updates the status (Applied / Completed) of already-saved applied-job records.
window.professionalHub.jobLedger.updateStatus = async function (fingerprints, status) {
    const wanted = new Set(fingerprints || []);
    const ledger = await this.readAll(true);
    let updated = 0;
    for await (const [date, entry] of ledger.handle.entries()) {
        if (entry.kind !== "directory" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const content = await this.readDateFolder(entry, ledger.key);
        let changed = false;
        for (const record of content.records) {
            if (wanted.has(record.fingerprint) && record.status !== status) {
                record.status = status;
                record.recordedAt = new Date().toISOString();
                changed = true;
                updated++;
            }
        }
        if (!changed) continue;
        const chunks = [];
        for (const record of content.records) chunks.push(await this.encrypt(record, ledger.key));
        const handle = await entry.getFileHandle(this.fileName, { create: true });
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify({ version: 2, algorithm: "AES-GCM-256", chunks, documents: content.documents || {} }));
        await writable.close();
    }
    return { saved: 0, updated, total: updated, message: `${updated} record(s) set to ${status}.` };
};
