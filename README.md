# Professional Hub

**Professional Hub** is a responsive, browser-based career and learning workspace. It brings together resume preparation, job search, examinations, personal tracking, reporting, and an optional AI learning assistant.

**Live application:** [https://professionalhub.co.in](https://professionalhub.co.in)

## What the application includes

### Resume tools

- Check a PDF or DOCX resume for ATS readability, structure, contact details, skills, achievements, and other practical signals.
- Compare a resume with a job description and review matched skills, gaps, and improvement suggestions.
- Review score details and print or save reports as PDF.
- Get exam recommendations based on skills found in a resume or job match. Recommendations are informational; they do not change ATS or job-match scores. Signed-in users can have recommendations filtered against exams they have already passed.
- Signed-in users can save a personal resume to their selected Data Source, replace it with an archive of the previous copy, and apply restrained heading colors to supported DOCX resumes.
- Use resume correction and improvement tools while reviewing proposed changes and the supporting evidence.

### Job search and applications

- Search configured public job sources and optional credential-based providers, with role and location preferences.
- Review job matches, save relevant jobs, track application status, and retrieve associated tailored resumes.
- Provider availability depends on the provider and network. Optional provider credentials are managed in Configuration.

### Open Exam Suite

- Maintain a candidate profile and browse the available exam library.
- Take or practise exams, review attempts and results, and view certificates associated with the profile.
- View exam activity and career-workspace progress on the dashboard.

### Personal records

- **Income and expenditure:** record income, cash transactions, household bills, vehicle expenses, and imported statement data. Use monthly CSV templates and exports, and configure a financial-year start month.
- **Doctor visits and medical reports:** keep dated visit notes and lab measurements such as blood sugar, thyroid, urine tests, urine cultures, and blood pressure. Add values and reference ranges, or import supported text and CSV data. These records are for personal tracking, not diagnosis.
- Personal records are organized by month and are available only when the user is signed in, has connected a Data Source, and enabled the relevant feature.

### Insights and appearance

- Explore resume, finance, and medical records through selectable Power BI-style report views, including summary cards, KPI/gauge, tables, bar/column, trend, composition, and analysis representations.
- Print reports or use the browser's Save as PDF option.
- Choose from a range of editor-inspired color themes and accent colors for the application interface.

### Optional learning assistant

- Open the floating chat assistant from within the application and converse with a configured local model runtime (currently Ollama).
- Send text and supported attachments, including common text, CSV, PDF, DOCX, and image formats, subject to file-size and model limits.
- Receive streamed replies and structured follow-up choices or forms.
- The assistant is optional and depends on the user's model setup and browser access to it. The current chat is a learning assistant: it does not execute Professional Hub actions or read private application records, and attached learning files are not automatically indexed into a persistent RAG knowledge base.

## Sign-in, data sources, and privacy

- Google sign-in identifies the user. Connecting a Data Source is a separate step and separate permission.
- Users can choose a local folder where supported by their browser, or connect Google Drive. The two sources are separate; changing sources does not automatically move or synchronize existing data.
- A connected Data Source can hold the user's enabled settings and records. Local-folder access may need to be reselected after a browser session ends. Google may ask the user to reconnect Drive access.
- Resume analysis is performed in the browser. When the user chooses a model and sends a chat message or attachment, that content is sent to that configured model connection. Job searches and public job imports contact the selected external provider or source.
- The application is hosted as a static Blazor WebAssembly Progressive Web App. It does not host a server-side model or application backend. Network-dependent services require an internet connection.

## Responsive use

The interface is designed to adapt to desktop and mobile browsers. It can be installed as a Progressive Web App where the browser and operating system support installation. Browser capabilities such as local-folder access, Google sign-in, and printing vary by platform.

## Project structure

- `src/Apps/WebApp` — Professional Hub Blazor WebAssembly application.
- `src/Dependencies/OmniFlow/MAF.Agents` — reusable agent runtime, streaming, and RAG building blocks.
- `src/Dependencies/OmniFlow/MAF.Agents.Razor` — reusable Blazor chat launcher, drawer, and interaction components.
- `docs` — product specifications, implementation plans, and UAT checklists.

The MAF and RAG libraries are also the hands-on learning path for extending the assistant. The code-based lessons use Professional Hub as the working example; planned capabilities are tracked separately from features already available in the app.

## Important notes

- ATS and job-match scores are diagnostic estimates, not hiring guarantees or employer decisions.
- Users should verify suggestions and only include skills, experience, qualifications, and achievements that are accurate.
- Medical reference ranges are recorded for comparison and do not constitute medical advice or diagnosis.
- Power BI-style views are generated by Professional Hub; they are not a connection to the Microsoft Power BI service.
