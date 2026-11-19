/**
 * Sorts company members for dispatch rotation:
 * 1. Priority drivers first
 * 2. Duty status (on_duty > break > off_duty)
 * 3. Explicit numeric rosterOrder (ascending)
 * 4. Least recently dispatched (lastDispatchedAt ascending)
 * 5. Alphabetical by name/email
 * @param {Array} members
 * @returns {Array}
 */
export function sortDriverRoster(members = []) {
  const dutyWeight = { on_duty: 3, break: 2, off_duty: 1 };

  return [...members].sort((a, b) => {
    const aPriority = !!a.isPriorityDriver;
    const bPriority = !!b.isPriorityDriver;
    if (aPriority !== bPriority) return aPriority ? -1 : 1;

    const aDuty = dutyWeight[a.onDutyStatus || 'on_duty'] || 3;
    const bDuty = dutyWeight[b.onDutyStatus || 'on_duty'] || 3;
    if (aDuty !== bDuty) return bDuty - aDuty;

    const aHasOrder = typeof a.rosterOrder === 'number';
    const bHasOrder = typeof b.rosterOrder === 'number';
    if (aHasOrder && bHasOrder && a.rosterOrder !== b.rosterOrder) {
      return a.rosterOrder - b.rosterOrder;
    }
    if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;

    const aDispatched = typeof a.lastDispatchedAt?.toMillis === 'function' ? a.lastDispatchedAt.toMillis() : 0;
    const bDispatched = typeof b.lastDispatchedAt?.toMillis === 'function' ? b.lastDispatchedAt.toMillis() : 0;
    if (aDispatched !== bDispatched) return aDispatched - bDispatched;

    const aName = (a.name || a.email || '').toLowerCase();
    const bName = (b.name || b.email || '').toLowerCase();
    return aName.localeCompare(bName);
  });
}
