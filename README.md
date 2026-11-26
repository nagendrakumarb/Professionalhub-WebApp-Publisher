# Professional Hub — WebAssembly Release & Deployment

**Professional Hub** is a responsive, browser-based career and learning workspace that brings together resume preparation, job search, examinations, personal tracking, reporting, and an optional local AI learning assistant.

**Live Application:** [https://professionalhub.co.in](https://professionalhub.co.in)

> **Repository Note:** This repository hosts the **compiled Blazor WebAssembly deployment artifacts** published via automated GitHub Actions workflows for GitHub Pages hosting. Core application source code, internal libraries, and authoring tools are maintained in a private repository to protect proprietary intellectual property.

---

## Architecture & Deployment Overview

- **Static Blazor WebAssembly PWA:** Delivered as a client-side Progressive Web App with no server-side model or application backend.
- **Automated Release Pipeline:** Built and deployed automatically from the private upstream codebase to GitHub Pages via CI/CD workflows.
- **Local-First Privacy Model:** Resume parsing and analysis run directly in the user's browser, while optional user records are stored in the user's chosen local folder or personal Google Drive.

---

## What the Application Includes

### Resume Tools
- Check a PDF or DOCX resume for ATS readability, structure, contact details, skills, achievements, and other practical signals.
- Compare a resume with a job description to review matched skills, gaps, and improvement suggestions.
- Review score details and print or save reports as PDF.
- Get exam recommendations based on skills found in a resume or job match (informational only; they do not alter ATS or job-match scores). Signed-in users can filter recommendations against exams already passed.
- Save a personal resume to a connected Data Source, replace it while archiving the previous copy, and apply restrained heading colors to supported DOCX resumes.
- Apply resume correction and improvement tools while reviewing proposed changes and supporting evidence.

### Job Search & Applications
- Search configured public job sources and optional credential-based providers using role and location preferences.
- Review job matches, save relevant listings, track application statuses, and retrieve associated tailored resumes.
- Manage optional provider credentials directly in Configuration.

### Open Exam Suite
- Maintain a candidate profile and browse the available exam library.
- Take or practice exams, review attempts and results, and view digital certificates associated with the profile.
- Track exam activity and career-workspace progress on the dashboard.

### Personal Records
- **Income & Expenditure:** Record income, cash transactions, household bills, vehicle expenses, and imported statement data using monthly CSV templates, exports, and a configurable financial-year start month.
- **Personal Health Journal:** Organize care visits, dated lab measurements (blood sugar, thyroid, urine tests, urine cultures, blood pressure), notes, and reference ranges, with text and CSV import support.
- Personal records are organized by month and available only when signed in with a connected Data Source and the relevant feature enabled.

### Insights & Appearance
- Explore resume, finance, and health records through interactive Power BI-style report views, including summary cards, KPI gauges, tables, bar/column charts, trends, compositions, and analytical breakdowns.
- Print reports or export via the browser's **Save as PDF** option.
- Customize the workspace with editor-inspired color themes and accent colors.

### Optional AI Learning Assistant
- Open the floating chat assistant inside the app to converse with a configured local model runtime (currently **Ollama**).
- Send text and supported attachments (text, CSV, PDF, DOCX, and common image formats) subject to file-size and model limits.
- Receive streamed replies and structured follow-up choices or forms.
- *Scope:* The assistant is optional and depends on the user's local model setup. It operates as an interactive learning assistant—it does not execute Professional Hub actions, read private application records, or index attached files into a persistent knowledge base.

---

## Sign-In, Data Sources & Privacy

- **Authentication:** Google sign-in identifies the user; connecting a Data Source is a separate step with explicit permission.
- **Storage Options:** Choose a browser-supported local folder or connect Google Drive. The two sources are independent and do not automatically synchronize.
- **Session Persistence:** Local-folder access may need to be reselected after a browser session ends, and Google may periodically ask to reconnect Drive access.
- **Data Boundaries:** Resume analysis runs locally in the browser. Chat messages or attachments are sent only to the user's configured model connection, and job searches contact only the selected external job providers.

---

## Responsive & PWA Support

The interface adapts across desktop and mobile browsers and can be installed as a Progressive Web App (PWA) on supported operating systems. Capabilities such as local-folder access, Google sign-in, and printing vary by browser and platform.

---

## Important Notes

- ATS and job-match scores are diagnostic estimates, not hiring guarantees or employer decisions.
- Users should verify all suggestions and include only accurate skills, experience, qualifications, and achievements.
- Health reference ranges are recorded for personal comparison and do not constitute medical advice or diagnosis.
- Power BI-style views are generated natively by Professional Hub and are not connected to the Microsoft Power BI service.
