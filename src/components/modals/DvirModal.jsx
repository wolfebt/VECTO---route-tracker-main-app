import React, { useState, useEffect, useRef } from 'react';
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { db, storage } from '../../firebase';
import { useInspections, useVehicles } from '../../hooks/useFirebase';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { toMillisSafe } from '../../utils/formatters';
import { compressImageFile } from '../../utils/imageCompression';

const DVIR_CHECKLIST_ITEMS = [
  { key: 'brakes', label: 'Service Brakes & Parking Brake' },
  { key: 'tires', label: 'Tires, Wheels & Lug Nuts' },
  { key: 'lights', label: 'Headlights, Brake & Turn Signals' },
  { key: 'steering', label: 'Steering Mechanism & Suspension' },
  { key: 'hornWipers', label: 'Horn, Windshield & Wipers' },
  { key: 'mirrors', label: 'Mirrors & Glass Visibility' },
  { key: 'fluids', label: 'Engine Fluids & Zero Active Leaks' },
  { key: 'cargo', label: 'Cargo Securement / Tie-Downs' },
  { key: 'emergency', label: 'Fire Extinguisher, Triangles & First Aid' },
  { key: 'doorsCoupling', label: 'Doors, Liftgate & Coupling Devices' },
];

function makeInitialChecklist() {
  const map = {};
  DVIR_CHECKLIST_ITEMS.forEach((item) => {
    map[item.key] = true;
  });
  return map;
}

export default function DvirModal() {
  const { modals, closeModal, openModal, companyId, currentUser, isDispatchView } = useAppStore();
  const addToast = useToastStore((s) => s.addToast);
  const vehicles = useVehicles();
  const inspections = useInspections();

  const modalData = typeof modals.dvir === 'object' ? modals.dvir : null;
  const requestedVehicleId = modalData?.vehicleId || '';
  const requestedJobId = modalData?.jobId || null;

  const [activeTab, setActiveTab] = useState('new'); // 'new' | 'log'
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [inspectionType, setInspectionType] = useState('pre_trip');
  const [odometerMiles, setOdometerMiles] = useState('');
  const [checklist, setChecklist] = useState(makeInitialChecklist);
  const [defectSeverity, setDefectSeverity] = useState('defects_noted'); // 'defects_noted' | 'unsafe'
  const [defectsSummary, setDefectsSummary] = useState('');
  const [driverSignedName, setDriverSignedName] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!modals.dvir) return;
    const myAssignedVehicle = vehicles.find((v) => v.assignedDriverId === currentUser?.id);
    const defaultVehicle =
      vehicles.find((v) => v.id === requestedVehicleId) ||
      myAssignedVehicle ||
      vehicles[0] ||
      null;

    setSelectedVehicleId(defaultVehicle?.id || '');
    setOdometerMiles(typeof defaultVehicle?.odometerMiles === 'number' ? String(defaultVehicle.odometerMiles) : '');
    setChecklist(makeInitialChecklist());
    setDefectSeverity('defects_noted');
    setDefectsSummary('');
    setDriverSignedName(currentUser?.name || currentUser?.email || '');
    setActiveTab(vehicles.length === 0 ? 'log' : 'new');
  }, [modals.dvir, requestedVehicleId, vehicles, currentUser?.id, currentUser?.name, currentUser?.email]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  if (!modals.dvir) return null;

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) || null;
  const defectCount = Object.values(checklist).filter((passed) => passed === false).length;

  const handleClose = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setPhotoFile(null);
    closeModal('dvir');
  };

  const handleVehicleChange = (nextId) => {
    setSelectedVehicleId(nextId);
    const v = vehicles.find((veh) => veh.id === nextId);
    if (typeof v?.odometerMiles === 'number') {
      setOdometerMiles(String(v.odometerMiles));
    }
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast('Defect photo must be an image file.', 'error');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      addToast('Defect photo must be under 25MB.', 'error');
      return;
    }
    const compressed = await compressImageFile(file);
    if (compressed.size > 10 * 1024 * 1024) {
      addToast('Compressed defect photo exceeds 10MB limit.', 'error');
      return;
    }
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(compressed);
    setPhotoPreview(URL.createObjectURL(compressed));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!companyId || !currentUser?.id || !selectedVehicle) return;

    const odoVal = Number(odometerMiles);
    if (!Number.isFinite(odoVal) || odoVal < 0) {
      addToast('Please enter a valid current odometer reading.', 'error');
      return;
    }
    if (!driverSignedName.trim()) {
      addToast('Please sign with your full name to certify the DVIR.', 'error');
      return;
    }

    const overallStatus = defectCount === 0 ? 'safe' : defectSeverity;
    setSaving(true);

    try {
      let defectPhotoUrl = null;
      if (photoFile) {
        const rawExt = photoFile.name.split('.').pop();
        const ext = rawExt && /^[a-zA-Z0-9]{2,5}$/.test(rawExt) ? rawExt : 'jpg';
        const path = `dvir/${companyId}/${selectedVehicle.id}/${Date.now()}_${currentUser.id}.${ext}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, photoFile, { contentType: photoFile.type || 'image/jpeg' });
        defectPhotoUrl = await getDownloadURL(storageRef);
      }

      const vehicleLabel = [selectedVehicle.unitNumber, selectedVehicle.makeModel].filter(Boolean).join(' — ');
      await addDoc(collection(db, `companies/${companyId}/inspections`), {
        companyId,
        vehicleId: selectedVehicle.id,
        vehicleLabel: vehicleLabel.slice(0, 120),
        jobId: requestedJobId || null,
        driverId: currentUser.id,
        driverName: (currentUser.name || currentUser.email || 'Driver').slice(0, 120),
        inspectionType,
        odometerMiles: odoVal,
        checklist,
        defectsSummary: defectCount > 0 ? defectsSummary.trim().slice(0, 2000) : '',
        defectPhotoUrl,
        overallStatus,
        driverSignedName: driverSignedName.trim().slice(0, 120),
        mechanicResolved: overallStatus === 'safe',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const prevOdo = typeof selectedVehicle.odometerMiles === 'number' ? selectedVehicle.odometerMiles : 0;
      const nextStatus = overallStatus === 'unsafe' ? 'out_of_service' : selectedVehicle.status || 'active';

      await updateDoc(doc(db, `companies/${companyId}/vehicles`, selectedVehicle.id), {
        odometerMiles: Math.max(prevOdo, odoVal),
        lastInspectionStatus: overallStatus,
        lastInspectionAt: serverTimestamp(),
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });

      addToast(
        overallStatus === 'unsafe'
          ? `DVIR submitted — ${selectedVehicle.unitNumber} placed Out of Service`
          : 'DVIR safety inspection logged!',
        overallStatus === 'unsafe' ? 'warning' : 'success'
      );
      setActiveTab('log');
      setPhotoFile(null);
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
        setPhotoPreview(null);
      }
    } catch (err) {
      console.error('Failed to submit DVIR:', err);
      addToast('Failed to save DVIR inspection', 'error');
    }
    setSaving(false);
  };

  const handleResolveDefect = async (insp) => {
    if (!isDispatchView || !companyId) return;
    const note = window.prompt('Mechanic / repair sign-off note (optional):', '');
    if (note === null) return;

    try {
      await updateDoc(doc(db, `companies/${companyId}/inspections`, insp.id), {
        mechanicResolved: true,
        resolvedBy: currentUser?.id || null,
        resolvedNote: note.trim().slice(0, 500) || null,
        resolvedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (insp.vehicleId) {
        await updateDoc(doc(db, `companies/${companyId}/vehicles`, insp.vehicleId), {
          status: 'active',
          lastInspectionStatus: 'safe',
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      addToast('Defect resolved and vehicle returned to Active status', 'success');
    } catch (err) {
      console.error('Failed to resolve defect:', err);
      addToast('Could not mark defect resolved', 'error');
    }
  };

  const openDefectsCount = inspections.filter((i) => i.overallStatus !== 'safe' && !i.mechanicResolved).length;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4"
      onClick={handleClose}
    >
      <div
        className="bg-slate-900 border border-slate-800 text-white rounded-2xl w-full max-w-2xl max-h-[92vh] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-slate-950/90 border-b border-slate-800 flex justify-between items-center shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
              <ClipboardCheck size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Driver Vehicle Inspection (DVIR)</h2>
              <p className="text-xs text-slate-400">Pre-/post-trip safety walkaround & defect sign-off</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Close DVIR modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('new')}
            className={`flex-1 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'new'
                ? 'border-emerald-400 text-emerald-300 bg-emerald-500/10'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            New Inspection
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('log')}
            className={`flex-1 py-2.5 text-xs font-bold border-b-2 transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'log'
                ? 'border-sky-400 text-sky-300 bg-sky-500/10'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <span>Inspection Log ({inspections.length})</span>
            {openDefectsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-rose-500/25 text-rose-300 border border-rose-500/40 text-[10px]">
                {openDefectsCount} Open
              </span>
            )}
          </button>
        </div>

        {/* Body */}
        {activeTab === 'new' ? (
          vehicles.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-slate-300 font-semibold">No fleet vehicles registered yet.</p>
              <p className="text-xs text-slate-400">
                Add a vehicle in Fleet Vehicles first before running a pre-/post-trip DVIR inspection.
              </p>
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  openModal('fleetVehicles');
                }}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Open Fleet Vehicles
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Vehicle Unit *
                  </label>
                  <select
                    value={selectedVehicleId}
                    onChange={(e) => handleVehicleChange(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl p-2.5 outline-none focus:border-emerald-500"
                    required
                  >
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.unitNumber} {v.makeModel ? `— ${v.makeModel}` : ''} ({v.status})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Odometer (mi) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={odometerMiles}
                    onChange={(e) => setOdometerMiles(e.target.value)}
                    placeholder="48500"
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl p-2.5 font-mono outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                {[
                  { id: 'pre_trip', label: 'Pre-Trip Walkaround' },
                  { id: 'post_trip', label: 'Post-Trip Walkaround' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setInspectionType(opt.id)}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                      inspectionType === opt.id
                        ? 'bg-emerald-600/25 text-emerald-300 border-emerald-500/50'
                        : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    10-Point DOT Safety Checklist
                  </span>
                  <span className={`text-[11px] font-bold ${defectCount > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {defectCount === 0 ? 'All Items Pass' : `${defectCount} Defect(s) Flagged`}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {DVIR_CHECKLIST_ITEMS.map((item) => {
                    const passed = checklist[item.key] !== false;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setChecklist((prev) => ({ ...prev, [item.key]: !passed }))}
                        className={`p-2.5 rounded-xl border text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                          passed
                            ? 'bg-slate-800/60 border-slate-700 text-slate-200 hover:border-emerald-500/40'
                            : 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                        }`}
                      >
                        <span className="font-medium leading-snug">{item.label}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase shrink-0 ${
                            passed
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-rose-500/30 text-rose-200'
                          }`}
                        >
                          {passed ? 'Pass' : 'Defect'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {defectCount > 0 && (
                <div className="p-3.5 bg-rose-950/25 border border-rose-500/40 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-rose-300">
                    <AlertTriangle size={14} />
                    <span>Defect Details & Vehicle Condition</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDefectSeverity('defects_noted')}
                      className={`p-2 rounded-lg border text-xs font-bold cursor-pointer ${
                        defectSeverity === 'defects_noted'
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >
                      Minor Defect — Safe to Operate
                    </button>
                    <button
                      type="button"
                      onClick={() => setDefectSeverity('unsafe')}
                      className={`p-2 rounded-lg border text-xs font-bold cursor-pointer ${
                        defectSeverity === 'unsafe'
                          ? 'bg-rose-600/30 border-rose-500 text-rose-200'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >
                      UNSAFE — Put Out of Service
                    </button>
                  </div>

                  <textarea
                    rows={2}
                    required
                    value={defectsSummary}
                    onChange={(e) => setDefectsSummary(e.target.value)}
                    placeholder="Describe the defect(s) found during inspection..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-xs text-white outline-none focus:border-rose-500"
                  />

                  {photoFile ? (
                    <div className="flex items-center justify-between bg-slate-900 p-2 rounded-lg border border-slate-700">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {photoPreview && (
                          <img src={photoPreview} alt="Defect preview" className="w-10 h-10 rounded object-cover" />
                        )}
                        <span className="text-xs truncate text-slate-200">{photoFile.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (photoPreview) URL.revokeObjectURL(photoPreview);
                          setPhotoPreview(null);
                          setPhotoFile(null);
                        }}
                        className="text-rose-400 p-1 hover:bg-rose-950/40 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full py-2 rounded-xl border border-dashed border-slate-600 hover:border-rose-400 text-xs text-slate-300 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Camera size={14} />
                      <span>Attach Defect Photo (Optional)</span>
                    </button>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoChange}
                    className="hidden"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Driver Certification Signature *
                </label>
                <input
                  type="text"
                  required
                  value={driverSignedName}
                  onChange={(e) => setDriverSignedName(e.target.value)}
                  placeholder="Full name certifying inspection accuracy"
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl p-2.5 text-sm outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <ShieldCheck size={15} />
                  <span>{saving ? 'Submitting...' : 'Certify & Submit DVIR'}</span>
                </button>
              </div>
            </form>
          )
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {inspections.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm italic">
                No DVIR safety inspections logged yet.
              </div>
            ) : (
              inspections.map((insp) => {
                const isSafe = insp.overallStatus === 'safe';
                const createdMs = toMillisSafe(insp.createdAt);
                const failedItems = DVIR_CHECKLIST_ITEMS.filter((item) => insp.checklist?.[item.key] === false).map(
                  (item) => item.label
                );

                return (
                  <div
                    key={insp.id}
                    className={`p-3.5 rounded-xl border space-y-2 ${
                      !isSafe && !insp.mechanicResolved
                        ? 'bg-rose-950/20 border-rose-500/40'
                        : 'bg-slate-800/60 border-slate-700/70'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">{insp.vehicleLabel || insp.vehicleId}</span>
                        <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-200 text-[10px] font-bold uppercase">
                          {insp.inspectionType === 'post_trip' ? 'Post-Trip' : 'Pre-Trip'}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase ${
                            isSafe
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : insp.mechanicResolved
                              ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                              : insp.overallStatus === 'unsafe'
                              ? 'bg-rose-500/25 text-rose-200 border-rose-500/50'
                              : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          }`}
                        >
                          {isSafe
                            ? 'Safe'
                            : insp.mechanicResolved
                            ? 'Resolved'
                            : insp.overallStatus === 'unsafe'
                            ? 'Unsafe / Hold'
                            : 'Defects Noted'}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {createdMs ? new Date(createdMs).toLocaleString() : 'Just now'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
                      <span>Driver: <strong>{insp.driverName || insp.driverSignedName}</strong></span>
                      <span className="font-mono">Odometer: {Number(insp.odometerMiles || 0).toLocaleString()} mi</span>
                      <span>Signed: <em>{insp.driverSignedName}</em></span>
                    </div>

                    {failedItems.length > 0 && (
                      <p className="text-xs text-rose-300">
                        <strong>Failed Items:</strong> {failedItems.join(', ')}
                      </p>
                    )}

                    {insp.defectsSummary && (
                      <p className="text-xs text-slate-200 bg-slate-900/70 p-2 rounded-lg border border-slate-700/60">
                        {insp.defectsSummary}
                      </p>
                    )}

                    {insp.resolvedNote && (
                      <p className="text-xs text-sky-300 bg-sky-950/30 p-2 rounded-lg border border-sky-500/30">
                        <strong>Mechanic Resolution:</strong> {insp.resolvedNote}
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      {insp.defectPhotoUrl ? (
                        <a
                          href={insp.defectPhotoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-sky-400 hover:underline inline-flex items-center gap-1"
                        >
                          View Defect Photo <ExternalLink size={11} />
                        </a>
                      ) : <span />}

                      {isDispatchView && !isSafe && !insp.mechanicResolved && (
                        <button
                          type="button"
                          onClick={() => handleResolveDefect(insp)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Wrench size={12} />
                          <CheckCircle2 size={12} />
                          <span>Resolve Defect & Return Active</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
