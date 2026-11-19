import React, { useState, useMemo } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  ClipboardCheck,
  Edit3,
  Plus,
  Search,
  Trash2,
  Truck,
  Wrench,
  X,
} from 'lucide-react';
import { db } from '../../firebase';
import { useCompany, useInspections, useVehicles } from '../../hooks/useFirebase';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { toMillisSafe } from '../../utils/formatters';
import { isVehicleServiceDue } from '../../utils/vehicles';

const VEHICLE_TYPE_LABELS = {
  van: 'Cargo Van',
  box_truck: 'Box Truck',
  semi: 'Semi / Tractor',
  pickup: 'Pickup Truck',
  car: 'Courier Car',
};

const FUEL_LABELS = {
  diesel: 'Diesel',
  gasoline: 'Gasoline',
  electric: 'Electric (EV)',
  hybrid: 'Hybrid',
};

const EMPTY_FORM = {
  unitNumber: '',
  makeModel: '',
  vin: '',
  licensePlate: '',
  vehicleType: 'van',
  fuelType: 'diesel',
  capacityLbs: '',
  odometerMiles: '',
  serviceDueMiles: '',
  serviceDueDate: '',
  status: 'active',
  assignedDriverId: '',
  notes: '',
};

export default function FleetVehiclesModal() {
  const { modals, closeModal, openModal, companyId, isDispatchView } = useAppStore();
  const addToast = useToastStore((s) => s.addToast);
  const vehicles = useVehicles();
  const inspections = useInspections();
  const { members } = useCompany();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const openDefectsByVehicle = useMemo(() => {
    const counts = new Map();
    inspections.forEach((insp) => {
      if (insp.overallStatus !== 'safe' && !insp.mechanicResolved && insp.vehicleId) {
        counts.set(insp.vehicleId, (counts.get(insp.vehicleId) || 0) + 1);
      }
    });
    return counts;
  }, [inspections]);

  if (!modals.fleetVehicles) return null;

  const activeCount = vehicles.filter((v) => v.status === 'active').length;
  const maintenanceDueCount = vehicles.filter(isVehicleServiceDue).length;
  const outOfServiceCount = vehicles.filter((v) => v.status === 'out_of_service').length;

  const filteredVehicles = vehicles.filter((v) => {
    if (statusFilter === 'service_due') {
      if (!isVehicleServiceDue(v)) return false;
    } else if (statusFilter !== 'all' && v.status !== statusFilter) {
      return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchUnit = String(v.unitNumber || '').toLowerCase().includes(q);
      const matchModel = String(v.makeModel || '').toLowerCase().includes(q);
      const matchPlate = String(v.licensePlate || '').toLowerCase().includes(q);
      const matchDriver = String(v.assignedDriverName || '').toLowerCase().includes(q);
      if (!matchUnit && !matchModel && !matchPlate && !matchDriver) return false;
    }
    return true;
  });

  const handleOpenAdd = () => {
    setEditingVehicleId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const handleOpenEdit = (v) => {
    setEditingVehicleId(v.id);
    setForm({
      unitNumber: v.unitNumber || '',
      makeModel: v.makeModel || '',
      vin: v.vin || '',
      licensePlate: v.licensePlate || '',
      vehicleType: v.vehicleType || 'van',
      fuelType: v.fuelType || 'diesel',
      capacityLbs: typeof v.capacityLbs === 'number' ? String(v.capacityLbs) : '',
      odometerMiles: typeof v.odometerMiles === 'number' ? String(v.odometerMiles) : '',
      serviceDueMiles: typeof v.serviceDueMiles === 'number' ? String(v.serviceDueMiles) : '',
      serviceDueDate: v.serviceDueDate || '',
      status: v.status || 'active',
      assignedDriverId: v.assignedDriverId || '',
      notes: v.notes || '',
    });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!isDispatchView || !companyId) return;
    const unitNumber = form.unitNumber.trim();
    if (!unitNumber) {
      addToast('Unit number / vehicle ID is required.', 'error');
      return;
    }

    setSaving(true);
    try {
      const assignedMember = members.find((m) => m.id === form.assignedDriverId) || null;
      const toNullableNum = (raw) => {
        const cleaned = String(raw || '').trim();
        if (!cleaned) return null;
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      };

      const payload = {
        unitNumber: unitNumber.slice(0, 60),
        makeModel: form.makeModel.trim().slice(0, 120),
        vin: form.vin.trim().toUpperCase().slice(0, 32),
        licensePlate: form.licensePlate.trim().toUpperCase().slice(0, 32),
        vehicleType: form.vehicleType || 'van',
        fuelType: form.fuelType || 'diesel',
        capacityLbs: toNullableNum(form.capacityLbs),
        odometerMiles: toNullableNum(form.odometerMiles),
        serviceDueMiles: toNullableNum(form.serviceDueMiles),
        serviceDueDate: form.serviceDueDate.trim().slice(0, 40) || null,
        status: form.status || 'active',
        assignedDriverId: assignedMember ? assignedMember.id : null,
        assignedDriverName: assignedMember ? (assignedMember.name || assignedMember.email || 'Driver').slice(0, 120) : null,
        notes: form.notes.trim().slice(0, 1000),
        updatedAt: serverTimestamp(),
      };

      if (editingVehicleId) {
        await updateDoc(doc(db, `companies/${companyId}/vehicles`, editingVehicleId), payload);
        addToast(`Updated vehicle ${unitNumber}`, 'success');
      } else {
        await addDoc(collection(db, `companies/${companyId}/vehicles`), {
          ...payload,
          lastInspectionStatus: null,
          createdAt: serverTimestamp(),
        });
        addToast(`Added vehicle ${unitNumber} to fleet`, 'success');
      }

      setShowForm(false);
      setEditingVehicleId(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      console.error('Failed to save vehicle:', err);
      addToast('Failed to save vehicle record', 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (vehicle) => {
    if (!isDispatchView || !companyId) return;
    if (!window.confirm(`Delete vehicle ${vehicle.unitNumber} from the registry?`)) return;
    try {
      await deleteDoc(doc(db, `companies/${companyId}/vehicles`, vehicle.id));
      addToast(`Removed vehicle ${vehicle.unitNumber}`, 'info');
    } catch (err) {
      console.error('Failed to delete vehicle:', err);
      addToast('Failed to delete vehicle', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4"
      onClick={() => closeModal('fleetVehicles')}
    >
      <div
        className="bg-slate-900 border border-slate-800 text-white rounded-2xl w-full max-w-5xl max-h-[92vh] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-slate-950/90 border-b border-slate-800 flex justify-between items-center shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-cyan-500/20 text-cyan-400 rounded-xl border border-cyan-500/30">
              <Truck size={22} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-white">Fleet Vehicles & Assets</h2>
                <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 text-xs font-semibold rounded-full border border-cyan-500/30">
                  {vehicles.length} Units
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Manage fleet units, odometer intervals, preventive maintenance, and DVIR safety readiness.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {isDispatchView && (
              <button
                type="button"
                onClick={handleOpenAdd}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                <Plus size={14} />
                <span>Add Vehicle</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => closeModal('fleetVehicles')}
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              aria-label="Close fleet vehicles modal"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-3 gap-3 p-4 bg-slate-950/40 border-b border-slate-800/80 shrink-0">
          <div className="bg-emerald-950/20 p-3 rounded-xl border border-emerald-500/30">
            <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">Active Units</span>
            <p className="text-lg sm:text-xl font-black text-emerald-300 font-mono mt-0.5">{activeCount}</p>
          </div>
          <div className="bg-amber-950/20 p-3 rounded-xl border border-amber-500/30">
            <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">Service Due / Maint</span>
            <p className="text-lg sm:text-xl font-black text-amber-300 font-mono mt-0.5">{maintenanceDueCount}</p>
          </div>
          <div className="bg-rose-950/20 p-3 rounded-xl border border-rose-500/30">
            <span className="text-[10px] uppercase font-bold text-rose-400 tracking-wider">Out of Service</span>
            <p className="text-lg sm:text-xl font-black text-rose-300 font-mono mt-0.5">{outOfServiceCount}</p>
          </div>
        </div>

        {/* Add / Edit Drawer Form */}
        {showForm && isDispatchView && (
          <form onSubmit={handleSave} className="p-4 bg-slate-950/70 border-b border-slate-800 space-y-3 overflow-y-auto max-h-[55vh] shrink-0">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                {editingVehicleId ? 'Edit Vehicle Asset' : 'Register New Fleet Vehicle'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingVehicleId(null);
                }}
                className="text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Unit # / Asset ID *</label>
                <input
                  type="text"
                  required
                  value={form.unitNumber}
                  onChange={(e) => setForm({ ...form, unitNumber: e.target.value })}
                  placeholder="e.g., VAN-104"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-white outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Year / Make / Model</label>
                <input
                  type="text"
                  value={form.makeModel}
                  onChange={(e) => setForm({ ...form, makeModel: e.target.value })}
                  placeholder="e.g., 2024 Ford Transit 250"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-white outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Vehicle Class</label>
                <select
                  value={form.vehicleType}
                  onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-white outline-none focus:border-cyan-500"
                >
                  {Object.entries(VEHICLE_TYPE_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">License Plate</label>
                <input
                  type="text"
                  value={form.licensePlate}
                  onChange={(e) => setForm({ ...form, licensePlate: e.target.value })}
                  placeholder="TX-8492K"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-white outline-none focus:border-cyan-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-semibold mb-1">VIN</label>
                <input
                  type="text"
                  value={form.vin}
                  onChange={(e) => setForm({ ...form, vin: e.target.value })}
                  placeholder="1FTBR1Y8..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-white outline-none focus:border-cyan-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Fuel Type</label>
                <select
                  value={form.fuelType}
                  onChange={(e) => setForm({ ...form, fuelType: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-white outline-none focus:border-cyan-500"
                >
                  {Object.entries(FUEL_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Odometer (mi)</label>
                <input
                  type="number"
                  min="0"
                  value={form.odometerMiles}
                  onChange={(e) => setForm({ ...form, odometerMiles: e.target.value })}
                  placeholder="48500"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-white outline-none focus:border-cyan-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Next Service (mi)</label>
                <input
                  type="number"
                  min="0"
                  value={form.serviceDueMiles}
                  onChange={(e) => setForm({ ...form, serviceDueMiles: e.target.value })}
                  placeholder="55000"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-white outline-none focus:border-cyan-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Next Service Date</label>
                <input
                  type="date"
                  value={form.serviceDueDate}
                  onChange={(e) => setForm({ ...form, serviceDueDate: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-white outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Payload Capacity (lbs)</label>
                <input
                  type="number"
                  min="0"
                  value={form.capacityLbs}
                  onChange={(e) => setForm({ ...form, capacityLbs: e.target.value })}
                  placeholder="3500"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-white outline-none focus:border-cyan-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Primary Driver</label>
                <select
                  value={form.assignedDriverId}
                  onChange={(e) => setForm({ ...form, assignedDriverId: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-white outline-none focus:border-cyan-500"
                >
                  <option value="">Unassigned Pool</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name || m.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Operational Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-white outline-none focus:border-cyan-500"
                >
                  <option value="active">Active / Road Ready</option>
                  <option value="maintenance">In Maintenance</option>
                  <option value="out_of_service">Out of Service (Hold)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Notes (e.g., liftgate equipped, tire rotation pending)..."
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold disabled:opacity-50 cursor-pointer shrink-0"
              >
                {saving ? 'Saving...' : (editingVehicleId ? 'Save Vehicle' : 'Create Vehicle')}
              </button>
            </div>
          </form>
        )}

        {/* Filter Toolbar */}
        <div className="p-3 bg-slate-900 border-b border-slate-800 flex flex-wrap gap-2 items-center justify-between shrink-0">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search unit, plate, driver..."
                className="pl-7 pr-2.5 py-1 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 outline-none w-44 sm:w-56 focus:border-cyan-500"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-300 outline-none focus:border-cyan-500"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="service_due">Service Due / Maint</option>
              <option value="maintenance">In Maintenance</option>
              <option value="out_of_service">Out of Service</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => openModal('dvir')}
            className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-bold cursor-pointer"
          >
            <ClipboardCheck size={13} />
            <span>Open DVIR Log</span>
          </button>
        </div>

        {/* Vehicles List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {filteredVehicles.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm italic">
              {vehicles.length === 0
                ? 'No vehicles registered yet. Add fleet units to track mileage, maintenance, and DVIR safety.'
                : 'No matching vehicles found.'}
            </div>
          ) : (
            filteredVehicles.map((v) => {
              const serviceDue = isVehicleServiceDue(v);
              const openDefects = openDefectsByVehicle.get(v.id) || 0;
              const lastInspMs = toMillisSafe(v.lastInspectionAt);

              return (
                <div
                  key={v.id}
                  className="p-3.5 bg-slate-800/60 hover:bg-slate-800/90 border border-slate-700/70 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2">
                      <span className="font-extrabold text-sm text-white">{v.unitNumber}</span>
                      <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-200 text-[10px] font-bold uppercase">
                        {VEHICLE_TYPE_LABELS[v.vehicleType] || v.vehicleType || 'Vehicle'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                          v.status === 'active'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : v.status === 'maintenance'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        }`}
                      >
                        {v.status === 'out_of_service' ? 'Out of Service' : v.status}
                      </span>
                      {serviceDue && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold flex items-center gap-1">
                          <Wrench size={10} /> Service Due
                        </span>
                      )}
                      {openDefects > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold flex items-center gap-1">
                          <AlertTriangle size={10} /> {openDefects} Open Defect{openDefects > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-300">
                      {v.makeModel && <span>{v.makeModel}</span>}
                      {v.licensePlate && <span className="font-mono text-sky-300">Plate: {v.licensePlate}</span>}
                      {v.fuelType && <span className="text-slate-400">{FUEL_LABELS[v.fuelType] || v.fuelType}</span>}
                      {typeof v.capacityLbs === 'number' && (
                        <span className="text-slate-400">{v.capacityLbs.toLocaleString()} lbs cap</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400 font-mono">
                      <span>
                        Odo: {typeof v.odometerMiles === 'number' ? `${v.odometerMiles.toLocaleString()} mi` : 'N/A'}
                      </span>
                      {typeof v.serviceDueMiles === 'number' && (
                        <span>PM Due: {v.serviceDueMiles.toLocaleString()} mi</span>
                      )}
                      {v.serviceDueDate && <span>PM Date: {v.serviceDueDate}</span>}
                      {v.assignedDriverName && (
                        <span className="text-emerald-300 font-sans font-semibold">
                          Driver: {v.assignedDriverName}
                        </span>
                      )}
                      {v.lastInspectionStatus && (
                        <span className="font-sans">
                          Last DVIR:{' '}
                          <strong
                            className={
                              v.lastInspectionStatus === 'safe'
                                ? 'text-emerald-400'
                                : v.lastInspectionStatus === 'unsafe'
                                ? 'text-rose-400'
                                : 'text-amber-400'
                            }
                          >
                            {v.lastInspectionStatus.replace('_', ' ')}
                          </strong>
                          {lastInspMs > 0 ? ` (${new Date(lastInspMs).toLocaleDateString()})` : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openModal('dvir', { vehicleId: v.id })}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1 cursor-pointer"
                      title="Run Pre-/Post-Trip DVIR Inspection"
                    >
                      <ClipboardCheck size={13} />
                      <span>Inspect</span>
                    </button>
                    {isDispatchView && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(v)}
                          className="p-2 rounded-lg bg-slate-700/70 hover:bg-slate-600 text-sky-300 transition-colors cursor-pointer"
                          title="Edit Vehicle"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(v)}
                          className="p-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/35 text-rose-300 transition-colors cursor-pointer"
                          title="Delete Vehicle"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
