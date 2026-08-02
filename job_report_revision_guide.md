# Job Report & Advanced Instructions Implementation Plan

This plan details how we will implement the comprehensive report option, advanced dispatch instructions, and driver updates for the VECTO route-tracker application.

## User Review Required

> [!IMPORTANT]
> **Data Migration**: Existing jobs currently use a single string `note` field. We will update the schema to use an `instructions` array going forward. To maintain backward compatibility, the UI will map the legacy `note` string to a single instruction targeting 'all'. Please confirm if this is acceptable.

## Open Questions

> [!WARNING]
> 1. Do you want the "Report" to be a new Modal window inside the app (which users can view and potentially print), or should it instantly trigger a PDF download or a new browser tab for printing? A Modal is planned by default with a "Print" button.
> 2. Should "Driver Notes" be completely separate from the existing "Chat" messages, or should they be sent into the chat stream with a special "Note" tag? (The current plan assumes a separate `notes` subcollection to cleanly separate formal job updates from general chat chatter).

## Proposed Changes

### Database & Store

We will update the Firestore schema structure implicitly through the code changes.
- **Job Document**: Replace `note: string` with `instructions: [{ id, text, target, isPriority }]`.
- **Subcollections**: Introduce `companies/{companyId}/jobs/{jobId}/notes` to store driver updates.

---

### UI Components

#### [MODIFY] CreateJobModal.jsx
Update the dispatch job creation form to handle complex instructions.
- Remove the old `note` textarea.
- Add a dynamic list interface for `instructions`.
- Each instruction item will have:
  - A text input for the instruction details.
  - A dropdown to select the `target` (default: 'all', or specifically assigned driver IDs).
  - A toggle/checkbox for `isPriority` (Priority flag).
- Add functionality to map the legacy `note` string to an instruction if editing an older job.

#### [MODIFY] JobDetails.jsx
Update the main job view to handle driver notes and entry to the report.
- Add a "Submit Job Update/Note" form specifically for drivers to log progress or updates.
- Fetch the new `notes` subcollection in real-time (similar to how `chat` is fetched).
- Add a "View Job Report" button in the action grid that opens the new `JobReportModal`.

#### [NEW] JobReportModal.jsx
Create a comprehensive, cleanly formatted modal designed for both viewing and printing the job report.
- **Section 1: General Info**: Displays job name, date, origin, destinations, contact info, assigned drivers, and all dispatch `instructions` (with high-priority items visually flagged).
- **Section 2: Driver Details & Notes**: Groups driver notes fetched from the `notes` subcollection by driver name, showing a timeline of their updates.
- **Section 3: Route Details**: Uses the `routeInfo` from the store to display total distance, estimated duration, and a step-by-step summary of the route directions.
- **Section 4: Messages**: Appends the chronological history of all chat messages for the job.
- Includes a "Print" button to invoke the browser's print dialog.

#### [MODIFY] store/useAppStore.js
- Update the store to include state for opening the new `jobReport` modal.
- `modals: { ..., jobReport: false }`

## Verification Plan

### Automated Tests
- N/A for this React/Vite project (we will rely on manual verification and hot-reloading).

### Manual Verification
1. **Dispatch Side**: Create a new job as a dispatcher. Add multiple instructions, some assigned to specific drivers, some marked as priority. Save and edit the job to ensure they persist.
2. **Driver Side**: Login as an assigned driver. View the job, add a "Driver Note", and send a chat message.
3. **Report Generation**: Click "View Job Report". Verify all 4 sections render correctly, the notes are grouped by driver, route steps are visible, and the print layout is clean.
