window.professionalHubConfiguration = window.professionalHubConfiguration || {};
window.professionalHubConfiguration.downloadJson = (fileName, content) => {
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName || "appsettings.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};
window.professionalHubConfiguration.scrollToElement = (elementId) => {
    const element = document.getElementById(elementId);
    if (!element) return false;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
};
