import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useJobs } from '../../hooks/useFirebase';
import { db } from '../../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { FileText, X } from 'lucide-react';

export default function LogExpenseModal() {
  const { modals, closeModal, companyId, currentUser } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const jobs = useJobs();

  const [expenseType, setExpenseType] = useState('fuel');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);

  const modalData = modals.logExpense;
  const jobId = typeof modalData === 'object' ? modalData?.jobId : null;
  const job = jobs.find(j => j.id === jobId);

  if (!modals.logExpense) return null;

  const handleClose = () => {
    setExpenseType('fuel');
    setAmount('');
    setDescription('');
    closeModal('logExpense');
  };

  const handleSaveExpense = async (e) => {
    e.preventDefault();
    if (!amount.trim() || !jobId || !companyId || !currentUser?.id) return;
    setSavingExpense(true);
    try {
      await addDoc(collection(db, `companies/${companyId}/jobs/${jobId}/expenses`), {
        type: expenseType,
        amount: parseFloat(amount),
        description: description.trim(),
        driverId: currentUser.id,
        driverName: currentUser.name || 'Unknown',
        timestamp: serverTimestamp()
      });
      addToast("Expense logged successfully", "success");
      handleClose();
    } catch (error) {
      console.error(error);
      addToast("Failed to log expense", "error");
    }
    setSavingExpense(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="bg-slate-900 border border-slate-800 text-white rounded-xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-orange-500/20 text-orange-400 rounded-lg border border-orange-500/30">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Log Expense</h2>
              <p className="text-xs text-slate-400 font-medium truncate max-w-[280px]">
                {job?.jobName ? `Job: ${job.jobName}` : 'Add an expense to this job'}
              </p>
            </div>
          </div>
          <button 
            onClick={handleClose} 
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSaveExpense} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Expense Type
            </label>
            <select
              value={expenseType}
              onChange={(e) => setExpenseType(e.target.value)}
              className="w-full bg-slate-800/80 border border-slate-700 text-white rounded-xl p-3 text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
            >
              <option value="fuel">Fuel</option>
              <option value="food">Food</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Amount ($)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-slate-800/80 border border-slate-700 text-white rounded-xl p-3 text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none placeholder:text-slate-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Description (Optional)
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="E.g., Lunch at diner, gas station refill..."
              className="w-full bg-slate-800/80 border border-slate-700 text-white rounded-xl p-3 text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none placeholder:text-slate-500"
            />
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingExpense || !amount.trim()}
              className="px-5 py-2.5 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white rounded-lg text-xs font-bold shadow-lg transition-all disabled:opacity-50 min-h-[44px]"
            >
              {savingExpense ? 'Saving...' : 'Submit Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
