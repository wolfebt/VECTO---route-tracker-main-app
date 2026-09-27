import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useJobs, useCompany } from '../../hooks/useFirebase';
import { db } from '../../firebase';
import { collection, getDocs, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { 
  DollarSign, 
  X, 
  Download, 
  Search, 
  Check, 
  Ban, 
  CheckCircle2, 
  ExternalLink 
} from 'lucide-react';

export default function ExpenseLedgerModal() {
  const { modals, closeModal, companyId, isDispatchView } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const jobs = useJobs();
  const { members } = useCompany();

  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedDriver, setSelectedDriver] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState(null);

  useEffect(() => {
    if (!modals.expenseLedger || !companyId) return;

    let isMounted = true;
    const loadAllExpenses = async () => {
      setLoading(true);
      try {
        const allItems = [];
        // Fetch expenses across all jobs in parallel
        await Promise.all(
          jobs.map(async (job) => {
            try {
              const snap = await getDocs(collection(db, `companies/${companyId}/jobs/${job.id}/expenses`));
              snap.forEach((d) => {
                allItems.push({
                  id: d.id,
                  jobId: job.id,
                  jobName: job.jobName || 'Unnamed Job',
                  ...d.data()
                });
              });
            } catch (err) {
              console.warn(`Could not load expenses for job ${job.id}:`, err);
            }
          })
        );

        if (isMounted) {
          // Sort descending by timestamp
          allItems.sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0));
          setExpenses(allItems);
        }
      } catch (error) {
        console.error("Error fetching company expenses:", error);
      }
      if (isMounted) setLoading(false);
    };

    loadAllExpenses();

    return () => {
      isMounted = false;
    };
  }, [modals.expenseLedger, companyId, jobs]);

  if (!modals.expenseLedger) return null;

  const handleUpdateStatus = async (jobId, expenseId, newStatus) => {
    try {
      await updateDoc(doc(db, `companies/${companyId}/jobs/${jobId}/expenses`, expenseId), {
        status: newStatus,
        reviewedAt: serverTimestamp()
      });
      setExpenses(prev => prev.map(e => (e.id === expenseId ? { ...e, status: newStatus } : e)));
      addToast(`Expense marked as ${newStatus}`, "success");
    } catch (err) {
      console.error(err);
      addToast("Failed to update expense status", "error");
    }
  };

  const handleExportCSV = () => {
    if (filteredExpenses.length === 0) {
      addToast("No expenses to export", "info");
      return;
    }

    const headers = ["Date", "Driver", "Job Name", "Category", "Amount", "Description", "Status", "Receipt URL"];
    const rows = filteredExpenses.map(e => [
      e.timestamp ? new Date(e.timestamp.toMillis()).toLocaleDateString() : 'N/A',
      `"${(e.driverName || '').replace(/"/g, '""')}"`,
      `"${(e.jobName || '').replace(/"/g, '""')}"`,
      e.type || 'other',
      parseFloat(e.amount || 0).toFixed(2),
      `"${(e.description || '').replace(/"/g, '""')}"`,
      e.status || 'submitted',
      `"${e.receiptUrl || ''}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `vecto_expenses_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast("Expense report CSV exported!", "success");
  };

  // Filter expenses
  const filteredExpenses = expenses.filter(e => {
    if (selectedStatus !== 'all' && (e.status || 'submitted') !== selectedStatus) return false;
    if (selectedCategory !== 'all' && e.type !== selectedCategory) return false;
    if (selectedDriver !== 'all' && e.driverId !== selectedDriver) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchDesc = (e.description || '').toLowerCase().includes(q);
      const matchJob = (e.jobName || '').toLowerCase().includes(q);
      const matchDriver = (e.driverName || '').toLowerCase().includes(q);
      if (!matchDesc && !matchJob && !matchDriver) return false;
    }
    return true;
  });

  // Calculate Metrics
  const totalAmount = filteredExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const pendingAmount = filteredExpenses
    .filter(e => (e.status || 'submitted') === 'submitted')
    .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const approvedAmount = filteredExpenses
    .filter(e => ['approved', 'reimbursed'].includes(e.status))
    .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-3 sm:p-4" onClick={() => closeModal('expenseLedger')}>
      <div 
        className="bg-slate-900 border border-slate-800 text-white rounded-2xl w-full max-w-5xl max-h-[92vh] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-slate-950/90 border-b border-slate-800 flex justify-between items-center shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-orange-500/20 text-orange-400 rounded-xl border border-orange-500/30">
              <DollarSign size={22} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-bold text-white">Company Expense Ledger</h2>
                <span className="px-2 py-0.5 bg-orange-500/20 text-orange-300 text-xs font-semibold rounded-full border border-orange-500/30">
                  {filteredExpenses.length} Records
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Track driver receipts, audit reimbursement requests, and export bookkeeping ledgers.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleExportCSV}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              title="Download CSV report"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
            <button 
              onClick={() => closeModal('expenseLedger')} 
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-3 gap-3 p-4 bg-slate-950/40 border-b border-slate-800/80 shrink-0">
          <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/60">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Filtered Spend</span>
            <p className="text-lg sm:text-xl font-black text-white font-mono mt-0.5">
              ${totalAmount.toFixed(2)}
            </p>
          </div>
          <div className="bg-amber-950/20 p-3 rounded-xl border border-amber-500/30">
            <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">Pending Review</span>
            <p className="text-lg sm:text-xl font-black text-amber-300 font-mono mt-0.5">
              ${pendingAmount.toFixed(2)}
            </p>
          </div>
          <div className="bg-emerald-950/20 p-3 rounded-xl border border-emerald-500/30">
            <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">Approved / Paid</span>
            <p className="text-lg sm:text-xl font-black text-emerald-300 font-mono mt-0.5">
              ${approvedAmount.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Filters Toolbar */}
        <div className="p-3 bg-slate-900 border-b border-slate-800 flex flex-wrap gap-2 items-center justify-between shrink-0">
          <div className="flex flex-wrap gap-2 items-center">
            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-7 pr-2.5 py-1 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 outline-none w-32 sm:w-44 focus:border-orange-500"
              />
            </div>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-300 outline-none focus:border-orange-500"
            >
              <option value="all">All Statuses</option>
              <option value="submitted">Pending Review</option>
              <option value="approved">Approved</option>
              <option value="reimbursed">Reimbursed</option>
              <option value="rejected">Rejected</option>
            </select>

            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-300 outline-none focus:border-orange-500"
            >
              <option value="all">All Categories</option>
              <option value="fuel">Fuel</option>
              <option value="food">Food</option>
              <option value="toll">Toll / Parking</option>
              <option value="maintenance">Maintenance</option>
              <option value="lodging">Lodging</option>
              <option value="custom">Custom</option>
            </select>

            {/* Driver Filter */}
            <select
              value={selectedDriver}
              onChange={(e) => setSelectedDriver(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-300 outline-none focus:border-orange-500"
            >
              <option value="all">All Drivers</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.name || m.email}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Expense Records List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="text-center py-12 text-slate-500 text-sm italic">
              Loading company expense logs...
            </div>
          ) : filteredExpenses.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm italic">
              No matching expense records found.
            </div>
          ) : (
            filteredExpenses.map((exp) => {
              const status = exp.status || 'submitted';
              return (
                <div 
                  key={exp.id}
                  className="p-3.5 bg-slate-800/60 hover:bg-slate-800/90 border border-slate-700/60 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                >
                  {/* Left: Driver & Job Info */}
                  <div className="flex items-start space-x-3 min-w-0">
                    {exp.receiptUrl ? (
                      <img 
                        src={exp.receiptUrl} 
                        alt="Receipt" 
                        onClick={() => setLightboxUrl(exp.receiptUrl)}
                        className="w-12 h-12 rounded-lg object-cover border border-slate-600 hover:opacity-80 cursor-pointer shrink-0" 
                        title="Click to zoom receipt"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 shrink-0">
                        <DollarSign size={20} />
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="flex items-center space-x-2 flex-wrap">
                        <span className="font-bold text-sm text-white truncate">
                          {exp.driverName || 'Unknown Driver'}
                        </span>
                        <span className="text-xs text-slate-400 font-medium">
                          • {exp.jobName}
                        </span>
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">
                          {exp.type}
                        </span>
                      </div>

                      <p className="text-xs text-slate-300 mt-0.5 truncate">
                        {exp.description || 'No description provided.'}
                      </p>

                      <div className="flex items-center space-x-2 text-[10px] text-slate-500 font-mono mt-1">
                        <span>{exp.timestamp ? new Date(exp.timestamp.toMillis()).toLocaleString() : 'N/A'}</span>
                        {exp.receiptUrl && (
                          <button
                            type="button"
                            onClick={() => window.open(exp.receiptUrl, '_blank')}
                            className="text-sky-400 hover:underline flex items-center gap-0.5"
                          >
                            <ExternalLink size={10} /> View Full Receipt
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Amount & Status Actions */}
                  <div className="flex items-center justify-between sm:justify-end space-x-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-0 border-slate-700/50">
                    <div className="text-right">
                      <p className="text-base font-bold font-mono text-white">
                        ${parseFloat(exp.amount || 0).toFixed(2)}
                      </p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-block ${
                        status === 'approved' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                        status === 'reimbursed' ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' :
                        status === 'rejected' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                        'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {status.toUpperCase()}
                      </span>
                    </div>

                    {/* Dispatcher Actions */}
                    {isDispatchView && (
                      <div className="flex items-center space-x-1">
                        {status !== 'approved' && status !== 'reimbursed' && (
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(exp.jobId, exp.id, 'approved')}
                            className="p-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 rounded-lg transition-colors"
                            title="Approve expense"
                          >
                            <Check size={14} />
                          </button>
                        )}
                        {status !== 'reimbursed' && (
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(exp.jobId, exp.id, 'reimbursed')}
                            className="p-1.5 bg-sky-600/20 hover:bg-sky-600/40 text-sky-300 border border-sky-500/30 rounded-lg transition-colors"
                            title="Mark as Reimbursed"
                          >
                            <CheckCircle2 size={14} />
                          </button>
                        )}
                        {status !== 'rejected' && (
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(exp.jobId, exp.id, 'rejected')}
                            className="p-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 rounded-lg transition-colors"
                            title="Reject expense"
                          >
                            <Ban size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Lightbox Modal */}
        {lightboxUrl && (
          <div 
            className="fixed inset-0 bg-black/90 z-60 flex items-center justify-center p-4" 
            onClick={() => setLightboxUrl(null)}
          >
            <div className="relative max-w-3xl max-h-[90vh]">
              <img 
                src={lightboxUrl} 
                alt="Receipt Full Preview" 
                className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl" 
              />
              <button 
                onClick={() => setLightboxUrl(null)}
                className="absolute -top-3 -right-3 bg-slate-800 text-white p-2 rounded-full border border-slate-700 hover:bg-slate-700"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
