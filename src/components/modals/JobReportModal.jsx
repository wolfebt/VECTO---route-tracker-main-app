import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useJobs, useActiveDrivers } from '../../hooks/useFirebase';
import { db } from '../../firebase';
import { collection, query, getDocs, orderBy } from 'firebase/firestore';
import { Printer } from 'lucide-react';

export default function JobReportModal() {
  const { modals, closeModal, companyId, routeInfo } = useAppStore();
  const jobs = useJobs();
  const activeDrivers = useActiveDrivers();
  
  const [messages, setMessages] = useState([]);
  const [driverNotes, setDriverNotes] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);

  const modalData = modals.jobReport;
  const jobId = typeof modalData === 'object' ? modalData.jobId : null;
  const job = jobs.find(j => j.id === jobId);

  useEffect(() => {
    if (!jobId || !companyId || !modals.jobReport) return;

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch Chat
            const chatQ = query(collection(db, `companies/${companyId}/jobs/${jobId}/chat`));
            const chatSnap = await getDocs(chatQ);
            const msgs = [];
            chatSnap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
            msgs.sort((a,b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
            setMessages(msgs);

            // Fetch Notes
            const notesQ = query(collection(db, `companies/${companyId}/jobs/${jobId}/notes`));
            const notesSnap = await getDocs(notesQ);
            const nts = [];
            notesSnap.forEach(d => nts.push({ id: d.id, ...d.data() }));
            nts.sort((a,b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0)); // Descending for timeline
            setDriverNotes(nts);

            // Fetch Expenses
            const expQ = query(collection(db, `companies/${companyId}/jobs/${jobId}/expenses`));
            const expSnap = await getDocs(expQ);
            const exps = [];
            expSnap.forEach(d => exps.push({ id: d.id, ...d.data() }));
            exps.sort((a,b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
            setExpenses(exps);
        } catch (error) {
            console.error("Error fetching report data", error);
        }
        setLoading(false);
    };
    fetchData();
  }, [jobId, companyId, modals.jobReport]);

  if (!modals.jobReport || !job) return null;

  const handleClose = () => closeModal('jobReport');

  const groupedNotes = driverNotes.reduce((acc, note) => {
      const name = note.driverName || note.driverId || 'Unknown';
      if (!acc[name]) acc[name] = [];
      acc[name].push(note);
      return acc;
  }, {});

  const groupedExpenses = expenses.reduce((acc, exp) => {
      const name = exp.driverName || exp.driverId || 'Unknown';
      if (!acc[name]) acc[name] = [];
      acc[name].push(exp);
      return acc;
  }, {});

  const instructions = job.instructions || (job.note ? [{ id: 'legacy', text: job.note, target: 'all', isPriority: false }] : []);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="bg-white text-black rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Controls (Not printed) */}
        <div className="p-4 border-b border-gray-300 flex justify-between items-center shrink-0 bg-gray-100 rounded-t-lg print:hidden">
          <h2 className="text-xl font-bold text-gray-800">Job Report Preview</h2>
          <div className="flex space-x-2">
              <button onClick={() => window.print()} className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-semibold transition-colors">
                  <Printer size={18} />
                  <span>Print Report</span>
              </button>
              <button onClick={handleClose} aria-label="Close" className="text-gray-500 hover:text-gray-800 p-2 rounded focus-visible:ring-2 focus-visible:ring-blue-500 font-bold">&times;</button>
          </div>
        </div>
        
        {/* Report Content */}
        <div className="p-8 overflow-y-auto flex-1 print:p-0 print:overflow-visible">
            
            <div className="text-center border-b-2 border-gray-800 pb-4 mb-6">
                <h1 className="text-4xl font-extrabold uppercase tracking-wider text-gray-900 mb-1">VECTO</h1>
                <p className="text-xs text-gray-500 font-medium mb-3">Author: Wolfe.BT@TangentLLC.net</p>
                <h2 className="text-2xl font-bold uppercase tracking-wide text-gray-800">{job.jobName || 'Unnamed Job'}</h2>
                <p className="text-gray-500 font-medium text-sm">Job Report - {job.jobDate || new Date().toLocaleDateString()}</p>
            </div>

            {/* Section 1: General Info */}
            <section className="mb-8">
                <h2 className="text-xl font-bold bg-gray-200 p-2 border-l-4 border-gray-800 mb-4">1. Job Details & Dispatch Instructions</h2>
                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div>
                        <p><strong>Status:</strong> {job.status}</p>
                        <p><strong>Origin:</strong> {job.origin}</p>
                        <p><strong>Destination(s):</strong> {(job.destinations || [job.destination]).join(' -> ')}</p>
                    </div>
                    <div>
                        <p><strong>Contact Name:</strong> {job.contactName || 'N/A'}</p>
                        <p><strong>Contact Number:</strong> {job.contactNumber || 'N/A'}</p>
                        <p>
                            <strong>Team Assigned:</strong>{' '}
                            {job.assignedDrivers?.map(d => d.name).join(', ') || 'None'}
                        </p>
                    </div>
                </div>

                {instructions.length > 0 && (
                    <div className="bg-gray-50 p-4 rounded border border-gray-200">
                        <h3 className="font-bold mb-2">Instructions:</h3>
                        <ul className="space-y-2">
                            {instructions.map((inst, idx) => (
                                <li key={inst.id || idx} className="flex items-start">
                                    <span className="mr-2 mt-1">-</span>
                                    <div>
                                        {inst.isPriority && <span className="bg-red-100 text-red-800 text-xs font-bold px-2 py-0.5 rounded uppercase mr-2 border border-red-200">Priority</span>}
                                        {inst.target !== 'all' && (
                                            <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2 py-0.5 rounded uppercase mr-2 border border-blue-200">
                                                For: {activeDrivers.find(d => d.id === inst.target)?.name || inst.target}
                                            </span>
                                        )}
                                        <span className="text-gray-800 font-medium">{inst.text}</span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </section>

            {/* Section 2: Driver Details & Notes */}
            <section className="mb-8">
                <h2 className="text-xl font-bold bg-gray-200 p-2 border-l-4 border-gray-800 mb-4">2. Team Member Updates & Logs</h2>
                {loading ? (
                    <p className="text-gray-500 italic">Loading notes...</p>
                ) : driverNotes.length === 0 ? (
                    <p className="text-gray-500 italic">No progress notes logged by the team.</p>
                ) : (
                    <div className="space-y-6">
                        {Object.entries(groupedNotes).map(([driverName, notes]) => (
                            <div key={driverName}>
                                <h3 className="font-bold text-lg mb-2 text-blue-900 border-b border-gray-300 pb-1">{driverName}</h3>
                                <ul className="space-y-3">
                                    {notes.map(note => (
                                        <li key={note.id} className="bg-gray-50 p-3 rounded border border-gray-200 flex flex-col">
                                            <span className="text-xs text-gray-500 font-medium mb-1">
                                                {note.timestamp ? new Date(note.timestamp.toMillis()).toLocaleString() : 'Unknown time'}
                                            </span>
                                            <span className="text-gray-800">{note.text}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Section 3: Driver Expenses */}
            <section className="mb-8">
                <h2 className="text-xl font-bold bg-gray-200 p-2 border-l-4 border-gray-800 mb-4">3. Driver Expenses</h2>
                {loading ? (
                    <p className="text-gray-500 italic">Loading expenses...</p>
                ) : expenses.length === 0 ? (
                    <p className="text-gray-500 italic">No expenses logged for this job.</p>
                ) : (
                    <div className="space-y-6">
                        {Object.entries(groupedExpenses).map(([driverName, drvExpenses]) => {
                            const totalAmount = drvExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
                            return (
                                <div key={driverName}>
                                    <h3 className="font-bold text-lg mb-2 text-orange-900 border-b border-gray-300 pb-1 flex justify-between">
                                        <span>{driverName}</span>
                                        <span>Total: ${totalAmount.toFixed(2)}</span>
                                    </h3>
                                    <ul className="space-y-2">
                                        {drvExpenses.map(exp => (
                                            <li key={exp.id} className="bg-gray-50 p-2 rounded border border-gray-200 flex justify-between items-center text-sm">
                                                <div>
                                                    <span className="font-bold uppercase text-[10px] mr-2 text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">{exp.type}</span>
                                                    <span className="text-gray-800">{exp.description || 'No description'}</span>
                                                </div>
                                                <span className="font-bold text-gray-900">${parseFloat(exp.amount || 0).toFixed(2)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Section 4: Route Details */}
            <section className="mb-8" style={{ pageBreakInside: 'avoid' }}>
                <h2 className="text-xl font-bold bg-gray-200 p-2 border-l-4 border-gray-800 mb-4">4. Route Details</h2>
                {routeInfo ? (
                    <div>
                        <div className="flex space-x-8 mb-4">
                            <p><strong>Total Distance:</strong> {routeInfo.distance}</p>
                            <p><strong>Est. Duration:</strong> {routeInfo.duration}</p>
                        </div>
                        {routeInfo.steps && routeInfo.steps.length > 0 && (
                            <div>
                                <h3 className="font-bold mb-2">Directions Summary:</h3>
                                <ul className="list-decimal pl-5 space-y-1 text-sm text-gray-700">
                                    {routeInfo.steps.map((step, idx) => (
                                        <li key={idx}>{step}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-gray-500 italic">Route details not available (map was not loaded for this job).</p>
                )}
            </section>

            {/* Section 5: Messages */}
            <section style={{ pageBreakInside: 'auto' }}>
                <h2 className="text-xl font-bold bg-gray-200 p-2 border-l-4 border-gray-800 mb-4">5. Job Chat History</h2>
                {loading ? (
                    <p className="text-gray-500 italic">Loading messages...</p>
                ) : messages.length === 0 ? (
                    <p className="text-gray-500 italic">No chat messages for this job.</p>
                ) : (
                    <div className="space-y-3">
                        {messages.map(msg => (
                            <div key={msg.id} className="flex flex-col border-b border-gray-100 pb-2">
                                <div className="flex justify-between items-baseline mb-1">
                                    <span className="font-bold text-gray-900">{msg.senderName}</span>
                                    <span className="text-xs text-gray-500">{msg.timestamp ? new Date(msg.timestamp.toMillis()).toLocaleString() : ''}</span>
                                </div>
                                {msg.text && <p className="text-gray-800 text-sm">{msg.text}</p>}
                                {msg.attachmentUrl && <span className="text-blue-600 text-xs italic mt-1">[Attachment Included]</span>}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
      </div>
      
      {/* Print Styles */}
      <style>{`
        @media print {
            body * {
                visibility: hidden;
            }
            .fixed.inset-0 {
                position: absolute;
                background: white;
            }
            .fixed > div, .fixed > div * {
                visibility: visible;
            }
            .fixed > div {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                box-shadow: none;
                max-width: 100%;
                margin: 0;
                padding: 0;
            }
            .print\\:hidden {
                display: none !important;
            }
            .print\\:p-0 {
                padding: 0 !important;
            }
            .print\\:overflow-visible {
                overflow: visible !important;
            }
        }
      `}</style>
    </div>
  );
}
