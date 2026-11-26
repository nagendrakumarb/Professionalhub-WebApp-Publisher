window.professionalHub = window.professionalHub || {};
window.professionalHub.printAtsReport = function () {
    const cleanup = () => document.body.classList.remove('print-ats-report');
    document.body.classList.add('print-ats-report');
    window.addEventListener('afterprint', cleanup, { once: true });
    window.setTimeout(() => window.print(), 80);
};
