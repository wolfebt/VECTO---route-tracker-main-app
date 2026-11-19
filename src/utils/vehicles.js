/**
 * Returns true if a fleet vehicle is in maintenance status or has met/exceeded
 * its mileage or date preventive service interval.
 */
export function isVehicleServiceDue(vehicle) {
  if (!vehicle) return false;
  if (vehicle.status === 'maintenance') return true;
  const odo = typeof vehicle.odometerMiles === 'number' ? vehicle.odometerMiles : null;
  const dueMiles = typeof vehicle.serviceDueMiles === 'number' ? vehicle.serviceDueMiles : null;
  if (odo !== null && dueMiles !== null && odo >= dueMiles) return true;
  if (vehicle.serviceDueDate) {
    const todayIso = new Date().toISOString().slice(0, 10);
    if (String(vehicle.serviceDueDate) <= todayIso) return true;
  }
  return false;
}
