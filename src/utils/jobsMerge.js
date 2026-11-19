/**
 * Merges the live unarchived jobs subscription with paginated archived job pages,
 * ensuring unarchived active records always supersede stale archive entries.
 */
export function mergeActiveAndArchivedJobs(activeJobs = [], archivedJobs = []) {
  const byId = new Map();

  for (const job of archivedJobs || []) {
    if (job?.id && job.archived === true) {
      byId.set(job.id, job);
    }
  }

  for (const job of activeJobs || []) {
    if (job?.id && !job.archived) {
      byId.set(job.id, job);
    } else if (job?.id && job.archived && byId.has(job.id)) {
      byId.set(job.id, job);
    }
  }

  return Array.from(byId.values());
}
